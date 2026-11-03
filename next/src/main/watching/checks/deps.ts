import { execFile } from "node:child_process"
import dns from "node:dns/promises"
import { existsSync, readFileSync, statfs } from "node:fs"
import http from "node:http"
import https from "node:https"
import { homedir } from "node:os"
import net from "node:net"
import { Readable } from "node:stream"
import { connect as tlsConnect } from "node:tls"

// What the plain checks reach the world through. Tests pass fakes, so no check needs the network.

/** `valid`: the certificate is trusted and names the host. */
export type TlsInfo = { days: number | null; version: string | null; valid?: boolean }
/** `missing`: the program isn't installed. */
export type ExecResult = { stdout: string; code: number; missing?: boolean }

/** `pin`: connect only to these addresses, already checked (reach.ts), instead of looking the host up again. */
export type FetchInit = RequestInit & { pin?: string[] }

export type CheckDeps = {
  fetch: (url: string, init?: FetchInit) => Promise<Response>
  now: () => number
  sleep: (ms: number) => Promise<void>
  resolveTxt: (host: string) => Promise<string[][]>
  /** Mail servers, best first; empty when there are none. */
  resolveMx?: (host: string) => Promise<string[]>
  /** Whether the name resolves to an address at all. */
  resolves?: (host: string) => Promise<boolean>
  /** Whether the server still accepts TLS 1.0. */
  tlsOld?: (host: string, timeoutMs: number) => Promise<boolean>
  /** TCP connect: true when the port answers. */
  connect: (host: string, port: number, timeoutMs: number) => Promise<boolean>
  /** Days left on the certificate and the TLS version; nulls when there's no answer. */
  tls: (host: string, timeoutMs: number) => Promise<TlsInfo>
  exec: (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<ExecResult>
  exists: (path: string) => boolean
  /** A domain's records of one type, as strings ("10 mx1.example.com" for MX); empty when there are none. */
  records?: (host: string, type: "A" | "NS" | "MX" | "TXT") => Promise<string[]>
  /** Runs a program with your login shell's PATH (npm, pnpm), for tests and outdated packages. */
  run?: (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<ExecResult>
  /** Free and total bytes on the volume that holds `path`. */
  disk?: (path: string) => Promise<{ free: number; total: number }>
  /** Page speed: a page's lab vitals from a hidden window (load.ts). Missing in unit tests. */
  vitals?: (url: string, timeoutMs: number) => Promise<import("../load").Vitals | null>
  /** The app's own network stack (Chromium), for sites that refuse Node's TLS (Reddit). */
  netFetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** The home folder, for "~/…" targets. */
  home?: () => string
  /** A host's addresses, so URLs a site lists are never fetched on this Mac or the local network (reach.ts). */
  addresses?: (host: string) => Promise<string[]>
}

export const TIMEOUT = 10_000
export const HEADERS = { "user-agent": "AxeAI-watch/1" }

/** An error in plain words, for a failed run. */
export const plainError = (e: unknown) => {
  const m = e instanceof Error ? `${e.name} ${e.message} ${e.cause instanceof Error ? e.cause.message : ""}` : String(e)
  if (/timeout|aborted/i.test(m)) return "No answer in 10 s"
  if (/ENOTFOUND|EAI_AGAIN|ENODATA/.test(m)) return "The address wasn’t found"
  if (/ECONNREFUSED/.test(m)) return "The connection was refused"
  if (/certificate|CERT_/i.test(m)) return "Its certificate isn’t valid"
  if (/refused: a local or private address/.test(m)) return "It points to a local or private address, which I don’t open"
  return "It didn’t answer"
}

/**
 * A GET (or HEAD) to `url` that connects only to `addresses` (tried in turn, IPv6 and IPv4 as Node falls
 * back): the Host header, SNI and certificate check still use the URL's name. No connection pooling, so
 * no socket opened elsewhere is reused.
 */
export function pinnedFetch(url: string, init: RequestInit, addresses: string[]): Promise<Response> {
  const u = new URL(url)
  const all = addresses.map((address) => ({ address, family: net.isIP(address) }))
  if (!all.length || all.some((a) => !a.family)) return Promise.reject(new Error("refused: a local or private address"))
  if (init.body != null) return Promise.reject(new Error("a pinned request has no body"))
  return new Promise((resolve, reject) => {
    const req = (u.protocol === "https:" ? https : http).request(
      u,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        signal: init.signal ?? undefined,
        agent: false,
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opts?.all ? cb(null, all) : cb(null, all[0]!.address, all[0]!.family)) as never,
      },
      (res) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(res.headers)) for (const x of v === undefined ? [] : [v].flat()) headers.append(k, x)
        const status = res.statusCode ?? 502
        const empty = [204, 205, 304].includes(status) || req.method === "HEAD"
        if (empty) res.resume()
        try {
          resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), { status, statusText: res.statusMessage, headers }))
        } catch (e) {
          // A status Response can't hold (999).
          res.destroy()
          reject(e)
        }
      },
    )
    req.on("error", reject)
    req.end()
  })
}

export const realDeps: CheckDeps = {
  fetch: (url, { pin, ...init } = {}) => (pin ? pinnedFetch(url, init, pin) : fetch(url, init)),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  resolveTxt: (host) => dns.resolveTxt(host),
  resolveMx: async (host) => (await dns.resolveMx(host).catch(() => [])).sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase()),
  resolves: async (host) => {
    try {
      await dns.lookup(host)
      return true
    } catch {
      return false
    }
  },
  tlsOld: (host, timeoutMs) =>
    new Promise((resolve) => {
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        socket.destroy()
        resolve(ok)
      }
      // OpenSSL refuses TLS 1.0 at its default level; level 0 lets the probe ask for it.
      const socket = tlsConnect({ host, port: 443, servername: host, timeout: timeoutMs, minVersion: "TLSv1", maxVersion: "TLSv1", ciphers: "DEFAULT@SECLEVEL=0", rejectUnauthorized: false }, () =>
        finish(socket.getProtocol() === "TLSv1"),
      )
      socket.on("timeout", () => finish(false))
      socket.on("error", () => finish(false))
    }),
  connect: (host, port, timeoutMs) =>
    new Promise((resolve) => {
      const s = net.connect({ host, port, timeout: timeoutMs })
      const end = (ok: boolean) => {
        s.destroy()
        resolve(ok)
      }
      s.once("connect", () => end(true))
      s.once("timeout", () => end(false))
      s.once("error", () => end(false))
    }),
  tls: (host, timeoutMs) =>
    new Promise((resolve) => {
      let done = false
      const finish = (r: TlsInfo) => {
        if (done) return
        done = true
        socket.destroy()
        resolve(r)
      }
      // Read the certificate even when it isn't trusted, so an invalid one is a finding, not "Unknown".
      const socket = tlsConnect({ host, port: 443, servername: host, timeout: timeoutMs, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate()
        const ends = cert?.valid_to ? Date.parse(cert.valid_to) : Number.NaN
        finish({ days: Number.isFinite(ends) ? Math.floor((ends - Date.now()) / 86_400_000) : null, version: socket.getProtocol(), valid: socket.authorized })
      })
      socket.on("timeout", () => finish({ days: null, version: null }))
      socket.on("error", () => finish({ days: null, version: null }))
    }),
  exec: (cmd, args, { cwd, timeoutMs }) =>
    new Promise((resolve) => {
      execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0
        const missing = (err as { code?: unknown } | null)?.code === "ENOENT"
        // Failures keep stderr too, so callers can tell "not signed in" from other errors.
        resolve({ stdout: code ? `${stdout ?? ""}\n${stderr ?? ""}` : String(stdout ?? ""), code, ...(missing ? { missing } : {}) })
      })
    }),
  exists: (p) => existsSync(p),
  records: async (host, type) => {
    // Only "there are none" is empty; a resolver that fails (SERVFAIL, a timeout, no network) throws.
    const none = <T>(e: unknown): T[] => {
      if (["ENODATA", "ENOTFOUND"].includes((e as { code?: string })?.code ?? "")) return []
      throw e
    }
    if (type === "A") return dns.resolve4(host).catch(none<string>)
    if (type === "NS") return dns.resolveNs(host).catch(none<string>)
    if (type === "MX") return (await dns.resolveMx(host).catch(none<{ priority: number; exchange: string }>)).map((m) => `${m.priority} ${m.exchange.toLowerCase()}`)
    return (await dns.resolveTxt(host).catch(none<string[]>)).map((p) => p.join(""))
  },
  run: async (cmd, args, opts) => {
    const { childEnv } = await import("../../shell-env")
    const env = await childEnv()
    return new Promise((resolve) => {
      execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 50 * 1024 * 1024, env: { ...env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" } }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0
        const missing = (err as { code?: unknown } | null)?.code === "ENOENT"
        resolve({ stdout: `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`, code, ...(missing ? { missing } : {}) })
      })
    })
  },
  disk: (path) =>
    new Promise((resolve, reject) => statfs(path, (err, s) => (err ? reject(err) : resolve({ free: s.bavail * s.bsize, total: s.blocks * s.bsize })))),
  home: () => homedir(),
  addresses: async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address),
}

/**
 * Self-tests only (AXE_SELFTEST=1 and AXE_WATCH_FAKE_NET=<json file>): DNS, ports and TLS for named
 * hosts come from the file, and their web requests go to a local server. The file is read on every
 * call, so a test can "fix a record" by rewriting it. Shape:
 * { "hosts": { "lane-ceramics.com": { "txt": { "_dmarc.lane-ceramics.com": ["v=DMARC1; p=none"] },
 *   "mx": [], "a": ["203.0.113.7"], "ns": ["ns1.example.net"], "ports": [80, 443], "tls": { "days": 74, "version": "TLSv1.3", "old": false }, "http": "http://127.0.0.1:4321" } } }
 */
type FakeHost = { txt?: Record<string, string[]>; mx?: string[]; /** A and NS records, for DNS changes. */ a?: string[]; ns?: string[]; ports?: number[]; tls?: { days: number; version: string; old?: boolean; valid?: boolean }; http?: string; /** Answers take this long, so a test can see the steps tick. */ slow?: number; /** The domain doesn't exist. */ missing?: boolean }

export function withFakeNet(real: CheckDeps, file: string): CheckDeps {
  const hosts = (): Record<string, FakeHost> => {
    try {
      return (JSON.parse(readFileSync(file, "utf8")) as { hosts?: Record<string, FakeHost> }).hosts ?? {}
    } catch {
      return {}
    }
  }
  // "_dmarc.lane-ceramics.com" belongs to "lane-ceramics.com".
  const owner = (name: string) => {
    const all = hosts()
    const key = Object.keys(all).find((h) => name === h || name.endsWith(`.${h}`))
    return key ? all[key] : undefined
  }
  const wait = async (name: string, share = 1) => {
    const ms = owner(name)?.slow
    if (ms) await new Promise((r) => setTimeout(r, ms * share))
  }
  return {
    ...real,
    fetch: (url, init) => {
      const u = new URL(url)
      const h = owner(u.hostname)
      if (h?.missing) return Promise.reject(new Error(`getaddrinfo ENOTFOUND ${u.hostname}`))
      // The local server stands in for the host, so the pin (its fake public address) is dropped.
      const { pin: _, ...rest } = init ?? {}
      return h?.http ? real.fetch(`${h.http}${u.pathname}${u.search}`, rest) : real.fetch(url, init)
    },
    addresses: async (name) => {
      const h = owner(name)
      if (!h) return real.addresses?.(name) ?? []
      if (h.missing) throw new Error(`getaddrinfo ENOTFOUND ${name}`)
      return h.a?.length ? h.a : ["203.0.113.7"]
    },
    resolveTxt: async (name) => {
      const h = owner(name)
      if (!h) return real.resolveTxt(name)
      const recs = h.txt?.[name]
      if (!recs) throw Object.assign(new Error(`queryTxt ENODATA ${name}`), { code: "ENODATA" })
      return recs.map((r) => [r])
    },
    resolveMx: async (name) => {
      if (!owner(name)) return real.resolveMx?.(name) ?? []
      await wait(name)
      return owner(name)!.mx ?? []
    },
    resolves: async (name) => (owner(name) ? !owner(name)!.missing : (real.resolves?.(name) ?? true)),
    connect: async (host, port, t) => {
      if (!owner(host)) return real.connect(host, port, t)
      await wait(host, 3)
      return (owner(host)!.ports ?? []).includes(port)
    },
    tls: async (host, t) => {
      await wait(host, 1.5)
      const f = owner(host)?.tls
      return f ? { days: f.days, version: f.version, valid: f.valid ?? true } : owner(host) ? { days: null, version: null } : real.tls(host, t)
    },
    tlsOld: async (host, t) => (owner(host) ? !!owner(host)!.tls?.old : (real.tlsOld?.(host, t) ?? false)),
    records: async (name, type) => {
      const h = owner(name)
      if (!h) return real.records?.(name, type) ?? []
      if (type === "A") return h.a ?? []
      if (type === "NS") return h.ns ?? []
      if (type === "MX") return (h.mx ?? []).map((m, i) => `${(i + 1) * 10} ${m}`)
      return h.txt?.[name] ?? []
    },
  }
}

/** Self-tests only (AXE_WATCH_GH=<executable>): "gh" runs this stand-in, so a test never shows a real GitHub account. */
export function withFakeGh(real: CheckDeps, script: string): CheckDeps {
  return { ...real, exec: (cmd, args, opts) => (cmd === "gh" ? real.exec(script, args, opts) : real.exec(cmd, args, opts)) }
}

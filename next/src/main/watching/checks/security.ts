import { statusOf } from "@shared/watching/findings"
import { hostOf, urlOf } from "@shared/watching/target"
import type { CheckRow, Finding, Run, Step } from "@shared/watching/types"

import { type CheckDeps, HEADERS, plainError, TIMEOUT, type TlsInfo } from "./deps"

// Security for a domain: who can send email as it (SPF, DKIM, DMARC), the certificate, TLS and five
// security headers, and which of 12 common ports answer from this Mac. The four parts run at once and
// tick off as they finish. Each problem is one finding with a stable key; DNS problems are record
// fixes, header and TLS problems are agent fixes, and the rest have no fix from here.

type Part = { findings: Finding[]; row: CheckRow; dmarc?: string }

/** DKIM selectors the common mail providers use (Google, Microsoft 365, Mailchimp, SendGrid, Zoho, Fastmail and others). */
export const DKIM_SELECTORS = ["google", "selector1", "selector2", "k1", "k2", "s1", "s2", "default", "dkim", "mail", "smtp", "mandrill", "zoho", "fm1", "mxvault"]

const txt = async (d: CheckDeps, host: string) => {
  try {
    return (await d.resolveTxt(host)).map((p) => p.join(""))
  } catch {
    return [] as string[]
  }
}

/** What SPF should include for the domain's mail provider, from its MX records. */
function spfFor(mx: string[]): string {
  const m = mx.join(" ")
  if (/google|googlemail/.test(m)) return "v=spf1 include:_spf.google.com ~all"
  if (/outlook|microsoft/.test(m)) return "v=spf1 include:spf.protection.outlook.com ~all"
  if (/zoho/.test(m)) return "v=spf1 include:zoho.com ~all"
  if (/messagingengine|fastmail/.test(m)) return "v=spf1 include:spf.messagingengine.com ~all"
  return mx.length ? "v=spf1 mx ~all" : "v=spf1 -all"
}

async function email(host: string, d: CheckDeps): Promise<Part> {
  const [root, dmarcs, mx, dkim] = await Promise.all([
    txt(d, host),
    txt(d, `_dmarc.${host}`),
    d.resolveMx?.(host).catch(() => []) ?? Promise.resolve([] as string[]),
    Promise.all(DKIM_SELECTORS.map(async (s) => (await txt(d, `${s}._domainkey.${host}`)).some((t) => /v=DKIM1|\bp=/i.test(t)))),
  ])
  const spf = root.find((t) => /^v=spf1/i.test(t))
  const dmarc = dmarcs.find((t) => /^v=DMARC1/i.test(t))
  const policy = dmarc?.match(/\bp=(\w+)/i)?.[1]?.toLowerCase()
  const hasDkim = dkim.some(Boolean)
  const findings: Finding[] = []
  const weak = !dmarc || policy === "none"
  if (weak) {
    const why = dmarc
      ? hasDkim
        ? "DMARC is set to none"
        : "DMARC is set to none and there’s no DKIM record"
      : hasDkim
        ? "There’s no DMARC record"
        : "There’s no DMARC or DKIM record"
    const want = `v=DMARC1; p=quarantine; rua=mailto:dmarc@${host}`
    findings.push({
      key: "dmarc:none",
      level: "problem",
      headline: `Anyone can send email as ${host}`,
      past: `Anyone could send email as ${host}`,
      line: `Anyone can send email as ${host}.`,
      detail: `${why}, so mail that fakes your address still gets delivered.`,
      fix: "record",
      ev: {
        record: {
          name: `_dmarc.${host}`,
          type: "TXT",
          ...(dmarc ? { found: dmarc } : {}),
          want,
          how: `${hasDkim ? "" : "Turn on DKIM with your mail provider. Then "}${dmarc ? (hasDkim ? "Change" : "change") : hasDkim ? "Add" : "add"} this record:`,
        },
      },
    })
  }
  if (!spf) {
    findings.push({
      key: "spf:none",
      level: "problem",
      headline: `${host} doesn’t say which servers send its email`,
      past: `${host} didn’t say which servers send its email`,
      line: `${host} has no SPF record.`,
      detail: "There’s no SPF record, so other servers can claim to send your mail.",
      fix: "record",
      ev: { record: { name: host, type: "TXT", want: spfFor(mx), how: "Add this record:" } },
    })
  }
  const value = weak ? "Spoofable" : !spf ? "No SPF" : "Protected"
  return { findings, row: { label: "Email records", sub: "SPF, DKIM, DMARC", value, ok: !findings.length }, ...(dmarc ? { dmarc } : {}) }
}

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`

function certificate(host: string, tls: TlsInfo): Part {
  const row = (value: string, ok: boolean): CheckRow => ({ label: "Certificate", sub: host, value, ok })
  if (tls.days === null) return { findings: [], row: row("No HTTPS", true) }
  if (tls.days < 0)
    return {
      findings: [{ key: "cert:expired", level: "problem", headline: `The certificate for ${host} has expired`, past: `The certificate for ${host} had expired`, line: `The certificate for ${host} has expired.`, detail: "Browsers show a warning instead of the site. Renew it with your host.", fix: "none" }],
      row: row("Expired", false),
    }
  if (tls.valid === false)
    return {
      findings: [{ key: "cert:invalid", level: "problem", headline: `The certificate for ${host} isn’t valid`, past: `The certificate for ${host} wasn’t valid`, line: `The certificate for ${host} isn’t valid.`, detail: "It isn’t trusted, or it’s for another name, so browsers show a warning. Get a new one from your host.", fix: "none" }],
      row: row("Not valid", false),
    }
  if (tls.days > 14) return { findings: [], row: row(`${days(tls.days)} left`, true) }
  return {
    findings: [
      {
        key: "cert:ending",
        level: "problem",
        headline: `The certificate for ${host} ends in ${days(tls.days)}`,
        past: `The certificate for ${host} was ending in ${days(tls.days)}`,
        line: `The certificate ends in ${days(tls.days)}.`,
        detail: "Renew it with your host. Most hosts renew it on their own, so check that auto-renew is on.",
        fix: "none",
      },
    ],
    row: row(`${days(tls.days)} left`, false),
  }
}

/** The five headers, in the order a missing list names them. */
const FIVE: [string, string][] = [
  ["strict-transport-security", "Strict-Transport-Security"],
  ["content-security-policy", "Content-Security-Policy"],
  ["x-content-type-options", "X-Content-Type-Options"],
  ["x-frame-options", "X-Frame-Options"],
  ["referrer-policy", "Referrer-Policy"],
]

const and = (xs: (string | number)[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : `${xs[0] ?? ""}`)

function tlsAndHeaders(host: string, res: Response | null, tls: TlsInfo, old: boolean): Part {
  const version = tls.version ? tls.version.replace(/^TLSv/, "TLS ") : null
  const findings: Finding[] = []
  const has = (h: string) => !!res?.headers.get(h)
  // CSP's frame-ancestors does what X-Frame-Options does.
  const framed = has("x-frame-options") || /frame-ancestors/i.test(res?.headers.get("content-security-policy") ?? "")
  const missing = res ? FIVE.filter(([h]) => (h === "x-frame-options" ? !framed : !has(h))) : []
  if (missing.some(([h]) => h === "strict-transport-security")) {
    findings.push({
      key: "header:hsts",
      level: "problem",
      headline: `${host} sends no HSTS header`,
      past: `${host} sent no HSTS header`,
      line: `${host} sends no HSTS header.`,
      detail: "Without Strict-Transport-Security, a browser can be tricked into loading the site over plain HTTP.",
      fix: "agent",
    })
  }
  const rest = missing.filter(([h]) => h !== "strict-transport-security").map(([, n]) => n)
  if (rest.length) {
    findings.push({
      key: "header:missing",
      level: "problem",
      headline: `${host} is missing ${rest.length === 1 ? "a security header" : `${rest.length} security headers`}`,
      past: `${host} was missing ${rest.length === 1 ? "a security header" : `${rest.length} security headers`}`,
      line: `${rest.length === 1 ? "A security header is" : `${rest.length} security headers are`} missing.`,
      detail: `${and(rest)} ${rest.length === 1 ? "isn’t" : "aren’t"} set. They stop other sites from framing yours and limit what injected scripts can do.`,
      fix: "agent",
    })
  }
  if (old) {
    findings.push({
      key: "tls:old",
      level: "problem",
      headline: "TLS 1.0 is still allowed",
      past: "TLS 1.0 was still allowed",
      line: "TLS 1.0 is still allowed.",
      detail: "TLS 1.0 and 1.1 have known weaknesses. Turn them off in your server or host settings, and keep TLS 1.2 and 1.3.",
      fix: "agent",
    })
  }
  const value = old ? "TLS 1.0 allowed" : missing.length ? (missing.length === 1 && missing[0]![0] === "strict-transport-security" ? "No HSTS" : `${missing.length} headers missing`) : (version ?? "No HTTPS")
  return { findings, row: { label: "TLS and headers", value, ok: !findings.length } }
}

/** 12 common ports, and the ones that shouldn't answer from the internet. */
export const PORTS = [21, 22, 23, 25, 80, 443, 445, 3306, 3389, 5432, 6379, 27017]
const RISKY: Record<number, string> = { 21: "FTP", 23: "Telnet", 445: "Windows file sharing", 3306: "MySQL", 3389: "Remote Desktop", 5432: "Postgres", 6379: "Redis", 27017: "MongoDB" }
const PORT_MS = 3000

async function ports(host: string, d: CheckDeps): Promise<Part> {
  const open = (await Promise.all(PORTS.map(async (p) => ((await d.connect(host, p, PORT_MS)) ? p : 0)))).filter(Boolean)
  const findings: Finding[] = open
    .filter((p) => p in RISKY)
    .map((p) => ({
      key: `port:${p}`,
      level: "problem" as const,
      headline: `Port ${p} (${RISKY[p]}) is open to anyone`,
      past: `Port ${p} (${RISKY[p]}) was open to anyone`,
      line: `Port ${p} (${RISKY[p]}) is open to anyone.`,
      detail: `Anyone on the internet can try to sign in to it. Close port ${p} in your firewall, or allow only your own addresses.`,
      fix: "none" as const,
    }))
  const web = open.length === 2 && open.includes(80) && open.includes(443)
  const value = !open.length ? "None open" : web ? "80 and 443 only" : open.length === 1 ? `${open[0]} only` : and(open)
  return { findings, row: { label: "Open ports", sub: `${PORTS.length} checked`, value, ok: !findings.length } }
}

const LABELS = ["Email records", "Certificate", "TLS and headers", "Open ports"]

/** The four steps of a security run, ticking off as each part finishes (they run at once). */
export const securitySteps = (done: Set<number>): Step[] => LABELS.map((label, i) => ({ label, state: done.has(i) ? "done" : "run" }))

export async function checkSecurity(domain: string, d: CheckDeps, onStep?: (steps: Step[]) => void): Promise<Run> {
  const at = d.now()
  const host = hostOf(domain)
  const ms = () => Math.round(d.now() - at)
  const done = new Set<number>()
  onStep?.(securitySteps(done))
  const tick =
    <T,>(i: number) =>
    (v: T) => {
      done.add(i)
      onStep?.(securitySteps(done))
      return v
    }
  const load = async (): Promise<Response | { error: string }> => {
    try {
      const res = await d.fetch(urlOf(host), { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT), headers: HEADERS })
      await res.body?.cancel()
      return res
    } catch (e) {
      return { error: plainError(e) }
    }
  }
  const tls = d.tls(host, TIMEOUT).catch((): TlsInfo => ({ days: null, version: null }))
  const [mail, cert, headers, open] = await Promise.all([
    email(host, d).then(tick<Part>(0)),
    tls.then(tick<TlsInfo>(1)),
    Promise.all([load(), tls, d.tlsOld?.(host, TIMEOUT).catch(() => false) ?? Promise.resolve(false)]).then(tick<[Response | { error: string }, TlsInfo, boolean]>(2)),
    ports(host, d).then(tick<Part>(3)),
  ])
  const [res, , old] = headers
  const site = res instanceof Response ? res : null
  // The domain doesn't resolve: no web answer, no certificate, no open ports.
  if (!site && cert.days === null && open.row.value === "None open" && "error" in res && /wasn’t found/.test(res.error)) {
    return { at, ms: ms(), status: "failed", findings: [], error: res.error }
  }
  const parts = [mail, certificate(host, cert), tlsAndHeaders(host, site, cert, old), open]
  const findings = parts.flatMap((x) => x.findings)
  return { at, ms: ms(), status: statusOf(findings), findings, rows: parts.map((x) => x.row), ...(mail.dmarc ? { dmarc: mail.dmarc } : {}) }
}

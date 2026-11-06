import { createHash, randomBytes } from "node:crypto"
import { rmSync } from "node:fs"

import type { Profile } from "@shared/types"

import { emit } from "../bus"
import { dataPath, readJSON, writeJSON } from "../paths"
import { settings } from "../settings"
import { AxeClient, AxeError, joinURL } from "./client"

// Sign in with Axe AI: the browser opens axeai.com/desktop/authorize (PKCE);
// approving there sends it to axedesktop://auth/callback, which the OS hands
// back to us (open-url on the Mac, a second instance's argv elsewhere). Same
// flow as the Mac app's AxeAccount.swift, with this app's own client id.

export const PROTOCOL = "axedesktop"
export const CLIENT_ID = "axe-desktop"
export const REDIRECT_URI = `${PROTOCOL}://auth/callback`

export type TokenStore = { read(): string | undefined; write(token: string): boolean; clear(): void }

const memoryStore = (): TokenStore => {
  let t: string | undefined
  return { read: () => t, write: (v) => ((t = v), true), clear: () => (t = undefined) }
}

let store: TokenStore = memoryStore()
let token: string | undefined
let profile: Profile | null = null
let pending: { state: string; verifier: string; resolve: (url: string) => void; reject: (e: Error) => void } | undefined
/** How the authorize page is opened: the real browser, set by index.ts. */
let openAuthorizePage: (url: string) => void = () => {}

const profileFile = () => dataPath("profile.json")

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
export const challengeFor = (verifier: string) => b64url(createHash("sha256").update(verifier).digest())

class Cancelled extends Error {
  constructor() {
    super("Sign-in was cancelled.")
  }
}

const signedOutListeners = new Set<() => void>()
export function onSignedOut(fn: () => void) {
  signedOutListeners.add(fn)
}
const signedInListeners = new Set<() => void>()
export function onSignedIn(fn: () => void) {
  signedInListeners.add(fn)
}

/** Called once at startup with the OS token store and the browser opener. */
export function configureAccount(options: { store?: TokenStore; openExternal?: (url: string) => void }) {
  if (options.store) store = options.store
  if (options.openExternal) openAuthorizePage = options.openExternal
  // AXE_TOKEN lets end-to-end tests start signed in; never saved.
  token = process.env.AXE_TOKEN || store.read()
  // The last profile, so the window shows who is signed in while offline.
  profile = token ? readJSON<Profile | null>(profileFile(), null) : null
  // Self-test: approve our own code against the server with a test session cookie
  // instead of a browser, the way the website's approve button does.
  if (process.env.AXE_SELFTEST_COOKIE) openAuthorizePage = (url) => void selfApprove(url)
}

export const isSignedIn = () => token !== undefined
export const currentProfile = () => profile

export function client(): AxeClient {
  if (!token) throw new AxeError(401, "sign_in_required", "Sign in to Axe AI first.")
  return new AxeClient(settings().baseURL, token)
}

/** A client that works signed out too (for public endpoints). */
export const anyClient = () => new AxeClient(settings().baseURL, token)

export function authorizeURL(state: string, challenge: string): string {
  const u = new URL(joinURL(settings().baseURL, "desktop/authorize"))
  u.search = new URLSearchParams({ client: CLIENT_ID, redirect_uri: REDIRECT_URI, state, code_challenge: challenge, code_challenge_method: "S256" }).toString()
  return u.toString()
}

async function selfApprove(url: string) {
  try {
    const q = new URL(url).searchParams
    const base = settings().baseURL
    const r = await fetch(joinURL(base, "api/auth/desktop/codes"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: process.env.AXE_SELFTEST_ORIGIN || new URL(base).origin,
        Cookie: `axeai_session=${process.env.AXE_SELFTEST_COOKIE}`,
      },
      body: JSON.stringify(Object.fromEntries(q)),
    })
    const j = (await r.json().catch(() => ({}))) as { redirect?: string }
    if (!j.redirect) throw new Error(`The server didn't approve the sign-in (${r.status}).`)
    handleCallback(j.redirect)
  } catch (e) {
    const p = pending
    pending = undefined
    p?.reject(e as Error)
  }
}

/** Opens the browser to approve; resolves once signed in, or null if cancelled. */
export async function signIn(): Promise<Profile | null> {
  cancelSignIn()
  const verifier = b64url(randomBytes(32))
  const state = b64url(randomBytes(16))
  let callback: string
  try {
    callback = await new Promise<string>((resolve, reject) => {
      pending = { state, verifier, resolve, reject }
      openAuthorizePage(authorizeURL(state, challengeFor(verifier)))
    })
  } catch (e) {
    if (e instanceof Cancelled) return null
    throw e
  }
  const params = new URL(callback.replace(`${PROTOCOL}://`, "https://callback.local/")).searchParams
  if (params.get("state") !== state) throw new Error("Sign-in didn't match. Try again.")
  const code = params.get("code")
  if (params.get("error") || !code) return null
  await exchange(code, verifier)
  return profile
}

/** axedesktop:// links the OS opens us with. True when it finished a sign-in. */
export function handleCallback(url: string): boolean {
  if (!url.startsWith(REDIRECT_URI) || !pending) return false
  const p = pending
  pending = undefined
  p.resolve(url)
  return true
}

export function cancelSignIn() {
  const p = pending
  pending = undefined
  p?.reject(new Cancelled())
}

async function exchange(code: string, verifier: string) {
  const res = await fetch(joinURL(settings().baseURL, "api/auth/desktop/token"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: REDIRECT_URI }),
  })
  if (!res.ok) throw await AxeClient.error(res)
  const json = (await res.json()) as { token?: string }
  if (!json.token) throw new Error("The server didn't send a session.")
  token = json.token
  store.write(token)
  await refresh()
  for (const l of signedInListeners) l()
}

/** Ends the session. `server` is the server that issued it (after a server change, the old one). */
export function signOut(server = settings().baseURL) {
  const t = token
  if (t) void fetch(joinURL(server, "api/auth/logout"), { method: "POST", headers: { Authorization: `Bearer ${t}` } }).catch(() => {})
  token = undefined
  profile = null
  store.clear()
  rmSync(profileFile(), { force: true })
  emit("account", null)
  for (const l of signedOutListeners) l()
}

/** Loads email, plan and credits. Signs out if the session was revoked. */
export async function refresh(): Promise<Profile | null> {
  if (!token) return null
  try {
    const c = client()
    const me = await c.json<{ profile?: { id?: string; email?: string; name?: string; image?: string } }>("api/account/me")
    const user = me?.profile ?? {}
    const p: Profile = { email: user.email ?? "" }
    if (user.id) p.id = user.id
    if (user.name) p.name = user.name
    if (user.image) p.image = user.image.startsWith("/") ? c.url(user.image) : user.image
    try {
      const s = await c.json<{ plan?: string; balance?: { available?: number } }>("api/billing/summary")
      if (s?.plan) p.plan = s.plan.charAt(0).toUpperCase() + s.plan.slice(1)
      if (typeof s?.balance?.available === "number") p.credits = s.balance.available
    } catch {}
    profile = p
    writeJSON(profileFile(), p)
    emit("account", p)
  } catch (e) {
    if (e instanceof AxeError && e.signedOut) signOut()
    else throw e
  }
  return profile
}

/** Called when any request finds the session gone. */
export function sessionEnded(e: unknown) {
  if (e instanceof AxeError && e.signedOut && token) signOut()
}

export const billingURL = () => joinURL(settings().baseURL, "billing")

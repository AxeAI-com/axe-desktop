import { b64u } from "@shared/remote-crypto"
import { type ClickMac, clickRespond, type CodeHello, codeRespond, type MacOffer, newOffer, newPairCode, PAIR_CODE_MS } from "@shared/remote-pake"
import {
  type AllowedPhone,
  cleanName,
  type DeviceKeys,
  deviceId,
  makePairAnswer,
  newQR,
  openPairRequest,
  PAIRING_GRACE_MS,
  type PublicKeys,
  qrLink,
  signAllowed,
  verifyAllowed,
} from "@shared/remote-pairing"
import type { PhonesView } from "@shared/types"

// Phones allowed to use this computer (remote control, step 2: pairing). Threat model:
// docs/remote-control-SECURITY.md. The QR holds this computer's public keys and a one-time secret
// that only travels by camera; a phone proves it saw it, you press Allow, and the phone joins a list
// signed by this computer's key. axeai.com only passes the sealed messages along: it can remove a
// phone (it stops routing to it) but can never add one. No Electron here, so tests run it as is.

/** A phone not used for this long drops off the list . */
export const UNUSED_PHONE_MS = 60 * 24 * 3600_000

type Saved = { entry: AllowedPhone; sig: string; lastUsedAt: number }
export type SavedPhones = { phones: Saved[] }

export type PhonesHost = {
  /** This computer's device keys, or undefined when the OS has no secret store (then pairing is off). */
  keys(): Promise<{ keys: DeviceKeys; pub: PublicKeys } | undefined>
  /** The signed-in Axe account, which a QR is bound to. */
  userId(): string | undefined
  enabled(): boolean
  macName(): string
  /** https://axeai.com, or the dev server. */
  origin(): string
  /** "Connect David's iPhone?" Allow or Not me (80 seconds, then no). */
  ask(phone: { name: string; agent: string }): Promise<boolean>
  load(): SavedPhones
  save(saved: SavedPhones): void
  emit(view: PhonesView): void
  now(): number
  /** Phones with a live sealed session now (link.ts). */
  live?(): string[]
  /** Turns "Let my browsers and phones use this computer" on: showing a code or a QR, or pressing Allow. */
  turnOn(): void
  /**
   * "Allow Chrome on Mac to use David's Mac?" with the check number ("123 456"), Allow or Not me
   * (80 seconds, then no). Only a click gets here, and only after the browser's reveal opened.
   */
  askClick(ask: { browser: string; computer: string; check: string }): Promise<boolean>
  /** "Chrome on Mac can now use this Mac": a pairing you approved by typing its code. */
  notice(text: string): void
  /** Tells axeai.com a code is on screen (offer and expiry only, never the code), or that it's gone. */
  postCode(offer: MacOffer, expiresAt: string): Promise<void>
  dropCode(): Promise<void>
}

/** Wrong guesses allowed in this long, without a success in between. */
export const CODE_TRIES = 5
export const CODE_TRIES_MS = 15 * 60_000
/** A click waits this long for its reveal; at most this many wait, and this many are answered per window. */
export const CLICK_WAIT_MS = 3 * 60_000
export const CLICKS_WAITING = 3
export const CLICK_ASKS = 5

/** "123456" as "123 456". */
export const groupDigits = (d: string) => `${d.slice(0, 3)} ${d.slice(3)}`

/** What the Settings screen shows for a code: the digits, or why there are none. */
export type CodeView = { code: string; expiresAt: number } | { code: null; blockedUntil: number }

export class Phones {
  private saved: SavedPhones = { phones: [] }
  private loaded: Promise<void> | undefined
  /** The QR secrets still live: the one on screen, and the one before it for a scan on its way. */
  private secrets: { s: string; exp: number; /** Typing the code, or pressing Allow, was the approval. */ approved?: boolean }[] = []
  /** The code on screen: only this computer knows it. One try, then it's gone. */
  private code: { code: string; exp: number; offer: MacOffer } | undefined
  private codeOpen = false
  /** When each try at a code happened since the last pairing. */
  private tries: number[] = []
  private clicks = new Map<string, { mac: ClickMac; browser: string; exp: number }>()
  private clickAsks: number[] = []
  private clickAsking = false
  private shown: { link: string; expiresAt: number } | undefined
  private asking = false

  constructor(private host: PhonesHost) {}

  /** Reads the saved list and keeps only entries this computer signed and that are still in use. */
  private ready() {
    this.loaded ??= (async () => {
      const k = await this.host.keys()
      if (!k) {
        // No keys this run (no secret store, a locked keyring): show no phones, but keep the saved list,
        // and look again next time.
        this.saved = { phones: [] }
        this.loaded = undefined
        return
      }
      const raw = this.host.load().phones ?? []
      const kept: Saved[] = []
      for (const p of raw) if (await verifyAllowed(k.pub, p.entry, p.sig)) kept.push(p)
      this.saved = { phones: kept }
      if (kept.length !== raw.length) this.host.save(this.saved)
      this.prune()
    })()
    return this.loaded
  }

  async view(): Promise<PhonesView> {
    await this.ready()
    const k = await this.host.keys()
    return {
      available: !!k,
      enabled: this.host.enabled(),
      macId: k ? await deviceId(k.pub.ed) : null,
      phones: this.saved.phones.map((p) => ({
        id: p.entry.phone,
        ...deviceName(p.entry),
        addedAt: p.entry.addedAt,
        lastUsedAt: p.lastUsedAt,
        connected: this.host.live?.().includes(p.entry.phone) ?? false,
      })),
    }
  }

  private async publish() {
    this.host.emit(await this.view())
  }

  /** The QR to show now: the same one until it runs out, then a new one. Undefined when pairing can't happen. */
  async qr(): Promise<{ link: string; expiresAt: number } | undefined> {
    const now = this.host.now()
    this.secrets = this.secrets.filter((x) => x.exp + PAIRING_GRACE_MS > now)
    const userId = this.host.userId()
    const k = await this.host.keys()
    if (!this.host.enabled() || !userId || !k) return undefined
    if (this.shown && this.shown.expiresAt > now) return this.shown
    const qr = await newQR({ keys: k.pub, name: this.host.macName(), userId, now })
    this.secrets.push({ s: qr.s, exp: qr.exp })
    this.shown = { link: qrLink(this.host.origin(), qr), expiresAt: qr.exp }
    return this.shown
  }

  /** Drops every live QR (turned off, signed out). */
  forgetQR() {
    this.secrets = []
    this.shown = undefined
    this.clicks.clear()
    this.closeCode()
  }

  /** The QR and the code for Settings. Showing either turns pairing on. */
  async pairing(): Promise<{ link: string; expiresAt: number; code: CodeView } | undefined> {
    const k = await this.host.keys()
    if (!k || !this.host.userId()) return undefined
    this.host.turnOn()
    const qr = await this.qr()
    if (!qr) return undefined
    return { ...qr, code: (await this.codeFor()) ?? { code: null, blockedUntil: 0 } }
  }

  /** Too many tries without a success: no codes until the oldest try is 15 minutes old. */
  private blockedUntil(now: number): number | undefined {
    this.tries = this.tries.filter((t) => now - t < CODE_TRIES_MS)
    return this.tries.length >= CODE_TRIES ? (this.tries[0] ?? now) + CODE_TRIES_MS : undefined
  }

  /** The 6-digit code to show now: the same one until it's used or runs out, then a new one. */
  async codeFor(): Promise<CodeView | undefined> {
    // One at a time, so two callers can't make two codes and show the one that isn't live.
    this.making ??= this.makeCode().finally(() => {
      this.making = undefined
    })
    return this.making
  }

  private making: Promise<CodeView | undefined> | undefined

  private async makeCode(): Promise<CodeView | undefined> {
    const userId = this.host.userId()
    const k = await this.host.keys()
    if (!userId || !k) return undefined
    this.host.turnOn()
    this.codeOpen = true
    const now = this.host.now()
    const blocked = this.blockedUntil(now)
    if (blocked) return { code: null, blockedUntil: blocked }
    if (this.code && this.code.exp > now) return { code: this.code.code, expiresAt: this.code.exp }
    const code = { code: newPairCode(), exp: now + PAIR_CODE_MS, offer: await newOffer({ keys: k.pub, name: this.host.macName(), userId }) }
    this.code = code
    void this.host.postCode(code.offer, new Date(code.exp).toISOString()).catch(() => {})
    return { code: code.code, expiresAt: code.exp }
  }

  /** The code screen closed, or the code was used: axeai.com stops offering it. */
  closeCode() {
    this.codeOpen = false
    if (!this.code) return
    this.code = undefined
    void this.host.dropCode().catch(() => {})
  }

  /** The link to axeai.com is back: it forgot what was on screen, so say so again. */
  async linkUp() {
    const c = this.code
    if (c && c.exp > this.host.now()) await this.host.postCode(c.offer, new Date(c.exp).toISOString()).catch(() => {})
  }

  /**
   * A browser's first message for the code on screen (event pair-code). The code is burned before
   * anything else, so a wrong guess costs it; the answer is null when no code is live.
   */
  async onPairCode(hello: CodeHello): Promise<{ y: string } | null> {
    const now = this.host.now()
    const live = this.code
    if (!live || live.exp <= now) return null
    this.code = undefined
    void this.host.dropCode().catch(() => {})
    this.tries.push(now)
    let reply: { y: string } | null = null
    try {
      const r = await codeRespond({ offer: live.offer, code: live.code, hello })
      this.secrets.push({ s: b64u(r.secret), exp: this.host.now() + PAIR_CODE_MS, approved: true })
      reply = r.reply
    } catch {}
    // A new code if the screen is still open and there are tries left.
    if (this.codeOpen) await this.codeFor()
    void this.publish()
    return reply
  }

  /**
   * A browser asks for one click (event pair-click): keep our half for 3 minutes and answer at once. Nothing
   * is shown until its reveal arrives and opens the commitment.
   */
  async onPairClick(id: string, browser: string, commit: { c: string }): Promise<{ half: { y: string; n: string }; offer: MacOffer } | null> {
    const now = this.host.now()
    for (const [k, v] of this.clicks) if (v.exp <= now) this.clicks.delete(k)
    this.clickAsks = this.clickAsks.filter((t) => now - t < CODE_TRIES_MS)
    const userId = this.host.userId()
    const k = await this.host.keys()
    // With pairing off nothing pops up: a click needs pairing on or the pairing screen open.
    if (!this.host.enabled() && !this.codeOpen) return null
    if (!userId || !k || this.clicks.size >= CLICKS_WAITING || this.clickAsks.length >= CLICK_ASKS) return null
    this.clickAsks.push(now)
    try {
      const offer = await newOffer({ keys: k.pub, name: this.host.macName(), userId })
      const mac = clickRespond({ offer, commit })
      this.clicks.set(id, { mac, browser: cleanName(browser).slice(0, 80) || "A browser", exp: now + CLICK_WAIT_MS })
      return { half: mac.half, offer }
    } catch {
      return null
    }
  }

  /**
   * The browser opened its commitment (event pair-click-reveal): show the check number and ask. A reveal
   * that doesn't open the commitment, or came too late, is a plain no and shows nothing.
   */
  async onPairClickReveal(pairId: string, reveal: { y: string; n: string }): Promise<boolean> {
    const click = this.clicks.get(pairId)
    this.clicks.delete(pairId)
    if (!click || click.exp <= this.host.now() || this.clickAsking) return false
    this.clickAsking = true
    try {
      const opened = await click.mac.open(reveal)
      const ok = await this.host.askClick({ browser: click.browser, computer: this.host.macName(), check: groupDigits(opened.check) })
      if (!ok) return false
      this.secrets.push({ s: b64u(opened.secret), exp: this.host.now() + PAIR_CODE_MS, approved: true })
      this.host.turnOn()
      return true
    } catch {
      return false
    } finally {
      this.clickAsking = false
    }
  }

  /**
   * A sealed pairing request from axeai.com. Undefined (and nothing shown) unless it proves a live QR;
   * otherwise asks you once, and returns the sealed answer plus, when allowed, what the server may list.
   */
  async request(sealed: string): Promise<{ sealed: string; allowed?: { phone: string; name: string } } | undefined> {
    await this.ready()
    const k = await this.host.keys()
    if (!k || !this.host.enabled() || this.asking) return undefined
    // One request at a time, from opening it to your answer: set before the first await, so two
    // requests for the same code can't both get through.
    this.asking = true
    let opened: Awaited<ReturnType<typeof openPairRequest>>
    let ok = false
    let approved = false
    try {
      const now = this.host.now()
      const live = this.secrets.filter((x) => x.exp + PAIRING_GRACE_MS > now).map((x) => x.s)
      try {
        opened = await openPairRequest({ sealed, keys: k.keys, pub: k.pub, secrets: live, now })
      } catch {
        return undefined
      }
      // Still live after opening (not used, not revoked by turning it off or signing out)?
      const used = this.secrets.find((x) => x.s === opened.secret)
      if (!used) return undefined
      // Each code works once, whatever you answer; the next one is new.
      this.secrets = this.secrets.filter((x) => x.s !== opened.secret)
      this.shown = undefined
      void this.publish()
      // A typed code or a pressed Allow already was the approval: no second question.
      approved = used.approved === true
      ok = approved ? true : await this.host.ask({ name: opened.phone.name, agent: opened.phone.agent })
    } finally {
      this.asking = false
    }
    const answeredAt = this.host.now()
    if (ok) {
      this.tries = []
      const { at: _sent, ...phone } = opened.phone
      const entry: AllowedPhone = { ...phone, addedAt: answeredAt }
      const sig = await signAllowed(k.keys, k.pub, entry)
      this.saved.phones = [...this.saved.phones.filter((p) => p.entry.phone !== entry.phone), { entry, sig, lastUsedAt: answeredAt }]
      this.host.save(this.saved)
      void this.publish()
      if (approved) this.host.notice(`${opened.phone.agent || opened.phone.name} can now use this Mac`)
    }
    const answer = await makePairAnswer({ phone: opened.phone, secret: opened.secret, keys: k.keys, pub: k.pub, ok, now: answeredAt })
    return { sealed: answer, ...(ok ? { allowed: { phone: opened.phone.phone, name: opened.phone.name } } : {}) }
  }

  /** The allowed phone with this id, if it's still on the list. */
  async phone(id: string): Promise<AllowedPhone | undefined> {
    await this.ready()
    // The 60-day rule holds in an app that stays open for months too, not only at launch.
    this.prune()
    const entry = this.saved.phones.find((p) => p.entry.phone === id)?.entry
    return entry && { ...entry, ...deviceName(entry) }
  }

  /** A phone was used: it stays on the list another 60 days. */
  async touch(id: string) {
    await this.ready()
    const p = this.saved.phones.find((x) => x.entry.phone === id)
    if (!p) return
    p.lastUsedAt = this.host.now()
    this.host.save(this.saved)
  }

  async remove(id: string) {
    await this.ready()
    const before = this.saved.phones.length
    this.saved.phones = this.saved.phones.filter((p) => p.entry.phone !== id)
    if (this.saved.phones.length === before) return false
    this.host.save(this.saved)
    void this.publish()
    return true
  }

  /** The phones axeai.com still routes to. Any other one was removed there (or never reached it): drop it. */
  async keepOnly(ids: string[]) {
    await this.ready()
    const keep = new Set(ids)
    const gone = this.saved.phones.filter((p) => !keep.has(p.entry.phone)).map((p) => p.entry.phone)
    for (const id of gone) await this.remove(id)
    return gone
  }

  /** Drops phones unused for 60 days. */
  prune() {
    const cutoff = this.host.now() - UNUSED_PHONE_MS
    const before = this.saved.phones.length
    this.saved.phones = this.saved.phones.filter((p) => p.lastUsedAt > cutoff)
    if (this.saved.phones.length !== before) this.host.save(this.saved)
  }
}

/**
 * How a paired device is named on this computer. Browsers paired before 2026-11-15 were saved as a
 * "phone" whenever they weren't an iPhone, iPad or Android ("Ranger's phone", "Chrome on phone"):
 * those are browsers on a computer, so they read "Chrome on Ranger's computer". The saved entry is
 * signed, so it stays as it was; only the name shown changes.
 */
export function deviceName(p: { name: string; agent: string }): { name: string; agent: string } {
  const browser = /^(.+) on phone$/.exec(p.agent)?.[1]
  if (!browser) return { name: p.name, agent: p.agent }
  const owner = /^(.+)'s phone$/.exec(p.name)?.[1]
  return { name: owner ? `${browser} on ${owner}'s computer` : `${browser} on a computer`, agent: `${browser} on a computer` }
}

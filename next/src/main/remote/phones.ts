import {
  type AllowedPhone,
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
}

export class Phones {
  private saved: SavedPhones = { phones: [] }
  private loaded: Promise<void> | undefined
  /** The QR secrets still live: the one on screen, and the one before it for a scan on its way. */
  private secrets: { s: string; exp: number }[] = []
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
        name: p.entry.name,
        agent: p.entry.agent,
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
    try {
      const now = this.host.now()
      const live = this.secrets.filter((x) => x.exp + PAIRING_GRACE_MS > now).map((x) => x.s)
      try {
        opened = await openPairRequest({ sealed, keys: k.keys, pub: k.pub, secrets: live, now })
      } catch {
        return undefined
      }
      // Still live after opening (not used, not revoked by turning it off or signing out)?
      if (!this.secrets.some((x) => x.s === opened.secret)) return undefined
      // Each code works once, whatever you answer; the next one is new.
      this.secrets = this.secrets.filter((x) => x.s !== opened.secret)
      this.shown = undefined
      void this.publish()
      ok = await this.host.ask({ name: opened.phone.name, agent: opened.phone.agent })
    } finally {
      this.asking = false
    }
    const answeredAt = this.host.now()
    if (ok) {
      const { at: _sent, ...phone } = opened.phone
      const entry: AllowedPhone = { ...phone, addedAt: answeredAt }
      const sig = await signAllowed(k.keys, k.pub, entry)
      this.saved.phones = [...this.saved.phones.filter((p) => p.entry.phone !== entry.phone), { entry, sig, lastUsedAt: answeredAt }]
      this.host.save(this.saved)
      void this.publish()
    }
    const answer = await makePairAnswer({ phone: opened.phone, secret: opened.secret, keys: k.keys, pub: k.pub, ok, now: answeredAt })
    return { sealed: answer, ...(ok ? { allowed: { phone: opened.phone.phone, name: opened.phone.name } } : {}) }
  }

  /** The allowed phone with this id, if it's still on the list. */
  async phone(id: string): Promise<AllowedPhone | undefined> {
    await this.ready()
    // The 60-day rule holds in an app that stays open for months too, not only at launch.
    this.prune()
    return this.saved.phones.find((p) => p.entry.phone === id)?.entry
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

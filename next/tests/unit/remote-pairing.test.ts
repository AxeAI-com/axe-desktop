import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  type AllowedPhone,
  accountTag,
  type Bytes,
  b64u,
  checkQR,
  type DeviceKeys,
  deviceId,
  fromB64u,
  generateDeviceKeys,
  helloFor,
  makePairAnswer,
  makePairRequest,
  newQR,
  openPairAnswer,
  openPairRequest,
  PAIRING_GRACE_MS,
  PAIRING_SECRET_MS,
  type PairingQR,
  parseQR,
  publicKeys,
  qrLink,
  seal,
  signAllowed,
  verifyAllowed,
} from "@shared/remote-pairing"

// Pairing a phone with the desktop app (axe-mac docs/remote-control-SECURITY.md). The same file and
// vectors live in axe-mac next/src/shared: the vectors test proves both copies agree.

const NOW = 1_793_000_000_000
const USER = "user-1"

async function setup() {
  const mac = await generateDeviceKeys(true)
  const macPub = await publicKeys(mac)
  const phone = await generateDeviceKeys(false)
  const qr = await newQR({ keys: macPub, name: "David's Mac", userId: USER, now: NOW })
  return { mac, macPub, phone, qr }
}

const pair = async (qr: PairingQR, phone: DeviceKeys, now = NOW) =>
  makePairRequest({ qr, keys: phone, name: "David's iPhone", agent: "Safari on iPhone", now })

const reject = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toMatchObject({ code })
}

describe("pairing a phone", () => {
  it("pairs end to end: the phone proves the QR, the Mac's answer proves the Mac", async () => {
    const { mac, macPub, phone, qr } = await setup()
    expect(parseQR(qrLink("https://axeai.com", qr))).toEqual(qr)
    expect(await checkQR(qr, USER, NOW)).toBeUndefined()

    const req = await pair(qr, phone)
    expect(req.mac).toBe(qr.mac)
    const opened = await openPairRequest({
      sealed: req.sealed,
      keys: mac,
      pub: macPub,
      secrets: [qr.s],
      now: NOW + 3_000,
    })
    expect(opened.secret).toBe(qr.s)
    expect(opened.phone).toMatchObject({
      phone: req.phone,
      name: "David's iPhone",
      agent: "Safari on iPhone",
    })

    const answer = await makePairAnswer({
      phone: opened.phone,
      secret: opened.secret,
      keys: mac,
      pub: macPub,
      ok: true,
      now: NOW + 9_000,
    })
    const hello = await helloFor({ keys: phone, name: "David's iPhone", agent: "Safari on iPhone", at: NOW })
    expect(await openPairAnswer({ sealed: answer, qr, keys: phone, hello })).toBe(true)

    const declined = await makePairAnswer({
      phone: opened.phone,
      secret: opened.secret,
      keys: mac,
      pub: macPub,
      ok: false,
      now: NOW + 9_000,
    })
    expect(await openPairAnswer({ sealed: declined, qr, keys: phone, hello })).toBe(false)
  })

  it("ids come from keys", async () => {
    const { macPub, qr } = await setup()
    expect(qr.mac).toBe(await deviceId(macPub.ed))
    expect(qr.mac).toHaveLength(22)
  })

  it("the phone refuses a QR from another account, an old QR, or one whose id isn't its key's", async () => {
    const { qr } = await setup()
    expect(await checkQR(qr, "someone-else", NOW)).toBe("other_account")
    expect(await checkQR(qr, USER, NOW + PAIRING_SECRET_MS + PAIRING_GRACE_MS + 1)).toBe("expired")
    const stranger = await publicKeys(await generateDeviceKeys(true))
    expect(await checkQR({ ...qr, ed: stranger.ed }, USER, NOW)).toBe("bad_qr")
  })

  it("rejects text that isn't our QR", () => {
    expect(parseQR("https://example.com")).toBeUndefined()
    expect(parseQR("https://axeai.com/connect#not-json")).toBeUndefined()
    expect(parseQR(`#${b64u(new TextEncoder().encode(JSON.stringify({ v: 2 })))}`)).toBeUndefined()
  })

  it("a used or unknown secret never reaches a dialog", async () => {
    const { mac, macPub, phone, qr } = await setup()
    const req = await pair(qr, phone)
    const other = b64u(crypto.getRandomValues(new Uint8Array(32)))
    await reject(
      openPairRequest({ sealed: req.sealed, keys: mac, pub: macPub, secrets: [other], now: NOW }),
      "wrong_secret",
    )
    await reject(
      openPairRequest({ sealed: req.sealed, keys: mac, pub: macPub, secrets: [], now: NOW }),
      "wrong_secret",
    )
  })

  it("a server that tampers with the sealed request is caught", async () => {
    const { mac, macPub, phone, qr } = await setup()
    const req = await pair(qr, phone)
    const bytes = fromB64u(req.sealed)
    for (const at of [0, 40, bytes.length - 1]) {
      const bad = bytes.slice()
      bad[at] = (bad[at] ?? 0) ^ 1
      await reject(
        openPairRequest({ sealed: b64u(bad), keys: mac, pub: macPub, secrets: [qr.s], now: NOW }),
        "bad_box",
      )
    }
  })

  it("a server that swaps in its own phone key can't prove the secret", async () => {
    const { mac, macPub, qr } = await setup()
    const attacker = await generateDeviceKeys(true)
    // The server knows everything in the QR except the secret.
    const guess = { ...qr, s: b64u(crypto.getRandomValues(new Uint8Array(32))) }
    const forged = await pair(guess, attacker)
    await reject(
      openPairRequest({ sealed: forged.sealed, keys: mac, pub: macPub, secrets: [qr.s], now: NOW }),
      "wrong_secret",
    )
  })

  it("a request signed by a different key than it names is refused", async () => {
    const { mac, macPub, phone, qr } = await setup()
    const other = await generateDeviceKeys(true)
    const otherPub = await publicKeys(other)
    const hello = {
      ...(await helloFor({ keys: phone, name: "David's iPhone", agent: "Safari on iPhone", at: NOW })),
    }
    // A body that claims another key but carries the phone's MAC and signature.
    const t = [
      "axe-rc v1 pair",
      qr.mac,
      qr.ed,
      qr.x,
      await deviceId(otherPub.ed),
      otherPub.ed,
      otherPub.x,
      hello.name,
      hello.agent,
      String(NOW),
    ].join("\n")
    const key = await crypto.subtle.importKey(
      "raw",
      fromB64u(qr.s) as Bytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const tag = b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t))))
    const sig = b64u(
      new Uint8Array(
        await crypto.subtle.sign({ name: "Ed25519" }, phone.sign.privateKey, new TextEncoder().encode(t)),
      ),
    )
    const body = {
      phone: await deviceId(otherPub.ed),
      ed: otherPub.ed,
      x: otherPub.x,
      name: hello.name,
      agent: hello.agent,
      at: NOW,
      mac: tag,
      sig,
    }
    const sealed = await seal(
      qr.x,
      new TextEncoder().encode(JSON.stringify(body)),
      "axe-rc v1 pair-request",
      `axe-rc v1 pair-request\n${qr.mac}`,
    )
    await reject(
      openPairRequest({ sealed, keys: mac, pub: macPub, secrets: [qr.s], now: NOW }),
      "bad_signature",
    )
  })

  it("a request from far in the past or future is refused", async () => {
    const { mac, macPub, phone, qr } = await setup()
    const req = await pair(qr, phone, NOW - 10 * 60_000)
    await reject(
      openPairRequest({ sealed: req.sealed, keys: mac, pub: macPub, secrets: [qr.s], now: NOW }),
      "clock",
    )
  })

  it("a request for another Mac doesn't open on this one", async () => {
    const { phone, qr } = await setup()
    const other = await generateDeviceKeys(true)
    const req = await pair(qr, phone)
    await reject(
      openPairRequest({
        sealed: req.sealed,
        keys: other,
        pub: await publicKeys(other),
        secrets: [qr.s],
        now: NOW,
      }),
      "bad_box",
    )
  })

  it("the phone refuses an answer the server made up", async () => {
    const { phone, qr } = await setup()
    const server = await generateDeviceKeys(true)
    const serverPub = await publicKeys(server)
    const hello = await helloFor({ keys: phone, name: "David's iPhone", agent: "Safari on iPhone", at: NOW })
    // Without the secret, and signed by the server's key: wrong secret.
    const fake = await makePairAnswer({
      phone: hello,
      secret: b64u(crypto.getRandomValues(new Uint8Array(32))),
      keys: server,
      pub: serverPub,
      ok: true,
      now: NOW,
    })
    await expect(openPairAnswer({ sealed: fake, qr, keys: phone, hello })).rejects.toThrow()
    // Even with the secret (say it photographed the QR), the Mac's signature is missing.
    const withSecret = await makePairAnswer({
      phone: hello,
      secret: qr.s,
      keys: server,
      pub: { ...serverPub, ed: qr.ed, x: qr.x },
      ok: true,
      now: NOW,
    })
    await reject(openPairAnswer({ sealed: withSecret, qr, keys: phone, hello }), "bad_signature")
  })

  it("names are one clean line", async () => {
    const { mac, macPub, phone, qr } = await setup()
    const req = await makePairRequest({
      qr,
      keys: phone,
      name: "David's\niPhone ",
      agent: "Safari",
      now: NOW,
    })
    const { phone: hello } = await openPairRequest({
      sealed: req.sealed,
      keys: mac,
      pub: macPub,
      secrets: [qr.s],
      now: NOW,
    })
    expect(hello.name).toBe("David's iPhone")
  })
})

describe("the allowed phones list", () => {
  it("only entries the Mac signed count", async () => {
    const mac = await generateDeviceKeys(true)
    const pub = await publicKeys(mac)
    const phonePub = await publicKeys(await generateDeviceKeys(false))
    const entry: AllowedPhone = {
      phone: await deviceId(phonePub.ed),
      ...phonePub,
      name: "David's iPhone",
      agent: "Safari on iPhone",
      addedAt: NOW,
    }
    const sig = await signAllowed(mac, pub, entry)
    expect(await verifyAllowed(pub, entry, sig)).toBe(true)
    expect(await verifyAllowed(pub, { ...entry, name: "Jack's iPhone" }, sig)).toBe(false)
    const strangerPub = await publicKeys(await generateDeviceKeys(false))
    expect(await verifyAllowed(pub, { ...entry, ed: strangerPub.ed }, sig)).toBe(false)
    const other = await generateDeviceKeys(true)
    expect(await verifyAllowed(await publicKeys(other), entry, sig)).toBe(false)
  })
})

describe("fixed vectors (the same in axe-web and axe-mac)", () => {
  const v = JSON.parse(readFileSync(new URL("./remote-pairing.vectors.json", import.meta.url), "utf8"))
  const load = async (sign: string, dh: string): Promise<DeviceKeys> => {
    const s = crypto.subtle
    const signPriv = await s.importKey("pkcs8", fromB64u(sign) as Bytes, { name: "Ed25519" }, true, ["sign"])
    const dhPriv = await s.importKey("pkcs8", fromB64u(dh) as Bytes, { name: "X25519" }, true, ["deriveBits"])
    // Public halves aren't needed to open or sign.
    return {
      sign: { privateKey: signPriv, publicKey: signPriv },
      dh: { privateKey: dhPriv, publicKey: dhPriv },
    }
  }

  it("derives the same ids and tags", async () => {
    expect(await deviceId(v.macPub.ed)).toBe(v.qr.mac)
    expect(await accountTag(USER, v.qr.mac)).toBe(v.qr.acct)
    expect(await deviceId(v.phonePub.ed)).toBe(v.req.phone)
  })

  it("opens the recorded request", async () => {
    const mac = await load(v.macSign, v.macDh)
    const opened = await openPairRequest({
      sealed: v.req.sealed,
      keys: mac,
      pub: v.macPub,
      secrets: [v.qr.s],
      now: v.now,
    })
    expect(opened.phone).toEqual({
      phone: v.req.phone,
      ...v.phonePub,
      name: "David's iPhone",
      agent: "Safari on iPhone",
      at: v.now,
    })
  })
})

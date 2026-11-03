import { existsSync, readFileSync, writeFileSync } from "node:fs"

import { safeStorage } from "electron"

import { b64u, type DeviceKeys, fromB64u, generateDeviceKeys, type PublicKeys, publicKeys } from "@shared/remote-pairing"

import { dataPath, isSelfTest } from "../paths"

// This computer's device keys for remote control (Ed25519 to sign, X25519 to agree keys), made on first
// use. The private halves are sealed by the OS (the Keychain on macOS) in remote-keys.bin and never
// leave this computer. Without a secret store there are no keys, and phones can't pair (fail closed).
// Self-tests keep a fresh pair in memory.

type Stored = { sign: string; dh: string; ed: string; x: string }

let cached: Promise<{ keys: DeviceKeys; pub: PublicKeys } | undefined> | undefined

const file = () => dataPath("remote-keys.bin")

const secretStore = () =>
  safeStorage.isEncryptionAvailable() && !(process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text")

async function load(): Promise<{ keys: DeviceKeys; pub: PublicKeys } | undefined> {
  if (isSelfTest()) {
    const keys = await generateDeviceKeys(true)
    return { keys, pub: await publicKeys(keys) }
  }
  if (!secretStore()) return undefined
  const s = crypto.subtle
  if (existsSync(file())) {
    try {
      const saved = JSON.parse(safeStorage.decryptString(readFileSync(file()))) as Stored
      const signPriv = await s.importKey("pkcs8", fromB64u(saved.sign) as BufferSource, { name: "Ed25519" }, false, ["sign"])
      const dhPriv = await s.importKey("pkcs8", fromB64u(saved.dh) as BufferSource, { name: "X25519" }, false, ["deriveBits"])
      const signPub = await s.importKey("raw", fromB64u(saved.ed) as BufferSource, { name: "Ed25519" }, true, ["verify"])
      const dhPub = await s.importKey("raw", fromB64u(saved.x) as BufferSource, { name: "X25519" }, true, [])
      return { keys: { sign: { privateKey: signPriv, publicKey: signPub }, dh: { privateKey: dhPriv, publicKey: dhPub } }, pub: { ed: saved.ed, x: saved.x } }
    } catch {
      // Unreadable now (Deny on the Keychain prompt, a locked keychain): no keys this time, and the file
      // stays, so the same keys come back once the Keychain opens. Never replace them on a failed read.
      return undefined
    }
  }
  const keys = await generateDeviceKeys(true)
  const pub = await publicKeys(keys)
  const stored: Stored = {
    sign: b64u(new Uint8Array(await s.exportKey("pkcs8", keys.sign.privateKey))),
    dh: b64u(new Uint8Array(await s.exportKey("pkcs8", keys.dh.privateKey))),
    ...pub,
  }
  writeFileSync(file(), safeStorage.encryptString(JSON.stringify(stored)), { mode: 0o600 })
  return { keys, pub }
}

/** The keys, made once per run. Undefined without a secret store, or while it can't be read (tried again next time). */
export function deviceKeys() {
  cached ??= load()
    .catch(() => undefined)
    .then((k) => {
      if (!k) cached = undefined
      return k
    })
  return cached
}

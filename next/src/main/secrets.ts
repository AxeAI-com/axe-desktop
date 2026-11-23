import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { safeStorage } from "electron"

import type { TokenStore } from "./axe/account"
import type { ConnectorSecret, SecretBox } from "./libraries/oauth"
import { dataPath, usesKeychain } from "./paths"

// The Axe session token, encrypted by the OS: the Keychain on macOS, DPAPI on
// Windows, the Secret Service (GNOME Keyring / KWallet) on Linux. Self-tests
// keep it in memory only.

const file = () => dataPath("session.bin")

// A saved sign-in the OS wouldn't open this run. On a Mac that means the Keychain said no: an update
// signed differently from the build that saved it (every ad-hoc build up to 0.13.0), and Deny or a
// dismissed prompt. Electron remembers the answer until the app restarts, so the window offers a
// restart (account:unlock) instead of looking signed out. The file stays, so the session comes back.
let unreadable = false
export const savedSessionUnreadable = () => unreadable

export const safeTokenStore: TokenStore = {
  read() {
    unreadable = false
    if (!usesKeychain() || !existsSync(file())) return undefined
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("No secret store")
      return safeStorage.decryptString(readFileSync(file()))
    } catch {
      // Linux without a secret store never writes the file, so only a store that said no lands here.
      unreadable = true
      return undefined
    }
  },
  /** False when the OS has no secret store (some minimal Linux desktops): then the token lives in memory only. */
  write(token) {
    if (!usesKeychain() || !safeStorage.isEncryptionAvailable()) return false
    if (process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text") return false
    writeFileSync(file(), safeStorage.encryptString(token), { mode: 0o600 })
    unreadable = false
    return true
  },
  clear() {
    rmSync(file(), { force: true })
    unreadable = false
  },
}

/**
 * Connector sign-ins (OAuth tokens, pasted tokens), encrypted the same way in connector-secrets.bin.
 * Self-tests and machines without a secret store fall back to libraries/index.ts's plain file in
 * the (temporary) data folder.
 */
export function connectorSecretBox(): SecretBox | undefined {
  if (!usesKeychain() || !safeStorage.isEncryptionAvailable()) return undefined
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text") return undefined
  const file = () => dataPath("connector-secrets.bin")
  const readAll = (): Record<string, ConnectorSecret> => {
    try {
      return existsSync(file()) ? (JSON.parse(safeStorage.decryptString(readFileSync(file()))) as Record<string, ConnectorSecret>) : {}
    } catch {
      return {}
    }
  }
  return {
    get: (id) => readAll()[id],
    set: (id, secret) => {
      const all = readAll()
      if (secret) all[id] = secret
      else delete all[id]
      writeFileSync(file(), safeStorage.encryptString(JSON.stringify(all)), { mode: 0o600 })
    },
  }
}

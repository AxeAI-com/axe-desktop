import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { safeStorage } from "electron"

import type { TokenStore } from "./axe/account"
import type { ConnectorSecret, SecretBox } from "./libraries/oauth"
import { dataPath, isSelfTest } from "./paths"

// The Axe session token, encrypted by the OS: the Keychain on macOS, DPAPI on
// Windows, the Secret Service (GNOME Keyring / KWallet) on Linux. Self-tests
// keep it in memory only.

const file = () => dataPath("session.bin")

export const safeTokenStore: TokenStore = {
  read() {
    if (isSelfTest()) return undefined
    try {
      if (!existsSync(file()) || !safeStorage.isEncryptionAvailable()) return undefined
      return safeStorage.decryptString(readFileSync(file()))
    } catch {
      return undefined
    }
  },
  /** False when the OS has no secret store (some minimal Linux desktops): then the token lives in memory only. */
  write(token) {
    if (isSelfTest() || !safeStorage.isEncryptionAvailable()) return false
    if (process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text") return false
    writeFileSync(file(), safeStorage.encryptString(token), { mode: 0o600 })
    return true
  },
  clear() {
    rmSync(file(), { force: true })
  },
}

/**
 * Connector sign-ins (OAuth tokens, pasted tokens), encrypted the same way in connector-secrets.bin.
 * Self-tests and machines without a secret store fall back to libraries/index.ts's plain file in
 * the (temporary) data folder.
 */
export function connectorSecretBox(): SecretBox | undefined {
  if (isSelfTest() || !safeStorage.isEncryptionAvailable()) return undefined
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

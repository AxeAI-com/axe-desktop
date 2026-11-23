import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// Where the engine keeps its files: Electron's userData folder (set by index.ts),
// or AXE_DATA_DIR for self-tests and unit tests.

let base: string | undefined

export function setDataDir(dir: string) {
  base = dir
}

export function dataDir(): string {
  const dir = process.env.AXE_DATA_DIR || base || join(homedir(), ".axe-desktop")
  mkdirSync(dir, { recursive: true })
  return dir
}

export function dataPath(...parts: string[]): string {
  return join(dataDir(), ...parts)
}

export function readJSON<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return fallback
  }
}

/** Writes through a temp file so a crash never leaves half a file. */
export function writeJSON(path: string, value: unknown) {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, path)
}

/** Unit tests and the self-test never touch the real keychain. */
export const isSelfTest = () => Boolean(process.env.AXE_SELFTEST_COOKIE) || process.env.AXE_SELFTEST === "1"

/**
 * Whether secrets go to the OS store. Self-tests keep them in memory, except a Keychain test
 * (AXE_KEYCHAIN_NAME, scripts/release-verify): it uses the real Keychain under its own item name
 * (index.ts renames the app before ready), so it never reads or changes the installed app's item.
 */
export const usesKeychain = () => !isSelfTest() || Boolean(process.env.AXE_KEYCHAIN_NAME)

/** Self-tests only: appends a line to AXE_STATUS_LOG (signed in, device id, remote online) for scripts to read. */
export function statusLog(line: string) {
  const file = process.env.AXE_STATUS_LOG
  if (!file || !isSelfTest()) return
  try {
    appendFileSync(file, `${line}\n`)
  } catch {}
}

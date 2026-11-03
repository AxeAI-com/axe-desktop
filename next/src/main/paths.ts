import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
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

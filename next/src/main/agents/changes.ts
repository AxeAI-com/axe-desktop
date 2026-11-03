import { createHash } from "node:crypto"
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

import type { FileChange } from "@shared/types"

import { dataPath, readJSON, writeJSON } from "../paths"

// What an agent changed in a chat, and how to put it back. Before the agent first
// changes a file in a turn, the file is saved here (userData/changes/<chat>/): its
// bytes by hash, or "wasn't there". Review lists every file that differs from how it
// was before the chat's first change to it (or since you last kept it); Undo writes
// that back. Rewind restores each file to how it was before the turn you go back to.
// None of this uses git: it works in any folder, and leaves the repo's history alone.

/** A saved copy: the hash of its bytes, or null for "the file wasn't there". */
type Saved = string | null

type Index = {
  /** How each file was before the agent first changed it (or when you last kept it). */
  baseline: Record<string, Saved>
  /** Per turn (your message's id): how each file it changed was before that turn. */
  turns: { messageId: string; files: Record<string, Saved> }[]
}

/** Text bigger than this shows as a file without a diff. */
const SHOW_LIMIT = 512 * 1024

export class ChangeTracker {
  private index: Index
  private pending = new Map<string, Promise<void>>()

  constructor(
    readonly threadId: string,
    private cwd: string,
  ) {
    this.index = readJSON<Index>(this.file("index.json"), { baseline: {}, turns: [] })
  }

  private file(...parts: string[]) {
    return dataPath("changes", this.threadId, ...parts)
  }

  private save() {
    mkdirSync(this.file(), { recursive: true })
    writeJSON(this.file("index.json"), this.index)
  }

  /** The folder moved (a chat that works in a copy): paths outside it are left alone. */
  setFolder(cwd: string) {
    this.cwd = cwd
  }

  /**
   * The file's real path when it is inside the chat's folder. Symlinks are resolved on both sides:
   * on a Mac, Claude Code names /var/folders/… files as /private/var/folders/….
   */
  private inside(path: string): string | undefined {
    const root = realish(this.cwd)
    const full = realish(isAbsolute(path) ? path : resolve(this.cwd, path))
    const rel = relative(root, full)
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? full : undefined
  }

  /** A new turn starts: the next change to each file saves it first. */
  beginTurn(messageId: string) {
    if (!this.index.turns.some((t) => t.messageId === messageId)) this.index.turns.push({ messageId, files: {} })
    this.save()
  }

  private get turn() {
    return this.index.turns[this.index.turns.length - 1]
  }

  /** Saves files before the agent changes them (once per turn). Files outside the chat's folder are skipped. */
  async capture(paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => this.captureOne(p)))
  }

  private captureOne(path: string): Promise<void> {
    const full = this.inside(path)
    const turn = this.turn
    if (!full || !turn || full in turn.files) return Promise.resolve()
    const key = `${turn.messageId}\0${full}`
    const running = this.pending.get(key)
    if (running) return running
    const job = (async () => {
      const bytes = await readFile(full).catch(() => null)
      this.record(turn, full, bytes)
    })().finally(() => this.pending.delete(key))
    this.pending.set(key, job)
    return job
  }

  /**
   * The agent changed a file without telling us first: work out how it was from the edit it
   * reports (old text swapped back for new). Only when the file holds the new text exactly once.
   */
  async recover(path: string, oldText: string | null | undefined, newText: string) {
    const full = this.inside(path)
    const turn = this.turn
    if (!full || !turn || full in turn.files) return
    const now = await readFile(full, "utf8").catch(() => null)
    let before: Buffer | null
    if (oldText == null) before = null
    else if (now !== null && now.split(newText).length === 2) before = Buffer.from(now.replace(newText, oldText), "utf8")
    else return
    this.record(turn, full, before)
  }

  private record(turn: Index["turns"][number], full: string, bytes: Buffer | null) {
    if (full in turn.files) return
    const saved = bytes ? this.store(bytes) : null
    turn.files[full] = saved
    if (!(full in this.index.baseline)) this.index.baseline[full] = saved
    this.save()
  }

  private store(bytes: Buffer): string {
    const hash = createHash("sha256").update(bytes).digest("hex")
    const path = this.file("blobs", hash)
    if (!existsSync(path)) {
      // Through a temp name, so a crash never leaves half a copy.
      mkdirSync(dirname(path), { recursive: true })
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, bytes)
      renameSync(tmp, path)
    }
    return hash
  }

  private async load(saved: Saved): Promise<Buffer | null> {
    return saved ? readFile(this.file("blobs", saved)) : null
  }

  private async put(full: string, saved: Saved) {
    const bytes = await this.load(saved)
    if (bytes) {
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, bytes)
    } else await rm(full, { force: true })
  }

  /** Every file that differs from how it was before the agent changed it. */
  async list(): Promise<FileChange[]> {
    const out: FileChange[] = []
    for (const [full, saved] of Object.entries(this.index.baseline)) {
      const [before, after] = await Promise.all([this.load(saved).catch(() => null), readFile(full).catch(() => null)])
      if (before === after || (before && after && before.equals(after))) continue
      const binary = [before, after].some((b) => b && (b.length > SHOW_LIMIT || b.includes(0)))
      // A binary file shows no text, but still says whether it came, went or changed ("" vs null).
      const text = (b: Buffer | null) => (!b ? null : binary ? "" : b.toString("utf8"))
      out.push({ path: full, rel: relative(realish(this.cwd), full), before: text(before), after: text(after), ...(binary ? { binary: true } : {}) })
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel))
  }

  private pick(paths: string[] | null): string[] {
    const all = Object.keys(this.index.baseline)
    return paths ? all.filter((p) => paths.includes(p)) : all
  }

  /** Keep files as they are now: they leave the list until the agent changes them again. */
  async keep(paths: string[] | null) {
    for (const full of this.pick(paths)) {
      const bytes = await readFile(full).catch(() => null)
      this.index.baseline[full] = bytes ? this.store(bytes) : null
    }
    this.save()
  }

  /** Puts files back as they were before the agent first changed them. */
  async undo(paths: string[] | null) {
    for (const full of this.pick(paths)) await this.put(full, this.index.baseline[full] ?? null)
  }

  /** The turns from this message on, or undefined when it isn't one of this chat's turns. */
  private from(messageId: string) {
    const i = this.index.turns.findIndex((t) => t.messageId === messageId)
    return i < 0 ? undefined : i
  }

  /** How each file was before that turn: the oldest copy saved from that turn on. */
  private restorePoints(messageId: string): Map<string, Saved> {
    const points = new Map<string, Saved>()
    const i = this.from(messageId)
    if (i === undefined) return points
    for (const t of this.index.turns.slice(i)) for (const [full, saved] of Object.entries(t.files)) if (!points.has(full)) points.set(full, saved)
    return points
  }

  /** How many files rewinding to this message would put back (ones that differ now). */
  async rewindCount(messageId: string): Promise<number> {
    let n = 0
    for (const [full, saved] of this.restorePoints(messageId)) {
      const [then, now] = await Promise.all([this.load(saved).catch(() => null), readFile(full).catch(() => null)])
      if (!(then === now || (then && now && then.equals(now)))) n++
    }
    return n
  }

  /** Goes back to before this message: files (when asked) as they were then, and the later turns forgotten. */
  async rewind(messageId: string, files: boolean) {
    const i = this.from(messageId)
    if (i === undefined) return
    if (files) for (const [full, saved] of this.restorePoints(messageId)) await this.put(full, saved)
    this.index.turns = this.index.turns.slice(0, i)
    this.save()
  }

  /** The chat is gone: so are its saved files. */
  remove() {
    rmSync(this.file(), { recursive: true, force: true })
  }
}

/** A path with symlinks resolved, through its nearest existing parent when it doesn't exist (yet, or any more). */
function realish(path: string): string {
  let probe = resolve(path)
  let rest = ""
  for (;;) {
    try {
      const real = realpathSync(probe)
      return rest ? join(real, rest) : real
    } catch {
      const parent = dirname(probe)
      if (parent === probe) return resolve(path)
      rest = rest ? join(basename(probe), rest) : basename(probe)
      probe = parent
    }
  }
}

const trackers = new Map<string, ChangeTracker>()

/** The tracker for a chat (one per chat, made on first use). */
export function trackerFor(threadId: string, cwd: string): ChangeTracker {
  let t = trackers.get(threadId)
  if (!t) {
    t = new ChangeTracker(threadId, cwd)
    trackers.set(threadId, t)
  } else t.setFolder(cwd)
  return t
}

export function forgetTracker(threadId: string) {
  trackers.get(threadId)?.remove()
  trackers.delete(threadId)
  rmSync(dataPath("changes", threadId), { recursive: true, force: true })
}

/** Tests only. */
export function resetTrackersForTests() {
  trackers.clear()
}

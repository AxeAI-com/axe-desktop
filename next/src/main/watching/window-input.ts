import { homedir } from "node:os"

import { cleanTarget } from "@shared/watching/target"
import { type Draft, KINDS, type WatchPatch } from "@shared/watching/types"

// What the window sends to start or change a watch, checked here: the window never sets a watch's
// kind on an edit, or a command to run.

/**
 * A plan the window sends back to start: its kind and target are checked again, and it never brings
 * its own command (only a draft made here sets one).
 */
export function fromWindow(dr: Draft): Draft {
  if (!dr || typeof dr !== "object" || !KINDS.includes(dr.kind) || typeof dr.target !== "string") throw new Error("That isn't a watch.")
  const target = cleanTarget(dr.kind, dr.target, homedir())
  if (!target) throw new Error("That isn't a watch.")
  if (dr.limit !== undefined && (typeof dr.limit !== "number" || !Number.isFinite(dr.limit) || dr.limit <= 0)) throw new Error("That limit isn't a number.")
  if (dr.field !== undefined && (typeof dr.field !== "string" || dr.field.length > 200)) throw new Error("That field isn't valid.")
  const { command: _command, ...rest } = dr
  return { ...rest, target }
}

const isText = (max: number) => (v: unknown) => typeof v === "string" && v.length <= max
const isNumber = (min: number) => (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= min
/** The keys the window may change on a watch, each with its check. Never its kind or command. */
const PATCH: { [K in keyof Required<WatchPatch>]: (v: unknown) => boolean } = {
  target: isText(2000),
  every: isText(20),
  notify: isText(20),
  answerer: (v) => !!v && typeof v === "object" && typeof (v as { kind?: unknown }).kind === "string",
  name: isText(200),
  paused: (v) => typeof v === "boolean",
  snoozedUntil: isNumber(0),
  folder: isText(1000),
  condition: isText(2000),
  fixedMs: isNumber(0),
  ignore: (v) => Array.isArray(v) && v.length <= 500 && v.every(isText(500)),
  limit: (v) => isNumber(0)(v) && (v as number) > 0,
}

/** A change the window sends to a watch: only the keys in PATCH, each checked (undefined clears it). */
export function patchFromWindow(patch: unknown): WatchPatch {
  if (!patch || typeof patch !== "object") throw new Error("That isn't a change to a watch.")
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.hasOwn(PATCH, k)) continue
    if (v !== undefined && !PATCH[k as keyof WatchPatch](v)) throw new Error("That isn't a change to a watch.")
    out[k] = v
  }
  return out as WatchPatch
}

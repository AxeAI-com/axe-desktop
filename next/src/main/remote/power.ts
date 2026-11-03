import { execFile } from "node:child_process"
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { app, powerMonitor, powerSaveBlocker } from "electron"

import { nextAgentTime, shouldHold, WAKE_EARLY_MS, WAKE_TASK, wakeTaskXml } from "@shared/power"
import type { KeepAwakeMode, PowerState } from "@shared/types"

import { isSelfTest } from "../paths"
import { settings, updateSettings } from "../settings"

// Keeps this computer awake while chats and watches run (ported from desktop/src/main/power.ts, itself
// PowerKeeper.swift on the Mac): Chromium's own sleep blocker, a power assertion on the Mac, a power
// request on Windows, a logind inhibitor on Linux. No admin rights; the screen may still turn off. It
// can't keep a closed laptop awake; nothing on this computer can.
//
// On Windows it also wakes the computer for the next watch check with a Task Scheduler task for
// this user (WakeToRun). Macs need a signed helper and Linux needs root to wake, so they stay awake instead.

let blocker: number | undefined
let awakeUntil: Date | undefined
/** Just woke up for a watch: stay up until it checks. */
let wokeAt = 0
let busy = () => false
let nextRuns: () => { enabled: boolean; nextRun?: string }[] = () => []
let onChange: (() => void) | undefined
let timer: ReturnType<typeof setInterval> | undefined
let scheduledWake: Date | undefined

export const mode = (): KeepAwakeMode => settings().keepAwake ?? "runs"
export const wakeSupport = (): "scheduled" | "none" => (process.platform === "win32" ? "scheduled" : "none")
export const holding = () => blocker !== undefined && powerSaveBlocker.isStarted(blocker)

export function report(): PowerState & { nextWakeAt: string | null } {
  return {
    keepAwake: mode(),
    holding: holding(),
    awakeUntil: awakeUntil && awakeUntil > new Date() ? awakeUntil.toISOString() : null,
    nextWakeAt: scheduledWake && scheduledWake > new Date() ? scheduledWake.toISOString() : null,
    onBattery: powerMonitor.isOnBatteryPower(),
  }
}

/** Re-decides whether to hold the computer awake. */
export function update() {
  const now = new Date()
  if (awakeUntil && awakeUntil <= now) awakeUntil = undefined
  const want = shouldHold({
    mode: mode(),
    until: awakeUntil,
    now,
    onBattery: powerMonitor.isOnBatteryPower(),
    busy: busy() || now.getTime() - wokeAt < 5 * 60_000,
  })
  const was = holding()
  if (want && !was) blocker = powerSaveBlocker.start("prevent-app-suspension")
  if (!want && was && blocker !== undefined) {
    powerSaveBlocker.stop(blocker)
    blocker = undefined
  }
  if (want !== was) onChange?.()
}

export function setMode(next: KeepAwakeMode) {
  updateSettings({ keepAwake: next })
  update()
  onChange?.()
}

/** Stay awake until then; undefined ends a temporary hold (from axeai.com). */
export function keepAwakeUntil(until: Date | undefined) {
  awakeUntil = until && until > new Date() ? until : undefined
  update()
  onChange?.()
}

/** Windows: one wake task for the next watch check, replaced whenever the schedule changes. */
export function scheduleWake() {
  if (process.platform !== "win32" || isSelfTest()) return
  const next = nextAgentTime(nextRuns(), new Date())
  const at = next ? new Date(next.getTime() - WAKE_EARLY_MS) : undefined
  if (at?.getTime() === scheduledWake?.getTime()) return
  scheduledWake = at
  onChange?.()
  if (!at || at <= new Date()) {
    execFile("schtasks", ["/Delete", "/TN", WAKE_TASK, "/F"], () => {})
    return
  }
  const file = join(tmpdir(), "axe-ai-wake.xml")
  // Task Scheduler reads its XML as UTF-16.
  writeFileSync(file, `﻿${wakeTaskXml(at, app.getPath("exe"))}`, { encoding: "utf16le" })
  execFile("schtasks", ["/Create", "/TN", WAKE_TASK, "/XML", file, "/F"], (err) => {
    if (err) scheduledWake = undefined
  })
}

export function start(opts: { busy: () => boolean; nextRuns: () => { enabled: boolean; nextRun?: string }[]; onChange: () => void }) {
  busy = opts.busy
  nextRuns = opts.nextRuns
  onChange = opts.onChange
  if (process.argv.includes("--wake")) wokeAt = Date.now()
  powerMonitor.on("resume", () => {
    wokeAt = Date.now()
    update()
  })
  powerMonitor.on("on-ac", update)
  powerMonitor.on("on-battery", update)
  update()
  scheduleWake()
  timer = setInterval(() => {
    update()
    scheduleWake()
  }, 60_000)
  timer.unref?.()
}

export function stop() {
  if (timer) clearInterval(timer)
  if (blocker !== undefined) powerSaveBlocker.stop(blocker)
  blocker = undefined
}

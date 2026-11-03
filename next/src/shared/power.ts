// Keeping the computer awake and waking it for agents: pure rules, shared by
// the main process and tests (PowerKeeper.swift on the Mac).

import type { KeepAwakeMode } from "./types"

export type { KeepAwakeMode }
export const KEEP_AWAKE_MODES: { value: KeepAwakeMode; label: string }[] = [
  { value: "off", label: "Normal sleep" },
  { value: "runs", label: "While something runs" },
  { value: "plugged", label: "While plugged in" },
  { value: "always", label: "Always" },
]

/** Should the computer be held awake right now? The screen may still turn off. */
export function shouldHold(s: {
  mode: KeepAwakeMode
  /** A temporary "keep awake until" from axeai.com. */
  until?: Date
  now: Date
  onBattery: boolean
  /** A chat or watch is running, or one is about to (just woke up for it). */
  busy: boolean
}): boolean {
  if (s.until && s.until > s.now) return true
  switch (s.mode) {
    case "off":
      return s.busy
    case "runs":
      return s.busy
    case "plugged":
      return s.busy || !s.onBattery
    case "always":
      return true
  }
}

// ---- Pairing codes --------------------------------------------------------------

/** Letters and digits that can't be mistaken for each other (no 0/O, 1/I). */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const CODE_LENGTH = 8
export const isCode = (code: string) =>
  code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c))

/** 8 characters from `pick(n)` (a random integer below n). */
export function makeCode(pick: (n: number) => number) {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[pick(CODE_ALPHABET.length)]).join("")
}

// ---- Waking Windows for a watch ------------------------------------------------------------

export const WAKE_TASK = "Axe AI wake"
/** Wake this long before the agent's time, so the computer is up when it starts. */
export const WAKE_EARLY_MS = 90_000

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const pad = (n: number) => String(n).padStart(2, "0")

/** Local wall-clock time as Task Scheduler writes it: 2026-10-19T07:58:30. */
export const localStamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/**
 * A Task Scheduler task for the current user (no admin needed) that wakes the
 * computer at `at` and starts Axe AI with --wake (or brings the running
 * one forward), so its scheduler can start the agent.
 */
export function wakeTaskXml(at: Date, exe: string): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Wakes this computer for your next Axe AI watch check.</Description></RegistrationInfo>
  <Triggers><TimeTrigger><StartBoundary>${localStamp(at)}</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <WakeToRun>true</WakeToRun>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>false</StartWhenAvailable>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xml(exe)}</Command><Arguments>--wake --hidden</Arguments></Exec></Actions>
</Task>
`
}

/** The earliest next run among watches that are on, if any. */
export function nextAgentTime(agents: { enabled: boolean; nextRun?: string }[], now: Date): Date | undefined {
  const times = agents
    .filter((a) => a.enabled && a.nextRun)
    .map((a) => new Date(a.nextRun as string))
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime())
  return times[0]
}

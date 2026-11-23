// Getting started on the home (one line that opens a popover): a few first steps, each read from what is on this Mac.
// Pure, so it is tested without the store; NewChat.tsx wires the actions.

import type { LocalAgent, ModelServer, ThreadSummary } from "@shared/types"

export type StepId = "agent" | "project" | "oversight" | "connectors" | "local" | "quick" | "signin"

export type Step = { id: StepId; title: string; hint: string; done: boolean }

export type GettingStartedInput = {
  agents?: Pick<LocalAgent, "name" | "state" | "here">[]
  threads: Pick<ThreadSummary, "source" | "cwd">[]
  checks: number
  connectors: number
  servers?: Pick<ModelServer, "name" | "found">[]
  /** The quick bar's key as people read it ("⌥Space"). */
  quickKey: string
  quickTried: boolean
  signedIn: boolean
}

/** "Claude Code", "Claude Code and Codex", "Claude Code, Codex and Gemini CLI". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

export function gettingStarted(i: GettingStartedInput): Step[] {
  const ready = (i.agents ?? []).filter((a) => a.state === "ready" && a.here)
  const servers = (i.servers ?? []).filter((s) => s.found)
  const steps: Step[] = [
    {
      id: "agent",
      title: "Coding agent ready on this Mac",
      hint: ready.length ? `Found ${listNames(ready.map((a) => a.name))}` : "Install Claude Code, Codex or another CLI",
      done: ready.length > 0,
    },
    {
      id: "project",
      title: "Work in a project",
      hint: "Pick a folder and let an agent work in it",
      done: i.threads.some((t) => t.source === "agent" && !!t.cwd),
    },
    {
      id: "oversight",
      title: "Set up Oversight",
      hint: "Add your first check, for your site, a service or this Mac",
      done: i.checks > 0,
    },
    {
      id: "connectors",
      title: "Connect your tools",
      hint: "Let chats use the apps you work in",
      done: i.connectors > 0,
    },
  ]
  if (servers.length) {
    steps.push({
      id: "local",
      title: "Use a model on this Mac",
      hint: `Found ${listNames(servers.map((s) => s.name))}`,
      done: i.threads.some((t) => t.source === "local"),
    })
  }
  steps.push({ id: "quick", title: "Ask from any app", hint: `Press ${i.quickKey} anywhere`, done: i.quickTried })
  if (!i.signedIn) steps.push({ id: "signin", title: "Sign in to Axe AI", hint: "Every model, Studio and your chats on the web", done: false })
  return steps
}

/** The one line on the home: "Getting started, 4 of 6 done". */
export function startedLine(steps: Step[]): string {
  return `Getting started, ${progressLine(steps)}`
}

/** "3 of 6 done". */
export function progressLine(steps: Step[]): string {
  return `${steps.filter((s) => s.done).length} of ${steps.length} done`
}

export const QUICK_TRIED_KEY = "axe.home.quickTried"
export const HIDDEN_KEY = "axe.home.gettingStartedHidden"


// Updates in the mock engine (lib/mock-bridge.ts), for working on the page in a plain browser and for
// the screenshot tests. URL option: ?update=ready|downloading|error|unsupported (default: up to date).

import type { Commands, Events } from "@shared/api"
import type { UpdateState } from "@shared/types"

type UpdateCommand = Extract<keyof Commands, `updates:${string}`>
type Handlers = { [K in UpdateCommand]: (...args: Parameters<Commands[K]>) => Awaited<ReturnType<Commands[K]>> | Promise<Awaited<ReturnType<Commands[K]>>> }

const NOW = Date.parse("2026-10-22T19:30:00Z")

const UPDATE: Record<string, UpdateState> = {
  ready: { status: "ready", version: "0.2.0" },
  downloading: { status: "downloading", version: "0.2.0", percent: 42 },
  error: { status: "error", message: "Couldn't reach axeai.com to check for updates." },
  unsupported: { status: "unsupported", reason: "This is a development build, so it doesn't update itself." },
}

export function mockUpdates(params: URLSearchParams, emit: <K extends keyof Events>(e: K, p: Events[K]) => void) {
  let update: UpdateState = UPDATE[params.get("update") ?? ""] ?? { status: "idle", checkedAt: NOW - 3 * 60_000 }
  const handlers: Handlers = {
    "updates:get": () => ({ version: "0.1.0", state: update }),
    "updates:check": async () => {
      update = { status: "checking" }
      emit("update", update)
      await new Promise((r) => setTimeout(r, 400))
      update = { status: "idle", checkedAt: Date.now() }
      emit("update", update)
      return update
    },
    "updates:install": () => console.info("[mock] restart to update"),
  }
  return { handlers }
}

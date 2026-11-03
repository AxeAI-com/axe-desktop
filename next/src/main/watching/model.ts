import type { Answerer } from "@shared/types"

// The engine's view of a model, with nothing from Electron in it, so the engine and checks stay testable.

export type AskModel = (answerer: Answerer, system: string, prompt: string, timeoutMs?: number) => Promise<string>

/** The model can't answer at all (not signed in, not running): the run fails with these words. */
export class ModelUnavailable extends Error {}

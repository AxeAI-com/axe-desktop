import type { EventName, Events } from "@shared/api"

// Engine modules push events through here, not through ipc.ts directly, so they
// run without Electron in unit tests. index.ts points this at ipc.emit.

type Emitter = <K extends EventName>(event: K, payload: Events[K]) => void

let emitter: Emitter = () => {}

export function setEmitter(fn: Emitter) {
  emitter = fn
}

type Listener = <K extends EventName>(event: K, payload: Events[K]) => void
const listeners = new Set<Listener>()

/** Also hear every event (remote control forwards chat events to paired phones). */
export function onEmit(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emit<K extends EventName>(event: K, payload: Events[K]) {
  emitter(event, payload)
  for (const fn of listeners) fn(event, payload)
}

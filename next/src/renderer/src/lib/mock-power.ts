import type { Commands, Events } from "@shared/api"
import type { PhonesView, PowerState, RemoteState } from "@shared/types"

// The mock engine's keep-awake, remote control and phones. ?mock=noruns starts with nothing running.

const at = (iso: string) => new Date(iso).toISOString()

type Names = "power:get" | "power:set" | "remote:get" | "remote:setEnabled" | "remote:newCode" | "phones:get" | "phones:setEnabled" | "phones:code" | "phones:remove" | "phones:answer" | "phones:log" | "phones:stop"

export function mockPower(scenario: string | null, emit: <K extends keyof Events>(e: K, p: Events[K]) => void) {
  const empty = scenario === "noruns"
  let power: PowerState = { keepAwake: "runs", holding: !empty, awakeUntil: null, onBattery: false }
  let remote: RemoteState = { enabled: true, connected: true, code: "K7QM4WXP", codeExpires: at("2026-10-23T19:30:00Z"), phoneURL: "https://axeai.com/chat?mac" }
  let phones: PhonesView = { available: true, enabled: false, macId: "mock-mac-id-0000000000", phones: [] }
  const phonesChanged = () => (emit("phones", phones), phones)
  const handlers: { [K in Names]: (...a: Parameters<Commands[K]>) => Awaited<ReturnType<Commands[K]>> } = {
    "power:get": () => power,
    "power:set": (mode) => {
      power = { ...power, keepAwake: mode, holding: mode === "always" || mode === "plugged" || power.holding }
      emit("power", power)
      return power
    },
    "remote:get": () => remote,
    "remote:setEnabled": (on) => {
      remote = { ...remote, enabled: on, connected: on }
      emit("remote", remote)
      return remote
    },
    "remote:newCode": () => {
      remote = { ...remote, code: "R3TN8HCV" }
      emit("remote", remote)
      return remote
    },
    "phones:get": () => phones,
    "phones:setEnabled": (on) => {
      phones = { ...phones, enabled: on }
      return phonesChanged()
    },
    "phones:code": () => (phones.enabled ? { link: "https://axeai.com/connect#mock-pairing-code", expiresAt: Date.now() + 102_000 } : null),
    "phones:remove": (id) => {
      phones = { ...phones, phones: phones.phones.filter((p) => p.id !== id) }
      return phonesChanged()
    },
    "phones:log": () => [],
    "phones:stop": () => {
      phones = { ...phones, enabled: false }
      return phonesChanged()
    },
    "phones:answer": (askId, allow) => {
      emit("phoneAsk", null)
      if (allow) phones = { ...phones, phones: [...phones.phones, { id: askId, name: "David's iPhone", agent: "Safari on iPhone", addedAt: Date.now(), lastUsedAt: Date.now(), connected: false }] }
      phonesChanged()
    },
  }
  return { handlers }
}

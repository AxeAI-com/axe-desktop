import type { AxeBridge } from "@shared/api"

declare global {
  interface Window {
    axe: AxeBridge
  }
}

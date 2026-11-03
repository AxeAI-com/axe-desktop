import { type DeviceKeys, type PublicKeys, signText } from "@shared/remote-crypto"
import { MacLink, type SocketLike } from "@shared/remote-link-client"
import { deviceId } from "@shared/remote-pairing"

import type { AxeClient } from "../axe/client"
import type { Phones } from "./phones"

// This computer's end of the sealed link to its paired phones (remote control, step 3). One outbound
// WebSocket to axeai.com's relay, a one-use ticket per connection (minted by proving this computer's
// key), and a sealed session per phone (shared/remote-link-client.ts). No Electron here.

export type LinkHost = {
  keys(): Promise<{ keys: DeviceKeys; pub: PublicKeys } | undefined>
  client(): AxeClient | undefined
  userId(): string | undefined
  /** https://axeai.com (or the dev server): the relay is at /api/relay/mac there. */
  baseURL(): string
  phones: Phones
  /** The phones with a live session changed (for the connected banner). */
  onLive(phones: string[]): void
  onMessage?(phone: string, m: Record<string, unknown>, chat: string): void
  socket?: (url: string) => SocketLike
}

export const relayURL = (base: string, side: "mac" | "phone") => `${base.replace(/^http/, "ws").replace(/\/+$/, "")}/api/relay/${side}`

/** Starts the link; undefined when this computer has no keys. Stop it with .stop(). */
export async function startLink(host: LinkHost): Promise<MacLink | undefined> {
  const k = await host.keys()
  if (!k) return undefined
  const mac = await deviceId(k.pub.ed)
  const link: MacLink = new MacLink({
    url: relayURL(host.baseURL(), "mac"),
    socket: host.socket ?? ((url) => new WebSocket(url) as unknown as SocketLike),
    keys: k.keys,
    mac,
    async ticket() {
      const c = host.client()
      const userId = host.userId()
      if (!c || !userId) throw new Error("Signed out")
      const at = Date.now()
      const sig = await signText(k.keys.sign.privateKey, `axe-rc v1 mac-ticket\n${userId}\n${at}`)
      const { ticket } = await c.json<{ ticket: string }>("api/remote/mac/ws-ticket", { method: "POST", json: { ed: k.pub.ed, at, sig } })
      return ticket
    },
    phoneEd: async (phone) => (await host.phones.phone(phone))?.ed,
    onPeer: (phone, on) => {
      if (on) void host.phones.touch(phone)
      host.onLive(link.phones())
    },
    onMessage: (phone, m, chat) => host.onMessage?.(phone, m, chat),
  })
  link.start()
  return link
}

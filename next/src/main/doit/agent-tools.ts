import { nativeImage } from "electron"

import { dataPath } from "../paths"
import { settings } from "../settings"
import { browser } from "./browser"
import { computer } from "./computer"
import { mustAsk } from "./guard"
import { acpEntry, type McpProvider, type McpResult, register, start, unregister, writeBridge } from "./mcp"
import { makeToolbox } from "./toolbox"
import { workspace } from "./index"
import { BROWSER_TOOLS, COMPUTER_TOOLS, describe, type Input, type Tool } from "./tools"

// What a CLI agent gets from Axe over MCP: its own browser and computer use. Agents bring their own
// terminal and files. Risky steps ask in the chat with the same card Do it uses, unless Full access is on.

const TOOLS = [...BROWSER_TOOLS, ...COMPUTER_TOOLS]

/** A small PNG for the agent: screenshots are cut to 1280 wide. */
function image(png: Buffer): { data: string; mimeType: string } {
  let img = nativeImage.createFromBuffer(png)
  if (img.getSize().width > 1280) img = img.resize({ width: 1280, quality: "good" })
  return { data: img.toPNG().toString("base64"), mimeType: "image/png" }
}

export function providerFor(options: {
  userText: () => string
  ask: (q: { title: string; detail?: string }) => Promise<boolean>
  /** The chat's Full access (its mode); without it, the Settings switch. */
  fullAccess?: () => boolean
  /** More tools for this chat only (a page's chat: change the page). They never ask: they only touch Axe. */
  extra?: { instructions: string; tools: Tool[]; call: (name: string, args: Input) => Promise<McpResult> }
}): McpProvider {
  const toolbox = makeToolbox({ workspace: workspace(), userText: options.userText, browser, computer, tools: TOOLS })
  const fullAccess = options.fullAccess ?? (() => !!settings().fullAccess)
  // Protected folders this chat already allowed: asked once, then remembered for the session.
  const allowedOnce = new Set<string>()
  return {
    name: "Axe AI",
    instructions: `Axe AI's own browser (browser_open, then browser_click / browser_type with the numbers it returns) and the apps on this computer (list_apps, open_app, read_screen, click, type_text, press_keys, screenshot). Set irreversible: true before anything that sends, posts, deletes or pays.${options.extra ? ` ${options.extra.instructions}` : ""}`,
    tools: () => [...TOOLS, ...(options.extra?.tools ?? [])],
    async call(name, args): Promise<McpResult> {
      if (options.extra?.tools.some((t) => t.name === name)) return options.extra.call(name, args)
      if (!TOOLS.some((t) => t.name === name)) return { text: `There's no tool called ${name}.`, isError: true }
      const check = await toolbox.check(name, args)
      if (mustAsk(check, fullAccess(), args.irreversible === true, allowedOnce)) {
        const d = describe(name, args)
        const why = typeof args.why === "string" ? args.why : undefined
        const allowed = await options.ask({ title: check.reason ?? d.title, ...(why || d.input ? { detail: why ?? d.input } : {}) })
        if (!allowed) return { text: "The user said no to this step. Don't do it, and don't try it another way.", isError: true }
        if (check.always) allowedOnce.add(check.reason ?? "")
      }
      try {
        if (name === "screenshot") {
          const png = args.target === "browser" ? await browser.capture() : await computer.screenshot()
          return { text: "Here is the screenshot.", image: image(png), isError: false }
        }
        const out = await toolbox.run(name, args, { signal: new AbortController().signal, progress: () => {} })
        return { text: out.text, isError: false }
      } catch (e) {
        return { text: (e as Error).message, isError: true }
      }
    },
  }
}

/** Starts the server (once) and gives this chat a key; `release` ends the key with the session. */
export async function mcpFor(options: Parameters<typeof providerFor>[0] & { http: boolean }) {
  await start()
  const key = register(providerFor(options))
  const bridgePath = writeBridge(dataPath("mcp-bridge.cjs"))
  return { server: acpEntry(key, { http: options.http, bridgePath, nodePath: process.execPath }), release: () => unregister(key) }
}

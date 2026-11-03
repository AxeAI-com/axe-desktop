import { basename } from "node:path"

import type { Json, ToolKind } from "@shared/types"
import { SHELL_NAME } from "./terminal"

// The tools Axe models get when a chat works on this computer. Names and shapes follow the Mac
// (MacTask.swift) and the old Windows/Linux app (desktop/src/main/agent/tools.ts), so
// /api/agent/respond and its prompts stay the same on every OS.

export type Input = Record<string, Json | undefined>
export type Tool = { name: string; description: string; inputSchema: { type: "object"; properties: Record<string, Json>; required: string[] } }

const tool = (name: string, description: string, properties: Record<string, Json>, required: string[] = []): Tool => ({
  name,
  description,
  inputSchema: { type: "object", properties, required },
})

const IRREVERSIBLE: Record<string, Json> = {
  irreversible: { type: "boolean", description: "true if this sends, posts, deletes, pays or can't be undone" },
  why: { type: "string", description: "What will happen, in plain words, when irreversible is true" },
}

export const OS_NAME = process.platform === "win32" ? "Windows PC" : process.platform === "darwin" ? "Mac" : "Linux computer"
const MAC = process.platform === "darwin"

export const PLAN_TOOL = tool(
  "update_plan",
  "Show your plan as a checklist. Send every step each time, with current = the index of the step you're on (steps.length when all are done).",
  { steps: { type: "array", items: { type: "string" } }, current: { type: "integer" } },
  ["steps", "current"],
)

export const FILE_TOOLS: Tool[] = [
  tool("read_file", "Read a text file. Relative paths are inside the workspace folder.", { path: { type: "string" } }, ["path"]),
  tool("list_folder", "List what's in a folder.", { path: { type: "string" } }, ["path"]),
  tool(
    "search_files",
    "Find files by name under a folder (the workspace when folder is left out).",
    { query: { type: "string" }, folder: { type: "string" } },
    ["query"],
  ),
  tool("write_file", "Create a text file, or replace one.", { path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
  tool(
    "edit_file",
    "Change part of a text file: old_text must appear exactly once and becomes new_text.",
    { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } },
    ["path", "old_text", "new_text"],
  ),
  tool("delete_file", "Delete a file.", { path: { type: "string" } }, ["path"]),
]

export const TERMINAL_TOOLS: Tool[] = [
  tool(
    "run_command",
    `Run a command on this ${OS_NAME} in ${SHELL_NAME} and get its output. Write it for that shell. Runs in the workspace folder unless cwd is set. Stops after timeout seconds (default 120).`,
    { command: { type: "string" }, cwd: { type: "string" }, timeout: { type: "integer" }, ...IRREVERSIBLE },
    ["command"],
  ),
]

export const BROWSER_TOOLS: Tool[] = [
  tool("browser_open", "Open a URL, or search the web for words, in Axe's own browser. Returns the page.", { url: { type: "string" } }, ["url"]),
  tool("browser_read", "Read the current page again.", {}),
  tool("browser_click", "Click a numbered link or button on the page.", { element: { type: "integer" }, ...IRREVERSIBLE }, ["element"]),
  tool(
    "browser_type",
    "Fill a numbered field on the page; submit=true presses Enter / submits its form.",
    { element: { type: "integer" }, text: { type: "string" }, submit: { type: "boolean" }, ...IRREVERSIBLE },
    ["element", "text"],
  ),
]

export const COMPUTER_TOOLS: Tool[] = [
  tool("list_apps", `List the apps installed on this ${OS_NAME}. Pass query to filter by name.`, { query: { type: "string" } }),
  tool(
    "open_app",
    `Open an app on this ${OS_NAME} by name. Loose spellings work. Pass url to open a web page (or file) in it.`,
    { name: { type: "string" }, url: { type: "string" } },
    ["name"],
  ),
  tool("screenshot", "Take a screenshot of the screen, or of Axe's own browser with target \"browser\". Saves a PNG and says where.", {
    target: { type: "string", enum: ["screen", "browser"] },
  }),
  ...(MAC
    ? [
        tool("read_screen", "Read an app's front window as numbered controls and text (the frontmost app when app is left out).", { app: { type: "string" } }),
        tool("click", "Press a numbered control from the last read_screen.", { element: { type: "integer" }, ...IRREVERSIBLE }, ["element"]),
        tool(
          "type_text",
          "Type text into a numbered field from the last read_screen, or into whatever has focus.",
          { text: { type: "string" }, element: { type: "integer" } },
          ["text"],
        ),
        tool("press_keys", "Press a key combination in the app last read: cmd+n, return, cmd+shift+t, escape, tab.", { keys: { type: "string" }, ...IRREVERSIBLE }, [
          "keys",
        ]),
      ]
    : []),
]

export const ALL_TOOLS: Tool[] = [PLAN_TOOL, ...FILE_TOOLS, ...TERMINAL_TOOLS, ...BROWSER_TOOLS, ...COMPUTER_TOOLS]

/** The prompt that comes with every Do it call. */
export function systemPrompt(workspace: string): string {
  return `You are Axe AI working on the user's ${OS_NAME}. You act through tools; the computer runs them and returns the result.
- Files and terminal: read_file, write_file, edit_file, list_folder, search_files, run_command. The workspace folder is ${workspace};
  relative paths go there. Never touch the Desktop, Documents, Downloads or Library folders unless the user named them.
- Web: use Axe's own browser: browser_open (a URL or search words), then browser_click / browser_type with the numbers it returns.
  Read the page again after acting to check the result. Element numbers change after every read.
- Apps: list_apps, open_app${MAC ? ", then read_screen to see an app's window and click / type_text / press_keys to use it" : ""}.
  screenshot saves a picture of the screen; you can't see images, so read the page or the screen to know what's on it.
- For anything with more than two steps, call update_plan first and keep it current.
- Before any action that can't be undone (sending a message or email, posting, deleting, buying, paying, submitting a form
  that sends something to someone, a command that changes things), set "irreversible": true and explain in "why". The user may be asked first.
- If the user says no to a step, don't try it another way. Say what you would have done and stop.
- Do the task fully, step by step: call the tools, don't describe calling them.
- Never say you did something unless a tool result in this conversation confirms it.
- When done, reply with a short plain summary of what you actually did. If something blocks you, say what.`
}

const s = (v: Json | undefined) => (typeof v === "string" ? v : "")
const short = (u: string, n = 60) => (u.length > n ? `${u.slice(0, n)}…` : u)
const hostish = (u: string) => short(u.replace(/^https?:\/\//, "").replace(/\/$/, ""))

/** How a step reads in the chat, and which kind of step it is. */
export function describe(name: string, i: Input): { title: string; kind: ToolKind; input?: string } {
  switch (name) {
    case "read_file":
      return { title: `Read ${basename(s(i.path))}`, kind: "read", input: s(i.path) }
    case "list_folder":
      return { title: `Look in ${basename(s(i.path)) || s(i.path)}`, kind: "read", input: s(i.path) }
    case "search_files":
      return { title: `Search files for “${short(s(i.query), 40)}”`, kind: "search", input: s(i.folder) || undefined }
    case "write_file":
      return { title: `Write ${basename(s(i.path))}`, kind: "edit", input: s(i.path) }
    case "edit_file":
      return { title: `Edit ${basename(s(i.path))}`, kind: "edit", input: s(i.path) }
    case "delete_file":
      return { title: `Delete ${basename(s(i.path))}`, kind: "delete", input: s(i.path) }
    case "run_command":
      return { title: `Run ${short(s(i.command).split("\n")[0] ?? "", 50)}`, kind: "execute", input: s(i.command) }
    case "browser_open": {
      const u = s(i.url)
      return { title: !u || u.startsWith("data:") ? "Open a page" : `Open ${hostish(u)}`, kind: "fetch", input: u.startsWith("data:") ? undefined : u }
    }
    case "browser_read":
      return { title: "Read the page", kind: "fetch" }
    case "browser_click":
      return { title: "Click on the page", kind: "other" }
    case "browser_type":
      return { title: `Fill in “${short(s(i.text), 40)}”`, kind: "other" }
    case "list_apps":
      return { title: s(i.query) ? `Look for apps like “${s(i.query)}”` : "List the apps", kind: "search" }
    case "open_app":
      return { title: `Open ${s(i.name) || "an app"}${s(i.url) ? ` with ${hostish(s(i.url))}` : ""}`, kind: "other" }
    case "screenshot":
      return { title: s(i.target) === "browser" ? "Take a screenshot of the page" : "Take a screenshot", kind: "other" }
    case "read_screen":
      return { title: s(i.app) ? `Read ${s(i.app)}` : "Read the screen", kind: "other" }
    case "click":
      return { title: "Click in the app", kind: "other" }
    case "type_text":
      return { title: `Type “${short(s(i.text), 40)}”`, kind: "other" }
    case "press_keys":
      return { title: `Press ${s(i.keys)}`, kind: "other" }
    default:
      return { title: name.replace(/_/g, " "), kind: "other" }
  }
}

import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, isAbsolute, relative } from "node:path"
import { fileURLToPath } from "node:url"

import type { Json } from "@shared/types"

import { mustConfirm, protectedFolder, shortPath, userNamed } from "./guard"
import { deleteFile, editText, listFolder, readText, resolvePath, searchFiles, writeText } from "./files"
import type { Check, ToolOutcome, Toolbox } from "./loop"
import { commandReport, runCommand } from "./terminal"
import { ALL_TOOLS, type Input, type Tool } from "./tools"

// Runs each tool call. The browser and the hands on other apps come in as interfaces, so unit tests
// pass fakes and only the app (doit/index.ts) uses Electron.

export type PageBrowser = {
  /** Host of the page, for approval titles ("Click “Send” on localhost"). */
  where(): string
  open(url: string): Promise<void>
  read(): Promise<string>
  click(element: number): Promise<void>
  type(element: number, text: string, submit: boolean): Promise<void>
  describe(element: number): Promise<{ label: string; isSearch: boolean; submits?: boolean }>
  /** A PNG of the page. */
  capture(): Promise<Buffer>
}

export type Computer = {
  listApps(query?: string): Promise<string>
  openApp(name: string, url?: string): Promise<string>
  /** A PNG of the whole screen (asks for Screen Recording on the Mac the first time). */
  screenshot(): Promise<Buffer>
  readScreen(app?: string): Promise<string>
  click(element: number): Promise<void>
  typeText(text: string, element?: number): Promise<void>
  pressKeys(keys: string): Promise<void>
  /** Label of a numbered control, and the app it's in, for the guard. */
  label(element: number): Promise<{ label: string; app: string }>
  lastApp(): Promise<string>
}

export type ToolboxOptions = {
  workspace: string
  /** Everything the user wrote in this chat: a protected folder is fine once they named it. */
  userText: () => string
  browser: PageBrowser
  computer: Computer
  env?: NodeJS.ProcessEnv
  tools?: Tool[]
  home?: string
}

const s = (v: Json | undefined) => (typeof v === "string" ? v : "")
const n = (v: Json | undefined) => (typeof v === "number" ? v : -1)
const preview = (text: string, lines = 12) => {
  const all = text.split("\n")
  return all.length > lines ? `${all.slice(0, lines).join("\n")}\n…` : text
}

const inside = (p: string, folder: string) => {
  const rel = relative(folder, p)
  return !rel.startsWith("..") && !isAbsolute(rel)
}

const PATH_TOOLS = new Set(["read_file", "list_folder", "write_file", "edit_file", "delete_file", "search_files", "run_command"])

export function makeToolbox(o: ToolboxOptions): Toolbox {
  const path = (p: string) => resolvePath(p, o.workspace)
  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)

  async function saveShot(png: Buffer, what: string): Promise<ToolOutcome> {
    await mkdir(path("Screenshots"), { recursive: true })
    const file = path(`Screenshots/${what}-${stamp()}.png`)
    await writeFile(file, png)
    return { text: `Saved the screenshot to ${file}. You can't see it; read the page or the screen to know what's on it.`, output: shortPath(file, o.home) }
  }

  return {
    tools: o.tools ?? ALL_TOOLS,

    async check(name: string, input: Input): Promise<Check> {
      const action = await actionCheck(name, input)
      // Protected folders: asked every time, Full access or not, unless the user named the folder.
      // Every path the step touches counts: its path argument, a shell command's cwd and the paths
      // written in the command, and a file: address the browser opens.
      for (const target of targetsOf(name, input)) {
        // Axe's own workspace lives in the app's data folder (under Library on the Mac): always fine.
        if (inside(path(target), o.workspace)) continue
        const folder = protectedFolder(path(target), o.home)
        if (!folder || userNamed(folder, o.userText())) continue
        // A step that changes or deletes something asks about that exact step: allowing the folder
        // once (for a read) must not allow a later delete there.
        if (action.reason) return { ...action, reason: `${action.reason} in your ${folder} folder`, always: true }
        return { reason: `Use your ${folder} folder`, always: true }
      }
      if (name === "browser_open" && /^file:/i.test(s(input.url))) {
        const file = fileTarget(s(input.url))
        if (file && !inside(path(file), o.workspace)) return { reason: `Open ${shortPath(file, o.home)} in the browser` }
      }
      return action
    },

    async run(name, input, ctx): Promise<ToolOutcome> {
      return runTool(name, input, ctx)
    },
  }

  /** The paths a step reads or changes, as written (relative ones resolve in the workspace). */
  function targetsOf(name: string, input: Input): string[] {
    if (name === "browser_open") {
      const file = fileTarget(s(input.url))
      return file ? [file] : []
    }
    if (!PATH_TOOLS.has(name)) return []
    if (name === "search_files") return [s(input.folder)].filter(Boolean)
    if (name !== "run_command") return [s(input.path)].filter(Boolean)
    return [s(input.cwd), ...commandPaths(s(input.command), o.home)].filter(Boolean)
  }

  async function actionCheck(name: string, input: Input): Promise<Check> {
      switch (name) {
        case "browser_click":
        case "browser_type": {
          const d = await o.browser.describe(n(input.element))
          const title = name === "browser_click" && d.label ? `Click “${d.label}”` : undefined
          return { reason: mustConfirm(name, input, { label: d.label, isSearch: d.isSearch, submits: d.submits, where: o.browser.where() }), ...(title ? { title } : {}) }
        }
        case "click": {
          const d = await o.computer.label(n(input.element))
          const title = d.label ? `Press “${d.label}”${d.app ? ` in ${d.app}` : ""}` : undefined
          return { reason: mustConfirm(name, input, { label: d.label, where: d.app || undefined }), ...(title ? { title } : {}) }
        }
        case "press_keys":
          return { reason: mustConfirm(name, input, { where: await o.computer.lastApp() }) }
        case "write_file":
          return { reason: mustConfirm(name, input, { exists: existsSync(path(s(input.path))) }) }
        default:
          return { reason: mustConfirm(name, input) }
      }
  }

  async function runTool(name: string, input: Input, ctx: Parameters<Toolbox["run"]>[2]): Promise<ToolOutcome> {
      switch (name) {
        case "read_file": {
          const text = await readText(path(s(input.path)))
          return { text, output: preview(text) }
        }
        case "list_folder": {
          const text = await listFolder(path(s(input.path) || "."))
          return { text, output: preview(text) }
        }
        case "search_files": {
          const root = path(s(input.folder) || ".")
          const hits = await searchFiles(s(input.query), root, 30, o.home)
          const text = hits.length ? hits.join("\n") : "No files found."
          return { text, output: preview(text, 8) }
        }
        case "write_file": {
          const file = path(s(input.path))
          const content = s(input.content)
          const { before } = await writeText(file, content)
          return { text: `${before === undefined ? "Created" : "Replaced"} ${file}.`, diff: [{ path: shortPath(file, o.home), ...(before !== undefined ? { before } : {}), after: content }] }
        }
        case "edit_file": {
          const file = path(s(input.path))
          const { before, after } = await editText(file, s(input.old_text), s(input.new_text))
          return { text: `Changed ${basename(file)}.`, diff: [{ path: shortPath(file, o.home), before, after }] }
        }
        case "delete_file": {
          const file = path(s(input.path))
          await deleteFile(file)
          return { text: `Deleted ${file}.`, output: `Deleted ${shortPath(file, o.home)}` }
        }
        case "run_command": {
          const cwd = s(input.cwd) ? path(s(input.cwd)) : o.workspace
          await mkdir(o.workspace, { recursive: true })
          const r = await runCommand(s(input.command), {
            cwd,
            env: o.env,
            timeoutSeconds: typeof input.timeout === "number" ? input.timeout : undefined,
            signal: ctx.signal,
            onOutput: ctx.progress,
          })
          return { text: commandReport(r), output: r.output.trim() || (r.code === 0 ? "Done, no output." : `Exit code ${r.code}`) }
        }
        case "browser_open":
          await o.browser.open(s(input.url))
          return { text: await o.browser.read() }
        case "browser_read":
          return { text: await o.browser.read() }
        case "browser_click":
          await o.browser.click(n(input.element))
          return { text: await o.browser.read() }
        case "browser_type":
          await o.browser.type(n(input.element), s(input.text), input.submit === true)
          return { text: input.submit === true ? await o.browser.read() : "Typed." }
        case "list_apps": {
          const text = await o.computer.listApps(s(input.query) || undefined)
          return { text, output: preview(text, 8) }
        }
        case "open_app": {
          const text = await o.computer.openApp(s(input.name), s(input.url) || undefined)
          return { text, output: text }
        }
        case "screenshot":
          return s(input.target) === "browser" ? saveShot(await o.browser.capture(), "page") : saveShot(await o.computer.screenshot(), "screen")
        case "read_screen": {
          const text = await o.computer.readScreen(s(input.app) || undefined)
          return { text, output: preview(text, 8) }
        }
        case "click":
          await o.computer.click(n(input.element))
          return { text: "Pressed. Read the screen again to see what changed." }
        case "type_text":
          await o.computer.typeText(s(input.text), typeof input.element === "number" ? input.element : undefined)
          return { text: "Typed." }
        case "press_keys":
          await o.computer.pressKeys(s(input.keys))
          return { text: `Pressed ${s(input.keys)}.` }
        default:
          throw new Error(`There's no tool called ${name}.`)
      }
  }
}

/** The local path a file: address points at, or undefined. */
function fileTarget(url: string): string | undefined {
  if (!/^file:/i.test(url.trim())) return undefined
  try {
    return fileURLToPath(url.trim())
  } catch {
    return undefined
  }
}

/** Paths written in a shell command: ~/…, $HOME/…, ${HOME}/… and absolute paths, quotes removed. */
export function commandPaths(command: string, home = homedir()): string[] {
  const out: string[] = []
  for (const raw of command.split(/[\s|&;()<>]+/)) {
    const word = raw.replace(/^['"]+|['"]+$/g, "").replace(/^[A-Za-z-]+=/, "")
    if (!word) continue
    const expanded = word.replace(/^(\$HOME|\$\{HOME\}|~)(?=\/|$)/, home)
    if (expanded === "~" || expanded.startsWith("~/") || isAbsolute(expanded)) out.push(expanded)
  }
  return out
}

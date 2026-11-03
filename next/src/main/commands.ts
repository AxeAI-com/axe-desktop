import { app, BrowserWindow, dialog, nativeTheme, shell } from "electron"

import { formatParsed, parseAccelerator, type Platform } from "@shared/accelerator"
import type { AxeModel, ModelCatalog, Theme } from "@shared/types"

import { installAgent, loadRegistry, localAgents, signInCommand } from "./agents/registry"
import * as account from "./axe/account"
import * as attachments from "./attachments"
import { emit } from "./bus"
import { computerAccess } from "./doit/computer"
import * as chat from "./chat"
import { handle } from "./ipc"
import { community, configureLibraries, hub, skills } from "./libraries"
import { addModelServer, cancelPull, configureLocalModels, modelServers, onServersChanged, pullModel, removeModelServer, startOllama, warm, weight } from "./local-models"
import { appNames, folderHits } from "./mentions"
import { deleteHelper, listHelpers, saveHelper } from "./libraries/helpers"
import { connectorSecretBox } from "./secrets"
import * as quickbar from "./quickbar"
import { onSettingsChange, settings, updateSettings } from "./settings"
import * as terminal from "./terminal"
import * as updates from "./updates"
import * as voice from "./voice"

// Every command in src/shared/api.ts, wired to the engine.

const pickModel = (m: AxeModel): AxeModel => ({
  id: m.id,
  label: m.label,
  provider: m.provider,
  tier: m.tier,
  ...(m.description ? { description: m.description } : {}),
  webSearch: !!m.webSearch,
  vision: !!m.vision,
  reasoning: !!m.reasoning,
  ...(typeof m.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
})

async function axeModels(): Promise<ModelCatalog["axe"]> {
  try {
    const r = await account.anyClient().models()
    return { defaultModelId: r.defaultModelId, models: [...(r.free ?? []), ...(r.paid ?? [])].map(pickModel) }
  } catch (e) {
    account.sessionEnded(e)
    return { defaultModelId: "auto", models: [] }
  }
}

export async function catalog(fresh = false): Promise<ModelCatalog> {
  const [axe, agents, servers] = await Promise.all([axeModels(), localAgents().catch(() => []), modelServers(fresh).catch(() => [])])
  const local = servers.flatMap((s) => s.models).sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name))
  return { axe, agents, local, servers }
}

/** The accelerator as it will be saved, or an error in plain words. */
function normalQuickBarKey(value: string): string {
  const p = parseAccelerator(value, process.platform as Platform)
  if (!p) throw new Error("Use a key with ⌘, Ctrl, Alt or Shift, like Alt+Space.")
  return formatParsed(p)
}

// Input checks for the handlers that reach a shell or an agent's settings: a plain error on anything else.
const text = (v: unknown, max = 200): string => {
  if (typeof v !== "string" || v.length > max) throw new Error("That isn't a valid request.")
  return v
}
const size = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("That isn't a valid size.")
  return v
}
const optionalText = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : text(v))
/** What a terminal accepts in one write: a paste, not a flood. */
const MAX_WRITE = 1_000_000

export function applyTheme(theme: Theme) {
  nativeTheme.themeSource = theme
}

export function registerCommands() {
  configureLocalModels({ box: connectorSecretBox })
  // Ollama started for a chat, or a model turned out not to use tools: the window's lists follow.
  onServersChanged(() => void catalog(true).then((c) => emit("models", c)))
  handle("account:get", async () => {
    if (!account.isSignedIn()) return null
    try {
      return await account.refresh()
    } catch {
      return account.currentProfile()
    }
  })
  handle("account:signIn", async () => {
    const p = await account.signIn()
    if (p) void chat.listThreads().then(() => catalog().then((c) => emit("models", c)))
    return p
  })
  handle("account:cancelSignIn", () => account.cancelSignIn())
  handle("account:signOut", () => account.signOut())
  handle("account:openBilling", () => void shell.openExternal(account.billingURL()))

  handle("models:get", () => catalog())
  handle("agents:install", async (agentId) => {
    await installAgent(agentId)
    const c = await catalog()
    emit("models", c)
    return c
  })

  handle("models:refresh", async () => {
    const c = await catalog(true)
    emit("models", c)
    return c
  })
  handle("models:addServer", async (address, key) => {
    await addModelServer(address, key)
    const c = await catalog(true)
    emit("models", c)
    return c
  })
  handle("models:removeServer", async (serverId) => {
    removeModelServer(serverId)
    const c = await catalog(true)
    emit("models", c)
    return c
  })

  // Starting it sends the new catalog to every window (onServersChanged).
  handle("models:startOllama", async () => {
    await startOllama()
    return catalog(true)
  })
  handle("models:pull", async (name) => {
    try {
      await pullModel(name, (p) => emit("modelPull", p))
    } finally {
      emit("modelPull", null)
    }
    const c = await catalog(true)
    emit("models", c)
    return c
  })
  handle("models:cancelPull", () => cancelPull())
  handle("models:warm", (modelId) => warm(modelId))

  handle("threads:list", () => chat.listThreads())
  handle("threads:messages", (threadId) => chat.threadMessages(threadId))
  handle("threads:rename", (threadId, title) => chat.renameThread(threadId, title))
  handle("threads:pin", (threadId, pinned) => chat.pinThread(threadId, pinned))
  handle("threads:archive", (threadId) => chat.archiveThread(threadId))
  handle("threads:delete", (threadId) => chat.deleteThread(threadId))

  handle("chat:send", (request) => chat.send(request))
  handle("chat:stop", (threadId) => chat.stop(threadId))
  handle("chat:answerPermission", (requestId, optionId) => chat.answerPermission(requestId, optionId))
  handle("chat:approveResearch", (threadId, messageId) => chat.approveResearch(threadId, messageId))
  handle("chat:cancelResearch", (threadId, messageId) => chat.cancelResearch(threadId, messageId))
  handle("chat:commands", (threadId) => chat.commandsFor(threadId))
  handle("agents:commands", (agentId, cwd) => chat.commandsBeforeStart(agentId, cwd))
  handle("agents:instructions", (threadId) => chat.instructionsFor(threadId))
  handle("agents:openInstructions", (threadId, name) => chat.openInstructions(threadId, name, (path) => shell.openPath(path)))

  handle("terminal:open", (cols, rows, agentId) => {
    const agent = optionalText(agentId)
    return terminal.open(size(cols), size(rows), agent ? signInCommand(agent) : undefined)
  })
  handle("terminal:list", () => terminal.list())
  handle("terminal:write", (id, data) => terminal.write(text(id), text(data, MAX_WRITE)))
  handle("terminal:signIn", (id, agentId) => {
    const run = signInCommand(text(agentId))
    if (!run) throw new Error("That agent has no sign-in.")
    terminal.type(text(id), run)
  })
  handle("terminal:resize", (id, cols, rows) => terminal.resize(text(id), size(cols), size(rows)))
  handle("terminal:close", (id) => terminal.close(text(id)))

  handle("agents:setMode", (threadId, mode) => chat.setMode(threadId, mode))
  handle("agents:options", (threadId, agentId) => chat.agentOptions(threadId === null ? null : text(threadId), text(agentId)))
  handle("agents:setOption", (threadId, agentId, configId, value) => {
    const thread = threadId === null ? null : text(threadId)
    const agent = text(agentId)
    const option = text(configId, 100)
    // Only an option the agent itself reported.
    if (!chat.agentOptions(thread, agent).some((o) => o.id === option)) throw new Error("That isn't a choice.")
    return chat.setAgentOption(thread, agent, option, text(value))
  })
  handle("chat:startPlan", (threadId) => chat.startPlan(threadId))
  handle("changes:list", (threadId) => chat.changesFor(threadId))
  handle("changes:keep", (threadId, paths) => chat.keepChanges(threadId, paths))
  handle("changes:undo", (threadId, paths) => chat.undoChanges(threadId, paths))
  handle("chat:rewindPreview", (threadId, messageId) => chat.rewindPreview(threadId, messageId))
  handle("chat:rewind", (threadId, messageId, files) => chat.rewind(threadId, messageId, files))

  handle("memory:list", () => chat.memory.list())
  handle("memory:add", (text) => chat.memory.add(text))
  handle("memory:update", (id, text) => chat.memory.update(id, text))
  handle("memory:delete", (id) => chat.memory.remove(id))

  // Libraries (slice 4, package G): skills, agents, connectors.
  configureLibraries({ secrets: connectorSecretBox(), openUrl: (url) => shell.openExternal(url) })
  const pickFolder = async (label: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = { properties: ["openDirectory"], buttonLabel: label, defaultPath: app.getPath("home") }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  }
  handle("skills:list", () => skills.library())
  handle("skills:read", (id) => skills.text(id))
  handle("skills:install", (id, targets) => skills.install(id, targets))
  handle("skills:uninstall", (id) => skills.uninstall(id))
  handle("skills:create", (skill) => skills.create(skill))
  handle("skills:import", async () => {
    const folder = await pickFolder("Import skill")
    return folder ? skills.importFolder(folder) : skills.library()
  })

  handle("community:skills", (fresh) => community.skillList(!!fresh))
  handle("community:skillText", (key) => community.skillText(key))
  handle("community:installSkill", (key, targets) => community.installSkill(key, targets))
  handle("community:agents", (fresh) => community.agentList(!!fresh))
  handle("community:agentText", (key) => community.agentText(key))
  handle("community:addAgent", (key) => community.addAgent(key))
  handle("helpers:list", () => listHelpers())
  handle("helpers:save", (helper) => saveHelper(helper))
  handle("helpers:delete", (id) => deleteHelper(id))

  handle("connectors:list", () => hub().view())
  handle("connectors:connect", (catalogId, token) => hub().connect(catalogId, token))
  handle("connectors:cancel", () => hub().cancel())
  handle("connectors:addCustom", (custom) => hub().addCustom(custom))
  handle("connectors:setEnabled", (id, enabled) => hub().setEnabled(id, enabled))
  handle("connectors:remove", (id) => hub().remove(id))
  handle("chat:setConnectors", (threadId, ids) => chat.setConnectors(threadId, ids))

  handle("settings:get", () => settings())
  handle("settings:set", ({ modelServers: _servers, ...patch }) => {
    // A new quick bar key must be free before it is saved.
    if (patch.quickBarKey !== undefined) {
      const key = normalQuickBarKey(patch.quickBarKey)
      if (key !== settings().quickBarKey && !quickbar.useShortcut(key)) throw new Error("Another app already uses that shortcut. Try a different one.")
      return updateSettings({ ...patch, quickBarKey: key })
    }
    return updateSettings(patch)
  })
  handle("app:pickFolder", async () => {
    // Demo recordings never open a dialog: it would take focus from whoever is using the Mac.
    if (process.env.AXE_DEMO_FOLDER) return process.env.AXE_DEMO_FOLDER
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = { properties: ["openDirectory", "createDirectory"], buttonLabel: "Use this folder", defaultPath: app.getPath("home") }
    const r = await quickbar.holdOpen(() => (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)))
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  handle("app:pickFiles", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = { properties: ["openFile", "multiSelections"], buttonLabel: "Attach" }
    const r = await quickbar.holdOpen(() => (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)))
    return r.canceled ? [] : r.filePaths.map(attachments.fromPath)
  })
  handle("app:attachPaths", (paths) => paths.map(attachments.fromPath))
  handle("app:attachBytes", (name, mime, bytes) => attachments.fromBytes(name, mime, bytes))
  handle("mention:folders", (query, recent) => folderHits(String(query ?? ""), Array.isArray(recent) ? recent.filter((p): p is string => typeof p === "string") : []))
  handle("mention:apps", () => appNames())
  handle("app:openExternal", (url) => {
    const u = new URL(url)
    if (u.protocol !== "https:" && u.protocol !== "http:" && u.protocol !== "mailto:") throw new Error("Only web links can be opened.")
    void shell.openExternal(u.toString())
  })

  handle("quick:toggle", () => quickbar.show())
  handle("quick:hide", () => quickbar.hide())
  handle("quick:resize", (height) => quickbar.resize(height))
  handle("quick:openInMain", (threadId) => quickbar.openInMain(threadId))
  handle("quick:openWatch", (id) => quickbar.openWatchInMain(id))
  handle("quick:capture", (what) => quickbar.capture(what))
  handle("doit:access", () => computerAccess())
  handle("voice:microphone", () => voice.microphone())
  handle("voice:openMicSettings", () => voice.openMicSettings())
  handle("voice:transcribe", (audio, mime) => voice.transcribe(audio, mime))
  handle("voice:onDevice", () => voice.onDevice())
  handle("voice:transcribeOnDevice", (wav) => voice.transcribeOnDevice(wav))

  handle("updates:get", () => ({ version: app.getVersion(), state: updates.updateState() }))
  handle("updates:check", () => updates.checkForUpdates())
  handle("updates:install", () => updates.installUpdate())

  onSettingsChange((next, previous) => {
    // Every window draws from the saved settings, not only the one that changed them.
    emit("settings", next)
    if (next.theme !== previous.theme) applyTheme(next.theme)
    // A session belongs to one server.
    if (next.baseURL !== previous.baseURL && account.isSignedIn()) account.signOut()
    if (next.baseURL !== previous.baseURL) void catalog().then((c) => emit("models", c))
  })

  // The agent list refreshes from the registry once a day.
  const timer = setInterval(() => void loadRegistry().then(() => catalog()).then((c) => emit("models", c)), 6 * 60 * 60 * 1000)
  timer.unref?.()
}

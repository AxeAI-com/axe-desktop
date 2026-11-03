import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { hostname } from "node:os"

import { app, BrowserWindow, dialog, shell } from "electron"

import { deviceId, isDeviceId } from "@shared/remote-pairing"

import { client, currentProfile, isSignedIn, onSignedIn, onSignedOut } from "../axe/account"
import type { PhoneLogEntry } from "@shared/types"

import { emit, onEmit } from "../bus"
import * as attachments from "../attachments"
import * as chat from "../chat"
import { catalog } from "../commands"
import { handle } from "../ipc"
import { dataPath, isSelfTest, readJSON, writeJSON } from "../paths"
import { onSettingsChange, settings, updateSettings } from "../settings"
import { deviceKeys } from "./device-keys"
import { startLink } from "./link"
import { PhoneControl } from "./phone-chat"
import { Phones, type SavedPhones } from "./phones"
import * as power from "./power"
import { watchesActive, watchesNext } from "../watching"
import { Approvals } from "./approvals"
import { RemoteLink } from "./remote"

// What waits on you, keep-awake, remote control from axeai.com and paired phones, wired to Electron.
// The logic lives in approvals.ts, remote.ts, phones.ts and phone-chat.ts, which run without Electron in unit tests.

let remote: RemoteLink | undefined
let phoneLink: Awaited<ReturnType<typeof startLink>> | undefined
let linkStarting = false
/** Phones with a live sealed session now. */
let live: string[] = []
let kept = false

/** A chat is working, or a watch waits for its next check: closing the window shouldn't stop it. */
export const keepAlive = () => chat.isBusy() || watchesActive()

const deviceName = () => {
  // Test runs name the computer themselves, so screenshots never show the real one.
  if (isSelfTest() && process.env.AXE_DEVICE_NAME) return process.env.AXE_DEVICE_NAME.slice(0, 80)
  const name = hostname().replace(/\.local$/, "").slice(0, 80)
  return name || (process.platform === "darwin" ? "Mac" : process.platform === "win32" ? "Windows PC" : "Linux computer")
}

/** What a phone shows while it waits ("David's MacBook Pro"): the name set in System Settings. */
const computerName = () => {
  if (process.platform === "darwin" && !isSelfTest()) {
    try {
      const name = execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], { encoding: "utf8", timeout: 2000 }).trim()
      if (name) return name.slice(0, 80)
    } catch {}
  }
  return deviceName()
}

const phoneEnabled = () => settings().phoneEnabled === true && isSignedIn()

// "Connect David's iPhone?", answered in the window (phones:answer). One at a time; 80 seconds, then no.
const asks = new Map<string, (allow: boolean) => void>()
function askPhone(phone: { name: string; agent: string }, showMain: () => void): Promise<boolean> {
  if (isSelfTest() && process.env.AXE_PHONE_ALLOW !== undefined) return Promise.resolve(process.env.AXE_PHONE_ALLOW === "1")
  const id = randomUUID()
  showMain()
  emit("phoneAsk", { id, name: phone.name, agent: phone.agent })
  return new Promise((resolve) => {
    const done = (allow: boolean) => {
      if (!asks.delete(id)) return
      clearTimeout(timer)
      emit("phoneAsk", null)
      resolve(allow)
    }
    const timer = setTimeout(() => done(false), 80_000)
    asks.set(id, done)
  })
}

/** Remote control is on by default once signed in; self-tests only connect when asked (AXE_REMOTE=1). */
const remoteEnabled = () => (isSelfTest() ? process.env.AXE_REMOTE === "1" : settings().remoteEnabled !== false)

async function askToAllow(browser: string): Promise<boolean> {
  if (isSelfTest()) return process.env.AXE_REMOTE_ALLOW === "1"
  const signal = AbortSignal.timeout(80_000)
  const win = BrowserWindow.getAllWindows().find((w) => w.isVisible())
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title: "Axe AI",
    message: `Allow ${browser} to control this computer?`,
    detail: "It could answer what's waiting for you and keep this computer awake, for 7 days. Only allow it if you just asked for this on axeai.com.",
    buttons: ["Allow for 7 days", "Don't allow"],
    defaultId: 1,
    cancelId: 1,
    signal,
  }
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return !signal.aborted && response === 0
}

export function startRemote(opts: { showMain: () => void }) {
  const approvals = new Approvals({ title: (threadId) => chat.threadTitle(threadId), answer: (requestId, optionId) => chat.answerPermission(requestId, optionId), now: () => new Date() })
  chat.onTurnEvent((e) => {
    approvals.onTurn(e)
    power.update()
  })

  power.start({ busy: () => chat.isBusy(), nextRuns: watchesNext, onChange: () => (emit("power", power.report()), remote?.sendPower()) })

  let memoryPhones: SavedPhones = { phones: [] }
  const phones = new Phones({
    keys: deviceKeys,
    userId: () => currentProfile()?.id,
    enabled: phoneEnabled,
    macName: computerName,
    origin: () => settings().baseURL,
    ask: (phone) => askPhone(phone, opts.showMain),
    load: () => (isSelfTest() ? memoryPhones : readJSON<SavedPhones>(dataPath("phones.json"), { phones: [] })),
    save: (saved) => (isSelfTest() ? (memoryPhones = saved) : writeJSON(dataPath("phones.json"), saved)),
    emit: (view) => emit("phones", view),
    now: () => Date.now(),
    live: () => live,
  })

  // "What the phone did": the last 200 things, kept on this computer.
  let phoneLog: PhoneLogEntry[] = isSelfTest() ? [] : readJSON<PhoneLogEntry[]>(dataPath("phone-log.json"), [])
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  function addLog(phone: string, name: string, text: string) {
    phoneLog = [{ at: Date.now(), phone, name, text }, ...phoneLog].slice(0, 200)
    if (!isSelfTest()) writeJSON(dataPath("phone-log.json"), phoneLog)
    emit("phoneLog", phoneLog)
  }
  const phoneChat = new PhoneControl({
    chat: {
      listThreads: () => chat.listThreads(),
      messages: (id) => chat.threadMessages(id),
      send: (request) => chat.send(request),
      stop: (id) => chat.stop(id),
      setMode: (id, mode) => chat.setMode(id, mode),
      modeOf: (id) => chat.modeOf(id),
      isRunning: (id) => chat.isRunning(id),
      title: (id) => chat.threadTitle(id),
      answer: (requestId, optionId) => chat.answerPermission(requestId, optionId),
    },
    saveFile: (name, bytes) => attachments.fromBytes(name, attachments.mimeOf(name), bytes),
    catalog: () => catalog(),
    phoneName: async (phone) => (await phones.phone(phone))?.name ?? "A phone",
    sendTo: async (phone, m) => (await phoneLink?.sendTo(phone, m)) ?? false,
    broadcast: (kind, body, chatId) => void phoneLink?.broadcast(kind, body, chatId),
    log: (entry) => {
      addLog(entry.phone, entry.name, entry.text)
      if (entry.bypass) {
        // Bypass from a phone shows on the banner at once .
        emit("phoneNotice", { text: `${entry.name}: ${entry.text}` })
        if (noticeTimer) clearTimeout(noticeTimer)
        noticeTimer = setTimeout(() => emit("phoneNotice", null), 10_000)
      }
    },
    now: () => Date.now(),
  })
  const askThreads = new Map<string, string>()
  onEmit((event, payload) => {
    // What the agents wait on is tracked even while no phone is linked, so it's never stale later.
    if (event === "permission") {
      const p = payload as Parameters<PhoneControl["asked"]>[0]
      askThreads.set(p.id, p.threadId)
      return phoneChat.asked(p)
    }
    if (event === "permissionDone") {
      const { id } = payload as { id: string }
      const thread = askThreads.get(id)
      askThreads.delete(id)
      if (thread) phoneChat.answered(thread, id)
      return
    }
    if (!phoneLink) return
    if (event === "threads") phoneChat.threadsChanged(payload as Parameters<PhoneControl["threadsChanged"]>[0])
    else if (event === "reply") phoneChat.reply(payload as Parameters<PhoneControl["reply"]>[0])
    else if (event === "mode") {
      const m = payload as { threadId: string; mode: Parameters<PhoneControl["modeChanged"]>[1] }
      phoneChat.modeChanged(m.threadId, m.mode)
    }
  })

  // The sealed link to paired phones runs while "Let my phone use this Mac" is on and you're signed in.
  async function refreshLink() {
    const want = phoneEnabled()
    if (want && !phoneLink && !linkStarting) {
      linkStarting = true
      try {
        phoneLink = await startLink({
          keys: deviceKeys,
          client: () => (isSignedIn() ? client() : undefined),
          userId: () => currentProfile()?.id,
          baseURL: () => settings().baseURL,
          phones,
          onLive: (ids) => {
            const added = ids.filter((id) => !live.includes(id))
            live = ids
            void phones.view().then((v) => emit("phones", v))
            for (const id of added) void phones.phone(id).then((p) => addLog(id, p?.name ?? "A phone", "Connected"))
          },
          onMessage: (phone, m) => void phoneChat.handle(phone, m),
        })
      } finally {
        linkStarting = false
      }
      if (!phoneEnabled()) void refreshLink()
      // No keys yet (the Keychain was locked or the prompt denied): try again in a minute.
      else if (!phoneLink) setTimeout(() => void refreshLink(), 60_000).unref?.()
    } else if (!want && phoneLink) {
      phoneLink.stop()
      phoneLink = undefined
      live = []
      void phones.view().then((v) => emit("phones", v))
    }
  }
  // Test runs only: a steady stream of events, to prove resume across a deploy (tests/e2e/link-run.mjs).
  if (isSelfTest() && process.env.AXE_LINK_TICKS) {
    let n = 0
    setInterval(() => phoneLink?.broadcast("tick", { n: ++n }), Number(process.env.AXE_LINK_TICKS) || 250).unref?.()
  }

  const link = new RemoteLink({
    client: () => (isSignedIn() ? client() : undefined),
    // The link also carries phones' pairing, so it's up while either is on.
    enabled: () => remoteEnabled() || phoneEnabled(),
    commandsEnabled: remoteEnabled,
    phones,
    macId: async () => {
      const k = await deviceKeys()
      return k ? deviceId(k.pub.ed) : undefined
    },
    approvals,
    doing: () => chat.runningCount(),
    deviceName,
    platform: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux",
    version: app.getVersion(),
    wake: power.wakeSupport(),
    power,
    askToAllow,
    load: () => (isSelfTest() ? { code: "", created: 0 } : readJSON(dataPath("remote.json"), { code: "", created: 0 })),
    save: (saved) => !isSelfTest() && writeJSON(dataPath("remote.json"), saved),
    emit: (state) => emit("remote", state),
  })
  remote = link
  link.refresh()
  void refreshLink()
  onSignedIn(() => (link.refresh(), void refreshLink()))
  onSignedOut(() => (phones.forgetQR(), link.refresh(), void refreshLink()))
  onSettingsChange((next, previous) => {
    if (next.remoteEnabled !== previous.remoteEnabled || next.phoneEnabled !== previous.phoneEnabled) link.refresh()
    if (next.phoneEnabled !== previous.phoneEnabled && !next.phoneEnabled) phones.forgetQR()
    if (next.phoneEnabled !== previous.phoneEnabled) void refreshLink()
    if (next.keepAwake !== previous.keepAwake) power.update()
  })
  handle("chat:stop", (threadId) => chat.stop(threadId))
  handle("power:get", () => power.report())
  handle("power:set", (mode) => (power.setMode(mode), power.report()))
  handle("remote:get", () => link.state())
  handle("remote:setEnabled", (on) => (updateSettings({ remoteEnabled: on }), link.refresh(), link.state()))
  handle("remote:newCode", () => link.newCode())
  handle("phones:get", () => phones.view())
  handle("phones:setEnabled", async (on) => (updateSettings({ phoneEnabled: on }), link.refresh(), phones.view()))
  handle("phones:code", async () => (await phones.qr()) ?? null)
  handle("phones:remove", async (id) => {
    if (!isDeviceId(id)) return phones.view()
    getLink()?.kick(id)
    await link.removePhone(id)
    return phones.view()
  })
  handle("phones:answer", (askId, allow) => {
    if (typeof askId === "string") asks.get(askId)?.(allow === true)
  })
  handle("phones:log", () => phoneLog)
  handle("phones:stop", async () => (updateSettings({ phoneEnabled: false }), link.refresh(), phones.view()))

  // Windows and Linux: while a chat works or a watch waits, the app keeps running in the tray
  // (tray.ts) after the window closes, and quits once that's done.
  function updateTray() {
    if (process.platform === "darwin" || isSelfTest()) return
    if (keepAlive()) kept = true
    else if (kept && BrowserWindow.getAllWindows().every((w) => !w.isVisible())) app.quit()
  }
  chat.onTurnEvent(() => updateTray())
  updateTray()
}

const getLink = () => phoneLink

export function stopRemote() {
  phoneLink?.stop()
  remote?.stop()
  power.stop()
}

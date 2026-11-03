import { AnimatePresence, MotionConfig, motion } from "motion/react"
import { useEffect } from "react"

import { D, spring, useMotion } from "@/lib/motion"
import { invoke, isMac, on } from "@/lib/bridge"
import { match, type Shortcut } from "@/lib/shortcuts"
import { getState, openSettings, openThread, resolvedTheme, start, useStore, type View } from "@/lib/store"
import { loadWatching } from "@/lib/watching"

import { CommandPalette } from "@/components/CommandPalette"
import { PhoneAsk } from "@/components/PhoneAsk"
import { PhoneBanner } from "@/components/PhoneBanner"
import { TrayComposer, TrayFooter, TrayHeader, TrayHome } from "@/components/tray/TrayPanel"
import { Forest } from "@/components/Forest"
import { Sidebar } from "@/components/Sidebar"
import { TitleBar } from "@/components/TitleBar"
import { Agents } from "@/screens/Agents"
import { NewWatch, Watch, Watching } from "@/screens/Watching"
import { Connectors } from "@/screens/Connectors"
import { TalkOverlay } from "@/components/Voice"
import { TerminalPanel } from "@/components/TerminalPanel"
import { NewChat } from "@/screens/NewChat"
import { Settings } from "@/screens/Settings"
import { Skills } from "@/screens/Skills"
import { QuickBar } from "@/screens/QuickBar"
import { Thread } from "@/screens/Thread"

export function useTheme() {
  const theme = useStore((s) => s.settings.theme)
  useEffect(() => {
    const apply = () => {
      const t = resolvedTheme(theme)
      document.documentElement.dataset.theme = t
      // The website's tokens (and Pasta UI) key dark on the .dark class.
      document.documentElement.classList.toggle("dark", t === "dark")
    }
    // The Mac window is see-through glass behind the sidebar (src/main/index.ts); see `.vibrant` in styles.css.
    document.documentElement.classList.toggle("vibrant", isMac() && !("__axeMock" in window))
    apply()
    if (theme !== "system") return
    const mq = matchMedia("(prefers-color-scheme: light)")
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [theme])
}

export function useShortcuts() {
  useEffect(() => {
    // A hold shortcut (⌘D to dictate) waits for its key, or ⌘, to come up.
    let held: Shortcut | null = null
    const key = (e: KeyboardEvent) => {
      if (!getState().profile) return
      const hit = match(e)
      if (!hit) return
      e.preventDefault()
      if (e.repeat) return
      if (hit.release) held = hit
      hit.run()
    }
    const up = (e: KeyboardEvent) => {
      if (!held) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (k === held.key || e.key === "Meta" || e.key === "Control") {
        const s = held
        held = null
        s.release?.()
      }
    }
    // Switching apps mid-hold counts as letting go.
    const blur = () => up(new KeyboardEvent("keyup", { key: "Meta" }))
    window.addEventListener("keydown", key)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("keydown", key)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
    }
  }, [])
}

/** The quick bar or the menu bar panel hands a chat (or Settings) over: open it here. */
function useHandOver() {
  useEffect(() => {
    const offs = [on("navigate", ({ threadId }) => void openThread(threadId)), on("openSettings", () => openSettings())]
    return () => offs.forEach((off) => off())
  }, [])
}

const viewKey = (v: View) => (v.kind === "thread" || v.kind === "watch" ? `${v.kind}-${v.id}` : v.kind)

function Screen({ view }: { view: View }) {
  switch (view.kind) {
    case "thread":
      return <Thread threadId={view.id} />
    case "settings":
      return <Settings />
    case "skills":
      return <Skills />
    case "agents":
      return <Agents />
    case "connectors":
      return <Connectors />
    case "watching":
      return <Watching />
    case "newWatch":
      return <NewWatch draft={view.draft} />
    case "watch":
      return <Watch id={view.id} />
    default:
      return <NewChat />
  }
}

function Main() {
  const view = useStore((s) => s.view)
  const m = useMotion()
  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-background">
      <Forest />
      <TitleBar />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={viewKey(view)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={m.t(D.fast)}
          className="relative flex min-h-0 flex-1 flex-col"
        >
          <Screen view={view} />
        </motion.div>
      </AnimatePresence>
      <TerminalPanel />
    </main>
  )
}

export function App() {
  const boot = useStore((s) => s.boot)
  useTheme()
  useShortcuts()
  useHandOver()

  useEffect(() => {
    void start()
  }, [])

  const mock = typeof window !== "undefined" && "__axeMock" in window

  return (
    <MotionConfig reducedMotion="user" transition={spring()}>
      {mock && (
        <div className="mock-lights" aria-hidden="true">
          <i style={{ background: "#FF5F57" }} />
          <i style={{ background: "#FEBC2E" }} />
          <i style={{ background: "#28C840" }} />
        </div>
      )}
      {boot === "loading" ? (
        <div className="drag h-full bg-ground" />
      ) : (
        <div className="flex h-full bg-ground text-ink">
          <Sidebar />
          <Main />
          <CommandPalette />
          <TalkOverlay />
          <PhoneAsk />
          <PhoneBanner />
        </div>
      )}
    </MotionConfig>
  )
}

/** The quick bar's window (#quick). In a plain browser (tests) it sits on a stand-in desktop. */
export function QuickApp() {
  useTheme()
  useEffect(() => {
    document.documentElement.classList.add("quick")
    void start()
  }, [])
  const mock = typeof window !== "undefined" && "__axeMock" in window
  const seed = mock ? (new URLSearchParams(location.search).get("thread") ?? undefined) : undefined
  return (
    <MotionConfig reducedMotion="user" transition={spring()}>
      <div className={mock ? "flex h-full items-start justify-center bg-[var(--desk)] pt-[96px]" : "flex items-start justify-center p-8"}>
        <QuickBar seedThread={seed} />
      </div>
    </MotionConfig>
  )
}

/**
 * The menu bar panel (#tray, or #tray-glass where the window is system glass): your watches, recent
 * chats and a box to ask from; a chat opens in the panel, small and flat. Esc or a click away closes it.
 */
export function TrayApp({ glass }: { glass: boolean }) {
  useTheme()
  const boot = useStore((s) => s.boot)
  const view = useStore((s) => s.view)
  const threadId = view.kind === "thread" ? view.id : null
  const title = useStore((s) => (threadId ? s.threads.find((t) => t.id === threadId)?.title : undefined))

  useEffect(() => {
    document.documentElement.classList.add("tray")
    if (glass) document.documentElement.classList.add("tray-glass")
    void start().then(() => loadWatching())
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) void invoke("tray:hide")
      // The footer's two links.
      const mod = isMac() ? e.metaKey : e.ctrlKey
      if (mod && !e.shiftKey && !e.altKey && (e.key === "," || e.key.toLowerCase() === "o")) {
        e.preventDefault()
        if (e.key === ",") void invoke("tray:open", "settings")
        else void invoke("tray:openInMain", getState().view.kind === "thread" ? (getState().view as { id: string }).id : null)
      }
    }
    window.addEventListener("keydown", key)
    const off = on("trayShown", () => {
      void loadWatching()
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus())
    })
    return () => {
      window.removeEventListener("keydown", key)
      off()
    }
  }, [glass])

  return (
    <MotionConfig reducedMotion="user" transition={spring()}>
      {boot === "loading" ? (
        <div className="h-full" />
      ) : (
        <div className="flex h-full flex-col p-[6px] text-[13px] text-ink">
          <TrayHeader threadId={threadId} title={title} />
          {threadId ? <Thread threadId={threadId} panel /> : <TrayHome />}
          <TrayComposer key={threadId ?? "home"} threadId={threadId} />
          <TrayFooter />
        </div>
      )}
    </MotionConfig>
  )
}

import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { encode } from "uqr"

import type { Answerer, MemoryItem, ModelServer, PairingCode, PhoneLogEntry, PhonesView } from "@shared/types"

import { acceleratorFromKey, displayAccelerator } from "@shared/accelerator"
import { isSummaryAt, SUMMARY_AT, SUMMARY_DEFAULT, SUMMARY_LABEL } from "@shared/watching/summary"

import { invoke, on, platform } from "@/lib/bridge"
import { keysOf, shortcutById, takeSettingsSection, type SettingsSection } from "@/lib/shortcuts"
import { useMotion } from "@/lib/motion"
import {
  addMemory,
  addModelServer,
  cancelPull,
  deleteMemory,
  installAgent,
  loadMemory,
  plainError,
  pullModel,
  refreshModels,
  removeModelServer,
  setState,
  setTheme,
  signIn,
  signOut,
  startOllama,
  updateMemory,
  updateSettings,
  useStore,
} from "@/lib/store"

import { ClockIcon, PencilIcon, PhoneIcon, PlusIcon, TrashIcon } from "@/components/Icons"
import { PAGE_TOP, Switch } from "@/components/Library"
import { Select } from "@/components/Select"

import { agentLogo, LogoTile, serverLogo } from "@/components/BrandLogo"
import { Avatar } from "@/components/Sidebar"
import { UpdateRow } from "@/components/Update"

function Section({ title, children, i, id }: { title: string; children: ReactNode; i: number; id?: SettingsSection }) {
  const m = useMotion()
  return (
    <motion.section
      id={id ? `settings-${id}` : undefined}
      {...m.rise}
      transition={{ ...m.t(0.32), delay: m.reduced ? 0 : 0.04 * i }}
      className="flex scroll-mt-[40px] flex-col"
    >
      <h2 className="m-[0px] mb-[12px] text-[15px] leading-[24px] font-normal text-foreground">{title}</h2>
      {/* A card: rows sit on the card fill and are split by a 1px gap that shows the page. */}
      <div className="flex flex-col gap-[2px] overflow-hidden rounded-[16px] bg-background shadow-card">{children}</div>
    </motion.section>
  )
}

// One empty list, so a missing catalog doesn't hand React a new array on every render (an endless loop).
const NO_AGENTS: never[] = []

const Row = ({ children, pad = "py-[12px]", id }: { children: ReactNode; pad?: string; id?: string }) => (
  <div id={id} className={`scroll-mt-[40px] flex items-center gap-[12px] bg-card px-[16px] ${pad}`}>{children}</div>
)

/** Pasta UI's outline button. */
const ghost =
  "inline-flex h-[34px] shrink-0 items-center rounded-full border-0 bg-fill-4 px-[16px] text-[13px] text-foreground transition-colors duration-150 enabled:hover:bg-fill-3 disabled:opacity-40"

const brandPill = "inline-flex h-[34px] shrink-0 items-center rounded-full border-0 bg-brand px-[16px] text-[13px] text-white transition-colors duration-150 hover:bg-brand-hover"
const badPill = "inline-flex h-[28px] shrink-0 items-center rounded-full border-0 bg-bad/11 px-[12px] text-[13px] text-bad-ink transition-colors duration-150 hover:bg-bad/20"

/** Light, dark or the system's: one pill with three choices. */
function ThemeRow() {
  const theme = useStore((s) => s.settings.theme)
  return (
    <Row>
      <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
        <span className="text-[14px] leading-[20px]">Theme</span>
      </div>
      <div role="group" aria-label="Theme" className="flex gap-[2px] rounded-full bg-segment p-[3px] dark:bg-background">
        {(["system", "light", "dark"] as const).map((t) => (
          <button
            key={t}
            aria-pressed={theme === t}
            onClick={() => void setTheme(t)}
            className={`h-[30px] rounded-full border-0 px-[16px] text-[13px] capitalize transition-colors duration-150 ${theme === t ? "bg-raised-2 text-foreground shadow-card dark:bg-fill-4" : "bg-transparent text-ink-3 hover:text-ink"}`}
          >
            {t}
          </button>
        ))}
      </div>
    </Row>
  )
}

export function Settings() {
  const profile = useStore((s) => s.profile)
  const agents = useStore((s) => s.catalog?.agents ?? NO_AGENTS)
  const [installing, setInstalling] = useState<string | null>(null)
  const m = useMotion()

  // Opened from the palette at a section: bring it into view.
  useEffect(() => {
    const go = (id: SettingsSection | null) => {
      if (!id) return
      requestAnimationFrame(() => document.getElementById(`settings-${id}`)?.scrollIntoView({ block: "start", behavior: m.reduced ? "auto" : "smooth" }))
    }
    go(takeSettingsSection())
    const on = (e: Event) => go((e as CustomEvent<SettingsSection>).detail)
    window.addEventListener("axe:settings-section", on)
    return () => window.removeEventListener("axe:settings-section", on)
  }, [m.reduced])

  const install = async (id: string) => {
    setInstalling(id)
    try {
      await installAgent(id)
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className={PAGE_TOP}>
      <div className="flex h-max w-[920px] max-w-[calc(100%-48px)] flex-col gap-[24px] pt-[24px] pb-[200px]">
        {!profile && (
          <Section title="Account" i={1} id="account">
            <Row>
              <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
                <span className="text-[14px] leading-[20px]">Not signed in</span>
                <span className="text-[13px] text-ink-3">CLI agents work without an account. Sign in for Axe's models.</span>
              </div>
              <button className={ghost} onClick={() => void signIn()}>
                Sign in
              </button>
            </Row>
          </Section>
        )}
        {profile && (
          <Section title="Account" i={1} id="account">
            <Row>
              <Avatar profile={profile} size={34} />
              <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
                <span className="truncate text-[14px] leading-[20px]">{profile.name || profile.email}</span>
                <span className="text-[12px] leading-[17px] text-ink-3 tabular-nums">
                  {[`${profile.plan ?? "Free"} plan`, `${(profile.credits ?? 0).toLocaleString("en-US")} credits`].join(", ")}
                </span>
              </div>
              <button className={brandPill} onClick={() => void invoke("account:openBilling")}>
                Add credits
              </button>
            </Row>
            <ThemeRow />
            <Row>
              <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
                <span className="text-[14px] leading-[20px]">Sign out</span>
                <span className="text-[12px] leading-[17px] text-ink-3">Signed in as {profile.email}</span>
              </div>
              <button className={ghost} onClick={() => void signOut()}>
                Sign out
              </button>
            </Row>
          </Section>
        )}

        {profile && <MemorySection i={2} />}

        {profile && <PhoneSections i={2} />}

        <VoiceSection i={3} />

        <NotificationsSection i={4} />


        <Section title="Permissions" i={4}>
          <FullAccess />
        </Section>

        <Section title="Updates" i={5} id="updates">
          <UpdateRow ghost={ghost} />
        </Section>

        <ModelsSection i={6} />

        <Section title="CLIs on this computer" i={7} id="clis">
          {agents.map((a) => {
            return (
              <Row key={a.id} pad="py-[12px]">
                <LogoTile logo={agentLogo(a)} name={a.name} size={28} />
                <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
                  <span className="text-[14px] leading-[20px]">{a.name}</span>
                  <span className="truncate text-[12px] leading-[17px] text-ink-3">{a.state === "unavailable" && a.reason ? a.reason : a.note}</span>
                </div>
                {a.state === "install" ? (
                  <button className={ghost} disabled={installing === a.id} onClick={() => void install(a.id)}>
                    {installing === a.id ? "Installing" : "Install"}
                  </button>
                ) : (
                  <span className={`inline-flex items-center gap-[6px] text-[13px] ${a.state === "ready" ? "text-live" : "text-ink-3"}`}>
                    {a.state === "ready" && <span aria-hidden="true" className="size-[6px] shrink-0 rounded-full bg-live" />}
                    {a.state === "ready" ? "Ready" : "Unavailable"}
                  </span>
                )}
              </Row>
            )
          })}
          {!agents.length && (
            <Row>
              <span className="text-[13px] text-ink-3">Looking for CLIs on this computer</span>
            </Row>
          )}
        </Section>
      </div>
    </div>
  )
}

/**
 * Model servers on this computer: Ollama, LM Studio and llama.cpp show up by themselves when they run,
 * with a tick and what they have loaded; any other one (Jan, vLLM, a box on your network) is added by
 * its address. Ollama can be started from here (or when Axe opens) and gets models by name. Below, who
 * new boards check with.
 */
function ModelsSection({ i }: { i: number }) {
  const catalog = useStore((s) => s.catalog)
  const boardAnswerer = useStore((s) => s.settings.boardAnswerer)
  const servers = catalog?.servers ?? []
  const [adding, setAdding] = useState(false)
  const [address, setAddress] = useState("")
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void refreshModels(), [])

  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      await addModelServer(address, key || undefined)
      setAdding(false)
      setAddress("")
      setKey("")
    } catch (e) {
      setError(plainError(e))
    } finally {
      setBusy(false)
    }
  }

  const keyOf = (a?: Answerer | null) => (!a ? "" : a.kind === "agent" ? `agent:${a.agentId}` : `${a.kind}:${a.modelId}`)
  const pick = (v: string) => {
    const [kind, ...rest] = v.split(":")
    const id = rest.join(":")
    const a: Answerer | null = kind === "local" || kind === "axe" ? { kind, modelId: id } : kind === "agent" ? { kind: "agent", agentId: id } : null
    void updateSettings({ boardAnswerer: a })
  }
  const field = "h-[34px] rounded-full border-0 bg-fill-4 px-[16px] text-[13px] text-foreground outline-none placeholder:text-ink-3"

  return (
    <Section title="Models on this computer" i={i} id="models">
      {servers.map((s) =>
        s.id === "ollama" ? (
          <OllamaRows key={s.id} server={s} />
        ) : (
          <Row key={s.id} pad="py-[12px]">
            <LogoTile logo={serverLogo(s)} name={s.name} size={28} />
            <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
              <span className="text-[14px] leading-[20px]">{s.name}</span>
              <span className="truncate text-[12px] leading-[17px] text-ink-3">
                {!s.found ? "Not answering right now" : s.models.length ? s.models.map((m) => m.name).join(", ") : "No models loaded"}
              </span>
            </div>
            {s.custom && (
              <button className={badPill} onClick={() => void removeModelServer(s.id)}>
                Remove
              </button>
            )}
          </Row>
        ),
      )}
      <Row>
        <span className="text-[12px] leading-[17px] text-ink-3">Start Ollama, LM Studio or llama.cpp and its models appear here, free.</span>
      </Row>
      {adding ? (
        <div className="flex flex-col gap-[8px] bg-card px-[16px] py-[12px]">
          <input aria-label="Address" autoFocus className={field} placeholder="http://192.168.1.20:8000/v1" value={address} onChange={(e) => setAddress(e.target.value)} />
          <input aria-label="Key, if it needs one" type="password" className={field} placeholder="Key, if it needs one" value={key} onChange={(e) => setKey(e.target.value)} />
          {error && <p className="m-[0px] text-[13px] text-warn-ink">{error}</p>}
          <div className="flex justify-end gap-[4px]">
            <button className="h-[28px] rounded-full border-0 bg-transparent px-[12px] text-[13px] text-ink-3 hover:text-ink" onClick={() => (setAdding(false), setError(null))}>
              Cancel
            </button>
            <button className="h-[28px] rounded-full border-0 bg-fill-4 px-[14px] text-[13px] text-ink disabled:opacity-60" disabled={busy || !address.trim()} onClick={() => void add()}>
              {busy ? "Checking" : "Add"}
            </button>
          </div>
        </div>
      ) : (
        <Row>
          <button className="flex flex-1 items-center gap-[12px] border-0 bg-transparent p-0 text-left text-[14px] leading-[20px] text-ink-2 hover:text-ink" onClick={() => setAdding(true)}>
            <span className="flex size-[30px] items-center justify-center rounded-[9px] bg-fill-4">
              <PlusIcon size={14} />
            </span>
            Add a model server
          </button>
        </Row>
      )}
      <Row pad="py-[12px]">
        <span className="flex-1 text-[14px] leading-[20px]">New boards check with</span>
        <Select label="New boards check with" value={keyOf(boardAnswerer)} onChange={pick}>
          <option value="">{catalog?.local[0] ? `Smallest local model (${catalog.local[0].name})` : "No model, plain summaries"}</option>
          {catalog?.local.map((m) => (
            <option key={m.id} value={`local:${m.id}`}>
              {m.name}
            </option>
          ))}
          {catalog?.agents
            .filter((a) => a.state === "ready" && a.here)
            .map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>
                {a.name}
              </option>
            ))}
        </Select>
      </Row>
    </Section>
  )
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(bytes < 1e10 ? 1 : 0)} GB`

/**
 * Ollama's rows: running (its models), here but stopped (Start Ollama), or not on this computer. When
 * it's here: start it when Axe opens, and get a model by name, with the ones that fit this computer
 * offered first and the download's progress as it goes.
 */
function OllamaRows({ server: s }: { server: ModelServer }) {
  const startOnOpen = useStore((st) => !!st.settings.startOllama)
  const pull = useStore((st) => st.pull)
  const [starting, setStarting] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const here = s.found || !!s.canStart
  const field = "h-[34px] min-w-[0px] flex-1 rounded-full border-0 bg-fill-4 px-[16px] text-[13px] text-foreground outline-none placeholder:text-ink-3"

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      await startOllama()
    } catch (e) {
      setError(plainError(e))
    } finally {
      setStarting(false)
    }
  }
  const get = async (model: string) => {
    if (!model.trim() || pull) return
    setError(null)
    try {
      await pullModel(model)
      setName("")
    } catch (e) {
      const said = plainError(e)
      if (said !== "Download stopped.") setError(said)
    }
  }
  const status = s.found
    ? s.models.length
      ? s.models.map((m) => m.name).join(", ")
      : "Running, with no models yet"
    : s.canStart
      ? "Not running. Axe starts it when you send to one of its models."
      : "Not on this computer"
  const share = pull?.total ? Math.min(1, (pull.completed ?? 0) / pull.total) : 0
  const have = new Set(s.models.map((m) => m.model))
  const offer = (s.suggested ?? []).filter((m) => !have.has(m))

  return (
    <>
      <Row pad="py-[12px]">
        <LogoTile logo={serverLogo(s)} name={s.name} size={28} />
        <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
          <span className="text-[14px] leading-[20px]">{s.name}</span>
          <span className="truncate text-[12px] leading-[17px] text-ink-3">{status}</span>
        </div>
        {!s.found && s.canStart && (
          <button className={ghost} disabled={starting} onClick={() => void start()}>
            {starting ? "Starting" : "Start Ollama"}
          </button>
        )}
        {!here && (
          <button className={ghost} onClick={() => void invoke("app:openExternal", "https://ollama.com/download")}>
            Get Ollama
          </button>
        )}
      </Row>
      {here && (
        <Row>
          <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
            <span className="text-[14px] leading-[20px]">Start Ollama when Axe opens</span>
            <span className="text-[12px] leading-[17px] text-ink-3">Axe stops it again when you quit, if Axe started it.</span>
          </div>
          <Switch on={startOnOpen} onChange={(on) => void updateSettings({ startOllama: on })} label="Start Ollama when Axe opens" />
        </Row>
      )}
      {here && (
        <div className="flex flex-col gap-[8px] bg-card px-[16px] py-[12px]">
          <span className="text-[14px] leading-[20px]">Get a model</span>
          {pull ? (
            <div className="flex items-center gap-[12px]">
              <div className="flex min-w-[0px] flex-1 flex-col gap-[6px]">
                <span className="truncate text-[12px] leading-[17px] text-ink-3">
                  {pull.model}: {pull.status}
                  {pull.total ? `, ${gb(pull.completed ?? 0)} of ${gb(pull.total)}` : ""}
                </span>
                <div
                  role="progressbar"
                  aria-label={`Downloading ${pull.model}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(share * 100)}
                  className="h-[4px] overflow-hidden rounded-full bg-fill-4"
                >
                  <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${share * 100}%` }} />
                </div>
              </div>
              <button className={ghost} onClick={cancelPull}>
                Stop
              </button>
            </div>
          ) : (
            <>
              {offer.length > 0 && (
                <div className="flex flex-wrap items-center gap-[6px]">
                  <span className="text-[12px] leading-[17px] text-ink-3">Fits this computer and uses tools:</span>
                  {offer.map((m) => (
                    <button
                      key={m}
                      className="h-[28px] rounded-full border-0 bg-fill-4 px-[12px] text-[13px] text-foreground transition-colors duration-150 hover:bg-fill-3"
                      onClick={() => void get(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <form
                className="flex gap-[8px]"
                onSubmit={(e) => {
                  e.preventDefault()
                  void get(name)
                }}
              >
                <input aria-label="Model name" className={field} placeholder="Any model from ollama.com, like gemma3:4b" value={name} onChange={(e) => setName(e.target.value)} />
                <button type="submit" className={ghost} disabled={!name.trim()}>
                  Get
                </button>
              </form>
            </>
          )}
        </div>
      )}
      {error && (
        <Row>
          <p className="m-[0px] text-[13px] text-warn-ink">{error}</p>
        </Row>
      )}
    </>
  )
}

/** Full access: Axe and your CLIs act without asking first. Turning it on takes a second click; only you can. */
/** Watches' notifications and the morning summary: the only two notification settings. */
function NotificationsSection({ i }: { i: number }) {
  const on = useStore((s) => s.settings.watchNotify !== false)
  const at = useStore((s) => s.settings.summaryAt ?? SUMMARY_DEFAULT)
  return (
    <Section title="Notifications" i={i} id="notifications">
      <Row>
        <span className="flex-1 text-[14px] leading-[20px]">Watches</span>
        <Select label="Watches" value={on ? "on" : "off"} onChange={(v) => void updateSettings({ watchNotify: v === "on" })}>
          <option value="on">On</option>
          <option value="off">Off</option>
        </Select>
      </Row>
      <Row>
        <span className="flex-1 text-[14px] leading-[20px]">Morning summary</span>
        <Select label="Morning summary" value={at} onChange={(v) => isSummaryAt(v) && void updateSettings({ summaryAt: v })}>
          {SUMMARY_AT.map((a) => (
            <option key={a} value={a}>
              {SUMMARY_LABEL[a]}
            </option>
          ))}
        </Select>
      </Row>
    </Section>
  )
}

function FullAccess() {
  const on = useStore((s) => !!s.settings.fullAccess)
  const [confirming, setConfirming] = useState(false)
  return (
    <Row>
      <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
        <span className="text-[14px] leading-[20px]">Full access</span>
        <span className="text-[12px] leading-[17px] text-ink-3">
          {on
            ? "Axe and your CLIs act without asking first. Your Desktop, Documents, Downloads and Library still ask."
            : "Off. Axe asks before it sends, pays, deletes or changes things."}
        </span>
      </div>
      {on ? (
        <button className={ghost} onClick={() => void updateSettings({ fullAccess: false })}>
          Turn off
        </button>
      ) : confirming ? (
        <div className="flex shrink-0 items-center gap-[4px]">
          <button className="h-[34px] rounded-full border-0 bg-transparent px-[16px] text-[13px] text-ink-2 hover:text-ink" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            className={ghost}
            onClick={() => {
              setConfirming(false)
              void updateSettings({ fullAccess: true })
            }}
          >
            Turn on full access
          </button>
        </div>
      ) : (
        <button className={ghost} onClick={() => setConfirming(true)}>
          Turn on
        </button>
      )}
    </Row>

  )
}

/** What Axe remembers about you: a short list you can add to, change and remove from. */
function MemorySection({ i }: { i: number }) {
  const items = useStore((s) => s.memory)
  const [draft, setDraft] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const m = useMotion()

  useEffect(() => {
    void loadMemory()
  }, [])

  const add = async () => {
    if (!draft.trim()) return
    const err = await addMemory(draft)
    setProblem(err)
    if (!err) setDraft("")
  }

  return (
    <Section title="Memory" i={i} id="memory">
      <Row pad="py-[14px]">
        <span className="min-w-[0px] flex-1 text-[13px] leading-[19px] text-ink-2">
          Axe adds these to every new chat. Agent chats also read the folder's CLAUDE.md or AGENTS.md.
        </span>
      </Row>
      <AnimatePresence initial={false}>
        {(items ?? []).map((item) => (
          <motion.div key={item.id} {...m.collapse} className="overflow-hidden bg-card">
            <MemoryRow item={item} />
          </motion.div>
        ))}
      </AnimatePresence>
      {items && !items.length && (
        <Row>
          <span className="text-[14px] leading-[20px] text-ink-3">Nothing yet. Try your role, your city, or how you like answers.</span>
        </Row>
      )}
      <Row>
        <input
          aria-label="Something to remember"
          value={draft}
          placeholder="Add something to remember"
          onChange={(e) => {
            setDraft(e.target.value)
            setProblem(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add()
          }}
          className="h-[34px] min-w-[0px] flex-1 rounded-full border-0 bg-fill-4 px-[16px] text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
        <button className={ghost} disabled={!draft.trim()} onClick={() => void add()}>
          Add
        </button>
      </Row>
      {problem && <p className="m-[0px] bg-card px-[16px] pb-[12px] text-[12px] leading-[17px] text-bad">{problem}</p>}
    </Section>
  )
}

/** The quick bar's global shortcut (recorded by pressing it) and the voice keys. */
function VoiceSection({ i }: { i: number }) {
  const key = useStore((s) => s.settings.quickBarKey)
  const [recording, setRecording] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const dictate = shortcutById("dictate")
  const talk = shortcutById("talk")

  useEffect(() => {
    if (!recording) return
    const down = async (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false)
        return
      }
      const next = acceleratorFromKey(e, platform())
      if (!next) return
      setRecording(false)
      try {
        setState({ settings: await invoke("settings:set", { quickBarKey: next }) })
        setProblem(null)
      } catch (err) {
        setProblem(plainError(err))
      }
    }
    window.addEventListener("keydown", down, true)
    return () => window.removeEventListener("keydown", down, true)
  }, [recording])

  return (
    <Section title="Quick bar and voice" i={i} id="voice">
      <Row>
        <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
          <span className="text-[14px] leading-[20px]">Quick bar</span>
          <span className="text-[12px] leading-[17px] text-ink-3">Ask from any app. Click, then press the keys you want.</span>
        </div>
        <button
          ref={button}
          aria-label={recording ? "Press the new shortcut" : `Quick bar shortcut: ${displayAccelerator(key, platform())}. Change it`}
          onClick={() => {
            setProblem(null)
            setRecording((r) => !r)
          }}
          onBlur={() => setRecording(false)}
          className={`h-[32px] min-w-[64px] shrink-0 rounded-full border-0 px-[12px] text-[13px] transition-colors duration-150 ${
            recording ? "bg-brand-soft text-brand-text" : "bg-fill-4 text-ink hover:bg-fill-3"
          }`}
        >
          {recording ? "Press keys" : displayAccelerator(key, platform())}
        </button>
      </Row>
      {problem && <p className="m-[0px] bg-card px-[16px] pb-[8px] text-[12px] leading-[17px] text-bad">{problem}</p>}
      <Row>
        <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
          <span className="text-[14px] leading-[20px]">Dictate</span>
          <span className="text-[12px] leading-[17px] text-ink-3">Hold to talk, let go to write. Or tap to start and stop.</span>
        </div>
        <Keys>{dictate ? keysOf(dictate) : ""}</Keys>
      </Row>
      <Row>
        <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
          <span className="text-[14px] leading-[20px]">Talk to Axe</span>
          <span className="text-[12px] leading-[17px] text-ink-3">Speak, hear the answer, speak again. Uses your computer's voice.</span>
        </div>
        <Keys>{talk ? keysOf(talk) : ""}</Keys>
      </Row>
    </Section>
  )
}

const Keys = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex h-[32px] min-w-[64px] shrink-0 items-center justify-center rounded-full bg-fill-4 px-[12px] text-[13px] text-ink-3 tabular-nums">{children}</span>
)

function MemoryRow({ item }: { item: MemoryItem }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const [problem, setProblem] = useState<string | null>(null)
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) box.current?.select()
  }, [editing])

  const save = async () => {
    if (text.trim() === item.text) return setEditing(false)
    const err = await updateMemory(item.id, text)
    setProblem(err)
    if (!err) setEditing(false)
  }

  if (editing)
    return (
      <div className="flex flex-col bg-card px-[16px] py-[10px]">
        <div className="flex items-center gap-[12px]">
          <input
            ref={box}
            aria-label="Edit memory"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save()
              if (e.key === "Escape") {
                setText(item.text)
                setEditing(false)
              }
            }}
            className="h-[34px] min-w-[0px] flex-1 rounded-full border-0 bg-fill-4 px-[16px] text-[13px] text-ink outline-none"
          />
          <button className={ghost} onClick={() => void save()}>
            Save
          </button>
        </div>
        {problem && <p className="m-[0px] pt-[6px] text-[12px] leading-[17px] text-bad">{problem}</p>}
      </div>
    )

  return (
    <div className="flex items-center gap-[12px] bg-card px-[16px] py-[10px]">
      <span className="selectable min-w-[0px] flex-1 text-[14px] leading-[20px]">{item.text}</span>
      <div className="flex gap-[12px]">
        <button
          aria-label={`Edit ${item.text}`}
          title="Edit"
          onClick={() => setEditing(true)}
          className="flex size-[28px] items-center justify-center rounded-full border-0 bg-transparent text-ink-3 hover:bg-fill-2 hover:text-ink"
        >
          <PencilIcon size={13} />
        </button>
        <button
          aria-label={`Forget ${item.text}`}
          title="Forget"
          onClick={() => void deleteMemory(item.id)}
          className="flex size-[28px] items-center justify-center rounded-full border-0 bg-transparent text-ink-3 hover:bg-fill-2 hover:text-bad"
        >
          <TrashIcon size={13} />
        </button>
      </div>
    </div>
  )
}

/**
 * Use from your phone (board: Remote control, RCSettings and RCConnected). The QR is new every 2 minutes
 * and works once; a phone that scans it still needs Allow here (PhoneAsk). Phones lists each one with Remove.
 */
function PhoneSections({ i }: { i: number }) {
  const [view, setView] = useState<PhonesView | null>(null)
  const [code, setCode] = useState<PairingCode | null>(null)
  const [adding, setAdding] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [log, setLog] = useState<PhoneLogEntry[]>([])

  useEffect(() => {
    void invoke("phones:get").then(setView).catch(() => {})
    void invoke("phones:log").then(setLog).catch(() => {})
    const offPhones = on("phones", setView)
    const offLog = on("phoneLog", setLog)
    return () => (offPhones(), offLog())
  }, [])

  const phones = view?.phones ?? []
  const showCode = !!view?.enabled && view.available && (adding || !phones.length)

  // A new code when it runs out, or when one was used (the list changed).
  useEffect(() => {
    if (!showCode || !view) return setCode(null)
    let stop = false
    const fetch = () => void invoke("phones:code").then((c) => !stop && setCode(c)).catch(() => {})
    fetch()
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      stop = true
      clearInterval(tick)
    }
  }, [showCode, view])
  useEffect(() => {
    if (code && now >= code.expiresAt) void invoke("phones:code").then(setCode).catch(() => {})
  }, [code, now])
  useEffect(() => setAdding(false), [phones.length])

  if (!view) return null
  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0
  const phoneIcon = (
    <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px] bg-fill-4 text-white">
      <PhoneIcon size={15} />
    </span>
  )
  const live = view.enabled && view.available
  return (
    <Section title="Use from your phone" i={i} id="phone">
      <Row>
        <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
          <span className="text-[14px] leading-[20px]">Let my phone use this Mac</span>
          <span className="text-[12px] leading-[17px] text-ink-3">
            {view.available ? "Chat and approve from axeai.com on your phone." : "This computer has no place to keep its keys safe, so phones can't connect."}
          </span>
        </div>
        {view.available && <Switch flat on={view.enabled} onChange={(on) => void invoke("phones:setEnabled", on).then(setView)} label="Let my phone use this Mac" />}
      </Row>
      {showCode && code && (
        <div className="flex gap-[24px] bg-card px-[16px] py-[20px]">
          <QRCode text={code.link} />
          <div className="flex flex-col gap-[10px] pt-[6px]">
            <span className="text-[16px] leading-[22px]">Scan with your phone</span>
            <span className="text-[13px] leading-[20px] text-ink-2">Open axeai.com on your phone, tap Connect your Mac, and scan this.</span>
            <span className="flex items-center gap-[8px] text-[12px] leading-[17px] text-ink-3">
              <ClockIcon size={13} />
              New code in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}. Each code works once.
            </span>
          </div>
        </div>
      )}
      {live &&
        phones.map((p, n) => (
          <Row key={p.id} id={n === 0 ? "settings-phones" : undefined}>
            {phoneIcon}
            <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
              <span className="truncate text-[14px] leading-[20px]">{p.name}</span>
              <span className="truncate text-[12px] leading-[17px] text-ink-3">
                {p.connected ? "Connected now. " : ""}Added {new Date(p.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.
              </span>
            </div>
            <button className={badPill} onClick={() => void invoke("phones:remove", p.id).then(setView)}>
              Remove
            </button>
          </Row>
        ))}
      {live && phones.length > 0 && (
        <Row pad="py-[10px]">
          <button className="flex flex-1 items-center gap-[12px] border-0 bg-transparent p-0 text-left text-[14px] leading-[20px] text-ink-2" onClick={() => setAdding(true)}>
            <span className="flex size-[30px] items-center justify-center rounded-[9px] bg-fill-4">
              <PlusIcon size={14} />
            </span>
            Add a phone
          </button>
        </Row>
      )}
      {live && !phones.length && (
        <Row id="settings-phones">
          <span className="text-[14px] leading-[20px] text-ink-3">No phones yet</span>
        </Row>
      )}
      {view.enabled && log.length > 0 && (
        <>
          <Row id="settings-phone-log" pad="pt-[12px] pb-[4px]">
            <span className="text-[12px] leading-[22px] text-ink-3">Phone activity</span>
          </Row>
          {log.slice(0, 20).map((e) => (
            <Row key={`${e.at}-${e.text}`} pad="pt-[8px] pb-[14px]">
              <span className="w-[44px] shrink-0 text-[13px] text-ink-3 tabular-nums">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
              <span className="min-w-[0px] flex-1 truncate text-[13px]">{phones.length > 1 ? `${e.name}: ${e.text}` : e.text}</span>
            </Row>
          ))}
        </>
      )}
    </Section>
  )
}

/** A QR code drawn as one SVG path, dark on white whatever the theme, so every camera reads it. */
function QRCode({ text }: { text: string }) {
  const { data, size } = encode(text, { ecc: "M", border: 0 })
  let d = ""
  data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)))
  return (
    <div className="flex size-[196px] shrink-0 items-center justify-center rounded-[16px] bg-white">
      <svg width="164" height="164" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label="Pairing code for this Mac">
        <path d={d} fill="#08090b" />
      </svg>
    </div>
  )
}

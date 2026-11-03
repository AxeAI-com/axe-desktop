import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"

import { CATALOG } from "@shared/connectors"
import { kindOfPlugin } from "@shared/community"
import type { Answerer } from "@shared/types"

import { draftAgent, type AgentDraft } from "@/lib/agent-draft"
import { answererLabel, folderName } from "@/lib/answerer"
import { invoke } from "@/lib/bridge"
import { saveHelper } from "@/lib/libraries"
import { useMotion } from "@/lib/motion"
import { helperCommand } from "@/lib/slash"
import { getState, lastFolder, plainError, setState, useStore } from "@/lib/store"

import { agentLogo, BrandLogo, localModelLogo } from "./BrandLogo"
import { FolderIcon, XIcon } from "./Icons"
import { button } from "./Kit"
import { ErrorLine, HelperMark } from "./Library"
import { AxeMark } from "./Logo"

// The top of the Agents page: say what the agent should do, Axe sets it up (on this computer, no
// model call), you change what you like and make it. Then it's /its-name in any chat.

export function DescribeAgent() {
  const m = useMotion()
  const [text, setText] = useState("")
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<string | null>(null)

  const setUp = async () => {
    const sentence = text.trim()
    if (!sentence) return setError("Say what the agent should do.")
    setBusy(true)
    setError(null)
    setMade(null)
    const s = getState()
    const community = await invoke("community:skills", false).catch(() => [])
    const next = draftAgent(sentence, {
      agents: s.catalog?.agents ?? [],
      signedIn: !!s.profile,
      recentFolders: [...new Set(s.threads.filter((t) => t.source === "agent" && t.cwd).map((t) => t.copy?.source ?? t.cwd!))],
      lastFolder: lastFolder(s),
      catalog: CATALOG,
      connected: (s.library.connectors?.connected ?? []).map((c) => ({ id: c.id, catalogId: c.catalogId, name: c.name })),
      installed: (s.library.skills?.skills ?? []).filter((k) => k.installedIn.includes("axe")),
      community,
    })
    setDraft(next)
    setBusy(false)
  }

  const make = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      // Skills from the sources come in first, so the agent can name them.
      const ids: string[] = []
      for (const k of draft.skills) {
        if (k.id) ids.push(k.id)
        else if (k.key) {
          const before = new Set((getState().library.skills?.skills ?? []).map((x) => x.id))
          const lib = await invoke("community:installSkill", k.key, []).catch(() => null)
          if (lib) {
            setState((st) => ({ library: { ...st.library, skills: lib } }))
            const added = lib.skills.find((x) => !before.has(x.id)) ?? lib.skills.find((x) => x.name.toLowerCase() === k.name.toLowerCase())
            if (added) ids.push(added.id)
          }
        }
      }
      const e = await saveHelper({
        name: draft.name.trim() || "New agent",
        role: draft.role,
        instructions: draft.instructions,
        kind: draft.kind === "custom" ? kindOfPlugin(draft.name.toLowerCase()) : draft.kind,
        skills: ids,
        connectors: draft.connectors.flatMap((c) => (c.id ? [c.id] : [])),
        webSearch: draft.answerer.kind === "axe" && draft.kind === "research",
        answerer: draft.answerer,
        ...(draft.cwd ? { cwd: draft.cwd } : {}),
      })
      if (e) throw new Error(e)
      setMade(`/${helperCommand(draft.name)}`)
      setDraft(null)
      setText("")
    } catch (e) {
      setError(plainError(e))
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void setUp()
        }}
        className="flex h-[64px] items-center gap-[12px] rounded-[16px] bg-card py-0 pr-[12px] pl-[24px]"
      >
        <input
          aria-label="Describe an agent"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Every weekday at 9, review my open pull requests in axe-web and tell me what to fix"
          className="h-[40px] min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-4"
        />
        <button type="submit" disabled={busy || !text.trim()} className={button.primary}>
          {busy && !draft ? "Setting up" : "Create"}
        </button>
      </form>
      <ErrorLine text={error} />
      {made && (
        <p className="m-0 text-[13px] text-ink-2">
          Made. Type <span className="font-mono text-ink">{made}</span> in any chat to use it.
        </p>
      )}
      <AnimatePresence initial={false}>
        {draft && (
          <motion.div key="draft" {...m.rise} className="w-full max-w-[736px]">
            <DraftCard draft={draft} onChange={setDraft} busy={busy} onMake={() => void make()} onCancel={() => setDraft(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Who({ answerer }: { answerer: Answerer }) {
  const catalog = useStore((s) => s.catalog)
  const label = answererLabel(answerer, catalog)
  if (answerer.kind === "axe")
    return (
      <span className="flex items-center gap-[8px]">
        <AxeMark size={13} />
        {label}
      </span>
    )
  if (answerer.kind === "local") {
    const m = catalog?.local.find((x) => x.id === answerer.modelId)
    return (
      <span className="flex items-center gap-[8px]">
        <BrandLogo logo={m ? localModelLogo(m) : undefined} name={label} size={16} />
        {label}
      </span>
    )
  }
  const a = catalog?.agents.find((x) => x.id === answerer.agentId)
  return (
    <span className="flex items-center gap-[8px]">
      <BrandLogo logo={a ? agentLogo(a) : undefined} name={label} size={16} />
      {label}
    </span>
  )
}

function DraftCard({ draft, onChange, busy, onMake, onCancel }: { draft: AgentDraft; onChange: (d: AgentDraft) => void; busy: boolean; onMake: () => void; onCancel: () => void }) {
  const row = "contents"
  const label = "self-start pt-[5px] text-ink-3"
  const chip = "flex h-[28px] items-center gap-[6px] rounded-full bg-fill-2 py-0 pr-[6px] pl-[12px] text-[13px] text-ink"
  return (
    <section aria-label="Draft agent" className="flex flex-col rounded-[16px] bg-card">
      <div className="flex items-center gap-[14px] px-[20px] py-[16px]">
        <HelperMark kind={draft.kind} size={40} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <input
            aria-label="Agent name"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            className="border-0 bg-transparent p-0 text-[15px] text-ink outline-none"
          />
          <span className="truncate text-[13px] text-ink-3">{draft.role}</span>
        </div>
      </div>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-[16px] gap-y-[14px] px-[20px] py-[18px] text-[13px]">
        <div className={row}>
          <span className={label}>Works with</span>
          <span className="flex flex-wrap items-center gap-[12px] text-ink">
            <Who answerer={draft.answerer} />
            {draft.answerer.kind === "agent" && (
              <button
                type="button"
                onClick={() => void invoke("app:pickFolder").then((cwd) => cwd && onChange({ ...draft, cwd }))}
                className="flex h-[28px] items-center gap-[6px] rounded-full border-0 bg-transparent px-[10px] text-[13px] text-ink-2 hover:bg-fill hover:text-ink"
              >
                <FolderIcon size={13} />
                {draft.cwd ? folderName(draft.cwd) : "Choose a folder"}
              </button>
            )}
          </span>
        </div>
        <div className={row}>
          <span className={label}>Skills it found</span>
          {draft.skills.length ? (
            <div className="flex flex-wrap gap-[6px]">
              {draft.skills.map((k) => (
                <span key={k.key ?? k.id ?? k.name} className={chip}>
                  {k.name}
                  <span className="text-[12px] text-ink-3">{k.source}</span>
                  <button
                    type="button"
                    aria-label={`Leave out ${k.name}`}
                    onClick={() => onChange({ ...draft, skills: draft.skills.filter((x) => x !== k) })}
                    className="flex size-[24px] items-center justify-center rounded-full border-0 bg-transparent text-ink-3 hover:bg-fill-3 hover:text-ink"
                  >
                    <XIcon size={10} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-ink-3">None needed</span>
          )}
        </div>
        {draft.connectors.length > 0 && (
          <div className={row}>
            <span className={label}>Connects to</span>
            <span className="flex flex-wrap items-center gap-[12px]">
              {draft.connectors.map((c) => (
                <span key={c.catalogId} className="flex items-center gap-[8px] text-ink">
                  {c.name}
                  {!c.id && <span className="text-[12px] text-warn-ink">Connect it on the Connectors page first</span>}
                </span>
              ))}
            </span>
          </div>
        )}
        <div className={row}>
          <span className={label}>When</span>
          <span className="text-ink-3">When you call it with /{helperCommand(draft.name) || "its-name"}</span>
        </div>
      </div>
      <div className="flex items-center gap-[8px] px-[20px] pt-[6px] pb-[16px]">
        <span className="flex-1" />
        <button type="button" className={button.secondary} onClick={onCancel} disabled={busy}>
          Start over
        </button>
        <button type="button" className={button.primary} onClick={onMake} disabled={busy || !draft.name.trim()}>
          {busy ? "Making it" : "Make the agent"}
        </button>
      </div>
    </section>
  )
}

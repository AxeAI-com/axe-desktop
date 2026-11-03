import { useEffect, useState } from "react"

import type { Answerer, Helper } from "@shared/types"

import { answererLabel } from "@/lib/answerer"
import { deleteHelper, loadConnectors, loadHelpers, loadSkills, saveHelper, skillTitle, startWithHelper } from "@/lib/libraries"
import { helperCommand } from "@/lib/slash"
import { useStore } from "@/lib/store"

import { DescribeAgent } from "@/components/AgentDraft"
import { agentLogo, BrandLogo, modelLogo } from "@/components/BrandLogo"
import { Card, ConnectorLogo, ErrorLine, Field, ghost, Grid, HelperMark, inputClass, KIND_ICONS, LibraryPage, pickIcons, primary, Select, Sheet, sheetFooter, Switch } from "@/components/Library"

// One empty list, so an unloaded library doesn't hand React a new array on every render (an endless loop).
const NONE: never[] = []

// Agents: say what one should do and Axe sets it up; below, the ones you have. Use any of them
// with / and its name in a chat, or open one to start a chat or change it.
const KINDS: Helper["kind"][] = ["write", "research", "plan", "support", "data", "design", "code", "custom"]

function Answers({ answerer }: { answerer?: Answerer }) {
  const catalog = useStore((s) => s.catalog)
  if (!answerer) return <span className="text-ink-3">Your default model</span>
  const label = answererLabel(answerer, catalog)
  const logo = answerer.kind === "agent" ? agentLogo({ id: answerer.agentId, name: label }) : modelLogo({ id: answerer.modelId, label })
  return (
    <span className="flex min-w-0 items-center gap-[6px] text-ink-2">
      <BrandLogo logo={logo} name={label} size={18} auto={answerer.kind === "axe" && answerer.modelId === "auto"} />
      <span className="truncate">{label}</span>
    </span>
  )
}

export function Agents() {
  const helpers = useStore((s) => s.library.helpers)
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Helper | "new" | null>(null)

  useEffect(() => {
    if (!helpers) void Promise.all([loadHelpers(), loadSkills(), loadConnectors()])
  }, [helpers])

  // Yours first, then Axe's starters.
  const shown = [...(helpers ?? [])].sort((a, b) => Number(!!a.starter) - Number(!!b.starter))
  const helper = helpers?.find((h) => h.id === open)
  const icons = pickIcons(shown.map((h) => ({ key: h.id, name: h.name, text: h.role, first: KIND_ICONS[h.kind] })))

  return (
    <LibraryPage
      title="Agents"
      tab="agents"
      subtitle="Describe the job. Axe sets it up."
      actions={
        <button className={ghost} onClick={() => setEditing("new")}>
          Write an agent
        </button>
      }
    >
      <DescribeAgent />
      <section aria-label="Your agents" className="flex flex-col gap-[12px]">
        <h2 className="m-0 flex h-[28px] items-center text-[15px] leading-6 font-normal text-ink">Your agents</h2>
        <Grid>
          {shown.map((h, i) => (
            <Card key={h.id} i={i} label={h.name} onOpen={() => setOpen(h.id)}>
              <div className="flex h-[36px] items-center gap-[12px]">
                <HelperMark kind={h.kind} flat icon={icons.get(h.id)} name={h.name} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] text-ink">{h.name}</span>
                </div>
                <span className="shrink-0 text-[12px] text-ink-4">/{helperCommand(h.name)}</span>
              </div>
              <p className="m-0 truncate text-[13px] leading-[20px] text-ink-3">{h.role}</p>
              <div className="mt-auto flex h-[28px] items-center gap-[8px] text-[12px]">
                <Answers answerer={h.answerer} />
                <span className="flex-1" />
                {h.skills.length > 0 && <span className="shrink-0 text-ink-3">{h.skills.length === 1 ? "1 skill" : `${h.skills.length} skills`}</span>}
              </div>
            </Card>
          ))}
        </Grid>
        {helpers && !shown.length && <p className="m-0 text-[13px] text-ink-3">No agents yet. Describe one above.</p>}
      </section>
      <HelperSheet
        helper={helper}
        onClose={() => setOpen(null)}
        onEdit={(h) => {
          setOpen(null)
          setEditing(h)
        }}
      />
      <HelperEditor initial={editing} onClose={() => setEditing(null)} />
    </LibraryPage>
  )
}

function HelperSheet({ helper, onClose, onEdit }: { helper?: Helper; onClose: () => void; onEdit: (h: Helper) => void }) {
  const skills = useStore((s) => s.library.skills?.skills ?? NONE)
  const connectors = useStore((s) => s.library.connectors?.connected ?? NONE)
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet open={!!helper} onClose={onClose} label={helper?.name ?? "Agent"}>
      {helper && (
        <>
          <div className="flex items-center gap-[14px] pr-[32px]">
            <HelperMark kind={helper.kind} size={44} />
            <div className="flex min-w-0 flex-col gap-[2px]">
              <h2 className="m-0 text-[20px] leading-7 font-normal">{helper.name}</h2>
              <p className="m-0 text-[13px] text-ink-3">{helper.role}</p>
            </div>
          </div>
          <p className="m-0 rounded-[10px] bg-muted px-[16px] py-[12px] text-[13px] leading-[22px] whitespace-pre-wrap text-ink-2">{helper.instructions}</p>
          <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-[16px] gap-y-[10px] text-[13px]">
            <dt className="text-ink-3">Answers with</dt>
            <dd className="m-0">
              <Answers answerer={helper.answerer} />
            </dd>
            <dt className="text-ink-3">Skills</dt>
            <dd className="m-0 text-ink-2">{helper.skills.length ? helper.skills.map((id) => skillTitle(skills.find((s) => s.id === id) ?? { id, name: id })).join(", ") : "None"}</dd>
            <dt className="text-ink-3">Connectors</dt>
            <dd className="m-0 flex flex-wrap items-center gap-[6px] text-ink-2">
              {helper.connectors.length
                ? helper.connectors.map((id) => {
                    const c = connectors.find((x) => x.id === id)
                    return c ? <ConnectorLogo key={id} catalogId={c.catalogId} name={c.name} size={20} /> : null
                  })
                : "None"}
            </dd>
            <dt className="text-ink-3">Web search</dt>
            <dd className="m-0 text-ink-2">{helper.webSearch ? "On" : "Off"}</dd>
          </dl>
          <ErrorLine text={error} />
          <div className="flex items-center gap-[8px]">
            {!helper.starter && (
              <button
                className={ghost}
                onClick={() =>
                  void deleteHelper(helper.id).then((e) => {
                    setError(e)
                    if (!e) onClose()
                  })
                }
              >
                Delete
              </button>
            )}
            <span className="flex-1" />
            <button className={ghost} onClick={() => onEdit(helper)}>
              {helper.starter ? "Make a copy" : "Edit"}
            </button>
            <button className={primary} data-autofocus onClick={() => startWithHelper(helper)}>
              Start a chat
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}

const BLANK: Omit<Helper, "id"> = { name: "", role: "", instructions: "", kind: "custom", skills: [], connectors: [], webSearch: false }

const answererKey = (a?: Answerer) => (!a ? "" : a.kind === "agent" ? `agent:${a.agentId}` : `${a.kind}:${a.modelId}`)
const fromKey = (k: string): Answerer | undefined =>
  k.startsWith("axe:")
    ? { kind: "axe", modelId: k.slice(4) }
    : k.startsWith("agent:")
      ? { kind: "agent", agentId: k.slice(6) }
      : k.startsWith("local:")
        ? { kind: "local", modelId: k.slice(6) }
        : undefined

function HelperEditor({ initial, onClose }: { initial: Helper | "new" | null; onClose: () => void }) {
  const catalog = useStore((s) => s.catalog)
  const skills = useStore((s) => s.library.skills?.skills ?? NONE)
  const connectors = useStore((s) => s.library.connectors?.connected ?? NONE)
  const [h, setH] = useState<Omit<Helper, "id"> & { id?: string }>(BLANK)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (initial === "new") setH(BLANK)
    else if (initial) setH(initial.starter ? { ...initial, id: undefined, starter: undefined, name: `${initial.name} copy` } : initial)
  }, [initial])

  const toggle = (key: "skills" | "connectors", id: string) => setH((x) => ({ ...x, [key]: x[key].includes(id) ? x[key].filter((y) => y !== id) : [...x[key], id] }))
  const save = async () => {
    const e = await saveHelper(h)
    setError(e)
    if (!e) onClose()
  }
  const chip = (on: boolean) =>
    `flex h-[32px] items-center gap-[6px] rounded-full border-0 px-[12px] text-[13px] transition-colors duration-150 ${on ? "bg-accent-bg text-ink" : "bg-fill-2 text-ink-2 hover:bg-fill-3"}`

  return (
    <Sheet open={!!initial} onClose={onClose} label={h.id ? "Edit agent" : "New agent"} width={620}>
      <h2 className="m-0 text-[20px] leading-7 font-normal">{h.id ? "Edit agent" : "New agent"}</h2>
      <div className="grid grid-cols-[200px_1fr] gap-[12px]">
        <Field label="Name">
          <input className={inputClass} value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} placeholder="Support replies" />
        </Field>
        <Field label="What it does">
          <input className={inputClass} value={h.role} onChange={(e) => setH({ ...h, role: e.target.value })} placeholder="Answers customer emails from our docs" />
        </Field>
      </div>
      <div className="flex flex-col gap-[6px]">
        <span className="text-[13px] text-ink-2">Icon</span>
        <div role="radiogroup" aria-label="Icon" className="flex gap-[6px]">
          {KINDS.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={h.kind === k}
              aria-label={k}
              onClick={() => setH({ ...h, kind: k })}
              className={`rounded-[10px] border-0 bg-transparent p-[3.5px] ${h.kind === k ? "shadow-[0_0_0_1.5px_var(--accent-2)]" : ""}`}
            >
              <HelperMark kind={k} size={32} />
            </button>
          ))}
        </div>
      </div>
      <Field label="Instructions">
        <textarea
          className={`${inputClass} min-h-[120px] resize-y`}
          value={h.instructions}
          onChange={(e) => setH({ ...h, instructions: e.target.value })}
          placeholder="Answer from our help docs. Be warm and short. Never promise refunds."
        />
      </Field>
      <Field label="Answers with">
        <Select value={answererKey(h.answerer)} onChange={(v) => setH({ ...h, answerer: fromKey(v) })}>
          <option value="">Your default model</option>
          {catalog?.axe.models.map((m) => (
            <option key={m.id} value={`axe:${m.id}`}>
              {m.label}
            </option>
          ))}
          {catalog?.agents
            .filter((a) => a.state === "ready")
            .map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>
                {a.name}
              </option>
            ))}
          {catalog?.local.map((m) => (
            <option key={m.id} value={`local:${m.id}`}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col gap-[6px]">
        <span className="text-[13px] text-ink-2">Skills</span>
        <div className="flex flex-wrap gap-[6px]">
          {skills.map((s) => (
            <button key={s.id} role="checkbox" aria-checked={h.skills.includes(s.id)} className={chip(h.skills.includes(s.id))} onClick={() => toggle("skills", s.id)}>
              {skillTitle(s)}
            </button>
          ))}
        </div>
      </div>
      {connectors.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <span className="text-[13px] text-ink-2">Connectors</span>
          <div className="flex flex-wrap gap-[6px]">
            {connectors.map((c) => (
              <button key={c.id} role="checkbox" aria-checked={h.connectors.includes(c.id)} className={chip(h.connectors.includes(c.id))} onClick={() => toggle("connectors", c.id)}>
                <ConnectorLogo catalogId={c.catalogId} name={c.name} size={18} />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-[12px]">
        <span className="flex-1 text-[13px] text-ink-2">Search the web</span>
        <Switch on={h.webSearch} onChange={(on) => setH({ ...h, webSearch: on })} label="Search the web" />
      </div>
      <ErrorLine text={error} />
      <div className={`${sheetFooter} justify-end`}>
        <button className={ghost} onClick={onClose}>
          Cancel
        </button>
        <button className={primary} onClick={() => void save()}>
          Save
        </button>
      </div>
    </Sheet>
  )
}

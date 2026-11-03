import { useEffect, useMemo, useState } from "react"

import type { CommunitySkill, Skill, SkillTarget } from "@shared/types"

import { jobWords } from "@/lib/agent-draft"
import { invoke } from "@/lib/bridge"
import { createSkill, importSkill, installSkill, loadHelpers, loadSkills, readSkill, setSkillOn, skillTitle, uninstallSkill } from "@/lib/libraries"
import { useStore } from "@/lib/store"

import { agentLogo, BrandLogo } from "@/components/BrandLogo"
import { ChartIcon, CheckIcon, ChecklistIcon, PencilIcon, SkillIcon, TerminalIcon } from "@/components/Icons"
import { ErrorLine, Field, Grid, LibraryPage, pickIcons, Sheet, SkillTile, Switch, ghost, inputClass, primary, small } from "@/components/Library"
import { Markdown } from "@/components/Markdown"
import { CommunitySkillSheet } from "@/components/Community"

// Skills: packaged know-how in the open SKILL.md format. Find one by what you need to do (yours,
// Axe's and the open-source libraries), add it, and use it with / in any chat or give it to an agent.
// Added skills switch on and off; off keeps them on disk, out of the / menu and agents' chats.

const SOURCE: Record<CommunitySkill["source"], string> = { superpowers: "Superpowers", voltagent: "VoltAgent index" }
const sourceOf = (s: Skill) => (s.source === "starter" ? "Axe" : s.source === "cli" ? "From a CLI" : "Yours")

type Hit = { kind: "mine"; skill: Skill } | { kind: "open"; skill: CommunitySkill }

/** Yours and the libraries' skills that fit the words, best first; yours win a tie. */
export function findSkills(query: string, mine: Skill[], open: CommunitySkill[], limit = 20): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const words = jobWords(q)
  const score = (text: string) => {
    const t = text.toLowerCase()
    return (t.includes(q) ? 3 : 0) + words.filter((w) => t.includes(w)).length
  }
  const hits: (Hit & { score: number })[] = [
    ...mine.map((skill) => ({ kind: "mine" as const, skill, score: score(`${skill.name} ${skill.id} ${skill.description}`) + 0.5 })),
    ...open.map((skill) => ({ kind: "open" as const, skill, score: score(`${skill.name} ${skill.description} ${skill.category ?? ""}`) })),
  ]
  return hits
    .filter((h) => h.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ kind, skill }) => ({ kind, skill }) as Hit)
}

const CLI_LOGO: Partial<Record<SkillTarget["id"], { id: string; name: string }>> = {
  claude: { id: "claude-acp", name: "Claude Code" },
  codex: { id: "codex-acp", name: "Codex" },
  gemini: { id: "gemini", name: "Gemini CLI" },
}

const CATEGORY_ICON: Record<string, (p: { size?: number }) => React.ReactNode> = { Writing: PencilIcon, Work: ChecklistIcon, Business: ChartIcon, Code: TerminalIcon }
const hitKey = (h: Hit) => (h.kind === "mine" ? `m:${h.skill.id}` : `o:${h.skill.key}`)

/** The CLIs a skill is in, as small logos. */
function Places({ skill }: { skill: Skill }) {
  const clis = skill.installedIn.filter((t) => t !== "axe")
  return (
    <span className="flex items-center gap-[4px]">
      {clis.map((t) => {
        const a = CLI_LOGO[t]
        return a ? <BrandLogo key={t} logo={agentLogo(a)} name={a.name} size={20} /> : null
      })}
    </span>
  )
}

export function Skills() {
  const lib = useStore((s) => s.library.skills)
  const helpers = useStore((s) => s.library.helpers)
  const off = useStore((s) => s.settings.offSkills) ?? []
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [libraries, setLibraries] = useState<CommunitySkill[] | null>(null)

  useEffect(() => {
    if (!lib) void loadSkills()
    if (!helpers) void loadHelpers()
  }, [lib, helpers])
  // The open-source lists (cached a day by the engine): for search and suggestions.
  useEffect(() => {
    void invoke("community:skills", false).then(setLibraries, () => setLibraries([]))
  }, [])

  const all = lib?.skills ?? []
  const added = all.filter((s) => s.installedIn.length > 0)
  const hits = useMemo(() => findSkills(q, all, libraries ?? []), [q, all, libraries])
  // For your work: Axe's own you haven't added, then the Superpowers set.
  const suggested = useMemo(() => {
    const fromAxe = all.filter((s) => s.source === "starter" && !s.installedIn.length).map((skill): Hit => ({ kind: "mine", skill }))
    const powers = (libraries ?? [])
      .filter((c) => c.source === "superpowers" && !all.some((s) => s.name.toLowerCase() === c.name.toLowerCase() || s.id === c.key.split("/").pop()))
      .map((skill): Hit => ({ kind: "open", skill }))
    return [...fromAxe, ...powers].slice(0, 3)
  }, [all, libraries])

  // Each card its own icon, picked from its words: what's added first, then the suggestions and search hits.
  const icons = useMemo(() => {
    const items = [
      ...added.map((s) => ({ key: `m:${s.id}`, name: s.name, text: s.description, first: s.category ? CATEGORY_ICON[s.category] : undefined })),
      ...[...suggested, ...hits].map((h) => ({ key: hitKey(h), name: h.skill.name, text: h.skill.description })),
    ]
    return pickIcons(items.filter((it, i) => items.findIndex((o) => o.key === it.key) === i))
  }, [added, suggested, hits])
  const iconOf = (key: string) => icons.get(key) ?? SkillIcon

  const usedBy = (id: string) => (helpers ?? []).filter((h) => h.skills.includes(id)).map((h) => h.name)
  const skill = all.find((s) => s.id === open)
  const pick = (h: Hit) => (h.kind === "mine" ? setOpen(h.skill.id) : setOpenKey(h.skill.key))

  return (
    <LibraryPage
      title="Skills"
      tab="skills"
      subtitle="Add a skill, then type / in any chat to use it."
      search={
        <label className="flex h-[38px] w-[300px] shrink-0 items-center gap-[10px] rounded-full bg-card px-[16px] text-ink-3 transition-colors duration-150 focus-within:bg-raised">
          <SearchGlyph />
          <input
            aria-label="Find a skill"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a skill"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
        </label>
      }
      actions={
        <>
          <button className={ghost} onClick={() => void importSkill().then(setError)}>
            Import
          </button>
          <button className={ghost} onClick={() => setMaking(true)}>
            Write a skill
          </button>
        </>
      }
    >
      <ErrorLine text={error} />

      {q.trim() ? (
        <section aria-label="Found" className="flex flex-col gap-[12px]">
          <h2 className="m-0 flex h-[28px] items-center text-[15px] leading-6 font-normal text-ink">{hits.length ? "Found" : "Nothing fits yet"}</h2>
          {hits.length > 0 && (
            <List>
              {hits.map((h) => (
                <SkillRow
                  key={h.kind === "mine" ? `m:${h.skill.id}` : `o:${h.skill.key}`}
                  name={h.kind === "mine" ? skillTitle(h.skill) : h.skill.name}
                  line={`${h.skill.description}${h.kind === "open" ? ` ${SOURCE[h.skill.source]}.` : ""}`}
                  icon={iconOf(hitKey(h))}
                  source={h.kind === "mine" ? sourceOf(h.skill) : SOURCE[h.skill.source]}
                  onOpen={() => pick(h)}
                  end={
                    h.kind === "mine" && h.skill.installedIn.length ? (
                      <span className="flex items-center gap-[6px] text-[12px] text-ok">
                        <CheckIcon size={12} />
                        Added
                      </span>
                    ) : (
                      <button className={small} onClick={(e) => (e.stopPropagation(), pick(h))}>
                        Add
                      </button>
                    )
                  }
                />
              ))}
            </List>
          )}
        </section>
      ) : (
        <>
          <section aria-label="Added" className="flex flex-col gap-[12px]">
            <h2 className="m-0 flex h-[28px] items-center text-[15px] leading-6 font-normal text-ink">Added</h2>
            {added.length ? (
              <List>
                {added.map((s) => {
                  const users = usedBy(s.id)
                  const on = !off.includes(s.id)
                  return (
                    <SkillRow
                      key={s.id}
                      name={skillTitle(s)}
                      line={s.description || `/${s.id}. ${sourceOf(s)}.`}
                      icon={iconOf(`m:${s.id}`)}
                      source={sourceOf(s)}
                      dim={!on}
                      onOpen={() => setOpen(s.id)}
                      end={
                        <span className="flex items-center gap-[12px]">
                          <Places skill={s} />
                          <Switch flat on={on} onChange={(v) => void setSkillOn(s.id, v)} label={`${skillTitle(s)} ${on ? "on" : "off"}`} />
                        </span>
                      }
                    />
                  )
                })}
              </List>
            ) : (
              lib && <p className="m-0 text-[13px] text-ink-3">Nothing added yet. Search above, or add one of these.</p>
            )}
          </section>
          {suggested.length > 0 && (
            <section aria-label="For your work" className="flex flex-col gap-[12px]">
              <h2 className="m-0 flex h-[28px] items-center text-[15px] leading-6 font-normal text-ink">For your work</h2>
              <Grid>
                {suggested.map((h) => {
                  const Icon = iconOf(hitKey(h))
                  return (
                    <SkillRow
                      key={h.kind === "mine" ? h.skill.id : h.skill.key}
                      name={h.kind === "mine" ? skillTitle(h.skill) : h.skill.name}
                      line={h.skill.description}
                      icon={Icon}
                      source={h.kind === "mine" ? "Axe" : SOURCE[h.skill.source]}
                      onOpen={() => pick(h)}
                      end={
                        <button className={small} onClick={(e) => (e.stopPropagation(), pick(h))}>
                          Add
                        </button>
                      }
                    />
                  )
                })}
              </Grid>
            </section>
          )}
          <p className="m-0 text-[12px] leading-[18px] text-ink-3">Sources: Axe, Superpowers and the VoltAgent index.</p>
        </>
      )}
      <SkillSheet skill={skill} targets={lib?.targets ?? []} onClose={() => setOpen(null)} />
      <CommunitySkillSheet skill={libraries?.find((c) => c.key === openKey)} targets={lib?.targets ?? []} onClose={() => setOpenKey(null)} />
      <NewSkillSheet open={making} onClose={() => setMaking(false)} />
    </LibraryPage>
  )
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  )
}

/** Skills as cards in a grid, the same as Connectors and Agents: up to three across. */
function List({ children }: { children: React.ReactNode }) {
  return <Grid>{children}</Grid>
}

/** One skill in a list: icon, name, a note, then the source and what sits at the end (a switch, Add). */
function SkillRow({ name, line, icon, source, end, onOpen, dim }: { name: string; line: string; icon: (p: { size?: number }) => React.ReactNode; source: string; end: React.ReactNode; onOpen: () => void; dim?: boolean }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={name}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="flex h-[136px] cursor-default flex-col gap-[8px] rounded-[16px] bg-card p-[16px] outline-none transition-colors duration-150 hover:bg-raised focus-visible:bg-raised"
    >
      <span className="flex h-[36px] items-center gap-[12px]">
        <span className={dim ? "opacity-40" : ""}>
          <SkillTile icon={icon} name={name} />
        </span>
        <span className={`min-w-0 flex-1 truncate text-[15px] text-ink ${dim ? "opacity-60" : ""}`}>{name}</span>
      </span>
      <span className={`truncate text-[13px] leading-[20px] text-ink-3 ${dim ? "opacity-60" : ""}`}>{line}</span>
      <span className="mt-auto flex h-[28px] items-center gap-[8px]">
        <span className="flex-1 text-[12px] text-ink-4">{source}</span>
        {end}
      </span>
    </div>
  )
}

function SkillSheet({ skill, targets, onClose }: { skill?: Skill; targets: SkillTarget[]; onClose: () => void }) {
  const [text, setText] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = skill?.id

  useEffect(() => {
    setError(null)
    if (!id) return
    setText("")
    void readSkill(id).then(setText, () => setText(""))
  }, [id])
  useEffect(() => {
    if (skill) setPicked(skill.installedIn.length ? skill.installedIn.filter((t) => t !== "axe") : targets.filter((t) => t.id === "claude").map((t) => t.id))
    // Only when another skill opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const run = async (f: () => Promise<string | null>) => {
    setBusy(true)
    setError(await f())
    setBusy(false)
  }
  // The sheet already shows the title: drop a first "# Heading".
  const body = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .trim()
    .replace(/^# .*\n+/, "")
  const installed = !!skill?.installedIn.includes("axe")

  return (
    <Sheet open={!!skill} onClose={onClose} label={skill ? skillTitle(skill) : "Skill"} width={640}>
      {skill && (
        <>
          <div className="flex flex-col gap-[6px] pr-[32px]">
            <h2 className="m-0 text-[20px] leading-7 font-normal">{skillTitle(skill)}</h2>
            <p className="m-0 text-[13px] leading-5 text-ink-3">{skill.description}</p>
          </div>
          <div className="scroll max-h-[300px] rounded-[10px] bg-muted px-[20px] py-[4px] text-[13px]">
            {body ? <Markdown text={body} /> : <p className="text-ink-3">Loading</p>}
          </div>
          <CliPicker targets={targets} picked={picked} onChange={setPicked} />
          <ErrorLine text={error} />
          <div className="flex items-center gap-[8px]">
            <span className="flex-1 text-[12px] text-ink-3">{installed ? `Type /${skill.id} in a chat to use it.` : ""}</span>
            {installed && (
              <button className={ghost} disabled={busy} onClick={() => void run(() => uninstallSkill(skill.id))}>
                Remove
              </button>
            )}
            <button className={primary} disabled={busy} data-autofocus onClick={() => void run(() => installSkill(skill.id, picked))}>
              {installed ? "Save" : "Add skill"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}

/** "Also put it in": the CLIs on this computer, ticked where the skill goes. */
export function CliPicker({ targets, picked, onChange }: { targets: SkillTarget[]; picked: string[]; onChange: (p: string[]) => void }) {
  const clis = targets.filter((t) => t.id !== "axe")
  if (!clis.length) return null
  return (
    <div className="flex flex-col gap-[8px]">
      <span className="text-[13px] text-ink-2">Also put it in</span>
      <div className="flex flex-wrap gap-[8px]">
        {clis.map((t) => {
          const on = picked.includes(t.id)
          const a = CLI_LOGO[t.id]
          return (
            <button
              key={t.id}
              role="checkbox"
              aria-checked={on}
              onClick={() => onChange(on ? picked.filter((x) => x !== t.id) : [...picked, t.id])}
              title={t.path}
              className={`flex h-9 items-center gap-2 rounded-full border-0 px-3 text-[13px] transition-colors duration-150 ${
                on ? "bg-accent-bg text-ink" : "bg-fill-2 text-ink-2 hover:bg-fill-3"
              }`}
            >
              {a && <BrandLogo logo={agentLogo(a)} name={a.name} size={20} />}
              {t.name}
              {on && <CheckIcon size={12} className="text-accent-ink" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NewSkillSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    setError(null)
    onClose()
  }
  const create = async () => {
    const e = await createSkill({ name, description, body })
    setError(e)
    if (!e) {
      setName("")
      setDescription("")
      setBody("")
      onClose()
    }
  }
  return (
    <Sheet open={open} onClose={close} label="New skill">
      <h2 className="m-0 text-[20px] leading-7 font-normal">New skill</h2>
      <Field label="Name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Pricing page" />
      </Field>
      <Field label="When to use it">
        <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Write pricing copy that sells value" />
      </Field>
      <Field label="Instructions">
        <textarea className={`${inputClass} min-h-[160px] resize-y`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Lead with what people get. Keep each plan to three lines." />
      </Field>
      <ErrorLine text={error} />
      <div className="flex justify-end gap-[8px]">
        <button className={ghost} onClick={close}>
          Cancel
        </button>
        <button className={primary} onClick={() => void create()}>
          Create
        </button>
      </div>
    </Sheet>
  )
}

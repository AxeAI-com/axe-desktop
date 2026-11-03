import { useEffect, useState } from "react"

import type { CommunitySkill, CommunitySkillSource, SkillTarget } from "@shared/types"

import { invoke } from "@/lib/bridge"
import { plainError, setState } from "@/lib/store"

import { CliPicker } from "@/screens/Skills"
import { ErrorLine, primary, Sheet } from "./Library"
import { Markdown } from "./Markdown"

// A skill from the open-source libraries (obra/superpowers, VoltAgent's index), read before you add
// it: its SKILL.md, where it comes from, and which CLIs get it too.

const SOURCE_NAME: Record<CommunitySkillSource, string> = { superpowers: "Superpowers", voltagent: "VoltAgent index" }

const repoLink = (url: string, label: string) => (
  <button className="border-0 bg-transparent p-0 text-[12px] text-ink-2 underline decoration-line-3 underline-offset-2 hover:text-ink" onClick={() => void invoke("app:openExternal", url)}>
    {label}
  </button>
)

export function CommunitySkillSheet({ skill, targets, onClose }: { skill?: CommunitySkill; targets: SkillTarget[]; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(false)
  const key = skill?.key

  useEffect(() => {
    setError(null)
    setAdded(false)
    setText(null)
    setPicked(targets.filter((t) => t.id === "claude").map((t) => t.id))
    if (!key) return
    invoke("community:skillText", key).then(setText, (e) => {
      setText("")
      setError(plainError(e))
    })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!skill) return
    setBusy(true)
    setError(null)
    try {
      const skills = await invoke("community:installSkill", skill.key, picked)
      setState((s) => ({ library: { ...s.library, skills } }))
      setAdded(true)
    } catch (e) {
      setError(plainError(e))
    }
    setBusy(false)
  }

  const body = (text ?? "")
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .trim()
    .replace(/^# .*\n+/, "")

  return (
    <Sheet open={!!skill} onClose={onClose} label={skill?.name ?? "Skill"} width={640}>
      {skill && (
        <>
          <div className="flex flex-col gap-1.5 pr-8">
            <h2 className="m-0 text-[20px] leading-7 font-normal">{skill.name}</h2>
            <p className="m-0 text-[13px] leading-5 text-ink-3">{skill.description}</p>
            <span className="text-[12px] text-ink-3">
              {SOURCE_NAME[skill.source]}, from {repoLink(skill.url, skill.repo)}
            </span>
          </div>
          <div className="scroll max-h-[300px] rounded-[10px] bg-muted px-5 py-1 text-[13px]">
            {text === null ? <p className="text-ink-3">Loading</p> : body ? <Markdown text={body} /> : <p className="text-ink-3">No preview. Open it on GitHub to read it.</p>}
          </div>
          <CliPicker targets={targets} picked={picked} onChange={setPicked} />
          <ErrorLine text={error} />
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[12px] text-ink-3">{added ? "Added. Type / in a chat to use it." : "Read it before you add it: skills can include scripts."}</span>
            <button className={primary} disabled={busy || added} data-autofocus onClick={() => void add()}>
              {added ? "Added" : busy ? "Adding" : "Add skill"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}

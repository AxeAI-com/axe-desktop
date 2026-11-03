import { useEffect, useMemo, useState, type RefObject } from "react"

import type { Answerer, AxeModel, LocalAgent, LocalModel } from "@shared/types"

import { sameAnswerer } from "@/lib/answerer"
import { openSettingsAt } from "@/lib/shortcuts"
import { installAgent, plainError, refreshModels, startOllama, useStore } from "@/lib/store"

import { agentLogo, localModelLogo, LogoTile, modelLogo } from "./BrandLogo"
import { BoltIcon, ChevronDown, ChevronRight, DownloadIcon, PlusIcon } from "./Icons"
import { MenuLabel, MenuLine, MenuRow, Popover } from "./Popover"

type Row = { kind: "axe"; model: AxeModel } | { kind: "agent"; agent: LocalAgent } | { kind: "local"; model: LocalModel }

/**
 * Choose who answers: the CLI agents and local model servers on this computer (your own accounts, free)
 * and Axe AI's models. One line per choice, its logo and a tick; detail on hover. A local model says its
 * server in grey. Agents that aren't installed wait behind "More agents" with a download mark.
 * `sections` can limit it to Axe's models, CLIs or local models.
 */
export function ModelPicker({
  open,
  onClose,
  anchor,
  current,
  onPick,
  sections = ["axe", "agent", "local"],
  className,
  origin = "bottom right",
  maxHeight,
}: {
  origin?: string
  maxHeight?: number
  open: boolean
  onClose: () => void
  anchor: RefObject<HTMLElement | null>
  current: Answerer
  onPick: (a: Answerer) => void
  sections?: ("axe" | "agent" | "local")[]
  className: string
}) {
  const catalog = useStore((s) => s.catalog)
  const warming = useStore((s) => s.warming)
  // Ollama is here but stopped, with no models Axe can read from disk: start it from the menu.
  const ollama = catalog?.servers.find((x) => x.id === "ollama")
  const offerStart = sections.includes("local") && !!ollama?.canStart && !ollama.models.length
  const [startError, setStartError] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const agents = sections.includes("agent") ? (catalog?.agents ?? []) : []
  const locals = sections.includes("local") ? (catalog?.local ?? []) : []
  // First list: agents installed on this computer (or, with none, the first few that can run).
  // Everything else, including ones only runnable through npx, waits behind "More agents".
  const installed = agents.filter((a) => a.state === "ready" && a.here)
  // With local models there, npx-only agents don't pad the list.
  const ready = installed.length || locals.length ? installed : agents.filter((a) => a.state === "ready").slice(0, 4)
  const others = agents.filter((a) => !ready.includes(a))
  // What the arrow keys walk through: what's on screen, in order.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = ready.map((agent) => ({ kind: "agent" as const, agent }))
    for (const model of locals) out.push({ kind: "local", model })
    if (sections.includes("axe")) for (const model of catalog?.axe.models ?? []) out.push({ kind: "axe", model })
    if (more) for (const agent of others) out.push({ kind: "agent", agent })
    return out
  }, [catalog, sections, more, ready, others, locals])
  const answererOf = (r: Row): Answerer => (r.kind === "agent" ? { kind: "agent", agentId: r.agent.id } : { kind: r.kind, modelId: r.model.id })
  const isCurrent = (r: Row) => sameAnswerer(current, answererOf(r))
  const selectedIndex = rows.findIndex(isCurrent)
  const [cursor, setCursor] = useState(Math.max(0, selectedIndex))

  useEffect(() => {
    if (open) setCursor(Math.max(0, selectedIndex))
    if (!open) setMore(false)
  }, [open, selectedIndex])

  // A server started since the last look shows up while the menu is open.
  useEffect(() => {
    if (open && sections.includes("local")) void refreshModels()
  }, [open])

  const choose = async (r: Row) => {
    if (r.kind !== "agent") return onPick(answererOf(r))
    if (r.agent.state === "unavailable") return
    if (r.agent.state === "install") {
      setInstalling(r.agent.id)
      try {
        await installAgent(r.agent.id)
      } finally {
        setInstalling(null)
      }
      return
    }
    onPick({ kind: "agent", agentId: r.agent.id })
  }

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        setCursor((c) => (c + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % Math.max(1, rows.length))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const r = rows[cursor]
        if (r) void choose(r)
      }
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
  })

  const row = (r: Row) => {
    const i = rows.indexOf(r)
    if (r.kind === "local")
      return (
        <MenuRow
          key={`local-${r.model.id}`}
          role="option"
          checked={isCurrent(r)}
          hot={i === cursor}
          title={`${r.model.model}, on ${r.model.serverName}. Free, and nothing leaves this computer.${r.model.tools === false ? " It can only chat: no Do it or connectors." : ""}${r.model.serverId === "ollama" && ollama?.canStart ? " Axe starts Ollama when you send." : ""}`}
          icon={<LogoTile logo={localModelLogo(r.model)} name={r.model.name} size={18} />}
          hint={<span className="text-[13px] text-ink-3">{warming === r.model.id ? "Loading" : r.model.serverName}</span>}
          onHover={() => setCursor(i)}
          onSelect={() => void choose(r)}
        >
          {r.model.name}
        </MenuRow>
      )
    if (r.kind === "axe")
      return (
        <MenuRow
          key={`axe-${r.model.id}`}
          role="option"
          checked={isCurrent(r)}
          hot={i === cursor}
          title={r.model.description ?? undefined}
          icon={<LogoTile auto={r.model.id === "auto"} logo={modelLogo(r.model)} name={r.model.label} size={18} />}
          onHover={() => setCursor(i)}
          onSelect={() => void choose(r)}
        >
          {r.model.label}
        </MenuRow>
      )
    const a = r.agent
    const busy = installing === a.id
    return (
      <MenuRow
        key={`agent-${a.id}`}
        role="option"
        checked={isCurrent(r)}
        hot={i === cursor}
        disabled={a.state === "unavailable"}
        title={a.state === "unavailable" && a.reason ? a.reason : a.note}
        icon={<LogoTile logo={agentLogo(a)} name={a.name} size={18} />}
        hint={
          a.state === "install" ? (
            busy ? (
              <span role="img" aria-label="Installing" className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-line-3 border-t-ink" />
            ) : (
              <DownloadIcon size={13} aria-label="Install" />
            )
          ) : undefined
        }
        onHover={() => setCursor(i)}
        onSelect={() => void choose(r)}
      >
        {a.name}
      </MenuRow>
    )
  }

  const axeRows = rows.filter((r) => r.kind === "axe")
  const readyRows = rows.filter((r) => (r.kind === "agent" && ready.includes(r.agent)) || r.kind === "local")
  const otherRows = rows.filter((r) => r.kind === "agent" && !ready.includes(r.agent))

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} origin={origin} role="listbox" label="Choose who answers" className={`w-max ${className}`}>
      <div className="scroll flex flex-col" style={{ maxHeight: maxHeight ?? 560 }}>
        {readyRows.length > 0 && <MenuLabel>On this computer</MenuLabel>}
        {readyRows.map(row)}
        {axeRows.length > 0 && readyRows.length > 0 && <MenuLine />}
        {axeRows.length > 0 && <MenuLabel>Axe AI</MenuLabel>}
        {axeRows.map(row)}
        {(others.length > 0 || sections.includes("local")) && <MenuLine />}
        {offerStart && (
          <MenuRow
            icon={<BoltIcon size={14} />}
            title={startError ?? "Ollama is on this computer but not running."}
            onSelect={() => {
              setStartError(null)
              void startOllama().catch((e) => setStartError(plainError(e)))
            }}
          >
            {startError ? "Ollama didn't start" : "Start Ollama"}
          </MenuRow>
        )}
        {sections.includes("local") && (
          <MenuRow
            icon={<PlusIcon size={14} />}
            title="Ollama, LM Studio and llama.cpp are found by themselves. Add any other server by its address."
            onSelect={() => {
              onClose()
              openSettingsAt("models")
            }}
          >
            Add a model server
          </MenuRow>
        )}
        {others.length > 0 && (
          <>
            <MenuRow icon={more ? <ChevronDown size={14} /> : <ChevronRight size={14} />} onSelect={() => setMore((m) => !m)}>
              More agents
            </MenuRow>
            {otherRows.map(row)}
          </>
        )}
      </div>
    </Popover>
  )
}

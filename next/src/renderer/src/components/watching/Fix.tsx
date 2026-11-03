import { useEffect, useMemo, useRef, useState } from "react"

import { alertDetail, fixedLine, repoBody, repoHeadline } from "@shared/watching/copy"
import { liveProblems } from "@shared/watching/findings"
import type { CheckRow, DnsRecord, FixTurn, OpenFinding, PastFinding, RepoAlert, Run, WatchView } from "@shared/watching/types"
import type { ChatMessage } from "@shared/types"

import { totals } from "@/lib/changes"
import { invoke } from "@/lib/bridge"
import { keepChanges, loadChanges, loadMessages, openReview, openThread, undoChanges, useStore } from "@/lib/store"
import { checkNow, fixAgain, fixDone, fixWatch } from "@/lib/watching"

import { agentLogo, LogoTile } from "@/components/BrandLogo"
import { CheckIcon, FileIcon, FolderIcon, RetryIcon, WarnIcon } from "@/components/Icons"
import { PermissionCard } from "@/components/Cards"
import { AssistantMessage } from "@/screens/Thread"
import { clock, day, sameDay, SpeedChart } from "@/components/watching/Evidence"
import { Bubble, btn, card, Line, Spin } from "@/components/watching/parts"

// Security and repo evidence, and the fix handoff in a watch's own thread (design: "The fix handoff").
// A fix is an agent turn: the plan card (Start), the agent's steps, the changed files (Keep all, Undo all),
// then Axe checks again. Only a run that shows the problem gone marks it fixed.

const EMPTY: ChatMessage[] = []

/** "/Users/mia/Code/shop-web" → "~/Code/shop-web". */
export const tilde = (p?: string) => (p ?? "").replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~")

/* Rows */

function Row({ ok, label, sub, value, warnValue, right }: { ok: boolean; label: string; sub?: string; value?: string; warnValue?: boolean; right?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-[10px] border-t border-[var(--watch-line)] py-[7px] text-[13px] leading-[18px] first:border-t-0">
      {ok ? <CheckIcon size={14} className="text-ok" /> : <WarnIcon size={14} className="text-warn" />}
      <span className="min-w-0 truncate text-ink">
        {label}
        {sub && <span className="ml-[6px] text-[12px] text-ink-3">{sub}</span>}
      </span>
      {right ?? <span className={`text-right text-[12px] ${warnValue ? "text-warn" : "text-ink-3"}`}>{value}</span>}
    </div>
  )
}

/** A security run's check list: one row per check, a tick or an orange triangle, the value on the right. */
export function CheckRows({ rows }: { rows: CheckRow[] }) {
  return (
    <div className="flex flex-col" data-testid="check-rows">
      {rows.map((r) => (
        <Row key={r.label} ok={r.ok} label={r.label} sub={r.sub} value={r.value} warnValue={!r.ok} />
      ))}
    </div>
  )
}

/** The record as found, what to do, and the fix as a record diff. */
export function RecordFix({ r }: { r: DnsRecord }) {
  return (
    <>
      <div className="selectable truncate rounded-[6px] bg-fill px-[12px] py-[8px] font-mono text-[12.5px] leading-[19px] whitespace-nowrap text-ink-2" data-testid="record-found">
        {`${r.name}  ${r.type}  ${r.found ? `"${r.found}"` : "(none)"}`}
      </div>
      <p className="m-0 text-[13px] leading-[20px] text-ink-3">{r.how}</p>
      <div className="selectable overflow-hidden rounded-[6px] bg-fill font-mono text-[12.5px] leading-[19px]" data-testid="record-diff">
        {r.found && <div className="px-[12px] py-[3px] break-words whitespace-pre-wrap bg-[var(--watch-del-bg)] text-[var(--watch-del-ink)]">− {r.found}</div>}
        <div className="px-[12px] py-[3px] break-words whitespace-pre-wrap bg-[var(--watch-add-bg)] text-[var(--watch-add-ink)]">+ {r.want}</div>
      </div>
    </>
  )
}

/** A repo's alerts: package and version, the problem and severity in plain words, the fixed version. */
export function AlertRows({ alerts, fixed }: { alerts: RepoAlert[]; fixed?: boolean }) {
  return (
    <div className="flex flex-col" data-testid="alert-rows">
      {alerts.map((a) => (
        <Row
          key={`${a.source}:${a.name}:${a.file ?? ""}`}
          ok={!!fixed}
          label={a.source === "package" ? `${a.name}${a.version ? ` ${a.version}` : ""}` : (a.file ?? a.name)}
          sub={alertDetail(a)}
          right={
            fixed ? (
              <span className="text-right text-[12px] text-ink-3">Fixed</span>
            ) : a.url && a.source !== "key" ? (
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-right text-[12px] text-ink-3 hover:text-brand-text hover:underline" onClick={() => void invoke("app:openExternal", a.url!)}>
                {a.id ?? "Details"}
              </button>
            ) : (
              <span className="text-right text-[12px] text-ink-3">{a.source === "key" ? "Key" : (a.id ?? "")}</span>
            )
          }
        />
      ))}
    </div>
  )
}

/* Who fixes */

/** "Fix with Claude Code": the watch's own agent if it's ready, else the first coding agent, else Do it. */
export function useFixLabel(w: Pick<WatchView, "answerer">): { agent: string; agentId?: string } {
  const catalog = useStore((s) => s.catalog)
  const agents = catalog?.agents.filter((a) => a.state === "ready") ?? []
  const own = w.answerer?.kind === "agent" ? agents.find((a) => a.id === (w.answerer as { agentId: string }).agentId) : undefined
  const agent = own ?? agents[0]
  return agent ? { agent: agent.name, agentId: agent.id } : { agent: "Do it" }
}

/** A fix still in hand: it hides the problem card (the problem folds to one line) until it's undone or fixed. */
export const activeFix = (w: WatchView, key: string): FixTurn | undefined =>
  w.fixes.findLast((f) => f.keys.includes(key) && f.state !== "undone" && f.result !== "fixed")

/* The repo card */

/** A repo's live alerts as one card: the count, whether a fix is out, the rows, and one set of buttons. */
export function RepoCard({ w, findings, paused, acts }: { w: WatchView; findings: OpenFinding[]; paused?: boolean; acts: React.ReactNode }) {
  const { agent } = useFixLabel(w)
  const alerts = findings.map((f) => f.ev?.alert).filter((a): a is RepoAlert => !!a)
  const keys = findings.map((f) => f.key)
  const fixable = alerts.some((a) => a.source !== "package" || a.fixedIn || a.fixVia)
  const openedAt = Math.min(...findings.map((f) => f.openedAt))
  return (
    <div className={card(true)} data-testid="problem-repo">
      <WarnMeta at={openedAt} />
      <div className="text-[17px] leading-[24px] text-ink">{repoHeadline(findings.length, w.name)}</div>
      <p className="m-0 text-[15px] leading-[22px] text-ink-2">{repoBody(alerts)}</p>
      <AlertRows alerts={alerts} />
      <div className="flex flex-wrap items-center gap-[6px]">
        {fixable && (
          <button type="button" disabled={paused} className={btn("pri")} onClick={() => void fixWatch(w.id, keys)}>
            Fix with {agent}
          </button>
        )}
        {acts}
      </div>
    </div>
  )
}

function WarnMeta({ at }: { at: number }) {
  return (
    <div className="flex items-center gap-[8px] text-[12px] leading-[16px] text-ink-3 tabular-nums">
      <i className="inline-block size-[7px] shrink-0 rounded-full bg-warn" />
      <span className="text-warn">{sameDay(at, Date.now()) ? clock(at) : `${day(at)}, ${clock(at)}`}</span>
    </div>
  )
}

/* Fixed */

/**
 * A problem a run showed gone after your fix: green tick and time, what's true now, and the evidence
 * (the record as it is now, the check list, or the alerts marked fixed). No notification: you did it.
 */
export function FixedCard({ w, found, run }: { w: WatchView; found: PastFinding[]; run?: Run }) {
  const at = found[0]!.closedAt
  const keys = found.map((f) => f.key)
  const left = w.kind === "repo" ? liveProblems(w, Date.now()).length : 0
  const alerts = found.map((f) => f.ev?.alert).filter((a): a is RepoAlert => !!a)
  const record = found.find((f) => f.ev?.record)?.ev?.record
  const github = w.kind === "repo" && !w.target.startsWith("/") && !w.target.startsWith("~")
  return (
    <div className={card(false)} data-testid="fixed-card">
      <div className="flex items-center gap-[8px] text-[12px] leading-[16px] text-ink-3 tabular-nums">
        <CheckIcon size={13} className="text-ok" />
        <span className="text-ok">Fixed at {clock(at)}</span>
      </div>
      <div className="text-[17px] leading-[24px] text-ink">{fixedLine(w.kind, w.target, keys, run ?? w.latest, left)}</div>
      {record && run?.dmarc && keys.includes("dmarc:none") && (
        <div className="selectable truncate rounded-[6px] bg-fill px-[12px] py-[8px] font-mono text-[12.5px] leading-[19px] whitespace-nowrap text-ink-2">{`${record.name} TXT "${run.dmarc}"`}</div>
      )}
      {keys.includes("slow") && <SpeedChart ticks={w.strip} />}
      {alerts.length > 0 && <AlertRows alerts={alerts} fixed />}
      {github && <p className="m-0 text-[13px] leading-[20px] text-ink-3">GitHub closes its alerts when you push. Axe checks again tomorrow.</p>}
    </div>
  )
}

/* The fix turn */

/** Fixes that finished while you watched stay open in full this session; older ones fold to one line. */
const seenLive = new Set<string>()

function AgentHeader({ turn }: { turn: FixTurn }) {
  const catalog = useStore((s) => s.catalog)
  const a = turn.answerer.kind === "agent" ? catalog?.agents.find((x) => x.id === (turn.answerer as { agentId: string }).agentId) : undefined
  return (
    <div className="flex items-center gap-[8px] text-[13px] leading-[18px] text-ink-2">
      <LogoTile logo={a ? agentLogo(a) : undefined} name={turn.agent} size={18} auto={!a} />
      <span>
        {turn.agent} in {tilde(turn.folder)}
      </span>
    </div>
  )
}

const short = (files: { rel: string }[]) => {
  const names = files.map((f) => f.rel.split("/").pop() ?? f.rel)
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
}

/**
 * One fix turn in the thread: your "Fix with …", the folder question the first time, then the agent's
 * own session (its plan card and steps), the files with Keep all and Undo all, and what happens next.
 */
export function FixBlock({ w, turn, last }: { w: WatchView; turn: FixTurn; last: boolean }) {
  const threadId = turn.threadId
  const messages = useStore((s) => (threadId ? (s.messages[threadId] ?? EMPTY) : EMPTY))
  const running = useStore((s) => !!threadId && (!!s.live[threadId] || !!s.threads.find((t) => t.id === threadId)?.running))
  const files = useStore((s) => (threadId ? s.changes[threadId] : undefined))
  const checking = useStore((s) => s.watchChecking === w.id)
  const allAsks = useStore((s) => s.permissions)
  // The agent's questions (a plan's Start shows on its plan card instead).
  const asks = useMemo(() => (threadId ? allAsks.filter((p) => p.threadId === threadId && !p.plan) : []), [allAsks, threadId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kept = useRef<{ rel: string }[]>([])
  const key = `${w.id}:${turn.at}`
  if (turn.state !== "kept" || !turn.result) seenLive.add(key)

  useEffect(() => {
    if (!threadId) return
    void loadMessages(threadId)
    void loadChanges(threadId)
  }, [threadId])
  // When the agent stops, its changed files are read again.
  useEffect(() => {
    if (threadId && !running) void loadChanges(threadId)
  }, [threadId, running])

  const sum = useMemo(() => totals(files ?? []), [files])
  const rest = messages.slice(1)
  const lastAssistant = rest.findLast((m) => m.role === "assistant")?.id
  const site = w.kind !== "repo"

  // A fix that ended fixed, from before this session: one line that opens the agent's session.
  if (turn.result === "fixed" && !seenLive.has(key) && turn.state === "kept") {
    return (
      <div className="flex flex-col gap-[10px]">
        <Line
          icon={<AgentMark turn={turn} />}
          onClick={threadId ? () => void openThread(threadId) : undefined}
        >{`${turn.agent} changed ${turn.files ?? 0} ${turn.files === 1 ? "file" : "files"} in ${tilde(turn.folder)}. Kept.`}</Line>
      </div>
    )
  }

  const keep = async () => {
    if (!threadId || !files) return
    setBusy(true)
    kept.current = files
    await keepChanges(threadId, null)
    setBusy(false)
    void fixDone(w.id, turn.at, "kept", files.length)
  }
  const undo = async () => {
    if (!threadId) return
    setBusy(true)
    const problem = await undoChanges(threadId, null)
    setBusy(false)
    setError(problem)
    if (!problem) void fixDone(w.id, turn.at, "undone")
  }

  return (
    <div className="flex flex-col gap-[16px]" data-testid="fix-turn">
      <div className="self-end rounded-[16px] bg-bubble px-[12px] py-[5px] text-[13px] leading-[18px] text-ink-2">Fix with {turn.agent}</div>
      {turn.state === "asking" && <FolderAsk w={w} turn={turn} />}
      {turn.state !== "asking" && (
        <div className="flex flex-col gap-[10px]">
          <AgentHeader turn={turn} />
          {!threadId && (
            <div className="flex items-center gap-[8px] text-[13px] text-ink-3">
              <Spin /> Starting
            </div>
          )}
          {rest.map((m) =>
            m.role === "user" ? (
              <Bubble key={m.id}>{m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</Bubble>
            ) : (
              <AssistantMessage key={m.id} threadId={threadId!} msg={m} isLast={m.id === lastAssistant} />
            ),
          )}
          {asks.map((p) => (
            <PermissionCard key={p.id} request={p} cwd={turn.folder} />
          ))}
          {turn.state === "working" && !running && files && files.length > 0 && (
            <div className={card(false)} data-testid="fix-files">
              <div className="flex flex-col">
                {files.slice(0, 6).map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => threadId && openReview(threadId)}
                    className="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-[10px] border-0 border-t border-[var(--watch-line)] bg-transparent px-0 py-[7px] text-left text-[13px] leading-[18px] text-ink first:border-t-0 hover:text-brand-text"
                  >
                    <FileIcon size={14} className="text-ink-3" />
                    <span className="truncate">{f.rel}</span>
                    <FileCounts f={f} />
                  </button>
                ))}
                {files.length > 6 && <span className="pt-[4px] text-[12px] text-ink-3">and {files.length - 6} more</span>}
              </div>
              <div className="flex flex-wrap items-center gap-[6px]">
                <button type="button" disabled={busy} className={btn("pri")} onClick={() => void keep()}>
                  Keep all
                </button>
                <button type="button" disabled={busy} className={btn()} onClick={() => void undo()}>
                  Undo all
                </button>
              </div>
              {error && <p className="m-0 text-[12px] text-warn">{error}</p>}
            </div>
          )}
          {turn.state === "working" && !running && files && files.length > 0 && site && (
            <p className="m-0 text-[13px] leading-[20px] text-ink-3">After you keep them: deploy the change, and the next check will see it.</p>
          )}
          {turn.state === "kept" && (
            <>
              {(kept.current.length > 0 || turn.files) && (
                <Line icon={<FileIcon size={14} />}>
                  <span className="inline-flex items-center gap-[10px]">
                    {kept.current.length ? short(kept.current) : `${turn.files} ${turn.files === 1 ? "file" : "files"}`}
                    {kept.current.length > 0 && <Counts added={sum.added} removed={sum.removed} />}
                  </span>
                </Line>
              )}
              <Line icon={<CheckIcon size={14} className="text-ok" />}>Kept</Line>
            </>
          )}
        </div>
      )}
      {turn.state === "kept" && !turn.result && site && (
        <div className="flex flex-col gap-[10px] text-[15px] leading-[22px] text-ink">
          <span>Kept. Deploy it, then I’ll see it on the next check.</span>
          <span>
            <button type="button" disabled={checking} className={btn()} onClick={() => void checkNow(w.id)}>
              {checking ? <Spin /> : <RetryIcon size={14} />}
              Check now
            </button>
          </span>
        </div>
      )}
      {turn.state === "kept" && !turn.result && !site && checking && (
        <div className="flex items-center gap-[8px] text-[13px] leading-[18px] text-ink-3">
          <Spin /> Checking {w.name} again
        </div>
      )}
      {turn.result === "still" && last && (
        <div className="flex flex-col gap-[10px] text-[15px] leading-[22px] text-ink">
          <span>{stillLine(w, turn)}</span>
          <span>
            <button type="button" className={btn("pri")} onClick={() => void fixAgain(w.id, turn.at)}>
              Try again
            </button>
          </span>
        </div>
      )}
      {turn.state === "undone" && <span className="text-[15px] leading-[22px] text-ink">Undone. The problem is still open.</span>}
    </div>
  )
}

function stillLine(w: WatchView, turn: FixTurn): string {
  const open = w.open.filter((f) => turn.keys.includes(f.key))
  if (w.kind === "repo") return `Still ${open.length} open ${open.length === 1 ? "alert" : "alerts"} in ${w.name}.`
  const f = open[0]
  if (f?.key === "slow" && w.latest?.metric) return `Still slow: ${(w.latest.metric / 1000).toFixed(1)} s.`
  return `Still there: ${(f?.headline ?? turn.headline).replace(/\.$/, "")}.`
}

function AgentMark({ turn }: { turn: FixTurn }) {
  const catalog = useStore((s) => s.catalog)
  const a = turn.answerer.kind === "agent" ? catalog?.agents.find((x) => x.id === (turn.answerer as { agentId: string }).agentId) : undefined
  return <LogoTile logo={a ? agentLogo(a) : undefined} name={turn.agent} size={14} auto={!a} />
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="text-[12px] tabular-nums">
      <span className="text-[var(--watch-add-ink)]">+{added}</span> <span className="text-[var(--watch-del-ink)]">−{removed}</span>
    </span>
  )
}

function FileCounts({ f }: { f: Parameters<typeof totals>[0][number] }) {
  const t = totals([f])
  return <Counts added={t.added} removed={t.removed} />
}

/** "Which folder has the code for …?": recent agent chat folders, best match first, then Choose folder…. */
function FolderAsk({ w, turn }: { w: WatchView; turn: FixTurn }) {
  const [list, setList] = useState<{ path: string; about: string }[] | null>(null)
  useEffect(() => {
    void invoke("watching:folders", w.id).then(setList)
  }, [w.id])
  const pick = (path: string) => void fixWatch(w.id, turn.keys, path)
  return (
    <div className="flex flex-col gap-[10px] text-[15px] leading-[22px] text-ink">
      <span>Which folder has the code for {w.kind === "security" ? w.target : w.name}?</span>
      {list && list.length > 0 && (
        <div className="flex flex-col">
          {list.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => pick(f.path)}
              className="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-[10px] border-0 border-t border-[var(--watch-line)] bg-transparent px-0 py-[7px] text-left text-[13px] leading-[18px] text-ink first:border-t-0 hover:text-brand-text"
            >
              <FolderIcon size={14} className="text-ink-3" />
              <span className="truncate">
                {f.path}
                <span className="ml-[6px] text-[12px] text-ink-3">{f.about}</span>
              </span>
              <span />
            </button>
          ))}
        </div>
      )}
      <span>
        <button
          type="button"
          className={btn()}
          onClick={async () => {
            const f = await invoke("app:pickFolder")
            if (f) pick(f)
          }}
        >
          <FolderIcon size={14} />
          Choose folder…
        </button>
      </span>
    </div>
  )
}

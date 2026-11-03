import { useState } from "react"

import type { Answerer, Part, PermissionRequest } from "@shared/types"

import { answerPermission } from "@/lib/store"

import { PlanApprovalCard } from "./ai/plan-approval-card"
import { TodoList } from "./ai/todo-list"
import { ToolApproval } from "./ai/tool-approval"
import { ToolError } from "./ai/tool-error"
import { Markdown } from "./Markdown"
import { relativeTo } from "./StepGroup"
import { Button } from "./ui/button"

type PlanPart = Extract<Part, { type: "plan" }>

/**
 * The agent's plan. Made in Plan mode it waits for you first (Pasta UI's Plan Approval Card): Start
 * lets the agent work, Edit keeps it planning. Then it is Pasta's Todo List, ticking as it works.
 */
export function PlanCard({ part, onStart, onChange, compact }: { part: PlanPart; onStart?: () => void; onChange?: () => void; compact?: boolean }) {
  // A plan with no list of steps shows whole.
  const stepless = !part.entries.length && !!part.text
  const [whole, setWhole] = useState(stepless)
  const [starting, setStarting] = useState(false)
  const waiting = !!onStart
  const start = () => {
    setStarting(true)
    onStart?.()
  }
  const title = part.summary || "Plan"
  return (
    <section aria-label="Plan" className="flex flex-col items-start gap-2">
      {whole && part.text ? (
        <div className="w-full rounded-[16px] bg-card p-5 shadow-card">
          <div className="plan-text scroll max-h-[360px] text-[15px]">
            <Markdown text={part.text} />
          </div>
          {waiting && <PlanActions bare starting={starting} onStart={start} onChange={onChange} note="Nothing changes until you start" />}
        </div>
      ) : waiting ? (
        <PlanApprovalCard
          className="w-full"
          title={title}
          steps={part.entries.map((e, i) => ({ id: String(i), label: e.text }))}
          onStart={start}
          onEdit={onChange}
          disabled={starting}
        />
      ) : (
        <TodoList
          compact={compact}
          className="w-full"
          title={title}
          items={part.entries.map((e, i) => ({
            id: String(i),
            label: e.text,
            status: e.status === "done" ? "complete" : e.status === "running" ? "in-progress" : "pending",
          }))}
        />
      )}
      {part.text && !stepless && (
        <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-3 text-muted-foreground" onClick={() => setWhole((w) => !w)} aria-expanded={whole}>
          {whole ? "Show the steps" : "Show the whole plan"}
        </Button>
      )}
    </section>
  )
}

/** Start and Edit for a plan written in words: under the whole plan, or under a reply in Plan mode. */
export function PlanActions({ onStart, onChange, note, starting, bare }: { onStart: () => void; onChange?: () => void; note?: string; starting?: boolean; bare?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${bare ? "mt-4" : "border-t border-border px-4 py-3"}`}>
      {onChange && (
        <Button type="button" variant="ghost" className="h-7 rounded-full px-3 text-sm font-[450] text-muted-foreground" disabled={starting} onClick={onChange}>
          Edit
        </Button>
      )}
      <span className="flex-1 text-right text-xs text-muted-foreground">{note}</span>
      <Button type="button" variant="default" className={PRIMARY} disabled={starting} onClick={onStart}>
        Start
      </Button>
    </div>
  )
}

/** Pasta UI's primary button (Plan Approval Card's Start). */
const PRIMARY =
  "h-7 rounded-full border-0 bg-primary px-3 text-sm font-[450] text-primary-foreground hover:brightness-110 dark:bg-none"

export function PermissionCard({ request, cwd }: { request: PermissionRequest; cwd?: string }) {
  const allowOnce = request.options.find((o) => o.kind === "allow_once") ?? request.options.find((o) => o.kind.startsWith("allow"))
  const always = request.options.find((o) => o.kind === "allow_always" && o !== allowOnce)
  const deny = request.options.find((o) => o.kind === "reject_once") ?? request.options.find((o) => o.kind.startsWith("reject"))
  return (
    <ToolApproval
      aria-label="Allow this?"
      role="region"
      tool="this"
      description={relativeTo(request.title, cwd)}
      command={request.detail && relativeTo(request.detail, cwd)}
      allowLabel={allowOnce?.label}
      rememberLabel={always?.label}
      denyLabel={deny?.label}
      hideRemember={!always}
      onAllow={(remember) => {
        const o = remember ? always : allowOnce
        if (o) void answerPermission(request.id, o.id)
      }}
      onDeny={() => deny && void answerPermission(request.id, deny.id)}
    />
  )
}

/** Something went wrong (Pasta UI's Tool Error), with a way to try again; `onSignIn` when a CLI's sign-in lapsed. */
export function ErrorCard({ text, onRetry, onSignIn }: { text: string; onRetry?: () => void; onSignIn?: () => void }) {
  return <ToolError tool="Axe" label="Something went wrong" title="That didn't finish" message={text} onRetry={onRetry} onFix={onSignIn} fixLabel="Sign in" />
}

/** The agent to sign in to, when an agent reply failed because its CLI isn't signed in. */
export const signInAgent = (text: string, answerer?: Answerer) =>
  answerer?.kind === "agent" && /needs you to sign in/.test(text) ? answerer.agentId : undefined

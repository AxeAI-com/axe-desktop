import { AnimatePresence, motion } from "motion/react"
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react"

import type { Answerer, ChatMessage } from "@shared/types"

import { answererLabel, sameAnswerer } from "@/lib/answerer"
import { column, composerDock } from "@/lib/layout"
import { useMotion } from "@/lib/motion"
import { segment, isLiveGroup, replyText } from "@/lib/steps"
import { changePlan, modeOf, openTerminal, retry, sendInThread, setMode, startPlan, useStore } from "@/lib/store"
import { useStickToBottom } from "@/lib/useStickToBottom"

import { AttachmentChip } from "@/components/Attachments"
import { ErrorCard, PermissionCard, PlanActions, PlanCard, signInAgent } from "@/components/Cards"
import { ChangesPanel } from "@/components/ChangesPanel"
import { Composer } from "@/components/Composer"
import { CopyMark, RetryMark } from "@/components/BoardIcons"
import { ArrowDownIcon, CheckIcon } from "@/components/Icons"
import { Markdown } from "@/components/Markdown"
import { ResearchApprovalCard, ResearchProgress, ResearchReport } from "@/components/Research"
import { StepGroup } from "@/components/StepGroup"
import { RichCard } from "@/components/rich/RichBlock"
import { RichContext, type RichContextValue } from "@/components/rich/shared"

const EMPTY: ChatMessage[] = []

/** `panel`: the menu bar panel's chat, with the panel's own box under it instead of the docked composer. */
export function Thread({ threadId, panel = false }: { threadId: string; panel?: boolean }) {
  const messages = useStore((s) => s.messages[threadId] ?? EMPTY)
  const permissions = useStore((s) => s.permissions)
  // A plan question shows on its plan card, not as a permission card.
  const mine = useMemo(() => permissions.filter((p) => p.threadId === threadId && !p.plan), [permissions, threadId])
  const agentChat = useStore((s) => s.threads.find((t) => t.id === threadId)?.source === "agent")
  const threadCwd = useStore((s) => s.threads.find((t) => t.id === threadId)?.cwd)
  const running = useStore((s) => !!s.live[threadId] || !!s.threads.find((t) => t.id === threadId)?.running)
  const reviewing = useStore((s) => s.review === threadId)
  // After a few questions in "Ask before changes", the card offers to stop asking about edits.
  const calmer = useStore((s) => agentChat && (s.asks[threadId] ?? 0) >= 3 && modeOf(threadId, s) === "ask")
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const { pinned, jump } = useStickToBottom(scroller, content, threadId)
  const m = useMotion()

  const lastAssistant = [...messages].reverse().find((x) => x.role === "assistant")?.id

  // Markers between turns where a different model or agent starts answering.
  const rows: { msg: ChatMessage; switchedTo?: Answerer; question?: string }[] = []
  let prev: Answerer | undefined
  let asked: string | undefined
  for (const msg of messages) {
    const a = msg.answerer
    rows.push({ msg, switchedTo: a && prev && !sameAnswerer(a, prev) ? a : undefined, question: msg.role === "assistant" ? asked : undefined })
    if (a) prev = a
    if (msg.role === "user") asked = msg.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
  }

  type Item = { kind: "row"; row: (typeof rows)[number] }
  const items: Item[] = rows.map((row) => ({ kind: "row", row }))

  return (
    <div className="flex min-h-0 flex-1">
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The side gutter keeps text off the sidebar when the column is narrower than the reading width (Changes open). */}
      <div ref={scroller} data-thread-scroll className={`scroll min-h-0 flex-1 ${panel ? "px-[10px]" : "px-[24px]"}`} style={{ overflowAnchor: "none" }}>
        {/* The reading column (lib/layout.ts); the message box under it is a little wider. */}
        <div ref={content} className={`mx-auto flex ${column} flex-col ${agentChat ? "pt-[8px] pb-[18px] tracking-normal" : "pt-[8px] pb-[16px]"}`}>
          {items.map((item, i) => {
            const { msg, switchedTo, question } = item.row
            return (
            <Fragment key={msg.id}>
              {switchedTo && <SwitchDivider answerer={switchedTo} />}
              <div
                className={`${i === 0 || switchedTo ? "" : agentChat ? (mine.length ? "mt-[16px]" : "mt-[18px]") : "mt-[22px]"} ${rows.length > 12 && i < rows.length - 3 ? "msg-far" : ""}`}
              >
                {msg.role === "user" ? (
                  <UserBubble agent={agentChat} msg={msg} />
                ) : (
                  <AssistantMessage
                    threadId={threadId}
                    msg={msg}
                    isLast={msg.id === lastAssistant}
                    question={question}
                    answeredWith={nextUserText(messages, messages.indexOf(msg))}
                  />
                )}
              </div>
            </Fragment>
            )
          })}
          {/* Sent, and the reply hasn't started yet (a CLI agent can take seconds): say so right away. */}
          {running && messages.at(-1)?.role === "user" && (
            <div className={agentChat ? "mt-[18px]" : "mt-[22px]"}>
              <StepGroup parts={[]} live />
            </div>
          )}
          <AnimatePresence>
            {mine.map((p) => (
              <motion.div key={p.id} exit={{ opacity: 0, height: 0, marginTop: 0 }} transition={m.t()} className={agentChat ? "mt-[16px]" : "mt-[22px]"}>
                <PermissionCard request={p} cwd={threadCwd} />
              </motion.div>
            ))}
            {calmer && mine.length > 0 && (
              <motion.div key="calmer" exit={{ opacity: 0 }} transition={m.t()} className="mt-[8px] flex flex-wrap items-center gap-x-[6px] px-[4px] text-[13px] leading-5 text-ink-3">
                <span>Asking a lot?</span>
                <button
                  type="button"
                  onClick={() => void setMode(threadId, "acceptEdits")}
                  className="border-0 bg-transparent p-0 text-[13px] text-ink-2 underline decoration-[var(--hairline-strong)] underline-offset-[3px] hover:text-ink"
                >
                  Let it edit files in this chat
                </button>
                <span>It still asks before commands.</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {/* The composer sits on the page's own ground, with a short fade above it, so a long reply never shows through. */}
      {!panel && (
      <div className={`${composerDock} bg-background`}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-8 h-8" style={{ background: "linear-gradient(to top, var(--background), transparent)" }} />
        <AnimatePresence>
          {!pinned && (
            <motion.button
              key="jump"
              aria-label="Jump to latest"
              initial={{ opacity: 0, y: m.reduced ? 0 : 6, scale: m.reduced ? 1 : 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: m.reduced ? 0 : 6, scale: m.reduced ? 1 : 0.9 }}
              transition={m.t()}
              onClick={() => jump()}
              className="absolute -top-12 left-1/2 z-10 -ml-4 flex h-8 w-8 items-center justify-center rounded-full border-0 bg-pop text-ink-2 shadow-[var(--shadow)] hover:text-ink"
            >
              <ArrowDownIcon size={14} />
            </motion.button>
          )}
        </AnimatePresence>
        <Composer variant="docked" threadId={threadId} />
      </div>
      )}
    </div>
    <AnimatePresence>{reviewing && <ChangesPanel key="changes" threadId={threadId} />}</AnimatePresence>
    </div>
  )
}

function SwitchDivider({ answerer }: { answerer: Answerer }) {
  const catalog = useStore((s) => s.catalog)
  return (
    <div className="my-8 flex items-center gap-3 text-[12px] text-ink-3" role="separator">
      <span className="h-px flex-1 bg-fill" />
      <span>Switched to {answererLabel(answerer, catalog)}</span>
      <span className="h-px flex-1 bg-fill" />
    </div>
  )
}

const UserBubble = memo(function UserBubble({ msg, agent }: { msg: ChatMessage; agent?: boolean }) {
  const fresh = useStore((s) => !!s.fresh[msg.id])
  const m = useMotion()
  const text = msg.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
  const files = msg.attachments ?? []
  return (
    <motion.div
      initial={fresh ? m.rise.initial : false}
      animate={m.rise.animate}
      transition={m.rise.transition}
      className="group/user flex w-full flex-col items-end gap-[8px]"
    >
      {files.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {files.map((a, i) => (
            <AttachmentChip key={a.path || a.name + i} a={a} />
          ))}
        </div>
      )}
      {text && (
        // Your message in a quiet grey bubble on the right (board "Chat messages", grey, approved 2026-10-26).
        <div
          className={`bubble selectable ${agent ? "max-w-[560px]" : "max-w-[596px]"} rounded-[18px] bg-bubble px-[18px] py-[10px] text-[16px] leading-[24px] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]`}
        >
          {text}
        </div>
      )}
    </motion.div>
  )
})

/** The user's message right after this one, if any: a picked choice comes back as it. */
function nextUserText(messages: ChatMessage[], i: number): string | undefined {
  const next = messages[i + 1]
  return next?.role === "user" ? next.parts.map((p) => (p.type === "text" ? p.text : "")).join("") : undefined
}

export function AssistantMessage({
  threadId,
  msg,
  isLast,
  question,
  answeredWith,
}: { threadId: string; msg: ChatMessage; isLast: boolean; question?: string; answeredWith?: string }) {
  const live = useStore((s) => (s.live[threadId]?.message.id === msg.id ? s.live[threadId] : undefined))
  const threadRunning = useStore((s) => !!s.threads.find((t) => t.id === threadId)?.running)
  const cwd = useStore((s) => s.threads.find((t) => t.id === threadId)?.cwd)
  const waiting = useStore((s) => isLast && s.permissions.some((p) => p.threadId === threadId))
  // The steps a permission card is asking about: the card shows them, so their rows step aside.
  const askedKey = useStore((s) => (isLast ? s.permissions.flatMap((p) => (p.threadId === threadId && p.toolCallId ? [p.toolCallId] : [])).join(" ") : ""))
  const asked = useMemo(() => (askedKey ? askedKey.split(" ") : []), [askedKey])
  const planQ = useStore((s) => (isLast ? s.permissions.find((p) => p.threadId === threadId && p.plan) : undefined))
  const inPlan = useStore((s) => modeOf(threadId, s) === "plan" && s.threads.find((t) => t.id === threadId)?.source === "agent")
  const fresh = useStore((s) => !!s.fresh[msg.id])
  const error = useStore((s) => s.errors[msg.id])
  const catalog = useStore((s) => s.catalog)
  const m = useMotion()
  const [copied, setCopied] = useState(false)

  // Without a live update (opened mid-reply), a running chat's last reply still counts as live.
  const replyLive = !!live || (isLast && threadRunning)
  const segments = segment(msg.parts)
  const sources = msg.parts.flatMap((p) => (p.type === "source" ? [{ id: p.id, url: p.url, title: p.title }] : []))
  const lastIndex = segments.length - 1
  const research = msg.parts.find((p) => p.type === "research")
  // An agent chat waiting on you shows its steps as plain rows and its plan in a tight card (board RC-AgentChat).
  const compact = !!cwd && waiting
  // Plan mode, nothing running: the last reply's plan (or a plan it wrote in words) can start.
  const planIdle = isLast && inPlan && !replyLive && !threadRunning && !planQ
  const approval = msg.parts.find((p) => p.type === "researchApproval")
  // A CLI agent whose sign-in lapsed: Sign in opens the terminal on that CLI's login.
  const signInFor = (text: string) => {
    const agentId = signInAgent(text, msg.answerer)
    return agentId ? () => openTerminal(agentId) : undefined
  }

  const rich = useMemo<RichContextValue>(
    () => ({ canAnswer: isLast && !replyLive && !threadRunning, answeredWith, choose: (text) => void sendInThread(threadId, text) }),
    [isLast, replyLive, threadRunning, answeredWith, threadId],
  )

  const copy = () => {
    void navigator.clipboard?.writeText(replyText(msg.parts))
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <RichContext.Provider value={rich}>
    <>
    <motion.div
      initial={fresh ? m.rise.initial : false}
      animate={m.rise.animate}
      transition={m.rise.transition}
      className={`group/reply flex flex-col ${compact ? "gap-[16px]" : cwd ? "gap-[18px]" : "gap-[16px]"}`}
    >
      {approval && <ResearchApprovalCard threadId={threadId} messageId={msg.id} part={approval} canAct={isLast} />}
      {research && <ResearchProgress data={research.data} question={question} />}
      {research && (
        <ResearchReport
          text={segments.flatMap((s) => (s.kind === "text" ? [s.text] : [])).join("\n\n")}
          data={research.data}
          streaming={replyLive}
        />
      )}
      {replyLive && segments.length === 0 && !research && !approval && <StepGroup parts={[]} live startedAt={live?.startedAt} waiting={waiting} />}
      {segments.map((s, i) => {
        // A research run draws its own progress and report.
        if (research && (s.kind === "text" || s.kind === "steps")) return null
        if (s.kind === "steps")
          return (
            <StepGroup
              key={s.id}
              parts={s.parts}
              live={isLiveGroup(s.parts, replyLive, i === lastIndex)}
              startedAt={live?.startedAt}
              waiting={waiting && i === lastIndex}
              compact={compact}
              asked={asked}
              cwd={cwd}
            />
          )
        if (s.kind === "text")
          return compact ? (
            <div key={s.id} className="[&_.md]:text-[15px]! [&_.md]:leading-[22px]!">
              <Markdown text={s.text} streaming={replyLive && i === lastIndex} sources={sources} />
            </div>
          ) : (
            <Markdown key={s.id} text={s.text} streaming={replyLive && i === lastIndex} sources={sources} />
          )
        if (s.kind === "plan") {
          const waits = !!planQ && planQ.plan?.partId === s.part.id
          const canStart = waits || (planIdle && s.part.stage === "proposed")
          return (
            <PlanCard
              key={s.id}
              part={s.part}
              compact={compact}
              onStart={canStart ? () => void startPlan(threadId) : undefined}
              onChange={canStart ? () => void changePlan(threadId) : undefined}
            />
          )
        }
        if (s.kind === "rich") return <RichCard key={s.id} block={s.part.block} />
        return <ErrorCard key={s.id} text={s.text} onRetry={isLast ? () => void retry(threadId, msg.id) : undefined} onSignIn={signInFor(s.text)} />
      })}
      {planIdle && !segments.some((s) => s.kind === "plan") && segments.some((s) => s.kind === "text") && (
        <motion.div {...m.rise}>
          <PlanActions bare onStart={() => void startPlan(threadId)} onChange={() => void changePlan(threadId)} note="Nothing changes until you start" />
        </motion.div>
      )}
      {error && !segments.some((s) => s.kind === "error") && (
        <ErrorCard text={error} onRetry={isLast ? () => void retry(threadId, msg.id) : undefined} onSignIn={signInFor(error)} />
      )}
      {!replyLive && segments.some((s) => s.kind === "text") && (
        <div
          // An older reply's buttons only show on hover, so they don't hold their own 32 px between turns:
          // they hang into the gap above the next message.
          className={`-ml-[8px] flex items-center gap-[2px] text-ink-3 transition-opacity duration-200 ${
            isLast ? "opacity-100" : "relative z-[1] -mb-[26px] opacity-0 group-hover/reply:opacity-100 focus-within:opacity-100"
          }`}
        >
          <ActionButton label={copied ? "Copied" : "Copy"} onClick={copy}>
            {copied ? <CheckIcon size={16} /> : <CopyMark size={16} />}
          </ActionButton>
          {isLast && (
            <ActionButton label="Try again" onClick={() => void retry(threadId, msg.id)}>
              <RetryMark size={16} />
            </ActionButton>
          )}
        </div>
      )}
    </motion.div>
    </>
    </RichContext.Provider>
  )
}

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-[32px] items-center justify-center rounded-full border-0 bg-transparent text-inherit transition-colors duration-150 hover:bg-fill-2 hover:text-ink"
    >
      {children}
    </button>
  )
}

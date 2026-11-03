import { motion } from "motion/react"
import { useCallback, useMemo, useRef, useState } from "react"

import type { ChatMessage } from "@shared/types"

import { answererLabel } from "@/lib/answerer"
import { invoke } from "@/lib/bridge"
import { useMotion } from "@/lib/motion"
import { nextAnswerer, useStore } from "@/lib/store"
import { chatContext, money, tokens } from "@/lib/usage"

import { Popover } from "./Popover"

const EMPTY: ChatMessage[] = []
const R = 7
const C = 2 * Math.PI * R

/**
 * A small ring by the composer: how full this chat's context is. Its popover adds the plan and the
 * credits left on the account (Axe chats) or the agent's own plan (CLI chats).
 */
export function UsageRing({ threadId }: { threadId: string }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const m = useMotion()
  const messages = useStore((s) => s.messages[threadId] ?? EMPTY)
  const catalog = useStore((s) => s.catalog)
  const profile = useStore((s) => s.profile)
  const answererKey = useStore((s) => JSON.stringify(nextAnswerer(threadId, s)))
  const answerer = useMemo(() => JSON.parse(answererKey) as ReturnType<typeof nextAnswerer>, [answererKey])
  const ctx = useMemo(() => chatContext(messages, catalog), [messages, catalog])
  const close = useCallback(() => setOpen(false), [])

  const isAgent = answerer.kind === "agent"
  const fraction = ctx?.fraction ?? 0
  const pct = Math.round(fraction * 100)
  // Calm grey until it's nearly full: orange from 70%, red from 90%. Never the brand colour.
  const tone = fraction >= 0.9 ? "var(--bad)" : fraction >= 0.7 ? "var(--warn)" : "var(--ink-2)"
  const label = ctx?.size ? `${pct}% of context used` : ctx ? `${tokens(ctx.used)} tokens in context` : "Usage"

  return (
    <div className="relative flex">
      <button
        ref={btn}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-[28px] w-[34px] items-center justify-center rounded-full border-0 transition-colors duration-150 ${open ? "bg-fill-2" : "bg-transparent hover:bg-fill"}`}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
          {/* The full track in both themes (a white track vanished on light, leaving a lone tick). */}
          <circle cx="9" cy="9" r={R} fill="none" stroke="var(--fill-3)" strokeWidth="2" />
          <motion.circle
            cx="9"
            cy="9"
            r={R}
            fill="none"
            stroke={tone}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={C}
            initial={false}
            animate={{ strokeDashoffset: C * (1 - Math.max(fraction, ctx ? 0.02 : 0)) }}
            transition={m.t(0.32)}
          />
        </svg>
      </button>
      <Popover open={open} onClose={close} anchor={btn} origin="bottom right" role="dialog" label="Usage" className="right-0 bottom-[calc(100%+8px)] w-[300px] p-0 text-ink">
        <div className="flex flex-col gap-3 px-4 pt-3.5 pb-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-ink-3">This chat</span>
            <span className="text-[12px] text-ink-3">{answererLabel(answerer, catalog)}</span>
          </div>
          {ctx ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-[13px]">
                <span>{ctx.size ? `${pct}% of context used` : `${tokens(ctx.used)} tokens`}</span>
                {ctx.size ? <span className="text-[12px] text-ink-3 tabular-nums">{`${tokens(ctx.used)} of ${tokens(ctx.size)}`}</span> : null}
              </div>
              {!!ctx.size && (
                <div className="h-1 overflow-hidden rounded-full bg-fill-2">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: tone }} />
                </div>
              )}
              {fraction >= 0.8 && (
                <span className="text-[12px] leading-[18px] text-ink-3">Long chats get slower and forget early details. Start a new chat for a new topic.</span>
              )}
            </div>
          ) : (
            <span className="text-[13px] text-ink-3">Shows after the first reply.</span>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-border px-4 pt-3 pb-3.5">
          {isAgent ? (
            <>
              <span className="text-[13px] text-ink-3">Your plan</span>
              <span className="text-[13px] leading-5 text-ink-2">
                {answererLabel(answerer, catalog)} runs on your own account, not your Axe credits.
                {ctx?.cost ? ` This session has cost ${money(ctx.cost)} so far.` : ""}
              </span>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-ink-3">Axe account</span>
                <span className="text-[12px] text-ink-3">{profile?.plan ?? "Free"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] tabular-nums">{`${(profile?.credits ?? 0).toLocaleString("en-US")} credits left`}</span>
                <button
                  onClick={() => void invoke("account:openBilling")}
                  className="h-7 rounded-[6px] border border-border bg-transparent px-2.5 text-[12px] text-ink transition-colors duration-150 hover:bg-fill"
                >
                  Add credits
                </button>
              </div>
            </>
          )}
        </div>
      </Popover>
    </div>
  )
}

import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState, type ReactNode } from "react"

import { D, useMotion } from "@/lib/motion"
import { keysOf, shortcutById } from "@/lib/shortcuts"
import {
  cancelDictation,
  closeTalk,
  finishDictation,
  interrupt,
  openMicSettings,
  toggleDictation,
  toggleMute,
  useVoice,
  type DictationTarget,
  type TalkPhase,
} from "@/lib/voice"
import { clock } from "@/lib/voice-logic"

import { CheckIcon, MicIcon, MicOffIcon, XIcon } from "./Icons"

const dictateKeys = () => {
  const s = shortcutById("dictate")
  return s?.key ? keysOf(s) : ""
}

/** The microphone button: tap to dictate, tap again to write it down. */
/** `icon` and `className`: the menu bar panel draws its own plain glyph and shape. */
export function MicButton({ target, size = 32, icon, className }: { target: DictationTarget; size?: number; icon?: ReactNode; className?: string }) {
  const listening = useVoice((s) => s.dictation.phase === "listening" && s.dictation.target === target)
  const busy = useVoice((s) => s.dictation.phase !== "idle" && s.dictation.phase !== "error" && s.dictation.target !== target)
  const label = listening ? "Stop and write it down" : `Dictate (hold ${dictateKeys()})`
  return (
    <button
      aria-label={listening ? "Stop dictating" : "Dictate"}
      title={label}
      disabled={busy}
      onClick={() => toggleDictation(target)}
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center ${className ?? "rounded-full"} border-0 transition-colors duration-150 ${
        listening ? "bg-accent-bg text-accent-ink" : `bg-transparent ${size >= 36 ? "text-ink-2" : "text-ink-3"} enabled:hover:bg-fill enabled:hover:text-ink`
      }`}
    >
      {icon ?? <MicIcon size={size >= 36 ? 19 : size >= 32 ? 16 : 15} />}
    </button>
  )
}

/** While you dictate: a live level line, the time, cancel and done. Also says when it's writing or stuck. */
export function DictationStrip({ target, className = "" }: { target: DictationTarget; className?: string }) {
  const d = useVoice((s) => (s.dictation.phase !== "idle" && s.dictation.target === target ? s.dictation : null))
  const m = useMotion()
  const [, tick] = useState(0)
  const listening = d?.phase === "listening"
  useEffect(() => {
    if (!listening) return
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [listening])

  return (
    <AnimatePresence initial={false}>
      {d && (
        <motion.div key="strip" {...m.collapse} className={`overflow-hidden ${className}`}>
          <div role="status" aria-live="polite" className="flex h-9 items-center gap-2.5 px-1">
            {d.phase === "listening" && (
              <>
                <Wave levels={d.levels} />
                <span className="text-[12px] text-ink-3 tabular-nums">{clock(Date.now() - d.startedAt)}</span>
                <span className="flex-1" />
                <StripButton label="Cancel" onClick={cancelDictation}>
                  <XIcon size={13} />
                </StripButton>
                <StripButton label="Write it down" primary onClick={() => void finishDictation()}>
                  <CheckIcon size={13} />
                </StripButton>
              </>
            )}
            {d.phase === "asking" && <span className="flex-1 text-[13px] text-ink-3">Waiting for the microphone</span>}
            {d.phase === "writing" && <span className="flex-1 text-[13px] text-ink-3">Writing it down</span>}
            {d.phase === "error" && (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] text-bad">{d.message}</span>
                {d.settings && (
                  <button onClick={openMicSettings} className="h-7 shrink-0 rounded-full border-0 bg-fill-4 px-3 text-[12px] text-ink hover:bg-fill-3">
                    Open Settings
                  </button>
                )}
                <StripButton label="Dismiss" onClick={cancelDictation}>
                  <XIcon size={13} />
                </StripButton>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function StripButton({ label, onClick, primary, children }: { label: string; onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-0 transition-colors duration-150 ${
        primary ? "bg-button text-button-ink" : "bg-fill-2 text-ink-2 hover:bg-fill-3 hover:text-ink"
      }`}
    >
      {children}
    </button>
  )
}

const WAVE_BARS = 40

/** The last few seconds of your voice as bars, newest on the right. Moves only when you do. */
function Wave({ levels }: { levels: number[] }) {
  const bars = [...Array.from({ length: Math.max(0, WAVE_BARS - levels.length) }, () => 0), ...levels.slice(-WAVE_BARS)]
  return (
    <div aria-hidden="true" className="flex h-5 items-center gap-[2px]">
      {bars.map((l, i) => (
        <span key={i} className="w-[2px] rounded-full bg-accent-2" style={{ height: `${Math.max(2, Math.round(l * 20))}px`, opacity: l ? 0.9 : 0.35 }} />
      ))}
    </div>
  )
}

// ---------- Talk mode ----------

const STATUS: Record<TalkPhase, string> = {
  starting: "Getting the microphone",
  listening: "Listening",
  hearing: "Listening",
  writing: "Got it",
  thinking: "Thinking",
  speaking: "Speaking",
  muted: "Muted",
  error: "Can't listen right now",
}

/** Talk to Axe: an orb in the middle of the window, what you said, and the answer as it's read. */
export function TalkOverlay() {
  const talk = useVoice((s) => s.talk)
  const m = useMotion()

  useEffect(() => {
    if (!talk.open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        closeTalk()
      }
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
  }, [talk.open])

  return (
    <AnimatePresence>
      {talk.open && (
        <motion.div
          key="talk"
          role="dialog"
          aria-label="Talk to Axe"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={m.t(D.base)}
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center backdrop-blur-[18px]"
          style={{ background: "var(--talk-scrim)" }}
        >
          <motion.div
            initial={m.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={m.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, filter: "blur(6px)" }}
            transition={m.t(D.slow)}
            className="flex w-[560px] max-w-[calc(100vw-48px)] flex-col items-center"
          >
            <button
              aria-label={talk.phase === "speaking" ? "Stop speaking and listen" : STATUS[talk.phase]}
              onClick={interrupt}
              className="border-0 bg-transparent p-0"
            >
              <Orb phase={talk.phase} level={talk.level} beat={talk.beat} />
            </button>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={talk.phase === "hearing" ? "listening" : talk.phase}
                initial={{ opacity: 0, y: m.reduced ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: m.reduced ? 0 : -6 }}
                transition={m.t()}
                className="m-0 mt-9 text-[15px] text-ink-2"
              >
                {STATUS[talk.phase]}
              </motion.p>
            </AnimatePresence>
            <Caption />
          </motion.div>
          <div className="absolute bottom-10 flex items-center gap-3">
            <RoundButton label={talk.phase === "muted" ? "Unmute" : "Mute"} onClick={toggleMute} on={talk.phase === "muted"} disabled={talk.phase === "error" || talk.phase === "starting"}>
              {talk.phase === "muted" ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
            </RoundButton>
            <RoundButton label="End" onClick={closeTalk}>
              <XIcon size={16} />
            </RoundButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Caption() {
  const talk = useVoice((s) => s.talk)
  const m = useMotion()
  if (talk.phase === "error")
    return (
      <div className="mt-4 flex min-h-[132px] flex-col items-center gap-3 text-center">
        <p className="m-0 text-[13px] text-bad">{talk.message}</p>
        {talk.settings && (
          <button onClick={openMicSettings} className="h-8 rounded-full border-0 bg-fill-4 px-4 text-[13px] text-ink hover:bg-fill-3">
            Open Settings
          </button>
        )}
      </div>
    )
  // The voice reports where each word starts; light up through the end of that word.
  const space = talk.reply.indexOf(" ", talk.spokenUpTo)
  const upTo = talk.spokenUpTo <= 0 ? 0 : space < 0 ? talk.reply.length : space
  const said = talk.reply.slice(0, upTo)
  const rest = talk.reply.slice(upTo)
  return (
    <div className="mt-4 flex min-h-[132px] w-full flex-col items-center gap-3 text-center">
      {talk.heard && (
        <motion.p key={talk.heard} {...m.rise} className="m-0 max-w-full text-[13px] leading-[21px] text-ink-3">
          {talk.heard}
        </motion.p>
      )}
      {talk.reply && (
        <motion.p key={talk.reply.slice(0, 40)} {...m.rise} className="scroll m-0 max-h-[132px] text-[20px] leading-[26px] text-ink-4">
          <span className="text-ink transition-colors duration-150">{said}</span>
          {rest}
        </motion.p>
      )}
      {talk.silent && <p className="m-0 text-[12px] text-ink-3">No system voice is installed, so answers are shown here.</p>}
    </div>
  )
}

function RoundButton({ label, onClick, on, disabled, children }: { label: string; onClick: () => void; on?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-12 w-12 items-center justify-center rounded-full border-0 transition-colors duration-150 disabled:opacity-50 ${
        on ? "bg-button text-button-ink" : "bg-pop text-ink enabled:hover:bg-fill-3"
      }`}
    >
      {children}
    </button>
  )
}

/**
 * The orb. It answers you: grows with your voice while listening, settles while Axe thinks, and
 * gives a small lift on each spoken word. Nothing moves on its own.
 */
export function Orb({ phase, level, beat, size = 168 }: { phase: TalkPhase; level: number; beat: number; size?: number }) {
  const m = useMotion()
  const listening = phase === "listening" || phase === "hearing"
  const scale = m.reduced
    ? 1
    : listening
      ? 1 + Math.min(1, level) * 0.16
      : phase === "speaking"
        ? beat % 2
          ? 1.05
          : 1.015
        : phase === "muted" || phase === "error"
          ? 0.86
          : phase === "starting"
            ? 0.9
            : 0.94
  const glow = listening ? 0.35 + Math.min(1, level) * 0.6 : phase === "speaking" ? 0.55 : phase === "muted" || phase === "error" ? 0.08 : 0.3
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <motion.div
        aria-hidden="true"
        animate={{ opacity: glow, scale: scale * 1.18 }}
        transition={m.t(D.fast)}
        className="absolute inset-0 rounded-full blur-[36px]"
        style={{ background: "var(--orb-glow)" }}
      />
      <motion.div
        aria-hidden="true"
        animate={{ scale, filter: phase === "muted" || phase === "error" ? "saturate(0.1)" : "saturate(1)" }}
        transition={m.t(listening ? D.fast : D.base)}
        className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(circle at 34% 28%, var(--orb-1) 0%, var(--orb-2) 42%, var(--orb-3) 100%)",
          boxShadow: "inset 0 -10px 30px rgba(0,0,0,0.25), inset 0 6px 18px rgba(255,255,255,0.25)",
        }}
      />
    </div>
  )
}

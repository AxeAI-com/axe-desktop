import { AnimatePresence, motion } from "motion/react"

import { invoke } from "@/lib/bridge"
import { useMotion } from "@/lib/motion"
import { useStore } from "@/lib/store"
import { updateLine } from "@/lib/updates"

import { UpdateIcon } from "./Icons"

// Updates in the window: a quiet "Restart to update" at the foot of the sidebar once a new version has
// downloaded and checked out, and a row in Settings that says where things stand.

export function UpdatePill() {
  const state = useStore((s) => s.update.state)
  const m = useMotion()
  return (
    <AnimatePresence initial={false}>
      {state.status === "ready" && (
        <motion.div key="pill" {...m.collapse} className="shrink-0 overflow-hidden px-[8px]">
          <button
            onClick={() => void invoke("updates:install")}
            title={`Version ${state.version} is ready`}
            className="mt-[4px] mb-[4px] flex h-[36px] w-full items-center gap-[10px] rounded-[16px] border-0 bg-card px-[12px] text-left text-[13px] text-ink transition-colors duration-150 hover:bg-fill"
          >
            <span className="flex w-[18px] justify-center text-brand">
              <UpdateIcon size={15} />
            </span>
            <span className="flex-1">Restart to update</span>
            <span className="text-[12px] text-ink-3 tabular-nums">{state.version}</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The Updates row in Settings. */
export function UpdateRow({ ghost }: { ghost: string }) {
  const { version, state } = useStore((s) => s.update)
  const busy = state.status === "checking" || state.status === "downloading"
  return (
    <div className="flex items-center gap-[12px] bg-card px-[16px] py-[12px]">
      <div className="flex min-w-[0px] flex-1 flex-col gap-[2px]">
        <span className="text-[14px] leading-[20px]">Axe AI {version}</span>
        <span role="status" className={`text-[12px] leading-[17px] ${state.status === "error" ? "text-bad" : "text-ink-3"}`}>
          {updateLine(state, Date.now())}
        </span>
      </div>
      {state.status === "ready" ? (
        <button className={ghost} onClick={() => void invoke("updates:install")}>
          Restart to update
        </button>
      ) : state.status !== "unsupported" ? (
        <button className={ghost} disabled={busy} onClick={() => void invoke("updates:check")}>
          {state.status === "checking" ? "Checking" : "Check for updates"}
        </button>
      ) : null}
    </div>
  )
}

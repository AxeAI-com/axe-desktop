import { AnimatePresence, motion } from "motion/react"

import { useMotion } from "@/lib/motion"
import { cancelSignIn, signIn, useStore } from "@/lib/store"

import { AxeMark } from "@/components/Logo"
import { Dots } from "@/components/StepGroup"

/** Signed out: the mark, one line, and a way in through the browser. */
export function SignIn() {
  const waiting = useStore((s) => s.signingIn)
  const m = useMotion()
  const rise = (i: number) => ({ ...m.rise, transition: { ...m.t(0.32), delay: m.reduced ? 0 : i * 0.06 } })
  return (
    <div className="flex h-full flex-col bg-ground">
      <div className="drag h-12 shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center gap-7 pb-24">
        <motion.div {...rise(0)} className="text-ink">
          <AxeMark size={44} />
        </motion.div>
        <motion.h1 {...rise(1)} className="m-0 text-[20px] leading-10 font-light tracking-[-0.02em]">
          A billion ideas. Build yours.
        </motion.h1>
        <motion.div {...rise(2)} className="flex h-[76px] flex-col items-center gap-3">
          <AnimatePresence mode="wait" initial={false}>
            {waiting ? (
              <motion.div
                key="waiting"
                initial={{ opacity: 0, y: m.reduced ? 0 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={m.t()}
                className="flex flex-col items-center gap-3"
              >
                <div className="flex h-10 items-center gap-2.5 text-[13px] text-ink-2">
                  <Dots />
                  Finish signing in in your browser
                </div>
                <button
                  onClick={() => void cancelSignIn()}
                  className="h-8 rounded-[6px] border-0 bg-transparent px-3 text-[13px] text-ink-3 transition-colors duration-150 hover:bg-fill hover:text-ink"
                >
                  Cancel
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="button"
                initial={{ opacity: 0, y: m.reduced ? 0 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={m.t()}
                className="flex flex-col items-center gap-3"
              >
                <motion.button
                  {...m.lift}
                  onClick={() => void signIn()}
                  className="flex h-10 items-center gap-2.5 rounded-[10px] border-0 bg-button px-5 text-[15px] text-button-ink"
                >
                  <AxeMark size={13} />
                  Sign in with Axe
                </motion.button>
                <div className="text-[13px] text-ink-3">Opens axeai.com in your browser</div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}

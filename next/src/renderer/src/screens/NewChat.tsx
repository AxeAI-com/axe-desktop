import { openWatching } from "@/lib/watching"
import { motion } from "motion/react"
import { useEffect, useRef, useState } from "react"

import { folderName } from "@/lib/answerer"
import { composerWidth } from "@/lib/layout"
import { useMotion } from "@/lib/motion"
import { openSettingsAt } from "@/lib/shortcuts"
import { draftFolder, pickAnswerer, setMode, setResearch, setState, signIn, useStore } from "@/lib/store"
import { pickSuggestions, suggestionText, type SuggestionId } from "@/lib/suggestions"
import { pickGreeting } from "@/lib/greetings"

import { agentLogo, LogoTile } from "@/components/BrandLogo"
import { Composer, type ComposerHandle } from "@/components/Composer"
import { ChecklistIcon, EyeIcon, GlobeIcon, MonitorIcon, TerminalIcon } from "@/components/Icons"
import { HelperMark } from "@/components/Library"
import { IconTile, StarterCard } from "@/components/Kit"
import { AxeMark } from "@/components/Logo"

/** Today's greeting (lib/greetings), checked every minute: it moves only when the part of the day does. */
function useGreeting(name?: string) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return pickGreeting(now, name)
}

export function NewChat() {
  const name = useStore((s) => s.profile?.name)
  const agents = useStore((s) => s.catalog?.agents)
  const composer = useRef<ComposerHandle>(null)
  const hello = useGreeting(name)
  // Started from the agents library: its name instead of the greeting.
  const helper = useStore((s) => (s.draft.helperId ? s.library.helpers?.find((h) => h.id === s.draft.helperId) : undefined))

  const signedIn = useStore((s) => !!s.profile)
  const defaultModel = useStore((s) => s.catalog?.axe.defaultModelId ?? "auto")
  const folder = useStore((s) => draftFolder(s))
  const coder = agents?.find((a) => a.state === "ready")
  const ids = pickSuggestions({ signedIn, agentReady: !!coder })

  // Each card starts the feature it names: the right answerer, mode or page, and a first line to edit.
  const asAgent = (then: () => void) => coder && void pickAnswerer({ kind: "agent", agentId: coder.id }).then((ok) => ok && then())
  const asAxe = (then: () => void) => void pickAnswerer({ kind: "axe", modelId: defaultModel }).then((ok) => ok && then())
  const write = (t: string) => composer.current?.setText(t)
  const run: Record<SuggestionId, () => void> = {
    fix: () => asAgent(() => write("Run the tests, find what's failing and fix it.")),
    plan: () =>
      asAgent(() => {
        void setMode(undefined, "plan")
        write("Plan how to ")
      }),
    research: () =>
      asAxe(() => {
        setResearch(true)
        write("Research ")
      }),
    doit: () =>
      asAxe(() => {
        setState((s) => ({ draft: { ...s.draft, doIt: true, research: false } }))
        write("Find the PDFs I downloaded this week and list them by size.")
      }),
    watch: () => openWatching(),
    skill: () => write("/"),
    install: () => openSettingsAt("clis"),
    signin: () => void signIn(),
  }
  const tone: Record<SuggestionId, Parameters<typeof IconTile>[0]["tone"]> = { fix: "mute", plan: "mute", research: "mute", doit: "brand", watch: "mute", skill: "mute", install: "mute", signin: "brand" }
  const icon = (id: SuggestionId) => {
    if (id === "fix" && coder) return <LogoTile logo={agentLogo(coder)} name={coder.name} size={30} />
    const Icon = { fix: TerminalIcon, plan: ChecklistIcon, research: GlobeIcon, doit: MonitorIcon, watch: EyeIcon, skill: ChecklistIcon, install: TerminalIcon, signin: TerminalIcon }[id]
    return (
      <IconTile tone={tone[id]} size={30}>
        {id === "signin" ? <AxeMark size={14} /> : <Icon size={17} />}
      </IconTile>
    )
  }

  const stagger = useStagger()

  return (
    <StartPage
      head={
        helper ? (
          <motion.div key={helper.id} {...stagger(0)} className="mb-[40px] flex flex-col items-center gap-[12px]">
            <HelperMark kind={helper.kind} size={44} />
            <h1 className="m-0 text-[22px] leading-7 tracking-[-0.01em]">{helper.name}</h1>
            <p className="m-0 -mt-1 text-[14px] text-ink-3">{helper.role}</p>
          </motion.div>
        ) : (
          <StartHeading text={hello} />
        )
      }
      cards={
        <motion.div {...stagger(2)} className={`mt-[44px] grid ${composerWidth} grid-cols-2 gap-[12px] md:grid-cols-4 ${helper ? "invisible" : ""}`}>
          {ids.map((id) => {
            const t = suggestionText(id, coder?.name, folder ? folderName(folder) : undefined)
            return <StarterCard key={id} onClick={run[id]} icon={icon(id)} title={t.title} note={t.note} />
          })}
        </motion.div>
      }
      dock={<Composer ref={composer} variant="start" />}
    />
  )
}

/** The rising entrance New chat and Watching share: the heading, then the dock, then the cards. */
export function useStagger() {
  const m = useMotion()
  return (i: number) => ({
    initial: m.rise.initial,
    animate: m.rise.animate,
    transition: { ...m.t(0.32), delay: m.reduced ? 0 : i * 0.05 },
  })
}

/** The logo and the line on top of a start page. */
export function StartHeading({ text }: { text: string }) {
  const stagger = useStagger()
  return (
    <motion.div {...stagger(0)} className="flex items-center gap-[14px]">
      <AxeMark size={22.53} className="text-ink" />
      <h1 className="m-0 text-[30px] leading-[38px] tracking-[-0.02em]">{text}</h1>
    </motion.div>
  )
}

/** A start page (New chat, an empty Watching): the heading and cards centred, the composer docked at the bottom. */
export function StartPage({ head, cards, dock }: { head: React.ReactNode; cards: React.ReactNode; dock: React.ReactNode }) {
  const stagger = useStagger()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center px-[16px] pb-[10px]">
      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center pb-[24px]">
        {head}
        {cards}
      </div>
      <motion.div {...stagger(1)} className="flex w-full shrink-0 flex-col items-center gap-[8px]">
        {dock}
      </motion.div>
    </div>
  )
}

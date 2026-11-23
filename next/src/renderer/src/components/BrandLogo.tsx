import type { AxeModel, LocalAgent, LocalModel, ModelServer } from "@shared/types"

import axeIcon from "@/assets/logos/axe-app-icon.svg?url"
import claude from "@/assets/logos/claude-color.svg?url"
import deepseek from "@/assets/logos/deepseek-color.svg?url"
import gemini from "@/assets/logos/gemini-color.svg?url"
import grok from "@/assets/logos/grok.svg?url"
import kimi from "@/assets/logos/kimi-color.svg?url"
import lmstudio from "@/assets/logos/lmstudio.svg?url"
import meta from "@/assets/logos/meta-color.svg?url"
import mistral from "@/assets/logos/mistral-color.svg?url"
import ollama from "@/assets/logos/ollama.svg?url"
import openai from "@/assets/logos/openai.svg?url"
import qwen from "@/assets/logos/qwen-color.svg?url"
import { TerminalIcon } from "./SolarIcons"


/** A logo file, and whether it is one colour (drawn in the text colour so it works light and dark). */
type Logo = { src: string; mono: boolean }

// Makers' logos, matched on the model's id and name (the website's model picker uses the same list).
const MAKERS: [RegExp, Logo][] = [
  [/gpt|openai|codex|\bo[1-9]\b/i, { src: openai, mono: true }],
  [/claude|anthropic|sonnet|opus|haiku|fable/i, { src: claude, mono: false }],
  [/gemini|gemma|google/i, { src: gemini, mono: false }],
  [/llama|meta/i, { src: meta, mono: false }],
  [/qwen|qwq/i, { src: qwen, mono: false }],
  [/deepseek/i, { src: deepseek, mono: false }],
  [/grok|x-ai|xai/i, { src: grok, mono: true }],
  [/kimi|moonshot/i, { src: kimi, mono: true }],
  [/mistral|mixtral|codestral/i, { src: mistral, mono: false }],
]

const maker = (text: string) => MAKERS.find(([re]) => re.test(text))?.[1]

export function modelLogo(m: Pick<AxeModel, "id" | "label">): Logo | undefined {
  return maker(`${m.id} ${m.label}`)
}

/** Known makers get their colour logo; any other CLI uses the ACP registry's icon (one colour). */
export function agentLogo(a: Pick<LocalAgent, "id" | "name" | "icon">): Logo | undefined {
  return maker(`${a.id} ${a.name}`) ?? (a.icon ? { src: a.icon, mono: true } : undefined)
}

/** A local model: its maker's logo (Qwen, Llama, Gemma…), else its server's. */
export function localModelLogo(m: Pick<LocalModel, "model" | "serverId">): Logo | undefined {
  return maker(m.model) ?? serverLogo({ id: m.serverId })
}

/** Ollama and LM Studio have their own marks (one colour); llama.cpp and servers you add show their initial. */
export function serverLogo(s: Pick<ModelServer, "id">): Logo | undefined {
  return s.id === "ollama" ? { src: ollama, mono: true } : s.id === "lmstudio" ? { src: lmstudio, mono: true } : undefined
}

/** Auto (Axe's router): the white Axe mark on Axe Blue, the app icon from axeai.com/brand. 27% corners. */
/** `square` keeps the sidebar's 27% corners; everywhere else logo tiles are circles (spec 0001). */
export function AxeTile({ size = 18, square }: { size?: number; square?: boolean }) {
  return (
    <img
      src={axeIcon}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      className="block shrink-0"
      style={{ borderRadius: square ? Math.round(size * 0.27) : 999 }}
    />
  )
}

/** A brand's logo in pickers and lists, bare like Pasta UI's model picker; its initial when there is none. */
export function BrandLogo({ logo, name, auto, size = 20 }: { logo?: Logo; name: string; auto?: boolean; size?: number }) {
  const inner = Math.round(size * 0.85)
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center text-ink"
      style={{ width: size, height: size }}
    >
      {auto ? (
        <AxeTile size={inner} />
      ) : logo?.mono ? (
        <span
          className="block bg-current"
          style={{ width: inner, height: inner, mask: `url("${logo.src}") center / contain no-repeat`, WebkitMask: `url("${logo.src}") center / contain no-repeat` }}
        />
      ) : logo ? (
        <img src={logo.src} alt="" width={inner} height={inner} draggable={false} />
      ) : (
        <span className="flex size-full items-center justify-center rounded-full bg-muted text-ink-3">
          <TerminalIcon size={inner} />
        </span>
      )}
    </span>
  )
}

/** A logo on its brand tile (Raycast style): Claude orange, OpenAI white, anything else grey. 27% corners. */
export function LogoTile({ logo, name, size = 18, auto, bg: tile, square }: { logo?: Logo; name: string; size?: number; auto?: boolean; bg?: string; square?: boolean }) {
  if (auto) return <AxeTile size={size} square={square} />
  const claude = /claude|anthropic/i.test(name)
  const light = /gpt|openai|codex/i.test(name)
  const bg = tile ?? (claude ? "#d97757" : light ? "#ffffff" : square ? "#2c2c30" : "var(--raised)")
  const ink = square ? "#ededf0" : "var(--ink)"
  const inner = Math.round(size * 0.62)
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size, borderRadius: square ? Math.round(size * 0.27) : 999, background: bg, color: light ? "#151517" : ink }}
    >
      {!logo ? (
        // No mark of its own (llama.cpp, a server you added): the generic command-line icon, never a letter.
        <TerminalIcon size={inner} />
      ) : claude || logo.mono ? (
        <span
          className="block bg-current"
          style={{ width: inner, height: inner, mask: `url("${logo.src}") center / contain no-repeat`, WebkitMask: `url("${logo.src}") center / contain no-repeat`, color: claude ? "#ffffff" : light ? "#151517" : ink }}
        />
      ) : (
        <img src={logo.src} alt="" width={inner} height={inner} draggable={false} />
      )}
    </span>
  )
}

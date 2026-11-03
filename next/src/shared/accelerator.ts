// Global shortcuts as Electron accelerators ("Alt+Space", "CommandOrControl+Shift+K"), shared by the
// engine (which registers them) and the window (which records and shows them).

export type Platform = "darwin" | "win32" | "linux"

/** ⌥Space on a Mac (like the old Axe app); Ctrl+Space elsewhere, because Alt+Space opens the window menu on Windows. */
export const defaultQuickBarKey = (platform: Platform) => (platform === "darwin" ? "Alt+Space" : "Control+Space")

const MODIFIERS = ["Command", "Control", "Alt", "Shift"] as const
type Modifier = (typeof MODIFIERS)[number]

const ALIASES: Record<string, Modifier> = {
  cmd: "Command",
  command: "Command",
  super: "Command",
  meta: "Command",
  ctrl: "Control",
  control: "Control",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
}

const NAMED_KEYS = new Set([
  "Space", "Tab", "Enter", "Backspace", "Delete", "Escape", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown",
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
])

export type Parsed = { modifiers: Modifier[]; key: string }

/**
 * Reads an accelerator. CommandOrControl means Command on a Mac and Control elsewhere.
 * Returns null for anything Electron wouldn't take or that has no modifier (a bare letter would
 * swallow typing everywhere); F-keys may stand alone.
 */
export function parseAccelerator(value: string, platform: Platform): Parsed | null {
  const bits = value.split("+").map((b) => b.trim())
  if (bits.some((b) => !b)) return null
  const keyRaw = bits.pop()!
  const modifiers: Modifier[] = []
  for (const b of bits) {
    const lower = b.toLowerCase()
    const m = lower === "commandorcontrol" || lower === "cmdorctrl" ? (platform === "darwin" ? "Command" : "Control") : ALIASES[lower]
    if (!m || modifiers.includes(m)) return null
    modifiers.push(m)
  }
  const key = normalKey(keyRaw)
  if (!key) return null
  if (!modifiers.length && !/^F\d+$/.test(key)) return null
  // Shift alone with a letter is just a capital letter.
  if (modifiers.length === 1 && modifiers[0] === "Shift" && key.length === 1) return null
  modifiers.sort((a, b) => MODIFIERS.indexOf(a) - MODIFIERS.indexOf(b))
  return { modifiers, key }
}

function normalKey(k: string): string | null {
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase()
  const named = [...NAMED_KEYS].find((n) => n.toLowerCase() === k.toLowerCase())
  if (named) return named
  if (/^[`\-=[\]\\;',./]$/.test(k)) return k
  return null
}

export const formatParsed = (p: Parsed) => [...p.modifiers, p.key].join("+")

const MAC_SYMBOL: Record<Modifier, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘" }
const MAC_ORDER: Modifier[] = ["Control", "Alt", "Shift", "Command"]
const KEY_LABEL: Record<string, string> = { Up: "↑", Down: "↓", Left: "←", Right: "→", Enter: "↩", Backspace: "⌫", Escape: "Esc" }

/** "⌥Space" on a Mac, "Ctrl+Space" elsewhere. */
export function displayAccelerator(value: string, platform: Platform): string {
  const p = parseAccelerator(value, platform)
  if (!p) return value
  const key = KEY_LABEL[p.key] ?? p.key
  if (platform === "darwin") return MAC_ORDER.filter((m) => p.modifiers.includes(m)).map((m) => MAC_SYMBOL[m]).join("") + key
  const names: Record<Modifier, string> = { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Command: "Win" }
  return [...p.modifiers.map((m) => names[m]), key].join("+")
}

/** The fields of a key press the recorder needs (a KeyboardEvent fits). */
export type KeyPress = { code: string; key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

/**
 * The accelerator a key press in the shortcut recorder means, or null while only modifiers are
 * held. Uses the physical key (code), so ⌥ letters on a Mac don't turn into symbols.
 */
export function acceleratorFromKey(e: KeyPress, platform: Platform): string | null {
  const key = keyFromCode(e.code)
  if (!key) return null
  const mods: string[] = []
  if (e.metaKey) mods.push(platform === "darwin" ? "Command" : "Super")
  if (e.ctrlKey) mods.push("Control")
  if (e.altKey) mods.push("Alt")
  if (e.shiftKey) mods.push("Shift")
  const p = parseAccelerator([...mods, key].join("+"), platform)
  return p ? formatParsed(p) : null
}

function keyFromCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]!
  m = /^Digit(\d)$/.exec(code)
  if (m) return m[1]!
  if (/^F\d+$/.test(code)) return code
  const map: Record<string, string> = {
    Space: "Space", Tab: "Tab", Enter: "Enter", Backspace: "Backspace", Delete: "Delete", Escape: "Escape",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  }
  return map[code] ?? null
}

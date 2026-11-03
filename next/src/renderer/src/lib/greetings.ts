// The line on top of New chat and Watching. Fifty of them; one is picked per day and time of day,
// so it stays put while you work and changes tomorrow. "{name}" is your first name when Axe knows it;
// without one, ", {name}" drops out.

export type DayPart = "morning" | "afternoon" | "evening" | "night"

type Greeting = { text: string; when?: DayPart }

export const GREETINGS: Greeting[] = [
  { text: "Welcome back, {name}" },
  { text: "What are we building today?" },
  { text: "Ready when you are, {name}" },
  { text: "Let's make something good" },
  { text: "Where should we start?" },
  { text: "Back at it, {name}" },
  { text: "What's on your mind?" },
  { text: "Let's get one thing done" },
  { text: "Pick up where you left off" },
  { text: "Nice to see you, {name}" },
  { text: "Something new today?" },
  { text: "Let's think it through" },
  { text: "Bring me the hard part" },
  { text: "One good idea is enough" },
  { text: "Let's ship something" },
  { text: "What needs fixing?" },
  { text: "Small steps, big work" },
  { text: "Your move, {name}" },
  { text: "Let's clear the list" },
  { text: "Ask me anything" },
  { text: "Fresh page, {name}" },
  { text: "Let's untangle it" },
  { text: "What's the plan?" },
  { text: "Here to help, {name}" },
  { text: "Let's keep it simple" },
  { text: "Got a question?" },
  { text: "Start with the first line" },
  { text: "Let's build it right" },
  { text: "Tell me what you need" },
  { text: "Make today count" },
  { text: "Hello again, {name}" },
  { text: "Let's dig in" },
  { text: "Big idea or quick fix?" },
  { text: "The floor is yours" },
  { text: "Let's get it working" },
  { text: "Ideas welcome" },
  { text: "Good morning, {name}", when: "morning" },
  { text: "Coffee first, then ideas", when: "morning" },
  { text: "Early start, {name}?", when: "morning" },
  { text: "Fresh morning, clear head", when: "morning" },
  { text: "Good afternoon, {name}", when: "afternoon" },
  { text: "Afternoon focus, {name}", when: "afternoon" },
  { text: "Halfway through the day", when: "afternoon" },
  { text: "Let's finish strong", when: "afternoon" },
  { text: "Good evening, {name}", when: "evening" },
  { text: "Evening session, {name}?", when: "evening" },
  { text: "One more thing tonight?", when: "evening" },
  { text: "Winding down or ramping up?", when: "evening" },
  { text: "Burning the midnight oil?", when: "night" },
  { text: "Late night, clear mind", when: "night" },
]

export function dayPart(now: Date): DayPart {
  const h = now.getHours()
  return h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : h >= 17 && h < 22 ? "evening" : "night"
}

/** A small stable hash, so the same day always lands on the same line. */
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function fill(text: string, name?: string) {
  const first = name?.trim().split(/\s+/)[0]
  return first ? text.replace("{name}", first) : text.replace(/,? \{name\}/, "")
}

/** Today's greeting for this part of the day. */
export function pickGreeting(now: Date, name?: string): string {
  const part = dayPart(now)
  const pool = GREETINGS.filter((g) => !g.when || g.when === part)
  const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${part}`
  return fill(pool[hash(key) % pool.length]!.text, name)
}

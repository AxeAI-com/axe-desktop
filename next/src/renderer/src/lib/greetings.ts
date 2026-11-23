// The line on top of New chat: one calm time-of-day greeting with your first name, "Good evening, Mia", or
// "Good evening" without a name. (On 2026-11-08 the website's longer rotating lines were tried and dropped.)

export type DayPart = "morning" | "afternoon" | "evening"

/** Morning 5:00 to 11:59, afternoon to 16:59, evening otherwise (late nights included). */
export function dayPart(now: Date): DayPart {
  const h = now.getHours()
  return h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : "evening"
}

/** The first name, capitalised; an email's part before the @ (as axeai.com's welcome does). */
export function firstName(name?: string | null): string | null {
  const base = name?.includes("@") ? name.split("@")[0] : name
  const first = base?.trim().split(/\s+/)[0]
  return first ? first[0]!.toUpperCase() + first.slice(1) : null
}

/** "Good evening, Mia", or "Good evening" without a name. */
export function pickGreeting(now: Date, name?: string | null): string {
  const first = firstName(name)
  return `Good ${dayPart(now)}${first ? `, ${first}` : ""}`
}

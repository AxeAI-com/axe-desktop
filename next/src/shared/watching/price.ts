// Price and stock: how amounts are written, and the sentences a change is told in. Pure, no model.

export type Stock = "In stock" | "Out of stock" | "Unknown"

export const NO_PRICE = "There’s no price on that page that Axe can read."
export const PRICE_GONE = "I can’t find the price on this page anymore."

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" }

/** "$48.00" (`exact`) or "$48"; "48.00 CAD" for a currency without a symbol here. */
export const money = (n: number, currency?: string, exact = true) => {
  const s = exact || !Number.isInteger(n) ? n.toFixed(2) : `${n}`
  const code = currency?.toUpperCase()
  const sym = code ? SYMBOL[code] : "$"
  return sym ? `${sym}${s}` : `${s} ${code}`
}

/** What a price run saved: the amount, its currency and the stock. */
export type PriceMemo = { price: number; currency?: string; stock: Stock }

const lower = (s: Stock) => s.toLowerCase()

/** "Stoneware clay, 25 lb is $48 and in stock. I’ll check every hour and tell you when either changes." */
export function pricePlan(name: string, p: PriceMemo | undefined, often: string, tell: string): string {
  const now = p ? `${name} is ${money(p.price, p.currency, false)}${p.stock === "Unknown" ? "" : ` and ${lower(p.stock)}`}. ` : ""
  return `${now}I’ll check ${often} and ${tell} when ${p && p.stock === "Unknown" ? "it" : "either"} changes.`
}

/** The first message: "$48, in stock. I’ll check every hour." */
export const priceFirst = (p: PriceMemo, often: string) => `${money(p.price, p.currency, false)}${p.stock === "Unknown" ? "" : `, ${lower(p.stock)}`}. I’ll check ${often}.`

/** The row's line on a quiet run: "$48. In stock." */
export const priceRow = (p: PriceMemo) => `${money(p.price, p.currency, false)}.${p.stock === "Unknown" ? "" : ` ${p.stock}.`}`

/** The strip's label: "$48, in stock, since Oct 1". */
export const priceStrip = (p: PriceMemo, since: string) => `${money(p.price, p.currency, false)}${p.stock === "Unknown" ? "" : `, ${lower(p.stock)}`}, since ${since}`

export type PriceChange = { headline: string; body: string; line: string }

/** What a change says, or null when neither the price nor the stock moved. */
export function priceChange(name: string, before: PriceMemo, after: PriceMemo): PriceChange | null {
  const cur = after.currency ?? before.currency
  const was = money(before.price, cur, false)
  const now = money(after.price, cur, false)
  const priceMoved = before.price !== after.price
  const stockMoved = before.stock !== after.stock && after.stock !== "Unknown" && before.stock !== "Unknown"
  if (!priceMoved && !stockMoved) return null
  const stockWords = after.stock === "Out of stock" ? (stockMoved ? "Now out of stock." : "Still out of stock.") : after.stock === "In stock" ? (stockMoved ? "Back in stock." : "Still in stock.") : ""
  if (priceMoved) {
    const down = after.price < before.price
    return {
      headline: `${down ? "Down" : "Up"} to ${now}`,
      body: `${name} went from ${was} to ${now}.${stockWords ? ` ${stockWords}` : ""}`,
      line: `${down ? "Down" : "Up"} to ${now} from ${was}.`,
    }
  }
  if (after.stock === "Out of stock") return { headline: "Out of stock", body: `${name} is out of stock. It was ${now}.`, line: `Out of stock. It was ${now}.` }
  return { headline: "Back in stock", body: `${name} is back in stock at ${now}.`, line: `Back in stock at ${now}.` }
}

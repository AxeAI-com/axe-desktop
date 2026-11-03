import type { ReactNode } from "react"

import { CATALOGUE, type CatalogueGroup, type CatalogueItem } from "@shared/watching/elements"
import { KIND_LABEL } from "@shared/watching/copy"
import type { Kind } from "@shared/watching/types"

import { COMPETITOR_PATH, KindIcon } from "@/components/WatchIcons"
import { useWidth } from "@/components/watching/Dashboard"

// Available elements (design "Watching redesign", Elements board): every kind Axe can watch as a card,
// This Mac and Web first, then the kinds that were there before. A card's click is Add: it starts the
// watch's chat. The preview shows the card's shape only: grey bars where its numbers go, never sample values.

/** The kinds from before the catalogue, in the same card style. */
const OLDER: { kind: Kind; note: string }[] = [
  { kind: "uptime", note: "Tells you when a site goes down or gets slow." },
  { kind: "page", note: "Tells you when the words on a page change." },
  { kind: "price", note: "Tells you when a price drops or it’s back in stock." },
  { kind: "security", note: "Certificate, headers and email records." },
  { kind: "repo", note: "Dependency alerts in a repo or folder." },
  { kind: "health", note: "A JSON health link keeps saying ok, and fast." },
  { kind: "expiry", note: "Before the certificate or the domain runs out." },
  { kind: "dns", note: "When a domain’s A, NS, MX or TXT records change." },
  { kind: "status", note: "Status pages of services you depend on." },
  { kind: "feed", note: "The app update feed, and that every file downloads." },
  { kind: "seo", note: "robots.txt, sitemap.xml, llms.txt and noindex." },
  { kind: "links", note: "Every page in the sitemap still loads." },
  { kind: "tests", note: "A folder’s tests, and when they start failing." },
  { kind: "outdated", note: "Packages a major version behind." },
  { kind: "disk", note: "Free space on this Mac." },
  { kind: "custom", note: "Anything one page can tell you, in your words." },
]
const ITEMS: CatalogueItem[] = [...CATALOGUE, ...OLDER.map((o): CatalogueItem => ({ id: o.kind, kind: o.kind, label: KIND_LABEL[o.kind], note: o.note, group: "more" }))]
const SECTIONS: { group: CatalogueGroup; label: string }[] = [
  { group: "mac", label: "This Mac" },
  { group: "web", label: "Web" },
  { group: "more", label: "Sites, services and code" },
]

/* The preview's pieces: a grey bar where a number goes, a row, a dim word. */

const B = ({ w, h = 8 }: { w: number; h?: number }) => <span aria-hidden="true" className="inline-block flex-none rounded-[4px]" style={{ width: w, height: h, background: "var(--dash-bar)" }} />
const Dim = ({ children }: { children: ReactNode }) => <span style={{ color: "var(--dash-label-2)" }}>{children}</span>
const Row = ({ children }: { children: ReactNode }) => <span className="flex items-center justify-between gap-[8px]">{children}</span>
const Track = ({ w }: { w: number }) => (
  <span aria-hidden="true" className="h-[4px] flex-1 overflow-hidden rounded-[2px]" style={{ background: "var(--dash-tick-empty)" }}>
    <span className="block h-full rounded-[2px]" style={{ width: `${w}%`, background: "var(--dash-bar)" }} />
  </span>
)
const Gap = ({ g = 4, children }: { g?: 4 | 8; children: ReactNode }) => <span className={`flex w-full flex-col justify-center ${g === 4 ? "gap-[4px]" : "gap-[8px]"}`}>{children}</span>
const three = (labels: [string, string][]) => (
  <Gap>
    {labels.map(([a, b]) => (
      <Row key={a}>
        <span>{a}</span>
        <span className="flex items-center gap-[6px]">
          <B w={28} />
          <Dim>{b}</Dim>
        </span>
      </Row>
    ))}
  </Gap>
)

function Preview({ id }: { id: string }) {
  switch (id) {
    case "processes":
      return (
        <Gap>
          {[56, 44, 36].map((w) => (
            <Row key={w}>
              <B w={w} />
              <span className="flex items-center gap-[6px]">
                <B w={22} />
                <Dim>CPU</Dim>
                <B w={30} />
              </span>
            </Row>
          ))}
        </Gap>
      )
    case "memory":
      return (
        <Gap g={8}>
          <Row>
            <B w={52} h={14} />
            <span className="flex items-center gap-[6px]">
              <B w={24} />
              <Dim>used</Dim>
            </span>
          </Row>
          <span aria-hidden="true" className="flex h-[8px] gap-[2px]">
            <span className="flex-[6] rounded-l-[4px]" style={{ background: "var(--dash-ok)" }} />
            <span className="flex-[3]" style={{ background: "color-mix(in srgb, var(--dash-warn) 35%, transparent)" }} />
            <span className="flex-[2] rounded-r-[4px]" style={{ background: "color-mix(in srgb, var(--dash-bad) 30%, transparent)" }} />
          </span>
        </Gap>
      )
    case "battery":
      return (
        <Gap>
          <span className="flex items-center gap-[8px]">
            <B w={40} h={14} />
            <Dim>health</Dim>
          </span>
          <span className="flex items-center gap-[6px]">
            <B w={22} />
            <Dim>cycles,</Dim>
            <B w={34} />
            <Dim>left</Dim>
          </span>
          <span className="flex items-center gap-[6px]">
            <Dim>Awake:</Dim>
            <B w={48} />
          </span>
        </Gap>
      )
    case "ports":
      return (
        <Gap g={8}>
          <span className="flex flex-wrap gap-[8px]">
            {[0, 1, 2].map((i) => (
              <span key={i} className="inline-flex h-[22px] items-center gap-[6px] rounded-[6px] px-[8px]" style={{ background: "var(--dash-chip)" }}>
                <span className="size-[6px] rounded-full" style={{ background: "var(--dash-label-3)" }} />
                <B w={26} />
              </span>
            ))}
          </span>
          <span className="flex items-center gap-[6px]">
            <B w={30} />
            <Dim>listening</Dim>
          </span>
        </Gap>
      )
    case "docker":
      return (
        <Gap g={8}>
          <span className="flex items-center gap-[16px]">
            <span className="flex items-center gap-[6px]">
              <B w={14} />
              <Dim>running</Dim>
            </span>
            <span className="flex items-center gap-[6px]">
              <B w={14} />
              <Dim>stopped</Dim>
            </span>
          </span>
          <span className="flex items-center gap-[8px]">
            <Track w={40} />
            <B w={40} />
          </span>
        </Gap>
      )
    case "gitrepos":
      return (
        <Gap>
          {(["uncommitted", "unpushed", "behind"] as const).map((x, i) => (
            <Row key={x}>
              <B w={52 - i * 6} />
              <span className="flex items-center gap-[6px]">
                <B w={10} />
                <Dim>{x}</Dim>
              </span>
            </Row>
          ))}
        </Gap>
      )
    case "brew":
      return (
        <Gap>
          <span className="flex items-baseline gap-[8px]">
            <B w={24} h={14} />
            <Dim>outdated</Dim>
          </span>
          <span className="flex items-center gap-[6px]">
            <B w={60} />
            <B w={40} />
          </span>
        </Gap>
      )
    case "macos":
      return (
        <Gap>
          <span className="flex items-baseline gap-[8px]">
            <B w={14} h={14} />
            <Dim>pending</Dim>
          </span>
          <span className="flex items-center gap-[6px]">
            <B w={72} />
            <B w={34} />
          </span>
        </Gap>
      )
    case "timemachine":
      return (
        <Gap g={8}>
          <Row>
            <Dim>Last backup</Dim>
            <B w={44} />
          </Row>
          <span aria-hidden="true" className="flex h-[16px] gap-[2px]">
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className="flex-1 rounded-[2px]" style={{ background: "var(--dash-tick-empty)" }} />
            ))}
          </span>
        </Gap>
      )
    case "hogs":
      return (
        <Gap>
          {[70, 45, 30].map((w) => (
            <span key={w} className="flex items-center gap-[8px]">
              <B w={52} />
              <Track w={w} />
              <B w={28} />
            </span>
          ))}
        </Gap>
      )
    case "network":
      return (
        <Gap g={8}>
          <span className="flex items-center gap-[8px]">
            <span aria-hidden="true" className="flex h-[14px] items-end gap-[2px]">
              {[5, 8, 11, 14].map((h) => (
                <span key={h} className="w-[4px] rounded-[1px]" style={{ height: h, background: "var(--dash-bar)" }} />
              ))}
            </span>
            <B w={56} h={10} />
          </span>
          <span className="flex items-center gap-[6px]">
            <Dim>IP</Dim>
            <B w={60} />
            <Dim>VPN</Dim>
            <B w={20} />
          </span>
        </Gap>
      )
    case "pagespeed":
      return (
        <Gap g={8}>
          <span className="flex items-center gap-[10px] whitespace-nowrap">
            {["LCP", "CLS", "First byte"].map((x) => (
              <span key={x} className="flex items-center gap-[4px]">
                <Dim>{x}</Dim>
                <B w={16} />
              </span>
            ))}
          </span>
          <span aria-hidden="true" className="h-[2px] w-full rounded-[1px]" style={{ background: "var(--dash-bar)" }} />
        </Gap>
      )
    case "wallets":
      return (
        <Gap>
          <Row>
            <span>USDC</span>
            <B w={40} />
          </Row>
          <Row>
            <span>USDT</span>
            <B w={40} />
          </Row>
          <span className="flex items-center gap-[6px]">
            <B w={10} />
            <Dim>new payments</Dim>
          </span>
        </Gap>
      )
    case "fees":
      return (
        <Gap>
          {["Base", "Solana", "Ethereum"].map((x) => (
            <Row key={x}>
              <span>{x}</span>
              <B w={36} />
            </Row>
          ))}
        </Gap>
      )
    case "mentions":
      return (
        <Gap>
          {["Hacker News", "Reddit"].map((x) => (
            <Row key={x}>
              <span className="flex-none">{x}</span>
              <B w={88} />
            </Row>
          ))}
          <span className="flex items-center gap-[6px]">
            <B w={10} />
            <Dim>new today</Dim>
          </span>
        </Gap>
      )
    case "email":
      return (
        <Gap>
          <span className="flex items-baseline gap-[6px]">
            <B w={14} h={14} />
            <Dim>of</Dim>
            <B w={16} />
            <Dim>blacklists</Dim>
          </span>
          <B w={96} />
        </Gap>
      )
    case "global":
      return (
        <Gap>
          {[
            ["N. America", 55],
            ["Europe", 40],
            ["Asia", 70],
          ].map(([x, w]) => (
            <span key={x} className="flex items-center gap-[8px]">
              <span className="w-[64px] flex-none">{x}</span>
              <Track w={w as number} />
              <B w={28} />
            </span>
          ))}
        </Gap>
      )
    case "competitor":
      return three([
        ["/pricing", "changed"],
        ["/changelog", "no change"],
      ])
    case "downloads":
      return (
        <Gap g={8}>
          <span className="flex items-baseline gap-[8px]">
            <B w={40} h={14} />
            <Dim>this week</Dim>
          </span>
          <span aria-hidden="true" className="flex h-[16px] items-end gap-[4px]">
            {[6, 10, 8, 12, 9, 14, 11].map((h, i) => (
              <span key={i} className="flex-1 rounded-[2px]" style={{ height: h, background: "var(--dash-bar)" }} />
            ))}
          </span>
        </Gap>
      )
    default:
      return null
  }
}

const Plus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

function Card({ item, i, onAdd }: { item: CatalogueItem; i: number; onAdd: (item: CatalogueItem) => void }) {
  const preview = item.group !== "more"
  return (
    <button type="button" aria-label={`Add ${item.label}`} onClick={() => onAdd(item)} className="dash-el dash-rise flex w-full cursor-pointer flex-col gap-[8px] rounded-[12px] border-0 p-[16px] text-left" style={{ ["--i" as string]: i, font: "inherit", color: "inherit" }} data-testid={`el-${item.id}`}>
      <span className="flex min-h-[40px] w-full items-center gap-[8px]">
        <span className="grid size-[32px] flex-none place-items-center rounded-[8px]" style={{ background: "var(--dash-tile)", color: "var(--dash-label)" }}>
          {item.id === "competitor" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={COMPETITOR_PATH} />
            </svg>
          ) : (
            <KindIcon kind={item.kind} size={16} strokeWidth={2.25} />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-[2px]">
          <span className="text-[13px] font-semibold">{item.label}</span>
          {item.recommended && (
            <span className="inline-flex h-[18px] items-center rounded-[6px] px-[6px] text-[11px]" style={{ color: "var(--dash-blue)", background: "var(--dash-blue-soft)" }}>
              Recommended
            </span>
          )}
        </span>
        <span aria-hidden="true" className="grid size-[28px] flex-none place-items-center rounded-[6px]" style={{ background: "var(--dash-btn)" }}>
          <Plus />
        </span>
      </span>
      <span className="block min-h-[30px] text-[11px]" style={{ color: "var(--dash-label-2)" }}>
        {item.note}
      </span>
      {preview && (
        <span className="flex h-[72px] w-full rounded-[8px] px-[12px] py-[8px] text-[11px]" style={{ background: "var(--dash-row)" }}>
          <Preview id={item.id} />
        </span>
      )}
    </button>
  )
}

/** The catalogue: a heading, then This Mac, Web and the older kinds, four cards a row when there's room. */
export function Catalogue({ onAdd, heading = true }: { onAdd: (item: CatalogueItem) => void; heading?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const cols = width >= 900 ? 4 : width >= 440 ? 2 : 1
  let n = 0
  return (
    <div ref={ref} className="flex w-full flex-col gap-[32px]" data-testid="catalogue">
      {heading && (
        <div className="flex flex-col gap-[4px]">
          <h2 className="m-0 text-[17px] font-semibold tracking-[-0.006em]">Available elements</h2>
          <p className="m-0 text-[13px]" style={{ color: "var(--dash-label-2)" }}>
            All work without signing in. Click to add to your dashboard.
          </p>
        </div>
      )}
      {SECTIONS.map(({ group, label }) => {
        const items = ITEMS.filter((x) => x.group === group)
        return (
          <section key={group} aria-labelledby={`el-${group}`} className="flex flex-col gap-[16px]">
            <div className="flex items-center gap-[8px]">
              <h2 id={`el-${group}`} className="m-0 text-[17px] font-semibold tracking-[-0.006em]">
                {label}
              </h2>
              <span className="mono inline-flex h-[22px] items-center rounded-[6px] px-[8px] text-[11px]" style={{ color: "var(--dash-label-2)", background: "var(--dash-chip)" }}>
                {items.length}
              </span>
            </div>
            <div className="grid gap-[16px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {items.map((item) => (
                <Card key={item.id} item={item} i={n++} onAdd={onAdd} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

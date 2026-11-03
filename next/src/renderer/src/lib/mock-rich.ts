import type { Answerer, ChatMessage, Part, ThreadSummary } from "@shared/types"

// Sample chats for the rich-reply cards (?mock=rich): every card done, broken, empty and
// still streaming. Placeholder people only.

const AUTO: Answerer = { kind: "axe", modelId: "auto" }
const text = (id: string, t: string): Part => ({ type: "text", id, text: t })
const user = (id: string, t: string): ChatMessage => ({ id, role: "user", parts: [text(`${id}-t`, t)], answerer: AUTO })
const reply = (id: string, parts: Part[]): ChatMessage => ({ id, role: "assistant", answerer: AUTO, parts })
const block = (lang: string, json: unknown) => `\`\`\`${lang}\n${typeof json === "string" ? json : JSON.stringify(json, null, 2)}\n\`\`\``

// 88 days of sales, Jul 1 to Sep 26.
const DAILY = [41247, 46667, 47914, 44086, 37935, 33720, 34194, 38495, 42796, 43355, 39398, 33763, 30710, 32817, 38968, 45161, 47570, 45290, 40989, 38882, 41376, 47269, 52559, 53548, 49548, 43398, 39527, 40473, 45075, 49505, 50151, 46366, 41118, 38710, 41419, 48000, 54323, 56645, 54237, 49978, 48043, 50710, 56559, 61634, 62237, 57935, 51785, 48215, 49548, 54452, 59011, 59656, 56043, 51140, 49290, 52559, 59441, 65806, 67871, 65290, 60989, 59183, 61978, 67785, 72516, 72731, 68172, 62108, 58839, 60602, 65849, 70495, 71183, 67656, 63140, 61806, 65548, 72688, 78925, 80731, 77892, 73505, 71828, 74667, 80387, 84817, 80244, 83373]
const DAYS = DAILY.map((_, i) => {
  const d = new Date(Date.UTC(2026, 6, 1 + i))
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
})

const VISUAL_HTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 0 14px">
<svg id="v" width="640" height="250" viewBox="0 0 640 250" role="img" aria-label="A beam of light splits into colours through a prism">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".08"/></linearGradient></defs>
<line id="beam" x1="40" y1="150" x2="300" y2="125" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/>
<g id="fan"></g>
<polygon points="320,40 400,190 240,190" fill="url(#g)" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
</svg>
<label style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-3)">Light angle <input id="a" type="range" min="-12" max="12" value="4" style="width:200px;accent-color:var(--accent)"> <span id="t" style="width:32px;font-variant-numeric:tabular-nums">4°</span></label>
</div>
<script>
const colours = ["#ff5a5a", "#ff9f43", "#ffd93d", "#4ee08a", "#3fb8ff", "#6b6bff", "#b46bff"]
const fan = document.getElementById("fan"), beam = document.getElementById("beam")
function draw(a) {
  beam.setAttribute("y1", 150 + a * 6)
  fan.innerHTML = colours.map((c, i) => {
    const y = 60 + i * 22 + a * 4 + i * Math.abs(a) * 0.9
    return '<line x1="345" y1="128" x2="610" y2="' + y + '" stroke="' + c + '" stroke-width="3" stroke-linecap="round" opacity=".9"/>'
  }).join("")
  document.getElementById("t").textContent = a + "°"
}
document.getElementById("a").addEventListener("input", (e) => draw(Number(e.target.value)))
draw(4)
</script>`

export function richSeed(now: number) {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString()
  const threads: ThreadSummary[] = [
    { id: "r-chart", source: "axe", title: "Q3 sales by day", pinned: false, updatedAt: ago(1) },
    { id: "r-choices", source: "axe", title: "Studio launch post", pinned: false, updatedAt: ago(2) },
    { id: "r-picked", source: "axe", title: "Tone for the newsletter", pinned: false, updatedAt: ago(3) },
    { id: "r-more", source: "axe", title: "Channels and regions", pinned: false, updatedAt: ago(4) },
    { id: "r-map", source: "axe", title: "Lisbon food stops", pinned: false, updatedAt: ago(5) },
    { id: "r-draft", source: "axe", title: "Launch week emails", pinned: false, updatedAt: ago(6) },
    { id: "r-visual", source: "axe", title: "Light through a prism", pinned: false, updatedAt: ago(7) },
    { id: "r-broken", source: "axe", title: "Cards that broke", pinned: false, updatedAt: ago(8) },
    { id: "r-empty", source: "axe", title: "Cards with nothing in them", pinned: false, updatedAt: ago(9) },
    { id: "r-live", source: "axe", title: "Cards on the way", pinned: false, updatedAt: ago(0), running: true },
    { id: "r-live-visual", source: "axe", title: "A visual on the way", pinned: false, updatedAt: ago(0), running: true },
  ]

  const messages: Record<string, ChatMessage[]> = {
    "r-chart": [
      {
        ...user("rc-u", "Chart sales by day for Q3."),
        attachments: [{ path: "", name: "sales-q3.csv", mime: "text/csv", size: 0 }],
      },
      reply("rc-a", [
        { type: "tool", id: "rc-t", title: "Read sales-q3.csv", kind: "read", state: "done", input: "sales-q3.csv" },
        text(
          "rc-x",
          `**Daily sales for Q3**, from sales-q3.csv.\n\n${block("axe-chart", { type: "line", title: "Daily sales", prefix: "$", labels: DAYS, series: [{ name: "Sales", values: DAILY }] })}\n\nSales climb through the quarter. The strongest days are in late September. Hover the line for any day.`,
        ),
      ]),
    ],
    "r-choices": [
      user("rq-u", "Write the launch post for Studio's new film mode."),
      reply("rq-a", [
        text(
          "rq-x",
          `Before I write it, one thing decides the tone:\n\n${block("axe-choices", {
            question: "Who is this post for first?",
            options: [
              { label: "Creators who make short videos", detail: "They feel the 15-second limit most. Lead with how fast it is.", recommended: true },
              { label: "Marketing teams", detail: "They need many versions of one ad. Lead with variations." },
              { label: "Everyone, a general launch", detail: "Broader reach, but a softer message. Good for the homepage." },
            ],
          })}`,
        ),
      ]),
    ],
    "r-picked": [
      user("rp-u", "Help me pick a tone for the November newsletter."),
      reply("rp-a", [text("rp-x", block("axe-choices", { question: "Which tone?", options: ["Warm and personal", "Short and practical", "Playful"] }))]),
      user("rp-u2", "Short and practical"),
      reply("rp-a2", [text("rp-x2", "Short and practical it is. Three sections, one line each, and a single link at the end.")]),
    ],
    "r-more": [
      user("rm-u", "Break Q3 down by region and by channel."),
      reply("rm-a", [
        text(
          "rm-x",
          `${block("axe-chart", {
            type: "bar",
            title: "Revenue by region",
            prefix: "$",
            labels: ["North", "South", "East", "West", "Online"],
            series: [
              { name: "Q2", values: [48000, 36000, 41000, 29000, 52000] },
              { name: "Q3", values: [55000, 34000, 47000, 33000, 68000] },
            ],
          })}\n\nOnline grew the most. South was the only region to slip.\n\n${block("axe-chart", {
            type: "donut",
            title: "Where Q3 sales came from",
            suffix: "%",
            data: [
              { label: "Search", value: 38 },
              { label: "Social", value: 27 },
              { label: "Email", value: 18 },
              { label: "Referrals", value: 11 },
              { label: "Other", value: 6 },
            ],
          })}\n\n${block("axe-chart", {
            type: "area",
            title: "Weekly sign-ups",
            labels: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12"],
            series: [{ name: "Sign-ups", values: [120, 135, 128, 160, 172, 168, 190, 214, 205, 230, 248, 262] }],
          })}\n\n${block("axe-table", {
            title: "Plans this quarter",
            columns: ["Plan", "Price", "Paying", "Growth"],
            rows: [
              ["Starter", "$8", 412, "12%"],
              ["Plus", "$20", 268, "21%"],
              ["Pro", "$60", 94, "34%"],
              ["Team", "$45", 51, "8%"],
            ],
          })}`,
        ),
      ]),
    ],
    "r-map": [
      user("rmap-u", "Three good food stops near tram 28 in Lisbon?"),
      reply("rmap-a", [
        { type: "tool", id: "rmap-t", title: "Showed a map", kind: "other", state: "done" },
        {
          type: "rich",
          id: "rich-rmap-t",
          block: {
            kind: "map",
            title: "Near tram 28",
            places: [
              { name: "Prado", note: "Seasonal Portuguese, book ahead", lat: 38.7095, lon: -9.1336 },
              { name: "Taberna da Rua das Flores", note: "Small plates, walk-ins", lat: 38.7097, lon: -9.1432 },
              { name: "Manteigaria", note: "Pastéis de nata, a quick stop", lat: 38.7106, lon: -9.1446 },
              { name: "Miradouro da Graça", note: "Sunset after dinner", lat: 38.7163, lon: -9.1313 },
            ],
          },
        },
        text("rmap-x", "All four are a short walk from a tram 28 stop. Book Prado for dinner; the others take walk-ins."),
      ]),
    ],
    "r-draft": [
      user("rd-u", "Email David and Jack that film mode ships Thursday, and write the X post."),
      reply("rd-a", [
        text(
          "rd-x",
          `${block("axe-draft", {
            kind: "email",
            to: "David, Jack",
            subject: "The Mac app ships Thursday",
            body: "Hi both,\n\nThe Mac app ships Thursday at 10:00. The landing page and three posts are ready for your review today. Could you check the pricing line by tomorrow noon?\n\nThanks,\nMia",
          })}\n\n${block("axe-draft", {
            kind: "post",
            channel: "X",
            body: "Axe AI for Mac is here. Every model in one chat, agents that work on your computer, boards that watch what matters. Out Thursday.",
          })}`,
        ),
      ]),
    ],
    "r-visual": [
      user("rv-u", "Show light splitting through a prism. Let me move the light."),
      reply("rv-a", [
        text("rv-x", `${block("axe-visual", { title: "Light through a prism", height: 310, html: VISUAL_HTML })}\n\nDrag the light. Steeper angles spread the colours wider, like real glass.`),
      ]),
    ],
    "r-broken": [
      user("rb-u", "Chart signups by week."),
      reply("rb-a", [text("rb-x", `This one came back broken, so it shows as code:\n\n${block("axe-chart", '{"type": "bar", "data": [{"label": "W1", "value": 12}, {"label": "W2", "value"')}\n\nAnd this reply stopped halfway through a card:\n\n\`\`\`axe-choices\n{"question": "Which week?", "options": ["W1",`)]),
    ],
    "r-empty": [
      user("re-u", "Show what you have."),
      reply("re-a", [
        text(
          "re-x",
          [
            block("axe-chart", { type: "bar", title: "Refunds this week", data: [] }),
            block("axe-choices", { question: "Pick one", options: [] }),
            block("axe-map", { title: "Places", places: [] }),
            block("axe-table", { title: "Open invoices", columns: ["Client", "Amount"], rows: [] }),
          ].join("\n\n"),
        ),
      ]),
    ],
    "r-live": [
      user("rl-u", "Chart revenue by month and ask me which month to dig into."),
      reply("rl-a", [
        { type: "reasoning", id: "rl-r", text: "", done: true, seconds: 1 },
        text("rl-x", `Here's the year so far:\n\n${block("axe-table", { columns: ["Month", "Revenue"], rows: [["Jan", "$40k"], ["Feb", "$44k"]] })}\n\nAnd the chart:\n\n\`\`\`axe-chart\n{"type": "bar", "title": "Revenue", "labels": ["Jan", "Feb", "Mar"`),
      ]),
    ],
    "r-live-visual": [
      user("rlv-u", "Draw the prism again."),
      reply("rlv-a", [text("rlv-x", `\`\`\`axe-visual\n${JSON.stringify({ title: "Light through a prism", height: 310, html: VISUAL_HTML }).slice(0, 760)}`)]),
    ],
  }

  const live = {
    "r-live": { message: messages["r-live"]![1]!, startedAt: now - 6_000 },
    "r-live-visual": { message: messages["r-live-visual"]![1]!, startedAt: now - 3_000 },
  }
  return { threads, messages, live }
}

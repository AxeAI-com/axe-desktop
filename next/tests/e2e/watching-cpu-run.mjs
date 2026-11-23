import { chromium } from "@playwright/test"
// CPU of the window's processes over 10 s on Watching with ?mock=watchdash (spec 0002, acceptance 7), in Chromium on
// the Mac's GPU through Metal. Needs the screenshot server: pnpm exec vite --config tests/e2e/vite.config.ts --port <port>
//   AXE_E2E_PORT=<port> node tests/e2e/watching-cpu-run.mjs [mock] [watching|new]
// CSS=<rules> adds a style sheet; STRIP=<selector> removes those elements' loops (to see what each costs).
const mock = process.argv[2] ?? "watchdash"
const view = process.argv[3] ?? "watching"
const b = await chromium.launch({ channel: "chromium", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto(`http://localhost:${process.env.AXE_E2E_PORT || 5199}/?theme=dark&mock=${mock}`)
if (view === "watching") {
  await p.getByRole("button", { name: /^Oversight/ }).first().click()
  await p.getByTestId("radar").waitFor()
}
if (process.env.CSS) await p.addStyleTag({ content: process.env.CSS })
if (process.env.STRIP) await p.evaluate((s) => { for (const e of document.querySelectorAll(s)) e.removeAttribute("data-loop") }, process.env.STRIP)
await p.waitForTimeout(3000)
const pc = await p.context().newCDPSession(p)
await pc.send("Performance.enable")
const cdp = await b.newBrowserCDPSession()
const metrics = async () => Object.fromEntries((await pc.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]))
const procs = async () => (await cdp.send("SystemInfo.getProcessInfo")).processInfo
const [m0, s0, t0] = [await metrics(), await procs(), Date.now()]
await p.waitForTimeout(10_000)
const [m1, s1] = [await metrics(), await procs()]
const secs = (Date.now() - t0) / 1000
const cpu = (type) => s1.filter((x) => x.type === type).reduce((n, x) => n + x.cpuTime - (s0.find((y) => y.id === x.id)?.cpuTime ?? 0), 0)
const pct = (v) => `${((v / secs) * 100).toFixed(1)}%`
const running = await p.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)
console.log(JSON.stringify({ view, mock, secs, renderer: pct(cpu("renderer")), gpu: pct(cpu("GPU")), browser: pct(cpu("browser")), mainThread: pct(m1.TaskDuration - m0.TaskDuration), runningAnimations: running }))
await b.close()

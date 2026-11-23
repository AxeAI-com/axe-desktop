// Times launch of a packaged (fused) Axe AI build without Playwright: spawn -> first paint -> composer on screen.
// node launch-time.mjs <path to Axe AI.app> <runs>
// Isolated: throwaway --user-data-dir and AXE_DATA_DIR, self-test mode (no single-instance lock, no keychain).
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const exe = join(process.argv[2], "Contents/MacOS/Axe AI")
const runs = Number(process.argv[3] || 7)
const PORT = 9339
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

async function page(deadline) {
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find((t) => t.type === "page" && t.url.startsWith("file:") && !t.url.endsWith("#quick"))
      if (p) return p
    } catch {}
    await wait(10)
  }
  throw new Error("main window never appeared")
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (pending.has(d.id)) (pending.get(d.id)(d.result), pending.delete(d.id))
  }
  const open = new Promise((r) => (ws.onopen = r))
  const evaluate = async (expression) => {
    await open
    const n = ++id
    ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, returnByValue: true } }))
    return new Promise((r) => pending.set(n, (res) => r(res?.result?.value)))
  }
  return { evaluate, close: () => ws.close() }
}

const rows = []
for (let i = 0; i < runs; i++) {
  const dir = mkdtempSync(join(tmpdir(), "axe-launch-"))
  const t0 = Date.now()
  const child = spawn(exe, [`--user-data-dir=${join(dir, "ud")}`, `--remote-debugging-port=${PORT}`], {
    env: { ...process.env, AXE_SELFTEST: "1", AXE_DATA_DIR: join(dir, "data") },
    stdio: "ignore",
  })
  try {
    const p = await page(t0 + 30_000)
    const tWindow = Date.now()
    const c = cdp(p.webSocketDebuggerUrl)
    let usable = 0
    while (!usable && Date.now() < t0 + 30_000) {
      usable = await c.evaluate(
        `(() => { const e = document.querySelector('textarea, [contenteditable=true]'); return e && e.offsetParent ? Date.now() : 0 })()`,
      )
      if (!usable) await wait(10)
    }
    const fcp = await c.evaluate(
      `(() => { const f = performance.getEntriesByName('first-contentful-paint')[0]; return f ? performance.timeOrigin + f.startTime : 0 })()`,
    )
    const row = { run: i + 1, window: tWindow - t0, fcp: fcp ? Math.round(fcp - t0) : NaN, usable: usable ? usable - t0 : NaN, url: p.url.split("/").pop() }
    rows.push(row)
    console.log(JSON.stringify(row))
    c.close()
  } finally {
    child.kill()
    await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)))
    await wait(500)
    rmSync(dir, { recursive: true, force: true })
  }
}
const warm = rows.slice(1)
console.log("first run (ms):", JSON.stringify({ fcp: rows[0].fcp, usable: rows[0].usable }))
console.log("median of warm runs (ms):", JSON.stringify({ window: med(warm.map((r) => r.window)), fcp: med(warm.map((r) => r.fcp)), usable: med(warm.map((r) => r.usable)) }))

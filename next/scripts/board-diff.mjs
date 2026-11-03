#!/usr/bin/env node
// Pixel-diff the real app (tests/e2e/board-shots.spec.ts) against the Raycast-style board PNGs.
//   node scripts/board-diff.mjs --design <dir of RC-*.png> --real <dir> --out <dir>
// The design PNGs are full frames on a wallpaper: each is cropped to the app window (x24, y24, inset 24 px on
// every side); the quick bar has no window and is cropped to the area around the bar. Writes <out>/<Name>-diff.png
// (mismatches in red over a dimmed real shot) and <out>/summary.json, and prints a table.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"

const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const [designDir, realDir, outDir] = ["design", "real", "out"].map(arg)
if (!designDir || !realDir || !outDir) {
  console.error("usage: board-diff.mjs --design <dir> --real <dir> --out <dir>")
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const WINDOW_INSET = 24
const QUICK_RECT = { x: 300, y: 60, w: 840, h: 340 }

const read = (f) => PNG.sync.read(readFileSync(f))
function crop(png, r) {
  const out = new PNG({ width: r.w, height: r.h })
  PNG.bitblt(png, out, r.x, r.y, r.w, r.h, 0, 0)
  return out
}
/** Pads to w x h with transparent pixels, which never match anything. */
function pad(png, w, h) {
  if (png.width === w && png.height === h) return png
  const out = new PNG({ width: w, height: h })
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0)
  return out
}

const names = readdirSync(designDir)
  .filter((f) => /^RC-.*\.png$/.test(f))
  .map((f) => f.slice(3, -4))
  .sort()
const rows = []
for (const name of names) {
  const realFile = join(realDir, `RC-${name}.png`)
  if (!existsSync(realFile)) {
    rows.push({ name, missing: true })
    continue
  }
  const d = read(join(designDir, `RC-${name}.png`))
  const rect =
    name === "QuickBar"
      ? QUICK_RECT
      : { x: WINDOW_INSET, y: WINDOW_INSET, w: d.width - 2 * WINDOW_INSET, h: d.height - 2 * WINDOW_INSET }
  const design = crop(d, rect)
  let real = read(realFile)
  // The quick bar's real shot is the whole stand-in desktop: crop the same area.
  if (name === "QuickBar" && real.width >= rect.x + rect.w && real.height >= rect.y + rect.h) real = crop(real, rect)
  const w = Math.max(design.width, real.width)
  const h = Math.max(design.height, real.height)
  const a = pad(design, w, h)
  const b = pad(real, w, h)
  const diff = new PNG({ width: w, height: h })
  const mismatched = pixelmatch(a.data, b.data, diff.data, w, h, {
    threshold: 0.1,
    includeAA: false,
    diffColor: [255, 0, 0],
    diffColorAlt: [255, 0, 0],
  })
  // pixelmatch paints unchanged pixels pale grey; show the real shot, dimmed, there instead.
  for (let i = 0; i < diff.data.length; i += 4) {
    if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) continue
    for (let c = 0; c < 3; c++) diff.data[i + c] = Math.round(b.data[i + c] * 0.45)
    diff.data[i + 3] = 255
  }
  writeFileSync(join(outDir, `${name}-diff.png`), PNG.sync.write(diff))
  rows.push({
    name,
    mismatchPct: Number(((mismatched / (w * h)) * 100).toFixed(2)),
    mismatchedPixels: mismatched,
    design: `${design.width}x${design.height}`,
    real: `${real.width}x${real.height}`,
    sizeMatch: design.width === real.width && design.height === real.height,
  })
}

writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(rows, null, 2)}\n`)
const line = (c) => c.map((s, i) => String(s).padEnd([20, 10, 12, 12, 6][i])).join("")
console.log(line(["Screen", "Mismatch", "Design", "Real", "Size"]))
for (const r of rows)
  console.log(r.missing ? line([r.name, "no real shot"]) : line([r.name, `${r.mismatchPct}%`, r.design, r.real, r.sizeMatch ? "ok" : "DIFF"]))
const done = rows.filter((r) => !r.missing)
if (done.length) console.log(`Mean ${(done.reduce((s, r) => s + r.mismatchPct, 0) / done.length).toFixed(2)}% over ${done.length} screens`)

import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

// Serves the window alone in a normal browser, with the mock engine (src/renderer/src/lib/mock-bridge.ts).
// pnpm exec vite --config tests/e2e/vite.config.ts
const root = resolve(import.meta.dirname, "../..")

// The page's CSP is for Electron; dev tooling here needs inline scripts.
const dropCsp: Plugin = {
  name: "drop-csp",
  transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ""),
}

export default defineConfig({
  root: resolve(root, "src/renderer"),
  resolve: { alias: { "@shared": resolve(root, "src/shared"), "@": resolve(root, "src/renderer/src") } },
  plugins: [react(), tailwindcss(), dropCsp],
  server: { port: Number(process.env.AXE_E2E_PORT || 5199), strictPort: true },
  logLevel: "warn",
})

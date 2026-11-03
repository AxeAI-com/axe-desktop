import { defineConfig } from "@playwright/test"

// AXE_E2E_PORT lets parallel worktrees run their own server without reusing each other's.
const port = Number(process.env.AXE_E2E_PORT || 5199)

// Screenshot tests of the window, served on its own with the mock engine.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  expect: { toHaveScreenshot: { maxDiffPixels: 150, animations: "disabled" } },
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    timezoneId: "UTC",
    locale: "en-US",
  },
  webServer: {
    command: `pnpm exec vite --config tests/e2e/vite.config.ts --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})

import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { alias: { "@shared": resolve(import.meta.dirname, "src/shared"), "@": resolve(import.meta.dirname, "src/renderer/src") } },
  // 20 s, above the 10 s waits in the updater and terminal tests: on a busy machine (e2e or a build running
  // alongside) the default 5 s cut those tests off before their own wait ran out.
  test: { include: ["tests/unit/**/*.test.ts", "src/shared/**/*.test.ts", "tests/unit/**/*.test.tsx"], testTimeout: 20_000 },
})

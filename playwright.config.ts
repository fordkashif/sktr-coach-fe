import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/supabase/**"],
  timeout: 30_000,
  // One retry on CI only: the shared runners are slower and a few timing heavy flows can trip once.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3007",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run start -- --host 127.0.0.1 --port 3007 --strictPort",
    env: {
      VITE_BACKEND_MODE: "mock",
    },
    port: 3007,
    reuseExistingServer: false,
    timeout: 300_000,
  },
})

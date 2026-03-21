import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3007",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run start -- --host 127.0.0.1 --port 3007",
    env: {
      VITE_BACKEND_MODE: "mock",
    },
    port: 3007,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})

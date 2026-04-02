import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/supabase/**"],
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3007",
    trace: "on-first-retry",
  },
})

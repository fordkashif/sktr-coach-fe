import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3008",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "supabase-setup",
      testMatch: /tests\/e2e\/setup\/supabase-auth\.setup\.ts/,
    },
    {
      name: "supabase",
      testMatch: /tests\/e2e\/supabase\/.*\.spec\.ts/,
      dependencies: ["supabase-setup"],
    },
  ],
  webServer: {
    command: "npm run build && npm run start -- --host 127.0.0.1 --port 3008",
    env: {
      VITE_BACKEND_MODE: "supabase",
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    },
    port: 3008,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

import { test } from "@playwright/test"
import {
  clearSupabaseStorageStates,
  getMissingSupabaseAuthEnvVars,
  hasRoleCredential,
  writeSupabaseStorageStateForRole,
} from "../helpers/supabase-auth"

test("generate Supabase storage states for e2e roles", async ({ browser, baseURL }) => {
  const missing = getMissingSupabaseAuthEnvVars()
  if (missing.length > 0) {
    await clearSupabaseStorageStates()
  }
  test.skip(
    missing.length > 0,
    `Missing Supabase e2e env vars: ${missing.join(", ")}. Set them before running playwright.supabase.config.ts.`,
  )

  const supabaseUrl = process.env.VITE_SUPABASE_URL as string
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY as string
  const appBaseUrl = baseURL ?? "http://127.0.0.1:3008"

  if (hasRoleCredential("platformAdmin")) {
    await writeSupabaseStorageStateForRole({
      browser,
      baseUrl: appBaseUrl,
      supabaseUrl,
      anonKey,
      role: "platformAdmin",
    })
  }

  await writeSupabaseStorageStateForRole({
    browser,
    baseUrl: appBaseUrl,
    supabaseUrl,
    anonKey,
    role: "clubAdmin",
  })

  await writeSupabaseStorageStateForRole({
    browser,
    baseUrl: appBaseUrl,
    supabaseUrl,
    anonKey,
    role: "coach",
  })

  await writeSupabaseStorageStateForRole({
    browser,
    baseUrl: appBaseUrl,
    supabaseUrl,
    anonKey,
    role: "athlete",
  })

  if (hasRoleCredential("clubAdminTenantB")) {
    await writeSupabaseStorageStateForRole({
      browser,
      baseUrl: appBaseUrl,
      supabaseUrl,
      anonKey,
      role: "clubAdminTenantB",
    })
  }

  if (hasRoleCredential("coachTenantB")) {
    await writeSupabaseStorageStateForRole({
      browser,
      baseUrl: appBaseUrl,
      supabaseUrl,
      anonKey,
      role: "coachTenantB",
    })
  }

  if (hasRoleCredential("athleteTenantB")) {
    await writeSupabaseStorageStateForRole({
      browser,
      baseUrl: appBaseUrl,
      supabaseUrl,
      anonKey,
      role: "athleteTenantB",
    })
  }
})

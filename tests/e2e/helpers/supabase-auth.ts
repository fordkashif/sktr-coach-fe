import type { Browser } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

export type SupabaseRoleKey =
  | "clubAdmin"
  | "coach"
  | "athlete"
  | "clubAdminTenantB"
  | "coachTenantB"
  | "athleteTenantB"

type SupabaseRoleCredential = {
  email: string
  password: string
  storageStatePath: string
}

type SupabaseTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  user: Record<string, unknown>
}

export type SupabaseAuthSession = {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  expires_at: number
  user: Record<string, unknown>
}

const roleEnvMap: Record<
  SupabaseRoleKey,
  { email: string; password: string; storageStatePath: string; requiredForBaseSetup: boolean }
> = {
  clubAdmin: {
    email: "PW_SUPABASE_CLUB_ADMIN_EMAIL",
    password: "PW_SUPABASE_CLUB_ADMIN_PASSWORD",
    storageStatePath: "playwright/.auth/club-admin.json",
    requiredForBaseSetup: true,
  },
  coach: {
    email: "PW_SUPABASE_COACH_EMAIL",
    password: "PW_SUPABASE_COACH_PASSWORD",
    storageStatePath: "playwright/.auth/coach.json",
    requiredForBaseSetup: true,
  },
  athlete: {
    email: "PW_SUPABASE_ATHLETE_EMAIL",
    password: "PW_SUPABASE_ATHLETE_PASSWORD",
    storageStatePath: "playwright/.auth/athlete.json",
    requiredForBaseSetup: true,
  },
  clubAdminTenantB: {
    email: "PW_SUPABASE_CLUB_ADMIN_TENANT_B_EMAIL",
    password: "PW_SUPABASE_CLUB_ADMIN_TENANT_B_PASSWORD",
    storageStatePath: "playwright/.auth/club-admin-tenant-b.json",
    requiredForBaseSetup: false,
  },
  coachTenantB: {
    email: "PW_SUPABASE_COACH_TENANT_B_EMAIL",
    password: "PW_SUPABASE_COACH_TENANT_B_PASSWORD",
    storageStatePath: "playwright/.auth/coach-tenant-b.json",
    requiredForBaseSetup: false,
  },
  athleteTenantB: {
    email: "PW_SUPABASE_ATHLETE_TENANT_B_EMAIL",
    password: "PW_SUPABASE_ATHLETE_TENANT_B_PASSWORD",
    storageStatePath: "playwright/.auth/athlete-tenant-b.json",
    requiredForBaseSetup: false,
  },
}

export function getMissingSupabaseAuthEnvVars() {
  const required = new Set([
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
  ])
  for (const entry of Object.values(roleEnvMap)) {
    if (!entry.requiredForBaseSetup) continue
    required.add(entry.email)
    required.add(entry.password)
  }
  return [...required].filter((name) => !process.env[name])
}

export function hasRoleCredential(role: SupabaseRoleKey) {
  const mapping = roleEnvMap[role]
  return Boolean(process.env[mapping.email] && process.env[mapping.password])
}

export function getRoleCredential(role: SupabaseRoleKey): SupabaseRoleCredential {
  const mapping = roleEnvMap[role]
  const email = process.env[mapping.email]
  const password = process.env[mapping.password]

  if (!email || !password) {
    throw new Error(`Missing credentials for role=${role}. Expected ${mapping.email} and ${mapping.password}.`)
  }

  return {
    email,
    password,
    storageStatePath: mapping.storageStatePath,
  }
}

function deriveSupabaseStorageKey(supabaseUrl: string) {
  const host = new URL(supabaseUrl).host
  const projectRef = host.split(".")[0]
  return `sb-${projectRef}-auth-token`
}

async function fetchPasswordSession(params: {
  supabaseUrl: string
  anonKey: string
  email: string
  password: string
}): Promise<SupabaseAuthSession> {
  const response = await fetch(`${params.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: params.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      password: params.password,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Supabase password grant failed (${response.status}) for ${params.email}. Response: ${body.slice(0, 240)}`,
    )
  }

  const token = (await response.json()) as SupabaseTokenResponse
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type,
    expires_in: token.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + token.expires_in,
    user: token.user,
  }
}

export async function getSupabaseSessionForRole(params: {
  supabaseUrl: string
  anonKey: string
  role: SupabaseRoleKey
}) {
  const roleCredential = getRoleCredential(params.role)
  return fetchPasswordSession({
    supabaseUrl: params.supabaseUrl,
    anonKey: params.anonKey,
    email: roleCredential.email,
    password: roleCredential.password,
  })
}

export async function writeSupabaseStorageStateForRole(params: {
  browser: Browser
  baseUrl: string
  supabaseUrl: string
  anonKey: string
  role: SupabaseRoleKey
}) {
  const roleCredential = getRoleCredential(params.role)
  const authToken = await getSupabaseSessionForRole({
    supabaseUrl: params.supabaseUrl,
    anonKey: params.anonKey,
    role: params.role,
  })

  const context = await params.browser.newContext()
  const page = await context.newPage()
  const storageKey = deriveSupabaseStorageKey(params.supabaseUrl)

  await page.goto(`${params.baseUrl}/login`)
  await page.evaluate(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value))
    },
    { key: storageKey, value: authToken },
  )

  await mkdir(dirname(roleCredential.storageStatePath), { recursive: true })
  await context.storageState({ path: roleCredential.storageStatePath })
  await context.close()
}

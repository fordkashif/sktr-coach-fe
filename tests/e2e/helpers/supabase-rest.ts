import { getSupabaseSessionForRole, type SupabaseRoleKey } from "./supabase-auth"

type SupabaseEnvConfig = {
  supabaseUrl: string
  anonKey: string
}

type TeamRow = {
  id: string
  name: string
}

type ProfileRow = {
  tenant_id: string
}

function requestHeaders(accessToken: string, anonKey: string) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  }
}

export function getSupabaseEnvConfig(): SupabaseEnvConfig {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.")
  }
  return { supabaseUrl, anonKey }
}

export async function getRoleAccessToken(role: SupabaseRoleKey) {
  const { supabaseUrl, anonKey } = getSupabaseEnvConfig()
  const session = await getSupabaseSessionForRole({ supabaseUrl, anonKey, role })
  return session.access_token
}

export async function getCurrentTenantIdForRole(role: SupabaseRoleKey) {
  const { supabaseUrl, anonKey } = getSupabaseEnvConfig()
  const session = await getSupabaseSessionForRole({ supabaseUrl, anonKey, role })
  const userId = session.user.id as string
  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=tenant_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    {
      headers: requestHeaders(session.access_token, anonKey),
    },
  )
  if (!response.ok) {
    throw new Error(`Failed to query profile for role ${role}: ${response.status} ${await response.text()}`)
  }
  const rows = (await response.json()) as ProfileRow[]
  if (!rows[0]?.tenant_id) {
    throw new Error(`No tenant_id found in profile for role ${role}.`)
  }
  return rows[0].tenant_id
}

export async function insertTeamForRole(params: { role: SupabaseRoleKey; name: string; eventGroup?: string }) {
  const { supabaseUrl, anonKey } = getSupabaseEnvConfig()
  const session = await getSupabaseSessionForRole({
    supabaseUrl,
    anonKey,
    role: params.role,
  })
  const tenantId = await getCurrentTenantIdForRole(params.role)

  const response = await fetch(`${supabaseUrl}/rest/v1/teams`, {
    method: "POST",
    headers: {
      ...requestHeaders(session.access_token, anonKey),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      name: params.name,
      event_group: params.eventGroup ?? "Sprint",
      is_archived: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to insert team for role ${params.role}: ${response.status} ${await response.text()}`)
  }

  const rows = (await response.json()) as TeamRow[]
  if (!rows[0]?.id) throw new Error("Insert team returned no id.")
  return rows[0]
}

export async function listTeamNamesForRole(role: SupabaseRoleKey) {
  const { supabaseUrl, anonKey } = getSupabaseEnvConfig()
  const session = await getSupabaseSessionForRole({ supabaseUrl, anonKey, role })
  const response = await fetch(`${supabaseUrl}/rest/v1/teams?select=name&is_archived=eq.false`, {
    headers: requestHeaders(session.access_token, anonKey),
  })
  if (!response.ok) {
    throw new Error(`Failed to list teams for role ${role}: ${response.status} ${await response.text()}`)
  }
  const rows = (await response.json()) as Array<{ name: string }>
  return rows.map((row) => row.name)
}

export async function deleteTeamForRole(params: { role: SupabaseRoleKey; teamId: string }) {
  const { supabaseUrl, anonKey } = getSupabaseEnvConfig()
  const session = await getSupabaseSessionForRole({ supabaseUrl, anonKey, role: params.role })
  const response = await fetch(`${supabaseUrl}/rest/v1/teams?id=eq.${encodeURIComponent(params.teamId)}`, {
    method: "DELETE",
    headers: requestHeaders(session.access_token, anonKey),
  })
  if (!response.ok) {
    throw new Error(`Failed to delete team ${params.teamId} for role ${params.role}: ${response.status} ${await response.text()}`)
  }
}

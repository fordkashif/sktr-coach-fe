// HTTP handler for purge-deleted-storage. Removes the files left behind by a deleted account or a
// deleted club (profile photos, club logos). The database cannot do this itself: Supabase refuses a
// direct delete on storage.objects, and deleting that row would leave the file in the bucket anyway.
// So the delete functions of migration 20261014120000 write the paths to
// public.storage_deletion_queue and this function removes them with the Storage API.
//
// Everything it touches from the outside world is passed in, so the flow can be exercised without a
// network. index.ts wires in the real things.

// The Supabase client is used structurally so tests can pass a small fake.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any

export type HandlerDeps = {
  getEnv: (name: string) => string | undefined
  /** Client that carries the caller's JWT: used only to ask the database whether they are a platform admin. */
  createUserClient: (supabaseUrl: string, anonKey: string, authorization: string) => LooseClient
  /** Service role client: reads the queue and removes the files. Never returned to the caller. */
  createServiceClient: (supabaseUrl: string, serviceRoleKey: string) => LooseClient
}

export const SCHEDULER_TOKEN_HEADER = "x-sktr-scheduler-token"

/** Only these buckets are ever touched, whatever the queue says. */
export const PURGEABLE_BUCKETS = ["avatars", "club-logos"]

export const BATCH_SIZE = 100
export const MAX_BATCHES = 10

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type QueueRow = { id: string; bucket_id: string; object_path: string }

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
}

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** A path inside a bucket: no empty parts, no "..", no leading slash. */
export function isSafeObjectPath(path: string) {
  if (!path || path.startsWith("/") || path.length > 1024) return false
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
}

export async function handlePurgeDeletedStorage(request: Request, deps: HandlerDeps): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return json(405, { ok: false, code: "method_not_allowed", error: "Method not allowed." })

  const supabaseUrl = deps.getEnv("SUPABASE_URL")
  const supabaseAnonKey = deps.getEnv("SUPABASE_ANON_KEY")
  const supabaseServiceRoleKey = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return json(500, { ok: false, code: "not_configured", error: "The function is missing its Supabase settings." })
  }
  const serviceClient = deps.createServiceClient(supabaseUrl, supabaseServiceRoleKey)

  // 1. Who is asking? The database scheduler (shared token), the deploy workflow (service role
  // key) or a signed-in platform admin. Nobody else: a club member has no business here.
  const schedulerToken = request.headers.get(SCHEDULER_TOKEN_HEADER)
  const authorization = request.headers.get("Authorization")
  const bearer = authorization?.replace(/^Bearer\s+/i, "").trim() ?? ""

  if (schedulerToken !== null) {
    const { data: tokenOk, error: tokenError } = await serviceClient.rpc("verify_notification_scheduler_token", { p_token: schedulerToken })
    if (tokenError || tokenOk !== true) return json(401, { ok: false, code: "bad_scheduler_token", error: "The scheduler token is not valid." })
  } else if (!authorization) {
    return json(401, { ok: false, code: "not_authenticated", error: "Sign in to do this." })
  } else if (!sameSecret(bearer, supabaseServiceRoleKey)) {
    const userClient = deps.createUserClient(supabaseUrl, supabaseAnonKey, authorization)
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData?.user) return json(401, { ok: false, code: "not_authenticated", error: "Sign in to do this." })
    const { data: isAdmin, error: adminError } = await userClient.rpc("is_platform_admin")
    if (adminError || isAdmin !== true) return json(403, { ok: false, code: "not_allowed", error: "Only platform admins can do this." })
  }

  // 2. Work through the queue. A file that is already gone counts as removed.
  let removed = 0
  let failed = 0
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const { data, error } = await serviceClient.rpc("claim_storage_deletions", { p_limit: BATCH_SIZE })
    if (error) return json(500, { ok: false, code: "queue_unavailable", error: "The storage queue could not be read.", removed, failed })
    const rows = ((data as QueueRow[] | null) ?? []).filter((row) => row && typeof row.id === "string")
    if (rows.length === 0) break

    const byBucket = new Map<string, QueueRow[]>()
    for (const row of rows) {
      if (!PURGEABLE_BUCKETS.includes(row.bucket_id) || !isSafeObjectPath(row.object_path)) {
        failed += 1
        await serviceClient.rpc("finish_storage_deletion", { p_id: row.id, p_error: "not a path this function may remove" })
        continue
      }
      byBucket.set(row.bucket_id, [...(byBucket.get(row.bucket_id) ?? []), row])
    }

    for (const [bucket, bucketRows] of byBucket) {
      const { error: removeError } = await serviceClient.storage.from(bucket).remove(bucketRows.map((row) => row.object_path))
      for (const row of bucketRows) {
        await serviceClient.rpc("finish_storage_deletion", { p_id: row.id, p_error: removeError ? String(removeError.message ?? "remove failed").slice(0, 300) : null })
      }
      if (removeError) failed += bucketRows.length
      else removed += bucketRows.length
    }
    if (rows.length < BATCH_SIZE) break
  }

  return json(200, { ok: true, removed, failed })
}

import type { SupabaseClient } from "@supabase/supabase-js"
import { getPackageById, type PackageDefinition, type PackageId } from "@/lib/billing/package-catalog"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"

export type TenantPackageUsage = {
  packageId: PackageId | null
  packageDefinition: PackageDefinition | null
  usage: {
    teams: number
    coaches: number
    athletes: number
  }
}

function toPackageId(value: unknown): PackageId | null {
  return value === "starter" || value === "pro" || value === "enterprise" ? value : null
}

/**
 * The plan the tenant is held to. Row level security only lets the original requestor read the
 * provisioning record, so every other admin and every coach goes through the
 * `get_current_tenant_package` database function (it always answers for the caller's own tenant).
 * Falls back to the direct read when that function is missing or errors.
 */
async function readTenantPlan(client: SupabaseClient, tenantId: string): Promise<Result<PackageId | null>> {
  try {
    const { data, error } = await client.rpc("get_current_tenant_package")
    if (!error) {
      const row = (Array.isArray(data) ? data[0] : data) as { requested_plan?: string | null } | null
      // No row means the tenant has no provisioning record, which the direct read cannot improve on.
      return ok(toPackageId(row?.requested_plan))
    }
  } catch {
    // Fall through to the direct read.
  }

  const { data, error } = await client
    .from("tenant_provision_requests")
    .select("requested_plan")
    .eq("provisioned_tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(toPackageId(data?.requested_plan))
}

export async function getTenantPackageUsage(
  client: SupabaseClient,
  tenantId: string,
): Promise<Result<TenantPackageUsage>> {
  const [packageResult, teamsResult, coachesResult, athletesResult] = await Promise.all([
    readTenantPlan(client, tenantId),
    client.from("teams").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).neq("status", "archived"),
    client
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("role", "coach")
      .eq("is_active", true),
    client.from("athletes").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ])

  if (!packageResult.ok) return packageResult
  if (teamsResult.error) return { ok: false, error: mapPostgrestError(teamsResult.error) }
  if (coachesResult.error) return { ok: false, error: mapPostgrestError(coachesResult.error) }
  if (athletesResult.error) return { ok: false, error: mapPostgrestError(athletesResult.error) }

  const packageId = packageResult.data
  return ok({
    packageId,
    packageDefinition: getPackageById(packageId),
    usage: {
      teams: teamsResult.count ?? 0,
      coaches: coachesResult.count ?? 0,
      athletes: athletesResult.count ?? 0,
    },
  })
}

export function buildPackageLimitError(params: {
  packageDefinition: PackageDefinition
  resourceLabel: "teams" | "coaches" | "athletes"
}) {
  const limit = params.packageDefinition.limits[params.resourceLabel]
  if (!Number.isFinite(limit)) {
    return err("UNKNOWN", "This package does not define a limit for the requested resource.")
  }

  const resourceName =
    params.resourceLabel === "teams" ? "team" : params.resourceLabel === "coaches" ? "coach" : "athlete"

  return err(
    "VALIDATION",
    `${params.packageDefinition.label} allows up to ${limit} ${resourceName}${limit === 1 ? "" : "s"}. Upgrade the package before adding more ${params.resourceLabel}.`,
  )
}

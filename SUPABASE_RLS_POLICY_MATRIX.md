# PaceLab Supabase RLS Policy Matrix (v1)

Last updated: March 20, 2026

## Purpose

Define row-level security behavior for Wave 1 through Wave 3 schema entities, aligned with app roles:
- `athlete`
- `coach`
- `club-admin`

This matrix is implemented by:
- `supabase/migrations/20260320113000_schema_v1_rls_policies.sql`

## Assumptions

- Authenticated users are in role `authenticated`.
- App role and tenant context are resolved from `public.profiles` using `auth.uid()`.
- Service-role operations are permitted for privileged backend flows (invites/bootstrap/admin jobs) and bypass RLS by design.

## Policy Helper Functions

Defined in SQL migration:
- `public.current_tenant_id() -> uuid`
- `public.current_app_role() -> text`
- `public.is_coach_or_admin() -> boolean`
- `public.is_club_admin() -> boolean`

These helpers are used across policies to avoid duplicated logic.

## Access Matrix (Table-by-Table)

Legend:
- `R` = select/read
- `C` = insert/create
- `U` = update
- `D` = delete

### `tenants`

- athlete: `R` own tenant only
- coach: `R` own tenant only
- club-admin: `R` own tenant only
- writes (`C/U/D`): service-role only

### `profiles`

- athlete: `R` own profile only
- coach: `R` own profile + tenant profiles
- club-admin: `R` own profile + tenant profiles
- writes (`C/U/D`): service-role only

### `teams`

- athlete: `R` tenant teams
- coach: `R/C/U/D` tenant teams
- club-admin: `R/C/U/D` tenant teams

### `athletes`

- athlete: `R` own athlete row only (`athletes.user_id = auth.uid()`)
- coach: `R/C/U/D` tenant athletes
- club-admin: `R/C/U/D` tenant athletes

### `sessions`

- athlete: `R` own sessions only (`sessions.athlete_id` belongs to auth user)
- coach: `R/C/U/D` tenant sessions
- club-admin: `R/C/U/D` tenant sessions

### `session_blocks`

- athlete: `R` blocks for own sessions only
- coach: `R/C/U/D` blocks for tenant sessions
- club-admin: `R/C/U/D` blocks for tenant sessions

### `session_block_rows`

- athlete: `R` rows for own sessions only
- coach: `R/C/U/D` rows for tenant sessions
- club-admin: `R/C/U/D` rows for tenant sessions

### `session_completions`

- athlete:
  - `R` own completion rows only
  - `C` only for own athlete-session in current tenant
  - `U/D` not allowed
- coach: `R/C/U/D` tenant completion rows
- club-admin: `R/C/U/D` tenant completion rows

### `test_weeks`

- athlete: `R` tenant test weeks
- coach: `R/C/U/D` tenant test weeks
- club-admin: `R/C/U/D` tenant test weeks

### `test_definitions`

- athlete: `R` definitions for tenant test weeks
- coach: `R/C/U/D` definitions for tenant test weeks
- club-admin: `R/C/U/D` definitions for tenant test weeks

### `test_results`

- athlete:
  - `R` own results only
  - `C/U` own results only, in current tenant
  - `D` not allowed
- coach: `R/C/U/D` tenant test results
- club-admin: `R/C/U/D` tenant test results

## Service-Role Only Operations (Documented)

These are intentionally not available to regular authenticated users:
- Tenant creation
- Profile bootstrap/role assignment
- Cross-tenant admin jobs
- Backfill/migration scripts

## Security Constraints Enforced by Matrix

- Tenant boundary is always checked on tenant-scoped tables.
- Athlete can never read or write other athletes' rows.
- Coaches and club-admins operate only within current tenant.
- Cross-tenant access is blocked even for coach/admin roles.

## Review Checklist

- [x] Each W1-W3 table mapped to role access rules
- [x] Tenant isolation strategy is explicit
- [x] Write restrictions are explicit
- [x] Service-role-only operations are identified


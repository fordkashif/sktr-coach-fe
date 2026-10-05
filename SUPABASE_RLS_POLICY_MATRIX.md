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

Since migration `20261005180000_tenant_lifecycle_enforcement.sql` all four helpers answer `null` / `false` when either of these is true, which closes every tenant-scoped policy at once:
- the caller's profile has `is_active = false` (a club admin turned their access off), or
- the latest `tenant_provision_requests` row of the caller's tenant (by `provisioned_tenant_id`, newest `created_at`) has `lifecycle_status` `suspended` or `cancelled`.

A tenant with no provisioning row (legacy tenants) and every other lifecycle status count as open. `is_coach_or_admin()` and `is_club_admin()` read `profiles` directly instead of calling `current_app_role()`, because the nested call was re-planned on every row.

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
- athlete self-service: no direct `U`. `update_current_athlete_profile(...)` (security definer, migration `20261005093000`) keeps `display_name` in sync with the athlete's own first and last name. No other profile column is touched.
- coach names for athletes: athletes cannot read other profiles. `get_current_athlete_team_context()` returns the display names of the coaches on the athlete's own team. Coach names are not exposed through invite links.
- club-admin member access: no direct `U`. `set_tenant_member_access(p_user_id, p_role, p_is_active)` (security definer, migration `20261005140000`) changes only `role` and `is_active`. See "Club admin member access, billing contact and package" below.

### `teams`

- athlete: `R` tenant teams
- coach: `R/C/U/D` tenant teams
- club-admin: `R/C/U/D` tenant teams

### `athletes`

- athlete: `R` own athlete row only (`athletes.user_id = auth.uid()`)
- athlete self-service `U`: no update policy. `update_current_athlete_profile(first_name, last_name, date_of_birth, event_group, primary_event)` (security definer, authenticated, athlete role only) updates exactly those five columns on the caller's own row in the caller's tenant. `team_id`, `tenant_id`, `user_id`, `readiness` and `is_active` cannot be changed by an athlete; team changes still go through `accept_athlete_invite`.
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

### `training_plans`

- athlete: `R` tenant plans whose status is not `draft` (drafts are never visible; migration `20261004120000_training_plan_drafts.sql`)
- coach: `R/C/U/D` tenant plans, including drafts
- club-admin: `R/C/U/D` tenant plans, including drafts

### `training_plan_weeks`, `training_plan_days`, `training_plan_blocks`

- athlete: `R` structure of tenant plans whose status is not `draft`
- coach: `R/C/U/D` structure of tenant plans
- club-admin: `R/C/U/D` structure of tenant plans

### `training_plan_assignments`

- athlete: `R` assignments addressed to own athlete row or own team
- coach: `R/C/U/D` tenant assignments
- club-admin: `R/C/U/D` tenant assignments
- Draft plans have no assignment rows. Inserting an assignment with `visibility_start = 'immediate'` queues the `training_plan_published` notification, so assignments are only written at publish time.

### Session logging (migration `20261005090000_session_logging.sql`)

`session_row_logs` (what the athlete did, one row per set):
- athlete: `R/C/U` own rows only, and only against a row of one of their own sessions in the current tenant. No delete (a set is unticked with `completed = false`).
- coach: `R` tenant rows (same scope as `sessions_select_tenant_staff`). No write.
- club-admin: `R` tenant rows. No write.

`session_completions` additions:
- athlete: `U` own completion (`session_completions_update_own`), so effort (`rpe`) and `athlete_comment` can be saved and changed.

`sessions`, `session_blocks`, `session_block_rows` additions:
- athlete: `C` only for their own athlete row, only with `status = 'scheduled'` and a plan slot (`plan_id`, `plan_week_number`, `plan_day_index`) pointing at a published plan in the tenant; blocks and rows only under such a session while it is still `scheduled`. This covers athletes who joined after the plan was published. Athletes still cannot update or delete sessions.
- `sessions.status` is moved by security definer triggers, not by the athlete: first logged set sets `in-progress`, a completion sets `completed`.
- coach / club-admin: unchanged (`R/C/U/D` tenant). Sessions are created for every assigned athlete when a plan is published.

### Club admin member access, billing contact and package (migration `20261005140000_club_admin_member_access_and_billing_contact.sql`)

All are security definer functions with `set search_path = public`, executable by `authenticated` only (revoked from `public` and `anon`). No table policy was widened.

`set_tenant_member_access(p_user_id uuid, p_role text, p_is_active boolean)` returns `(user_id, role, is_active)`:
- caller: active club-admin only (re-checked after row locks are taken).
- target: a profile in the caller's tenant. Other tenants and unknown users both raise `Member not found in this club`.
- roles: `athlete`, `coach`, `club-admin` only. `platform-admin` is never a profile role.
- caller cannot change their own role or deactivate themselves.
- the last active club-admin of a tenant cannot be demoted or deactivated.
- writes: `profiles.role`, `profiles.is_active` only. Changing someone to `athlete` deletes their `team_coaches` rows in the tenant (staff assignments must not outlive the staff role). Deactivating keeps `team_coaches` so reactivating restores the same teams. `athletes` rows and all training data are never touched.

`get_tenant_member_emails()` returns `(user_id, email)`:
- active club-admin: account emails from `auth.users` for profiles in their own tenant.
- coach, athlete, deactivated admin, no profile: zero rows.

`update_current_club_admin_billing_contact(p_billing_contact_name text, p_billing_contact_email text)` returns `void`:
- caller: active club-admin only.
- validates a non-empty name (120 characters max) and a plausible email.
- writes: `billing_contact_name`, `billing_contact_email` on the latest `tenant_provision_requests` row of the caller's tenant. Refused when that row's lifecycle status is `cancelled`. Lifecycle and billing status are not changed.

`get_current_tenant_package()` returns `(requested_plan, lifecycle_status)`:
- any member of the tenant (club-admin, coach, athlete): the plan key and lifecycle status from the latest `tenant_provision_requests` row of their own tenant. Nothing else from that row is exposed.
- zero rows when the caller has no profile or the tenant has no provisioning record.
- used by package limit enforcement, because the direct `R` on `tenant_provision_requests` is limited to the original requestor and platform admins.

`complete_current_club_admin_mock_billing_setup(...)`: unchanged except that it now accepts lifecycle status `billing_failed` as well as `approved_pending_billing`, so a club sent back to billing setup after a failed attempt can retry.

### Tenant lifecycle enforcement (migration `20261005180000_tenant_lifecycle_enforcement.sql`)

Who is blocked, and what they can still reach:

| Caller | Tenant-scoped tables (teams, athletes, sessions, plans, test weeks, wellness, club profile, invites, audit...) | Still allowed |
|---|---|---|
| member with `profiles.is_active = false` | no `R`, no `C/U/D` | `R` own `profiles` row, own notifications and notification preferences, `get_current_tenant_package()` |
| any member of a `suspended` or `cancelled` club | no `R`, no `C/U/D` | the same, plus `get_current_club_admin_activation_state()` for the club admin. `get_current_tenant_package()` returns the `suspended` / `cancelled` status, which the app uses to show its "access is paused" notice |
| member of a club with any other status, or with no provisioning row | unchanged | unchanged |

Not changed by this migration (they do not use the helpers): `profiles_select_own`, `profiles_insert_self_bootstrap`, the public invite previews, `accept_coach_invite`, `accept_athlete_invite` and the other `security definer` functions that look the caller up in `profiles` themselves. Those functions do not check suspension, and apart from the club admin functions of `20261005140000` they do not check `is_active` either. Accepting a new invite sets the profile active again, which is how a club admin lets a deactivated person back in.

`tenant_package_upgrade_requests`: the two club admin policies now also require the caller's profile to be active.

Platform admin functions:

- `get_platform_tenant_sizes()` returns `(tenant_id, team_count, coach_count, athlete_count)` for every tenant. Platform admins only (`is_platform_admin()`); anyone else gets zero rows, `anon` cannot execute it. Counts only: teams that are not archived, active coach profiles, all athletes rows.
- `set_tenant_request_lifecycle_state(...)`: the caller must pass `is_platform_admin()` (same rule as every other platform function). Only approved requests, and only these moves:

  | From | To |
  |---|---|
  | `approved_pending_billing` | `billing_failed`, `cancelled` |
  | `billing_failed` | `approved_pending_billing`, `cancelled` |
  | `active_onboarding` | `active`, `suspended`, `billing_failed`, `cancelled` |
  | `active` | `suspended`, `billing_failed`, `cancelled` |
  | `suspended` | `active`, `active_onboarding`, `cancelled`, or back to `previous_lifecycle_status` |
  | `cancelled` | `approved_pending_billing`, `active` |

  A move to the current status, and a move to `active_onboarding`, `active` or `suspended` for a request with no tenant, are refused. `pending_review` is left through `review_tenant_provision_request` only.
- `review_tenant_provision_request(...)` writes a `tenant_provision_request_reviewed` platform audit event again (target = club name; metadata `status`, `to_status`, `from_status`, `lifecycle_status`, `review_notes`, `requestor_email`, `tenant_provision_request_id`).
- `update_current_club_admin_onboarding_step('complete')` moves the tenant's latest provisioning row from `active_onboarding` to `active` and writes a `tenant_request_lifecycle_updated` audit event with actor role `club-admin`. Any other current status is left alone, so repeating the call changes nothing.
- `insert_platform_audit_event(...)`: `EXECUTE` revoked from `public`, `anon` and `authenticated`. It is reached only through other `security definer` functions (and `service_role`). `platform_audit_events` has no insert policy, so there is no direct way for an API user to write an audit row.

Still open: `tenant_provision_requests_platform_admin_update` lets a platform admin update provisioning rows directly through the API, which bypasses the allowed-moves table above. The app only uses it for invite tracking columns.

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


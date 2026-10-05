# PaceLab Supabase Schema v1 Contract

Last updated: March 20, 2026

## Purpose

Define Schema v1 for Wave 1 through Wave 3 backend integration:
- Wave 1: auth identity, tenant, role mapping
- Wave 2: athlete sessions and completion tracking
- Wave 3: test week definitions and athlete test results

Primary migration file:
- `supabase/migrations/20260320110000_schema_v1_foundation.sql`

## Naming Conventions

- Table names: `snake_case`, plural (`tenants`, `session_blocks`)
- Primary keys: `id uuid primary key default gen_random_uuid()`
- Foreign keys: `<referenced_table_singular>_id` (`tenant_id`, `session_id`)
- Timestamp columns:
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()` on mutable parent tables
- User references:
  - Auth user id always `uuid` referencing `auth.users(id)`
- Tenant scope:
  - Every business table includes `tenant_id` unless directly anchored to `auth.users`

## Soft Delete / Archive Strategy (v1)

- Use explicit archive flags for user-visible parent entities:
  - `teams.is_archived`, `teams.archived_at`
  - `test_weeks.is_archived`, `test_weeks.archived_at`
- Child rows are hard-deleted via `on delete cascade` where ownership is strict:
  - `session_blocks`, `session_block_rows`, `test_definitions`, `test_results`
- Sessions are status-driven (`scheduled`, `in-progress`, `completed`) and not archived in v1.

## Enum-Like Constraints (v1)

Implemented via `check` constraints:
- `profiles.role`: `athlete | coach | club-admin`
- `sessions.status`: `scheduled | in-progress | completed`
- `session_blocks.block_type`: `Strength | Run | Sprint | Jumps | Throws`
- `test_weeks.status`: `draft | published | closed`
- `test_definitions.unit`: `time | distance | weight | height | score`

## Tables (W1-W3 Scope)

1. `tenants`
- Club/organization boundary.
- Unique slug per tenant.

2. `profiles`
- One row per auth user.
- Contains role + tenant binding.
- Source of app-level role authorization.

3. `teams`
- Tenant-scoped team definitions.
- Supports archiving.

4. `athletes`
- Tenant-scoped athlete identity and metadata.
- Optional link to `auth.users` for athlete login account.
- Optional current team mapping.

5. `sessions`
- Athlete session header assigned/scheduled by coach/program.
- Completion timestamp and status state.

6. `session_blocks`
- Ordered blocks inside a session.

7. `session_block_rows`
- Ordered rows/targets per block.

8. `session_completions`
- Completion event per athlete-session pair.
- Source for home weekly completion checkmarks.

9. `test_weeks`
- Team-level test-week container with date range and lifecycle status.
- Supports archiving.

10. `test_definitions`
- Ordered definitions per test week.

11. `test_results`
- Athlete values per `(test_week, test_definition)`.
- Supports both text and numeric representations.

12. `training_plans` (Wave 4, drafts added October 2026)
- Multi-week plan header per tenant and team. `status` is `draft`, `published` or `archived`.
- `builder_state jsonb` (migration `20261004120000_training_plan_drafts.sql`) holds the coach builder model: `{ version, weekFocus, sessions[], assign }`. It is the only storage for a draft and is kept on publish so the plan can be reopened and edited.
- A draft has no rows in `training_plan_weeks`, `training_plan_days`, `training_plan_blocks` or `training_plan_assignments`. Those are written when the plan is published, and rewritten when a published plan is updated.
- Athletes cannot select draft plans or anything under them (see RLS matrix).

13. `training_plan_weeks`, `training_plan_days`, `training_plan_blocks`
- Published, athlete-facing structure: one row per week, per training day, and per block preview line.

14. `training_plan_assignments`
- Who a published plan is delivered to (`scope` of `team` or `athlete`) and when it becomes visible.
- An insert with immediate visibility queues athlete notifications.

## Keys and Relationships

- `profiles.user_id -> auth.users.id`
- `profiles.tenant_id -> tenants.id`
- `teams.tenant_id -> tenants.id`
- `athletes.tenant_id -> tenants.id`
- `athletes.user_id -> auth.users.id` (nullable)
- `athletes.team_id -> teams.id` (nullable)
- `sessions.tenant_id -> tenants.id`
- `sessions.athlete_id -> athletes.id`
- `sessions.created_by_user_id -> auth.users.id` (nullable)
- `session_blocks.session_id -> sessions.id`
- `session_block_rows.session_block_id -> session_blocks.id`
- `session_completions.tenant_id -> tenants.id`
- `session_completions.session_id -> sessions.id`
- `session_completions.athlete_id -> athletes.id`
- `session_completions.completed_by_user_id -> auth.users.id` (nullable)
- `test_weeks.tenant_id -> tenants.id`
- `test_weeks.team_id -> teams.id` (nullable)
- `test_weeks.created_by_user_id -> auth.users.id` (nullable)
- `test_definitions.test_week_id -> test_weeks.id`
- `test_results.tenant_id -> tenants.id`
- `test_results.test_week_id -> test_weeks.id`
- `test_results.test_definition_id -> test_definitions.id`
- `test_results.athlete_id -> athletes.id`
- `test_results.submitted_by_user_id -> auth.users.id` (nullable)

## Index Plan (v1)

Required indexes are included for expected query paths:
- Tenant scope filters:
  - `teams(tenant_id)`
  - `athletes(tenant_id)`
  - `sessions(tenant_id, athlete_id, scheduled_for desc)`
  - `session_completions(tenant_id, athlete_id, completion_date desc)`
  - `test_weeks(tenant_id, start_date desc)`
  - `test_results(tenant_id, athlete_id, submitted_at desc)`
- Parent-child ordering:
  - `session_blocks(session_id, sort_order)`
  - `session_block_rows(session_block_id, sort_order)`
  - `test_definitions(test_week_id, sort_order)`
- Uniqueness constraints:
  - `profiles(tenant_id, user_id)`
  - `teams(tenant_id, name)`
  - `athletes(tenant_id, user_id)` partial (`where user_id is not null`)
  - `session_completions(session_id, athlete_id)`
  - `test_definitions(test_week_id, name)`
  - `test_results(test_week_id, test_definition_id, athlete_id)`

## Session Logging (migration `20261005090000_session_logging.sql`)

Flow: coach publishes a plan, the client creates one `sessions` row (with `session_blocks` and `session_block_rows`) per assigned athlete per planned day from today on, the athlete logs sets into `session_row_logs` and finishes with a `session_completions` row.

- `sessions`: `plan_id -> training_plans.id` (nullable, `on delete set null`), `plan_week_number int`, `plan_day_index int`, `session_type text`, `location text`. The plan slot is used instead of a key to `training_plan_days` because day rows are re-created on every publish.
  - Unique: `sessions(athlete_id, plan_id, plan_week_number, plan_day_index)`. Sessions without a plan have null slot columns and never collide.
  - Re-publishing replaces only sessions that are still `scheduled`, have no completion and are not in the past. Started, finished and past sessions are never changed.
- `session_block_rows`: `log_kind text` (`strength | time | mark | check`, null means infer from `block_type`), `target_sets int`, `target_reps text`, `target_load text`.
- `session_row_logs` (new): `tenant_id`, `session_id` (cascade), `session_block_row_id` (cascade), `athlete_id`, `set_index` (1-based), `completed`, `reps`, `load_kg`, `time_seconds`, `distance_m`, `mark`, `rpe` (1 to 10), `note`, `logged_by_user_id`, timestamps.
  - Unique: `session_row_logs(session_block_row_id, athlete_id, set_index)`, so saving is an idempotent upsert.
- `session_completions`: `rpe smallint` (1 to 10), `athlete_comment text`, `updated_at`.
- Triggers: `mark_session_in_progress_on_log` (first log sets `sessions.status = 'in-progress'`), `mark_session_completed_on_completion` (sets `completed` and `completed_at`).

## Club Admin Functions (migration `20261005140000_club_admin_member_access_and_billing_contact.sql`)

Functions only. No tables, columns, constraints or data were changed.

- `set_tenant_member_access(p_user_id uuid, p_role text, p_is_active boolean)` returns `table (user_id uuid, role text, is_active boolean)`. Updates `profiles.role` and `profiles.is_active`. Removes the member's `team_coaches` rows when the new role is `athlete`.
- `get_tenant_member_emails()` returns `table (user_id uuid, email text)` (lower-cased `auth.users.email`).
- `update_current_club_admin_billing_contact(p_billing_contact_name text, p_billing_contact_email text)` returns `void`. Updates `tenant_provision_requests.billing_contact_name` and `billing_contact_email` on the tenant's latest row.
- `get_current_tenant_package()` returns `table (requested_plan text, lifecycle_status text)`. `requested_plan` is the plan in force: approving a package upgrade request rewrites it.
- `complete_current_club_admin_mock_billing_setup(text, text, text)`: lifecycle transition is now `approved_pending_billing | billing_failed -> active_onboarding`.

## Tenant Lifecycle Enforcement (migration `20261005180000_tenant_lifecycle_enforcement.sql`)

No table or column changes. One new index, one new function, redefined functions, two altered policies and one guarded data change.

- Index `tenant_provision_requests_tenant_created_idx` on `tenant_provision_requests (provisioned_tenant_id, created_at desc)`: "latest provisioning row of a tenant" is now read inside the RLS helpers.
- `current_tenant_id()`, `current_app_role()`, `is_coach_or_admin()`, `is_club_admin()`: return `null` / `false` for an inactive profile and for a tenant whose latest provisioning row is `suspended` or `cancelled`. Signatures unchanged.
- Lifecycle meaning from this migration on: `suspended` and `cancelled` block every member of the club in the database. `approved_pending_billing`, `billing_failed`, `active_onboarding` and `active` do not. A tenant without a provisioning row is treated as active.
- `active_onboarding -> active` happens when the club admin finishes setup (`update_current_club_admin_onboarding_step('complete')`). One-off data change in the migration: clubs with `club_profiles.onboarding_completed_at` set whose latest provisioning row was still `active_onboarding` were moved to `active`, each with a `tenant_request_lifecycle_updated` audit event (actor role `system`, metadata `source = migration_20261005180000`).
- `get_platform_tenant_sizes()` returns `table (tenant_id uuid, team_count bigint, coach_count bigint, athlete_count bigint)`, platform admins only.
- `set_tenant_request_lifecycle_state(uuid, text, text, text)`: admin check through `is_platform_admin()`, allowed moves listed in `SUPABASE_RLS_POLICY_MATRIX.md`. The audit metadata gains `previous_lifecycle_status`.
- `review_tenant_provision_request(uuid, text, text)`: writes platform audit event `tenant_provision_request_reviewed` again.
- `insert_platform_audit_event(...)`: internal. Not executable by `anon` or `authenticated`.

## Out of Scope for BEM-01

- RLS policies (tracked in `BEM-02`)
- Supabase environment/secret setup (tracked in `BEM-03`)
- Frontend integration changes (tracked in Waves 1+)

## Review Checklist

- [x] Tables/columns/PK-FK defined for W1-W3 entities
- [x] Naming conventions documented
- [x] Primary index plan documented
- [x] Soft-delete/archive approach documented
- [x] Initial SQL migration drafted


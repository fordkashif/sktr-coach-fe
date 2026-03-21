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


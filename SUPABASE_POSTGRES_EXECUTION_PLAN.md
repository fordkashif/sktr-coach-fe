# PaceLab Supabase + PostgreSQL Execution Plan

Last updated: March 20, 2026

## Purpose

Define the migration from mock/local state to a production-ready Supabase backend with PostgreSQL, in controlled waves, with clear scope, sequencing, and acceptance criteria.

Companion tracker:
- `SUPABASE_POSTGRES_STATUS_BOARD.md`

## Current Baseline

- Frontend app is React + Vite + TypeScript.
- Core product UX exists across athlete, coach, and club-admin routes.
- Data/auth are currently mock-backed (local state/localStorage + mock data).
- No persistent backend source of truth is currently active.

## Migration Principles

- Migrate by vertical slice, not by massive backend-first rewrite.
- Keep UI behavior stable while switching data sources under feature flags.
- Do not block product iteration; keep mock fallback until each slice is validated.
- Enforce security early (RLS, tenant scoping, role checks) before broad rollout.
- Every wave must have explicit exit criteria and rollback safety.

## Non-Negotiables

- Multi-tenant isolation enforced in database policies.
- Role-based access enforced server-side, not only in UI.
- Zero plaintext secrets in client code.
- Migrations are versioned, repeatable, and reviewable.
- Migrations must be executed automatically via Supabase CLI in CI/CD for shared environments.
- Manual SQL execution is break-glass only (incident recovery), with post-incident migration backfill required.
- No direct table access from UI without policy coverage.
- Every migrated slice passes lint, typecheck, and targeted tests.

## Migration Execution Model

- Source of truth:
  - `supabase/migrations/*.sql`
- Execution path:
  - Local/dev/prod shared environments are migrated via Supabase CLI commands in automation.
- Manual path:
  - SQL Editor/manual apply is allowed only for emergency recovery.
  - Any emergency SQL must be captured as a proper migration file immediately after.
- Operational runbook:
  - `SUPABASE_MIGRATION_RUNBOOK.md`

## Target Backend Architecture

- Supabase Auth:
  - user identity and sessions
  - JWT claims for app role + tenant binding
- PostgreSQL:
  - normalized domain tables
  - audit-friendly timestamps and ownership columns
- Supabase RLS:
  - tenant and role policy enforcement per table
- Supabase Storage (later wave):
  - files/media if needed (invite assets, report exports, attachments)
- Edge Functions (selective):
  - privileged workflows (invites, batch publish, derived metrics, exports)

## Initial Domain Model (Wave-Oriented)

Core entities to introduce first:
- `tenants`
- `profiles` (maps auth user -> app role -> tenant)
- `teams`
- `athletes`
- `training_plans`
- `training_plan_weeks`
- `training_plan_days`
- `training_plan_blocks`
- `sessions`
- `session_blocks`
- `session_completions`
- `test_weeks`
- `test_definitions`
- `test_results`

Support entities (later waves):
- `wellness_entries`
- `pr_records`
- `invites`
- `audit_events`
- reporting/materialized views

## Wave Plan

## Wave 0 - Foundation + Contracts

Goal:
- Freeze backend contract and migration approach before coding integration.

Scope:
- Define table schemas (v1), keys, indexes, and constraints.
- Define RLS strategy per role (`athlete`, `coach`, `club-admin`).
- Define environment strategy for local/dev/prod Supabase projects.
- Define API access pattern in frontend (`src/lib/data/*` abstraction).

Exit criteria:
- Schema spec reviewed.
- RLS policy matrix approved.
- Migration folder/process defined.
- Data-access conventions documented.

## Wave 1 - Auth + Tenant + Roles

Goal:
- Replace mock auth context with Supabase-backed auth and tenant-role identity.

Scope:
- Supabase client setup.
- Auth sign-in/out session handling.
- `profiles` table + role + tenant mapping.
- Route guards consuming backend identity.

Exit criteria:
- User logs in via Supabase.
- Role/tenant context comes from backend profile.
- Existing guarded routes work with real session.

## Wave 2 - Athlete Session Vertical Slice (First Real Feature)

Goal:
- Move athlete session completion + weekly checkmarks to backend.

Scope:
- `sessions`, `session_blocks`, `session_completions`.
- Athlete home + log pages read/write real data.
- Keep existing UI behavior (complete -> redirect home).

Exit criteria:
- Completing a session persists in Postgres.
- Home weekly checkmarks come from DB, not localStorage.
- RLS prevents cross-athlete data access.

## Wave 3 - Test Week + Derived Gym Input Logic

Goal:
- Move test week submission/results to backend and drive gym-input requirement from real results.

Scope:
- `test_weeks`, `test_definitions`, `test_results`.
- Athlete test-week form persists to DB.
- Athlete log conditional gym load input reads from backend test results.

Exit criteria:
- Test week data persisted and queryable by role.
- Gym input rule uses backend truth.
- Coach can review scoped athlete results from backend.

## Wave 4 - Training Plans + Assignments

Goal:
- Move training plan creation/assignment and athlete plan views to backend.

Scope:
- Training plan tables + assignment mapping.
- Coach create/edit/publish/assign flows.
- Athlete training plan view reads assigned plan from DB.

Exit criteria:
- Plan lifecycle persisted and role-scoped.
- Athlete sees team/individual assignments from DB.

## Wave 5 - Wellness + PRs + Trends

Goal:
- Move monitoring and progress surfaces to backend sources.

Scope:
- Wellness entries persistence.
- PR records and derived updates from test results.
- Trend query endpoints/views.

Exit criteria:
- Athlete/coach trends no longer use `mockTrendSeries`.
- PR and wellness views are DB-backed.

## Wave 6 - Club/Admin Ops + Hardening

Goal:
- Complete platform-level operations and production readiness.

Scope:
- Invites, roster management, audit log, reporting extracts.
- Data migration scripts from mock seed format.
- observability, backups, failure handling, incident runbooks.

Exit criteria:
- Core club-admin workflows DB-backed.
- Security and operational checklist complete.
- Mock dependencies removable for production mode.

## Cross-Wave Workstreams

- Testing:
  - unit tests for data-access layer
  - integration tests for RLS-sensitive queries
  - e2e for login + critical role flows
- Security:
  - policy review for each new table
  - least-privilege service-role usage only in controlled functions/scripts
- Performance:
  - index review with each new query path
  - avoid N+1 fetch patterns in page loaders/hooks
- DX:
  - typed query helpers and shared error handling
  - backend feature flags for staged rollout

## Risks and Mitigations

- Risk: RLS complexity slows development.
  - Mitigation: policy matrix first, table-by-table policy templates.
- Risk: mixed mock/backend state causes inconsistent UX.
  - Mitigation: per-feature source-of-truth switch and explicit fallback rules.
- Risk: accidental tenant leakage.
  - Mitigation: mandatory tenant filters + RLS tests in CI.
- Risk: migration sprawl.
  - Mitigation: wave gates; no new wave starts without prior exit criteria met.

## Definition of Done (Migration Program)

- All critical athlete/coach/admin flows read/write Supabase-backed data.
- Route access and data access are enforced by backend identity + RLS.
- Mock data is optional dev seed only, not runtime dependency.
- QA gates pass with backend enabled.
- Runbooks exist for schema change, rollback, and incident triage.

## Suggested First Implementation Order

1. Wave 0 artifacts (schema + RLS matrix + env/runbook docs)
2. Wave 1 auth/identity integration
3. Wave 2 athlete session vertical slice
4. Wave 3 test week and gym-input rule
5. Remaining waves in sequence

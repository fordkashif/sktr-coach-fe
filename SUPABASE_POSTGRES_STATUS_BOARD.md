# PaceLab Supabase + PostgreSQL Status Board

Last updated: March 21, 2026

## Purpose

Track the backend migration execution status wave-by-wave with concrete evidence and remaining gaps.

Companion plan:
- `SUPABASE_POSTGRES_EXECUTION_PLAN.md`
- `PLAYWRIGHT_FLOW_TENANCY_TEST_PLAN.md`
- `SUPABASE_RUNTIME_COVERAGE_AUDIT.md`

## Status Key

- `[ ] NOT STARTED`
- `[~] IN PROGRESS`
- `[x] DONE`
- `[!] BLOCKED`

## Current Snapshot

- Current wave: `Wave 6 - Club/Admin Ops + Hardening`
- Program status: `[x] COMPLETE`
- Backend runtime status: `[~] MIXED (supabase-mode active for selected athlete/coach flows; mock fallback remains)`

## Verification Snapshot

- `npm run lint`: PASS (March 20, 2026)
- `npm run typecheck`: PASS (March 21, 2026)
- `npx playwright test tests/e2e/role-journeys-and-tenancy.spec.ts`: PASS (3/3, March 20, 2026)
- `npm run test:e2e:supabase`: PASS WITH SKIPS (7 skipped, env-gated suites, March 20, 2026)
- CI workflow added: `.github/workflows/e2e.yml` (required mock lane + optional secret-gated Supabase lane)

## Global Gate - Migration Automation

### BEM-AUTO-01 - Supabase CLI Auto-Migrations (Required)
- Status: `[x] DONE`
- Priority: `P0`
- Blocking scope:
  - Blocks Wave 4+ implementation start.
- Requirement:
  - All non-local migrations must run automatically via Supabase CLI in CI/CD.
  - Manual SQL apply is break-glass only and must be followed by migration-file backfill.
- Checklist:
  - [x] Define canonical CLI migration commands for `dev` and `prod`
  - [x] Add CI workflow to apply pending migrations on deploy pipeline
  - [x] Wire CI secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`)
  - [x] Add failure gate so app deploy halts on migration failure
  - [x] Document emergency manual path + mandatory backfill policy
- Exit evidence:
  - `.github/workflows/supabase-migrations.yml`
  - `SUPABASE_MIGRATION_RUNBOOK.md`
  - First successful automated migration run (dev):
    - `https://github.com/fordkashif/sector-coach-fe/actions/runs/23349700859/job/67926016496`

---

## Wave Tracker

| Wave | Name | Status | Owner | Exit Gate |
|---|---|---|---|---|
| W0 | Foundation + Contracts | `[x]` | Core | Schema + RLS + env conventions approved |
| W1 | Auth + Tenant + Roles | `[x]` | Core | Backend identity powers route/data access |
| W2 | Athlete Session Vertical Slice | `[x]` | Core | Session completion + weekly checks persisted |
| W3 | Test Week + Gym Input Rule | `[x]` | Core | Test results persisted; gym rule DB-driven |
| W4 | Training Plans + Assignments | `[x]` | Core | Plan lifecycle persisted + assigned views |
| W5 | Wellness + PRs + Trends | `[x]` | Core | Monitoring/progress surfaces DB-backed |
| W6 | Club/Admin Ops + Hardening | `[x]` | Core | Ops flows + hardening completed |

---

## Wave 0 - Foundation + Contracts

### BEM-00 - Backend Program Bootstrap
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Create migration execution plan doc
  - [x] Create migration status board doc
  - [x] Define wave structure and gating model
- Evidence:
  - `SUPABASE_POSTGRES_EXECUTION_PLAN.md`
  - `SUPABASE_POSTGRES_STATUS_BOARD.md`

### BEM-01 - Schema v1 Contract
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Define tables/columns/PK-FK for W1-W3 entities
  - [x] Define naming conventions (ids, timestamps, tenant fields)
  - [x] Define indexes for primary query paths
  - [x] Define soft-delete/archive approach where needed
- Exit evidence:
  - `SUPABASE_SCHEMA_V1_CONTRACT.md`
  - `supabase/migrations/20260320110000_schema_v1_foundation.sql`

### BEM-02 - RLS Policy Matrix
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Map each table to access roles (`athlete`, `coach`, `club-admin`)
  - [x] Define tenant isolation policy pattern
  - [x] Define write constraints (self-only vs team-scoped vs admin)
  - [x] Document service-role only operations
- Exit evidence:
  - `SUPABASE_RLS_POLICY_MATRIX.md`
  - `supabase/migrations/20260320113000_schema_v1_rls_policies.sql`

### BEM-03 - Environment + Secrets Setup
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Define local/dev/prod Supabase projects
  - [x] Define env vars for frontend and scripts
  - [x] Define secret management rules
  - [x] Add setup steps to developer docs
- Exit evidence:
  - `SUPABASE_ENV_AND_SECRETS_SETUP.md`
  - `.env.supabase.example`
  - `README.md` (Supabase Migration Docs section)

### BEM-04 - Data Access Conventions
- Status: `[x] DONE`
- Priority: `P1`
- Checklist:
  - [x] Define `src/lib/data/*` access layer pattern
  - [x] Define error/result pattern for server/client fetches
  - [x] Define typed models (generated/manual strategy)
  - [x] Define feature-flag/fallback pattern during migration
- Exit evidence:
  - `SUPABASE_DATA_ACCESS_CONVENTIONS.md`

### Wave 0 Exit Criteria
- [x] Schema v1 contract is complete and approved
- [x] RLS policy matrix is complete and approved
- [x] Env/secrets setup is documented and reproducible
- [x] Data-access conventions are documented and accepted

---

## Wave 1 - Auth + Tenant + Roles

### BEM-10 - Supabase Client Integration
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Add Supabase JS client
  - [x] Add env wiring in app bootstrap
  - [x] Add auth session listener + teardown
- Exit evidence:
  - `package.json` (`@supabase/supabase-js`)
  - `src/lib/supabase/config.ts`
  - `src/lib/supabase/client.ts`
  - `src/lib/supabase/bootstrap.ts`
  - `src/lib/supabase/auth-sync.tsx`
  - `src/main.tsx`
  - `src/layouts/root-layout.tsx`

### BEM-11 - Profile + Role Mapping
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Create `profiles` table schema and policies
  - [x] Ensure every auth user maps to role + tenant
  - [x] Add bootstrap flow for missing profiles
- Exit evidence:
  - `supabase/migrations/20260320110000_schema_v1_foundation.sql` (`profiles` table)
  - `supabase/migrations/20260320113000_schema_v1_rls_policies.sql` (`profiles` read policies)
  - `supabase/migrations/20260320115500_profiles_bootstrap_policy.sql` (self-bootstrap insert policy)
  - `src/lib/supabase/profile-bootstrap.ts`
  - `src/lib/supabase/auth-sync.tsx`

### BEM-12 - Route Guard Migration
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Replace mock role source in guards
  - [x] Use backend session/profile as authority
  - [x] Validate athlete/coach/admin route behavior
- Exit evidence:
  - `src/router/guards.tsx` (Supabase-backed guard resolution in `supabase` mode)
  - `src/lib/supabase/profile-bootstrap.ts` (profile identity resolution fallback)
  - `src/lib/access-control.ts` (role path enforcement unchanged, now fed by backend identity)
  - `npm run -s lint`
  - `npm run -s typecheck`

### Wave 1 Exit Criteria
- [x] Login/logout works with Supabase session
- [x] Role and tenant context are backend-driven
- [x] Route guards pass parity tests

---

## Wave 2 - Athlete Session Vertical Slice

### BEM-20 - Session Schema + Queries
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Create `sessions` and `session_blocks` schema
  - [x] Create `session_completions` schema
  - [x] Add core read/write query helpers
- Exit evidence:
  - `supabase/migrations/20260320110000_schema_v1_foundation.sql`
  - `src/lib/data/result.ts`
  - `src/lib/data/session/types.ts`
  - `src/lib/data/session/session-data.ts`

### BEM-21 - Athlete Log Persistence
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Persist completion when session ends
  - [x] Replace localStorage completion source
  - [x] Preserve existing redirect behavior to home
- Exit evidence:
  - `src/lib/data/session/session-data.ts` (`completeLatestSessionForCurrentAthlete`)
  - `src/app/(authenticated)/athlete/log/page.tsx` (supabase-mode completion persistence + redirect)

### BEM-22 - Weekly Checkmark Backend Source
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Load weekly completion from DB
  - [x] Render Mon-Fri check states from DB data
  - [x] Remove local-only assumptions for checked days
- Exit evidence:
  - `src/lib/data/session/session-data.ts` (`getCurrentAthleteWeeklySessionCompletions`)
  - `src/app/(authenticated)/athlete/home/page.tsx` (supabase-mode weekly completion fetch + DB-backed check states)

### Wave 2 Exit Criteria
- [x] Session completion persisted in DB
- [x] Home weekly checkmarks DB-backed
- [x] Athlete cannot access other athletes' completions

---

## Wave 3 - Test Week + Gym Input Rule

### BEM-30 - Test Week Data Model
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Create `test_weeks`, `test_definitions`, `test_results`
  - [x] Add coach-scoped and athlete-scoped access policies
  - [x] Add query helpers for latest benchmarks
- Exit evidence:
  - `supabase/migrations/20260320110000_schema_v1_foundation.sql`
  - `supabase/migrations/20260320113000_schema_v1_rls_policies.sql`
  - `src/lib/data/test-week/types.ts`
  - `src/lib/data/test-week/test-week-data.ts`

### BEM-31 - Athlete Test Week Submission
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Persist athlete submissions
  - [x] Validate input and required fields
  - [x] Show backend-confirmed submit state
- Exit evidence:
  - `src/lib/data/test-week/test-week-data.ts` (`submitCurrentAthleteTestWeekResults`, `getCurrentAthleteActiveTestWeekContext`)
  - `src/lib/data/test-week/types.ts`
  - `src/app/(authenticated)/athlete/test-week/page.tsx` (supabase-mode submit + backend submission stamp + validation errors)

### BEM-32 - Gym Input Rule from Backend
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Determine baseline existence from latest test result in DB
  - [x] Enforce no-input default except conditional gym load
  - [x] Validate UI parity with current athlete log behavior
- Exit evidence:
  - `src/lib/data/test-week/test-week-data.ts` (`getLatestBenchmarkSnapshotForCurrentAthlete`)
  - `src/app/(authenticated)/athlete/log/page.tsx` (supabase-mode baseline check for gym-input rule)

### Wave 3 Exit Criteria
- [x] Test week flow is DB-backed
- [x] Gym-input conditional logic is DB-backed
- [x] Coach test-week review reads real data

---

## Wave 4 - Training Plans + Assignments

### BEM-40 - Training Plan Schema + Read Queries
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Create training plan schema tables (`training_plans`, `training_plan_assignments`, `training_plan_weeks`, `training_plan_days`, `training_plan_blocks`)
  - [x] Add coach/admin write and athlete/team-scoped read policies
  - [x] Add initial assigned-plan + plan-detail read query helpers
- Exit evidence:
  - `supabase/migrations/20260320123500_training_plans_foundation.sql`
  - `supabase/migrations/20260320124500_training_plans_rls.sql`
  - `src/lib/data/training-plan/types.ts`
  - `src/lib/data/training-plan/training-plan-data.ts`

### BEM-41 - Coach Plan Publish + Assignment Persistence
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Persist coach-created plans into `training_plans`
  - [x] Persist week/day/block structures into related tables
  - [x] Persist publish assignment targets into `training_plan_assignments`
  - [x] Replace localStorage assignment history in `supabase` mode
- Exit evidence:
  - `src/lib/data/training-plan/training-plan-data.ts` (`publishTrainingPlanForCurrentCoach`)
  - `src/components/coach/training-plan-page-client.tsx` (publish flow uses DB command in `supabase` mode, mock localStorage retained only in `mock` mode)

### BEM-42 - Athlete Training Plan DB Read Path
- Status: `[x] DONE`
- Priority: `P0`
- Checklist:
  - [x] Replace athlete training-plan list source with assigned-plan DB query
  - [x] Replace athlete plan detail source with DB weeks/days/blocks
  - [x] Preserve current UI structure and behavior in `supabase` mode
- Exit evidence:
  - `src/app/(authenticated)/athlete/training-plan/page.tsx` (`supabase` mode now reads `getAssignedTrainingPlansForCurrentAthlete` and `getTrainingPlanDetail`)
  - `src/lib/data/training-plan/training-plan-data.ts`

### Wave 4 Exit Criteria
- [x] Coach plan builder persists plans/blocks
- [x] Assignments persist to athlete/team targets
- [x] Athlete training plan view reads DB assignments

## Wave 5 - Wellness + PRs + Trends

- Status: `[x] DONE`
- Priority: `P1`

### BEM-50 - Wellness Persistence + Trend Source
- Status: `[x] DONE`
- Priority: `P1`
- Checklist:
  - [x] Add wellness schema + RLS (`wellness_entries`)
  - [x] Add athlete wellness submit/read data helpers
  - [x] Wire athlete wellness page submit flow in `supabase` mode
  - [x] Expose trend-series helper from wellness entries
- Exit evidence:
  - `supabase/migrations/20260320134000_wellness_pr_trends.sql`
  - `src/lib/data/wellness/types.ts`
  - `src/lib/data/wellness/wellness-data.ts`
  - `src/app/(authenticated)/athlete/wellness/page.tsx`

### BEM-51 - PR Persistence + Provenance
- Status: `[x] DONE`
- Priority: `P1`
- Checklist:
  - [x] Add PR schema + RLS (`pr_records`)
  - [x] Add athlete PR read helper
  - [x] Wire athlete PR page to DB in `supabase` mode
  - [x] Add test-week -> PR derivation/update command path
- Exit evidence:
  - `supabase/migrations/20260320134000_wellness_pr_trends.sql`
  - `src/lib/data/pr/types.ts`
  - `src/lib/data/pr/pr-data.ts`
  - `src/app/(authenticated)/athlete/prs/page.tsx`
  - `src/lib/data/test-week/test-week-data.ts` (test-week submit now upserts improved PR rows with `source_type='test-week'` and `source_ref`)

### BEM-52 - Trends DB Read Path
- Status: `[x] DONE`
- Priority: `P1`
- Checklist:
  - [x] Replace `mockTrendSeries` usage on athlete trends page in `supabase` mode
  - [x] Source PR cards from DB PR records in `supabase` mode
  - [x] Source benchmark cards from DB test results snapshot in `supabase` mode
- Exit evidence:
  - `src/app/(authenticated)/athlete/trends/page.tsx`
  - `src/lib/data/wellness/wellness-data.ts`
  - `src/lib/data/pr/pr-data.ts`
  - `src/lib/data/test-week/test-week-data.ts`

### Wave 5 Exit Criteria
- [x] Wellness entries persisted and scoped
- [x] PR updates persist with provenance
- [x] Trends sourced from DB queries/views

## Wave 6 - Club/Admin Ops + Hardening

- Status: `[x] DONE`
- Priority: `P1`

### BEM-60 - Club/Admin Ops Schema + RLS
- Status: `[x] DONE`
- Priority: `P1`
- Checklist:
  - [x] Add `coach_invites` schema + RLS
  - [x] Add `account_requests` schema + RLS
  - [x] Add `audit_events` schema + RLS
- Exit evidence:
  - `supabase/migrations/20260320143000_club_admin_ops.sql`

### BEM-61 - Club Admin Users/Invites DB Path
- Status: `[x] DONE`
- Priority: `P1`
- Checklist:
  - [x] Add club-admin ops data module
  - [x] Wire users/invites/account-requests reads in `supabase` mode
  - [x] Wire coach invite send in `supabase` mode
  - [x] Wire account request approve/decline in `supabase` mode
  - [x] Wire role/status updates in `supabase` mode
  - [x] Replace manual "create user" path with backend-auth provisioning flow
- Exit evidence:
  - `src/lib/data/club-admin/ops-data.ts`
  - `src/app/(authenticated)/club-admin/users/page.tsx`
  - `src/lib/data/coach/teams-data.ts`
  - `src/app/(authenticated)/coach/teams/page.tsx`
  - `src/lib/supabase/profile-bootstrap.ts` (athlete bootstrap on first login from invite metadata)
  - `supabase/migrations/20260320150000_invite_provisioning_and_athlete_bootstrap.sql`

### BEM-62 - Reporting + Audit Pipeline
- Status: `[x] DONE`
- Priority: `P1`
- Checklist:
  - [x] Move club-admin reports page from mock sources to DB queries
  - [x] Move export payload generation to DB-backed datasets
  - [x] Add audit trail coverage for report/export actions in DB
- Exit evidence:
  - `src/lib/data/club-admin/ops-data.ts` (`getClubAdminReportSnapshot`, `insertAuditEvent`)
  - `src/app/(authenticated)/club-admin/reports/page.tsx` (supabase-mode dataset + DB audit writes for CSV/PDF export actions)

### BEM-63 - Backup/Recovery Runbook
- Status: `[x] DONE`
- Priority: `P1`
- Checklist:
  - [x] Define backup verification cadence
  - [x] Define restore and PITR response steps
  - [x] Define post-restore validation and incident communication checks
- Exit evidence:
  - `SUPABASE_BACKUP_RECOVERY_RUNBOOK.md`

### Wave 6 Exit Criteria
- [x] Invite and roster workflows DB-backed
- [x] Audit logs and reporting pipelines active
- [x] Backup/recovery and ops runbooks complete

---

## Open Risks

- `[ ]` RLS misconfiguration risk
- `[ ]` Tenant leakage risk
- `[ ]` Mixed-source UX drift during staged migration
- `[ ]` Query performance regressions under real volume

## Decisions Log

- March 20, 2026:
  - Start with documentation and wave planning before integration work.
  - First implementation target after planning: athlete session vertical slice.
  - Wave 0 completed (BEM-00 through BEM-04); moved active execution to Wave 1.
  - Migration execution policy updated: automatic Supabase CLI migrations are mandatory; manual SQL is break-glass only.
  - Playwright Supabase TW2/TW3 scaffolding added (role auth-state generation + admin/coach/athlete tenant isolation specs with tenant-B env gating).
- March 21, 2026:
  - Athlete home/log in `supabase` mode now load latest session detail from DB-backed session helpers instead of mock session structures.
  - Athlete log progress state now keys against real session id/block count for safer session-to-session rollover behavior.
  - Coach dashboard and coach reports now use Supabase runtime snapshots (`src/lib/data/coach/dashboard-data.ts`) with no mock fallback in `supabase` mode.
  - Coach team/athlete detail routes now resolve entity scope from Supabase snapshot data in `supabase` mode and no longer use mock entity lookup as runtime source-of-truth.
  - Athlete training-plan/test-week runtime paths now use Supabase-mode identity and benchmark/PR data sources instead of mock identity/benchmark dependencies.
  - Athlete profile in `supabase` mode now resolves age, adherence, and last wellness date from DB-backed sources via `src/lib/data/athlete/profile-data.ts`.
  - Coach training-plan and coach test-week routes now switch to Supabase-mode runtime clients (`training-plan-page-supabase-client.tsx`, `test-week-page-supabase-client.tsx`) so `supabase` mode no longer uses mock-seeded coach builders.
  - Supabase Playwright coverage added for coach builder route smoke (`tests/e2e/supabase/coach-builder.spec.ts`), with env/auth-state gated execution behavior validated.
  - Coach teams route in `supabase` mode now removes mock default/switcher behavior and relies on Supabase snapshot + cookie scope only.
  - Club-admin users and reports routes now initialize from Supabase snapshot state in `supabase` mode (no mock-seeded startup state), with export/user ops actions staying on Supabase handlers.
  - Club-admin dashboard route now initializes from Supabase ops/report snapshots in `supabase` mode (users/teams/invites/requests/readiness), removing `mockAthletes` as runtime source-of-truth for that route.
  - Club-admin audit route now reads tenant-scoped events from Supabase (`getClubAdminAuditEvents`) in `supabase` mode, replacing mock audit logs for runtime reads.
  - Club-admin teams route now reads/writes `teams` via Supabase in `supabase` mode (`getClubAdminTeamsSnapshot`, `createClubAdminTeam`, `updateClubAdminTeam`, `setClubAdminTeamArchived`), replacing local mock persistence for team lifecycle actions.
  - Club-admin profile route now persists tenant profile settings to Supabase (`club_profiles`) and emits DB audit events in `supabase` mode.
  - Club-admin billing route now persists subscription settings to Supabase (`billing_profiles`) and emits DB audit events in `supabase` mode.
  - Added self-serve club admin signup (`/create-club-account`) backed by `provision_club_admin_tenant`, and coach invite acceptance (`/invite/coach/:inviteId`) backed by `accept_coach_invite`.
  - Added DB-backed athlete invite lifecycle (`athlete_invites`, `accept_athlete_invite`) and migrated athlete join flow to Supabase invite lookup/claim in `supabase` mode.

## Quick Start Prompt

```text
Use SUPABASE_POSTGRES_STATUS_BOARD.md as the single source of truth. Pick the highest-priority NOT STARTED item in the current wave, implement it end-to-end, run checks, and update this board with evidence.
```

# Playwright Flow + Multi-Tenant Status Board

Last updated: March 21, 2026

## Purpose

Single tracking board for end-to-end flow confidence:
- Club Admin -> Coach -> Athlete journeys.
- Multi-tenant isolation behavior.
- Mock-mode parity and Supabase-mode rollout.

Companion runbook:
- `CI_SETUP_E2E.md`

## Status Key

- `[ ] NOT STARTED`
- `[~] IN PROGRESS`
- `[x] DONE`
- `[!] BLOCKED`

## Current Snapshot

- Current wave: `TW2 - Supabase Auth Fixture Foundation`
- Program status: `[~] IN PROGRESS`
- Latest targeted run:
  - Command: `npx playwright test tests/e2e/role-journeys-and-tenancy.spec.ts`
  - Result: `3 passed` (March 20, 2026)
  - Command: `npx playwright test -c playwright.supabase.config.ts tests/e2e/supabase/coach-builder.spec.ts`
  - Result: `3 skipped` (env/auth-state gated, March 21, 2026)

## Commands

```bash
# full e2e suite
npm run test:e2e

# focused cross-role + tenant spec
npx playwright test tests/e2e/role-journeys-and-tenancy.spec.ts

# generate only Supabase auth states
npm run test:e2e:supabase:setup

# run Supabase setup + Supabase spec project
npm run test:e2e:supabase

# open html report
npx playwright show-report
```

## Environment Contract

- Playwright app server must boot on `127.0.0.1:3007`.
- Mock suite uses `playwright.config.ts` and forces `VITE_BACKEND_MODE=mock`.
- Supabase suite uses `playwright.supabase.config.ts` and forces `VITE_BACKEND_MODE=supabase`.
- Supabase suite requires:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `PW_SUPABASE_CLUB_ADMIN_EMAIL` / `PW_SUPABASE_CLUB_ADMIN_PASSWORD`
  - `PW_SUPABASE_COACH_EMAIL` / `PW_SUPABASE_COACH_PASSWORD`
  - `PW_SUPABASE_ATHLETE_EMAIL` / `PW_SUPABASE_ATHLETE_PASSWORD`

## CI Contract

- Workflow: `.github/workflows/e2e.yml`
- `mock-e2e`:
  - Required lane.
  - Runs on PR + main pushes.
  - Executes `npm run test:e2e`.
  - Uploads Playwright artifacts (`playwright-report`, `test-results`).
- `supabase-e2e`:
  - Optional lane, runs only when all Supabase secrets are present.
  - Executes `npm run test:e2e:supabase:setup` then `npm run test:e2e:supabase`.
  - Uploads Playwright artifacts.

## Wave Tracker

| Wave | Name | Status | Exit Criteria |
|---|---|---|---|
| TW1 | Mock Baseline Stabilization | `[x]` | Cross-role + tenant smoke tests deterministic and passing |
| TW2 | Supabase Auth Fixture Foundation | `[~]` | Storage states for role+tenant accounts generated and reusable |
| TW3 | Supabase Tenant Isolation Assertions | `[~]` | Negative visibility tests pass on real DB/RLS |
| TW4 | Critical Journey Regression Pack | `[~]` | Admin->Coach->Athlete publish/log/review flows covered in CI |
| TW5 | Reporting + Audit E2E | `[ ]` | Export actions + audit row assertions active |

## Detailed Backlog

### TW4 - Critical Journey Regression Pack

#### TST-401 - Coach builder Supabase-mode route smoke
- Status: `[x] DONE`
- Notes:
  - Added Supabase-mode route smoke tests for `/coach/training-plan` and `/coach/test-week`.
  - Uses coach storage-state auth and skips cleanly when setup/env is unavailable.
  - Evidence:
    - `tests/e2e/supabase/coach-builder.spec.ts`

### TW1 - Mock Baseline Stabilization

#### TST-101 - Shared role seeding helper
- Status: `[x] DONE`
- Evidence:
  - `tests/e2e/helpers/session.ts`

#### TST-102 - Cross-role route smoke
- Status: `[x] DONE`
- Evidence:
  - `tests/e2e/role-journeys-and-tenancy.spec.ts`

#### TST-103 - Tenant split smoke (mock storage isolation)
- Status: `[x] DONE`
- Evidence:
  - `tests/e2e/role-journeys-and-tenancy.spec.ts`

#### TST-104 - Playwright mock-mode determinism
- Status: `[x] DONE`
- Evidence:
  - `playwright.config.ts` (`webServer.env.VITE_BACKEND_MODE=mock`)

### TW2 - Supabase Auth Fixture Foundation

#### TST-201 - Seed fixture accounts
- Status: `[~] IN PROGRESS`
- Notes:
  - Create dedicated users for `club-admin`, `coach`, `athlete` in tenant A and B.

#### TST-202 - Persist storageState snapshots
- Status: `[x] DONE`
- Notes:
  - Setup file generates `playwright/.auth/club-admin.json`, `coach.json`, `athlete.json`.
  - Auth files remain git-ignored; regenerate per environment.
  - Evidence:
    - `tests/e2e/setup/supabase-auth.setup.ts`
    - `tests/e2e/helpers/supabase-auth.ts`

#### TST-203 - Add supabase Playwright project
- Status: `[x] DONE`
- Notes:
  - Mock and Supabase configs are now split to avoid mode collision.
  - Evidence:
    - `playwright.supabase.config.ts`
    - `package.json` (`test:e2e:supabase`, `test:e2e:supabase:setup`)

#### TST-204 - Supabase role auth smoke specs
- Status: `[x] DONE`
- Notes:
  - Added role entry smoke checks using generated storage states.
  - Evidence:
    - `tests/e2e/supabase/role-auth.spec.ts`

### TW3 - Supabase Tenant Isolation Assertions

#### TST-301 - Club admin isolation checks
- Status: `[~] IN PROGRESS`
- Notes:
  - Implemented tenant A -> tenant B invite non-visibility assertion using separate storage states.
  - Requires tenant B club-admin credentials + generated `playwright/.auth/club-admin-tenant-b.json`.
  - Evidence:
    - `tests/e2e/supabase/tenant-isolation.spec.ts`
    - `tests/e2e/setup/supabase-auth.setup.ts`
    - `tests/e2e/helpers/supabase-auth.ts`

#### TST-302 - Coach isolation checks
- Status: `[~] IN PROGRESS`
- Notes:
  - Added role-token based isolation assertion:
    - create probe team under tenant A (`coach` token)
    - verify visible to tenant A coach and not visible to tenant B coach
    - cleanup probe team
  - Requires tenant B coach credentials.
  - Evidence:
    - `tests/e2e/supabase/tenant-isolation-role.spec.ts`
    - `tests/e2e/helpers/supabase-rest.ts`

#### TST-303 - Athlete isolation checks
- Status: `[~] IN PROGRESS`
- Notes:
  - Added role-token based isolation assertion:
    - create probe team under tenant A (`coach` token)
    - verify visible to tenant A athlete and not visible to tenant B athlete
    - cleanup probe team
  - Requires tenant B athlete credentials.
  - Evidence:
    - `tests/e2e/supabase/tenant-isolation-role.spec.ts`
    - `tests/e2e/helpers/supabase-rest.ts`

## Coverage Matrix (Current)

### Mock-mode
- `[x]` Club admin can open `/club-admin/users`.
- `[x]` Coach can open `/coach/teams`.
- `[x]` Athlete can open `/athlete/wellness`.
- `[x]` Athlete can submit wellness check-in and view readiness output.
- `[x]` Tenant A invite is not visible in tenant B session.

### Supabase-mode
- `[~]` Auth setup + role smoke suite scaffolded.
- `[~]` Current run behavior: clean skip when required env vars are missing.
- `[~]` Club-admin tenant isolation spec scaffolded (tenant B env-gated).
- `[~]` Coach and athlete tenant isolation specs scaffolded (tenant B env-gated).
- `[x]` CI split lanes added (required mock + optional secret-gated Supabase).
- `[ ]` Pending first fully-configured green run with real fixture accounts.

## Status Log

- March 20, 2026:
  - Added `tests/e2e/helpers/session.ts`.
  - Added `tests/e2e/role-journeys-and-tenancy.spec.ts`.
  - Forced Playwright web server mode to mock for deterministic e2e (`playwright.config.ts`).
  - Verified focused spec passes (`3/3`).
  - Added Supabase Playwright project/config (`playwright.supabase.config.ts`).
  - Added Supabase auth-state setup flow and helpers.
  - Added Supabase role-auth smoke specs.
  - Verified `npm run test:e2e:supabase:setup` skips safely when env vars are not set.
  - Verified `npm run test:e2e:supabase` skips safely when auth states are not available.
  - Added Supabase tenant-isolation spec for club-admin invites (tenant A vs tenant B).
  - Added Supabase coach/athlete tenant-isolation specs using role-token REST checks.
  - Added `.github/workflows/e2e.yml` split CI workflow with artifact publishing.
- March 21, 2026:
  - Added Supabase coach builder smoke spec:
    - `tests/e2e/supabase/coach-builder.spec.ts`
  - Verified targeted run command completes and skips safely when env/auth fixtures are not present.

## Exit Criteria

- `[~]` Mock-mode role and tenant baseline is wired in CI (awaiting first repository run evidence).
- `[ ]` Supabase-mode project added with deterministic auth fixtures.
- `[ ]` Tenant isolation assertions pass against real RLS.
- `[~]` Critical user journeys are represented in CI lane structure; assertions expand in TW4.

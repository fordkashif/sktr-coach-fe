# PaceLab Supabase Environment + Secrets Setup

Last updated: March 20, 2026

## Purpose

Define project/environment setup for Supabase across local, dev, and prod, including secret handling rules.

Companion files:
- `.env.supabase.example`
- `SUPABASE_POSTGRES_STATUS_BOARD.md`

## Environment Topology

- Local:
  - Supabase local stack (CLI + Docker), or dedicated local project
  - Used for schema iteration and migration testing
- Dev:
  - Shared team environment for integration testing
  - Mirrors production config patterns with safe data
- Prod:
  - Production tenant data and operational workloads
  - Locked-down access and audited changes only

## Required Variables

Frontend-safe (`VITE_*`):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BACKEND_MODE` (`mock` or `supabase`)

Server/CI only (never in browser bundle):
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_ACCESS_TOKEN` (if CI uses CLI auth)
- `SUPABASE_PROJECT_REF`

## Variable Rules

- Only `VITE_*` keys are allowed in client code.
- `SUPABASE_SERVICE_ROLE_KEY` must never be committed, logged, or exposed to browser.
- Local `.env*` files are gitignored; repo keeps templates only.
- Use separate keys per environment; never reuse prod keys in dev.

## Setup Steps

1. Copy template:
   - `Copy-Item .env.supabase.example .env.local`
2. Fill local values:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_BACKEND_MODE=supabase` (or `mock` during staged migration)
3. For CLI/migrations, set non-`VITE` vars in shell or CI secret manager.
4. Validate frontend loads without hardcoded credentials.

## CI/CD Secret Handling

- Store all non-`VITE` secrets in CI secret manager.
- Limit secret access to migration/deploy jobs only.
- Block secret echo in logs.
- Rotate keys on environment compromise or team-role changes.

## Rotation Policy

- Rotate anon and service-role keys on:
  - team member offboarding
  - accidental exposure
  - scheduled quarterly security maintenance
- After rotation:
  - update environment stores
  - verify app auth/read/write flows
  - invalidate old credentials

## Least-Privilege Guidance

- Frontend should use anon key + RLS-protected tables only.
- Privileged operations use service role only in controlled server context:
  - migrations
  - profile bootstrap
  - admin batch jobs
- Do not embed service-role actions directly in client routes/components.

## Developer Checklist

- [x] Environment tiers defined (local/dev/prod)
- [x] Frontend and server variables documented
- [x] Secret handling and rotation guidance documented
- [x] Bootstrap steps documented with `.env` template


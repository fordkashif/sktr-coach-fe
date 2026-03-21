# PaceLab Supabase Migration Runbook

Last updated: March 20, 2026

## Purpose

Operational runbook for database migration execution with Supabase CLI automation.

## Policy

- Default path: automated migrations via CI (`.github/workflows/supabase-migrations.yml`).
- Manual SQL is break-glass only.
- Any break-glass SQL must be backfilled into `supabase/migrations/*.sql` immediately.

## CI Workflow

Workflow file:
- `.github/workflows/supabase-migrations.yml`

Execution model:
- `push` to `main`:
  - runs `dev` migration job automatically
- `release published`:
  - runs `prod` migration job automatically
- `workflow_dispatch`:
  - manual trigger for `dev` or `prod`

## Required GitHub Environments and Secrets

Create two GitHub Environments:
- `dev`
- `prod`

In each environment, set:
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`

## Required Local Standards

- All schema/policy changes must be added as SQL files under `supabase/migrations/`.
- Migration filenames must be timestamped and immutable once merged.
- Do not edit historical migration files after merge.

## Normal Migration Flow

1. Create migration file:
   - `supabase migration new <name>`
2. Add SQL in the new file under `supabase/migrations/`.
3. Open PR and get approval.
4. Merge to `main`.
5. CI auto-applies migrations to `dev`.
6. Publish release.
7. CI auto-applies migrations to `prod`.

## Failure Handling

If CI migration fails:
1. Stop application deploy promotion.
2. Identify failing migration file and SQL error from workflow logs.
3. Create forward-fix migration (avoid editing old merged files).
4. Re-run workflow after fix.

## Break-Glass Procedure (Manual SQL)

Allowed only when:
- Production incident requires immediate DB intervention and CI path is unavailable/too slow.

Steps:
1. Execute minimal SQL fix manually.
2. Log incident context (time, operator, reason, exact SQL).
3. Create equivalent migration SQL file in repo.
4. Merge migration backfill PR immediately.
5. Reconcile environments through CI workflow.

## Verification Checklist

- [ ] `dev` workflow run succeeds once with migrations applied
- [ ] `prod` workflow run succeeds once with migrations applied
- [ ] Workflow logs retained and linked in status board


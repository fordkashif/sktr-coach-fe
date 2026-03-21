# Supabase Backup + Recovery Runbook

Last updated: March 20, 2026

## Purpose

Define backup validation, restore drills, and incident-response steps for the PaceLab Supabase Postgres environment.

## Scope

- Database backup verification.
- Point-in-time restore process.
- Recovery validation checklist.
- Communication and audit requirements.

## Environments

- `dev`: integration and restore rehearsals.
- `prod`: operational environment with strict change controls.

## Ownership

- Primary owner: Platform / Club Admin backend owner.
- Secondary owner: Engineering lead on-call.

## Backup Policy

1. Supabase managed daily backups must remain enabled for `prod`.
2. Retention window must satisfy business and compliance requirements.
3. Weekly verification:
   - Confirm latest backup exists.
   - Confirm restore window and PITR availability.
4. Monthly restore drill:
   - Restore most recent backup into isolated recovery project.
   - Validate critical tables and row counts.
   - Record drill outcomes in engineering ops log.

## Recovery Scenarios

### Scenario A: Accidental Data Deletion

1. Freeze write traffic if blast radius is active.
2. Identify incident timestamp window.
3. Restore backup/PITR into isolated recovery instance.
4. Extract affected rows.
5. Re-apply rows to production via controlled SQL script.
6. Validate with tenant-scoped spot checks.

### Scenario B: Corrupt Migration Applied

1. Halt deploy pipeline.
2. Identify last known good migration boundary.
3. Restore to pre-change point in isolated environment.
4. Prepare forward-fix migration.
5. Apply fix in `dev`, then `prod` through CI.

### Scenario C: Full Environment Recovery

1. Provision replacement Supabase project.
2. Restore latest backup.
3. Reapply environment secrets and auth settings.
4. Point app env vars to recovered project.
5. Run smoke tests on core flows.

## Validation Checklist

After any restore or data replay:

1. `profiles`, `teams`, `athletes`, `sessions`, `test_results`, `training_plans`, `wellness_entries`, `pr_records` row counts are sane.
2. RLS access checks pass for:
   - athlete self-read/write constraints
   - coach/team-scoped access
   - club-admin global tenant controls
3. Critical UI flows succeed:
   - athlete session + trends
   - coach training plan publish
   - club-admin users/reports

## Incident Communication

1. Open incident channel with timestamp and owner.
2. Publish impact summary and expected recovery ETA.
3. Post-incident:
   - root cause
   - data impact
   - preventative actions

## Audit Requirements

For each backup/recovery incident or drill record:

- Who executed the operation.
- When operation started/completed.
- Environment and project reference.
- Restore point used.
- Validation outcomes.
- Follow-up tasks.

## Do/Do Not

- Do use migration-based forward fixes wherever possible.
- Do run restores in isolated environments before production correction.
- Do not run ad-hoc destructive SQL in production without incident ticket and peer review.

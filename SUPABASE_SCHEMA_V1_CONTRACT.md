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

## Profile Bootstrap Lockdown (migration `20261005200000_lock_down_profile_bootstrap.sql`)

No table or column changes. Policies `profiles_insert_self_bootstrap` and `athletes_insert_self_bootstrap` are dropped; `anon` and `authenticated` lose `INSERT/UPDATE/DELETE/TRUNCATE` on `profiles` and `platform_admin_contacts`.

- New: `bootstrap_current_profile()` returns `table (user_id uuid, tenant_id uuid, role text, status text)`, always one row. No arguments. `status` is `existing | created | invite_pending | none`. Creates a `club-admin` profile only when the caller's confirmed email is the `requestor_email` of an approved request with a provisioned, active tenant (latest reviewed request wins), and writes a `club_admin_first_access` row to `audit_events`. `tenant_id` and `role` are null for `invite_pending` and `none`. `authenticated` and `service_role` only.
- Changed: `accept_athlete_invite(p_invite_id uuid)` creates the caller's `athlete` profile from the invite when they have none, provided the invite is addressed to their email. Same return value (the team id) and same error texts.
- Changed: `accept_coach_invite(p_invite_id uuid)` refuses to reactivate a deactivated profile through an invite older than the profile's last change. Same return value (the tenant id).
- Both accept functions: the invite row is locked for the call, a repeat call by the same user on an invite they already accepted returns the same value, `EXECUTE` revoked from `public` and `anon`.
- `provision_club_admin_tenant(...)`: `service_role` only.
- The app no longer reads `tenant_id`, `role` or `team_id` from auth user metadata anywhere. Only `display_name` is read from it (as a default name).

## Invite Email Delivery (migration `20261006090000_invite_email_delivery.sql`)

Added to both `coach_invites` and `athlete_invites`. Written only by the `send-invite-email` edge function (service role); a trigger ignores API writes to them.

| Column | Type | Meaning |
|---|---|---|
| `last_email_attempt_at` | `timestamptz null` | last time a send was started (drives the 60 second resend wait) |
| `last_email_sent_at` | `timestamptz null` | last time the email provider accepted the invite email |
| `email_send_count` | `int not null default 0` | accepted sends for this invite (maximum 5) |
| `last_email_error` | `text null` | code of the last failure: `email_not_configured`, `provider_failure`, `recipient_opted_out`. Null after a successful send |

`protect_invite_email_delivery_columns()` trigger function, attached to both tables before insert or update.

## Account Basics and Profile Photos (migration `20261007100000_account_basics_and_avatars.sql`)

New table `account_avatars` (one row per account that has a photo):

| Column | Type | Meaning |
|---|---|---|
| `user_id` | `uuid primary key references auth.users on delete cascade` | the owner |
| `avatar_path` | `text not null` | object name in the `avatars` bucket; check constraint `account_avatars_path_own_folder`: `<user_id>/<8 to 64 of A-Z a-z 0-9 _ ->.<jpg\|png\|webp>` |
| `updated_at` | `timestamptz not null default now()` | |

New column `platform_admin_contacts.display_name text null` (120 characters at most). A platform admin has no `profiles` row; this is their name.

Storage: bucket `avatars`, public, `file_size_limit` 2097152, `allowed_mime_types` `image/jpeg`, `image/png`, `image/webp`. Created by the migration; nothing to set up by hand. The browser crops to a centred square and resizes to 512px JPEG before upload. The public address is `<project url>/storage/v1/object/public/avatars/<avatar_path>`.

Functions: `avatar_path_is_valid_for(uuid, text)`, `caller_can_manage_own_avatar()`, `avatar_object_is_callers(text)`, `set_current_avatar(text) returns text`, `update_current_display_name(text) returns text`, `get_current_account()`, `get_visible_avatars()`, trigger function `sync_platform_admin_contact_email()` on `auth.users` (after update of email). Redefined with an `email_confirmed_at` check: `current_athlete_email()`, `get_athlete_invite_preview(uuid)`, `accept_athlete_invite(uuid)`, `accept_coach_invite(uuid)`. Who may call what is in `SUPABASE_RLS_POLICY_MATRIX.md`.

## Notifications That Reach People (migration `20261007090000_notifications_delivery.sql`)

Additive. No table or column is dropped, no existing row is changed, nothing is created for past events.

New column `notification_events.next_attempt_at timestamptz null`: email rows only, "do not retry before".

New indexes: `notification_events_email_queue_idx` (partial: email rows still waiting), `notification_events_recipient_type_created_idx`, `user_notifications_recipient_created_idx`.

New table `notification_dispatch_config` (exactly one row, private: row level security on, no policies, no API grants):

| Column | Type | Meaning |
|---|---|---|
| `id` | `boolean primary key default true check (id)` | makes it a single row |
| `scheduler_token` | `text not null` | 64 random hex characters made by the migration the first time it runs. The database sends it in the `x-sktr-scheduler-token` header when it calls `dispatch-notification-emails`; the function asks the database whether it matches. Never leaves the database otherwise |
| `function_url` | `text null` | address of the edge function. Learned on its own (see `SUPABASE_ENV_AND_SECRETS_SETUP.md`) |
| `last_requested_at`, `last_request_source` | | when the database last asked for a run, and why (`cron`, `insert`) |
| `last_run_at`, `last_run_mode`, `last_run_summary` | | what the edge function last reported |

Event types (`notification_events.event_type`). The recipient is always an active member of the club the event belongs to, never the person who caused it:

| Event | Who is told | Written by (trigger on) | Channels and default |
|---|---|---|---|
| `training_plan_published` | athletes the published plan reaches (immediate assignments) | `training_plan_assignments` insert, or `visibility_start` becoming `immediate`; `training_plans` when status becomes `published` | in-app and email |
| `training_plan_updated` | the same athletes | `training_plans` update of a published plan (name, start date, weeks, notes or builder state changed) | in-app; email off by default |
| `test_week_published` | active athletes of the team | `test_weeks` insert as published, or status becoming `published` | in-app and email |
| `session_note_added` | the athlete | `sessions` update of `coach_note` to a non-empty value | in-app and email |
| `athlete_team_added`, `athlete_team_removed` | the athlete | `athletes` update of `team_id` by someone else | in-app and email |
| `athlete_session_completed` | coaches assigned to the athlete's team | `session_completions` insert | in-app only, one growing row per team per day |
| `athlete_test_results_submitted` | coaches assigned to the test week's team | `test_results` insert (statement level), results entered by the athlete | in-app only, one growing row per test week |
| `athlete_low_readiness` | coaches assigned to the athlete's team | `wellness_entries` insert or update to `readiness = 'red'` for today | in-app; email off by default |
| `coach_team_assigned`, `coach_team_removed` | the coach | `team_coaches` insert or delete by someone else | in-app and email |
| `package_request_reviewed` | the club's admins | `tenant_package_upgrade_requests` status leaving `pending` for `approved` or `rejected` | in-app and email |
| `club_suspended` | the club's admins | `tenant_provision_requests.lifecycle_status` becoming `suspended` | email only |
| `club_reactivated` | the club's admins | `lifecycle_status` going from `suspended` to `active` or `active_onboarding` | in-app and email |

The earlier events are unchanged: `tenant_provision_request_submitted` / `_reviewed` / `_provisioned`, `coach_invite_created` / `_accepted`, `athlete_invite_created` / `_accepted`.

`notification_events.metadata` carries ids only (`plan_id`, `team_id`, `test_week_id`, `session_id`, `session_date`, `athlete_id`, `athlete_ids`, `athlete_names`, `dedupe_key`, `rollup_key`). The screen a notification opens is derived from the event type and these ids in one place, `supabase/functions/_shared/notification-target.ts`, used by both the app and the emails.

Email queue states (`notification_events` rows with `channel = 'email'`): `pending` (waiting, or claimed when `processing_started_at` is set), `sent`, `failed` (will be retried while `delivery_attempt_count < 5`, not before `next_attempt_at`), `suppressed` (held back for good; the reason is in `last_error`). An email more than 72 hours old is not sent: it is marked `suppressed` when delivery runs.

Functions: `notification_default_enabled(text, text)`, `notification_channel_enabled(text, text, uuid, text)` (redefined: whole channel off wins, then the person's choice, then the default), `enqueue_notification(...)`, `enqueue_rollup_notification(...)`, `notify_training_plan_audience(uuid, text, uuid)`, `notification_team_coach_user_ids(uuid)`, `notification_club_admin_user_ids(uuid)`, `notification_athlete_name(uuid)`, `notification_date_label(date)`, `claim_notification_emails(integer, uuid, uuid[], boolean)`, `complete_notification_email(uuid, boolean, text, text, boolean)`, `notification_email_queue_due()`, `notification_email_max_age()`, `request_notification_email_dispatch(text)`, `verify_notification_scheduler_token(text)`, `register_notification_dispatch_url(text)`, `record_notification_dispatch_run(text, jsonb)`, `get_platform_notification_email_stats()`, and the trigger functions `enqueue_training_plan_change_notifications`, `enqueue_session_note_notifications`, `enqueue_athlete_team_change_notifications`, `enqueue_session_completed_notifications`, `enqueue_test_results_submitted_notifications`, `enqueue_low_readiness_notifications`, `enqueue_team_coach_change_notifications`, `enqueue_package_request_reviewed_notifications`, `enqueue_club_lifecycle_notifications`, `notification_events_request_dispatch`. Rewritten: `enqueue_training_plan_assignment_notifications`, `enqueue_test_week_published_notifications`. Who may call what is in `SUPABASE_RLS_POLICY_MATRIX.md`.

Scheduler (both guarded, the migration applies without them): extensions `pg_net` and `pg_cron`; jobs `sktr-dispatch-notification-emails` (every minute, `select public.request_notification_email_dispatch('cron')`) and `sktr-trim-cron-run-history` (daily, keeps a week of `cron.job_run_details`).

Realtime: `user_notifications` is added to the `supabase_realtime` publication (guarded).

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


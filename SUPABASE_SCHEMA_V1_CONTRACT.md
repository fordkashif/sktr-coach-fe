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

## Pain Reports and Private Athlete Details (migration `20261008110000_pain_reports_and_athlete_profile_fields.sql`)

Additive. No existing table, column or row is changed.

New table `pain_reports`:

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid fk tenants | |
| `athlete_id` | uuid fk athletes, cascade | |
| `body_areas` | text[] | 1 to 12 keys from a fixed list (`hamstring_left`, `lower_back`, ...). Keep in step with `src/lib/data/wellness/pain-report-types.ts` |
| `severity` | smallint | 1 to 5 |
| `started_on` | date | not in the future |
| `training_impact` | text | `none`, `modified`, `cannot_train` |
| `note` | text null | 500 characters at most |
| `status` | text | `open` or `resolved`; `resolved_at` is set exactly when resolved |
| `reported_by_user_id` | uuid fk auth.users | |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `pain_reports_athlete_status_idx (athlete_id, status, created_at desc)`, `pain_reports_tenant_open_idx (tenant_id, created_at desc) where status = 'open'`.

New table `athlete_private_details` (one row per athlete, primary key `athlete_id`): `tenant_id`, `preferred_name`, `pronouns`, `height_cm numeric(5,1)` (50 to 260), `weight_kg numeric(5,1)` (20 to 300), `emergency_contact_name`, `emergency_contact_relationship`, `emergency_contact_phone`, `guardian_name`, `guardian_phone`, `guardian_email`, `medical_notes` (1000 characters), `bib_number`, `affiliation`, `updated_by_user_id`, `created_at`, `updated_at`. Every value is optional. Index `athlete_private_details_tenant_idx`.

New table `coach_contact_settings` (primary key `user_id`): `tenant_id`, `show_email_to_athletes boolean default false`, `created_at`, `updated_at`. No row means off.

Functions: `update_current_athlete_private_details(...)`, `set_current_coach_contact_visibility(boolean)`, `get_current_athlete_team_coaches()`, `leave_current_athlete_team()`, `contact_phone_is_valid(text)`, `contact_email_is_valid(text)`; `notification_default_enabled(text, text)` replaced (adds `athlete_pain_reported` to the email-off list). Triggers: `pain_reports_before_write`, `queue_pain_report_notifications`, `set_updated_at_athlete_private_details`.

New notification events: `athlete_pain_reported` (metadata `athlete_id`, `team_id`, `pain_report_id`), `athlete_left_team` (metadata `athlete_id`, `team_id`). New audit action: `athlete_leave_team`.

## Skip, Availability, Sessions Added by the Athlete (migration `20261008090000_session_skip_availability_extra.sql`)

`sessions` gains:

| Column | Type | Notes |
|---|---|---|
| `origin` | text not null default `plan` | `plan` (set by the coach, from a plan or by hand) or `athlete` (logged by the athlete without being planned). `athlete` rows never have a plan slot (`sessions_athlete_origin_has_no_plan`) and never count towards adherence |
| `skip_reason` | text null | `sick`, `injured`, `travelling`, `competing`, `school_work`, `other`. Required while `status = 'skipped'`, cleared by trigger otherwise |
| `skip_note` | text null | 280 characters at most |
| `skipped_at` | timestamptz null | |

`sessions.status` now allows `skipped` (`sessions_status_check` replaced by a wider check). New index `sessions_athlete_scheduled_idx (athlete_id, scheduled_for desc)`.

New table `athlete_availability`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid fk tenants | |
| `athlete_id` | uuid fk athletes | cascade on delete |
| `kind` | text | `injured`, `sick`, `away` |
| `starts_on` | date | first day unavailable |
| `ends_on` | date null | last day unavailable; null means until further notice. `ends_on = starts_on - 1` marks a period cancelled before it began |
| `note` | text null | 280 characters at most; never copied into audit events or notifications |
| `created_by_user_id`, `created_by_role` | uuid, text | who set it (`athlete`, `coach`, `club-admin`) |
| `ended_at`, `ended_by_user_id` | timestamptz, uuid | set when ended by hand ("I'm back") |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `athlete_availability_athlete_idx (athlete_id, starts_on desc)`, `athlete_availability_tenant_idx (tenant_id, starts_on desc)`.

Functions: `skip_my_session(uuid, text, text)`, `unskip_my_session(uuid)`, `set_athlete_availability(text, date, date, text, uuid) returns uuid`, `end_athlete_availability(uuid, date)`, `get_my_last_exercise_results(text[], date, uuid)`, `availability_kind_label(text)`, trigger function `clear_session_skip_fields()`.

New notification events: `athlete_unavailable` and `athlete_available_again` (to the team's coaches, in the app only; metadata `athlete_id`, `team_id`), `availability_set_by_coach` (to the athlete, in the app and by email; metadata `athlete_id`, `availability_id`). New audit actions: `athlete_availability_set`, `athlete_availability_ended`.

Plan adherence (computed in the app, `src/lib/data/session/adherence.ts`): sessions completed / sessions that were due and not excused, last 28 days. Due: `origin = 'plan'` and scheduled up to today. Excused: `status = 'skipped'`, or scheduled inside an `athlete_availability` period, unless the session was completed anyway. No sessions due gives no figure (null), never 100%.

## Roster: Bulk Invites, Join Codes, Athletes Without a Login (migration `20261009090000_roster_bulk_join_codes_managed_athletes.sql`)

- `athletes.user_id` may be NULL: a managed athlete with no login. New columns `created_by_user_id`, `login_linked_at`. Seats (package limit) count rows with `is_active`.
- `athlete_invites.invitee_name` (name typed by the inviter), `athlete_invites.athlete_id` (a "give them a login" invite for an existing managed athlete).
- `team_join_codes` (`id`, `tenant_id`, `team_id`, `code` 32 hex, `expires_at`, `max_uses`, `use_count`, `disabled_at`, `disabled_by_user_id`, `created_by_user_id`, `created_at`): at most one row per team with `disabled_at is null`.
- `team_join_code_uses` (`code_id`, `tenant_id`, `team_id`, `athlete_id`, `user_id`, `outcome` new_athlete or existing_athlete, `joined_at`).
- Package limits now also live in the database: `tenant_athlete_limit()` (starter 40, pro 150, otherwise none). Keep in step with `src/lib/billing/package-catalog.ts`.
- New notification types: `athlete_joined_team`, `athlete_moved_team` (in-app, to coaches). New audit actions: `team_join_code_created`, `team_join_code_disabled`, `team_join_code_used`, `athlete_invites_bulk_created`, `managed_athlete_created`, `managed_athlete_updated`, `managed_athlete_removed`, `managed_athlete_login_invited`, `managed_athlete_login_linked`, `athlete_moved_team`.

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


## Results history and competitions (20261008100000)

- `result_events (key, name, category, kind, unit, lower_is_better, wind_applies, hand_time_adjust, aliases, sort_order)`: the controlled event list. `kind`: `time` (seconds, lower is better), `distance` (metres, higher is better), `points`, `weight` (kilograms), `other` (free text name, unit chosen per result). Mirrored by `RESULT_EVENTS` in `src/lib/data/pr/marks.ts`.
- `athlete_results`: every mark. `event_key`, `event_label`, `event_group` (`k:<key>` or `o:<lower case label>`, what bests are grouped by), `mark_value` in the canonical unit (`mark_unit`: s, m, cm, kg, pts), `compare_value` (mark plus the hand timing adjustment), `mark_display` ("10.84", "10.6h", "1:52.30"), `timing`, `result_date`, `source` (`competition`, `test_week`, `training`, `manual`, `imported`), `competition_id`, `competition_entry_id` (unique), `test_result_id` (unique, cascades), `legacy_pr_record_id` (unique), `place`, `wind`, `is_wind_legal` (false when wind is over +2.0), `environment`, `is_altitude`, `location`, `notes`, `entered_by_user_id`.
- `competitions (scope team|club|athlete, team_id, owner_athlete_id, name, start_date, end_date, venue, location, level, environment, notes, created_by_user_id)` and `competition_entries (competition_id, athlete_id, event_key, event_label, event_group, notes, status entered|scratched, entered_by_user_id)`, unique per competition, athlete and event. The result of an entry is the `athlete_results` row with that `competition_entry_id`: one final mark, optional place and wind.
- Bests are derived: `athlete_event_best(athlete, event_group, from, to, legal_only)` and the view `athlete_event_bests` (`personal_best`, `season_best`, `wind_assisted_best`). Season: `results_season_bounds(tenant, date)` = the club's `club_profiles` season when the date is inside it, otherwise the calendar year.
- `pr_records` is kept as a projection (new column `event_group`): one row per athlete and event holding the current best, rewritten by trigger from `athlete_results`. Readers are unchanged. Do not write it from the app.
- `test_results` rows are copied into `athlete_results` by trigger (insert, update, delete, and when a test is renamed).
- Notification event types: `athlete_new_best` (coaches of the athlete's team, in-app), `competition_entry_added` (the athlete, in-app and email).


## Test weeks: close, reopen, results entered by a coach (20261009100000)

- `test_results.entered_by_role text` (nullable; `athlete`, `coach` or `club-admin`): who typed the result. Written by trigger `test_results_guard` from the signed-in user, together with `submitted_by_user_id`; never sent by the app. Backfilled for existing rows where it can be told, otherwise null.
- `test_weeks.status` keeps its three values. Transitions the app uses: `draft -> published` (publish), `published -> closed` (close), `closed -> published` (reopen). `draft -> closed` is refused. Athletes may enter results only while the status is `published` (unchanged rule), staff also while it is `closed`.
- Function `set_test_week_open(p_test_week_id uuid, p_open boolean) returns text`: the close and reopen call. Returns the status afterwards; asking for the state the week is already in changes nothing.
- Trigger functions: `test_results_guard()` (before insert or update on `test_results`), `test_weeks_status_guard()` (before update of `status`), `test_weeks_status_changed()` (after update of `status`: audit and reopen notice). `enqueue_test_week_published_notifications()` is redefined to skip a reopen.
- Audit actions: `test_week_closed`, `test_week_reopened`. Notification event type: `test_week_reopened` (active athletes of the team with an account, in-app only, at most one per test week per 10 minutes).
- A coach clearing a result deletes the `test_results` row; its `athlete_results` row goes with it (existing cascade) and the bests are recalculated.
- No new table and nothing for reports or printing: report date ranges and plan printing are reads of existing tables.



## Messaging and the staff side of competitions (20261009110000)

- `announcements (tenant_id, audience team|club|coaches, team_id, sender_user_id, sender_role coach|club-admin, body 1 to 1000 characters, created_at)`. `team_id` only for `audience = 'team'`. Never updated.
- `announcement_recipients (announcement_id, recipient_user_id, tenant_id, read_at)`, primary key on the first two. Who it went to is fixed when it is posted: active members with a login, never the sender. Team: the team's athletes and its other coaches. Club: every athlete, coach and club admin. Coaches: every coach.
- `message_threads (tenant_id, team_id, coach_user_id, athlete_id, created_by_user_id, last_message_at, coach_last_read_at, athlete_last_read_at)`, unique per coach and athlete. `team_id` is the athlete's team when the coach last opened or wrote in the thread; a coach reads the thread only while assigned to that team.
- `messages (tenant_id, thread_id, sender_user_id, sender_role coach|athlete, body, hidden_at, created_at)`. `body` is null exactly when `hidden_at` is set. No update or delete through the API.
- `message_moderation (message_id, tenant_id, thread_id, original_body, reason, hidden_by_user_id, hidden_at)`: the text of a hidden message, club admins only.
- `message_reports (tenant_id, thread_id, message_id, reporter_user_id, reason, resolution hidden|dismissed, resolved_at, resolved_by_user_id)`, unique per message and reporter.
- `messaging_settings` (one private row): `dm_per_hour` 30, `announcements_per_day` 20, `max_length` 1000, `dm_email_window` 1 hour.
- `club_profiles.guardian_cc_enabled boolean not null default false`: reserved, read by nothing that sends.
- Functions the app calls: `open_message_thread(p_athlete_id, p_coach_user_id) returns uuid`, `send_direct_message(p_thread_id, p_body) returns uuid`, `mark_message_thread_read(p_thread_id)`, `get_message_threads(p_team_id)`, `get_message_thread(p_thread_id)`, `report_message(p_message_id, p_reason)`, `hide_message(p_message_id, p_reason)`, `dismiss_message_reports(p_message_id)`, `get_message_oversight_threads()`, `post_announcement(p_audience, p_body, p_team_id) returns uuid`, `mark_announcement_read(p_announcement_id)`, `get_announcements(p_team_id)`, `get_announcement_recipients(p_announcement_id)`, `get_message_unread_counts()`.
- Helpers: `clean_message_body(text)`, `message_member_name(user, fallback)`, `message_thread_is_open(thread)`, `current_message_thread_ids()`, `current_announcement_ids()`, `can_manage_announcement(announcement)`.
- Notification event types: `announcement_posted` (metadata `announcement_id`, `team_id`), `direct_message_received` (metadata `thread_id`), `message_reported` (metadata `thread_id`, `message_id`). All on by default on both channels; `notification_default_enabled()` is not replaced. Screens they open: `supabase/functions/_shared/notification-target.ts`.
- Audit actions: `message_reported`, `message_hidden`, `message_report_dismissed`.
- Realtime publication: `messages`, `message_threads`.
- Competitions: no table or policy change. New index `competition_entries_competition_idx (competition_id)`.

## Club admin invites, removing people, deleting an athlete's data (20261010090000)

Migration `20261010090000_club_admin_invite_role_and_member_removal.sql`. Additive, except for the deletes that only run when a club admin calls `remove_tenant_member` or `delete_athlete_and_data`.

- New table `removed_members (tenant_id, user_id, display_name, role, removed_by_user_id, removed_at)`, primary key `(tenant_id, user_id)`, `role in ('coach', 'club-admin')`. One row per coach or club admin removed from a club; `message_member_name()` falls back to it.
- `coach_invites.role` (already `'coach' | 'club-admin'`, default `'coach'`) is now used: a club admin can invite someone directly as a club admin. Trigger `guard_club_admin_invite` (after insert or update of role) guards and audits it.
- New functions: `get_public_coach_invite_role(uuid) returns text`, `remove_tenant_member(uuid) returns void`, `remove_athlete_from_club(uuid) returns boolean`, `restore_athlete_to_club(uuid) returns boolean`, `delete_athlete_and_data(uuid, text) returns boolean`.
- Replaced functions (same signature): `accept_coach_invite(uuid)` (a coach invite never demotes a club admin; clears `removed_members`), `complete_current_coach_onboarding(text)` (also for a club admin who joined by invite), `message_member_name(uuid, text)` (former staff keep their name).
- New audit actions: `club_admin_invite_created`, `member_removed`, `athlete_removed_from_club`, `athlete_restored_to_club`, `athlete_data_deleted`.
- Archive strategy: unchanged. Leaving the club is still a soft switch (`athletes.is_active = false`, history kept). `delete_athlete_and_data` is the only hard delete of athlete data and exists for privacy requests.

## Club logo, club contact details and platform tools (migration `20261010100000_club_profile_logo_and_platform_tools.sql`)

- `club_profiles.logo_path text` (nullable): object name in the public `club-logos` bucket, `<tenant_id>/<8 to 64 of A-Z a-z 0-9 _ ->.<jpg|png|webp>` (check constraint `club_profiles_logo_path_own_folder`, helper `club_logo_path_is_valid_for(uuid, text)`). Written by `set_current_club_logo(text) returns text` (the previous path).
- New table `club_contact_details`: `tenant_id uuid primary key references tenants`, `contact_email`, `contact_phone`, `city`, `region`, `country`, `website` (all nullable text; check constraint `club_contact_details_values_ok`: email shape, phone of digits and `+ ( ) . -`, website starting `http://` or `https://`, lengths), `created_at`, `updated_at`. Club admins only.
- New functions: `get_current_club_brand() returns table (club_name, short_name, primary_color, logo_path)`, `club_logo_object_is_callers(text)`, `platform_admin_set_tenant_package(p_tenant_id uuid, p_package text, p_reason text) returns text` (the previous package), `get_platform_failed_notification_emails(p_limit integer default 50)` (id, tenant_id, tenant_name, recipient_email, event_type, subject, last_error, delivery_attempt_count, created_at, next_attempt_at, will_retry, can_retry; no body), `retry_platform_notification_email(uuid) returns boolean`.
- `club_profiles.primary_color` is now used in exactly two places: behind the club's short name where it has no logo (`ClubMark`) and as a rule on printed plans. It does not theme the app.
- New audit actions. Club (`audit_events`): `package_changed` (actor role `platform-admin`), `club_logo_update`, `club_logo_remove` (written by the browser). Platform (`platform_audit_events`): `tenant_package_changed`, `notification_email_retry_requested`.
- Additive and idempotent: nothing is dropped and no existing row is changed.

## Session log depth (migration `20261011100000_session_log_depth.sql`)

- `session_row_logs.rpe smallint` (1 to 10, nullable) is the effort of that one set. `session_row_logs.note text` (nullable, at most 500 characters, check `session_row_logs_note_length`) is the athlete's note for the exercise; the app keeps it on the lowest numbered set of the row and may save a row with `completed = false` and no numbers just to hold it. Both columns existed since `20261005090000` and were never written before this.
- New function `exercise_match_key(text) returns text`: how an exercise is matched between sessions (rows have no stable exercise id). App twin: `exerciseMatchKey()` in `src/lib/data/session/log-assist.ts`.
- New function `get_my_last_exercise_logs(p_labels text[], p_before date default current_date, p_exclude_session_id uuid default null)` returns `label_key, session_id, session_date, session_rpe, log_kind, block_type, set_index, reps, load_kg, time_seconds, distance_m, mark, rpe, note`: for each exercise, the ticked sets of the caller's most recent completed session up to `p_before` that has it (one row of that session when the exercise is named twice). `get_my_last_exercise_results` is kept; the app falls back to it when the new function is missing.
- Additive and idempotent: nothing is dropped and no existing row is changed.

## Reminders (20261011120000_reminders.sql)

- `club_profiles.timezone text not null default 'America/Jamaica'`: IANA time zone of the club. Changed with `set_current_club_timezone(name)`.
- `reminder_deliveries (id, tenant_id, user_id, reminder_type, subject_id, local_date, queued_count, created_at)`: one row per reminder handed to the notification queue. `unique (user_id, reminder_type, subject_id, local_date)` is what makes a reminder go out at most once per person per subject per local day.
- `run_reminders(p_now timestamptz default now(), p_tenant_id uuid default null)` returns `(reminder_type, queued)`. Runs hourly from pg_cron. Per club it works out the local date and hour in the club's time zone and sends:

| Event type | To | When (club local time) | Subject id | Email by default |
| --- | --- | --- | --- | --- |
| `reminder_session_today` | athlete | 07:00, a session planned today, not done, not skipped, athlete not injured, sick or away | athlete id | no |
| `reminder_checkin` | athlete | 09:00, no wellness entry for today | athlete id | no |
| `reminder_test_week_closing` | athlete | last day of a published test week, 08:00 to 20:00, a required test has no result | test week id | yes |
| `reminder_test_week_closing_coach` | coaches of the week's team | same window, at least one athlete has required results missing | test week id | yes |
| `reminder_athletes_not_logged` | coach | 08:00, one row counting athletes on their teams who did not log yesterday's session | club id | no |

- A test week has no close time of its own: it is treated as closing at the end of `end_date` in the club's time zone.
- Metadata on each event carries `reminder: true`, `local_date`, and the ids the app needs to open the right screen (`session_date`, `test_week_id`, `team_id`). Screens are decided in `supabase/functions/_shared/notification-target.ts`.
- "Email by default: no" is enforced by the job (it only queues an email when the person has an explicit "on" row in `notification_preferences`), not by `notification_default_enabled()`, which this migration leaves untouched.

## Athlete goals (20261011110000_athlete_goals_and_history.sql)

`athlete_goals`: one row per goal of an athlete.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | primary key |
| `tenant_id` | uuid | from the athlete, set by trigger |
| `athlete_id` | uuid | references `athletes`, cascade on delete |
| `event_key`, `event_label`, `event_group`, `mark_unit`, `lower_is_better` | text, boolean | the same event fields as `athlete_results`; for a listed event they come from `result_events`, for `other` the label and unit are the athlete's own test |
| `target_value` | numeric(12,3) | the mark to reach, compared with `athlete_results.compare_value` |
| `start_value` | numeric(12,3), null | best wind legal mark when the goal was set |
| `target_date` | date, null | optional |
| `note` | text, null | up to 500 characters |
| `achieved_on` | date, null | null while open |
| `achieved_result_id` | uuid, null | the result that met the target; null when marked by hand |
| `achieved_manually` | boolean | true when marked achieved by hand; set it back to false to let results decide |
| `set_by_staff` | boolean | true when a coach or club admin set the goal |
| `created_by_user_id`, `created_at`, `updated_at` | | |

Progress is not stored. The app reads it from `athlete_results` (start mark, current best, target). The session history and test week history screens read existing tables only.

## Exercise library, best lifts and percentage loads (20261011090000_exercise_library_and_loads.sql)

`exercise_library`: the saved exercises of a club.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | primary key |
| `tenant_id` | uuid | the club |
| `name` | text | 1 to 80 characters |
| `name_key` | text | `lift_key(name)`, set by trigger; unique per club, archived exercises included |
| `category` | text | sprint, strength, plyometric, throws, jumps, mobility, conditioning, other |
| `measure` | text | reps_load, time, distance |
| `cue` | text, null | coaching cue, up to 500 characters |
| `link_url` | text, null | http or https link, up to 500 characters, no spaces. Never a file. |
| `is_archived` | boolean | archived exercises are not suggested; plans that use them are unchanged |
| `created_by_user_id`, `created_at`, `updated_at` | | |

`athlete_lift_maxes`: an athlete's best single lift (1RM), one current row per athlete and lift.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | primary key |
| `tenant_id`, `athlete_id` | uuid | the athlete must belong to the club (trigger) |
| `lift_name` | text | as typed ("Back squat") |
| `lift_key` | text | `lift_key(lift_name)`, set by trigger; unique with `athlete_id` |
| `exercise_id` | uuid, null | optional link to `exercise_library` |
| `value_kg` | numeric(6,2) | above 0, up to 1000 |
| `measured_on` | date | |
| `source` | text | coach or athlete, set by trigger from who wrote it |
| `updated_by_user_id`, `created_at`, `updated_at` | | |

New columns on `session_block_rows`: `percent_1rm` numeric(5,2), `lift_name`, `lift_key`, `target_volume` ("4 x 4"), `cue`, `reference_url` (http or https), `exercise_id`.

How a percentage load is worked out:

- The plan builder stores a row's load as text. A load written with a percent sign ("80%") is a percentage of the athlete's best lift for the row's lift (the exercise itself, or the lift named in `percentOf`).
- When a session is written for an athlete, the app sends `percent_1rm`, `lift_name` and `target_volume`. The trigger `resolve_session_row_load()` looks up the athlete's best lift: the row in `athlete_lift_maxes`, otherwise the highest kilogram mark in `athlete_results` whose `event_label` has the same `lift_key`.
- With a best lift: `target` becomes "4 x 4 at 80%, 120 kg" (nearest 2.5 kg), `target_load` "120 kg", `helper` the cue. Without one: `target` "4 x 4 at 80%", `target_load` "80%", and `helper` ends with a short hint.
- Saving, correcting or removing a best lift, or adding a kilogram result, works the athlete's sessions out again when their status is scheduled or in progress. Completed and skipped sessions keep what the athlete saw.
- Per athlete changes to a plan row live in `training_plans.builder_state` (`sessions[].blocks[].exercises[].overrides[]`: `athleteId`, `sets`, `reps`, `load`, `note`). The app applies them when it writes that athlete's session rows, on publish, on update and when an athlete's session is created on demand. Updating a published plan replaces sessions that are still untouched and upcoming; a session the athlete has started is left as it is.

The link is stored on the row (`reference_url`) but the athlete log screen does not show it yet.

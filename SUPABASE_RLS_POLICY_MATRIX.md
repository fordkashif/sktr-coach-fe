# PaceLab Supabase RLS Policy Matrix (v1)

Last updated: October 6, 2026

## Purpose

Define row-level security behavior for Wave 1 through Wave 3 schema entities, aligned with app roles:
- `athlete`
- `coach`
- `club-admin`

This matrix is implemented by:
- `supabase/migrations/20260320113000_schema_v1_rls_policies.sql`
- `supabase/migrations/20261006120000_coach_team_scope.sql` (coaches only act on the teams they are assigned to; see "Coach team scope" below, which is the current rule for every coach line in this document)

## Assumptions

- Authenticated users are in role `authenticated`.
- App role and tenant context are resolved from `public.profiles` using `auth.uid()`.
- Service-role operations are permitted for privileged backend flows (invites/bootstrap/admin jobs) and bypass RLS by design.

## Policy Helper Functions

Defined in SQL migration:
- `public.current_tenant_id() -> uuid`
- `public.current_app_role() -> text`
- `public.is_coach_or_admin() -> boolean`
- `public.is_club_admin() -> boolean`

These helpers are used across policies to avoid duplicated logic.

Since migration `20261005180000_tenant_lifecycle_enforcement.sql` all four helpers answer `null` / `false` when either of these is true, which closes every tenant-scoped policy at once:
- the caller's profile has `is_active = false` (a club admin turned their access off), or
- the latest `tenant_provision_requests` row of the caller's tenant (by `provisioned_tenant_id`, newest `created_at`) has `lifecycle_status` `suspended` or `cancelled`.

A tenant with no provisioning row (legacy tenants) and every other lifecycle status count as open. `is_coach_or_admin()` and `is_club_admin()` read `profiles` directly instead of calling `current_app_role()`, because the nested call was re-planned on every row.

## Access Matrix (Table-by-Table)

Legend:
- `R` = select/read
- `C` = insert/create
- `U` = update
- `D` = delete

### `tenants`

- athlete: `R` own tenant only
- coach: `R` own tenant only
- club-admin: `R` own tenant only
- writes (`C/U/D`): service-role only

### `profiles`

- athlete: `R` own profile only
- coach: `R` own profile + tenant profiles
- club-admin: `R` own profile + tenant profiles
- writes (`C/U/D`): no policy for any API role, and from migration `20261005200000` `anon` and `authenticated` no longer hold `INSERT/UPDATE/DELETE` on the table at all. A profile is created only by `accept_coach_invite`, `accept_athlete_invite`, `bootstrap_current_profile()` (all security definer) or the service role. See "Profile bootstrap lockdown" below.
- athlete self-service: no direct `U`. `update_current_athlete_profile(...)` (security definer, migration `20261005093000`) keeps `display_name` in sync with the athlete's own first and last name. No other profile column is touched.
- coach names for athletes: athletes cannot read other profiles. `get_current_athlete_team_context()` returns the display names of the coaches on the athlete's own team. Coach names are not exposed through invite links.
- club-admin member access: no direct `U`. `set_tenant_member_access(p_user_id, p_role, p_is_active)` (security definer, migration `20261005140000`) changes only `role` and `is_active`. See "Club admin member access, billing contact and package" below.

### `teams`

- athlete: `R` tenant teams
- coach: `R` tenant teams (names are club wide). `U` only teams they are assigned to. No `C`, no `D` (from `20261006120000`)
- club-admin: `R/C/U/D` tenant teams

### `athletes`

- athlete: `R` own athlete row only (`athletes.user_id = auth.uid()`)
- athlete self-service `U`: no update policy. `update_current_athlete_profile(first_name, last_name, date_of_birth, event_group, primary_event)` (security definer, authenticated, athlete role only) updates exactly those five columns on the caller's own row in the caller's tenant. `team_id`, `tenant_id`, `user_id`, `readiness` and `is_active` cannot be changed by an athlete; team changes still go through `accept_athlete_invite`.
- athlete `C`: none. The self-insert policy `athletes_insert_self_bootstrap` was dropped in `20261005200000`; an athlete's own row is created by `accept_athlete_invite` from the invite's team.
- coach: `R/C/U/D` only athletes on a team they are assigned to (from `20261006120000`). Athletes with no team: club admins only. Taking an athlete off a team goes through `remove_athlete_from_team(athlete_id, team_id)`
- club-admin: `R/C/U/D` tenant athletes

### `sessions`

- athlete: `R` own sessions only (`sessions.athlete_id` belongs to auth user)
- coach: `R/C/U/D` sessions of athletes on their assigned teams (from `20261006120000`)
- club-admin: `R/C/U/D` tenant sessions

### `session_blocks`

- athlete: `R` blocks for own sessions only
- coach: `R/C/U/D` blocks of sessions of athletes on their assigned teams
- club-admin: `R/C/U/D` blocks for tenant sessions

### `session_block_rows`

- athlete: `R` rows for own sessions only
- coach: `R/C/U/D` rows of sessions of athletes on their assigned teams
- club-admin: `R/C/U/D` rows for tenant sessions

### `session_completions`

- athlete:
  - `R` own completion rows only
  - `C` only for own athlete-session in current tenant
  - `U/D` not allowed
- coach: `R/C/U/D` completion rows of athletes on their assigned teams
- club-admin: `R/C/U/D` tenant completion rows

### `test_weeks`

- athlete: `R` tenant test weeks
- coach: `R/C/U/D` test weeks of their assigned teams, plus test weeks with no team that they created (from `20261006120000`)
- club-admin: `R/C/U/D` tenant test weeks

### `test_definitions`

- athlete: `R` definitions for tenant test weeks
- coach: `R/C/U/D` definitions of the test weeks above
- club-admin: `R/C/U/D` definitions for tenant test weeks

### `test_results`

- athlete:
  - `R` own results only
  - `C/U` own results only, in current tenant
  - `D` not allowed
- coach: `R/C/U/D` results of athletes on their assigned teams
- club-admin: `R/C/U/D` tenant test results

### `training_plans`

- athlete: `R` tenant plans whose status is not `draft` (drafts are never visible; migration `20261004120000_training_plan_drafts.sql`)
- coach: `R/C/U/D` plans of their assigned teams (drafts included), plus plans with no team that they created (from `20261006120000`). Other teams' plans are not readable
- club-admin: `R/C/U/D` tenant plans, including drafts

### `training_plan_weeks`, `training_plan_days`, `training_plan_blocks`

- athlete: `R` structure of tenant plans whose status is not `draft`
- coach: `R/C/U/D` structure of the plans above
- club-admin: `R/C/U/D` structure of tenant plans

### `training_plan_assignments`

- athlete: `R` assignments addressed to own athlete row or own team
- coach: `R/C/U/D` assignments of the plans above; a new or changed assignment must target a team they are assigned to or an athlete on one
- club-admin: `R/C/U/D` tenant assignments
- Draft plans have no assignment rows. Inserting an assignment with `visibility_start = 'immediate'` queues the `training_plan_published` notification, so assignments are only written at publish time.

### Session logging (migration `20261005090000_session_logging.sql`)

`session_row_logs` (what the athlete did, one row per set):
- athlete: `R/C/U` own rows only, and only against a row of one of their own sessions in the current tenant. No delete (a set is unticked with `completed = false`).
- coach: `R` rows of athletes on their assigned teams (same scope as `sessions_select_tenant_staff`). No write.
- club-admin: `R` tenant rows. No write.

`session_completions` additions:
- athlete: `U` own completion (`session_completions_update_own`), so effort (`rpe`) and `athlete_comment` can be saved and changed.

`sessions`, `session_blocks`, `session_block_rows` additions:
- athlete: `C` only for their own athlete row, only with `status = 'scheduled'` and a plan slot (`plan_id`, `plan_week_number`, `plan_day_index`) pointing at a published plan in the tenant; blocks and rows only under such a session while it is still `scheduled`. This covers athletes who joined after the plan was published. Athletes still cannot update or delete sessions.
- `sessions.status` is moved by security definer triggers, not by the athlete: first logged set sets `in-progress`, a completion sets `completed`.
- club-admin: `R/C/U/D` tenant. coach: `R/C/U/D` for athletes on their assigned teams. Sessions are created for every assigned athlete when a plan is published.

### Club admin member access, billing contact and package (migration `20261005140000_club_admin_member_access_and_billing_contact.sql`)

All are security definer functions with `set search_path = public`, executable by `authenticated` only (revoked from `public` and `anon`). No table policy was widened.

`set_tenant_member_access(p_user_id uuid, p_role text, p_is_active boolean)` returns `(user_id, role, is_active)`:
- caller: active club-admin only (re-checked after row locks are taken).
- target: a profile in the caller's tenant. Other tenants and unknown users both raise `Member not found in this club`.
- roles: `athlete`, `coach`, `club-admin` only. `platform-admin` is never a profile role.
- caller cannot change their own role or deactivate themselves.
- the last active club-admin of a tenant cannot be demoted or deactivated.
- writes: `profiles.role`, `profiles.is_active` only. Changing someone to `athlete` deletes their `team_coaches` rows in the tenant (staff assignments must not outlive the staff role). Deactivating keeps `team_coaches` so reactivating restores the same teams. `athletes` rows and all training data are never touched.

`get_tenant_member_emails()` returns `(user_id, email)`:
- active club-admin: account emails from `auth.users` for profiles in their own tenant.
- coach, athlete, deactivated admin, no profile: zero rows.

`update_current_club_admin_billing_contact(p_billing_contact_name text, p_billing_contact_email text)` returns `void`:
- caller: active club-admin only.
- validates a non-empty name (120 characters max) and a plausible email.
- writes: `billing_contact_name`, `billing_contact_email` on the latest `tenant_provision_requests` row of the caller's tenant. Refused when that row's lifecycle status is `cancelled`. Lifecycle and billing status are not changed.

`get_current_tenant_package()` returns `(requested_plan, lifecycle_status)`:
- any member of the tenant (club-admin, coach, athlete): the plan key and lifecycle status from the latest `tenant_provision_requests` row of their own tenant. Nothing else from that row is exposed.
- zero rows when the caller has no profile or the tenant has no provisioning record.
- used by package limit enforcement, because the direct `R` on `tenant_provision_requests` is limited to the original requestor and platform admins.

`complete_current_club_admin_mock_billing_setup(...)`: unchanged except that it now accepts lifecycle status `billing_failed` as well as `approved_pending_billing`, so a club sent back to billing setup after a failed attempt can retry.

### Tenant lifecycle enforcement (migration `20261005180000_tenant_lifecycle_enforcement.sql`)

Who is blocked, and what they can still reach:

| Caller | Tenant-scoped tables (teams, athletes, sessions, plans, test weeks, wellness, club profile, invites, audit...) | Still allowed |
|---|---|---|
| member with `profiles.is_active = false` | no `R`, no `C/U/D` | `R` own `profiles` row, own notifications and notification preferences, `get_current_tenant_package()` |
| any member of a `suspended` or `cancelled` club | no `R`, no `C/U/D` | the same, plus `get_current_club_admin_activation_state()` for the club admin. `get_current_tenant_package()` returns the `suspended` / `cancelled` status, which the app uses to show its "access is paused" notice |
| member of a club with any other status, or with no provisioning row | unchanged | unchanged |

Not changed by this migration (they do not use the helpers): `profiles_select_own`, `profiles_insert_self_bootstrap` (dropped later, in `20261005200000`), the public invite previews, `accept_coach_invite`, `accept_athlete_invite` and the other `security definer` functions that look the caller up in `profiles` themselves. Those functions do not check suspension, and apart from the club admin functions of `20261005140000` they do not check `is_active` either. Accepting a new invite sets the profile active again, which is how a club admin lets a deactivated person back in. From `20261005200000` only a coach invite created after the deactivation does this; an older pending invite is refused.

`tenant_package_upgrade_requests`: the two club admin policies now also require the caller's profile to be active.

Platform admin functions:

- `get_platform_tenant_sizes()` returns `(tenant_id, team_count, coach_count, athlete_count)` for every tenant. Platform admins only (`is_platform_admin()`); anyone else gets zero rows, `anon` cannot execute it. Counts only: teams that are not archived, active coach profiles, all athletes rows.
- `set_tenant_request_lifecycle_state(...)`: the caller must pass `is_platform_admin()` (same rule as every other platform function). Only approved requests, and only these moves:

  | From | To |
  |---|---|
  | `approved_pending_billing` | `billing_failed`, `cancelled` |
  | `billing_failed` | `approved_pending_billing`, `cancelled` |
  | `active_onboarding` | `active`, `suspended`, `billing_failed`, `cancelled` |
  | `active` | `suspended`, `billing_failed`, `cancelled` |
  | `suspended` | `active`, `active_onboarding`, `cancelled`, or back to `previous_lifecycle_status` |
  | `cancelled` | `approved_pending_billing`, `active` |

  A move to the current status, and a move to `active_onboarding`, `active` or `suspended` for a request with no tenant, are refused. `pending_review` is left through `review_tenant_provision_request` only.
- `review_tenant_provision_request(...)` writes a `tenant_provision_request_reviewed` platform audit event again (target = club name; metadata `status`, `to_status`, `from_status`, `lifecycle_status`, `review_notes`, `requestor_email`, `tenant_provision_request_id`).
- `update_current_club_admin_onboarding_step('complete')` moves the tenant's latest provisioning row from `active_onboarding` to `active` and writes a `tenant_request_lifecycle_updated` audit event with actor role `club-admin`. Any other current status is left alone, so repeating the call changes nothing.
- `insert_platform_audit_event(...)`: `EXECUTE` revoked from `public`, `anon` and `authenticated`. It is reached only through other `security definer` functions (and `service_role`). `platform_audit_events` has no insert policy, so there is no direct way for an API user to write an audit row.

Still open: `tenant_provision_requests_platform_admin_update` lets a platform admin update provisioning rows directly through the API, which bypasses the allowed-moves table above. The app only uses it for invite tracking columns.

### Profile bootstrap lockdown (migration `20261005200000_lock_down_profile_bootstrap.sql`)

Before this migration the policy `profiles_insert_self_bootstrap` let any signed-in user without a profile insert one for any active tenant with any role, club-admin included, and the browser seeded it from auth user metadata. That policy and `athletes_insert_self_bootstrap` are dropped. Nobody chooses their own tenant or role any more.

How a profile comes into existence now:

| Who | Path | Proof of entitlement |
|---|---|---|
| club admin, first access | `bootstrap_current_profile()` (no arguments, security definer, `authenticated` only) | confirmed account email equals `requestor_email` of an approved `tenant_provision_requests` row with a provisioned, active tenant |
| coach / club admin by invite | `accept_coach_invite(invite_id)` | pending, unexpired `coach_invites` row addressed to the caller's email |
| athlete by invite | `accept_athlete_invite(invite_id)` | pending, unexpired `athlete_invites` row addressed to the caller's email. An invite with no email (join code) only works for someone who is already an athlete of that club |
| anything else | service role only | none needed, bypasses RLS |

`bootstrap_current_profile()` returns one row `(user_id, tenant_id, role, status)`; `status` is `existing`, `created`, `invite_pending` (no profile; the invite has to be accepted through its link) or `none`. It never changes an existing profile, so it does not reactivate a deactivated member and does not help a member of a suspended club. Platform admin is never granted by any of these paths: it is a row in `platform_admin_contacts`, which no API role can write.

Also in this migration:

- `accept_coach_invite`: a deactivated member can only be reactivated by an invite created after their profile last changed. Before, any old pending invite switched access back on. Both accept functions lock the invite row and return quietly when the same user accepts the same invite twice. `anon` can no longer execute them.
- `provision_club_admin_tenant(...)`: `EXECUTE` revoked from `public`, `anon` and `authenticated` (the revoke in `20260321152000` left the default `PUBLIC` grant, so every signed-in user without a profile could create a club for themselves, skipping approval and billing). Service role only.
- `profiles` and `platform_admin_contacts`: `INSERT/UPDATE/DELETE/TRUNCATE` revoked from `public`, `anon` and `authenticated`. Reads are unchanged.

Edge functions changed alongside (not part of the migration, they deploy separately):

- `claim-coach-invite-account` and `claim-athlete-invite-account` only create a new account. They no longer set the password of an account that already exists, and they refuse an email that is a platform admin contact or the requestor of an approved club request.
- `local-preview-password-reset` answers 403 unless the project secret `ALLOW_LOCAL_PASSWORD_RESET_PREVIEW` is `true`. Never set it on a hosted project.

Still open: `is_platform_admin()` and `bootstrap_current_profile()` trust the account's email. If public sign-up is enabled without email confirmation in the project's Auth settings, a stranger can register somebody else's email before they do. Keep "Confirm email" on, or turn public sign-ups off.

### Coach team scope (migration `20261006120000_coach_team_scope.sql`)

The rule: a coach may only act on teams they are assigned to. Club admins keep full access inside their club. "Assigned" means a `team_coaches` row for that team; the lead coach is the row with `is_primary = true`, so lead counts as assigned. Before this migration every staff policy on team data asked only `is_coach_or_admin()`, so any coach of a club could read and change every team of that club.

Example: Coach Rivera coaches Sprints, Coach Smith coaches Throws. Rivera can no longer see the Throws roster, invite athletes to Throws, or read or change Throws plans, sessions, test weeks, wellness or PRs.

Helpers (all `security definer`, `stable`, `set search_path = public`, executable by `authenticated` and `service_role` only; all answer no for a deactivated member, a member of a suspended or cancelled club, and a user whose profile role is `athlete` even if a stale `team_coaches` row exists):

| Function | Answers |
|---|---|
| `is_team_coach(team_id)` | caller is an active coach assigned to this team |
| `is_coach_of_athlete(athlete_id)` | caller is an active coach assigned to the team this athlete is on now |
| `can_manage_team(team_id)` | club admin of the team's club, or `is_team_coach` |
| `can_manage_athlete(athlete_id)` | club admin of the athlete's club, or `is_coach_of_athlete` |
| `can_manage_training_plan(plan_id)` | club admin; coach assigned to the plan's team; or, for a plan with no team, the coach who created it |
| `can_manage_test_week(test_week_id)` | the same rule for a test week |
| `current_coach_team_ids()`, `current_coach_athlete_ids()` | the caller's assigned teams, and the athletes on them, as one list. The policies of the large tables read these once per statement instead of calling a function per row |
| `remove_athlete_from_team(athlete_id, team_id)` | takes an athlete off a team (`can_manage_team`). Returns `false` when nothing changed. This is how a coach removes an athlete, because a coach may not write `team_id = null` directly |
| `current_tenant_athlete_count()` | number of athletes in the caller's club, for staff only. Used for the package limit, since a coach can no longer count athletes outside their teams |

What a coach can do, by table (club admin: `R/C/U/D` in own club everywhere, unchanged; athlete: unchanged):

| Table | Coach, own assigned team(s) | Coach, any other team of the club | Notes |
|---|---|---|---|
| `teams` | `R`, `U` | `R` (name, event group) | no `C`, no `D` for coaches. Team names stay readable club wide |
| `team_coaches` | `R` own rows | none | unchanged: only club admins assign coaches |
| `athletes` | `R/C/U/D` | none | cannot move an athlete to a team they do not coach, cannot write "no team" (use `remove_athlete_from_team`). Athletes with no team: club admins only |
| `athlete_invites` | `R/C/U/D` | none | athletes keep a club-wide read (join by code looks an invite up by id) |
| `sessions`, `session_blocks`, `session_block_rows`, `session_completions` | `R/C/U/D` | none | scope follows the athlete's current team |
| `session_row_logs` | `R` | none | |
| `wellness_entries`, `pr_records`, `test_results` | `R/C/U/D` | none | scope follows the athlete's current team |
| `training_plans`, weeks, days, blocks | `R/C/U/D` | none | also own plans with no team. A plan cannot be moved to a team the coach is not assigned to |
| `training_plan_assignments` | `R/C/U/D` | none | target team or athlete must also be theirs |
| `test_weeks`, `test_definitions` | `R/C/U/D` | none | also own test weeks with no team |

A coach with no team assignment gets zero rows from all of the above (no error) and can still read team names, their own profile and the club profile. The coach dashboard and the Teams page say "You are not assigned to a team yet".

Scope follows where the athlete is now. When a club admin moves an athlete from Throws to Sprints, the athlete's history (sessions, results, wellness, PRs) becomes visible to the Sprints coaches and stops being visible to the Throws coaches.

Deliberately still club wide for coaches (not changed by this migration): `teams` read, `profiles` read (`profiles_select_tenant_for_staff`: names and roles of club members), `audit_events` read (`audit_events_select_staff`), `club_profiles` and `billing_profiles` read.

Left as it was for athletes: `training_plans_select_tenant` (every plan of the club that is not a draft), `test_weeks_select_tenant` (every test week of the club) and `athlete_invites_select_tenant` (every athlete invite of the club, invited email included).

### Invite email delivery (migration `20261006090000_invite_email_delivery.sql`)

Coach and athlete invites are emailed by the `send-invite-email` edge function. The migration adds four columns to both `coach_invites` and `athlete_invites`: `last_email_attempt_at`, `last_email_sent_at`, `email_send_count`, `last_email_error` (a short machine code, never the provider's message).

No policy is added or changed.

| | Read the four columns | Write the four columns |
|---|---|---|
| `coach_invites` | club admins of the club (`coach_invites_staff_all`), as before | service role only |
| `athlete_invites` | athletes and club admins of the club, and coaches assigned to the invite's team (`athlete_invites_select_tenant`, narrowed for coaches in `20261006120000`) | service role only |
| anon, other clubs | no rows | no |

- The existing "staff all" policies would let a club admin or coach update any column, including the send counter. The trigger `protect_invite_email_delivery_columns` (before insert or update, security invoker) keeps the four columns unchanged whenever the statement runs as `authenticated` or `anon`, so the resend limit cannot be reset from the API. Every other column behaves as before (revoke still works).
- `get_public_coach_invite` / `get_public_athlete_invite` list their columns explicitly, so someone holding an invite link does not see delivery state.
- Who may send: the function asks the database, as the caller, `current_tenant_id()`, `is_club_admin()` and, for an athlete invite sent by someone who is not a club admin, `is_team_coach(invite.team_id)`, which are the checks in the insert policies. Coach invite: club admin of the invite's club. Athlete invite: club admin of the invite's club, or a coach assigned to the invite's team (any coach of the club until `20261006120000`). A deactivated member or a member of a suspended club is refused. A missing invite, another club's invite and an invite of a team the coach is not assigned to get the same `not_allowed` answer. If `is_team_coach` cannot be called (the migration has not run yet) a coach is refused.
- Limits: one email per invite per 60 seconds, at most 5 per invite, taken with one conditional update so two simultaneous requests send one email.
- Each send writes a tenant `audit_events` row (`coach_invite_email_sent`, `coach_invite_email_resent`, `coach_invite_email_failed` and the `athlete_` equivalents) with the inviter as actor and the invited email as target.
- No double emails: the invite triggers queue only `in-app` notification events when an invite is created, so `dispatch-notification-emails` has nothing to send for it.

## Service-Role Only Operations (Documented)

These are intentionally not available to regular authenticated users:
- Tenant creation
- Profile creation outside the three paths in "Profile bootstrap lockdown" (invite acceptance, club admin first access), and any direct role assignment
- `provision_club_admin_tenant` (self-serve club creation)
- Cross-tenant admin jobs
- Backfill/migration scripts

## Security Constraints Enforced by Matrix

- Tenant boundary is always checked on tenant-scoped tables.
- Athlete can never read or write other athletes' rows.
- Coaches and club-admins operate only within current tenant.
- A coach operates only on teams they are assigned to, and on athletes currently on those teams. Club admins operate on the whole club.
- Cross-tenant access is blocked even for coach/admin roles.

## Review Checklist

- [x] Each W1-W3 table mapped to role access rules
- [x] Tenant isolation strategy is explicit
- [x] Write restrictions are explicit
- [x] Service-role-only operations are identified


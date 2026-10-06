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
- `supabase/migrations/20261006150000_athlete_read_scope.sql` (athletes only read what their own screens show; see "Athlete read scope" below, which is the current rule for every athlete line in this document)

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

- athlete: `R` only the team they are on (from `20261006150000`). No team: no rows
- coach: `R` tenant teams (names are club wide). `U` only teams they are assigned to. No `C`, no `D` (from `20261006120000`)
- club-admin: `R/C/U/D` tenant teams. `D` is refused with a plain message while the team still has athletes, training plans, plan assignments or test weeks (trigger `prevent_delete_of_team_in_use`, from `20261006150000`); the app offers Archive instead

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

- athlete: `R` only their own team's weeks that are `published` or `closed` and not archived, plus any week in which they already have a result of their own (from `20261006150000`). Never a draft of their team, never another team's week
- coach: `R/C/U/D` test weeks of their assigned teams, plus test weeks with no team that they created (from `20261006120000`)
- club-admin: `R/C/U/D` tenant test weeks

### `test_definitions`

- athlete: `R` definitions of the test weeks they can read (above)
- coach: `R/C/U/D` definitions of the test weeks above
- club-admin: `R/C/U/D` definitions for tenant test weeks

### `test_results`

- athlete:
  - `R` own results only
  - `C/U` own results only, and only while the week is open: it belongs to their current team, `status = 'published'`, not archived, start date reached, and the test belongs to that week (`athlete_can_enter_test_result`, from `20261006150000`). No cut-off at the end date: late entries are accepted until the coach closes the week
  - `D` not allowed
- coach: `R/C/U/D` results of athletes on their assigned teams
- club-admin: `R/C/U/D` tenant test results

### `training_plans`

- athlete: `R` only plans that are `published` AND assigned to them or to their current team (from `20261006150000`). Drafts, archived plans, unassigned plans, other teams' plans and plans assigned only to a teammate are not visible
- coach: `R/C/U/D` plans of their assigned teams (drafts included), plus plans with no team that they created (from `20261006120000`). Other teams' plans are not readable
- club-admin: `R/C/U/D` tenant plans, including drafts

### `training_plan_weeks`, `training_plan_days`, `training_plan_blocks`

- athlete: `R` structure of the plans they can read (above)
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
- athlete: `C` only for their own athlete row, only with `status = 'scheduled'` and a plan slot (`plan_id`, `plan_week_number`, `plan_day_index`) pointing at a published plan that is assigned to them or to their team (any published plan of the club until `20261006150000`); blocks and rows only under such a session while it is still `scheduled`. This covers athletes who joined after the plan was published. Athletes still cannot update or delete sessions.
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
| `athlete_invites` | `R/C/U/D` | none | athletes read only invites addressed to their own email (from `20261006150000`) |
| `sessions`, `session_blocks`, `session_block_rows`, `session_completions` | `R/C/U/D` | none | scope follows the athlete's current team |
| `session_row_logs` | `R` | none | |
| `wellness_entries`, `pr_records`, `test_results` | `R/C/U/D` | none | scope follows the athlete's current team |
| `training_plans`, weeks, days, blocks | `R/C/U/D` | none | also own plans with no team. A plan cannot be moved to a team the coach is not assigned to |
| `training_plan_assignments` | `R/C/U/D` | none | target team or athlete must also be theirs |
| `test_weeks`, `test_definitions` | `R/C/U/D` | none | also own test weeks with no team |

A coach with no team assignment gets zero rows from all of the above (no error) and can still read team names, their own profile and the club profile. The coach dashboard and the Teams page say "You are not assigned to a team yet".

Scope follows where the athlete is now. When a club admin moves an athlete from Throws to Sprints, the athlete's history (sessions, results, wellness, PRs) becomes visible to the Sprints coaches and stops being visible to the Throws coaches.

Deliberately still club wide for coaches (not changed by this migration): `teams` read, `profiles` read (`profiles_select_tenant_for_staff`: names and roles of club members), `audit_events` read (`audit_events_select_staff`), `club_profiles` and `billing_profiles` read.

Left as it was for athletes by this migration, and closed by `20261006150000` (see "Athlete read scope"): `training_plans_select_tenant`, `test_weeks_select_tenant` and `athlete_invites_select_tenant`.

### Athlete read scope (migration `20261006150000_athlete_read_scope.sql`)

Before this migration an athlete could read, through the database API, far more than their screens show: every athlete invite of the club (invited email addresses included), every published or archived plan with its weeks, days and blocks, every test week and test of every team (drafts included), every team name and the club's billing profile. They could also write a result of their own into a draft, closed, archived, not yet started or other team's test week, attach it to a test from a different week, create sessions for themselves from any published plan of the club, and write rows into the club's audit log.

Coaches, club admins and platform admins: no change in what they can do.

Helpers (all `security definer`, `stable`, `set search_path = public`, executable by `authenticated` and `service_role` only). They answer null / empty for anyone who is not an active athlete of an open club, so a deactivated athlete or an athlete of a suspended or cancelled club reads nothing through them:

| Function | Answers |
|---|---|
| `current_athlete_id()` | the caller's own `athletes` row |
| `current_athlete_team_id()` | the team that athlete is on now (null when none) |
| `current_athlete_email()` | the caller's email from `auth.users`, lower-cased and trimmed |
| `current_athlete_plan_ids()` | published plans assigned to the caller or to their current team |
| `current_athlete_plan_week_ids()`, `current_athlete_plan_day_ids()` | the weeks and days of those plans |
| `current_athlete_test_week_ids()` | the test weeks the caller may read (rule below) |
| `athlete_can_enter_test_result(test_week_id, test_definition_id, athlete_id)` | the caller may add or change this result now (rule below) |
| `get_athlete_invite_preview(invite_id)` | for the join screen: team name, event group, status, expiry and whether the invite is usable by the caller, for an invite of the caller's own club. Never the invited email address |

What an athlete can read and write now:

| Table | Athlete | Notes |
|---|---|---|
| `athletes`, `profiles` | `R` own row | unchanged. No teammate rows: no athlete screen lists teammates |
| `teams` | `R` own team | coach names still come from `get_current_athlete_team_context()` |
| `team_coaches`, `coach_invites`, `audit_events` | none | `audit_events` insert is now staff only (an athlete could forge audit rows before). Invite acceptance writes its audit row inside a security definer function |
| `athlete_invites` | `R` invites addressed to their own email | the join screen calls `get_athlete_invite_preview()`; accepting still goes through `accept_athlete_invite()` |
| `training_plans` | `R` published and assigned to them or their team | |
| `training_plan_weeks`, `_days`, `_blocks` | `R` for those plans | the `*_select_tenant` policies now hold the athlete rule only; staff read through `*_staff_all`, which accepts the same plans as before |
| `training_plan_assignments` | `R` own and own team's rows | unchanged |
| `test_weeks`, `test_definitions` | `R` own team's published or closed, not archived weeks, plus weeks holding a result of their own | the second part keeps the names of their own past results after a coach archives a week or after they change team |
| `test_results` | `R` own. `C/U` own, only while the week is open | see "open" below |
| `sessions` (+ blocks, rows) | `R` own. `C` from a published plan assigned to them or their team | late joiner creating the day's session |
| `session_row_logs`, `session_completions`, `wellness_entries`, `pr_records`, notifications | own rows | unchanged |
| `billing_profiles` | none | read is now coach and club admin only |
| `club_profiles`, `tenants` | `R` own club | unchanged (club name, colours, season dates) |

"Open" for entering test results: the week belongs to the athlete's current team, `status = 'published'`, `is_archived = false`, and `start_date` has been reached (one day of slack, because the database compares in UTC and the app in the athlete's local date). There is deliberately no cut-off at `end_date`: the athlete screen has always accepted late entries in a week that is still published, and a coach who wants entries to stop closes the week (status `closed`) or archives it. Results in a closed or archived week stay readable and cannot be changed by the athlete; coaches and club admins can still enter or correct them. A refused save reaches the athlete as "this test week is not open for your team right now".

Scope follows where the athlete is now. After moving from Sprints to Throws an athlete sees the Throws team, the plans assigned to Throws (and plans assigned to them personally) and the Throws test weeks. Their own sessions, results, wellness and PRs stay theirs.

Not changed, and worth knowing: `get_public_athlete_invite(invite_id)` and `get_public_coach_invite(invite_id)` are callable without signing in and return the invited email address to anyone who holds the invite link (the claim page needs it to pre-fill the form). `training_plan_assignments.visibility_date` (a plan assigned now but scheduled to appear later) is applied by the app, not by the database. Any club member can insert an `account_requests` row for their own club.

Also in this migration:
- `team_coaches_modify_admin`: a club admin can no longer insert a row pointing at another club's team.
- Deleting a team that still has athletes, training plans, plan assignments or test weeks is refused with "This team still has athletes, training plans or test weeks, so it cannot be deleted. Archive the team instead." (it used to fail with a raw constraint error when a team-wide plan assignment existed, and silently left athletes and plans without a team otherwise). An empty team can still be deleted.
- `training_plan_weeks_staff_all`, `training_plan_days_staff_all`, `training_plan_blocks_staff_all` and `test_definitions_staff_all` start with `(select is_coach_or_admin())`. Same rule for staff; it spares athletes a per-row function call.

### Invite email delivery (migration `20261006090000_invite_email_delivery.sql`)

Coach and athlete invites are emailed by the `send-invite-email` edge function. The migration adds four columns to both `coach_invites` and `athlete_invites`: `last_email_attempt_at`, `last_email_sent_at`, `email_send_count`, `last_email_error` (a short machine code, never the provider's message).

No policy is added or changed.

| | Read the four columns | Write the four columns |
|---|---|---|
| `coach_invites` | club admins of the club (`coach_invites_staff_all`), as before | service role only |
| `athlete_invites` | club admins of the club, coaches assigned to the invite's team, and the athlete the invite is addressed to (`athlete_invites_select_tenant`, narrowed for coaches in `20261006120000` and for athletes in `20261006150000`) | service role only |
| anon, other clubs | no rows | no |

- The existing "staff all" policies would let a club admin or coach update any column, including the send counter. The trigger `protect_invite_email_delivery_columns` (before insert or update, security invoker) keeps the four columns unchanged whenever the statement runs as `authenticated` or `anon`, so the resend limit cannot be reset from the API. Every other column behaves as before (revoke still works).
- `get_public_coach_invite` / `get_public_athlete_invite` list their columns explicitly, so someone holding an invite link does not see delivery state.
- Who may send: the function asks the database, as the caller, `current_tenant_id()`, `is_club_admin()` and, for an athlete invite sent by someone who is not a club admin, `is_team_coach(invite.team_id)`, which are the checks in the insert policies. Coach invite: club admin of the invite's club. Athlete invite: club admin of the invite's club, or a coach assigned to the invite's team (any coach of the club until `20261006120000`). A deactivated member or a member of a suspended club is refused. A missing invite, another club's invite and an invite of a team the coach is not assigned to get the same `not_allowed` answer. If `is_team_coach` cannot be called (the migration has not run yet) a coach is refused.
- Limits: one email per invite per 60 seconds, at most 5 per invite, taken with one conditional update so two simultaneous requests send one email.
- Each send writes a tenant `audit_events` row (`coach_invite_email_sent`, `coach_invite_email_resent`, `coach_invite_email_failed` and the `athlete_` equivalents) with the inviter as actor and the invited email as target.
- No double emails: the invite triggers queue only `in-app` notification events when an invite is created, so `dispatch-notification-emails` has nothing to send for it.

### Security definer functions respect lifecycle (migration `20261006180000_definer_functions_respect_lifecycle.sql`)

`20261005180000` closed the tables to a deactivated member and to everyone in a suspended or cancelled club. Security definer functions do not go through row policies, and the ones that looked the caller up in `profiles` themselves stayed open. This migration closes them. It supersedes the "not changed, because it does not use these helpers" notes in the two sections above for the functions listed here.

One definition of "active member": `current_tenant_id()` returns a tenant (signed in, profile active, the club's latest provisioning record not `suspended` / `cancelled`; a club with no record counts as open). The guard functions only wrap it:

| Function | Who can call it | What it does |
|---|---|---|
| `caller_is_active_member()` | authenticated, service role | `current_tenant_id() is not null` |
| `assert_caller_active()` | internal only | raises the refusal below for a signed-in user who has a profile and is not an active member. Returns for a call with no session (service role, triggers) and for a signed-in user with no profile (platform admin, brand new account), who are then handled by the function's own checks exactly as before |
| `raise_access_paused()` | internal only | the one refusal: SQLSTATE `42501`, hint `access_paused`, message "Your access is paused. ..." |
| `tenant_access_blocked(tenant_id)` | service role, internal | the same suspended / cancelled rule for a given club, for callers that have no profile yet (invite acceptance, the account-creating edge functions) |

Every security definer function, who may call it, how it knows the caller, and what a deactivated member or a member of a suspended / cancelled club gets. "Helpers" means it decides through `current_tenant_id()`, `is_club_admin()`, `is_coach_or_admin()`, `is_team_coach()`, `is_coach_of_athlete()` or `current_athlete_id()`, which already answered NULL / false for them. All of this was run on a throwaway Postgres 16 as 24 different callers, before and after the migration.

| Function(s) | Callable by | Identifies caller by | Blocked member before | Now |
|---|---|---|---|---|
| `current_tenant_id`, `current_app_role`, `is_club_admin`, `is_coach_or_admin`, `is_team_coach`, `is_coach_of_athlete`, `current_athlete_id`, `current_coach_team_ids` | anon / authenticated | own profile lookup with the lifecycle rule | NULL / false / empty | unchanged |
| `can_manage_team`, `can_manage_athlete`, `can_manage_test_week`, `can_manage_training_plan`, `athlete_can_enter_test_result`, `current_athlete_team_id`, `current_athlete_email`, `current_athlete_plan_ids`, `current_athlete_plan_week_ids`, `current_athlete_plan_day_ids`, `current_athlete_test_week_ids`, `current_coach_athlete_ids`, `current_tenant_athlete_count`, `get_athlete_invite_preview`, `remove_athlete_from_team` | authenticated | helpers | false / empty | unchanged |
| `update_current_athlete_profile` | authenticated | profile lookup, no lifecycle check | **could rewrite own name, date of birth, events** | refused |
| `complete_current_athlete_onboarding`, `complete_current_coach_onboarding`, `set_current_athlete_setup_guide_dismissed`, `set_current_coach_setup_guide_dismissed` | authenticated (were also anon) | profile lookup, no lifecycle check | **could write own profile** | refused |
| `get_current_athlete_team_context` | authenticated (was also anon) | athlete row by `auth.uid()` | **returned team, club and coach names** | no row |
| `set_tenant_member_access` | authenticated | profile lookup, checked `is_active` only | **admin of a suspended / cancelled club could deactivate, restore and re-role every member** | refused |
| `get_tenant_member_emails` | authenticated | profile lookup, checked `is_active` only | **admin of a suspended / cancelled club got every member's email** | no rows |
| `update_current_club_admin_billing_contact` | authenticated | profile lookup, `is_active` and not cancelled | **admin of a suspended club could change it** | refused |
| `update_current_club_admin_onboarding_step` | authenticated (was also anon) | profile lookup, no lifecycle check | **deactivated admin, or admin of a suspended / cancelled club, could move the setup step** | refused |
| `submit_tenant_package_upgrade_request` | authenticated (was also anon) | profile lookup, no lifecycle check | **same callers could file a request and write an audit row** | refused |
| `complete_current_club_admin_mock_billing_setup` | authenticated (was also anon) | profile lookup, no `is_active` check | **deactivated admin of a club awaiting billing could complete billing and activate the club** | refused. Still works for the active admin of an `approved_pending_billing` or `billing_failed` club |
| `accept_athlete_invite` | authenticated | `auth.users` email + invite | **invite of a suspended / cancelled club accepted; a deactivated athlete could use a join code to change team** | refused. New user and active athlete unchanged |
| `accept_coach_invite` | authenticated | `auth.users` email + invite | **invite of a suspended / cancelled club accepted** (stale invite for a deactivated member was already refused) | refused. New user, and a deactivated member with an invite created after the deactivation, unchanged |
| `get_current_club_admin_activation_state` | authenticated (was also anon) | profile lookup | returned lifecycle status and billing contact | still returns `lifecycle_status` (the route guard needs it); billing fields and setup step are NULL for a blocked caller |
| `get_current_tenant_package` | authenticated | profile lookup | package + lifecycle status of own club | unchanged on purpose: the "access paused" page reads it |
| `bootstrap_current_profile` | authenticated | profile, else `auth.users` email | returns own profile (user, club, role) | unchanged on purpose: sign-in needs it to know who the user is before it can show the notice |
| `get_public_coach_invite`, `get_public_athlete_invite` | anon | invite id only | public preview | unchanged (public) |
| `submit_tenant_provision_request` | anon | nobody (public form) | public | see the next section |
| `submit_account_request` | was anon + authenticated | nobody | public | service role only, see the next section |
| `is_platform_admin`, `get_platform_tenant_sizes`, `approve_and_provision_tenant_request`, `review_tenant_provision_request`, `review_tenant_package_upgrade_request`, `set_tenant_request_lifecycle_state`, `log_platform_admin_export` | authenticated (some were also anon) | `platform_admin_contacts` by user id or email | refused / empty for anyone who is not a platform admin | unchanged. Platform admins have no profile and are never guarded |
| `notification_channel_enabled` | was anon + authenticated | arguments | **told anyone whether any user or email had notifications switched off** | service role only (the notification trigger runs as the owner) |
| `is_active_tenant` | anon / authenticated | argument | true / false for a tenant id | unchanged (answers only "is this id an active club") |
| `insert_platform_audit_event`, `provision_club_admin_tenant` | service role | arguments | not callable | unchanged |
| trigger functions: `enqueue_coach_invite_notifications`, `enqueue_athlete_invite_notifications`, `enqueue_training_plan_assignment_notifications`, `enqueue_test_week_published_notifications`, `sync_user_notification_from_event`, `mark_session_in_progress_from_log`, `mark_session_completed_from_completion`, `prevent_delete_of_team_in_use` | not callable through the API | the row being written | run only when a row policy already let the write through | unchanged, never guarded |

Also changed:
- `tenant_package_upgrade_requests_club_admin_select` / `_insert` now use `is_club_admin()` and `current_tenant_id()`. Before, the admin of a suspended or cancelled club could still read the club's package requests and insert one directly.
- `anon` lost `EXECUTE` on the member-only and platform-admin-only functions it had only by default. Each already refused a caller with no session.

What a blocked person can still do, on purpose: read their own `profiles` row (`profiles_select_own`), call `bootstrap_current_profile()`, `get_current_tenant_package()` and (club admin) `get_current_club_admin_activation_state()`, read their own notifications and notification preferences, open a public invite preview, and use the public club request form. Nothing else. A club admin of a suspended or cancelled club is refused by `set_tenant_member_access`, both billing functions, the onboarding step, package requests, member emails, invite creation (row policies) and invite emails (`send-invite-email`).

Edge functions:

| Function | Who can call it | How it knows the caller | Deactivated member / suspended or cancelled club |
|---|---|---|---|
| `send-invite-email` | signed-in member | asks the database, as the caller, `current_tenant_id()`, `is_club_admin()`, `is_team_coach()` | refused with `not_allowed` (already the case, covered by a handler test) |
| `claim-coach-invite-account`, `claim-athlete-invite-account` | anyone with an invite id | nobody; checks the invite and the email | now refuses (`403`, code `access_paused`) when the invite's club is suspended or cancelled, through `tenant_access_blocked`. If that check cannot be made the account is created as before; joining the club is still decided by `accept_*_invite` |
| `platform-admin-send-club-admin-invite`, `platform-admin-preview-club-admin-invite` | signed-in platform admin | reads `platform_admin_contacts` as the caller | not applicable: platform admins have no club |
| `dispatch-notification-emails` | the database scheduler, a platform admin, or an active member for their own club's queue | see "Notifications that reach people" below | a deactivated member and a member of a suspended or cancelled club are refused |
| `local-preview-password-reset` | anyone, only when `ALLOW_LOCAL_PASSWORD_RESET_PREVIEW=true` | nobody | off on hosted projects, unchanged |

### Public request form protection (migration `20261006181000_request_form_protection.sql`)

`submit_tenant_provision_request` is the only write the API offers to visitors who are not signed in. There is now one version of it (the six-argument and thirteen-argument ones are dropped).

| Protection | Rule | What the caller sees |
|---|---|---|
| Honeypot (`p_reference_code`) | any text in the hidden field | success and a made-up id; nothing is stored, no notification, no audit event |
| Minimum fill time (`p_fill_ms`) | reported and below 2,500 ms | the same silent drop. The page itself waits until 3 seconds have passed before sending |
| Per email | 3 accepted requests per 24 hours; `name+tag@host` counts as `name@host` | `PT429` (HTTP 429), "Too many requests. Try again later." |
| Per network address | 5 accepted requests per 24 hours; IPv6 counted per /64; skipped when no address is known | the same |
| Everyone together | 30 accepted requests per hour and 150 per 24 hours | the same |
| Duplicate | same club name and email already pending | "A pending request already exists ..." (unchanged) |
| Validation | email shape and 254 characters; name and club name 160; job title and region 120; type 80; website empty or `http(s)://host.tld...` up to 300; notes 1,000; head counts 0 to 100,000; start date from 31 days ago to 5 years ahead; no control characters | a message per rule, mapped to a plain sentence in `src/lib/auth-errors.ts` |

- The limits are columns of the single row in `request_form_settings`; change one with an `update` in the SQL editor. The same row holds a random salt generated by the migration.
- `request_form_attempts` holds one row per accepted request: a salted SHA-256 of the email and of the network address, and a timestamp. No raw IP is stored anywhere. Rows older than the longest window are deleted by the function on the next call.
- Both tables have RLS enabled, no policies, and no privileges for `anon` / `authenticated`.
- The network address comes from the request headers PostgREST exposes: `cf-connecting-ip`, then `x-real-ip`, then the first entry of `x-forwarded-for`. The last one can be forged by the sender, so the per-address limit is a speed bump; the per-email and global limits do not depend on it.
- Who is emailed: only the platform admins, once per accepted request. The requester is emailed once, later, when a platform admin approves or declines.

| Table / function | Before | Now |
|---|---|---|
| `submit_account_request(...)` | anyone, signed in or not, could add a request to any club by its name | service role only. No screen calls it |
| `account_requests` insert (`account_requests_insert_authenticated`) | any member could insert a request for their own club | policy dropped. Club admins still read and review through `account_requests_staff_all` |
| every other table | no policy for `anon` | unchanged; an anon insert was tried on all 35 tables and refused |

### Account basics and profile photos (migration `20261007100000_account_basics_and_avatars.sql`)

Photos live in the Storage bucket `avatars` (public, 2 MB limit, JPEG/PNG/WebP only) under `<user id>/<random>.jpg`. The bucket is public on purpose: rosters show many photos, and a private bucket needs a signed URL per photo that expires. The address cannot be guessed, the bucket cannot be listed, and the path is only handed out by `get_visible_avatars()`. Someone who was once given an address can open that one image until the owner replaces or removes the photo (the file is deleted). The reasoning is written out at the top of the migration.

| Table / function | athlete | coach | club-admin | platform admin | Notes |
|---|---|---|---|---|---|
| `account_avatars` select (`account_avatars_select_own`) | own row | own row | own row | own row | no insert/update/delete policy and no write privilege for any API role |
| `storage.objects` in `avatars`: insert, update, delete (`avatars_insert_own`, `avatars_update_own`, `avatars_delete_own`) | own folder | own folder | own folder | own folder | name must be `<own user id>/<8 to 64 url-safe chars>.<jpg\|png\|webp>`; refused for a deactivated member, a member of a suspended or cancelled club, and an account with neither a profile nor a platform admin contact |
| `storage.objects` in `avatars`: select (`avatars_select_own`) | own folder | own folder | own folder | own folder | needed by the storage API to remove or overwrite; reading through the public address does not use policies |
| `set_current_avatar(path)` | own | own | own | own | path must be in the caller's own folder (or null to remove) and the file must exist; returns the previous path; raises `access_paused` |
| `update_current_display_name(name)` | refused (uses `update_current_athlete_profile`) | own | own | own (`platform_admin_contacts.display_name`) | raises `access_paused` |
| `get_current_account()` | own | own | own | own | answers a deactivated member too (their own row) |
| `get_visible_avatars()` | own, and the coaches of their current team | own, and athletes on the teams they coach | everyone in their club | own | no rows when access is paused; other clubs never |

`profiles` is not widened: the photo path is deliberately not a column on `profiles`, because `profiles_select_tenant_for_staff` lets every coach read every profile row of the club.

Email changes. The app lets a signed-in user ask for a new email (`supabase.auth.updateUser({ email })`). Supabase keeps the old address in `auth.users.email` until the link sent to the new address is opened, so asking for someone else's address gives nothing. On top of that, every function that matches a person by email now requires `email_confirmed_at`:

| Function | Before | Now |
|---|---|---|
| `bootstrap_current_profile()` | confirmed email only | unchanged |
| `accept_coach_invite`, `accept_athlete_invite` | read `auth.users.email` without checking it was confirmed | an unconfirmed address matches no invite (team join codes, which are not addressed, still work for an existing athlete) |
| `current_athlete_email()`, `get_athlete_invite_preview()` | same | same fix |
| `platform_admin_contacts` | kept the old address after an email change | email-only rows are linked to their account (`user_id`) by the migration; a trigger on `auth.users` (`sync_platform_admin_contact_email`) moves the contact's email with the account |

Required project setting: Authentication, Sign In / Providers, Email: "Confirm email" must stay ON (and "Secure email change" is recommended). With it off, Supabase changes the address at once with no proof of ownership, and no database rule can tell the difference.

Not following an email change (copies, by design): the club's billing contact email (`billing_contact_email`; the club admin edits it in Billing), `tenant_provision_requests.requestor_email` (history of who asked), `coach_invites.email` / `athlete_invites.email` (a pending invite to the old address can no longer be accepted by that account; send a new one), and notification rows and preferences stored by email address.

### Notifications that reach people (migration `20261007090000_notifications_delivery.sql`)

No row policy changes. A person reads and marks read only their own notifications, exactly as before (`user_notifications_select_self`, `user_notifications_update_self`, `notification_events_select_self`); a member cannot insert a notification for anyone. Checked for athlete, coach and club admin on a throwaway Postgres 16.

Who can be told (decided in one function, `enqueue_notification`, and its in-app twin `enqueue_rollup_notification`):

| Rule | How it is enforced |
|---|---|
| never the person who did the thing | `auth.uid()` of the write that fired the trigger is skipped |
| only an active member of the club the event belongs to | the recipient must have a `profiles` row in that club with `is_active` |
| nobody in a suspended or cancelled club | `tenant_access_blocked(club)`; the one exception is `club_suspended` itself |
| a coach only for their own teams | recipients come from `team_coaches` for the athlete's (or the test week's) team, the same rows `is_team_coach()` reads. A coach on no team, or on another team, is never a recipient |
| never another club | every recipient list is built from rows with the event's `tenant_id` |
| a channel the person switched off | `notification_channel_enabled`: whole channel off wins, then their choice for that kind of update, then the default (`notification_default_enabled`) |
| the same thing twice | a dedupe key per subject and a time window, under an advisory lock, so two writes at the same moment still produce one notification |
| a failed notification never undoes the write | both functions catch every error and return 0 |

The email queue re-checks at delivery time (`claim_notification_emails`), because things change between queueing and sending: a recipient who was deactivated, a club that was suspended, an email switched off, or an email older than 72 hours is marked `suppressed` with the reason in `last_error` and is never sent.

| Function | Callable by | Notes |
|---|---|---|
| `notification_default_enabled(text, text)` | authenticated, service role | a constant table of defaults, no data |
| `notification_channel_enabled(text, text, uuid, text)` | service role | unchanged grant (it would tell anyone whether someone switched notifications off) |
| `enqueue_notification`, `enqueue_rollup_notification`, `notify_training_plan_audience`, `notification_team_coach_user_ids`, `notification_club_admin_user_ids`, `notification_athlete_name`, `notification_date_label`, `notification_email_max_age`, `request_notification_email_dispatch`, every `enqueue_*` trigger function, `notification_events_request_dispatch` | nobody through the API | called by triggers, which run as the owner |
| `claim_notification_emails`, `complete_notification_email`, `notification_email_queue_due`, `verify_notification_scheduler_token`, `register_notification_dispatch_url`, `record_notification_dispatch_run` | service role | used only by `dispatch-notification-emails` |
| `get_platform_notification_email_stats()` | authenticated | returns counts to a platform admin and no rows to anyone else |
| table `notification_dispatch_config` | nobody through the API | row level security on, no policies, grants revoked from `anon` and `authenticated`. Holds the scheduler token |

Edge function `dispatch-notification-emails` (rewritten, `verify_jwt = false`, it verifies the caller itself):

| Caller | How it knows | What it may do |
|---|---|---|
| the database scheduler | header `x-sktr-scheduler-token`, checked by `verify_notification_scheduler_token` | send everything that is due |
| the deploy workflow | the service role key as bearer | the same |
| signed-in platform admin | reads `platform_admin_contacts` as the caller | send everything, including rows waiting for a retry; gets recipients and links back |
| signed-in active member | `current_tenant_id()` asked as the caller | send only their own club's queue; gets counts back, no names |
| deactivated member, member of a suspended or cancelled club, signed-in user with no club | `current_tenant_id()` is NULL | refused (`403 not_allowed`) |
| anyone else, or a wrong scheduler token | | refused (`401`) |

Every link in an email is built from the server-side `PUBLIC_APP_URL` and a path derived from the event type and ids; nothing a caller sends and nothing a person typed becomes a link or markup.

Realtime: `user_notifications` is in the `supabase_realtime` publication. Realtime applies the table's row policies, so a subscriber only receives their own rows.

### Pain reports, private athlete details, coach contact, leaving a team (migration `20261008110000_pain_reports_and_athlete_profile_fields.sql`)

Health and private information, some of it about minors. Both tables are separate from `athletes` on purpose: `athletes.*` is readable by staff through row policies written for the roster, and a row policy cannot hide columns.

| Table | Athlete (own rows) | Coach of the athlete's current team | Coach of another team | Club admin (own club) | Other athlete, other club, platform admin, signed out, paused member |
|---|---|---|---|---|---|
| `pain_reports` | select; insert; update of `body_areas`, `severity`, `started_on`, `training_impact`, `note`, `status` (column grants) | select | nothing | select | nothing |
| `athlete_private_details` | select; write only through `update_current_athlete_private_details()` | select | nothing | select | nothing |
| `coach_contact_settings` | nothing (athletes get the email through the function below, only when it is on) | own row: select; write only through `set_current_coach_contact_visibility()` | own row only | own row only | nothing |

- Policies: `pain_reports_select_own_or_team_staff`, `pain_reports_insert_own`, `pain_reports_update_own`, `athlete_private_details_select_own_or_team_staff`, `coach_contact_settings_select_own`. They use `current_tenant_id()`, `current_athlete_id()`, `current_coach_athlete_ids()` and `is_club_admin()`, so a deactivated member and a member of a suspended or cancelled club read and write nothing.
- "Current team" is literal: when an athlete leaves or is moved, the old team's coaches stop reading both tables at once and the new team's coaches start.
- Nobody can delete a pain report (no policy, no privilege). The athlete resolves it. A trigger keeps `tenant_id`, `athlete_id` and `reported_by_user_id` fixed after insert.
- Nothing from either table is written to `audit_events`. The `athlete_pain_reported` notification says that a report exists and names the athlete; it never carries body area, severity or note.

| Function | Callable by | Guard | Notes |
|---|---|---|---|
| `update_current_athlete_private_details(...)` | authenticated | `assert_caller_active()`, athlete role | upserts the caller's own row; validates lengths, height, weight, phone and email shapes |
| `set_current_coach_contact_visibility(boolean)` | authenticated | `assert_caller_active()`, coach or club admin role | caller's own row; default is off |
| `get_current_athlete_team_coaches()` | authenticated | returns no rows unless the caller is an active athlete with a team | name, lead flag, photo path; the coach's confirmed email only when that coach switched it on |
| `leave_current_athlete_team()` | authenticated | `assert_caller_active()`, athlete role | sets the caller's `team_id` to null, writes audit event `athlete_leave_team` (team id only), queues `athlete_left_team` for the team's coaches |
| `contact_phone_is_valid(text)`, `contact_email_is_valid(text)` | authenticated, service role | none needed | pure checks, no data |
| `pain_reports_before_write()`, `enqueue_pain_report_notifications()` | nobody (triggers) | | |

Notifications: `athlete_pain_reported` goes to the coaches of the athlete's current team when an open report says training is modified or not possible (in-app; email off unless the coach switches it on). `athlete_left_team` goes to the coaches of the team that was left (in-app and email). Club admins are not notified of either. `notification_default_enabled` is replaced with the same list plus `athlete_pain_reported`.

Known edge: a plan assigned to the athlete by name (not through the team) stays readable to them after they leave, because `current_athlete_plan_ids()` (20261006150000) is unchanged.

### Skip a session, athlete availability, sessions added by the athlete (migration `20261008090000_session_skip_availability_extra.sql`)

What changed for each role. Everything not listed is unchanged.

| Object | Athlete | Coach | Club admin | Other club, anon |
|---|---|---|---|---|
| `sessions` insert, planned (`sessions_insert_own_from_plan`, tightened) | As before (own, published plan assigned to them), and now `origin` must be `plan` | unchanged (`sessions_modify_tenant_staff`) | unchanged | none |
| `sessions` insert, added by athlete (`sessions_insert_own_extra`, new) | Own row only: `origin = 'athlete'`, status `scheduled`, no plan slot, no coach note, no skip reason, `created_by_user_id = auth.uid()`, dated from 90 days ago to tomorrow | n/a | n/a | none |
| `sessions` delete (`sessions_delete_own_extra`, new) | Only own `origin = 'athlete'` sessions | unchanged | unchanged | none |
| `sessions` update | Still none. Skipping goes through `skip_my_session()` / `unskip_my_session()` | unchanged | unchanged | none |
| `session_blocks`, `session_block_rows` insert (`..._insert_own_extra`, new) | Only inside own `origin = 'athlete'` session (any status, so exercises can be added while logging). A block cannot carry a coach note | unchanged | unchanged | none |
| `athlete_availability` select (`athlete_availability_select_own_or_staff`) | Own rows | Athletes on own teams (`current_coach_athlete_ids()`) | Whole club | none |
| `athlete_availability` insert, update, delete | None (no policy, no grant) | None | None | none |

Functions (all `security definer`, `search_path = public`, EXECUTE revoked from `public` and `anon`):

| Function | Who may call it | Guard |
|---|---|---|
| `skip_my_session(session, reason, note)` | The athlete who owns the session. Refused for someone else's session, a completed session, a session they added themselves, an unknown reason | `assert_caller_active()` then `current_athlete_id()` |
| `unskip_my_session(session)` | The athlete who owns the session | same |
| `set_athlete_availability(kind, starts_on, ends_on, note, athlete_id)` | `athlete_id` null: the signed-in athlete for themselves. Otherwise `can_manage_athlete()`: a coach of the athlete's team or the club admin of the athlete's club | `assert_caller_active()`; closes any open overlapping period; writes `audit_events` (`athlete_availability_set`, never the note); notifies the team's coaches in the app (`athlete_unavailable`) when the athlete set it, or the athlete in the app and by email (`availability_set_by_coach`) when staff set it |
| `end_athlete_availability(id, last_day)` | The athlete (own period), a coach of their team, the club admin | `assert_caller_active()`; audit `athlete_availability_ended`; notifies the coaches (`athlete_available_again`) or the athlete |
| `get_my_last_exercise_results(labels, before, exclude_session)` | Any signed-in user; runs as the caller (security invoker), so row policies decide. Only ever returns the caller's own logs | row policies |

Trigger `clear_session_skip_fields` (before insert or update on `sessions`): the skip reason, note and time are cleared whenever a session is not `skipped`, whoever changes it.

Checked on a local Postgres 16 with every migration applied, as each identity: an athlete skips and un-skips only their own sessions and cannot update `sessions` directly; sets and ends only their own availability; adds an extra session only for themselves and cannot forge a planned one (missing `origin`, `origin = 'plan'` without a plan, a plan slot filed as `athlete`, another athlete, another club, a coach note, a completed status, a date months ahead); a coach sets and ends availability for athletes on their own teams and not another team's; a coach with no team for nobody; the club admin for the club and not another club; another club reads and writes nothing; a deactivated member and a member of a suspended club are refused with `access_paused`; `anon` cannot call the functions or read the table.

### Roster: bulk invites, team join codes, athletes without a login, moving teams (migration `20261009090000_roster_bulk_join_codes_managed_athletes.sql`)

| Object | Anon | Athlete | Coach | Club admin | Notes |
|---|---|---|---|---|---|
| `team_join_codes` (table) | none | none | select, own teams | select, own club | No insert, update or delete for any API role. The code is a secret. |
| `team_join_code_uses` (table) | none | none | select, own teams | select, own club | Written only by `join_team_with_code()`. |
| `create_team_join_code`, `disable_team_join_code` | no | refused | own teams | own club | One live code per team. Expires in 1, 7 or 30 days, at most 500 uses, audited. |
| `get_public_team_join_code(code)` | yes | yes | yes | yes | Always one row. Team and club names only for a usable code. Wrong codes counted per network address (20 in 10 minutes) and in total. |
| `join_team_with_code(code)` | no | no team yet: joins | refused (`not_athlete`) | refused (`not_athlete`) | Signed-in account with a CONFIRMED email. The only profile it can create is `athlete` in the code's club, on the code's team. Refuses other clubs, other teams, deactivated members, paused clubs, full clubs, emails with platform or club-request access. 10 wrong codes an hour per account. Audited, coaches told in-app. |
| `preview_athlete_invites`, `create_athlete_invites` | no | refused | own teams | own club | Up to 200 lines. Reports per line; accounts of other clubs are never revealed. |
| `create_managed_athlete`, `update_managed_athlete`, `remove_managed_athlete`, `create_athlete_login_invite` | no | refused | own teams | own club | Only for athletes with `user_id is null`. Remove is a soft switch-off, history kept. |
| `move_athlete_to_team` | no | refused | only when coaching BOTH teams | any athlete and team of the club | Removes untouched upcoming sessions of the old team's plans. Audited, coaches of both teams and the athlete told. |
| `get_roster_capacity` | no | no rows | own club | own club | Package limit, seats used, pending invites. |
| `session_row_logs_staff_write_managed` (policy) | - | - | athletes on own teams with no login | same, own club | Lets staff log sets FOR an athlete without a login. Athletes with a login are unchanged. |
| `athletes.user_id`, `athlete_invites.athlete_id` | - | - | cannot be written through the API | cannot be written through the API | Triggers `protect_athlete_login_link`, `protect_athlete_invite_link`. Only `accept_athlete_invite()` and `join_team_with_code()` link a login. |

Internal (no API role may call): `tenant_athlete_limit`, `tenant_athlete_seats_used`, `tenant_pending_athlete_invite_seats`, `lock_tenant_athlete_seats`, `classify_athlete_invite_email`, `process_athlete_invites`, `save_managed_athlete_guardian`, `roster_clean_name`, `join_code_note_wrong_guess`.

Changed: `accept_athlete_invite` links an invite that carries `athlete_id` to that existing athlete row (same club, same team, still without a login); `current_tenant_athlete_count` counts active athletes only.

## Service-Role Only Operations (Documented)

These are intentionally not available to regular authenticated users:
- Tenant creation
- Profile creation outside the three paths in "Profile bootstrap lockdown" (invite acceptance, club admin first access), and any direct role assignment
- `provision_club_admin_tenant` (self-serve club creation)
- `submit_account_request`, `notification_channel_enabled`, `tenant_access_blocked`, and everything in `request_form_settings` / `request_form_attempts`
- Cross-tenant admin jobs
- Backfill/migration scripts

## Security Constraints Enforced by Matrix

- Tenant boundary is always checked on tenant-scoped tables.
- Athlete can never read or write other athletes' rows.
- An athlete reads only their own team, the published plans assigned to them or their team, their team's published or closed test weeks, and invites addressed to their own email.
- Coaches and club-admins operate only within current tenant.
- A coach operates only on teams they are assigned to, and on athletes currently on those teams. Club admins operate on the whole club.
- Cross-tenant access is blocked even for coach/admin roles.
- A deactivated member, and every member of a suspended or cancelled club, is refused by the tables and by every security definer function that acts for a member. They can still learn why they are locked out, and nothing more.
- The only write open to visitors who are not signed in is the club request form, which is validated and rate limited in the database.

## Review Checklist

- [x] Each W1-W3 table mapped to role access rules
- [x] Tenant isolation strategy is explicit
- [x] Write restrictions are explicit
- [x] Service-role-only operations are identified


## Results history and competitions (20261008100000)

Every policy goes through `current_tenant_id()`, `current_athlete_id()`, `is_club_admin()`, `current_coach_team_ids()` and `current_coach_athlete_ids()`, so a deactivated member and anyone in a suspended or cancelled club gets nothing. `anon` has no grant on these tables.

| Table | Athlete | Coach | Club admin | Other club |
|---|---|---|---|---|
| `result_events` | read | read | read | read (a fixed list, no club data) |
| `athlete_results` | read own. Insert own with source `manual`, `training` or `competition` (a competition they can see). Update and delete only rows they entered themselves. Never `test_week` or `imported` rows. | read, insert, update and delete for athletes on their teams; not `test_week` rows (corrected in the test week) | the same for the whole club | nothing |
| `competitions` | read: their team's, club wide, their own, any they are entered in. Insert, update, delete: only `scope = 'athlete'` rows they own. | read: their teams', club wide, and the own meets of athletes they coach. Write: `scope = 'team'` for a team they are assigned to. | read all in the club; write `team` and `club` scope | nothing |
| `competition_entries` | read own. Insert own into a competition they can see. Update own (scratch, note). Delete only entries they made. | read and write for athletes on their teams, into competitions they can see | the same for the whole club | nothing |
| `pr_records` | read own (unchanged). No writes any more: `pr_records_insert_own_test_week` and `pr_records_update_own_test_week` are dropped, the row is written by `refresh_pr_record()` | unchanged (`pr_records_staff_all`) | unchanged | nothing |
| view `athlete_event_bests` | `security_invoker`: exactly the rows of `athlete_results` the reader may read | | | |

Trigger functions (`*_normalise`, `refresh_pr_record`, `sync_test_result_to_history`, the two notification functions) are `security definer`, not executable by clients, and take the club, the event's unit and direction, the wind legality and "entered by" from the database, never from the request. `get_current_results_season()` returns no rows to anyone who is not an active member.


## Test weeks: close, reopen, results entered by a coach (20261009100000)

No row policy is added, changed or dropped. What changes is what the existing policies let through, and one new function.

| Thing | Athlete | Coach | Club admin | Other club, deactivated member, suspended or cancelled club |
|---|---|---|---|---|
| `set_test_week_open(test_week_id, open)` (security definer, starts with `assert_caller_active()`) | refused | a published or closed test week of a team they are assigned to (`can_manage_test_week`). A draft or an archived week is refused. | any test week of the club, same conditions | refused (`42501`, with hint `access_paused` for a locked out member) |
| `test_weeks.status` changed directly (through `test_weeks_staff_all`, unchanged) | no write access | as before, plus: `draft` to `closed` is refused by trigger `test_weeks_status_guard` | the same | nothing |
| `test_results` insert, update, delete (through `test_results_staff_all` and the athlete policies, all unchanged) | own results, only while the week is open (`athlete_can_enter_test_result`, unchanged): not in a closed week, again after a reopen | results of athletes on their teams, in a published or CLOSED test week they manage, athletes with no login included. Refused by trigger `test_results_guard`: a draft week, another team's week, a new result for an athlete who is not on the week's team, a test that belongs to another week, a value that is not above 0 | the same for the whole club | nothing |
| `test_results.entered_by_role`, `submitted_by_user_id` | set by the database: `athlete` and their own user id | set by the database: `coach` | set by the database: `club-admin` | not readable (rows are not readable) |

- `test_results_guard()` runs before every insert and before an update of the week, test, athlete, club or value of a result. It never widens access: the row policy has already decided whether the caller may write the row. Calls with no signed-in user (service role, SQL editor) get the consistency checks only.
- `test_weeks_status_changed()` (after update of `status`) writes `audit_events` rows `test_week_closed` and `test_week_reopened` (actor, role, the week's name) for every close and reopen, whichever way the status was changed, and on a reopen queues the in-app notification `test_week_reopened` for the active athletes of the team who have an account. Closing notifies nobody.
- `enqueue_test_week_published_notifications()` no longer fires when a closed week goes back to `published`; it is otherwise the 20261007090000 definition.
- Results a coach enters reach `athlete_results`, `athlete_event_bests` and `pr_records` through the unchanged triggers of 20261008100000, and do not produce the `athlete_test_results_submitted` notice (that one is for results the athlete typed).
- Trigger functions `test_results_guard`, `test_weeks_status_guard`, `test_weeks_status_changed` are not executable through the API. `set_test_week_open` is executable by `authenticated` and `service_role` only.



## Messaging: announcements and coach to athlete messages (20261009110000)

Six tables, all with RLS on, `select` granted to `authenticated` and NO insert, update or delete grant: every write is a `security definer` function that starts with `assert_caller_active()`. `anon` has nothing. Every read policy starts with `tenant_id = current_tenant_id()`, so a deactivated member and anyone in a suspended or cancelled club reads nothing and writes nothing.

| Thing | Athlete | Coach | Club admin | Other club, deactivated, suspended or cancelled |
|---|---|---|---|---|
| `message_threads`, `messages` (read) | own threads, always (read only once the thread is closed) | threads where they are the coach AND still assigned to the thread's team (`current_message_thread_ids()`). Removed from the team: nothing. Not other coaches' threads, even on the same team. | every thread of the club, read only | nothing |
| `open_message_thread(athlete, coach)` | with a coach of their own current team (active). Not another athlete, not another team's coach, not with no team | with an athlete on a team they are assigned to (`is_coach_of_athlete`) who has a login and is active. No login: refused with hint `no_login` | refused unless they are also assigned to that athlete's team as a coach | refused (`access_paused` for a locked out member) |
| `send_direct_message(thread, body)` | in their own thread while it is open | in their own thread while it is open | refused (`not_participant`): club admins never write in a conversation | refused |
| a thread is open (`message_thread_is_open`) | only while: the athlete has a login, is active and on a team; the thread's coach is an active coach assigned to that team; the club is not blocked. Athlete left the team, coach removed or deactivated: read only (`thread_read_only`) | | | |
| edit or delete a message | not possible: no grant, no policy, no function | not possible | not possible (hide only) | nothing |
| `report_message(message, reason)` | the OTHER person's message in their own thread | the same | refused | refused |
| `hide_message`, `dismiss_message_reports` | refused | refused | messages of their own club. Hiding moves the text to `message_moderation` and leaves `body` null with `hidden_at` set | refused |
| `message_moderation` (the text of hidden messages) | nothing | nothing | read | nothing |
| `message_reports` (read) | their own reports | their own reports | all of the club | nothing |
| `get_message_oversight_threads()` | no rows | no rows | every thread of the club, reported first | no rows |
| `post_announcement(audience, body, team)` | refused | `team`, a team they are assigned to | `club`, `coaches`, or `team` for any team of the club | refused |
| `announcements` (read) | the ones sent to them | the ones sent to them, the ones they sent, and their teams' | all of the club | nothing |
| `announcement_recipients` (read) | own row | own row; read states of an announcement they manage through `get_announcement_recipients()` | all of the club | nothing |
| `mark_message_thread_read`, `mark_announcement_read` | own read state only | own read state only | own announcements; reading a thread in oversight leaves no trace | no effect |
| `messaging_settings` (limits) | nothing | nothing | nothing | nothing (service role and the functions only) |

- Limits, from the one private row of `messaging_settings`: 1000 characters, 30 direct messages per sender per hour, 20 announcements per sender per day (`54000`, hint `rate_limited`). The count is taken under an advisory lock per sender.
- Text is cleaned before it is stored (`clean_message_body`): no control characters, at most one blank line in a row.
- Audit events (never containing message text): `message_reported`, `message_hidden`, `message_report_dismissed`.
- Notifications go through `enqueue_notification()` (20261007090000), so the usual rules apply (never the sender, never a deactivated member, never a blocked club, never a channel the person switched off): `announcement_posted` in-app and email with the announcement text; `direct_message_received` in-app only while no unread one exists for that thread, and one email per thread per recipient per hour, neither with the message text; `message_reported` to club admins in-app and email.
- `get_message_thread()` answers `guardian_contact_on_file` (athlete under 18 by date of birth and a guardian email in `athlete_private_details`) to the thread's coach and to club admins only, never to the athlete. `club_profiles.guardian_cc_enabled` is recorded (default false) and read by nothing that sends.
- Realtime: `messages` and `message_threads` are in the `supabase_realtime` publication; the row policies above decide who receives a change.
- Verified on a throwaway Postgres 16 with every migration applied (this one twice): 156 assertions across a club with two teams, a coach each, a coach on both, athletes (one under 18 with a guardian, one with no login), two club admins, a second club and a suspended club.

### Competitions for staff (20261009110000)

No policy is added or changed. Verified against 20261008100000 with 30 assertions: a coach creates, edits and deletes meets of their own teams only; enters, scratches and records results for athletes of their own teams only; sees a meet an athlete on their team added for themselves (and that athlete's entries), may record its results, and may not edit the meet itself; a result typed by a coach lands in `athlete_results`, `athlete_event_best()` and `pr_records` and notifies the team's other coaches of a new best. The one addition is the index `competition_entries_competition_idx`.

## Club admin invites, removing people, deleting an athlete's data (20261010090000)

Migration `20261010090000_club_admin_invite_role_and_member_removal.sql`. Every function below starts with `assert_caller_active()`, so a deactivated admin and the admin of a suspended or cancelled club get the usual `access_paused` refusal.

| Object | Who | What |
|---|---|---|
| `removed_members` (table) | select: active coach or club admin of the same club. No insert, update or delete for any API role. | The name and role of a coach or club admin who was removed, so what they wrote stays attributed. Written only by `remove_tenant_member`, cleared by `accept_coach_invite` when the person joins again. |
| `coach_invites.role = 'club-admin'` | Only an active club admin of the invite's club (row policy `coach_invites_staff_all`, plus trigger `guard_club_admin_invite` as a second lock). A coach, an athlete, an admin of another club and an admin of a suspended club are refused. | Creating one, or raising a coach invite to it, writes audit event `club_admin_invite_created` with the real caller. |
| `accept_coach_invite(invite)` | The signed-in person whose CONFIRMED email is the invite's email. | Gives the invite's role in the invite's club only. A member of another club is refused. A coach invite never lowers a club admin to coach. Audit: `coach_invite_accept` ("accepted as club-admin ..."). |
| `get_public_coach_invite_role(invite)` | anon, authenticated (whoever holds the invite link, same reach as `get_public_coach_invite`). | Returns `coach` or `club-admin`, nothing else. |
| `complete_current_coach_onboarding(name)` | The caller, when their own profile is a coach or (new) a club admin. | Writes the caller's own name and first sign-in stamps only. |
| `remove_tenant_member(user)` | Active club admin, for a coach or club admin of the same club. Refused for: yourself, the last active club admin, a member of another club ("Member not found in this club"), an athlete. | Deletes the profile and `team_coaches` rows in this club and the person's notifications from this club, cancels pending invites to their email, keeps their name in `removed_members`. Plans, sessions, test weeks, announcements, messages and audit entries they wrote are kept. Their threads become read only. Audit: `member_removed`. |
| `remove_athlete_from_club(athlete)` | Active club admin, same club. Returns false for an athlete of another club. | Nothing is deleted. `athletes.is_active = false`, `team_id = null` (frees the seat), the athlete's own profile is deactivated (athlete role only), pending invites for them are cancelled. Audit: `athlete_removed_from_club`. |
| `restore_athlete_to_club(athlete)` | Active club admin, same club. Refused when the package has no athlete place left. | Athlete record and their athlete profile active again, on no team. Audit: `athlete_restored_to_club`. |
| `delete_athlete_and_data(athlete, typed full name)` | Active club admin, same club, and only with the athlete's full name passed in. A coach, the athlete, an admin of another club are refused. | THE ONE DELIBERATE DELETE. Removes the athlete record and every row that hangs off it (see below). Audit: `athlete_data_deleted`, naming nobody. |

What `delete_athlete_and_data` removes: `session_row_logs`, `session_completions`, `athlete_results`, `test_results`, `sessions` (with `session_blocks` and rows), `training_plan_assignments` of scope athlete, `athlete_invites` (by record, by accepting account, by email), `team_join_code_uses`, then `athletes`, which cascades to `wellness_entries`, `pr_records`, `athlete_availability`, `pain_reports`, `athlete_private_details`, the athlete's own `competitions`, `competition_entries`, and `message_threads` with `messages`, `message_moderation` and `message_reports`. Also `notification_events` and `user_notifications` sent to the athlete by this club or about the athlete, and for an athlete with a login their `announcement_recipients` rows and their profile in this club (athlete role only). Audit entries are kept; a target or detail that is exactly the athlete's name or email is blanked to "deleted athlete".

What it does NOT remove (service role only, do by hand for a full erasure request): the login account in `auth.users`, and a profile photo file in the `avatars` storage bucket with its `account_avatars` row.

Verified on a throwaway Postgres 16 with every migration applied (this one twice): 127 assertions as each identity, including row counts per table before and after for another athlete of the same club and an athlete of another club.

### Club logo, club contact details and two platform admin tools (migration `20261010100000_club_profile_logo_and_platform_tools.sql`)

Club logos live in the Storage bucket `club-logos` (public, 2 MB limit, JPEG/PNG/WebP only) under `<club id>/<random>.jpg`. Public for the same reasons as `avatars`: one stable address the browser can cache, a name that cannot be guessed, and no listing for anyone who is not an admin of that club.

| Object | Athlete | Coach | Club admin | Platform admin | Notes |
|---|---|---|---|---|---|
| `club_profiles.logo_path` (read through `club_profiles_select_tenant`, unchanged) | own club | own club | own club | none | check constraint `club_profiles_logo_path_own_folder`: the path must be inside the club's own folder, whoever writes it |
| `get_current_club_brand()` | own club: name, short name, colour, logo path | same | same | no rows | no rows for a deactivated member or a suspended or cancelled club; never billing or contact details |
| `set_current_club_logo(text)` | refused | refused | own club | refused | raises `access_paused` for a deactivated admin or a blocked club; the path must be in the club's folder and the file must exist; returns the previous path |
| `storage.objects` in `club-logos`: select, insert, update, delete (`club_logos_*_admin`) | none | none | own club's folder | none | name must be `<own club id>/<8 to 64 url-safe chars>.<jpg\|png\|webp>`; reading through the public address does not use policies |
| `club_contact_details` select, insert, update (`club_contact_details_select_admin`, `club_contact_details_modify_admin`) | none | none | own club | none | contact email and phone, city, region, country, website; no delete privilege for API roles; `anon` has no access |
| `platform_admin_set_tenant_package(uuid, text, text)` | refused | refused | refused | any approved club that is not cancelled | reason required; rewrites `requested_plan` on the latest provisioning record (so `tenant_athlete_limit()` and `get_current_tenant_package()` follow); writes `platform_audit_events` (`tenant_package_changed`) and the club's `audit_events` (`package_changed`); tells the club's active admins |
| `get_platform_failed_notification_emails(integer)` | no rows | no rows | no rows | failed emails of the last 8 days | never returns `body` or `metadata` |
| `retry_platform_notification_email(uuid)` | refused | refused | refused | a failed email not older than 72 hours | resets the try count and writes `notification_email_retry_requested` to the platform audit |

Verified on a throwaway Postgres 16 with every migration applied (this one twice): 102 assertions as each identity (club admin, coach, athlete, deactivated admin, admin of another club, admin of a suspended club, platform admin, an account with no profile, anon).

### Session log depth: per set effort, exercise note, last time set by set (migration `20261011100000_session_log_depth.sql`)

No new table and no new policy. `session_row_logs.rpe` (1 to 10) and `session_row_logs.note` (up to 500 characters, new check `session_row_logs_note_length`) are now written by the athlete log; they are covered by the existing row policies of `session_row_logs`.

| Object | Athlete | Coach | Club admin | Other club, signed out | Notes |
|---|---|---|---|---|---|
| `session_row_logs.rpe`, `.note` (existing policies `session_row_logs_select_own`, `_insert_own`, `_update_own`, `_select_tenant_staff`, `_staff_write_managed`) | read and write own rows only | read for athletes of teams they coach; write only for an athlete with no login | read whole club | none | a team mate reads nothing; a coach of another team of the same club reads nothing |
| `exercise_match_key(text)` | execute | execute | execute | `anon` has no execute | immutable; lower case, anything that is not a letter or digit becomes one space |
| `get_my_last_exercise_logs(text[], date, uuid)` | own history only | no rows | no rows | no rows; `anon` has no execute | security invoker, so row policies apply, and it also filters on `current_athlete_id()`: nothing for a deactivated athlete or a suspended or cancelled club |

Verified on a throwaway Postgres 16 with every earlier migration applied and this one twice: 55 assertions as each identity (the athlete, a team mate, the team's coach, a coach of both teams, a coach of another team, the club admin, coach, admin and athlete of another club, a deactivated coach and athlete, an athlete of a suspended club, signed out).

## Reminders (20261011120000_reminders.sql)

| Object | Athlete | Coach | Club admin | Platform admin | Notes |
| --- | --- | --- | --- | --- | --- |
| `reminder_deliveries` | none | none | none | none | Row level security on, no policies, no grants to `anon` or `authenticated`. Written and read only by `run_reminders()` (security definer). Unique on `(user_id, reminder_type, subject_id, local_date)`. |
| `club_profiles.timezone` | read (own club) | read (own club) | read and write (own club) | none | Uses the existing `club_profiles` policies. A trigger refuses a time zone name Postgres does not know. |
| `set_current_club_timezone(text)` | refused | refused | allowed (own club) | refused | Starts with `assert_caller_active()`: a deactivated admin or a paused club is refused. Writes an `audit_events` row. |
| `run_reminders(timestamptz, uuid)`, `send_reminder(...)`, `reminder_tenant_timezone(uuid)` | no execute | no execute | no execute | no execute | Run by pg_cron (job `sktr-run-reminders`, hourly) and the service role. |

Reminders are queued with `enqueue_notification()`, so the recipient rules of 20261007090000 apply unchanged: active members only, never a suspended or cancelled club, the person's own channel choices. Coach reminders go only to coaches assigned to the team (`team_coaches`).

## Athlete goals (20261011110000_athlete_goals_and_history.sql)

| Object | Athlete | Coach | Club admin | Other club, deactivated, signed out | Notes |
| --- | --- | --- | --- | --- | --- |
| `athlete_goals` select, insert, update, delete (`athlete_goals_select_scope`, `_insert_scope`, `_update_scope`, `_delete_scope`) | own goals only | athletes of the teams they coach (`current_coach_athlete_ids()`) | every athlete of the club | none | `tenant_id = current_tenant_id()` on every policy. Another athlete, even a team mate, gets no rows. |
| `athlete_goals_normalise()` (before insert or update) | n/a | n/a | n/a | n/a | Security definer, `search_path = public`, no execute for clients. Sets the tenant from the athlete, the event name, unit and direction from `result_events`, the starting mark on insert, and whether the goal is achieved. Athlete, tenant, creator and starting mark cannot be changed afterwards. Refuses a target the current best already meets (23514). |
| `athlete_results_refresh_goals()` (after insert, update or delete on `athlete_results`) | n/a | n/a | n/a | n/a | Security definer. Touches the open goals of that athlete and event so they are worked out again. A goal marked achieved by hand is left alone. |

A goal is achieved by the first wind legal result of its event, dated on or after the day the goal was set, that meets the target (`compare_value`, lower or higher by the event). Nothing is notified.

Verified on a throwaway Postgres 16 with every earlier migration applied and this one twice: 72 assertions as each identity (the athlete, a team mate, an athlete of another team, the team's coach, a coach of both teams, a coach of another team, a deactivated coach, the club admin, coach, athlete and admin of another club, an athlete of a suspended club, signed out).

## Exercise library, best lifts and percentage loads (20261011090000_exercise_library_and_loads.sql)

| Object | Athlete | Coach | Club admin | Other club, deactivated, signed out | Notes |
| --- | --- | --- | --- | --- | --- |
| `exercise_library` select, insert, update (`exercise_library_select_staff`, `_insert_staff`, `_update_staff`) | none | every exercise of their club (the library is shared by all coaches of a club, not per team) | every exercise of their club | none | `tenant_id = current_tenant_id() and is_coach_or_admin()`. No delete policy and no delete grant: exercises are archived. A trigger sets the name key and the creator, and keeps club and creator fixed on update. |
| `athlete_lift_maxes` select, insert, update, delete (`athlete_lift_maxes_select`, `_insert`, `_update`, `_delete`) | own rows only (read and write) | athletes of the teams they coach (`can_manage_athlete`) | every athlete of the club | none | `tenant_id = current_tenant_id()` on every policy. A team mate and a coach of another team get no rows. `source` and `updated_by_user_id` are set by trigger from the caller, whatever the browser sends. |
| `session_block_rows` new columns (`percent_1rm`, `lift_name`, `lift_key`, `target_volume`, `cue`, `reference_url`, `exercise_id`) | read on own sessions | as before (team scope) | as before | none | No policy changed. The existing row policies cover the new columns. |
| `resolve_session_row_load()` (before insert or update on `session_block_rows`) | n/a | n/a | n/a | n/a | Security definer, `search_path = public`, no execute for clients. Reads the best lift of the athlete the session belongs to and writes `target`, `target_load` and `helper`. |
| `athlete_lift_max_kg_unchecked(uuid, text)`, `refresh_athlete_session_loads(uuid, text)`, `refresh_loads_after_lift_max_change()`, `refresh_loads_after_result_change()` | no execute | no execute | no execute | no execute | Internal, security definer, used by triggers only. They check nobody, so nobody may call them. |
| `lift_key(text)`, `format_load_number(numeric)` | execute | execute | execute | n/a | Immutable text helpers, no data access. |

Athletes never read `exercise_library`: the cue and the link are copied onto their session rows when the session is written.

Verified on a throwaway Postgres 16 with every earlier migration applied and this one twice: 82 assertions as each identity (the athlete, a team mate, the team's coach, a coach of another team, a deactivated coach, the club admin, coach and admin of another club, coach and athlete of a suspended club, signed out).

## Plan templates (20261012090000_plan_templates.sql)

| Object | Athlete | Coach | Club admin | Other club, deactivated, signed out | Notes |
| --- | --- | --- | --- | --- | --- |
| `plan_templates` select (`plan_templates_select_staff`) | none | every template of their club (shared by all coaches of a club, not per team) | every template of their club | none | `tenant_id = current_tenant_id() and is_coach_or_admin()`. |
| `plan_templates` insert (`plan_templates_insert_staff`) | none | own club, as themselves | own club, as themselves | none | A trigger sets the creator and the creator's name from the caller, whatever the browser sends. |
| `plan_templates` update and delete (`plan_templates_update_owner_or_admin`, `plan_templates_delete_owner_or_admin`) | none | only templates they made | any template of their club | none | `created_by_user_id = auth.uid() or is_club_admin()`. The trigger keeps club and creator fixed on update. |
| `mark_plan_template_used(uuid)` | refused | allowed (own club, any template) | allowed (own club) | refused, or false for another club's template | Security definer, `search_path = public`, starts with `assert_caller_active()`. Writes `last_used_at` and nothing else. No execute for `anon`. |
| `plan_templates_before_write()` | n/a | n/a | n/a | n/a | Trigger function, no execute for clients. |

Two check constraints guard the content: `plan_templates_structure_shape` (an object with a `sessions` list, at most 1.5 MB) and `plan_templates_no_squad_data` (no `assign` key and no `overrides` on any exercise row), so a template can never carry athlete ids. Nothing is seeded.

Verified on a throwaway Postgres 16 with every earlier migration applied and this one twice: 72 assertions as each identity (the creator, a coach of another team, a coach of both teams, a deactivated coach, two club admins, an athlete, the coach, admin and athlete of another club, a coach of a suspended club, signed out).

## Coach notes, attendance and logging for an athlete (20261012100000)

| Object | Athlete | Coach | Club admin | Other club, deactivated, signed out | Notes |
| --- | --- | --- | --- | --- | --- |
| `coach_athlete_notes` select (`coach_athlete_notes_select_staff`) | none, including notes about themselves | notes about athletes currently on a team they coach | every note of their club | none | There is no athlete policy at all. `is_club_admin() or athlete_id = any(current_coach_athlete_ids())`. After a move the old team's coaches lose the notes and the new team's coaches gain them. |
| `coach_athlete_notes` insert (`coach_athlete_notes_insert_staff`) | none | athletes on their teams, as themselves | any athlete of their club, as themselves | none | A trigger sets club and author from the caller, whatever the browser sends. |
| `coach_athlete_notes` update (`coach_athlete_notes_update_author`) | none | only notes they wrote | only notes they wrote | none | Text, day and pin. Athlete, club, author and created time are fixed by trigger. |
| `coach_athlete_notes` delete (`coach_athlete_notes_delete_author_or_admin`) | none | only notes they wrote | any note of their club | none | |
| `athlete_attendance` select (`athlete_attendance_select_own_or_staff`) | own rows only | marks taken for a team they coach, and marks of athletes now on their teams | every mark of their club | none | |
| `athlete_attendance` insert, update, delete (`athlete_attendance_insert_staff`, `_update_staff`, `_delete_staff`) | none | teams they coach | any team of their club | none | Trigger: the athlete must be on that team, the day cannot be more than a day ahead, `marked_by_user_id` is the caller, team, athlete and day never change. |
| `session_row_logs` insert and update (`session_row_logs_staff_insert_team`, `session_row_logs_staff_update_team`) | unchanged (own rows) | any athlete on a team they coach (before: only athletes without a login) | any athlete of their club | none | The row must belong to a session of that same athlete. |
| `session_row_logs.logged_by_user_id`, `session_completions.completed_by_user_id` | always the caller | always the caller | always the caller | n/a | Triggers `stamp_session_row_log_author` and `stamp_session_completion_author`. Who finished a session never changes on a later edit. |
| `get_session_logged_by(uuid)` | own sessions | sessions of athletes on their teams | sessions of their club | no row | Security definer, `search_path = public`, starts with `assert_caller_active()`. Returns the staff member who entered a session, or nothing when the athlete logged it. No execute for `anon`. |

Verified on a throwaway Postgres 16 with every earlier migration applied and this one twice: 95 assertions as each identity (two coaches of the team, a coach of another team, a deactivated coach, a club admin, the athlete, a team mate, the coach and admin of another club, a coach of a suspended club, signed out).

## Seasons and the year end rollover (20261014090000)

| Object | Athlete | Coach | Club admin | Other club, platform admin | Notes |
| --- | --- | --- | --- | --- | --- |
| `club_seasons` select (`club_seasons_select_members`) | every season of their club | every season of their club | every season of their club | none | `tenant_id = current_tenant_id()`, so a deactivated member or a member of a suspended club reads nothing. |
| `club_seasons` insert, update, delete | none | none | none directly | none | No write policy and no write grant for `authenticated`. Changes go through the three functions below. |
| `save_club_season(id, name, start, end)` | refused | refused | adds an upcoming season, or changes the name and dates of a season of their club | another club's season reads as "no longer exists" | Security definer, `search_path = public`, `assert_caller_active()`, then `is_club_admin()`. Audited (`season_added`, `season_changed`). |
| `delete_club_season(id)` | refused | refused | an upcoming season of their club only | refused | A current or past season is never removed. Audited (`season_removed`). |
| `start_club_season(id, name, start, end, archive_team_ids, end_plans)` | refused | refused | the rollover for their club | refused | One transaction. The old season becomes past, the chosen one current, the named teams are archived (their athletes get `team_id` null), published plans are archived when asked, one `season_started` audit event. A team id of another club, or one already archived, fails the whole call. Nothing is deleted. |
| `results_season_bounds`, `athlete_event_bests` | unchanged access | unchanged access | unchanged access | unchanged | The season best window is now the current row of `club_seasons` until its last day has passed, otherwise the calendar year. |

Rules kept by the database: one current season per club (partial unique index), no two seasons of a club share a day (trigger `club_seasons_guard`, SQLSTATE 23P01), and `club_profiles.season_year/season_start/season_end` always mirror the current season (triggers both ways).

Verified on a throwaway Postgres 16 with every migration up to 20261012100000 applied, a seeded database, then this one twice: 81 assertions as a club admin, a coach, a deactivated coach, an athlete, the admin and an athlete of another club, the admin of a suspended club and signed out.

## Calendar: club events and calendar feed links (20261014100000_calendar_and_feeds.sql)

| Object | Athlete | Coach | Club admin | Other club, deactivated, signed out | Notes |
| --- | --- | --- | --- | --- | --- |
| `club_events` select (`club_events_select_visible`) | whole club events and events of their own team | whole club events and events of teams they coach | every event of their club | none | `tenant_id = current_tenant_id() and id = any(current_club_event_ids())`. The helper holds the rule once, so the two policies never query each other. |
| `club_event_teams` select (`club_event_teams_select_visible`) | links of events they can see | links of events they can see | all of their club | none | Same helper. |
| `club_events`, `club_event_teams` insert, update, delete | none | none | none | none | No write policy and select only grants. Writes go through the two functions below. |
| `save_club_event(...)` | refused | add and change events that are for teams they coach only (never whole club, never a team they do not coach, never an event shared with another team) | add and change any event of their club | refused | Security definer, `search_path = public`, starts with `assert_caller_active()`. Teams must belong to the caller's club. Creator and role are taken from the caller. |
| `delete_club_event(uuid)` | refused | same events they may change | any event of their club | refused | Uses `can_manage_club_event(uuid)`. |
| `calendar_feeds` | no access | no access | no access | no access | RLS on, no policy, no grant to `authenticated` or `anon`. Holds `sha256(token)` only. |
| `get_calendar_feed_status()`, `turn_on_calendar_feed()` | own link only | own link only | own link only | refused (paused or deactivated: access paused error; signed out: no execute) | The token (64 hex characters, 244 random bits) is returned once and never stored. Calling turn on again replaces the hash, so the old link stops at once. |
| `turn_off_calendar_feed()` | own link | own link | own link | own link, also while paused or deactivated | Removing a link is always allowed. No execute for `anon`. |
| `calendar_feed_payload(text)` | no execute | no execute | no execute | no execute | Service role only (the `calendar-feed` server function). Returns null for an unknown hash, a deactivated member, an athlete whose athlete record is off, an inactive tenant and a suspended or cancelled club. Content: athlete: own session titles (not skipped ones), published test weeks of their team, competitions they are entered in or added, events for the club or their team. Coach: one line per team, day and session title from published plans of teams they coach, those teams' test weeks, club and own team competitions with a count of athletes entered, events for the club or their teams. Club admin: test weeks, competitions and events of the club, no session lines. Never availability, wellness, pain reports, results or notes, and no athlete names for staff. |

Verified on a throwaway Postgres 16 with every migration up to 20261012100000 applied and this one twice: 120 assertions as each identity (club admin, coach of team 1, coach of team 2, coach of both, a deactivated coach, athletes of both teams, a deactivated athlete, admin, coach and athlete of another club, members of a suspended club, someone with no profile, signed out, and the service role for the feed lookup).

## Squads (20261014110000_squads.sql)

A squad is a small named group inside ONE team. It never changes who can see an athlete. "Team coach" means a coach assigned to the squad's team.

| Object | Club admin | Team coach | Other team's coach | Athlete | Notes |
| --- | --- | --- | --- | --- | --- |
| `team_squads` select | club | their teams | none | the squads they are in (names) | Other clubs: none. |
| `team_squads` insert, update, delete | club | their teams | none | none | The club is copied from the team; a squad never changes team; two live squads of a team cannot share a name. Archiving (set `archived_at`) ends its memberships. |
| `team_squad_members` select | club | their teams | none | their own rows only | An athlete never reads a teammate's membership. |
| `team_squad_members` insert, delete | club | their teams | none | none | Trigger: the athlete must be an active athlete on the squad's own team, for every caller including the table owner. Club and team on the row are copied from the squad. |
| `training_plan_assignments` with scope `squad` | club | plans of their teams | none | reads rows of squads they are in | Trigger: the squad must be a live squad of the plan's own team. `current_athlete_plan_ids()` includes plans of the athlete's squads, so plan, weeks, days and "create my planned day" follow the squad. |
| `test_weeks.squad_ids` | club | their teams | none | no write | Empty means the whole team. Trigger: every id must be a squad of the week's team. An athlete outside the squads does not see the week or its tests and cannot enter a result (`current_athlete_test_week_ids()`, `athlete_can_enter_test_result()`); a week they already have a result in stays readable. |

Triggers that keep it true: an athlete who moves team, is taken off a team or is deactivated loses the memberships of the old team (`athletes_end_squad_memberships`); when a membership ends, the athlete's untouched upcoming sessions of plans that only reached them through that squad are removed, and anything started, finished or in the past stays (`squad_prune_member_sessions`). Notifications follow the audience: plan published, test week published or reopened and the "closes today" reminder go to squad members only.

Verified on a throwaway Postgres 16 with every migration up to 20261012100000 applied and this one twice: 132 assertions as each identity (club admin, coach of team 1, coach of team 2, coach of both, a deactivated coach, athletes in one, two and no squads, an athlete of the other team, admin, coach and athlete of another club, a coach of a suspended club).

## Personal data rights and club exit (20261014120000_data_export_account_deletion_and_club_exit.sql)

"Owner" is the one club admin who owns the club: the admin recorded in `club_owners`, or for a club that never transferred ownership its longest standing active club admin.

| Object | Athlete | Coach | Club admin | Club owner | Platform admin | Other club, paused, signed out | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `club_owners` select | none | own club | own club | own club | none | none | No write policy. Written only by `transfer_club_ownership`. |
| `get_club_ownership()` | null | owner name | owner and the admins it could go to | same | null | null | |
| `transfer_club_ownership(user, typed club name)` | refused | refused | refused | to another ACTIVE club admin of the same club | refused | refused | Both people are notified, audit entry `club_ownership_transferred`. |
| `profiles` update, delete of a club admin row (trigger `guard_club_owner_and_admins`) | n/a | n/a | may not remove, turn off or change the role of the owner or of another club admin | may do it to other admins, never to themselves while owner | passes | n/a | Second lock under `set_tenant_member_access` and `remove_tenant_member`. Acting on your own row is judged by the function called. |
| `record_data_export('personal')` | own audit entry | own | own | own | platform audit entry | paused: access paused error | Who and when only. |
| `record_data_export('club', health)` | refused | refused | allowed | allowed | refused | refused | |
| `get_my_account_deletion_check()`, `delete_my_account(typed email)` | allowed | refused while lead of a team or only coach of a team with athletes | same team rule | refused (transfer or close first) | refused, not in the app | paused: access paused error; signed out: refused | Deletes the login inside the function. Only ever the caller's own account: there is no user parameter. |
| `close_current_club(typed club name)` | refused | refused | refused | allowed | refused | refused | Blocks access for every member through the existing lifecycle path and starts the 90 days. |
| `get_current_club_closure()` | own club's closure | own | own | own | null | own club's closure also while locked out | Lets the "club is closed" notice show its date. |
| `club_closures` select, `get_closed_clubs()`, `reopen_closed_club(club)` | none | none | none | none | allowed | none | |
| `delete_closed_club(club, typed club name)` | refused | refused | refused | refused | allowed for a club that is closed now | refused | With no signed-in user (the scheduler, service role) only after the club's deletion date. Refused for a club that is open, was never closed or was reopened. |
| `run_club_deletions()` | no execute | no execute | no execute | no execute | no execute | no execute | Service role and pg_cron only. |
| `storage_deletion_queue` | none | none | none | none | select | none | Paths only. `claim_storage_deletions`, `finish_storage_deletion`, `request_storage_purge`: service role only. |

What cannot be removed by SQL: files in storage (profile photos in `avatars`, club logos in `club-logos`). Supabase refuses a direct delete on `storage.objects`. Every delete above queues the paths and the server function `purge-deleted-storage` removes them with the Storage API (called by the app after "Delete permanently now" and by the daily job).

Also changed: `message_member_name` returns "Deleted account" for a sender whose account is gone; `enqueue_club_lifecycle_notifications` does not send the "access paused" email for a club its owner closed; every table with a "set null" foreign key to `auth.users` gets the trigger `zz_release_deleted_account`, without which the author pinning triggers (plan templates, exercises, coach notes, goals, attendance, lift maxes) made deleting a coach's login fail with a foreign key error. A later migration that adds such a column should end with `select public.install_deleted_account_triggers();`.

Verified on a throwaway Postgres 16 with every earlier migration applied and this one twice: 191 assertions as each identity (owner, second and third club admin, lead coach, shared coach, only coach of a team, athletes with and without a conversation, admin, coach and athlete of another club, members of a suspended club, a platform admin, a platform admin who is also a club member, signed out, and the scheduler). The club deletion test lists the tables from the catalogue: it fails for a public table that has no `tenant_id` and is not accounted for, and for a tenant table the test did not put rows in.

## Athlete reports (20261015110000_athlete_reports.sql)

| Table | Select | Insert | Update | Delete |
|---|---|---|---|---|
| `athlete_reports` | Coaches of the athlete's current team and club admins of the club. The athlete: only their own reports with `shared_with_athlete_at` set. Nobody else, no anon. | Same staff, `author_user_id = auth.uid()` (stamped by trigger). | Same staff. The trigger freezes summary, snapshot, sections and period once the report is shared with the athlete or has any link, and ignores a client that sets the shared columns. | Same staff. |
| `athlete_report_links` | Same staff, without the `token_hash` column (column grants). No athlete policy. | Function only (`create_athlete_report_link`). | Function only (`revoke_athlete_report_link`, and the open counter in the public read). | Cascade from the report or the athlete. |

Functions: `share_athlete_report(report)` (staff in scope, active caller; sets the shared time and sends `athlete_report_shared` to the athlete), `create_athlete_report_link(report, made_for, days)` (7, 30 or 90 days; returns the token once, stores its SHA-256), `revoke_athlete_report_link(link)`, `can_manage_athlete_report(report)`, and `get_shared_athlete_report(token)`, the only thing `anon` can call: it returns the snapshot JSON or NULL, the same NULL for a wrong, expired or revoked link, a paused or closed club and a rate limited caller (20 wrong tokens in 10 minutes per network address, 2,000 an hour in total, counted as hashes in `request_form_attempts`, form `report_link_lookup`).

Checks on the snapshot: it may not carry a coach notes key, and it may carry `wellness` or `injuries` only when `sections` lists them.

Deletion: both tables have `tenant_id` and `athlete_id`, so `purge_athlete_personal_data` and `delete_closed_club` remove them through `sweep_rows_by_column` with no change to those functions. The migration ends with `install_deleted_account_triggers()` for the three "set null" references to `auth.users`.

Verified on a throwaway Postgres 16 (every migration up to 20261014130000, then this one twice): 109 assertions as team coach, coach of both teams, another team's coach, inactive coach, club admin, another club's admin and coach, the athlete, a team mate, an athlete of another club, signed out, and a suspended club.

## Training load and plan phases (20261015100000_training_load_and_plan_phases.sql)

No new table and no new policy. New columns ride on the policies their tables already have: `session_completions.duration_minutes` (the athlete writes their own, a coach of the team or a club admin writes it when logging for the athlete), `sessions.planned_effort` and `training_plan_weeks.week_type` / `phase_name` (written by the plan's coach on publish, read by whoever reads the row today).

| Function | Athlete | Coach | Club admin | Other club, signed out |
|---|---|---|---|---|
| `training_load_weeks(team, athlete, as_of, weeks)` | Their own athlete record only, whatever they pass. | Athletes of the teams they coach. Another team: no rows. | Every athlete of the club. | No rows. `anon` has no execute. A deactivated member or a paused club: access paused error. |
| `training_load_sessions(athlete, from, to)` | Their own. | An athlete of a team they coach. | Any athlete of the club. | No rows. Same refusals. |
| `training_load_readable_athlete_ids()` | Helper for the two above. | | | |

Both are security definer with `search_path = public` and call `assert_caller_active()` first. Load is effort times minutes: training data, not health data. Every coach of the athlete's team reads it, and the functions keep that rule whatever happens to the row policies of the health tables.

Verified on a throwaway Postgres 16 (every earlier migration, then this one twice): 72 assertions. The numbers against hand-worked examples (weekly, acute, chronic, ratio, a week with no sessions, sessions with no minutes or no effort, under 4 weeks of history, the running day), and access as the athlete, a team mate, the team's coach, another team's coach, a coach of both teams, the club admin, another club's admin and coach, a deactivated coach, a suspended club and a token with no user.

## Session photos and videos (20261016110000)

| Object | Athlete (own) | Lead coach, coach of the athlete's team | Assistant of the team | Club admin | Other athlete, other team's coach, other club, guardian |
|---|---|---|---|---|---|
| `session_media` select | yes | yes | yes (sees training) | yes | no |
| `session_media` insert | yes | yes, when logging for the athlete | yes, when logging for the athlete | yes | no |
| `session_media` update (caption only, by trigger) | yes | only items they added | only items they added | only items they added | no |
| `session_media` delete | yes | only items they added | only items they added | yes | no |
| `set_session_media_comment()` | no | yes | no | yes | no |
| `storage.objects` in `session-media` select, insert | as the table | as the table | as the table | as the table | no |
| `storage.objects` in `session-media` delete | yes | files they uploaded | files they uploaded | yes | no |
| `get_session_media_usage()` | platform admins only | | | | |

One rule decides visibility for both the table and the bucket: `can_view_session_media_of(tenant, athlete)`. The bucket is private, there is no update policy, and paths must be `<tenant>/<athlete>/<session>/<file id>.<ext>`. Limits (6 per session, 200 per athlete, 50 MB, 30 seconds) are enforced by constraints and `session_media_before_insert`. Every deleted row queues its file in `storage_deletion_queue`. Guardians have no access.

## Push notifications (20261016120000_push_notifications.sql)

| Table | Select | Insert / update | Delete |
|---|---|---|---|
| `push_subscriptions` | Own rows only (`user_id = auth.uid()`), any role. No anon. A coach or club admin sees nobody else's devices. | Function only: `register_push_subscription` (signed in and active; the endpoint must be a known push service; takes the endpoint over from another account that used the same browser). | Own rows, also for a deactivated member or a paused club (it only removes something of their own). `remove_push_subscription(endpoint)` does the same by endpoint. |
| `push_deliveries` (the queue) | Nobody through the API. | Trigger on `notification_events` (in-app rows) and `send_test_push(own device)`. | Cascade. |
| `notification_preferences` | Unchanged policies; the channel check now also accepts `push`. | | |

Service role only: `claim_push_deliveries`, `complete_push_delivery`, `release_push_delivery`, `suppress_pending_push_deliveries`, `push_queue_due`, `push_notification_enabled`. Not callable from the browser: `request_push_dispatch`, `trim_push_history`, the trigger functions.

Held back at delivery time (marked suppressed with the reason): a paused or closed club, a member who is no longer active, push switched off for that kind of update, a device that was turned off, a notification already read in the app, anything older than 24 hours.

Deletion: both tables have `tenant_id` (cascade) and cascade from `auth.users`, so `delete_my_account` and `delete_closed_club` remove them with no change to those functions.

Verified on a throwaway Postgres 16 (every earlier migration, then this one twice): 155 assertions as athlete, team mate, the team's coach, another team's coach, club admin, another club's coach and athlete, a deactivated member, a suspended club, a platform admin and signed out, plus two sessions claiming at the same moment (no row handed out twice).

## Parent or guardian access (20261016090000_guardian_access.sql)

Rule: access is by invite from the club only. A lead or coach of the athlete's team, or a club admin, invites and revokes (`can_manage_athlete`). An assistant coach does not. A guardian cannot add or remove themselves. `profiles.role` now also accepts `guardian`; a guardian is never staff (`is_coach_or_admin`, `is_club_admin`, every `current_staff_*` and `current_coach_*` helper stay false or empty for them), never an athlete, takes no athlete or coach seat, and a profile cannot change to or from `guardian` (trigger `guard_guardian_role`), nor can an athlete record be linked to a guardian login (`guard_athlete_is_not_guardian`).

Scope helpers: `current_guardian_athlete_ids()` (active guardian profile, open club, active link, athlete still active in the club), `current_guardian_health_athlete_ids()` (the subset where `guardian_health_rule(athlete)` is `minor` or `adult_opted_in`; an adult who has not switched sharing on and an athlete with no date of birth are left out), `current_guardian_team_ids()`, `current_guardian_plan_ids()`, `current_guardian_test_week_ids()`, `current_guardian_competition_ids()`.

| Object | Guardian of the athlete | Guardian, health hidden | Lead or coach of the team | Assistant | Club admin | Athlete (own) | Anyone else, other club |
|---|---|---|---|---|---|---|---|
| `athlete_guardians` select | own links | own links | links of their athletes | no | whole club | links to themselves | no |
| `guardian_invites` select | no | no | invites of their athletes | no | whole club | no | no |
| both tables insert, update, delete | no (functions only) | no | no (functions only) | no | no (functions only) | no | no |
| `athletes`, `teams` (the child's rows only, no roster) | select | select | unchanged | unchanged | unchanged | unchanged | no |
| `training_plans` (published, assigned to the child), `training_plan_weeks`, `_days`, `_blocks` | select | select | unchanged | unchanged | unchanged | unchanged | no |
| `competitions`, `competition_entries`, `athlete_results`, `pr_records`, `athlete_goals` | select | select | unchanged | unchanged | unchanged | unchanged | no |
| `test_weeks`, `test_definitions`, `test_results` | select | select | unchanged | unchanged | unchanged | unchanged | no |
| `athlete_reports` shared with the athlete | select | select, except reports with a wellness or injuries section | unchanged | unchanged | unchanged | unchanged | no |
| `announcements` (the child's team, whole club; never "coaches") | select | select | unchanged | unchanged | unchanged | unchanged | no |
| `club_events`, `club_event_teams` (the child's team; whole club events were already open to members) | select | select | unchanged | unchanged | unchanged | unchanged | no |
| `wellness_entries`, `pain_reports`, `athlete_availability` | select | no | unchanged | unchanged | unchanged | unchanged | no |
| `sessions`, `athlete_attendance`, `athlete_private_details` | no policy. Read through `get_guardian_child_sessions`, `get_guardian_child_attendance`, `get_guardian_child_details`, which blank the skip reason, the attendance reason and the medical notes | same functions, health parts null | unchanged | unchanged | unchanged | unchanged | no |
| `coach_athlete_notes`, `message_threads`, `messages`, `team_coaches`, other `profiles`, `audit_events`, invites, every other table | no | no | unchanged | unchanged | unchanged | unchanged | no |
| any write to athlete data | no. Only `update_guardian_contact(athlete, name, phone, email)` | same | unchanged | unchanged | unchanged | unchanged | no |

Functions. Staff: `invite_guardian(athlete, email, name, relationship)` (links an existing guardian of the same club straight away, otherwise makes or refreshes one pending invite; refuses an email that is a coach, club admin, athlete, platform admin, approved club requestor or member of another club), `can_send_guardian_invite(invite)` (asked by `send-invite-email`), `revoke_guardian_link(link)`, `cancel_guardian_invite(invite)`, `get_athlete_guardians(athlete)`, `get_club_guardians()` (club admin). Invited person: `get_public_guardian_invite(invite)` (anon), `accept_guardian_invite(invite)` (confirmed, matching email; creates the guardian profile; accepts every open invite the club sent to that email). Guardian: `get_guardian_children()`, `guardian_athlete_plan_ids(athlete)`, `guardian_athlete_test_week_ids(athlete)`, `get_guardian_child_coaches(athlete)` (email only when the coach shows it to athletes), and the three read functions above. Athlete: `get_my_guardian_sharing()`, `set_my_guardian_health_sharing(on)` (the only way `athlete_private_details.share_health_with_guardians` changes). Internal, not callable from the browser: `guardian_email_standing` (service role only), `guardian_health_rule`, `notify_athlete_guardians`, `notify_guardians_of_plan`, the trigger functions.

Lifecycle: every helper goes through the same checks as the rest of the schema, so a deactivated guardian, a guardian of a paused, cancelled or closed club and a guardian whose link was revoked read nothing, at once. Deletion: `delete_my_account` has a guardian branch (links and invites to their email removed, athletes untouched, club admins not told); `purge_athlete_personal_data` and `delete_closed_club` need no change because both tables carry `athlete_id` and `tenant_id`; `install_deleted_account_triggers()` is run again for the three "on delete set null" columns.

Verified on a throwaway Postgres 16 (every earlier migration, then this one twice, and again with the later wave 4 migrations applied after it): 154 assertions as lead coach, assistant, another team's coach, club admin, another club, athlete, guardian of a minor, of an adult (opted in and not), of an athlete with no date of birth, a revoked guardian, a deactivated guardian, a paused club, signed out. One assertion lists every table of the schema a guardian can read a row from and compares it with the allowed list, so a table added later is closed unless it gets its own guardian policy.

## Result detail and relays (20261016100000_result_detail_splits_attempts_relays_rounds.sql)

Result detail (round, heat, lane, qualifier, and the `detail` jsonb with splits, reaction time, attempts or heights) is columns of `athlete_results`. It has no policy of its own: whoever reads or writes the result reads or writes its detail. The row trigger `athlete_results_apply_detail` checks it and computes the mark of a series, so a client cannot store a mark that disagrees with its attempts. A row with `derived_from_result_id` (the best wind legal attempt of a wind assisted series) is written by trigger only and follows its series.

| Table | Athlete | Coach or lead coach | Assistant coach | Club admin | Guardian | Other club, signed out |
| --- | --- | --- | --- | --- | --- | --- |
| `athlete_results` detail columns | same as the result (own rows) | same as the result (athletes of their teams) | reads, cannot write (as for results) | whole club | reads with the child's result through the existing `athlete_results_select_guardian`, mirrored on purpose, never writes | no |
| `relay_entries` | select the relays they ran a leg of | select relays of their teams and relays an athlete of theirs ran in; delete relays of a team they coach | select only | select and delete, whole club | no policy, no access | no |
| `relay_entry_legs` | select the legs of the relays they ran in | select with the relay | select only | select | no policy, no access | no |
| `relay_team_bests` (view, security invoker) | follows `relay_entries` | follows | follows | follows | nothing | no |

No insert or update grant on the relay tables. `save_relay_entry(jsonb)` is the only way to write one: club admin, or a lead coach or coach of the relay's team naming athletes they coach; four different athletes of the club; no leg split larger than the time; caller active. `get_relay_entries(competition, athlete)` returns the relays the caller may see with leg names ("Former member" for a leg whose athlete was deleted) and `can_manage`. `current_athlete_competition_ids()` now also includes competitions where the athlete runs a relay leg. A relay is never a row of `athlete_results` or `pr_records`.

Deletion: both tables carry `tenant_id` and go with the catalogue driven club deletion. Deleting an athlete (their own account or by a club admin) keeps the relay; `relay_entry_legs_keep_on_delete` turns the delete of the leg into a leg with no athlete. Deleting a competition keeps relays that were run (competition set to null) and drops teams that never ran. `install_deleted_account_triggers()` is run again for `entered_by_user_id`.

Verified on a throwaway Postgres 16 (every migration in order including the other wave 4 files, then this one twice more): 151 assertions as athlete, team mate, lead coach, assistant, another team's coach, club admin, another club, a deactivated coach, a paused club, signed out, a guardian (of a relay runner, of a runner from another team, and after the link is revoked).

## Global search (20261017100000_global_search.sql)

No new table and no new policy. `search_everything(p_query, p_limit)` is SECURITY INVOKER: every table is read through its existing row level security policies, so search finds what the caller can already select and nothing else. On top of the policies each role only gets the kinds its screens show, and the scope helpers narrow where a policy is wider than the screens.

| Role | What it can find | Narrowing on top of the policies |
| --- | --- | --- |
| Coach (lead, coach, assistant) | athletes (with team and squads), teams, plans, templates, library exercises, test weeks, competitions | athletes and teams only where `team_id = any(current_staff_team_ids())` (the teams policy shows a coach every team of the club; search does not). Active athletes only. The app hides plans, templates, exercises and competitions from an assistant, as their screens are |
| Club admin | staff and guardians by name (`profiles`), athletes, teams, athlete and coach invites by email, seasons, club events | `profiles.tenant_id = current_tenant_id()`. Guardian invites are not searched and a guardian's email or phone is never returned |
| Athlete | own sessions by name or day, own results by event, competitions they can see, own goals, the coaches of their team | `athlete_id = current_athlete_id()`. Coaches come from the existing `get_current_athlete_team_coaches()`; only name and team role are used |
| Guardian | linked children, the competitions of those children | `current_guardian_athlete_ids()`, `current_guardian_competition_ids()`. Nothing else, although the policies let a guardian read more |
| Platform admin | clubs and requests (`tenant_provision_requests`), platform admins | `is_platform_admin()`. Returns before any club table is read. `search_platform_admins()` is the one new SECURITY DEFINER function: a person can only select their own `platform_admin_contacts` row, so finding another platform admin needs it; it checks `is_platform_admin()` and returns nothing to anyone else |
| Deactivated member, paused or cancelled club, no profile, signed out | nothing | `current_app_role()` is null; `anon` has no execute grant |

Never returned or matched: wellness, pain reports, readiness, coach notes, session notes, message text, exercise cues, competition, result and goal notes, dates of birth, guardian contact details. The result columns are fixed (kind, id, title, subtitle, params, rank, sort_date).

Input: trimmed, inner spaces collapsed, cut at 80 characters, at least 2; only ever used as a value, with LIKE wildcards escaped. `search_fold()` (lower case, accents removed, immutable) and `search_rank()` (exact, starts with, a word starts with, inside) are shared by the query and by two guarded trigram indexes (`athletes_search_name_trgm_idx`, `sessions_search_title_trgm_idx`); without `pg_trgm` the file still applies and search uses the tenant indexes.

Verified on a throwaway Postgres 16 (every earlier migration, then this one twice): 74 assertions as coach of one team, of the other, of both, assistant, deactivated coach, club admin, athlete, guardian, a guardian with no link, platform admin, another club's coach and admin, a paused club, a person with no profile, signed out; plus accent and case folding, ordering, the per kind limit, literal `%` and `_`, injection text and an over long query.

## Platform admin tools (20261017110000_platform_admin_tools.sql)

Two new tables, neither a tenant table (a notice is for every club; a dismissal belongs to one login and cascades with it). Both have row level security on and no insert, update or delete grant for any API role: they are written through the functions only.

| Table | Athlete | Coach, assistant | Club admin | Guardian | Platform admin | Signed out |
| --- | --- | --- | --- | --- | --- | --- |
| `platform_notices` | no rows (reads go through `get_my_platform_notices()`) | no rows | no rows | no rows | select (`is_platform_admin()`) | no |
| `platform_notice_dismissals` | select own rows | select own rows | select own rows | select own rows | none of their own | no |
| `platform_admin_contacts` (new columns `added_by_email`, `deactivated_at`) | unchanged: own active row only | unchanged | unchanged | unchanged | own row by policy; the whole list only through `list_platform_admins()` | no |

Functions, all SECURITY DEFINER with `search_path = public`. Every one except the two banner functions raises 42501 unless `is_platform_admin()`, which a club admin, coach, assistant, athlete, guardian, a login with no role and a signed out caller all fail.

| Function | Who | What it returns or does |
| --- | --- | --- |
| `get_platform_club_overview(tenant)` | platform admin | One jsonb of facts and counts for support: owner and club admins (name, email), package, lifecycle, counts of teams, coaches, athletes, guardians, session media bytes, teams with their sizes, season, the newest sign-in per role, counts of plans, sessions logged in 28 days, test weeks, messages, announcements and failed emails, and the last 15 club log entries as action, role and time only (never target or detail, never an action about messages or health). No athlete name, health row, note, result or message text. Writes `platform_club_overview_opened` to `platform_audit_events` on every call |
| `list_platform_admins()`, `add_platform_admin(email, name)`, `set_platform_admin_active(id, bool)` | platform admin | Add is refused for an email that belongs to a club member (profile, athlete, guardian link, approved club request). Deactivate is refused for the last active admin and for the caller's own row; the table is locked so two admins cannot switch each other off at once. Reactivate is refused when the email has since joined a club. Every change is audited |
| `get_platform_usage(days)` | platform admin | 7, 28 or 90 days. Counts per club and sessions per week. The only person named is each club's owner |
| `send_platform_notice(...)`, `list_platform_notices()`, `withdraw_platform_notice(id)` | platform admin | Sending queues an in-app notification through `enqueue_notification` for active members of open clubs whose role the audience reaches, and an email to club admins only when asked. Withdrawing also dismisses the notification and suppresses unsent emails. Both audited |
| `get_my_platform_notices()` | any signed in member | Live notices (not withdrawn, not ended) whose audience reaches the caller's role (`current_app_role()`, so nothing for a deactivated member, a paused, cancelled or closed club, a platform admin or a login with no role), minus the ones the caller dismissed. Athletes and guardians: audience `everyone` only. Staff: coaches (assistants included) and club admins |
| `dismiss_platform_notice(id)` | any signed in member | Writes the caller's own dismissal, only for a notice their role is reached by |
| `get_platform_system_status()` | platform admin | Email, reminder, push and storage clean-up queue counts, schedule and last run, the newest migration when `supabase_migrations.schema_migrations` is readable, paused and closing clubs. Never the scheduler token |

Deliberate choices: a guardian and an athlete get a notice only when it is for everyone; an assistant coach counts as staff. Nothing here lets a platform admin act as a club member or read a club table directly.

Verified on a throwaway Postgres 16 (every earlier migration, then this one twice): 205 assertions. Each of the nine platform functions and direct writes to the three tables are refused for a club admin, coach, athlete, guardian, a login with no role and signed out; the overview's keys are checked against a fixed list and searched for planted note, message and audit text; last admin and self deactivate guards; club member email refused for each role; audience rules per role; a withdrawn or ended notice is gone for members of the same and of another club; audit rows for every change; deleting a login removes its dismissals.

## Units of measure (20261017090000_unit_preferences.sql)

A preference only. Stored loads, weights and heights stay metric; no measurement column is touched.

| Table | Athlete | Coach, assistant | Club admin | Guardian | Platform admin | Signed out |
| --- | --- | --- | --- | --- | --- | --- |
| `unit_preferences` | select, insert, update, delete own row only (`user_id = auth.uid()` and `tenant_id = current_tenant_id()`) | own row only | own row only (never a member's) | own row only | none (no club) | no |
| `club_unit_defaults` | select own club's row | select own club's row | select own club's row; writes only through `set_club_unit_defaults()` | select own club's row | none | no |

`set_club_unit_defaults(weight, height)`: SECURITY DEFINER, `search_path = public`, calls `assert_caller_active()`, club admins only (42501 otherwise), refuses an unknown unit, writes one `audit_events` line when the default really changes.

Deliberate choices: nobody reads another person's choice, not their coach and not their club admin (what a person reads in is theirs). A guardian reads their child's data in the guardian's own units. An assistant coach is like any member. A deactivated member and a member of a suspended or cancelled club read and write nothing (`current_tenant_id()` is null). `tenant_id` on a person's row is filled in by the database and cannot be moved to another club.

Deleting: `unit_preferences.user_id` cascades from `auth.users`, so a row goes with the account; both tables carry `tenant_id` with a cascade, so `delete_closed_club()` sweeps them. No column points at `auth.users` with set null.

Verified on a throwaway Postgres 16 (every migration before it, then this one twice): 69 assertions. Own row read and written by an athlete, coach, guardian and club admin; refused or empty for another athlete, the team coach, another team's coach, the club admin, a guardian, another club and signed out; a row cannot be written for someone else, filed under or moved to another club; a deactivated member and a suspended club are refused; the club default is set by either club admin, read by every role of that club only, refused for a coach, athlete, guardian, signed out and by direct table writes; audited once per real change; `delete_my_account()` removes the row; `delete_closed_club()` leaves nothing of the club in any table with a `tenant_id`.


## Edit conflicts and the guardian login hint (20261017120000)

No new table and no policy change.

| Column | Athlete | Coach, assistant | Club admin | Guardian | Platform admin | Signed out |
| --- | --- | --- | --- | --- | --- | --- |
| `training_plans.updated_by_user_id`, `test_weeks.updated_by_user_id`, `teams.updated_by_user_id`, `club_profiles.updated_by_user_id` | read where the row's own select policy already lets them read the row; never written by anyone | same | same | same | same | no |

The column is stamped by the trigger `stamp_updated_by()` (not security definer) with `auth.uid()` on every insert and update, so a caller cannot name someone else as the last editor, and a change by the server leaves it empty. The app saves these four records with `where updated_at = <the value it loaded>`; who may update a row is still decided only by the tables' existing update policies (a coach of another team, another club and an athlete still match no row). The name shown in "Andre changed this plan" comes from `profiles.display_name` under its existing policy.

`bootstrap_current_profile()`: same function, same grants (authenticated and service role, not anon). It now also returns `invite_pending` for a pending, unexpired `guardian_invites` row addressed to the caller's confirmed email. It still creates a profile only for the requestor of an approved club request, never from an invite, and returns no club or role with `invite_pending`.

Deleting: the new columns reference `auth.users` with "set null"; the migration ends with `install_deleted_account_triggers()`, so deleting the account that made the last change blanks them.

Verified on a throwaway Postgres 16 (every migration before it, then this one twice): 54 assertions. Stale saves match no row for plans, test weeks, teams and the club profile; the last editor is stamped and cannot be spoofed; another team's coach, another club and an athlete cannot save or read the stamp; a server change leaves it empty; a deleted account is not stamped back; guardian invites give `invite_pending` only when pending, unexpired and for a confirmed email.

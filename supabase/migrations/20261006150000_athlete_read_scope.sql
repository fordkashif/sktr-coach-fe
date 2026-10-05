-- SKTR Coach: athletes only read what their own screens show
-- Created: 2026-10-06
--
-- 20261006120000_coach_team_scope.sql limited coaches to their teams and left athletes alone.
-- Through the database API an athlete could still read every athlete invite of the club (with the
-- invited email addresses), every published or archived training plan, every test week of every
-- team (drafts included), every team name and the club's billing profile, and could write test
-- results into closed, draft, archived or other teams' test weeks.
--
-- The rule now, for athletes only:
--   * Teams: their own team.
--   * Athlete invites: only invites addressed to their own email address.
--   * Training plans (and weeks, days, blocks): published AND assigned to them or to their team.
--   * Test weeks (and their tests): their own team's weeks that are published or closed and not
--     archived, plus any week in which they already have a result of their own (so their own
--     history keeps its labels after a coach archives a week or after they change team). Never
--     another team's week, never a draft they have no result in.
--   * Test results: they may add or change their own results only while the week is OPEN:
--     it belongs to their current team, its status is 'published', it is not archived and its
--     start date has been reached. There is no cut-off at the end date: a late entry is accepted
--     until the coach closes the week (that is how the athlete screen already behaves).
--   * Sessions created by a late joiner: only from a published plan assigned to them or their team.
--   * Billing profile and audit log writes: staff only.
--
-- Coaches, club admins and platform admins: nothing changes. Every staff branch below is copied
-- from the newest definition of the policy (20261006120000 unless noted). Two kinds of edits touch
-- staff policy text without changing what staff can do, and each is explained where it happens:
--   * the select policies of the tables under a plan or a test week now hold the athlete rule
--     only, because staff already read those tables through their *_staff_all policy;
--   * those *_staff_all policies gain a leading "is this user staff at all?" check.
--
-- Two leftovers from 20261006120000 are closed as well:
--   * a club admin could insert a team_coaches row pointing at another club's team;
--   * deleting a team that still had a team-wide plan assignment failed with a raw constraint error.
--
-- The athlete helpers answer null / empty for anyone who is not an active athlete of an open
-- club, the same way the helpers in 20261005180000 and 20261006120000 do.
--
-- Performance: (select public.current_athlete_...()) is evaluated once per statement (a handful of
-- index lookups); each row is then compared with that short list, which can drive an index scan.
--
-- Idempotent. No data changes, no drops of tables or columns.

-- 1. Indexes ------------------------------------------------------------------------------

-- training_plan_assignments (athlete_id) and (team_id), test_weeks (team_id) and
-- test_results (tenant_id, athlete_id, submitted_at) already exist. They are repeated here so this
-- migration does not depend on them silently.
create index if not exists training_plan_assignments_athlete_idx
on public.training_plan_assignments (athlete_id);

create index if not exists training_plan_assignments_team_idx
on public.training_plan_assignments (team_id);

create index if not exists test_weeks_team_idx
on public.test_weeks (team_id);

-- New: invites are now looked up by the normalised email address (also used by bootstrap_current_profile).
create index if not exists athlete_invites_email_lower_idx
on public.athlete_invites (lower(btrim(email)));

-- 2. Helpers ------------------------------------------------------------------------------

-- The athletes row of the signed-in user, when they are an active athlete of an open club.
create or replace function public.current_athlete_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id
  from public.profiles p
  join public.athletes a
    on a.tenant_id = p.tenant_id
   and a.user_id = p.user_id
  where p.user_id = auth.uid()
    and p.role = 'athlete'
    and p.is_active
    and (
      select tpr.lifecycle_status in ('suspended', 'cancelled')
      from public.tenant_provision_requests tpr
      where tpr.provisioned_tenant_id = p.tenant_id
      order by tpr.created_at desc
      limit 1
    ) is distinct from true
  limit 1
$$;

-- The team that athlete is on right now. Null when they have no team.
create or replace function public.current_athlete_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.team_id
  from public.athletes a
  where a.id = public.current_athlete_id()
$$;

-- The signed-in athlete's own email address, normalised. Read from auth.users (the same source
-- accept_athlete_invite uses), not from the token, so a changed address is picked up at once.
create or replace function public.current_athlete_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(lower(btrim(au.email)), '')
  from auth.users au
  where au.id = auth.uid()
    and public.current_athlete_id() is not null
$$;

-- Published plans assigned to the signed-in athlete, directly or through their current team.
create or replace function public.current_athlete_plan_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select a.id, a.team_id, a.tenant_id
    from public.athletes a
    where a.id = public.current_athlete_id()
  ),
  assigned as (
    select tpa.plan_id
    from me
    join public.training_plan_assignments tpa
      on tpa.athlete_id = me.id
     and tpa.tenant_id = me.tenant_id
    union
    select tpa.plan_id
    from me
    join public.training_plan_assignments tpa
      on tpa.team_id = me.team_id
     and tpa.tenant_id = me.tenant_id
  )
  select coalesce(array_agg(tp.id), '{}'::uuid[])
  from assigned
  join public.training_plans tp
    on tp.id = assigned.plan_id
  where tp.status = 'published'
    and tp.tenant_id = (select me.tenant_id from me)
$$;

-- The weeks of those plans, and the days of those weeks, as lists. The policies of
-- training_plan_days and training_plan_blocks compare against these instead of walking up to the
-- plan through three nested policies for every row.
create or replace function public.current_athlete_plan_week_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(tpw.id), '{}'::uuid[])
  from public.training_plan_weeks tpw
  where tpw.plan_id = any (public.current_athlete_plan_ids())
$$;

create or replace function public.current_athlete_plan_day_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(tpd.id), '{}'::uuid[])
  from public.training_plan_weeks tpw
  join public.training_plan_days tpd
    on tpd.plan_week_id = tpw.id
  where tpw.plan_id = any (public.current_athlete_plan_ids())
$$;

-- Test weeks the signed-in athlete may read: their current team's published or closed weeks that
-- are not archived, plus weeks in which they already have a result of their own.
create or replace function public.current_athlete_test_week_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select a.id, a.team_id, a.tenant_id
    from public.athletes a
    where a.id = public.current_athlete_id()
  ),
  weeks as (
    select tw.id
    from me
    join public.test_weeks tw
      on tw.team_id = me.team_id
     and tw.tenant_id = me.tenant_id
    where tw.status in ('published', 'closed')
      and not tw.is_archived
    union
    select tr.test_week_id
    from me
    join public.test_results tr
      on tr.tenant_id = me.tenant_id
     and tr.athlete_id = me.id
  )
  select coalesce(array_agg(weeks.id), '{}'::uuid[])
  from weeks
$$;

-- True when the signed-in athlete may add or change their own result for this test in this week:
-- the week belongs to their current team, is published, is not archived and has started, and the
-- test belongs to that week. One day of slack on the start date covers athletes whose local date
-- is ahead of the database (UTC). No cut-off at the end date: the coach closes the week.
create or replace function public.athlete_can_enter_test_result(
  p_test_week_id uuid,
  p_test_definition_id uuid,
  p_athlete_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_athlete_id is not null
    and p_athlete_id = public.current_athlete_id()
    and exists (
      select 1
      from public.athletes a
      join public.test_weeks tw
        on tw.team_id = a.team_id
       and tw.tenant_id = a.tenant_id
      join public.test_definitions td
        on td.test_week_id = tw.id
      where a.id = p_athlete_id
        and tw.id = p_test_week_id
        and td.id = p_test_definition_id
        and tw.status = 'published'
        and not tw.is_archived
        and tw.start_date <= (now() at time zone 'utc')::date + 1
    )
$$;

-- What the join screen needs to show for an invite code, without reading athlete_invites.
-- Only invites of the caller's own club. The invited email address is never returned, only
-- whether the invite is usable by the caller (not addressed, or addressed to their own email).
create or replace function public.get_athlete_invite_preview(p_invite_id uuid)
returns table (
  invite_id uuid,
  team_id uuid,
  team_name text,
  event_group text,
  status text,
  expires_at timestamptz,
  is_for_caller boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ai.id as invite_id,
    ai.team_id,
    t.name as team_name,
    t.event_group,
    ai.status,
    ai.expires_at,
    (
      nullif(lower(btrim(coalesce(ai.email, ''))), '') is null
      or lower(btrim(ai.email)) = (
        select lower(btrim(au.email))
        from auth.users au
        where au.id = auth.uid()
      )
    ) as is_for_caller
  from public.athlete_invites ai
  join public.teams t
    on t.id = ai.team_id
   and t.tenant_id = ai.tenant_id
  where ai.id = p_invite_id
    and ai.tenant_id = public.current_tenant_id()
  limit 1
$$;

revoke all on function public.current_athlete_id() from public, anon;
revoke all on function public.current_athlete_team_id() from public, anon;
revoke all on function public.current_athlete_email() from public, anon;
revoke all on function public.current_athlete_plan_ids() from public, anon;
revoke all on function public.current_athlete_plan_week_ids() from public, anon;
revoke all on function public.current_athlete_plan_day_ids() from public, anon;
revoke all on function public.current_athlete_test_week_ids() from public, anon;
revoke all on function public.athlete_can_enter_test_result(uuid, uuid, uuid) from public, anon;
revoke all on function public.get_athlete_invite_preview(uuid) from public, anon;

grant execute on function public.current_athlete_id() to authenticated, service_role;
grant execute on function public.current_athlete_team_id() to authenticated, service_role;
grant execute on function public.current_athlete_email() to authenticated, service_role;
grant execute on function public.current_athlete_plan_ids() to authenticated, service_role;
grant execute on function public.current_athlete_plan_week_ids() to authenticated, service_role;
grant execute on function public.current_athlete_plan_day_ids() to authenticated, service_role;
grant execute on function public.current_athlete_test_week_ids() to authenticated, service_role;
grant execute on function public.athlete_can_enter_test_result(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.get_athlete_invite_preview(uuid) to authenticated, service_role;

-- 3. Teams --------------------------------------------------------------------------------

-- Before: an athlete could read every team of the club (names, event groups, archived teams).
-- Staff branch: unchanged (every coach and club admin reads the club's teams).
drop policy if exists teams_select_tenant on public.teams;
create policy teams_select_tenant
on public.teams
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_coach_or_admin())
    or id = (select public.current_athlete_team_id())
  )
);

-- Before: a club admin could add a coach to a team of ANOTHER club (it granted nothing, the
-- helpers join on the club, but the row should never exist).
drop policy if exists team_coaches_modify_admin on public.team_coaches;
create policy team_coaches_modify_admin
on public.team_coaches
for all
to authenticated
using (public.is_club_admin() and tenant_id = public.current_tenant_id())
with check (
  public.is_club_admin()
  and tenant_id = public.current_tenant_id()
  and exists (
    select 1
    from public.teams t
    where t.id = team_coaches.team_id
      and t.tenant_id = team_coaches.tenant_id
  )
);

-- Before: deleting a team with a team-wide plan assignment failed with a raw constraint error
-- (training_plan_assignments_check), and deleting a team with athletes, plans or test weeks
-- silently left them without a team. The app only offers Archive; a direct delete of a team that
-- is still in use is now refused with a message that says what to do.
create or replace function public.prevent_delete_of_team_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.athletes a where a.team_id = old.id)
     or exists (select 1 from public.training_plans tp where tp.team_id = old.id)
     or exists (select 1 from public.training_plan_assignments tpa where tpa.team_id = old.id)
     or exists (select 1 from public.test_weeks tw where tw.team_id = old.id) then
    raise exception 'This team still has athletes, training plans or test weeks, so it cannot be deleted. Archive the team instead.'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_delete_of_team_in_use() from public, anon, authenticated;

drop trigger if exists prevent_delete_of_team_in_use on public.teams;
create trigger prevent_delete_of_team_in_use
before delete on public.teams
for each row
execute function public.prevent_delete_of_team_in_use();

-- 4. Athlete invites ----------------------------------------------------------------------

-- Before: an athlete could read every athlete invite of the club, invited email addresses included.
-- Now only invites addressed to their own email. The join screen uses get_athlete_invite_preview().
-- Staff branches: unchanged.
drop policy if exists athlete_invites_select_tenant on public.athlete_invites;
create policy athlete_invites_select_tenant
on public.athlete_invites
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    lower(btrim(email)) = (select public.current_athlete_email())
    or (select public.is_club_admin())
    or team_id = any ((select public.current_coach_team_ids())::uuid[])
  )
);

-- 5. Training plans -----------------------------------------------------------------------

-- Before: an athlete could read every published or archived plan of the club (builder state included).
-- Staff branches: unchanged.
drop policy if exists training_plans_select_tenant on public.training_plans;
create policy training_plans_select_tenant
on public.training_plans
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (status = 'published' and id = any ((select public.current_athlete_plan_ids())::uuid[]))
    or (select public.is_club_admin())
    or (team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
    or (team_id is null and created_by_user_id = auth.uid() and (select public.is_coach_or_admin()))
  )
);

-- Before: an athlete could read the weeks, days and blocks of every published or archived plan of
-- the club. These three select policies used to say "any plan of my club that I can read", for
-- every role. Staff never needed them: the *_staff_all policies below already let a coach or club
-- admin read exactly the plans they can read (can_manage_training_plan() and the staff branches
-- of training_plans_select_tenant accept the same plans). So the select policies now carry the
-- athlete rule only, as a direct comparison with a short list.
drop policy if exists training_plan_weeks_select_tenant on public.training_plan_weeks;
create policy training_plan_weeks_select_tenant
on public.training_plan_weeks
for select
to authenticated
using (plan_id = any ((select public.current_athlete_plan_ids())::uuid[]));

drop policy if exists training_plan_days_select_tenant on public.training_plan_days;
create policy training_plan_days_select_tenant
on public.training_plan_days
for select
to authenticated
using (plan_week_id = any ((select public.current_athlete_plan_week_ids())::uuid[]));

drop policy if exists training_plan_blocks_select_tenant on public.training_plan_blocks;
create policy training_plan_blocks_select_tenant
on public.training_plan_blocks
for select
to authenticated
using (plan_day_id = any ((select public.current_athlete_plan_day_ids())::uuid[]));

-- Same rule as 20261006120000 for staff. The only addition is the leading
-- (select public.is_coach_or_admin()): it is true for everyone can_manage_training_plan() can be
-- true for, and it stops the per-row function call for athletes (opening one 8 week plan took an
-- athlete about 1.5 seconds on a club with a few thousand plans; it is now a few milliseconds).
drop policy if exists training_plan_weeks_staff_all on public.training_plan_weeks;
create policy training_plan_weeks_staff_all
on public.training_plan_weeks
for all
to authenticated
using ((select public.is_coach_or_admin()) and public.can_manage_training_plan(plan_id))
with check ((select public.is_coach_or_admin()) and public.can_manage_training_plan(plan_id));

drop policy if exists training_plan_days_staff_all on public.training_plan_days;
create policy training_plan_days_staff_all
on public.training_plan_days
for all
to authenticated
using (
  (select public.is_coach_or_admin())
  and exists (
    select 1
    from public.training_plan_weeks tpw
    where tpw.id = plan_week_id
      and public.can_manage_training_plan(tpw.plan_id)
  )
)
with check (
  (select public.is_coach_or_admin())
  and exists (
    select 1
    from public.training_plan_weeks tpw
    where tpw.id = plan_week_id
      and public.can_manage_training_plan(tpw.plan_id)
  )
);

drop policy if exists training_plan_blocks_staff_all on public.training_plan_blocks;
create policy training_plan_blocks_staff_all
on public.training_plan_blocks
for all
to authenticated
using (
  (select public.is_coach_or_admin())
  and exists (
    select 1
    from public.training_plan_days tpd
    join public.training_plan_weeks tpw on tpw.id = tpd.plan_week_id
    where tpd.id = plan_day_id
      and public.can_manage_training_plan(tpw.plan_id)
  )
)
with check (
  (select public.is_coach_or_admin())
  and exists (
    select 1
    from public.training_plan_days tpd
    join public.training_plan_weeks tpw on tpw.id = tpd.plan_week_id
    where tpd.id = plan_day_id
      and public.can_manage_training_plan(tpw.plan_id)
  )
);

-- Before: an athlete could create sessions for themselves from ANY published plan of the club.
-- Same policy as 20261005180000 plus: the plan must be one assigned to them or to their team.
drop policy if exists sessions_insert_own_from_plan on public.sessions;
create policy sessions_insert_own_from_plan
on public.sessions
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and status = 'scheduled'
  and plan_id is not null
  and plan_week_number is not null
  and plan_day_index is not null
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
  and plan_id = any ((select public.current_athlete_plan_ids())::uuid[])
  and exists (
    select 1
    from public.training_plans tp
    where tp.id = sessions.plan_id
      and tp.tenant_id = public.current_tenant_id()
      and tp.status = 'published'
  )
);

-- 6. Test weeks ---------------------------------------------------------------------------

-- Before: an athlete could read every test week of every team in the club, drafts and archived
-- weeks included. Staff branches: unchanged.
drop policy if exists test_weeks_select_tenant on public.test_weeks;
create policy test_weeks_select_tenant
on public.test_weeks
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    id = any ((select public.current_athlete_test_week_ids())::uuid[])
    or (select public.is_club_admin())
    or (team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
    or (team_id is null and created_by_user_id = auth.uid() and (select public.is_coach_or_admin()))
  )
);

-- Before: an athlete could read the tests of every test week in the club (through the policy above).
-- As with the plan tables: staff read test definitions through test_definitions_staff_all, so this
-- select policy now carries the athlete rule only.
drop policy if exists test_definitions_select_tenant on public.test_definitions;
create policy test_definitions_select_tenant
on public.test_definitions
for select
to authenticated
using (test_week_id = any ((select public.current_athlete_test_week_ids())::uuid[]));

-- Same rule as 20261006120000 for staff, with the leading staff check that spares athletes the
-- per-row function call (see training_plan_weeks_staff_all above).
drop policy if exists test_definitions_staff_all on public.test_definitions;
create policy test_definitions_staff_all
on public.test_definitions
for all
to authenticated
using ((select public.is_coach_or_admin()) and public.can_manage_test_week(test_week_id))
with check ((select public.is_coach_or_admin()) and public.can_manage_test_week(test_week_id));

-- Before: an athlete could add a result of their own to any test week of the club: a draft, a
-- closed or archived week, a week that has not started, or another team's week, and could attach
-- it to a test that belongs to a different week.
drop policy if exists test_results_write_own on public.test_results;
create policy test_results_write_own
on public.test_results
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
  and public.athlete_can_enter_test_result(test_week_id, test_definition_id, athlete_id)
);

-- Before: an athlete could change their own result in a closed or archived week.
drop policy if exists test_results_update_own on public.test_results;
create policy test_results_update_own
on public.test_results
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
  and public.athlete_can_enter_test_result(test_week_id, test_definition_id, athlete_id)
)
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
  and public.athlete_can_enter_test_result(test_week_id, test_definition_id, athlete_id)
);

-- 7. Club records an athlete has no screen for ----------------------------------------------

-- Before: an athlete could read the club's billing profile (package, seats, renewal date, last
-- four digits of the payment method). Coaches and club admins: unchanged.
drop policy if exists billing_profiles_select_tenant on public.billing_profiles;
create policy billing_profiles_select_tenant
on public.billing_profiles
for select
to authenticated
using ((select public.is_coach_or_admin()) and tenant_id = public.current_tenant_id());

-- Before: an athlete could write rows into the club's audit log under any actor name.
-- Coaches and club admins: unchanged. Invite acceptance writes its audit row inside a
-- security definer function and is not affected.
drop policy if exists audit_events_insert_tenant on public.audit_events;
create policy audit_events_insert_tenant
on public.audit_events
for insert
to authenticated
with check ((select public.is_coach_or_admin()) and tenant_id = public.current_tenant_id());

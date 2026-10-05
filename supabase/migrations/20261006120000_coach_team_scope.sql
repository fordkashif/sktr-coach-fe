-- SKTR Coach: coaches only act on the teams they are assigned to
-- Created: 2026-10-06
--
-- Before this migration most staff policies only asked "is this user a coach or club admin of
-- this club?" (is_coach_or_admin()). So Coach Rivera (Sprints) could invite athletes to, read the
-- wellness of, and rewrite the plans of Coach Smith's team (Throws).
--
-- The rule now:
--   * Club admins: unchanged, full access inside their own club.
--   * Coaches: read and write only what belongs to a team they have a team_coaches row for
--     (the lead coach is a team_coaches row with is_primary = true, so lead counts as assigned),
--     or to an athlete who is currently on such a team.
--   * Athletes with no team (team_id is null): club admins only.
--   * A plan or test week with no team yet: its creator (coach) and club admins.
--   * A coach with no team assignment sees and changes nothing team related (zero rows, no error).
--   * Athletes: unchanged.
--   * Deliberately still club wide for coaches: the list of teams (name, event group), their own
--     team_coaches rows, member profiles and the club audit log.
--
-- The new helpers read profiles the same way the helpers in 20261005180000 do, so a deactivated
-- member or a member of a suspended or cancelled club is refused here as well.
--
-- Performance: nothing in the policies of the large tables runs once per row.
--   * (select public.is_club_admin()) is evaluated once per statement, so club admins pay nothing per row.
--   * For coaches, (select public.current_coach_team_ids()) and (select public.current_coach_athlete_ids())
--     are also evaluated once per statement (two or three index lookups in total); each row is then
--     compared against that short list, and Postgres can use the list to drive an index scan.
--   * is_team_coach(), is_coach_of_athlete() and the can_manage_*() helpers take an id and are used
--     where a single row is checked (the tables under a plan or a test week, the functions, the
--     invite email function). Each is one or two primary key or unique index probes.
--
-- Idempotent. No data changes, no drops of tables or columns.

-- 1. Indexes ------------------------------------------------------------------------------

-- unique (team_id, user_id) already exists from 20260324133000; this is the reverse order.
create index if not exists team_coaches_user_team_idx
on public.team_coaches (user_id, team_id);

create index if not exists test_weeks_team_idx
on public.test_weeks (team_id);

-- athletes (team_id) and training_plans (team_id) are already indexed
-- (athletes_team_idx, training_plans_team_idx).

-- 2. Helpers ------------------------------------------------------------------------------

-- True when the signed-in user is an active coach assigned to this team.
create or replace function public.is_team_coach(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_coaches tc
    join public.teams t
      on t.id = tc.team_id
     and t.tenant_id = tc.tenant_id
    join public.profiles p
      on p.user_id = tc.user_id
     and p.tenant_id = tc.tenant_id
    where tc.team_id = p_team_id
      and tc.user_id = auth.uid()
      and p.role in ('coach', 'club-admin')
      and p.is_active
      and (
        select tpr.lifecycle_status in ('suspended', 'cancelled')
        from public.tenant_provision_requests tpr
        where tpr.provisioned_tenant_id = p.tenant_id
        order by tpr.created_at desc
        limit 1
      ) is distinct from true
  )
$$;

-- True when the signed-in user is an active coach assigned to the team this athlete is on.
-- An athlete with no team has no coach.
create or replace function public.is_coach_of_athlete(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.athletes a
    join public.team_coaches tc
      on tc.team_id = a.team_id
     and tc.tenant_id = a.tenant_id
    join public.profiles p
      on p.user_id = tc.user_id
     and p.tenant_id = tc.tenant_id
    where a.id = p_athlete_id
      and tc.user_id = auth.uid()
      and p.role in ('coach', 'club-admin')
      and p.is_active
      and (
        select tpr.lifecycle_status in ('suspended', 'cancelled')
        from public.tenant_provision_requests tpr
        where tpr.provisioned_tenant_id = p.tenant_id
        order by tpr.created_at desc
        limit 1
      ) is distinct from true
  )
$$;

-- The teams the signed-in user actively coaches, as one list. Empty for everyone else.
create or replace function public.current_coach_team_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(tc.team_id), '{}'::uuid[])
  from public.team_coaches tc
  join public.teams t
    on t.id = tc.team_id
   and t.tenant_id = tc.tenant_id
  join public.profiles p
    on p.user_id = tc.user_id
   and p.tenant_id = tc.tenant_id
  where tc.user_id = auth.uid()
    and p.role in ('coach', 'club-admin')
    and p.is_active
    and (
      select tpr.lifecycle_status in ('suspended', 'cancelled')
      from public.tenant_provision_requests tpr
      where tpr.provisioned_tenant_id = p.tenant_id
      order by tpr.created_at desc
      limit 1
    ) is distinct from true
$$;

-- The athletes currently on those teams, as one list. Empty for everyone else.
create or replace function public.current_coach_athlete_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(a.id), '{}'::uuid[])
  from public.athletes a
  join public.teams t
    on t.id = a.team_id
   and t.tenant_id = a.tenant_id
  where a.team_id = any (public.current_coach_team_ids())
$$;

-- Club admin of the team's club, or a coach assigned to the team.
create or replace function public.can_manage_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team_id is not null
    and (
      public.is_team_coach(p_team_id)
      or (
        public.is_club_admin()
        and exists (
          select 1
          from public.teams t
          where t.id = p_team_id
            and t.tenant_id = public.current_tenant_id()
        )
      )
    )
$$;

-- Club admin of the athlete's club, or a coach assigned to the athlete's team.
create or replace function public.can_manage_athlete(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_athlete_id is not null
    and (
      public.is_coach_of_athlete(p_athlete_id)
      or (
        public.is_club_admin()
        and exists (
          select 1
          from public.athletes a
          where a.id = p_athlete_id
            and a.tenant_id = public.current_tenant_id()
        )
      )
    )
$$;

-- Club admin, a coach assigned to the plan's team, or (plan with no team yet) the coach who created it.
create or replace function public.can_manage_training_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.training_plans tp
    where tp.id = p_plan_id
      and tp.tenant_id = public.current_tenant_id()
      and (
        public.is_club_admin()
        or (tp.team_id is not null and public.is_team_coach(tp.team_id))
        or (tp.team_id is null and tp.created_by_user_id = auth.uid() and public.is_coach_or_admin())
      )
  )
$$;

-- Club admin, a coach assigned to the test week's team, or (week with no team) the coach who created it.
create or replace function public.can_manage_test_week(p_test_week_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.test_weeks tw
    where tw.id = p_test_week_id
      and tw.tenant_id = public.current_tenant_id()
      and (
        public.is_club_admin()
        or (tw.team_id is not null and public.is_team_coach(tw.team_id))
        or (tw.team_id is null and tw.created_by_user_id = auth.uid() and public.is_coach_or_admin())
      )
  )
$$;

revoke all on function public.current_coach_team_ids() from public, anon;
revoke all on function public.current_coach_athlete_ids() from public, anon;
revoke all on function public.is_team_coach(uuid) from public, anon;
revoke all on function public.is_coach_of_athlete(uuid) from public, anon;
revoke all on function public.can_manage_team(uuid) from public, anon;
revoke all on function public.can_manage_athlete(uuid) from public, anon;
revoke all on function public.can_manage_training_plan(uuid) from public, anon;
revoke all on function public.can_manage_test_week(uuid) from public, anon;

grant execute on function public.current_coach_team_ids() to authenticated, service_role;
grant execute on function public.current_coach_athlete_ids() to authenticated, service_role;
grant execute on function public.is_team_coach(uuid) to authenticated, service_role;
grant execute on function public.is_coach_of_athlete(uuid) to authenticated, service_role;
grant execute on function public.can_manage_team(uuid) to authenticated, service_role;
grant execute on function public.can_manage_athlete(uuid) to authenticated, service_role;
grant execute on function public.can_manage_training_plan(uuid) to authenticated, service_role;
grant execute on function public.can_manage_test_week(uuid) to authenticated, service_role;

-- 3. Teams --------------------------------------------------------------------------------
-- teams_select_tenant is left as it is: every member of a club can read the club's team names.

-- Before: any coach could create, rename, archive or delete any team in the club.
drop policy if exists teams_modify_tenant_staff on public.teams;
create policy teams_modify_tenant_staff
on public.teams
for all
to authenticated
using ((select public.is_club_admin()) and tenant_id = public.current_tenant_id())
with check ((select public.is_club_admin()) and tenant_id = public.current_tenant_id());

-- New: a coach may still edit the details of a team they are assigned to (not create or delete teams).
drop policy if exists teams_update_assigned_coach on public.teams;
create policy teams_update_assigned_coach
on public.teams
for update
to authenticated
using (tenant_id = public.current_tenant_id() and id = any ((select public.current_coach_team_ids())::uuid[]))
with check (tenant_id = public.current_tenant_id() and id = any ((select public.current_coach_team_ids())::uuid[]));

-- 4. Athletes -----------------------------------------------------------------------------

-- Before: any coach could read every athlete in the club (name, date of birth, readiness).
drop policy if exists athletes_select_tenant_staff on public.athletes;
create policy athletes_select_tenant_staff
on public.athletes
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
);

-- Before: any coach could add, edit, move to any team, or delete any athlete in the club.
drop policy if exists athletes_modify_tenant_staff on public.athletes;
create policy athletes_modify_tenant_staff
on public.athletes
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
);

-- Taking an athlete off a team leaves them with no team, which a coach may not write directly
-- any more (athletes with no team belong to club admins). This function is the one way a coach
-- does it, and only for a team they are assigned to. Returns false when nothing was changed
-- (not on that team, or not allowed), so it cannot be used to probe other teams.
create or replace function public.remove_athlete_from_team(p_athlete_id uuid, p_team_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_athlete_id is null or p_team_id is null or not public.can_manage_team(p_team_id) then
    return false;
  end if;

  update public.athletes
  set team_id = null,
      updated_at = now()
  where id = p_athlete_id
    and team_id = p_team_id
    and tenant_id = public.current_tenant_id();

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.remove_athlete_from_team(uuid, uuid) from public, anon;
grant execute on function public.remove_athlete_from_team(uuid, uuid) to authenticated, service_role;

-- The package limit on athletes is checked against the whole club before an invite is created.
-- A coach can no longer count athletes outside their teams, so this gives staff the club total
-- (a number only, no athlete data). Null for anyone who is not active staff.
create or replace function public.current_tenant_athlete_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_coach_or_admin() then (
      select count(*)::int
      from public.athletes a
      where a.tenant_id = public.current_tenant_id()
    )
  end
$$;

revoke all on function public.current_tenant_athlete_count() from public, anon;
grant execute on function public.current_tenant_athlete_count() to authenticated, service_role;

-- 5. Athlete invites ----------------------------------------------------------------------

-- Before: any coach could read every team's invites (invited email addresses included).
-- Athletes keep the club-wide read they had: the join-by-code screen looks an invite up by its id.
drop policy if exists athlete_invites_select_tenant on public.athlete_invites;
create policy athlete_invites_select_tenant
on public.athlete_invites
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.current_app_role()) = 'athlete'
    or (select public.is_club_admin())
    or team_id = any ((select public.current_coach_team_ids())::uuid[])
  )
);

-- Before: any coach could invite athletes to, and revoke or delete the invites of, any team.
drop policy if exists athlete_invites_staff_all on public.athlete_invites;
create policy athlete_invites_staff_all
on public.athlete_invites
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
);

-- 6. Sessions and what athletes log -------------------------------------------------------

-- Before: any coach could read every athlete's sessions in the club.
drop policy if exists sessions_select_tenant_staff on public.sessions;
create policy sessions_select_tenant_staff
on public.sessions
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

-- Before: any coach could create, edit (coach note included) or delete sessions of any athlete in the club.
drop policy if exists sessions_modify_tenant_staff on public.sessions;
create policy sessions_modify_tenant_staff
on public.sessions
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

-- Before: any coach could read and rewrite the blocks of any session in the club.
drop policy if exists session_blocks_staff_all on public.session_blocks;
create policy session_blocks_staff_all
on public.session_blocks
for all
to authenticated
using (
  exists (
    select 1
    from public.sessions s
    where s.id = session_id
      and s.tenant_id = public.current_tenant_id()
      and ((select public.is_club_admin()) or s.athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  )
)
with check (
  exists (
    select 1
    from public.sessions s
    where s.id = session_id
      and s.tenant_id = public.current_tenant_id()
      and ((select public.is_club_admin()) or s.athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  )
);

-- Before: any coach could read and rewrite the rows (exercises, targets) of any session in the club.
drop policy if exists session_block_rows_staff_all on public.session_block_rows;
create policy session_block_rows_staff_all
on public.session_block_rows
for all
to authenticated
using (
  exists (
    select 1
    from public.session_blocks sb
    join public.sessions s on s.id = sb.session_id
    where sb.id = session_block_id
      and s.tenant_id = public.current_tenant_id()
      and ((select public.is_club_admin()) or s.athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  )
)
with check (
  exists (
    select 1
    from public.session_blocks sb
    join public.sessions s on s.id = sb.session_id
    where sb.id = session_block_id
      and s.tenant_id = public.current_tenant_id()
      and ((select public.is_club_admin()) or s.athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  )
);

-- Before: any coach could read, add, change or delete the completion (effort, comment) of any athlete in the club.
drop policy if exists session_completions_staff_all on public.session_completions;
create policy session_completions_staff_all
on public.session_completions
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

-- Before: any coach could read the logged sets (reps, loads, times, notes) of any athlete in the club.
drop policy if exists session_row_logs_select_tenant_staff on public.session_row_logs;
create policy session_row_logs_select_tenant_staff
on public.session_row_logs
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

-- 7. Wellness and PRs ---------------------------------------------------------------------

-- Before: any coach could read every athlete's wellness check-ins (sleep, mood, stress, notes).
drop policy if exists wellness_entries_select_own_or_staff on public.wellness_entries;
create policy wellness_entries_select_own_or_staff
on public.wellness_entries
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or athlete_id in (
      select a.id
      from public.athletes a
      where a.user_id = auth.uid()
        and a.tenant_id = public.current_tenant_id()
    )
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

-- Before: any coach could add, change or delete the wellness check-ins of any athlete in the club.
drop policy if exists wellness_entries_staff_all on public.wellness_entries;
create policy wellness_entries_staff_all
on public.wellness_entries
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

-- Before: any coach could read every athlete's personal records.
drop policy if exists pr_records_select_own_or_staff on public.pr_records;
create policy pr_records_select_own_or_staff
on public.pr_records
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or athlete_id in (
      select a.id
      from public.athletes a
      where a.user_id = auth.uid()
        and a.tenant_id = public.current_tenant_id()
    )
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

-- Before: any coach could add, change or delete the personal records of any athlete in the club.
drop policy if exists pr_records_staff_all on public.pr_records;
create policy pr_records_staff_all
on public.pr_records
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

-- 8. Training plans -----------------------------------------------------------------------

-- Before: any coach could read every plan in the club, other coaches' drafts included.
-- Athletes keep what they had (every plan of the club that is not a draft).
-- The select policies of weeks, days and blocks look the plan up through this policy,
-- so they follow it without being changed.
drop policy if exists training_plans_select_tenant on public.training_plans;
create policy training_plans_select_tenant
on public.training_plans
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (status <> 'draft' and (select public.current_app_role()) = 'athlete')
    or (select public.is_club_admin())
    or (team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
    or (team_id is null and created_by_user_id = auth.uid() and (select public.is_coach_or_admin()))
  )
);

-- Before: any coach could create a plan for, edit, publish, archive or delete the plan of any team.
drop policy if exists training_plans_staff_all on public.training_plans;
create policy training_plans_staff_all
on public.training_plans
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or (team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
    or (team_id is null and created_by_user_id = auth.uid() and (select public.is_coach_or_admin()))
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or (team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
    or (team_id is null and created_by_user_id = auth.uid() and (select public.is_coach_or_admin()))
  )
);

-- Before: any coach could replace the weeks of any plan in the club.
drop policy if exists training_plan_weeks_staff_all on public.training_plan_weeks;
create policy training_plan_weeks_staff_all
on public.training_plan_weeks
for all
to authenticated
using (public.can_manage_training_plan(plan_id))
with check (public.can_manage_training_plan(plan_id));

-- Before: any coach could replace the days of any plan in the club.
drop policy if exists training_plan_days_staff_all on public.training_plan_days;
create policy training_plan_days_staff_all
on public.training_plan_days
for all
to authenticated
using (
  exists (
    select 1
    from public.training_plan_weeks tpw
    where tpw.id = plan_week_id
      and public.can_manage_training_plan(tpw.plan_id)
  )
)
with check (
  exists (
    select 1
    from public.training_plan_weeks tpw
    where tpw.id = plan_week_id
      and public.can_manage_training_plan(tpw.plan_id)
  )
);

-- Before: any coach could replace the blocks of any plan in the club.
drop policy if exists training_plan_blocks_staff_all on public.training_plan_blocks;
create policy training_plan_blocks_staff_all
on public.training_plan_blocks
for all
to authenticated
using (
  exists (
    select 1
    from public.training_plan_days tpd
    join public.training_plan_weeks tpw on tpw.id = tpd.plan_week_id
    where tpd.id = plan_day_id
      and public.can_manage_training_plan(tpw.plan_id)
  )
)
with check (
  exists (
    select 1
    from public.training_plan_days tpd
    join public.training_plan_weeks tpw on tpw.id = tpd.plan_week_id
    where tpd.id = plan_day_id
      and public.can_manage_training_plan(tpw.plan_id)
  )
);

-- Before: any coach could read who every plan in the club is assigned to.
drop policy if exists training_plan_assignments_select_own_or_staff on public.training_plan_assignments;
create policy training_plan_assignments_select_own_or_staff
on public.training_plan_assignments
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or athlete_id in (
      select a.id
      from public.athletes a
      where a.user_id = auth.uid()
        and a.tenant_id = public.current_tenant_id()
    )
    or team_id in (
      select a.team_id
      from public.athletes a
      where a.user_id = auth.uid()
        and a.tenant_id = public.current_tenant_id()
    )
    or public.can_manage_training_plan(plan_id)
  )
);

-- Before: any coach could assign any plan to any team or athlete in the club (which also notifies them),
-- and remove any assignment.
drop policy if exists training_plan_assignments_staff_all on public.training_plan_assignments;
create policy training_plan_assignments_staff_all
on public.training_plan_assignments
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or public.can_manage_training_plan(plan_id))
)
with check (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or (
      public.can_manage_training_plan(plan_id)
      and (team_id is null or team_id = any ((select public.current_coach_team_ids())::uuid[]))
      and (athlete_id is null or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
    )
  )
);

-- 9. Test weeks ---------------------------------------------------------------------------

-- Before: any coach could read every team's test weeks.
-- Athletes keep what they had. The select policy of test_definitions looks the week up through
-- this policy, so it follows it without being changed.
drop policy if exists test_weeks_select_tenant on public.test_weeks;
create policy test_weeks_select_tenant
on public.test_weeks
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.current_app_role()) = 'athlete'
    or (select public.is_club_admin())
    or (team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
    or (team_id is null and created_by_user_id = auth.uid() and (select public.is_coach_or_admin()))
  )
);

-- Before: any coach could create a test week for, edit, publish, archive or delete the test week of any team.
drop policy if exists test_weeks_staff_all on public.test_weeks;
create policy test_weeks_staff_all
on public.test_weeks
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or (team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
    or (team_id is null and created_by_user_id = auth.uid() and (select public.is_coach_or_admin()))
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or (team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
    or (team_id is null and created_by_user_id = auth.uid() and (select public.is_coach_or_admin()))
  )
);

-- Before: any coach could add, change or delete the tests of any team's test week.
drop policy if exists test_definitions_staff_all on public.test_definitions;
create policy test_definitions_staff_all
on public.test_definitions
for all
to authenticated
using (public.can_manage_test_week(test_week_id))
with check (public.can_manage_test_week(test_week_id));

-- Before: any coach could read, add, change or delete the test results of any athlete in the club.
drop policy if exists test_results_staff_all on public.test_results;
create policy test_results_staff_all
on public.test_results
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

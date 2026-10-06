-- Coach handover and assistant coach permissions.
--
-- 1. A role on every team assignment: lead, coach or assistant (team_coaches.role). is_primary
--    stays and is kept in step by a trigger, so older code that writes is_primary keeps working.
-- 2. Two switches per team, both off by default: assistants_can_message and
--    assistants_see_health. A club admin or the team's lead coach sets them.
-- 3. The scope helpers become role aware, and they fail closed:
--      current_coach_team_ids(), current_coach_athlete_ids(), is_team_coach(), is_coach_of_athlete()
--        now mean "teams (athletes) I coach as lead or coach". Every policy and function that
--        used them for a write, and every one added later by someone who does not know about
--        assistants, leaves assistants out.
--      current_staff_team_ids(), current_staff_athlete_ids(), is_team_staff(), is_staff_of_athlete()
--        include assistants. Only the policies listed in section 4 use them: roster, training,
--        results and attendance reads, taking attendance, logging a session for an athlete and
--        entering test results.
--      current_coach_health_athlete_ids() adds assistants only where the team switch is on.
--        Wellness, pain reports, availability (injured, sick), private details (medical notes)
--        and private coach notes use it.
--      current_coach_message_team_ids() adds assistants only where the team switch is on.
--      can_author_club_content() is false for someone whose every team assignment is assistant:
--        no library exercises, templates or team-less plans and test weeks.
--    Lead coaches and coaches keep exactly the rights they had.
-- 4. Handover. hand_over_coach_teams() moves a coach's teams to new leads in one transaction and
--    can then deactivate or remove the coach. Removing or deactivating a coach who still coaches
--    an active team is refused until the teams are handed over. Whenever a coach comes off a team
--    their direct message threads with that team's athletes are closed with a system line; the
--    history stays readable by the athlete and club admins, and nobody inherits the thread.
-- 5. A coach can ask club admins for a handover (coach_handover_requests). They cannot reassign
--    themselves: team_coaches is still written by club admins only.
--
-- Safe to run twice.

-- 0. Columns ---------------------------------------------------------------------------------------

alter table public.team_coaches add column if not exists role text not null default 'coach';
alter table public.team_coaches drop constraint if exists team_coaches_role_check;
alter table public.team_coaches add constraint team_coaches_role_check check (role in ('lead', 'coach', 'assistant'));

-- Existing rows: the lead flag decides. Everyone else stays a coach with today's rights.
update public.team_coaches set role = 'lead' where is_primary and role = 'coach';

comment on column public.team_coaches.role is
  'lead, coach or assistant. Lead and coach have full coaching rights on the team. An assistant can see the roster, training, results and attendance, take attendance, log a session for an athlete and enter test results. is_primary mirrors role = lead.';

alter table public.teams add column if not exists assistants_can_message boolean not null default false;
alter table public.teams add column if not exists assistants_see_health boolean not null default false;

comment on column public.teams.assistants_can_message is
  'When true, assistant coaches of this team may exchange direct messages with its athletes. Set by a club admin or the lead coach.';
comment on column public.teams.assistants_see_health is
  'When true, assistant coaches of this team may see wellness detail, pain reports, availability, medical notes and private coach notes. Set by a club admin or the lead coach.';

alter table public.message_threads add column if not exists closed_at timestamptz;
alter table public.message_threads add column if not exists closed_reason text;
alter table public.message_threads drop constraint if exists message_threads_closed_reason_check;
alter table public.message_threads add constraint message_threads_closed_reason_check
  check (closed_reason is null or closed_reason in ('coach_left_team'));

-- A system line ("Coach Rivera no longer coaches this team") has no sender.
alter table public.messages drop constraint if exists messages_sender_role_check;
alter table public.messages add constraint messages_sender_role_check check (sender_role in ('coach', 'athlete', 'system'));

-- role and is_primary say the same thing. Whichever one a writer sets, the other follows.
create or replace function public.team_coaches_sync_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.role = 'lead' then
      new.is_primary := true;
    elsif coalesce(new.is_primary, false) and new.role = 'coach' then
      new.role := 'lead';
    else
      new.is_primary := false;
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    new.is_primary := new.role = 'lead';
  elsif new.is_primary is distinct from old.is_primary then
    new.role := case when new.is_primary then 'lead' when old.role = 'lead' then 'coach' else old.role end;
    new.is_primary := new.role = 'lead';
  end if;
  return new;
end;
$$;

drop trigger if exists aa_team_coaches_sync_role on public.team_coaches;
create trigger aa_team_coaches_sync_role
before insert or update on public.team_coaches
for each row execute function public.team_coaches_sync_role();

-- 1. Scope helpers ---------------------------------------------------------------------------------

-- The teams the caller is assigned to with one of the given roles. Same member checks as before:
-- an active coach or club admin of a club that is not suspended or cancelled.
create or replace function public.current_coach_team_ids_with(p_roles text[])
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
    and tc.role = any (coalesce(p_roles, '{}'::text[]))
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

-- Lead coaches and coaches only. Assistants are NOT in this list (see the header).
create or replace function public.current_coach_team_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select public.current_coach_team_ids_with(array['lead', 'coach'])
$$;

-- Every team the caller is on, assistants included. For reads and the few assistant writes.
create or replace function public.current_staff_team_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select public.current_coach_team_ids_with(array['lead', 'coach', 'assistant'])
$$;

create or replace function public.current_staff_athlete_ids()
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
  where a.team_id = any (public.current_staff_team_ids())
$$;

-- Teams whose health information the caller may see: as lead or coach always, as assistant only
-- where the team allows it.
create or replace function public.current_coach_health_team_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(x.id), '{}'::uuid[])
  from (
    select unnest(public.current_coach_team_ids_with(array['lead', 'coach'])) as id
    union
    select t.id
    from public.teams t
    where t.id = any (public.current_coach_team_ids_with(array['assistant']))
      and t.assistants_see_health
  ) x
$$;

create or replace function public.current_coach_health_athlete_ids()
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
  where a.team_id = any (public.current_coach_health_team_ids())
$$;

-- Teams whose athletes the caller may message directly.
create or replace function public.current_coach_message_team_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(x.id), '{}'::uuid[])
  from (
    select unnest(public.current_coach_team_ids_with(array['lead', 'coach'])) as id
    union
    select t.id
    from public.teams t
    where t.id = any (public.current_coach_team_ids_with(array['assistant']))
      and t.assistants_can_message
  ) x
$$;

-- The caller's role on one team, or null when they are not on it (or not an active member).
create or replace function public.team_coach_role(p_team_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tc.role
  from public.team_coaches tc
  where tc.team_id = p_team_id
    and tc.user_id = auth.uid()
    and tc.team_id = any (public.current_staff_team_ids())
  limit 1
$$;

-- Lead coach or coach of the team. Assistants: no.
create or replace function public.is_team_coach(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team_id is not null and p_team_id = any (public.current_coach_team_ids())
$$;

-- On the team in any role, assistants included.
create or replace function public.is_team_staff(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team_id is not null and p_team_id = any (public.current_staff_team_ids())
$$;

-- Lead coach or coach of the athlete's team. Assistants: no.
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
    where a.id = p_athlete_id
      and a.team_id is not null
      and a.team_id = any (public.current_coach_team_ids())
  )
$$;

create or replace function public.is_staff_of_athlete(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.athletes a
    where a.id = p_athlete_id
      and a.team_id is not null
      and a.team_id = any (public.current_staff_team_ids())
  )
$$;

-- May the caller message this athlete directly as their coach?
create or replace function public.can_message_athlete(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.athletes a
    where a.id = p_athlete_id
      and a.team_id is not null
      and a.team_id = any (public.current_coach_message_team_ids())
  )
$$;

-- May this coach be messaged by the athletes of this team? Used for the athlete's side, where
-- the caller is the athlete and the coach is someone else.
create or replace function public.team_coach_can_message(p_team_id uuid, p_coach_user_id uuid)
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
    where tc.team_id = p_team_id
      and tc.user_id = p_coach_user_id
      and (tc.role in ('lead', 'coach') or (tc.role = 'assistant' and t.assistants_can_message))
  )
$$;
revoke all on function public.team_coach_can_message(uuid, uuid) from public, anon, authenticated;

-- Staff who may write club-wide coaching content (library exercises, templates, plans and test
-- weeks that belong to no team). A club admin always. A coach unless every team assignment they
-- hold is assistant. A coach with no team yet keeps today's rights.
create or replace function public.can_author_club_content()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_coach_or_admin()
    and (
      public.is_club_admin()
      or not exists (
        select 1 from public.team_coaches tc
        where tc.user_id = auth.uid() and tc.tenant_id = public.current_tenant_id()
      )
      or exists (
        select 1 from public.team_coaches tc
        where tc.user_id = auth.uid() and tc.tenant_id = public.current_tenant_id() and tc.role in ('lead', 'coach')
      )
    )
$$;

-- Read access to a plan or test week of a team the caller is on in any role.
create or replace function public.can_view_training_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_training_plan(p_plan_id)
    or exists (
      select 1
      from public.training_plans tp
      where tp.id = p_plan_id
        and tp.tenant_id = public.current_tenant_id()
        and tp.team_id is not null
        and tp.team_id = any (public.current_staff_team_ids())
    )
$$;

create or replace function public.can_view_test_week(p_test_week_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_test_week(p_test_week_id)
    or exists (
      select 1
      from public.test_weeks tw
      where tw.id = p_test_week_id
        and tw.tenant_id = public.current_tenant_id()
        and tw.team_id is not null
        and tw.team_id = any (public.current_staff_team_ids())
    )
$$;

-- Coaches of a team who may be told about an athlete's health (low readiness, pain, availability).
create or replace function public.notification_team_health_coach_user_ids(p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tc.user_id
  from public.team_coaches tc
  join public.teams t
    on t.id = tc.team_id
   and t.tenant_id = tc.tenant_id
  join public.profiles p
    on p.user_id = tc.user_id
   and p.tenant_id = tc.tenant_id
  where tc.team_id = p_team_id
    and p.role in ('coach', 'club-admin')
    and p.is_active
    and (tc.role in ('lead', 'coach') or t.assistants_see_health)
$$;
revoke all on function public.notification_team_health_coach_user_ids(uuid) from public, anon, authenticated;

do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'current_coach_team_ids_with(text[])', 'current_coach_team_ids()', 'current_staff_team_ids()',
    'current_staff_athlete_ids()', 'current_coach_health_team_ids()', 'current_coach_health_athlete_ids()',
    'current_coach_message_team_ids()', 'team_coach_role(uuid)', 'is_team_coach(uuid)', 'is_team_staff(uuid)',
    'is_coach_of_athlete(uuid)', 'is_staff_of_athlete(uuid)', 'can_message_athlete(uuid)',
    'can_author_club_content()', 'can_view_training_plan(uuid)', 'can_view_test_week(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', v_name);
    execute format('grant execute on function public.%s to authenticated, service_role', v_name);
  end loop;
end $$;

-- 2. Policies: swap the helper, keep everything else --------------------------------------------
--
-- Each policy keeps its exact wording apart from the helper named here, so nothing else about
-- it can drift. "staff" lets assistants in (reads, attendance, logging for an athlete, test
-- result entry). "health" follows the team's health switch. "author" keeps assistant-only
-- staff from writing club-wide content. Policies not listed keep current_coach_team_ids() or
-- current_coach_athlete_ids(), which no longer include assistants.

do $$
declare
  r record;
  v_qual text;
  v_check text;
  v_all text;
begin
  for r in
    select * from (values
      -- Roster
      ('athletes', 'athletes_select_tenant_staff', 'staff'),
      ('team_squads', 'team_squads_select', 'staff'),
      ('team_squad_members', 'team_squad_members_select', 'staff'),
      -- Training and what was logged, including logging for an athlete
      ('sessions', 'sessions_select_tenant_staff', 'staff'),
      ('session_completions', 'session_completions_staff_all', 'staff'),
      ('session_row_logs', 'session_row_logs_select_tenant_staff', 'staff'),
      ('session_row_logs', 'session_row_logs_staff_insert_team', 'staff'),
      ('session_row_logs', 'session_row_logs_staff_update_team', 'staff'),
      ('session_row_logs', 'session_row_logs_staff_write_managed', 'staff'),
      ('training_plans', 'training_plans_select_tenant', 'staff'),
      ('athlete_goals', 'athlete_goals_select_scope', 'staff'),
      -- Results and testing
      ('athlete_results', 'athlete_results_select_scope', 'staff'),
      ('pr_records', 'pr_records_select_own_or_staff', 'staff'),
      ('competitions', 'competitions_select_scope', 'staff'),
      ('competition_entries', 'competition_entries_select_scope', 'staff'),
      ('test_weeks', 'test_weeks_select_tenant', 'staff'),
      ('test_results', 'test_results_staff_all', 'staff'),
      -- Attendance
      ('athlete_attendance', 'athlete_attendance_select_own_or_staff', 'staff'),
      ('athlete_attendance', 'athlete_attendance_insert_staff', 'staff'),
      ('athlete_attendance', 'athlete_attendance_update_staff', 'staff'),
      ('athlete_attendance', 'athlete_attendance_delete_staff', 'staff'),
      -- Team announcements are read by the whole staff of the team
      ('announcements', 'announcements_select_scope', 'staff'),
      -- Health information
      ('wellness_entries', 'wellness_entries_select_own_or_staff', 'health'),
      ('wellness_entries', 'wellness_entries_staff_all', 'health'),
      ('pain_reports', 'pain_reports_select_own_or_team_staff', 'health'),
      ('athlete_private_details', 'athlete_private_details_select_own_or_team_staff', 'health'),
      ('athlete_availability', 'athlete_availability_select_own_or_staff', 'health'),
      ('coach_athlete_notes', 'coach_athlete_notes_select_staff', 'health'),
      ('coach_athlete_notes', 'coach_athlete_notes_insert_staff', 'health'),
      ('coach_athlete_notes', 'coach_athlete_notes_update_author', 'health'),
      ('coach_athlete_notes', 'coach_athlete_notes_delete_author_or_admin', 'health'),
      -- Club-wide coaching content
      ('exercise_library', 'exercise_library_insert_staff', 'author'),
      ('exercise_library', 'exercise_library_update_staff', 'author'),
      ('plan_templates', 'plan_templates_insert_staff', 'author'),
      ('plan_templates', 'plan_templates_update_owner_or_admin', 'author'),
      ('plan_templates', 'plan_templates_delete_owner_or_admin', 'author'),
      ('training_plans', 'training_plans_staff_all', 'author'),
      ('test_weeks', 'test_weeks_staff_all', 'author')
    ) as t(tbl, pol, kind)
  loop
    select p.qual, p.with_check into v_qual, v_check
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol;
    if not found then
      raise exception 'Policy % on % was not found, so it cannot be made role aware.', r.pol, r.tbl;
    end if;

    if r.kind = 'staff' then
      v_qual := regexp_replace(regexp_replace(v_qual, '\mcurrent_coach_team_ids\M', 'current_staff_team_ids', 'g'), '\mcurrent_coach_athlete_ids\M', 'current_staff_athlete_ids', 'g');
      v_check := regexp_replace(regexp_replace(v_check, '\mcurrent_coach_team_ids\M', 'current_staff_team_ids', 'g'), '\mcurrent_coach_athlete_ids\M', 'current_staff_athlete_ids', 'g');
    elsif r.kind = 'health' then
      v_qual := regexp_replace(v_qual, '\mcurrent_coach_athlete_ids\M', 'current_coach_health_athlete_ids', 'g');
      v_check := regexp_replace(v_check, '\mcurrent_coach_athlete_ids\M', 'current_coach_health_athlete_ids', 'g');
    else
      v_qual := regexp_replace(v_qual, '\mis_coach_or_admin\M', 'can_author_club_content', 'g');
      v_check := regexp_replace(v_check, '\mis_coach_or_admin\M', 'can_author_club_content', 'g');
    end if;

    v_all := coalesce(v_qual, '') || ' ' || coalesce(v_check, '');
    if (r.kind = 'staff' and (v_all ~ '\mcurrent_coach_(team|athlete)_ids\M' or v_all !~ '\mcurrent_staff_(team|athlete)_ids\M'))
       or (r.kind = 'health' and (v_all ~ '\mcurrent_coach_athlete_ids\M' or v_all !~ '\mcurrent_coach_health_athlete_ids\M'))
       or (r.kind = 'author' and (v_all ~ '\mis_coach_or_admin\M' or v_all !~ '\mcan_author_club_content\M')) then
      raise exception 'Policy % on % does not have the expected shape, so it was not changed.', r.pol, r.tbl;
    end if;

    execute format('alter policy %I on public.%I', r.pol, r.tbl)
      || case when v_qual is not null then ' using (' || v_qual || ')' else '' end
      || case when v_check is not null then ' with check (' || v_check || ')' else '' end;
  end loop;
end $$;

-- Tables whose staff read came only through a "manage" policy. Assistants get a read of their own.

drop policy if exists session_blocks_select_team_staff on public.session_blocks;
create policy session_blocks_select_team_staff
on public.session_blocks
for select
to authenticated
using (
  exists (
    select 1
    from public.sessions s
    where s.id = session_blocks.session_id
      and s.tenant_id = public.current_tenant_id()
      and s.athlete_id = any ((select public.current_staff_athlete_ids())::uuid[])
  )
);

drop policy if exists session_block_rows_select_team_staff on public.session_block_rows;
create policy session_block_rows_select_team_staff
on public.session_block_rows
for select
to authenticated
using (
  exists (
    select 1
    from public.session_blocks sb
    join public.sessions s on s.id = sb.session_id
    where sb.id = session_block_rows.session_block_id
      and s.tenant_id = public.current_tenant_id()
      and s.athlete_id = any ((select public.current_staff_athlete_ids())::uuid[])
  )
);

drop policy if exists training_plan_weeks_select_team_staff on public.training_plan_weeks;
create policy training_plan_weeks_select_team_staff
on public.training_plan_weeks
for select
to authenticated
using (public.can_view_training_plan(plan_id));

drop policy if exists training_plan_days_select_team_staff on public.training_plan_days;
create policy training_plan_days_select_team_staff
on public.training_plan_days
for select
to authenticated
using (
  exists (
    select 1
    from public.training_plan_weeks tpw
    where tpw.id = training_plan_days.plan_week_id
      and public.can_view_training_plan(tpw.plan_id)
  )
);

drop policy if exists training_plan_blocks_select_team_staff on public.training_plan_blocks;
create policy training_plan_blocks_select_team_staff
on public.training_plan_blocks
for select
to authenticated
using (
  exists (
    select 1
    from public.training_plan_days tpd
    join public.training_plan_weeks tpw on tpw.id = tpd.plan_week_id
    where tpd.id = training_plan_blocks.plan_day_id
      and public.can_view_training_plan(tpw.plan_id)
  )
);

drop policy if exists training_plan_assignments_select_team_staff on public.training_plan_assignments;
create policy training_plan_assignments_select_team_staff
on public.training_plan_assignments
for select
to authenticated
using (tenant_id = public.current_tenant_id() and public.can_view_training_plan(plan_id));

drop policy if exists test_definitions_select_team_staff on public.test_definitions;
create policy test_definitions_select_team_staff
on public.test_definitions
for select
to authenticated
using (public.can_view_test_week(test_week_id));

-- An assistant logging a session needs the athlete's lift maxes to see the loads. Writing them
-- stays with the lead and coaches (can_manage_athlete).
drop policy if exists athlete_lift_maxes_select_team_staff on public.athlete_lift_maxes;
create policy athlete_lift_maxes_select_team_staff
on public.athlete_lift_maxes
for select
to authenticated
using (tenant_id = public.current_tenant_id() and public.is_staff_of_athlete(athlete_id));

-- A template whose author has left the club (or was deactivated) can be edited by any coach who
-- may write club content, so it does not become a dead entry only a club admin can touch.
create or replace function public.staff_member_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = p_user_id
      and p.tenant_id = public.current_tenant_id()
      and p.is_active
      and p.role in ('coach', 'club-admin')
  )
$$;
revoke all on function public.staff_member_is_active(uuid) from public, anon;
grant execute on function public.staff_member_is_active(uuid) to authenticated, service_role;

drop policy if exists plan_templates_update_orphaned on public.plan_templates;
create policy plan_templates_update_orphaned
on public.plan_templates
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and public.can_author_club_content()
  and (created_by_user_id is null or not public.staff_member_is_active(created_by_user_id))
)
with check (
  tenant_id = public.current_tenant_id()
  and public.can_author_club_content()
);

-- 3. Existing functions: swap one helper each ------------------------------------------------------
--
-- Same idea as the policies: the function keeps its body, one call changes. A function whose
-- body no longer contains the expected call stops the migration instead of being skipped.

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      -- Reads that include assistants
      ('public.get_session_logged_by(uuid)', 'public.is_coach_of_athlete(v_athlete_id)', 'public.is_staff_of_athlete(v_athlete_id)'),
      ('public.get_visible_avatars()', 'public.current_coach_athlete_ids()', 'public.current_staff_athlete_ids()'),
      ('public.current_club_event_ids()', 'public.current_coach_team_ids()', 'public.current_staff_team_ids()'),
      ('public.staff_can_view_competition(uuid)', 'public.is_team_coach(c.team_id)', 'public.is_team_staff(c.team_id)'),
      ('public.staff_can_view_competition(uuid)', 'public.is_coach_of_athlete(c.owner_athlete_id)', 'public.is_staff_of_athlete(c.owner_athlete_id)'),
      -- Test result entry by an assistant
      ('public.test_results_guard()',
       'not public.can_manage_test_week(new.test_week_id) or not public.can_manage_athlete(new.athlete_id)',
       'not public.can_view_test_week(new.test_week_id) or not (public.can_manage_athlete(new.athlete_id) or public.is_staff_of_athlete(new.athlete_id))'),
      -- Direct messages follow the team's messaging switch
      ('public.current_message_thread_ids()', 'public.current_coach_team_ids()', 'public.current_coach_message_team_ids()'),
      -- Health notifications follow the team's health switch
      ('public.enqueue_low_readiness_notifications()', 'public.notification_team_coach_user_ids(', 'public.notification_team_health_coach_user_ids('),
      ('public.enqueue_pain_report_notifications()', 'public.notification_team_coach_user_ids(', 'public.notification_team_health_coach_user_ids('),
      ('public.set_athlete_availability(text,date,date,text,uuid)', 'public.notification_team_coach_user_ids(', 'public.notification_team_health_coach_user_ids('),
      ('public.end_athlete_availability(uuid,date)', 'public.notification_team_coach_user_ids(', 'public.notification_team_health_coach_user_ids('),
      -- Team-less plans and test weeks are club-wide content
      ('public.can_manage_training_plan(uuid)', 'public.is_coach_or_admin()', 'public.can_author_club_content()'),
      ('public.can_manage_test_week(uuid)', 'public.is_coach_or_admin()', 'public.can_author_club_content()')
    ) as t(proc, old_call, new_call)
  loop
    v_def := pg_get_functiondef(r.proc::regprocedure);
    v_new := replace(v_def, r.old_call, r.new_call);
    if position(r.new_call in v_new) = 0 then
      raise exception 'Function % does not contain the expected call (%), so it was not changed.', r.proc, r.old_call;
    end if;
    if v_new is distinct from v_def then
      execute v_new;
    end if;
  end loop;
end $$;

-- 4. Team switches ---------------------------------------------------------------------------------

-- teams can be updated by a coach of the team (name, event group). The two assistant switches
-- are for a club admin or the lead coach only, whichever way the update arrives.
create or replace function public.teams_guard_assistant_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assistants_can_message is not distinct from old.assistants_can_message
     and new.assistants_see_health is not distinct from old.assistants_see_health then
    return new;
  end if;
  -- Migrations and server jobs have no signed-in user.
  if auth.uid() is null then
    return new;
  end if;
  if not (
    (public.is_club_admin() and old.tenant_id = public.current_tenant_id())
    -- team_coach_role is null for someone who is not on the team: that must read as "no".
    or coalesce(public.team_coach_role(old.id) = 'lead', false)
  ) then
    raise exception 'Only a club admin or the lead coach can change what assistant coaches may do.'
      using errcode = '42501', hint = 'assistant_settings_forbidden';
  end if;
  return new;
end;
$$;

drop trigger if exists teams_guard_assistant_settings on public.teams;
create trigger teams_guard_assistant_settings
before update on public.teams
for each row execute function public.teams_guard_assistant_settings();

create or replace function public.set_team_assistant_settings(
  p_team_id uuid,
  p_can_message boolean default null,
  p_see_health boolean default null
)
returns table (assistants_can_message boolean, assistants_see_health boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_team public.teams%rowtype;
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_team
  from public.teams t
  where t.id = p_team_id and t.tenant_id = public.current_tenant_id()
  for update;

  -- One answer for "no such team" and "not yours".
  if not found or not (public.is_club_admin() or coalesce(public.team_coach_role(v_team.id) = 'lead', false)) then
    raise exception 'Only a club admin or the lead coach can change what assistant coaches may do.'
      using errcode = '42501', hint = 'assistant_settings_forbidden';
  end if;

  update public.teams t
  set assistants_can_message = coalesce(p_can_message, t.assistants_can_message),
      assistants_see_health = coalesce(p_see_health, t.assistants_see_health)
  where t.id = v_team.id;

  if coalesce(p_can_message, v_team.assistants_can_message) is distinct from v_team.assistants_can_message
     or coalesce(p_see_health, v_team.assistants_see_health) is distinct from v_team.assistants_see_health then
    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (
      v_team.tenant_id, auth.uid(), public.current_app_role(), 'team_assistant_settings', v_team.name,
      format('assistants can message athletes: %s, assistants can see health information: %s',
             case when coalesce(p_can_message, v_team.assistants_can_message) then 'yes' else 'no' end,
             case when coalesce(p_see_health, v_team.assistants_see_health) then 'yes' else 'no' end)
    );
  end if;

  return query
  select t.assistants_can_message, t.assistants_see_health from public.teams t where t.id = v_team.id;
end;
$$;
revoke all on function public.set_team_assistant_settings(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_team_assistant_settings(uuid, boolean, boolean) to authenticated, service_role;

-- 5. Assigning a coach with a role ------------------------------------------------------------------

-- A display name for notifications and the system line. "Coach Rivera" stays "Coach Rivera".
create or replace function public.coach_display_label(p_user_id uuid, p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when n.name is null then 'Your coach'
    when n.name ~* '^coach\M' then n.name
    else 'Coach ' || n.name
  end
  from (
    select nullif(btrim(regexp_replace(coalesce((
      select p.display_name from public.profiles p where p.user_id = p_user_id and p.tenant_id = p_tenant_id
    ), ''), '\s+', ' ', 'g')), '') as name
  ) n
$$;
revoke all on function public.coach_display_label(uuid, uuid) from public, anon, authenticated;

-- Club admins only (the owner rule: a coach never adds, removes or re-roles themselves).
-- Making someone lead moves the previous lead down to coach, so a team has one lead.
create or replace function public.set_team_coach_role(p_team_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.profiles%rowtype;
  v_team public.teams%rowtype;
  v_target public.profiles%rowtype;
  v_old_role text;
  v_label text;
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_caller from public.profiles p where p.user_id = auth.uid();
  if not found or v_caller.role <> 'club-admin' or not v_caller.is_active then
    raise exception 'Only a club admin can change who coaches a team.' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('lead', 'coach', 'assistant') then
    raise exception 'Choose lead coach, coach or assistant.' using errcode = '22023';
  end if;

  select * into v_team from public.teams t where t.id = p_team_id and t.tenant_id = v_caller.tenant_id for update;
  select * into v_target
  from public.profiles p
  where p.user_id = p_user_id and p.tenant_id = v_caller.tenant_id and p.role in ('coach', 'club-admin') and p.is_active;
  if v_team.id is null or v_target.user_id is null then
    raise exception 'Pick an active coach and a team of this club.' using errcode = '23514', hint = 'coach_or_team_not_found';
  end if;

  select tc.role into v_old_role from public.team_coaches tc where tc.team_id = v_team.id and tc.user_id = p_user_id;
  if v_old_role is not distinct from p_role then
    return;
  end if;

  if p_role = 'lead' then
    update public.team_coaches tc
    set role = 'coach'
    where tc.team_id = v_team.id and tc.role = 'lead' and tc.user_id <> p_user_id;
  end if;

  insert into public.team_coaches (tenant_id, team_id, user_id, role, created_by_user_id)
  values (v_team.tenant_id, v_team.id, p_user_id, p_role, auth.uid())
  on conflict (team_id, user_id) do update set role = excluded.role;

  v_label := case p_role when 'lead' then 'lead coach' when 'assistant' then 'assistant coach' else 'coach' end;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    v_team.tenant_id, auth.uid(), 'club-admin', 'team_coach_role_set', v_team.name,
    format('%s is %s%s', coalesce(nullif(btrim(v_target.display_name), ''), 'Coach'), v_label,
           case when v_old_role is null then '' else format(' (was %s)', case v_old_role when 'lead' then 'lead coach' when 'assistant' then 'assistant coach' else 'coach' end) end)
  );

  -- A new assignment is announced by the team_coaches trigger. A change of role is told here.
  if v_old_role is not null and p_user_id <> auth.uid() then
    perform public.enqueue_notification(
      v_team.tenant_id, p_user_id, 'coach_team_role_changed',
      format('You are now %s of %s', case p_role when 'lead' then 'lead coach' when 'assistant' then 'an assistant coach' else 'a coach' end, v_team.name),
      case p_role
        when 'assistant' then 'You can see the roster, training, results and attendance, take attendance, log sessions for athletes and enter test results. Plans, invites and squads are for the lead coach and coaches.'
        when 'lead' then 'You lead this team: its roster, plans and test weeks are yours to run.'
        else 'You have full coaching rights on this team.'
      end,
      jsonb_build_object('team_id', v_team.id::text),
      array['in-app'],
      'coach_role:' || v_team.id::text || ':' || p_user_id::text,
      interval '10 minutes'
    );
  end if;
end;
$$;
revoke all on function public.set_team_coach_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_team_coach_role(uuid, uuid, text) to authenticated, service_role;

-- 6. Messaging: role aware, and closed when a coach comes off a team ----------------------------------

create or replace function public.message_thread_is_open(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.message_threads t
    join public.athletes a
      on a.id = t.athlete_id
     and a.tenant_id = t.tenant_id
    join public.profiles ap
      on ap.user_id = a.user_id
     and ap.tenant_id = t.tenant_id
     and ap.role = 'athlete'
     and ap.is_active
    join public.team_coaches tc
      on tc.team_id = a.team_id
     and tc.tenant_id = t.tenant_id
     and tc.user_id = t.coach_user_id
    join public.teams tm
      on tm.id = tc.team_id
    join public.profiles cp
      on cp.user_id = t.coach_user_id
     and cp.tenant_id = t.tenant_id
     and cp.role in ('coach', 'club-admin')
     and cp.is_active
    where t.id = p_thread_id
      and t.closed_at is null
      and a.is_active
      and a.user_id is not null
      and a.team_id is not null
      and (tc.role in ('lead', 'coach') or (tc.role = 'assistant' and tm.assistants_can_message))
      and not public.tenant_access_blocked(t.tenant_id)
  )
$$;

create or replace function public.open_message_thread(
  p_athlete_id uuid default null,
  p_coach_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_athlete public.athletes%rowtype;
  v_coach_user_id uuid;
  v_thread_id uuid;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile from public.profiles p where p.user_id = auth.uid() limit 1;
  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role in ('coach', 'club-admin') then
    if p_athlete_id is null then
      raise exception 'Choose an athlete to message.' using errcode = '22023';
    end if;
    select * into v_athlete
    from public.athletes a
    where a.id = p_athlete_id and a.tenant_id = v_profile.tenant_id;
    -- One answer for "not on your team" and "assistants may not message on this team".
    if not found or not public.can_message_athlete(p_athlete_id) then
      raise exception 'You can only message athletes on a team you coach.'
        using errcode = '42501', hint = 'not_your_athlete';
    end if;
    v_coach_user_id := auth.uid();
  elsif v_profile.role = 'athlete' then
    if p_coach_user_id is null then
      raise exception 'Choose a coach to message.' using errcode = '22023';
    end if;
    select * into v_athlete
    from public.athletes a
    where a.id = public.current_athlete_id();
    if not found then
      raise exception 'Athlete record not found';
    end if;
    if v_athlete.team_id is null or not exists (
      select 1
      from public.team_coaches tc
      join public.profiles cp
        on cp.user_id = tc.user_id
       and cp.tenant_id = tc.tenant_id
       and cp.role in ('coach', 'club-admin')
       and cp.is_active
      where tc.team_id = v_athlete.team_id
        and tc.tenant_id = v_athlete.tenant_id
        and tc.user_id = p_coach_user_id
    ) or not public.team_coach_can_message(v_athlete.team_id, p_coach_user_id) then
      raise exception 'You can only message the coaches of your own team.'
        using errcode = '42501', hint = 'not_your_coach';
    end if;
    v_coach_user_id := p_coach_user_id;
  else
    raise exception 'Messages are between a coach and an athlete.' using errcode = '42501';
  end if;

  if v_athlete.user_id is null or not v_athlete.is_active then
    raise exception 'This athlete has no login yet, so they cannot be messaged.'
      using errcode = '42501', hint = 'no_login';
  end if;

  insert into public.message_threads (tenant_id, team_id, coach_user_id, athlete_id, created_by_user_id)
  values (v_athlete.tenant_id, v_athlete.team_id, v_coach_user_id, v_athlete.id, auth.uid())
  on conflict (coach_user_id, athlete_id)
  -- The athlete moved to another team this coach also coaches: the conversation follows. A
  -- conversation that was closed when the coach came off the team opens again now that the
  -- checks above say they coach this athlete.
  do update set team_id = excluded.team_id, closed_at = null, closed_reason = null
  returning id into v_thread_id;

  return v_thread_id;
end;
$$;

-- When a coach comes off a team, their conversations with that team's athletes are closed and
-- the athlete is told why in the thread itself. Nothing is deleted, and the thread stays keyed
-- to the old coach, so whoever takes over the team does not see it.
create or replace function public.close_coach_threads_for_team(p_coach_user_id uuid, p_team_id uuid, p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleting text := nullif(current_setting('sktr.deleting_users', true), '');
  v_label text;
  v_thread record;
  v_count integer := 0;
begin
  if p_coach_user_id is null or p_team_id is null then
    return 0;
  end if;

  -- A coach deleting their own account is not named in what is left behind.
  if v_deleting is not null and p_coach_user_id::text = any (string_to_array(v_deleting, ',')) then
    v_label := 'Your coach';
  else
    v_label := public.coach_display_label(p_coach_user_id, p_tenant_id);
  end if;

  for v_thread in
    select t.id, t.last_message_at
    from public.message_threads t
    join public.athletes a on a.id = t.athlete_id
    where t.coach_user_id = p_coach_user_id
      and t.tenant_id = p_tenant_id
      and t.closed_at is null
      and coalesce(a.team_id, t.team_id) = p_team_id
    for update of t
  loop
    if v_thread.last_message_at is not null then
      insert into public.messages (tenant_id, thread_id, sender_user_id, sender_role, body)
      values (p_tenant_id, v_thread.id, null, 'system', v_label || ' no longer coaches this team');
    end if;
    update public.message_threads t
    set closed_at = now(),
        closed_reason = 'coach_left_team',
        last_message_at = case when t.last_message_at is null then null else now() end
    where t.id = v_thread.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.close_coach_threads_for_team(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.team_coaches_close_threads()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- The team itself is being deleted, or the whole club: nothing to say.
    if exists (select 1 from public.teams tm where tm.id = old.team_id and tm.tenant_id = old.tenant_id) then
      perform public.close_coach_threads_for_team(old.user_id, old.team_id, old.tenant_id);
    end if;
    return null;
  end if;

  -- Back on the team: conversations closed when they left can be used again.
  update public.message_threads t
  set closed_at = null, closed_reason = null
  from public.athletes a
  where a.id = t.athlete_id
    and a.team_id = new.team_id
    and t.coach_user_id = new.user_id
    and t.tenant_id = new.tenant_id
    and t.closed_reason = 'coach_left_team';
  return null;
end;
$$;

drop trigger if exists team_coaches_close_threads on public.team_coaches;
create trigger team_coaches_close_threads
after insert or delete on public.team_coaches
for each row execute function public.team_coaches_close_threads();

-- The athlete's list of their team's coaches now says who is an assistant and who can be messaged.
drop function if exists public.get_current_athlete_team_coaches();
create function public.get_current_athlete_team_coaches()
returns table (
  user_id uuid,
  display_name text,
  is_primary boolean,
  avatar_path text,
  contact_email text,
  team_role text,
  can_message boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    tc.user_id,
    nullif(btrim(coalesce(cp.display_name, '')), '') as display_name,
    tc.role = 'lead' as is_primary,
    aa.avatar_path,
    case
      when coalesce(ccs.show_email_to_athletes, false) and au.email_confirmed_at is not null
        then nullif(lower(btrim(au.email)), '')
      else null
    end as contact_email,
    tc.role as team_role,
    (tc.role in ('lead', 'coach') or tm.assistants_can_message) as can_message
  from public.team_coaches tc
  join public.teams tm
    on tm.id = tc.team_id
  join public.profiles cp
    on cp.user_id = tc.user_id
   and cp.tenant_id = tc.tenant_id
   and cp.is_active
   and cp.role in ('coach', 'club-admin')
  left join public.account_avatars aa
    on aa.user_id = tc.user_id
  left join public.coach_contact_settings ccs
    on ccs.user_id = tc.user_id
   and ccs.tenant_id = tc.tenant_id
  left join auth.users au
    on au.id = tc.user_id
  where public.caller_is_active_member()
    and tc.team_id = public.current_athlete_team_id()
    and tc.tenant_id = public.current_tenant_id()
  order by (tc.role = 'lead') desc, (tc.role = 'assistant'), nullif(btrim(coalesce(cp.display_name, '')), '') nulls last
$$;
revoke all on function public.get_current_athlete_team_coaches() from public, anon;
grant execute on function public.get_current_athlete_team_coaches() to authenticated, service_role;

-- 7. Handover ----------------------------------------------------------------------------------------

-- A handover in progress announces the new lead itself, so the plain "You now coach" notice is
-- held back for that one insert.
create or replace function public.enqueue_team_coach_change_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.team_coaches%rowtype;
  v_team_name text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  -- The team must still exist. When a team is deleted its coach rows go with it: say nothing.
  select tm.name into v_team_name from public.teams tm where tm.id = v_row.team_id and tm.tenant_id = v_row.tenant_id;
  if not found then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(nullif(current_setting('sktr.handover_new_lead', true), ''), '') = v_row.user_id::text then
      return null;
    end if;
    perform public.enqueue_notification(
      v_row.tenant_id,
      v_row.user_id,
      'coach_team_assigned',
      format('You now coach %s', v_team_name),
      case
        when v_row.role = 'assistant' then 'You are an assistant coach on this team: you can see its athletes, take attendance, log sessions and enter test results.'
        else 'You can see this team''s athletes, build plans for them and run test weeks.'
      end,
      jsonb_build_object('team_id', v_row.team_id::text),
      array['in-app', 'email'],
      'coach_team:' || v_row.team_id::text || ':assigned',
      interval '10 minutes'
    );
  else
    perform public.enqueue_notification(
      v_row.tenant_id,
      v_row.user_id,
      'coach_team_removed',
      format('You no longer coach %s', v_team_name),
      'A club admin changed the coaches of this team. Its athletes and plans no longer show up for you.',
      jsonb_build_object('removed_team_id', v_row.team_id::text),
      array['in-app', 'email'],
      'coach_team:' || v_row.team_id::text || ':removed',
      interval '10 minutes'
    );
  end if;

  return null;
end;
$$;

-- Refuses while the member still coaches a team that is not archived. Removing or deactivating
-- them would leave those teams without their coach, so the teams are handed over first.
create or replace function public.assert_no_teams_to_hand_over(p_user_id uuid, p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_names text;
begin
  select string_agg(t.name, ', ' order by t.name) into v_names
  from public.team_coaches tc
  join public.teams t on t.id = tc.team_id and t.tenant_id = tc.tenant_id
  where tc.user_id = p_user_id
    and tc.tenant_id = p_tenant_id
    and not coalesce(t.is_archived, false)
    and t.status <> 'archived';
  if v_names is not null then
    raise exception 'This coach still coaches %. Hand those teams over first.', v_names
      using errcode = 'P0001', hint = 'handover_required';
  end if;
end;
$$;
revoke all on function public.assert_no_teams_to_hand_over(uuid, uuid) from public, anon, authenticated;

-- remove_tenant_member and set_tenant_member_access get the check above, in front of the first
-- thing they change. Their bodies are otherwise untouched.
do $$
declare
  v_def text;
  v_anchor text;
begin
  v_def := pg_get_functiondef('public.remove_tenant_member(uuid)'::regprocedure);
  if position('assert_no_teams_to_hand_over' in v_def) = 0 then
    v_anchor := '  select lower(btrim(au.email)) into v_email';
    if position(v_anchor in v_def) = 0 then
      raise exception 'remove_tenant_member does not have the expected shape, so the handover check was not added.';
    end if;
    execute replace(v_def, v_anchor,
      '  perform public.assert_no_teams_to_hand_over(v_target.user_id, v_caller.tenant_id);' || E'\n\n' || v_anchor);
  end if;

  v_def := pg_get_functiondef('public.set_tenant_member_access(uuid,text,boolean)'::regprocedure);
  if position('assert_no_teams_to_hand_over' in v_def) = 0 then
    v_anchor := '  update public.profiles p' || E'\n' || '  set role = p_role,';
    if position(v_anchor in v_def) = 0 then
      raise exception 'set_tenant_member_access does not have the expected shape, so the handover check was not added.';
    end if;
    execute replace(v_def, v_anchor,
      '  if v_target.role in (''coach'', ''club-admin'')' || E'\n'
      || '     and ((v_target.is_active and not p_is_active) or p_role = ''athlete'') then' || E'\n'
      || '    perform public.assert_no_teams_to_hand_over(v_target.user_id, v_caller.tenant_id);' || E'\n'
      || '  end if;' || E'\n\n' || v_anchor);
  end if;
end $$;

create table if not exists public.coach_handover_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  team_ids uuid[] not null default '{}',
  note text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  constraint coach_handover_requests_status_check check (status in ('open', 'done', 'dismissed')),
  constraint coach_handover_requests_note_check check (note is null or char_length(note) <= 500)
);

comment on table public.coach_handover_requests is
  'A coach asking club admins to hand their teams to someone else. The coach cannot reassign themselves: a club admin does the handover with hand_over_coach_teams().';

create unique index if not exists coach_handover_requests_one_open
  on public.coach_handover_requests (tenant_id, coach_user_id) where status = 'open';
create index if not exists coach_handover_requests_tenant_idx on public.coach_handover_requests (tenant_id, status);

alter table public.coach_handover_requests enable row level security;
revoke all on public.coach_handover_requests from public, anon, authenticated;
grant select on public.coach_handover_requests to authenticated;
grant all on public.coach_handover_requests to service_role;

-- Read only for the app: rows are written by request_coach_handover(), resolve_coach_handover_request()
-- and hand_over_coach_teams().
drop policy if exists coach_handover_requests_select_own_or_admin on public.coach_handover_requests;
create policy coach_handover_requests_select_own_or_admin
on public.coach_handover_requests
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((coach_user_id = auth.uid() and public.is_coach_or_admin()) or (select public.is_club_admin()))
);

create or replace function public.request_coach_handover(p_note text default null, p_team_ids uuid[] default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  v_mine uuid[];
  v_teams uuid[];
  v_names text;
  v_id uuid;
  v_admin uuid;
  v_name text;
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles p where p.user_id = auth.uid();
  if not found or v_profile.role not in ('coach', 'club-admin') or not v_profile.is_active then
    raise exception 'Only a coach can ask for a handover.' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Keep the note to 500 characters.' using errcode = '23514', hint = 'note_too_long';
  end if;

  select coalesce(array_agg(tc.team_id), '{}') into v_mine
  from public.team_coaches tc
  join public.teams t on t.id = tc.team_id and t.tenant_id = tc.tenant_id
  where tc.user_id = auth.uid() and tc.tenant_id = v_profile.tenant_id and not coalesce(t.is_archived, false);
  if cardinality(v_mine) = 0 then
    raise exception 'You do not coach a team, so there is nothing to hand over.' using errcode = '23514', hint = 'no_teams';
  end if;

  -- Only the caller's own teams, whatever was sent.
  select coalesce(array_agg(x), '{}') into v_teams
  from unnest(coalesce(p_team_ids, v_mine)) x
  where x = any (v_mine);
  if cardinality(v_teams) = 0 then
    v_teams := v_mine;
  end if;

  insert into public.coach_handover_requests (tenant_id, coach_user_id, team_ids, note)
  values (v_profile.tenant_id, auth.uid(), v_teams, v_note)
  on conflict (tenant_id, coach_user_id) where status = 'open'
  do update set team_ids = excluded.team_ids, note = excluded.note, created_at = now()
  returning id into v_id;

  select string_agg(t.name, ', ' order by t.name) into v_names from public.teams t where t.id = any (v_teams);
  v_name := coalesce(nullif(btrim(v_profile.display_name), ''), 'A coach');

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_profile.tenant_id, auth.uid(), v_profile.role, 'coach_handover_requested', v_name, format('asked to hand over %s', v_names));

  for v_admin in select public.notification_club_admin_user_ids(v_profile.tenant_id) loop
    if v_admin = auth.uid() then
      continue;
    end if;
    perform public.enqueue_notification(
      v_profile.tenant_id, v_admin, 'coach_handover_requested',
      format('%s asked to hand over %s', v_name, v_names),
      coalesce(v_note, 'Open People, find them under Staff and choose Hand over teams.'),
      jsonb_build_object('coach_user_id', auth.uid()::text, 'request_id', v_id::text),
      array['in-app', 'email'],
      'handover_request:' || auth.uid()::text,
      interval '1 hour'
    );
  end loop;

  return v_id;
end;
$$;
revoke all on function public.request_coach_handover(text, uuid[]) from public, anon;
grant execute on function public.request_coach_handover(text, uuid[]) to authenticated, service_role;

-- The coach takes their own request back, or a club admin sets it aside.
create or replace function public.resolve_coach_handover_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_caller_active();
  update public.coach_handover_requests r
  set status = 'dismissed', resolved_at = now(), resolved_by_user_id = auth.uid()
  where r.id = p_request_id
    and r.tenant_id = public.current_tenant_id()
    and r.status = 'open'
    and (public.is_club_admin() or (r.coach_user_id = auth.uid() and public.is_coach_or_admin()));
  if not found then
    raise exception 'That request is no longer open.' using errcode = '23514', hint = 'request_not_open';
  end if;
end;
$$;
revoke all on function public.resolve_coach_handover_request(uuid) from public, anon;
grant execute on function public.resolve_coach_handover_request(uuid) to authenticated, service_role;

-- The handover. p_assignments is a list of {"team_id": ..., "new_lead_user_id": ... or null}.
--   new_lead_user_id set: that coach becomes lead of the team (added to it if needed).
--   new_lead_user_id null: the team stays with its remaining coaches. Refused when no active
--     lead coach or coach would be left.
-- The leaving coach comes off every team listed. p_then is 'none' (they stay in the club),
-- 'deactivate' or 'remove'; for those two every team they still coach must be listed.
-- All of it happens or none of it does.
create or replace function public.hand_over_coach_teams(p_user_id uuid, p_assignments jsonb, p_then text default 'none')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_target_name text;
  v_target_label text;
  v_item jsonb;
  v_team public.teams%rowtype;
  v_team_id uuid;
  v_new_lead uuid;
  v_new_lead_name text;
  v_seen uuid[] := '{}';
  v_threads integer := 0;
  v_plans integer := 0;
  v_moved integer;
  v_parts text[] := '{}';
  v_recipient uuid;
  v_then text := coalesce(p_then, 'none');
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_caller from public.profiles p where p.user_id = auth.uid();
  if not found or v_caller.role <> 'club-admin' or not v_caller.is_active then
    raise exception 'Only a club admin can hand over a coach''s teams.' using errcode = '42501';
  end if;
  if v_then not in ('none', 'deactivate', 'remove') then
    raise exception 'Choose what happens to the coach after the handover.' using errcode = '22023';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Choose what happens to each team.' using errcode = '22023';
  end if;

  select * into v_target
  from public.profiles p
  where p.user_id = p_user_id and p.tenant_id = v_caller.tenant_id
  for update;
  if not found or v_target.role not in ('coach', 'club-admin') then
    raise exception 'Coach not found in this club.' using errcode = '23514', hint = 'coach_not_found';
  end if;
  if v_target.user_id = auth.uid() and v_then <> 'none' then
    raise exception 'You cannot remove or deactivate yourself.' using errcode = '42501';
  end if;

  -- Hold the club's assignments so two admins cannot hand the same team over at once.
  perform 1 from public.team_coaches tc where tc.tenant_id = v_caller.tenant_id order by tc.id for update;

  v_target_name := coalesce(nullif(btrim(regexp_replace(coalesce(v_target.display_name, ''), '\s+', ' ', 'g')), ''), 'Coach');
  v_target_label := public.coach_display_label(v_target.user_id, v_caller.tenant_id);

  for v_item in select * from jsonb_array_elements(p_assignments) loop
    begin
      v_team_id := nullif(v_item ->> 'team_id', '')::uuid;
      v_new_lead := nullif(v_item ->> 'new_lead_user_id', '')::uuid;
    exception when others then
      raise exception 'Choose what happens to each team.' using errcode = '22023';
    end;

    select * into v_team from public.teams t where t.id = v_team_id and t.tenant_id = v_caller.tenant_id for update;
    if not found or v_team_id = any (v_seen) or not exists (
      select 1 from public.team_coaches tc where tc.team_id = v_team_id and tc.user_id = v_target.user_id
    ) then
      raise exception 'That team is not one this coach coaches.' using errcode = '23514', hint = 'team_not_coached';
    end if;
    v_seen := array_append(v_seen, v_team_id);

    v_threads := v_threads + (
      select count(*)::integer
      from public.message_threads t
      join public.athletes a on a.id = t.athlete_id
      where t.coach_user_id = v_target.user_id
        and t.tenant_id = v_caller.tenant_id
        and t.closed_at is null
        and coalesce(a.team_id, t.team_id) = v_team_id
    );

    if v_new_lead is not null then
      select coalesce(nullif(btrim(p.display_name), ''), 'Coach') into v_new_lead_name
      from public.profiles p
      where p.user_id = v_new_lead
        and p.tenant_id = v_caller.tenant_id
        and p.role in ('coach', 'club-admin')
        and p.is_active;
      if not found or v_new_lead = v_target.user_id then
        raise exception 'Pick another active coach of this club to take over %.', v_team.name
          using errcode = '23514', hint = 'new_lead_invalid';
      end if;

      update public.team_coaches tc
      set role = 'coach'
      where tc.team_id = v_team_id and tc.role = 'lead' and tc.user_id not in (v_new_lead, v_target.user_id);

      perform set_config('sktr.handover_new_lead', v_new_lead::text, true);
      insert into public.team_coaches (tenant_id, team_id, user_id, role, created_by_user_id)
      values (v_caller.tenant_id, v_team_id, v_new_lead, 'lead', auth.uid())
      on conflict (team_id, user_id) do update set role = 'lead';
      perform set_config('sktr.handover_new_lead', '', true);

      v_parts := array_append(v_parts, format('%s to %s (lead)', v_team.name, v_new_lead_name));
    else
      if not exists (
        select 1
        from public.team_coaches tc
        join public.profiles p on p.user_id = tc.user_id and p.tenant_id = tc.tenant_id
        where tc.team_id = v_team_id
          and tc.user_id <> v_target.user_id
          and tc.role in ('lead', 'coach')
          and p.is_active
          and p.role in ('coach', 'club-admin')
      ) then
        raise exception '% would have no coach left. Pick who takes over as lead.', v_team.name
          using errcode = '23514', hint = 'team_needs_coach';
      end if;
      v_parts := array_append(v_parts, format('%s stays with its other coaches', v_team.name));
    end if;

    -- Off the team. The team_coaches triggers close their conversations with this team's
    -- athletes and tell the coach.
    delete from public.team_coaches tc where tc.team_id = v_team_id and tc.user_id = v_target.user_id;

    -- Plans they built for this team without filing them under it become the team's, so its
    -- coaches can keep editing them. Plans, test weeks, templates, exercises and notes already
    -- filed under the team or the club are untouched: they never belonged to the person.
    update public.training_plans tp
    set team_id = v_team_id
    where tp.tenant_id = v_caller.tenant_id
      and tp.team_id is null
      and tp.created_by_user_id = v_target.user_id
      and exists (
        select 1
        from public.training_plan_assignments tpa
        left join public.athletes a on a.id = tpa.athlete_id
        where tpa.plan_id = tp.id
          and (tpa.team_id = v_team_id or a.team_id = v_team_id)
      );
    get diagnostics v_moved = row_count;
    v_plans := v_plans + v_moved;

    -- Tell the new lead, then the athletes of the team who have a login.
    if v_new_lead is not null and v_new_lead <> auth.uid() then
      perform public.enqueue_notification(
        v_caller.tenant_id, v_new_lead, 'coach_handover_new_lead',
        format('You are now lead coach of %s', v_team.name),
        format('You take over from %s. The team''s plans, test weeks and coach notes are yours to carry on. Their private conversations with athletes were not passed on.', v_target_name),
        jsonb_build_object('team_id', v_team_id::text),
        array['in-app', 'email'],
        'handover_lead:' || v_team_id::text || ':' || v_new_lead::text,
        interval '10 minutes'
      );
    end if;

    for v_recipient in
      select a.user_id
      from public.athletes a
      join public.profiles p on p.user_id = a.user_id and p.tenant_id = a.tenant_id and p.is_active
      where a.team_id = v_team_id and a.is_active and a.user_id is not null
    loop
      perform public.enqueue_notification(
        v_caller.tenant_id, v_recipient, 'team_coach_changed',
        case when v_new_lead is not null
          then format('%s has a new lead coach', v_team.name)
          else format('%s no longer coaches %s', v_target_label, v_team.name) end,
        case when v_new_lead is not null
          then format('%s takes over from %s. Your plan and results stay as they are.', public.coach_display_label(v_new_lead, v_caller.tenant_id), v_target_label)
          else 'Your other coaches carry on. Your plan and results stay as they are.' end,
        jsonb_build_object('team_id', v_team_id::text),
        array['in-app'],
        'handover_team:' || v_team_id::text || ':' || v_recipient::text,
        interval '10 minutes'
      );
    end loop;
  end loop;

  if cardinality(v_seen) = 0 and v_then = 'none' then
    raise exception 'Choose at least one team to hand over.' using errcode = '22023';
  end if;

  update public.coach_handover_requests r
  set status = 'done', resolved_at = now(), resolved_by_user_id = auth.uid()
  where r.tenant_id = v_caller.tenant_id and r.coach_user_id = v_target.user_id and r.status = 'open';

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    v_caller.tenant_id, auth.uid(), 'club-admin', 'coach_handover', v_target_name,
    case when cardinality(v_parts) = 0 then 'no teams to hand over' else array_to_string(v_parts, '; ') end
      || case v_then when 'remove' then '. Then removed from the club.' when 'deactivate' then '. Then deactivated.' else '' end
  );

  -- These two refuse while any active team is still theirs, so a partial list rolls everything back.
  if v_then = 'deactivate' then
    perform public.set_tenant_member_access(v_target.user_id, v_target.role, false);
  elsif v_then = 'remove' then
    perform public.remove_tenant_member(v_target.user_id);
  end if;

  return jsonb_build_object('teams', cardinality(v_seen), 'threads_closed', v_threads, 'plans_moved', v_plans, 'then', v_then);
end;
$$;
revoke all on function public.hand_over_coach_teams(uuid, jsonb, text) from public, anon;
grant execute on function public.hand_over_coach_teams(uuid, jsonb, text) to authenticated, service_role;

-- resolved_by_user_id lets go of a deleted account like every other "set null" reference.
do $$ begin perform public.install_deleted_account_triggers(); end $$;

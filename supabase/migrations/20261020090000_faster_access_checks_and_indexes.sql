-- Faster access checks and missing indexes.
--
-- The app was slow on phones partly because of work the database repeated for every row it read.
-- Nobody gains or loses access to anything here. The same people see and change the same rows,
-- the database just does less work to decide it.
--
-- 1. Training plan weeks, days and blocks asked "may this person see or change this plan?" once
--    per row, and the day and block rules re-ran the week rules inside them. A coach opening a
--    12 week plan waited about a second. The answer is now worked out once per request, as a list
--    of the plans the caller may see and a list of the plans they may change.
-- 2. Every access rule now asks "which club is this?", "who is calling?" and "are they an admin?"
--    once per request instead of once per row (the call is wrapped as (select ...)). On a club's
--    completions this took a query from about 170 ms to about 6 ms.
-- 3. Indexes for lookups the app and the database make often: an athlete's completions, test
--    results and set logs, an athlete by their login, and a few links between tables that had none.
-- 4. The list of athletes whose training load the caller may read checked the caller's role once
--    per athlete in the club. It now checks once.
-- 5. Weekly training load read an athlete's whole history to draw at most 52 weeks. It now reads
--    only the days the weeks shown can use (see the note in section 5).

-- 1. Training plan weeks, days and blocks ----------------------------------------------------------

-- The plans the caller may change. Same rule as can_manage_training_plan(), for every plan at once:
-- a club admin changes every plan in the club, a lead or coach changes their teams' plans, and a
-- coach who may write club content changes the club-wide plans they made.
create or replace function public.current_staff_manageable_plan_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with me as materialized (
    select
      public.current_tenant_id() as tenant_id,
      auth.uid() as user_id,
      public.is_club_admin() as is_admin,
      public.current_coach_team_ids() as coach_team_ids,
      public.can_author_club_content() as can_author
  )
  select coalesce(array_agg(tp.id), '{}'::uuid[])
  from me
  join public.training_plans tp on tp.tenant_id = me.tenant_id
  where me.is_admin
     or (tp.team_id is not null and tp.team_id = any (me.coach_team_ids))
     or (tp.team_id is null and tp.created_by_user_id = me.user_id and me.can_author)
$$;

revoke all on function public.current_staff_manageable_plan_ids() from public, anon;
grant execute on function public.current_staff_manageable_plan_ids() to authenticated, service_role;

-- The plans the caller may see as staff. Same rule as can_view_training_plan(): the plans they may
-- change, plus the plans of any team they are on as lead, coach or assistant.
create or replace function public.current_staff_viewable_plan_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with me as materialized (
    select
      public.current_tenant_id() as tenant_id,
      public.current_staff_manageable_plan_ids() as manageable,
      public.current_staff_team_ids() as staff_team_ids
  )
  select coalesce(array_agg(tp.id), '{}'::uuid[])
  from me
  join public.training_plans tp on tp.tenant_id = me.tenant_id
  where tp.id = any (me.manageable)
     or (tp.team_id is not null and tp.team_id = any (me.staff_team_ids))
$$;

revoke all on function public.current_staff_viewable_plan_ids() from public, anon;
grant execute on function public.current_staff_viewable_plan_ids() to authenticated, service_role;

-- The plan a week or a day belongs to. Looked up directly (one index read), so the day and block
-- rules no longer run the week and day rules inside themselves. It only returns a plan id, which
-- by itself gives nobody access to anything.
create or replace function public.training_plan_week_plan_id(p_plan_week_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.plan_id from public.training_plan_weeks w where w.id = p_plan_week_id
$$;

revoke all on function public.training_plan_week_plan_id(uuid) from public, anon;
grant execute on function public.training_plan_week_plan_id(uuid) to authenticated, service_role;

create or replace function public.training_plan_day_plan_id(p_plan_day_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.plan_id
  from public.training_plan_days d
  join public.training_plan_weeks w on w.id = d.plan_week_id
  where d.id = p_plan_day_id
$$;

revoke all on function public.training_plan_day_plan_id(uuid) from public, anon;
grant execute on function public.training_plan_day_plan_id(uuid) to authenticated, service_role;

-- The guardian rules for days and blocks change the same way (the guardian rule for weeks is
-- already cheap and stays as it is).
--
-- Weeks. The staff read rule gains the (select is_coach_or_admin()) guard the change rule already
-- had. It does not narrow anything (only coaches and admins can see a plan as staff), it just
-- spares athletes and guardians the work.
drop policy if exists training_plan_weeks_select_team_staff on public.training_plan_weeks;
create policy training_plan_weeks_select_team_staff
on public.training_plan_weeks
for select
to authenticated
using (
  (select public.is_coach_or_admin())
  and plan_id = any ((select public.current_staff_viewable_plan_ids())::uuid[])
);

drop policy if exists training_plan_weeks_staff_all on public.training_plan_weeks;
create policy training_plan_weeks_staff_all
on public.training_plan_weeks
for all
to authenticated
using (
  (select public.is_coach_or_admin())
  and plan_id = any ((select public.current_staff_manageable_plan_ids())::uuid[])
)
with check (
  (select public.is_coach_or_admin())
  and plan_id = any ((select public.current_staff_manageable_plan_ids())::uuid[])
);

-- Days.
drop policy if exists training_plan_days_select_team_staff on public.training_plan_days;
create policy training_plan_days_select_team_staff
on public.training_plan_days
for select
to authenticated
using (
  (select public.is_coach_or_admin())
  and public.training_plan_week_plan_id(plan_week_id) = any ((select public.current_staff_viewable_plan_ids())::uuid[])
);

drop policy if exists training_plan_days_staff_all on public.training_plan_days;
create policy training_plan_days_staff_all
on public.training_plan_days
for all
to authenticated
using (
  (select public.is_coach_or_admin())
  and public.training_plan_week_plan_id(plan_week_id) = any ((select public.current_staff_manageable_plan_ids())::uuid[])
)
with check (
  (select public.is_coach_or_admin())
  and public.training_plan_week_plan_id(plan_week_id) = any ((select public.current_staff_manageable_plan_ids())::uuid[])
);

drop policy if exists training_plan_days_select_guardian on public.training_plan_days;
create policy training_plan_days_select_guardian
on public.training_plan_days
for select
to authenticated
using (
  public.training_plan_week_plan_id(plan_week_id) = any ((select public.current_guardian_plan_ids())::uuid[])
);

-- Blocks.
drop policy if exists training_plan_blocks_select_team_staff on public.training_plan_blocks;
create policy training_plan_blocks_select_team_staff
on public.training_plan_blocks
for select
to authenticated
using (
  (select public.is_coach_or_admin())
  and public.training_plan_day_plan_id(plan_day_id) = any ((select public.current_staff_viewable_plan_ids())::uuid[])
);

drop policy if exists training_plan_blocks_staff_all on public.training_plan_blocks;
create policy training_plan_blocks_staff_all
on public.training_plan_blocks
for all
to authenticated
using (
  (select public.is_coach_or_admin())
  and public.training_plan_day_plan_id(plan_day_id) = any ((select public.current_staff_manageable_plan_ids())::uuid[])
)
with check (
  (select public.is_coach_or_admin())
  and public.training_plan_day_plan_id(plan_day_id) = any ((select public.current_staff_manageable_plan_ids())::uuid[])
);

drop policy if exists training_plan_blocks_select_guardian on public.training_plan_blocks;
create policy training_plan_blocks_select_guardian
on public.training_plan_blocks
for select
to authenticated
using (
  public.training_plan_day_plan_id(plan_day_id) = any ((select public.current_guardian_plan_ids())::uuid[])
);

-- 2. Ask "who is calling?" once per request in every access rule ------------------------------------

-- Rewrites each rule in the public schema so that calls to the caller's own details, such as
-- current_tenant_id(), auth.uid() or is_club_admin(), become (select current_tenant_id()) and
-- so on. Postgres then works them out once per request instead of once per row. The result is the
-- same, because these functions take no arguments and give the same answer all through a request.
--
-- Only calls with no arguments are touched, and only to functions that are stable, return one plain
-- value (not a list) and are not assert_ checks. Calls already wrapped are left alone, so running
-- this again changes nothing. Storage rules are left as they are (that schema belongs to Supabase).
do $wrap$
declare
  v_names text;
  v_public text;
  v_auth text;
  r record;
  v_using text;
  v_check text;
begin
  select string_agg(distinct p.proname, '|' order by p.proname)
  into v_names
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.pronargs = 0
    and p.provolatile in ('s', 'i')
    and not p.proretset
    and p.prokind = 'f'
    and p.prorettype not in ('void'::regtype, 'trigger'::regtype)
    and not exists (select 1 from pg_type t where t.oid = p.prorettype and t.typcategory = 'A')
    and p.proname !~ '^assert_';

  -- Not preceded by a letter, digit, underscore or dot (so not part of a longer name), and not
  -- already right after "SELECT " (already wrapped).
  v_public := '(?<![[:alnum:]_.])(?<!SELECT )(?:public\.)?(' || coalesce(v_names, 'no_such_function') || ')\(\)';
  v_auth := '(?<![[:alnum:]_.])(?<!SELECT )auth\.(uid|jwt|role|email)\(\)';

  for r in
    select pol.schemaname, pol.tablename, pol.policyname, pol.qual, pol.with_check
    from pg_policies pol
    where pol.schemaname = 'public'
  loop
    v_using := r.qual;
    v_check := r.with_check;
    if v_using is not null then
      v_using := regexp_replace(v_using, v_public, '(select public.\1())', 'g');
      v_using := regexp_replace(v_using, v_auth, '(select auth.\1())', 'g');
    end if;
    if v_check is not null then
      v_check := regexp_replace(v_check, v_public, '(select public.\1())', 'g');
      v_check := regexp_replace(v_check, v_auth, '(select auth.\1())', 'g');
    end if;
    if v_using is distinct from r.qual then
      execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, v_using);
    end if;
    if v_check is distinct from r.with_check then
      execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, v_check);
    end if;
  end loop;
end
$wrap$;

-- 3. Indexes ------------------------------------------------------------------------------------------

-- The app reads an athlete's completions, test results and set logs by athlete alone. The existing
-- indexes start with the club, so they could not be used for that.
create index if not exists session_completions_athlete_date_idx
  on public.session_completions (athlete_id, completion_date desc);
create index if not exists test_results_athlete_submitted_idx
  on public.test_results (athlete_id, submitted_at desc);
create index if not exists session_row_logs_athlete_idx
  on public.session_row_logs (athlete_id);

-- Finding the caller's own athlete record by their login (several database functions and app
-- reads look it up without the club).
create index if not exists athletes_user_idx
  on public.athletes (user_id) where user_id is not null;

-- Links between tables with no index. Deleting a session clears attendance that points at it, and
-- that had to read the whole attendance table each time.
create index if not exists athlete_attendance_session_idx
  on public.athlete_attendance (session_id);
create index if not exists session_block_rows_exercise_idx
  on public.session_block_rows (exercise_id);
create index if not exists session_media_session_block_row_idx
  on public.session_media (session_block_row_id);
create index if not exists coach_invites_team_idx
  on public.coach_invites (team_id);
create index if not exists athlete_lift_maxes_exercise_idx
  on public.athlete_lift_maxes (exercise_id);

-- 4. Whose training load the caller may read --------------------------------------------------------

-- Same answer as before. The caller's club, login, admin flag and coached athletes are worked out
-- once (materialized), not once per athlete in the club.
create or replace function public.training_load_readable_athlete_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with me as materialized (
    select
      public.current_tenant_id() as tenant_id,
      auth.uid() as user_id,
      public.is_club_admin() as is_admin,
      public.current_coach_athlete_ids() as coach_athlete_ids
  )
  select coalesce(array_agg(a.id), '{}'::uuid[])
  from me
  join public.athletes a on a.tenant_id = me.tenant_id
  where me.tenant_id is not null
    and (
      a.user_id = me.user_id
      or me.is_admin
      or a.id = any (me.coach_athlete_ids)
    )
$$;

revoke all on function public.training_load_readable_athlete_ids() from public, anon;
grant execute on function public.training_load_readable_athlete_ids() to authenticated, service_role;

-- 5. Weekly, acute and chronic load -------------------------------------------------------------------

-- Same as 20261015100000, with two changes that do not change any result:
--
-- a. Completions are read from v_from onwards instead of from the very first one. The earliest day
--    any figure uses is 27 days before the reference day of the oldest week shown. The oldest week
--    starts on v_this_week - 7 * (v_weeks - 1), and its reference day is never earlier than the day
--    before that Monday (the current week, when nothing is logged yet today, uses yesterday). So
--    nothing before v_this_week - 7 * (v_weeks - 1) - 28 = v_this_week - 7 * v_weeks - 21 is ever
--    used. v_from keeps one more week of margin on top of that.
-- b. The first day with a load (first_load_on) still needs the whole history, so it is read
--    straight from session_completions (by the athlete index above) rather than from the shorter
--    list in a.
create or replace function public.training_load_weeks(
  p_team_id uuid default null,
  p_athlete_id uuid default null,
  p_as_of date default current_date,
  p_weeks int default 12
)
returns table (
  athlete_id uuid,
  week_start date,
  week_load int,
  sessions_with_load int,
  sessions_without_load int,
  planned_load int,
  acute_load int,
  chronic_load numeric,
  load_ratio numeric,
  first_load_on date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_weeks int := least(greatest(coalesce(p_weeks, 12), 1), 52);
  v_this_week date;
  v_from date;
  v_readable uuid[];
begin
  perform public.assert_caller_active();
  v_readable := public.training_load_readable_athlete_ids();
  -- date_trunc('week') is the Monday of the week.
  v_this_week := date_trunc('week', v_as_of::timestamp)::date;
  -- See note a above.
  v_from := v_this_week - 7 * v_weeks - 28;

  return query
  with scope as (
    select a.id
    from public.athletes a
    where a.id = any (v_readable)
      and (p_team_id is null or a.team_id = p_team_id)
      and (p_athlete_id is null or a.id = p_athlete_id)
      -- A list (no single athlete asked for) leaves out athletes who are no longer active.
      and (p_athlete_id is not null or a.is_active)
  ),
  weeks as (
    select
      (v_this_week - 7 * g.i)::date as week_start,
      least((v_this_week - 7 * g.i + 6)::date, v_as_of) as ref_day
    from generate_series(0, v_weeks - 1) as g(i)
  ),
  done as (
    select
      sc.athlete_id,
      sc.completion_date as day,
      case when sc.rpe is not null and sc.duration_minutes is not null then sc.rpe::int * sc.duration_minutes::int end as load
    from public.session_completions sc
    where sc.athlete_id in (select s.id from scope s)
      and sc.completion_date <= v_as_of
      and sc.completion_date >= v_from
  ),
  firsts as (
    select fc.athlete_id, min(fc.completion_date) as first_load_on
    from public.session_completions fc
    where fc.athlete_id in (select s.id from scope s)
      and fc.completion_date <= v_as_of
      and fc.rpe is not null
      and fc.duration_minutes is not null
    group by fc.athlete_id
  ),
  planned as (
    select
      s.athlete_id,
      s.scheduled_for as day,
      s.estimated_duration_minutes * s.planned_effort::int as load
    from public.sessions s
    where s.athlete_id in (select sc2.id from scope sc2)
      and s.origin = 'plan'
      and s.estimated_duration_minutes is not null
      and s.planned_effort is not null
      and s.scheduled_for >= (v_this_week - 7 * (v_weeks - 1))
      and s.scheduled_for <= v_this_week + 6
  )
  select
    sc.id,
    w.week_start,
    coalesce(wk.week_load, 0)::int,
    coalesce(wk.with_load, 0)::int,
    coalesce(wk.without_load, 0)::int,
    pl.planned_load::int,
    coalesce(ac.acute, 0)::int,
    (coalesce(ac.sum28, 0)::numeric / 4),
    case
      when f.first_load_on is not null and f.first_load_on <= w.ref_day - 27 and coalesce(ac.sum28, 0) > 0
        then round(coalesce(ac.acute, 0)::numeric * 4 / ac.sum28, 2)
    end,
    f.first_load_on
  from scope sc
  cross join weeks wk0
  cross join lateral (
    select
      wk0.week_start,
      case
        when wk0.week_start = v_this_week and not exists (select 1 from done d0 where d0.athlete_id = sc.id and d0.day = v_as_of)
          then v_as_of - 1
        else wk0.ref_day
      end as ref_day
  ) w
  left join firsts f on f.athlete_id = sc.id
  left join lateral (
    select
      sum(d.load) as week_load,
      count(*) filter (where d.load is not null) as with_load,
      count(*) filter (where d.load is null) as without_load
    from done d
    where d.athlete_id = sc.id and d.day between w.week_start and w.week_start + 6
  ) wk on true
  left join lateral (
    select
      sum(d.load) filter (where d.day > w.ref_day - 7) as acute,
      sum(d.load) as sum28
    from done d
    where d.athlete_id = sc.id and d.day between w.ref_day - 27 and w.ref_day
  ) ac on true
  left join lateral (
    select sum(p.load) as planned_load
    from planned p
    where p.athlete_id = sc.id and p.day between w.week_start and w.week_start + 6
  ) pl on true
  order by sc.id, w.week_start;
end;
$$;

revoke all on function public.training_load_weeks(uuid, uuid, date, int) from public, anon;
grant execute on function public.training_load_weeks(uuid, uuid, date, int) to authenticated, service_role;

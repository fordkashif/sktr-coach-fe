-- Training load and plan phases.
--
-- 1. SESSION LOAD. Session load = session effort (1 to 10) x minutes (the session RPE method).
--    session_completions gains duration_minutes: how long the session took, asked when the
--    athlete finishes it and prefilled from the planned minutes. A completion without an effort
--    or without minutes has NO load. Nothing is guessed, here or in the app.
--
-- 2. PLANNED LOAD. sessions gains planned_effort (the effort the coach intends, 1 to 10).
--    Planned load = sessions.estimated_duration_minutes x sessions.planned_effort, for sessions
--    that came from a plan. Both are optional.
--
-- 3. LOAD OVER TIME. training_load_weeks() returns, for every athlete the caller may see, one row
--    per week (Monday to Sunday) with:
--      week_load     sum of session loads completed in that week
--      acute_load    sum of session loads over the 7 days ending on the week's last day. For the
--                    week still running: ending on p_as_of once the athlete finished a session on
--                    that day, and on the day before until then (a morning before training would
--                    otherwise always read as a light week)
--      chronic_load  sum over the 28 days ending on that same day, divided by 4
--                    (the rolling weekly average)
--      load_ratio    acute_load / chronic_load rounded to 2 places. NULL until the athlete's first
--                    session with a load is at least 28 days old, and NULL when chronic_load is 0.
--      planned_load  sum of planned loads of that week, NULL when no session carries both numbers
--    One call covers a whole team, so a team table never runs a query per athlete.
--    training_load_sessions() lists the completed sessions of one athlete in a period.
--
--    WHO MAY READ: the athlete themself, the coaches of the athlete's team, club admins of the
--    club. Nobody else, and never another club. Load is training data (effort x minutes), not
--    health data: every coach of the team reads it. The functions are security definer so this
--    rule stays put whatever later migrations do to the row policies of the health tables; they
--    check the caller themselves (active member, same club, one of the three roles above).
--
-- 4. PLAN PHASES. Phases, week types and target loads live in training_plans.builder_state and
--    plan_templates.structure (both jsonb, no change needed). training_plan_weeks, which is what
--    the athlete reads, gains week_type and phase_name so the athlete's plan can say
--    "Specific prep, deload week". Both are optional: plans published before this keep working.
--
-- Idempotent: add column if not exists, constraints guarded, create or replace function.
-- Nothing is backfilled and nothing is removed. No new table.

-- 1. Columns ---------------------------------------------------------------------------------

alter table public.session_completions
  add column if not exists duration_minutes smallint;

comment on column public.session_completions.duration_minutes is
  'How long the session took, in minutes, as the athlete (or a coach logging for them) said when finishing. Null when not given: the session then has no load.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'session_completions_duration_range' and conrelid = 'public.session_completions'::regclass
  ) then
    alter table public.session_completions
      add constraint session_completions_duration_range
      check (duration_minutes is null or (duration_minutes >= 1 and duration_minutes <= 600)) not valid;
  end if;
end
$$;

alter table public.sessions
  add column if not exists planned_effort smallint;

comment on column public.sessions.planned_effort is
  'The effort the coach intends for this session, 1 to 10. With estimated_duration_minutes it gives the planned load. Null when the coach did not set it.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_planned_effort_range' and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_planned_effort_range
      check (planned_effort is null or (planned_effort >= 1 and planned_effort <= 10)) not valid;
  end if;
end
$$;

alter table public.training_plan_weeks
  add column if not exists week_type text;

alter table public.training_plan_weeks
  add column if not exists phase_name text;

comment on column public.training_plan_weeks.week_type is
  'What kind of week this is: build, hold, deload, test or competition. Null when the coach did not say.';
comment on column public.training_plan_weeks.phase_name is
  'The name of the plan phase this week belongs to (General prep, Taper, or the coach''s own words). Null when the week is in no phase.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_plan_weeks_week_type_check' and conrelid = 'public.training_plan_weeks'::regclass
  ) then
    alter table public.training_plan_weeks
      add constraint training_plan_weeks_week_type_check
      check (week_type is null or week_type in ('build', 'hold', 'deload', 'test', 'competition'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_plan_weeks_phase_name_length' and conrelid = 'public.training_plan_weeks'::regclass
  ) then
    alter table public.training_plan_weeks
      add constraint training_plan_weeks_phase_name_length
      check (phase_name is null or char_length(phase_name) between 1 and 60);
  end if;
end
$$;

-- 2. Who may read an athlete's load ------------------------------------------------------------

-- The athletes of the caller's club whose load the caller may read: their own athlete record,
-- the athletes of the teams they coach, or everyone in the club for a club admin.
create or replace function public.training_load_readable_athlete_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(a.id), '{}'::uuid[])
  from public.athletes a
  where public.caller_is_active_member()
    and a.tenant_id = public.current_tenant_id()
    and (
      a.user_id = auth.uid()
      or public.is_club_admin()
      or a.id = any (public.current_coach_athlete_ids())
    )
$$;

revoke all on function public.training_load_readable_athlete_ids() from public, anon;
grant execute on function public.training_load_readable_athlete_ids() to authenticated, service_role;

-- 3. Weekly, acute and chronic load -------------------------------------------------------------

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
  v_readable uuid[];
begin
  perform public.assert_caller_active();
  v_readable := public.training_load_readable_athlete_ids();
  -- date_trunc('week') is the Monday of the week.
  v_this_week := date_trunc('week', v_as_of::timestamp)::date;

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
  ),
  firsts as (
    select d.athlete_id, min(d.day) as first_load_on
    from done d
    where d.load is not null
    group by d.athlete_id
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

-- 4. The sessions behind a period ----------------------------------------------------------------

create or replace function public.training_load_sessions(
  p_athlete_id uuid,
  p_from date,
  p_to date
)
returns table (
  session_id uuid,
  completed_on date,
  title text,
  effort int,
  duration_minutes int,
  session_load int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_caller_active();
  if p_athlete_id is null or not (p_athlete_id = any (public.training_load_readable_athlete_ids())) then
    return;
  end if;

  return query
  select
    sc.session_id,
    sc.completion_date,
    s.title,
    sc.rpe::int,
    sc.duration_minutes::int,
    case when sc.rpe is not null and sc.duration_minutes is not null then sc.rpe::int * sc.duration_minutes::int end
  from public.session_completions sc
  join public.sessions s on s.id = sc.session_id
  where sc.athlete_id = p_athlete_id
    and sc.completion_date between p_from and p_to
  order by sc.completion_date desc, sc.completed_at desc;
end;
$$;

revoke all on function public.training_load_sessions(uuid, date, date) from public, anon;
grant execute on function public.training_load_sessions(uuid, date, date) to authenticated, service_role;

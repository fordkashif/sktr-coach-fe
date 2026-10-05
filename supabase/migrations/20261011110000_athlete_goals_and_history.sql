-- Athlete goals: a target mark in an event, with an optional date and note.
--
-- What this adds
--   * public.athlete_goals: one row per goal. The athlete sets their own; the coaches of the
--     athlete's team and club admins can read, add, change and remove them. Nobody else sees them.
--   * A goal is achieved by itself when a later wind legal result of the same event meets the
--     target. The goal row is worked out again whenever it, or a result of its event, changes
--     (athlete_goals_normalise). It can also be marked achieved by hand.
--
-- Nothing is notified. Results are not copied: a goal points at the result that met it, and
-- progress is read from public.athlete_results by the app.
--
-- The session history and test week history screens added with this change read existing tables
-- (sessions, session_completions, session_row_logs, test_results) and need nothing new here.
--
-- Idempotent: create table / index if not exists, create or replace function, drop trigger and
-- drop policy if exists before each create. Safe to apply twice.

-- 1. Table -------------------------------------------------------------------------------------

create table if not exists public.athlete_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  event_key text not null references public.result_events(key),
  -- The event's name. For 'other' this is the free text of the athlete's test ("Flying 30m").
  event_label text not null check (char_length(event_label) between 1 and 80),
  -- The same grouping as athlete_results.event_group. Set by trigger.
  event_group text not null,
  mark_unit text not null check (mark_unit in ('s', 'm', 'cm', 'kg', 'pts')),
  lower_is_better boolean not null,
  -- The mark to reach, in the event's unit. Compared with athlete_results.compare_value.
  target_value numeric(12, 3) not null check (target_value > 0 and target_value < 1000000),
  -- The athlete's best wind legal mark when the goal was set. Null when they had none.
  start_value numeric(12, 3),
  target_date date,
  note text check (note is null or char_length(note) <= 500),
  -- The day the goal was reached. Null while it is open.
  achieved_on date,
  -- The result that met the target. Null when the goal was marked achieved by hand.
  achieved_result_id uuid references public.athlete_results(id) on delete set null,
  achieved_manually boolean not null default false,
  -- True when a coach or club admin set the goal for the athlete.
  set_by_staff boolean not null default false,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists athlete_goals_athlete_event_idx
on public.athlete_goals (athlete_id, event_group);

create index if not exists athlete_goals_tenant_athlete_idx
on public.athlete_goals (tenant_id, athlete_id, created_at desc);

-- 2. Keeping a goal consistent -----------------------------------------------------------------
-- Before every insert and update: the tenant comes from the athlete, the event's name, unit and
-- direction come from result_events, the starting mark is taken on insert, and whether the goal
-- is achieved is worked out from the athlete's results.

create or replace function public.athlete_goals_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.result_events%rowtype;
  v_tenant_id uuid;
  v_best public.athlete_results%rowtype;
  v_hit public.athlete_results%rowtype;
begin
  if tg_op = 'UPDATE' then
    -- Whose goal it is, who set it and when never change.
    new.athlete_id := old.athlete_id;
    new.tenant_id := old.tenant_id;
    new.created_by_user_id := old.created_by_user_id;
    new.set_by_staff := old.set_by_staff;
    new.created_at := old.created_at;
    new.start_value := old.start_value;
  end if;

  select a.tenant_id into v_tenant_id from public.athletes a where a.id = new.athlete_id;
  if not found then
    raise exception 'This athlete does not exist.' using errcode = '23503';
  end if;
  new.tenant_id := v_tenant_id;

  select e.* into v_event from public.result_events e where e.key = new.event_key;
  if not found then
    raise exception 'Unknown event.' using errcode = '23503';
  end if;

  if v_event.kind = 'other' then
    new.event_label := left(btrim(regexp_replace(coalesce(new.event_label, ''), '\s+', ' ', 'g')), 80);
    if new.event_label = '' then
      raise exception 'Name the event.' using errcode = '23514';
    end if;
    if new.mark_unit is null then
      raise exception 'Choose what the mark is measured in.' using errcode = '23514';
    end if;
    new.lower_is_better := coalesce(new.lower_is_better, new.mark_unit = 's');
    new.event_group := 'o:' || lower(new.event_label);
  else
    new.event_label := v_event.name;
    new.mark_unit := v_event.unit;
    new.lower_is_better := v_event.lower_is_better;
    new.event_group := 'k:' || v_event.key;
  end if;

  new.target_value := case new.mark_unit
    when 'm' then round(new.target_value, 2)
    when 'cm' then round(new.target_value, 1)
    when 'kg' then round(new.target_value, 2)
    when 'pts' then round(new.target_value, 0)
    else round(new.target_value, 3)
  end;
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.achieved_manually := false;
    if auth.uid() is not null then
      new.created_by_user_id := auth.uid();
      new.set_by_staff := new.athlete_id is distinct from public.current_athlete_id();
    end if;

    select r.* into v_best
    from public.athlete_results r
    where r.id = public.athlete_event_best(new.athlete_id, new.event_group, null, null, true);
    if found then
      new.start_value := v_best.compare_value;
      if (new.lower_is_better and v_best.compare_value <= new.target_value)
        or (not new.lower_is_better and v_best.compare_value >= new.target_value) then
        raise exception 'This mark is already reached. Set a target beyond the current best.' using errcode = '23514';
      end if;
    else
      new.start_value := null;
    end if;
  end if;

  if new.achieved_manually then
    -- Marked achieved by hand: keep the day it was marked.
    new.achieved_on := coalesce(new.achieved_on, case when tg_op = 'UPDATE' then old.achieved_on end, current_date);
    new.achieved_result_id := null;
  else
    -- The first wind legal result on or after the day the goal was set that meets the target.
    select r.* into v_hit
    from public.athlete_results r
    where r.athlete_id = new.athlete_id
      and r.event_group = new.event_group
      and r.is_wind_legal
      and r.result_date >= (new.created_at at time zone 'utc')::date
      and (
        (new.lower_is_better and r.compare_value <= new.target_value)
        or (not new.lower_is_better and r.compare_value >= new.target_value)
      )
    order by r.result_date, r.created_at, r.id
    limit 1;
    if found then
      new.achieved_on := v_hit.result_date;
      new.achieved_result_id := v_hit.id;
    else
      new.achieved_on := null;
      new.achieved_result_id := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists athlete_goals_normalise on public.athlete_goals;
create trigger athlete_goals_normalise
before insert or update on public.athlete_goals
for each row
execute function public.athlete_goals_normalise();

-- 3. A result changes: look at the goals of that event again --------------------------------------
-- Touching the goal row runs athlete_goals_normalise, which decides. Goals marked by hand stay.

create or replace function public.athlete_results_refresh_goals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.athlete_goals g
    set updated_at = now()
    where g.athlete_id = old.athlete_id
      and g.event_group = old.event_group
      and not g.achieved_manually;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.event_group is distinct from old.event_group) then
    update public.athlete_goals g
    set updated_at = now()
    where g.athlete_id = new.athlete_id
      and g.event_group = new.event_group
      and not g.achieved_manually;
  end if;
  return null;
end;
$$;

drop trigger if exists athlete_results_refresh_goals on public.athlete_results;
create trigger athlete_results_refresh_goals
after insert or update or delete on public.athlete_results
for each row
execute function public.athlete_results_refresh_goals();

revoke all on function public.athlete_goals_normalise() from public, anon, authenticated;
revoke all on function public.athlete_results_refresh_goals() from public, anon, authenticated;

-- 4. Access ------------------------------------------------------------------------------------
-- The athlete: their own goals. A coach: the athletes of the teams they coach. A club admin: the
-- club. current_tenant_id() is null for a deactivated member or a paused club, so they get nothing.

alter table public.athlete_goals enable row level security;

grant select, insert, update, delete on public.athlete_goals to authenticated;
grant all on public.athlete_goals to service_role;

drop policy if exists athlete_goals_select_scope on public.athlete_goals;
create policy athlete_goals_select_scope
on public.athlete_goals
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    athlete_id = (select public.current_athlete_id())
    or (select public.is_club_admin())
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

drop policy if exists athlete_goals_insert_scope on public.athlete_goals;
create policy athlete_goals_insert_scope
on public.athlete_goals
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and (
    athlete_id = (select public.current_athlete_id())
    or (select public.is_club_admin())
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

drop policy if exists athlete_goals_update_scope on public.athlete_goals;
create policy athlete_goals_update_scope
on public.athlete_goals
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    athlete_id = (select public.current_athlete_id())
    or (select public.is_club_admin())
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and (
    athlete_id = (select public.current_athlete_id())
    or (select public.is_club_admin())
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

drop policy if exists athlete_goals_delete_scope on public.athlete_goals;
create policy athlete_goals_delete_scope
on public.athlete_goals
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    athlete_id = (select public.current_athlete_id())
    or (select public.is_club_admin())
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

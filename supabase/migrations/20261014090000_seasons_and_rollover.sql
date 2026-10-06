-- SKTR Coach: more than one season per club, and the year end rollover
--
-- Before: a club had exactly one season, three columns on club_profiles (season_year,
-- season_start, season_end). Starting a new year meant overwriting them, which lost the old
-- season, and nothing helped a club admin close the year (old teams, old plans).
--
-- Now:
--   1. club_seasons: any number of seasons per club. Each has a name, a first and last day and a
--      state: upcoming, current or past. One current season per club at most. No two seasons of a
--      club share a day.
--   2. club_profiles keeps its three season columns and they always mirror the CURRENT season
--      (triggers both ways), so every existing reader and writer keeps working unchanged:
--      onboarding still writes club_profiles and that becomes the club's first season.
--   3. Season bests follow the current season of club_seasons (results_season_bounds and the
--      athlete_event_bests view). Personal bests are untouched.
--   4. Club admins change seasons only through functions (no write policy on the table):
--        save_club_season      add an upcoming season, or change the name and dates of any season
--        delete_club_season    remove an upcoming season that was added by mistake
--        start_club_season     the rollover: one transaction, nothing is deleted
--   Every member of the club can read its seasons. Other clubs and platform admins cannot.
--
-- Idempotent: safe to apply twice.

-- 1. Table ----------------------------------------------------------------------------------

create table if not exists public.club_seasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 60),
  start_date date not null,
  end_date date not null,
  status text not null default 'upcoming' check (status in ('upcoming', 'current', 'past')),
  started_at timestamptz,
  ended_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date <= end_date)
);

-- Exactly one current season per club at a time.
create unique index if not exists club_seasons_one_current_idx
on public.club_seasons (tenant_id)
where status = 'current';

create index if not exists club_seasons_tenant_dates_idx
on public.club_seasons (tenant_id, start_date);

-- No two seasons of a club share a day. Checked in a trigger (under a per club lock) rather than
-- an exclusion constraint, so the migration needs no extra extension.
create or replace function public.club_seasons_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other record;
begin
  new.name := btrim(new.name);
  new.updated_at := now();

  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'A season cannot move to another club.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT'
     or (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date) then
    perform pg_advisory_xact_lock(hashtextextended('club_seasons:' || new.tenant_id::text, 0));
    select s.name, s.start_date, s.end_date
    into v_other
    from public.club_seasons s
    where s.tenant_id = new.tenant_id
      and s.id <> new.id
      and s.start_date <= new.end_date
      and s.end_date >= new.start_date
    order by s.start_date
    limit 1;
    if found then
      raise exception 'These dates overlap the season "%" (% to %). Seasons cannot share a day.',
        v_other.name, v_other.start_date, v_other.end_date
        using errcode = '23P01', hint = 'season_overlap';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists club_seasons_guard on public.club_seasons;
create trigger club_seasons_guard
before insert or update on public.club_seasons
for each row
execute function public.club_seasons_guard();

-- 2. Mirror with club_profiles ----------------------------------------------------------------
-- Each side only writes when the values differ, so the two triggers settle after one round.

-- The current season changed: club_profiles follows.
create or replace function public.club_seasons_sync_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'current' then
    update public.club_profiles cp
    set season_year = new.name,
        season_start = new.start_date,
        season_end = new.end_date
    where cp.tenant_id = new.tenant_id
      and (cp.season_year, cp.season_start, cp.season_end) is distinct from (new.name, new.start_date, new.end_date);
  end if;
  return new;
end;
$$;

drop trigger if exists club_seasons_sync_profile on public.club_seasons;
create trigger club_seasons_sync_profile
after insert or update on public.club_seasons
for each row
execute function public.club_seasons_sync_profile();

-- club_profiles changed (onboarding, the club profile form): the current season follows, or the
-- club's first season is made.
create or replace function public.club_profiles_sync_season()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := left(coalesce(nullif(btrim(new.season_year), ''), 'Season'), 60);
  v_current_id uuid;
begin
  if new.season_start is null or new.season_end is null then
    return new;
  end if;

  select s.id into v_current_id
  from public.club_seasons s
  where s.tenant_id = new.tenant_id and s.status = 'current';

  if v_current_id is not null then
    update public.club_seasons s
    set name = v_name,
        start_date = new.season_start,
        end_date = new.season_end
    where s.id = v_current_id
      and (s.name, s.start_date, s.end_date) is distinct from (v_name, new.season_start, new.season_end);
  elsif not exists (select 1 from public.club_seasons s where s.tenant_id = new.tenant_id) then
    insert into public.club_seasons (tenant_id, name, start_date, end_date, status, started_at)
    values (new.tenant_id, v_name, new.season_start, new.season_end, 'current', now());
  end if;
  return new;
end;
$$;

drop trigger if exists club_profiles_sync_season on public.club_profiles;
create trigger club_profiles_sync_season
after insert or update of season_year, season_start, season_end on public.club_profiles
for each row
execute function public.club_profiles_sync_season();

revoke all on function public.club_seasons_guard() from public, anon, authenticated;
revoke all on function public.club_seasons_sync_profile() from public, anon, authenticated;
revoke all on function public.club_profiles_sync_season() from public, anon, authenticated;

-- 3. Backfill -----------------------------------------------------------------------------------
-- One season per existing club, from its club_profiles fields. A club that already has any season
-- is skipped, so running this again changes nothing.

insert into public.club_seasons (tenant_id, name, start_date, end_date, status, started_at)
select
  cp.tenant_id,
  left(coalesce(nullif(btrim(cp.season_year), ''), 'Season'), 60),
  cp.season_start,
  cp.season_end,
  'current',
  now()
from public.club_profiles cp
where cp.season_start is not null
  and cp.season_end is not null
  and cp.season_start <= cp.season_end
  and not exists (select 1 from public.club_seasons s where s.tenant_id = cp.tenant_id);

-- 4. Row level security ---------------------------------------------------------------------------
-- Read: every active member of the club. Write: nobody directly, only through the functions below.

alter table public.club_seasons enable row level security;

drop policy if exists club_seasons_select_members on public.club_seasons;
create policy club_seasons_select_members
on public.club_seasons
for select
to authenticated
using (tenant_id = public.current_tenant_id());

revoke all on public.club_seasons from anon, authenticated;
grant select on public.club_seasons to authenticated;
grant all on public.club_seasons to service_role;

-- 5. Season bests follow the current season ---------------------------------------------------------
-- The window season bests are counted in, for a club on a day:
--   * the club's current season, from its first day, until its last day has passed
--     (so right after a rollover season bests start again from the new season's first day);
--   * otherwise (no season, or the current season is over and no new one was started) the
--     calendar year, as before.

create or replace function public.results_season_bounds(p_tenant_id uuid, p_on date default current_date)
returns table (season_start date, season_end date)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(s.start_date, date_trunc('year', p_on)::date),
    coalesce(s.end_date, (date_trunc('year', p_on) + interval '1 year - 1 day')::date)
  from (select 1) one
  left join public.club_seasons s
    on s.tenant_id = p_tenant_id
   and s.status = 'current'
   and p_on <= s.end_date
$$;

revoke all on function public.results_season_bounds(uuid, date) from public, anon, authenticated;
grant execute on function public.results_season_bounds(uuid, date) to service_role;

-- The same view as in 20261008100000, with the season taken from club_seasons. Same columns.
create or replace view public.athlete_event_bests
with (security_invoker = true)
as
with marks as (
  select
    r.*,
    case when r.lower_is_better then r.compare_value else -r.compare_value end as rank_value,
    coalesce(cs.start_date, date_trunc('year', current_date)::date) as season_start,
    coalesce(cs.end_date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date) as season_end
  from public.athlete_results r
  left join public.club_seasons cs
    on cs.tenant_id = r.tenant_id
   and cs.status = 'current'
   and current_date <= cs.end_date
),
personal as (
  select distinct on (m.athlete_id, m.event_group) 'personal_best'::text as best_kind, m.*
  from marks m
  where m.is_wind_legal
  order by m.athlete_id, m.event_group, m.rank_value, m.result_date, m.created_at, m.id
),
season as (
  select distinct on (m.athlete_id, m.event_group) 'season_best'::text as best_kind, m.*
  from marks m
  where m.is_wind_legal
    and m.result_date between m.season_start and m.season_end
  order by m.athlete_id, m.event_group, m.rank_value, m.result_date, m.created_at, m.id
),
assisted as (
  select distinct on (m.athlete_id, m.event_group) 'wind_assisted_best'::text as best_kind, m.*
  from marks m
  where not m.is_wind_legal
  order by m.athlete_id, m.event_group, m.rank_value, m.result_date, m.created_at, m.id
),
bests as (
  select * from personal
  union all
  select * from season
  union all
  select * from assisted
)
select
  b.best_kind,
  b.id as result_id,
  b.tenant_id,
  b.athlete_id,
  b.event_key,
  b.event_label,
  b.event_group,
  b.mark_unit,
  b.lower_is_better,
  b.mark_value,
  b.compare_value,
  b.mark_display,
  b.timing,
  b.result_date,
  b.source,
  b.competition_id,
  b.wind,
  b.is_wind_legal,
  b.environment,
  b.is_altitude,
  b.location,
  b.season_start,
  b.season_end
from bests b;

revoke all on public.athlete_event_bests from anon;
grant select on public.athlete_event_bests to authenticated, service_role;

-- 6. Functions for club admins ----------------------------------------------------------------------

-- The caller's club, when the caller is an active club admin of a club that is open. Raises otherwise.
create or replace function public.season_admin_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_tenant_id := public.current_tenant_id();
  if v_tenant_id is null or not public.is_club_admin() then
    raise exception 'Only a club admin can change the club''s seasons.' using errcode = '42501';
  end if;
  return v_tenant_id;
end;
$$;

-- Add an upcoming season (p_season_id null) or change the name and dates of an existing one.
create or replace function public.save_club_season(
  p_season_id uuid,
  p_name text,
  p_start_date date,
  p_end_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.season_admin_tenant();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_name = '' then
    raise exception 'Give the season a name.' using errcode = '23514';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'Keep the season name to 60 characters or fewer.' using errcode = '23514';
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'The season must end on or after the day it starts.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.club_seasons s
    where s.tenant_id = v_tenant_id
      and lower(s.name) = lower(v_name)
      and (p_season_id is null or s.id <> p_season_id)
  ) then
    raise exception 'Another season is already called "%".', v_name using errcode = '23505';
  end if;

  if p_season_id is null then
    insert into public.club_seasons (tenant_id, name, start_date, end_date, status, created_by_user_id)
    values (v_tenant_id, v_name, p_start_date, p_end_date, 'upcoming', auth.uid())
    returning id into v_id;
    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (v_tenant_id, auth.uid(), 'club-admin', 'season_added', 'season', format('%s, %s to %s', v_name, p_start_date, p_end_date));
  else
    update public.club_seasons s
    set name = v_name, start_date = p_start_date, end_date = p_end_date
    where s.id = p_season_id and s.tenant_id = v_tenant_id
    returning s.id into v_id;
    if v_id is null then
      raise exception 'This season no longer exists.' using errcode = 'P0002';
    end if;
    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (v_tenant_id, auth.uid(), 'club-admin', 'season_changed', 'season', format('%s, %s to %s', v_name, p_start_date, p_end_date));
  end if;
  return v_id;
end;
$$;

-- Remove a season that has not started. A current or past season is never removed.
create or replace function public.delete_club_season(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.season_admin_tenant();
  v_season public.club_seasons%rowtype;
begin
  select * into v_season from public.club_seasons s where s.id = p_season_id and s.tenant_id = v_tenant_id for update;
  if not found then
    raise exception 'This season no longer exists.' using errcode = 'P0002';
  end if;
  if v_season.status <> 'upcoming' then
    raise exception 'Only a season that has not started can be removed.' using errcode = '23514';
  end if;
  delete from public.club_seasons s where s.id = v_season.id;
  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_tenant_id, auth.uid(), 'club-admin', 'season_removed', 'season', v_season.name);
end;
$$;

-- The rollover. One transaction: if any step fails nothing changes.
--   * the current season (if any) becomes past; if it would share days with the new one it ends
--     the day before the new season starts
--   * the chosen upcoming season gets the confirmed name and dates and becomes current
--   * the chosen teams are archived; their athletes stay in the club with no team, for a coach
--     or club admin to place
--   * when p_end_plans is true every published plan of the club is marked archived
--   * one audit event says what happened
-- Nothing is deleted.
create or replace function public.start_club_season(
  p_season_id uuid,
  p_name text,
  p_start_date date,
  p_end_date date,
  p_archive_team_ids uuid[] default '{}',
  p_end_plans boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.season_admin_tenant();
  v_name text := btrim(coalesce(p_name, ''));
  v_team_ids uuid[] := coalesce((select array_agg(distinct t) from unnest(p_archive_team_ids) t where t is not null), '{}');
  v_new public.club_seasons%rowtype;
  v_old public.club_seasons%rowtype;
  v_old_end date;
  v_teams int := 0;
  v_athletes int := 0;
  v_plans int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('club_seasons:' || v_tenant_id::text, 0));

  select * into v_new from public.club_seasons s where s.id = p_season_id and s.tenant_id = v_tenant_id for update;
  if not found then
    raise exception 'This season no longer exists.' using errcode = 'P0002';
  end if;
  if v_new.status <> 'upcoming' then
    raise exception 'Only a season that has not started can be started.' using errcode = '23514';
  end if;
  if v_name = '' or char_length(v_name) > 60 then
    raise exception 'Give the season a name of 60 characters or fewer.' using errcode = '23514';
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'The season must end on or after the day it starts.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.club_seasons s
    where s.tenant_id = v_tenant_id and lower(s.name) = lower(v_name) and s.id <> v_new.id
  ) then
    raise exception 'Another season is already called "%".', v_name using errcode = '23505';
  end if;

  if (
    select count(*) from public.teams t
    where t.id = any (v_team_ids) and t.tenant_id = v_tenant_id and t.status <> 'archived' and not t.is_archived
  ) <> coalesce(array_length(v_team_ids, 1), 0) then
    raise exception 'One of the teams to archive is not a team of this club, or is already archived. Reload and try again.'
      using errcode = '23514';
  end if;

  select * into v_old from public.club_seasons s where s.tenant_id = v_tenant_id and s.status = 'current' for update;
  if found then
    v_old_end := v_old.end_date;
    if v_old.end_date >= p_start_date then
      if v_old.start_date >= p_start_date then
        raise exception 'The new season has to start after the first day of "%" (%).', v_old.name, v_old.start_date
          using errcode = '23514';
      end if;
      v_old_end := p_start_date - 1;
    end if;
    update public.club_seasons s
    set status = 'past', end_date = v_old_end, ended_at = now()
    where s.id = v_old.id;
  end if;

  update public.club_seasons s
  set name = v_name, start_date = p_start_date, end_date = p_end_date, status = 'current', started_at = now()
  where s.id = v_new.id;

  if coalesce(array_length(v_team_ids, 1), 0) > 0 then
    update public.teams t
    set status = 'archived', is_archived = true, archived_at = now()
    where t.id = any (v_team_ids) and t.tenant_id = v_tenant_id;
    get diagnostics v_teams = row_count;

    update public.athletes a
    set team_id = null
    where a.team_id = any (v_team_ids) and a.tenant_id = v_tenant_id;
    get diagnostics v_athletes = row_count;
  end if;

  if coalesce(p_end_plans, false) then
    update public.training_plans p
    set status = 'archived'
    where p.tenant_id = v_tenant_id and p.status = 'published';
    get diagnostics v_plans = row_count;
  end if;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    v_tenant_id, auth.uid(), 'club-admin', 'season_started', 'season',
    format(
      '%s (%s to %s) started.%s Teams archived: %s. Athletes left without a team: %s. Plans ended: %s.',
      v_name, p_start_date, p_end_date,
      case when v_old.id is not null then format(' %s ended on %s.', v_old.name, v_old_end) else '' end,
      v_teams, v_athletes, v_plans
    )
  );

  return jsonb_build_object(
    'season_id', v_new.id,
    'previous_season_id', v_old.id,
    'previous_season_end', v_old_end,
    'teams_archived', v_teams,
    'athletes_unassigned', v_athletes,
    'plans_ended', v_plans
  );
end;
$$;

revoke all on function public.season_admin_tenant() from public, anon, authenticated;
revoke all on function public.save_club_season(uuid, text, date, date) from public, anon;
revoke all on function public.delete_club_season(uuid) from public, anon;
revoke all on function public.start_club_season(uuid, text, date, date, uuid[], boolean) from public, anon;

grant execute on function public.season_admin_tenant() to service_role;
grant execute on function public.save_club_season(uuid, text, date, date) to authenticated, service_role;
grant execute on function public.delete_club_season(uuid) to authenticated, service_role;
grant execute on function public.start_club_season(uuid, text, date, date, uuid[], boolean) to authenticated, service_role;

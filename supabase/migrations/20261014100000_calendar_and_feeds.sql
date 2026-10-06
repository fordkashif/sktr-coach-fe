-- Calendar: club events and private calendar feed links
-- Created: 2026-10-14
--
-- 1. club_events, club_event_teams: simple dated events of a club (a parents' meeting, a camp, a
--    closure). For the whole club or for chosen teams. Club admins manage every event of their
--    club; a coach manages events that are for teams they coach only. Athletes read the events of
--    the whole club and of their own team. Writes go through save_club_event / delete_club_event.
-- 2. calendar_feeds: one private subscription link per person. Only a SHA-256 hash of the link's
--    token is stored. turn_on_calendar_feed() hands the token back once; calling it again makes a
--    new one and the old one stops working. calendar_feed_payload(hash) is what the calendar-feed
--    server function reads; it is not callable by signed-in people or by anyone signed out.
--
-- Safe to run twice.

-- 1. Club events ------------------------------------------------------------------------------

create table if not exists public.club_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  starts_on date not null,
  -- Last day of the event (inclusive). Same as starts_on for a one day event.
  ends_on date not null,
  -- Clock times in the club's time zone (club_profiles.timezone). Null means all day.
  start_time time,
  end_time time,
  place text check (place is null or char_length(place) <= 160),
  note text check (note is null or char_length(note) <= 1000),
  -- 'club': everyone in the club. 'teams': the teams listed in club_event_teams.
  audience text not null default 'club' check (audience in ('club', 'teams')),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_events_range check (starts_on <= ends_on and ends_on <= starts_on + 60),
  constraint club_events_times check (
    end_time is null
    or (start_time is not null and (ends_on > starts_on or end_time > start_time))
  )
);

comment on table public.club_events is
  'Dated club events shown on the calendars (meeting, camp, closure). Never holds health or availability details.';

create index if not exists club_events_tenant_start_idx on public.club_events (tenant_id, starts_on);

create table if not exists public.club_event_teams (
  event_id uuid not null references public.club_events(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  primary key (event_id, team_id)
);

create index if not exists club_event_teams_team_idx on public.club_event_teams (team_id);

drop trigger if exists set_updated_at_club_events on public.club_events;
create trigger set_updated_at_club_events
before update on public.club_events
for each row
execute function public.set_updated_at();

-- The events the caller may see. One place for the rule, used by both row policies, so the
-- policies never query each other.
create or replace function public.current_club_event_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(e.id), '{}'::uuid[])
  from public.club_events e
  where e.tenant_id = public.current_tenant_id()
    and (
      public.is_club_admin()
      or e.audience = 'club'
      or exists (
        select 1
        from public.club_event_teams t
        where t.event_id = e.id
          and (
            t.team_id = any (public.current_coach_team_ids())
            or t.team_id = public.current_athlete_team_id()
          )
      )
    )
$$;

revoke all on function public.current_club_event_ids() from public, anon;
grant execute on function public.current_club_event_ids() to authenticated, service_role;

alter table public.club_events enable row level security;
alter table public.club_event_teams enable row level security;

drop policy if exists club_events_select_visible on public.club_events;
create policy club_events_select_visible
on public.club_events
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and id = any ((select public.current_club_event_ids())::uuid[])
);

drop policy if exists club_event_teams_select_visible on public.club_event_teams;
create policy club_event_teams_select_visible
on public.club_event_teams
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and event_id = any ((select public.current_club_event_ids())::uuid[])
);

-- Nobody writes the tables directly: no insert, update or delete policy, and select only grants.
revoke all on table public.club_events from anon, authenticated;
revoke all on table public.club_event_teams from anon, authenticated;
grant select on table public.club_events to authenticated;
grant select on table public.club_event_teams to authenticated;
grant all on table public.club_events to service_role;
grant all on table public.club_event_teams to service_role;

-- True when the caller may change this event: a club admin of its club, or a coach when the event
-- is for teams only and every one of those teams is a team they coach.
create or replace function public.can_manage_club_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_events e
    where e.id = p_event_id
      and e.tenant_id = public.current_tenant_id()
      and (
        public.is_club_admin()
        or (
          public.current_app_role() = 'coach'
          and e.audience = 'teams'
          and exists (select 1 from public.club_event_teams t where t.event_id = e.id)
          and not exists (
            select 1
            from public.club_event_teams t
            where t.event_id = e.id
              and not (t.team_id = any (public.current_coach_team_ids()))
          )
        )
      )
  )
$$;

revoke all on function public.can_manage_club_event(uuid) from public, anon;
grant execute on function public.can_manage_club_event(uuid) to authenticated, service_role;

-- Adds an event (p_id null) or changes one. Returns its id.
create or replace function public.save_club_event(
  p_id uuid,
  p_title text,
  p_starts_on date,
  p_ends_on date,
  p_start_time time,
  p_end_time time,
  p_place text,
  p_note text,
  p_audience text,
  p_team_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_role text;
  v_is_admin boolean;
  v_team_ids uuid[];
  v_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_ends_on date := coalesce(p_ends_on, p_starts_on);
  v_audience text := coalesce(p_audience, 'club');
begin
  perform public.assert_caller_active();

  v_tenant_id := public.current_tenant_id();
  v_role := public.current_app_role();
  if auth.uid() is null or v_tenant_id is null or v_role is null or v_role not in ('coach', 'club-admin') then
    raise exception 'Only a coach or a club admin can add club events.' using errcode = '42501';
  end if;
  v_is_admin := v_role = 'club-admin';

  if v_title = '' or char_length(v_title) > 120 then
    raise exception 'Give the event a title of up to 120 characters.' using errcode = '22023';
  end if;
  if p_starts_on is null or v_ends_on < p_starts_on or v_ends_on > p_starts_on + 60 then
    raise exception 'The event must end on or after the day it starts, within 60 days.' using errcode = '22023';
  end if;
  if p_end_time is not null and (p_start_time is null or (v_ends_on = p_starts_on and p_end_time <= p_start_time)) then
    raise exception 'The end time must be after the start time.' using errcode = '22023';
  end if;
  if v_audience not in ('club', 'teams') then
    raise exception 'Choose the whole club or chosen teams.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct t.id), '{}'::uuid[])
  into v_team_ids
  from public.teams t
  where t.tenant_id = v_tenant_id
    and t.id = any (coalesce(p_team_ids, '{}'::uuid[]));

  if v_audience = 'club' then
    v_team_ids := '{}'::uuid[];
  else
    if coalesce(array_length(v_team_ids, 1), 0) = 0
       or coalesce(array_length(v_team_ids, 1), 0) <> (select count(distinct x) from unnest(coalesce(p_team_ids, '{}'::uuid[])) as x) then
      raise exception 'Choose at least one team of your club.' using errcode = '22023';
    end if;
  end if;

  if not v_is_admin then
    if v_audience <> 'teams' or not (v_team_ids <@ public.current_coach_team_ids()) then
      raise exception 'Coaches can add events for the teams they coach only.' using errcode = '42501';
    end if;
  end if;

  if p_id is null then
    insert into public.club_events (tenant_id, title, starts_on, ends_on, start_time, end_time, place, note, audience, created_by_user_id, created_by_role)
    values (v_tenant_id, v_title, p_starts_on, v_ends_on, p_start_time, p_end_time, nullif(btrim(coalesce(p_place, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), v_audience, auth.uid(), v_role)
    returning id into v_id;
  else
    if not public.can_manage_club_event(p_id) then
      raise exception 'You cannot change this event.' using errcode = '42501';
    end if;
    update public.club_events
    set title = v_title,
        starts_on = p_starts_on,
        ends_on = v_ends_on,
        start_time = p_start_time,
        end_time = p_end_time,
        place = nullif(btrim(coalesce(p_place, '')), ''),
        note = nullif(btrim(coalesce(p_note, '')), ''),
        audience = v_audience
    where id = p_id and tenant_id = v_tenant_id
    returning id into v_id;
    delete from public.club_event_teams where event_id = v_id;
  end if;

  insert into public.club_event_teams (event_id, team_id, tenant_id)
  select v_id, x, v_tenant_id from unnest(v_team_ids) as x;

  return v_id;
end;
$$;

create or replace function public.delete_club_event(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_caller_active();
  if auth.uid() is null or public.current_tenant_id() is null or not public.can_manage_club_event(p_id) then
    raise exception 'You cannot delete this event.' using errcode = '42501';
  end if;
  delete from public.club_events where id = p_id and tenant_id = public.current_tenant_id();
  return found;
end;
$$;

revoke all on function public.save_club_event(uuid, text, date, date, time, time, text, text, text, uuid[]) from public, anon;
grant execute on function public.save_club_event(uuid, text, date, date, time, time, text, text, text, uuid[]) to authenticated, service_role;
revoke all on function public.delete_club_event(uuid) from public, anon;
grant execute on function public.delete_club_event(uuid) to authenticated, service_role;

-- 2. Calendar feed links ----------------------------------------------------------------------

create table if not exists public.calendar_feeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- SHA-256 of the token, lower case hex. The token itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

comment on table public.calendar_feeds is
  'One private calendar subscription link per person. Holds a hash of the link token only. Read and written through functions; no client reads the table.';

alter table public.calendar_feeds enable row level security;

-- No policy and no grant: signed-in people use the three functions below, the feed uses
-- calendar_feed_payload through the service role.
revoke all on table public.calendar_feeds from anon, authenticated;
grant all on table public.calendar_feeds to service_role;

create or replace function public.get_calendar_feed_status()
returns table (is_on boolean, turned_on_at timestamptz, link_made_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_caller_active();
  if auth.uid() is null or public.current_tenant_id() is null then
    return query select false, null::timestamptz, null::timestamptz;
    return;
  end if;
  return query
  select true, f.created_at, f.rotated_at
  from public.calendar_feeds f
  where f.user_id = auth.uid()
    and f.tenant_id = public.current_tenant_id();
  if not found then
    return query select false, null::timestamptz, null::timestamptz;
  end if;
end;
$$;

-- Turns the caller's feed on, or makes a new link when it is already on (the old link stops
-- working at once). Returns the token: 64 hex characters, 244 random bits. It is shown once.
create or replace function public.turn_on_calendar_feed()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_token text;
begin
  perform public.assert_caller_active();
  v_tenant_id := public.current_tenant_id();
  if auth.uid() is null or v_tenant_id is null then
    raise exception 'Sign in to turn on a calendar link.' using errcode = '42501';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.calendar_feeds (user_id, tenant_id, token_hash)
  values (auth.uid(), v_tenant_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  on conflict (user_id) do update
    set token_hash = excluded.token_hash,
        tenant_id = excluded.tenant_id,
        rotated_at = now();

  return v_token;
end;
$$;

create or replace function public.turn_off_calendar_feed()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  -- Turning a link off is always allowed, also for someone whose access is paused.
  delete from public.calendar_feeds where user_id = auth.uid();
  return found;
end;
$$;

revoke all on function public.get_calendar_feed_status() from public, anon;
grant execute on function public.get_calendar_feed_status() to authenticated, service_role;
revoke all on function public.turn_on_calendar_feed() from public, anon;
grant execute on function public.turn_on_calendar_feed() to authenticated, service_role;
revoke all on function public.turn_off_calendar_feed() from public, anon;
grant execute on function public.turn_off_calendar_feed() to authenticated, service_role;

-- What the feed of the person holding this token shows, or null when there is nothing to serve:
-- unknown token, deactivated member, athlete without an active athlete record, paused or ended club.
-- It contains titles, dates, times and places only. It never contains availability, wellness, pain
-- reports, results, notes about an athlete or (for staff) athlete names.
create or replace function public.calendar_feed_payload(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_tenant_id uuid;
  v_role text;
  v_athlete_id uuid;
  v_athlete_team_id uuid;
  v_team_ids uuid[] := '{}'::uuid[];
  v_from date := current_date - 30;
  v_to date := current_date + 365;
  v_items jsonb;
  v_club_name text;
  v_timezone text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select f.user_id, f.tenant_id into v_user_id, v_tenant_id
  from public.calendar_feeds f
  where f.token_hash = p_token_hash;
  if not found then
    return null;
  end if;

  select p.role into v_role
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.user_id = v_user_id
    and p.tenant_id = v_tenant_id
    and p.is_active
    and t.is_active;
  if not found or public.tenant_access_blocked(v_tenant_id) then
    return null;
  end if;

  select cp.club_name, cp.timezone into v_club_name, v_timezone
  from public.club_profiles cp
  where cp.tenant_id = v_tenant_id;

  if v_role = 'athlete' then
    select a.id, a.team_id into v_athlete_id, v_athlete_team_id
    from public.athletes a
    where a.user_id = v_user_id and a.tenant_id = v_tenant_id and a.is_active;
    if not found then
      return null;
    end if;

    select coalesce(jsonb_agg(x.item order by x.starts_on, x.kind, x.title), '[]'::jsonb) into v_items
    from (
      select 'session' as kind, s.scheduled_for as starts_on, s.title,
        jsonb_build_object('kind', 'session', 'id', s.id, 'title', s.title, 'starts_on', s.scheduled_for, 'ends_on', s.scheduled_for, 'updated_at', s.updated_at) as item
      from public.sessions s
      where s.tenant_id = v_tenant_id
        and s.athlete_id = v_athlete_id
        and s.status <> 'skipped'
        and s.scheduled_for between v_from and v_to
      union all
      select 'test_week', tw.start_date, tw.name,
        jsonb_build_object('kind', 'test_week', 'id', tw.id, 'title', tw.name, 'starts_on', tw.start_date, 'ends_on', tw.end_date, 'updated_at', tw.updated_at)
      from public.test_weeks tw
      where tw.tenant_id = v_tenant_id
        and v_athlete_team_id is not null
        and tw.team_id = v_athlete_team_id
        and tw.status in ('published', 'closed')
        and not tw.is_archived
        and tw.end_date >= v_from and tw.start_date <= v_to
      union all
      select 'competition', c.start_date, c.name,
        jsonb_build_object('kind', 'competition', 'id', c.id, 'title', c.name, 'starts_on', c.start_date, 'ends_on', c.end_date,
          'place', nullif(concat_ws(', ', nullif(btrim(c.venue), ''), nullif(btrim(c.location), '')), ''), 'updated_at', c.updated_at)
      from public.competitions c
      where c.tenant_id = v_tenant_id
        and c.end_date >= v_from and c.start_date <= v_to
        and (
          c.owner_athlete_id = v_athlete_id
          or exists (
            select 1 from public.competition_entries ce
            where ce.competition_id = c.id and ce.athlete_id = v_athlete_id and ce.status = 'entered'
          )
        )
      union all
      select 'event', e.starts_on, e.title,
        jsonb_build_object('kind', 'event', 'id', e.id, 'title', e.title, 'starts_on', e.starts_on, 'ends_on', e.ends_on,
          'start_time', to_char(e.start_time, 'HH24:MI'), 'end_time', to_char(e.end_time, 'HH24:MI'), 'place', e.place, 'note', e.note, 'updated_at', e.updated_at)
      from public.club_events e
      where e.tenant_id = v_tenant_id
        and e.ends_on >= v_from and e.starts_on <= v_to
        and (
          e.audience = 'club'
          or exists (select 1 from public.club_event_teams t where t.event_id = e.id and t.team_id = v_athlete_team_id)
        )
    ) x;
  else
    if v_role = 'club-admin' then
      select coalesce(array_agg(t.id), '{}'::uuid[]) into v_team_ids
      from public.teams t
      where t.tenant_id = v_tenant_id;
    else
      select coalesce(array_agg(tc.team_id), '{}'::uuid[]) into v_team_ids
      from public.team_coaches tc
      join public.teams t on t.id = tc.team_id and t.tenant_id = tc.tenant_id
      where tc.user_id = v_user_id and tc.tenant_id = v_tenant_id;
    end if;

    select coalesce(jsonb_agg(x.item order by x.starts_on, x.kind, x.title), '[]'::jsonb) into v_items
    from (
      -- One line per team, day and session title. Coaches only: a club admin's calendar counts sessions.
      select 'session' as kind, d.date as starts_on, d.title,
        jsonb_build_object('kind', 'session', 'id', md5(tp.team_id::text || ':' || d.date::text || ':' || d.title), 'title', d.title,
          'starts_on', d.date, 'ends_on', d.date, 'team', max(tm.name), 'updated_at', max(tp.updated_at)) as item
      from public.training_plans tp
      join public.training_plan_weeks w on w.plan_id = tp.id
      join public.training_plan_days d on d.plan_week_id = w.id
      join public.teams tm on tm.id = tp.team_id
      where v_role = 'coach'
        and tp.tenant_id = v_tenant_id
        and tp.status = 'published'
        and tp.team_id = any (v_team_ids)
        and d.is_training_day
        and d.date between v_from and v_to
      group by tp.team_id, d.date, d.title
      union all
      select 'test_week', tw.start_date, tw.name,
        jsonb_build_object('kind', 'test_week', 'id', tw.id, 'title', tw.name, 'starts_on', tw.start_date, 'ends_on', tw.end_date, 'team', tm.name, 'updated_at', tw.updated_at)
      from public.test_weeks tw
      join public.teams tm on tm.id = tw.team_id
      where tw.tenant_id = v_tenant_id
        and tw.team_id = any (v_team_ids)
        and tw.status in ('published', 'closed')
        and not tw.is_archived
        and tw.end_date >= v_from and tw.start_date <= v_to
      union all
      select 'competition', c.start_date, c.name,
        jsonb_build_object('kind', 'competition', 'id', c.id, 'title', c.name, 'starts_on', c.start_date, 'ends_on', c.end_date,
          'place', nullif(concat_ws(', ', nullif(btrim(c.venue), ''), nullif(btrim(c.location), '')), ''),
          'team', (select tm.name from public.teams tm where tm.id = c.team_id),
          'entered_count', (
            select count(distinct ce.athlete_id)
            from public.competition_entries ce
            join public.athletes a on a.id = ce.athlete_id
            where ce.competition_id = c.id and ce.status = 'entered' and a.team_id = any (v_team_ids)
          ),
          'updated_at', c.updated_at)
      from public.competitions c
      where c.tenant_id = v_tenant_id
        and c.end_date >= v_from and c.start_date <= v_to
        and (c.scope = 'club' or (c.scope = 'team' and c.team_id = any (v_team_ids)))
      union all
      select 'event', e.starts_on, e.title,
        jsonb_build_object('kind', 'event', 'id', e.id, 'title', e.title, 'starts_on', e.starts_on, 'ends_on', e.ends_on,
          'start_time', to_char(e.start_time, 'HH24:MI'), 'end_time', to_char(e.end_time, 'HH24:MI'), 'place', e.place, 'note', e.note, 'updated_at', e.updated_at)
      from public.club_events e
      where e.tenant_id = v_tenant_id
        and e.ends_on >= v_from and e.starts_on <= v_to
        and (
          v_role = 'club-admin'
          or e.audience = 'club'
          or exists (select 1 from public.club_event_teams t where t.event_id = e.id and t.team_id = any (v_team_ids))
        )
    ) x;
  end if;

  return jsonb_build_object(
    'role', v_role,
    'club_name', coalesce(v_club_name, ''),
    'timezone', coalesce(v_timezone, 'America/Jamaica'),
    'items', v_items
  );
end;
$$;

revoke all on function public.calendar_feed_payload(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_payload(text) to service_role;

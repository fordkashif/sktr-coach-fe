-- SKTR Coach: results history, personal and season bests, competitions
-- Created: 2026-10-08
--
-- BEFORE THIS FILE
--   * pr_records held ONE row per athlete and event: the current best as free text ("4.05s").
--     There was no history, no season best, and the only writer was the athlete's browser after a
--     test week submission (it compared text and upserted the row itself).
--   * There was nowhere to keep a competition, an entry or a competition result.
--
-- WHAT THIS FILE DOES
--   1. result_events: the controlled event list. The kind of an event decides the unit and the
--      direction: timed events in seconds (lower is better, hand or electronic timing), field
--      events in metres (higher is better), combined events in points, gym lifts in kilograms,
--      and 'other' for anything a coach names in a test week ("Flying 30m", "CMJ").
--   2. competitions and competition_entries: a season calendar of meets and who is entered in what.
--   3. athlete_results: EVERY mark an athlete has, from test weeks, competitions, training and
--      manual entry. The mark is stored as a number in a canonical unit plus its display text,
--      with the wind reading (100m, 200m, sprint hurdles, long jump, triple jump), whether the
--      mark is wind legal (wind over +2.0 is not), indoor or outdoor, an altitude flag, where it
--      was set and who entered it.
--   4. Personal best and season best are DERIVED from that history, with the right direction per
--      event and from wind legal marks only (athlete_event_best(), view athlete_event_bests).
--      The season is the club's season from club_profiles when today falls inside it, otherwise
--      the calendar year (results_season_bounds()).
--   5. pr_records stays, as a maintained projection of "the current best per event". A trigger on
--      athlete_results rewrites the one pr_records row of an athlete and event whenever that
--      athlete's history for the event changes, so every existing reader of pr_records (coach
--      dashboard, athlete detail, club reports) keeps working without a change. Athletes no
--      longer write pr_records themselves: the two policies that let them are dropped.
--   6. test_results feed the history through a trigger, so a test week submission (by the athlete
--      or by a coach) updates bests without the browser doing anything.
--   7. Notifications, queued through enqueue_notification() from 20261007090000:
--        athlete_new_best          coaches of the athlete's team, in-app only, when a new result
--                                  beats an earlier personal or season best.
--        competition_entry_added   the athlete, in-app and email, when someone else enters them.
--   8. Backfill, once: existing test_results are copied into the history as 'test_week', and any
--      pr_records best that the history does not already contain is copied as 'imported'.
--
-- WHO CAN DO WHAT (details in SUPABASE_RLS_POLICY_MATRIX.md)
--   athlete      reads own results; adds manual, training and competition results for themselves;
--                changes or deletes the ones they entered. Sees competitions of their team, club
--                wide ones, ones they created and ones they are entered in. May add a competition
--                for themselves and enter themselves.
--   coach        the same for the athletes of the teams they are assigned to; creates competitions
--                for those teams and enters those athletes.
--   club admin   everything inside the club.
--   Everyone else, a deactivated member and anyone in a suspended or cancelled club: nothing. Every
--   policy goes through the helpers of 20261005180000, 20261006120000 and 20261006150000, which
--   answer null or empty for them.
--
-- Idempotent and additive: create ... if not exists, create or replace, drop policy/trigger if
-- exists + create, insert ... on conflict, guarded inserts. No table or column is dropped.
-- pr_records keeps every row; two athlete write policies on it are dropped (see 5).

-- 1. Event list ---------------------------------------------------------------------------

create table if not exists public.result_events (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  name text not null,
  category text not null,
  kind text not null check (kind in ('time', 'distance', 'points', 'weight', 'other')),
  unit text check (unit in ('s', 'm', 'pts', 'kg')),
  lower_is_better boolean,
  wind_applies boolean not null default false,
  hand_time_adjust numeric(3, 2) not null default 0,
  aliases text[] not null default '{}',
  sort_order int not null,
  check ((kind = 'other') = (unit is null)),
  check ((kind = 'other') = (lower_is_better is null))
);

comment on table public.result_events is
  'Controlled list of events. Keep in step with RESULT_EVENTS in src/lib/data/pr/marks.ts.';
comment on column public.result_events.wind_applies is
  'A wind reading is taken for this event outdoors (100m, 200m, 100m and 110m hurdles, long jump, triple jump).';
comment on column public.result_events.hand_time_adjust is
  'Seconds added to a hand time before it is compared with electronic times (0.24 up to 300m, 0.14 for 400m events).';

insert into public.result_events (key, name, category, kind, unit, lower_is_better, wind_applies, hand_time_adjust, aliases, sort_order)
values
  ('60m', '60m', 'Sprints', 'time', 's', true, false, 0.24, '{}', 10),
  ('100m', '100m', 'Sprints', 'time', 's', true, true, 0.24, '{}', 20),
  ('150m', '150m', 'Sprints', 'time', 's', true, false, 0.24, '{}', 30),
  ('200m', '200m', 'Sprints', 'time', 's', true, true, 0.24, '{}', 40),
  ('300m', '300m', 'Sprints', 'time', 's', true, false, 0.24, '{}', 50),
  ('400m', '400m', 'Sprints', 'time', 's', true, false, 0.14, '{}', 60),
  ('60m_hurdles', '60m hurdles', 'Hurdles', 'time', 's', true, false, 0.24, '{60mh}', 110),
  ('100m_hurdles', '100m hurdles', 'Hurdles', 'time', 's', true, true, 0.24, '{100mh}', 120),
  ('110m_hurdles', '110m hurdles', 'Hurdles', 'time', 's', true, true, 0.24, '{110mh}', 130),
  ('300m_hurdles', '300m hurdles', 'Hurdles', 'time', 's', true, false, 0.24, '{300mh}', 140),
  ('400m_hurdles', '400m hurdles', 'Hurdles', 'time', 's', true, false, 0.14, '{400mh}', 150),
  ('600m', '600m', 'Middle distance', 'time', 's', true, false, 0, '{}', 210),
  ('800m', '800m', 'Middle distance', 'time', 's', true, false, 0, '{}', 220),
  ('1000m', '1000m', 'Middle distance', 'time', 's', true, false, 0, '{}', 230),
  ('1500m', '1500m', 'Middle distance', 'time', 's', true, false, 0, '{}', 240),
  ('mile', 'Mile', 'Middle distance', 'time', 's', true, false, 0, '{1mile}', 250),
  ('3000m', '3000m', 'Distance', 'time', 's', true, false, 0, '{}', 310),
  ('2000m_steeplechase', '2000m steeplechase', 'Distance', 'time', 's', true, false, 0, '{2000msc}', 320),
  ('3000m_steeplechase', '3000m steeplechase', 'Distance', 'time', 's', true, false, 0, '{3000msc}', 330),
  ('5000m', '5000m', 'Distance', 'time', 's', true, false, 0, '{}', 340),
  ('10000m', '10000m', 'Distance', 'time', 's', true, false, 0, '{"10,000m"}', 350),
  ('5k_road', '5K road', 'Distance', 'time', 's', true, false, 0, '{5k}', 360),
  ('10k_road', '10K road', 'Distance', 'time', 's', true, false, 0, '{10k}', 370),
  ('half_marathon', 'Half marathon', 'Distance', 'time', 's', true, false, 0, '{}', 380),
  ('marathon', 'Marathon', 'Distance', 'time', 's', true, false, 0, '{}', 390),
  ('5000m_walk', '5000m walk', 'Walks', 'time', 's', true, false, 0, '{}', 410),
  ('10km_walk', '10km walk', 'Walks', 'time', 's', true, false, 0, '{}', 420),
  ('20km_walk', '20km walk', 'Walks', 'time', 's', true, false, 0, '{}', 430),
  ('4x100m', '4x100m relay', 'Relays', 'time', 's', true, false, 0.24, '{4x100m,4x100}', 510),
  ('4x200m', '4x200m relay', 'Relays', 'time', 's', true, false, 0.24, '{4x200m,4x200}', 520),
  ('4x400m', '4x400m relay', 'Relays', 'time', 's', true, false, 0.14, '{4x400m,4x400}', 530),
  ('high_jump', 'High jump', 'Jumps', 'distance', 'm', false, false, 0, '{hj}', 610),
  ('pole_vault', 'Pole vault', 'Jumps', 'distance', 'm', false, false, 0, '{pv}', 620),
  ('long_jump', 'Long jump', 'Jumps', 'distance', 'm', false, true, 0, '{lj}', 630),
  ('triple_jump', 'Triple jump', 'Jumps', 'distance', 'm', false, true, 0, '{tj}', 640),
  ('shot_put', 'Shot put', 'Throws', 'distance', 'm', false, false, 0, '{shot,sp}', 710),
  ('discus', 'Discus', 'Throws', 'distance', 'm', false, false, 0, '{discusthrow}', 720),
  ('hammer', 'Hammer', 'Throws', 'distance', 'm', false, false, 0, '{hammerthrow}', 730),
  ('javelin', 'Javelin', 'Throws', 'distance', 'm', false, false, 0, '{javelinthrow}', 740),
  ('pentathlon', 'Pentathlon', 'Combined events', 'points', 'pts', false, false, 0, '{}', 810),
  ('heptathlon', 'Heptathlon', 'Combined events', 'points', 'pts', false, false, 0, '{}', 820),
  ('decathlon', 'Decathlon', 'Combined events', 'points', 'pts', false, false, 0, '{}', 830),
  ('back_squat', 'Back squat', 'Strength', 'weight', 'kg', false, false, 0, '{squat}', 910),
  ('front_squat', 'Front squat', 'Strength', 'weight', 'kg', false, false, 0, '{}', 920),
  ('bench_press', 'Bench press', 'Strength', 'weight', 'kg', false, false, 0, '{bench}', 930),
  ('deadlift', 'Deadlift', 'Strength', 'weight', 'kg', false, false, 0, '{}', 940),
  ('power_clean', 'Power clean', 'Strength', 'weight', 'kg', false, false, 0, '{}', 950),
  ('clean_and_jerk', 'Clean and jerk', 'Strength', 'weight', 'kg', false, false, 0, '{}', 960),
  ('snatch', 'Snatch', 'Strength', 'weight', 'kg', false, false, 0, '{}', 970),
  ('hip_thrust', 'Hip thrust', 'Strength', 'weight', 'kg', false, false, 0, '{}', 980),
  ('other', 'Other', 'Other', 'other', null, null, false, 0, '{}', 9999)
on conflict (key) do update
set name = excluded.name,
    category = excluded.category,
    kind = excluded.kind,
    unit = excluded.unit,
    lower_is_better = excluded.lower_is_better,
    wind_applies = excluded.wind_applies,
    hand_time_adjust = excluded.hand_time_adjust,
    aliases = excluded.aliases,
    sort_order = excluded.sort_order;

alter table public.result_events enable row level security;

drop policy if exists result_events_select_all on public.result_events;
create policy result_events_select_all
on public.result_events
for select
to authenticated
using (true);

revoke all on public.result_events from anon;
grant select on public.result_events to authenticated, service_role;

-- 2. Competitions and entries -------------------------------------------------------------

create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- 'team': one team's meet. 'club': the whole club. 'athlete': a meet an athlete added for themselves.
  scope text not null check (scope in ('team', 'club', 'athlete')),
  team_id uuid references public.teams(id) on delete set null,
  owner_athlete_id uuid references public.athletes(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  start_date date not null,
  end_date date not null,
  venue text check (venue is null or char_length(venue) <= 160),
  location text check (location is null or char_length(location) <= 160),
  level text check (level is null or level in ('development', 'school', 'club', 'open', 'regional', 'national', 'international')),
  environment text not null default 'outdoor' check (environment in ('outdoor', 'indoor')),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date <= end_date),
  check (end_date <= start_date + 30),
  check ((scope = 'athlete') = (owner_athlete_id is not null)),
  check (scope = 'team' or team_id is null)
);

comment on column public.competitions.scope is
  'team: visible to that team and its coaches. club: visible to the whole club. athlete: added by an athlete for themselves, visible to them and their coaches.';

create index if not exists competitions_tenant_start_idx on public.competitions (tenant_id, start_date desc);
create index if not exists competitions_team_idx on public.competitions (team_id);
create index if not exists competitions_owner_athlete_idx on public.competitions (owner_athlete_id);

create table if not exists public.competition_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  event_key text not null references public.result_events(key),
  event_label text not null check (char_length(event_label) between 1 and 80),
  event_group text not null,
  -- Heat, lane, flight, call time: whatever the athlete needs on the day.
  notes text check (notes is null or char_length(notes) <= 500),
  status text not null default 'entered' check (status in ('entered', 'scratched')),
  entered_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competition_id, athlete_id, event_group)
);

create index if not exists competition_entries_athlete_idx on public.competition_entries (athlete_id);
create index if not exists competition_entries_tenant_idx on public.competition_entries (tenant_id);

-- 3. Results history ----------------------------------------------------------------------

create table if not exists public.athlete_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  event_key text not null references public.result_events(key),
  -- The event's name. For 'other' this is the free text ("Flying 30m").
  event_label text not null check (char_length(event_label) between 1 and 80),
  -- What bests are grouped by: 'k:<event key>' or 'o:<lower case label>'. Set by trigger.
  event_group text not null,
  mark_unit text not null check (mark_unit in ('s', 'm', 'cm', 'kg', 'pts')),
  lower_is_better boolean not null,
  -- The mark in the canonical unit of the event (seconds, metres, points, kilograms).
  mark_value numeric(12, 3) not null check (mark_value > 0 and mark_value < 1000000),
  -- What marks are ranked by: mark_value, plus the hand timing adjustment for a hand time.
  compare_value numeric(12, 3) not null,
  -- The mark the way it is written: "10.84", "10.6h", "1:52.30", "7.42". No unit.
  mark_display text not null,
  timing text check (timing in ('electronic', 'hand')),
  result_date date not null,
  source text not null check (source in ('competition', 'test_week', 'training', 'manual', 'imported')),
  competition_id uuid references public.competitions(id) on delete set null,
  competition_entry_id uuid references public.competition_entries(id) on delete set null,
  test_result_id uuid references public.test_results(id) on delete cascade,
  legacy_pr_record_id uuid references public.pr_records(id) on delete set null,
  place int check (place is null or place between 1 and 999),
  -- Metres per second, one decimal. Only kept for events where wind applies, outdoors.
  wind numeric(3, 1) check (wind is null or wind between -9.9 and 9.9),
  -- False when the wind reading is over +2.0 (or an imported mark was flagged as not legal).
  is_wind_legal boolean not null default true,
  environment text not null default 'outdoor' check (environment in ('outdoor', 'indoor')),
  is_altitude boolean not null default false,
  location text check (location is null or char_length(location) <= 160),
  notes text check (notes is null or char_length(notes) <= 1000),
  entered_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists athlete_results_athlete_event_idx
on public.athlete_results (athlete_id, event_group, result_date desc);

create index if not exists athlete_results_tenant_athlete_date_idx
on public.athlete_results (tenant_id, athlete_id, result_date desc);

create index if not exists athlete_results_competition_idx
on public.athlete_results (competition_id);

-- One result per competition entry, one history row per test result, one per imported record.
create unique index if not exists athlete_results_entry_uniq
on public.athlete_results (competition_entry_id)
where competition_entry_id is not null;

create unique index if not exists athlete_results_test_result_uniq
on public.athlete_results (test_result_id)
where test_result_id is not null;

create unique index if not exists athlete_results_legacy_pr_uniq
on public.athlete_results (legacy_pr_record_id)
where legacy_pr_record_id is not null;

-- pr_records learns which event group a row is the projection of.
alter table public.pr_records
  add column if not exists event_group text;

comment on column public.pr_records.event_group is
  'Event group of athlete_results this row is the current best of. Set by refresh_pr_record().';

create index if not exists pr_records_athlete_event_group_idx
on public.pr_records (athlete_id, event_group);

comment on table public.pr_records is
  'Current best per athlete and event. Since 20261008100000 this is a projection of athlete_results, rewritten by trigger. Do not write it from the app.';

-- 4. Pure helpers -------------------------------------------------------------------------

-- "10.84", "10.6h", "1:52.30", "2:45:30", "7.42", "185", "5420". Mirrors formatMark() in marks.ts.
create or replace function public.format_result_mark(p_value numeric, p_unit text, p_timing text default null)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_decimals int;
  v_value numeric;
  v_hours int;
  v_minutes int;
  v_seconds numeric;
  v_text text;
begin
  if p_value is null then
    return null;
  end if;

  if p_unit = 's' then
    v_decimals := case when p_timing = 'hand' and p_value * 10 = trunc(p_value * 10) then 1 else 2 end;
    v_value := round(p_value, v_decimals);
    if v_value >= 3600 then
      v_hours := floor(v_value / 3600)::int;
      v_minutes := floor((v_value - v_hours * 3600) / 60)::int;
      v_seconds := v_value - v_hours * 3600 - v_minutes * 60;
      v_text := v_hours::text || ':' || lpad(v_minutes::text, 2, '0') || ':' ||
        case
          when v_seconds = trunc(v_seconds) then lpad(trunc(v_seconds)::int::text, 2, '0')
          else lpad(trunc(v_seconds)::int::text, 2, '0') || '.' || lpad(((v_seconds - trunc(v_seconds)) * 100)::int::text, 2, '0')
        end;
    elsif v_value >= 60 then
      v_minutes := floor(v_value / 60)::int;
      v_seconds := v_value - v_minutes * 60;
      v_text := v_minutes::text || ':' || lpad(trunc(v_seconds)::int::text, 2, '0') || '.' ||
        case
          when v_decimals = 1 then ((v_seconds - trunc(v_seconds)) * 10)::int::text
          else lpad(((v_seconds - trunc(v_seconds)) * 100)::int::text, 2, '0')
        end;
    else
      v_text := case when v_decimals = 1 then to_char(v_value, 'FM990.0') else to_char(v_value, 'FM990.00') end;
    end if;
    return v_text || case when p_timing = 'hand' then 'h' else '' end;
  end if;

  if p_unit = 'm' then
    return to_char(round(p_value, 2), 'FM999990.00');
  end if;
  if p_unit = 'pts' then
    return round(p_value)::bigint::text;
  end if;
  -- kg and cm: no trailing zeros.
  return regexp_replace(regexp_replace(round(p_value, 2)::text, '(\.\d*?)0+$', '\1'), '\.$', '');
end;
$$;

-- The mark with its unit, the way pr_records.best_value has always held it: "4.05s", "1:52.30", "7.42m", "185kg".
create or replace function public.result_mark_text(p_display text, p_unit text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_unit = 's' then case when p_display like '%:%' or p_display like '%h' then p_display else p_display || 's' end
    when p_unit = 'pts' then p_display
    else p_display || p_unit
  end
$$;

-- "+1.2", "-0.3", "0.0"
create or replace function public.format_wind(p_wind numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_wind is null then null
    when p_wind > 0 then '+' || to_char(p_wind, 'FM0.0')
    else to_char(p_wind, 'FM0.0')
  end
$$;

-- Which event a free text name is. A name that is on the list (ignoring case and spaces) in a
-- unit that fits becomes that event; anything else is 'other' under its own name.
-- p_unit: 's', 'm', 'cm', 'kg' or 'pts'. factor converts the value given in p_unit to the event's unit.
create or replace function public.resolve_result_event(p_name text, p_unit text)
returns table (event_key text, event_label text, mark_unit text, lower_is_better boolean, factor numeric)
language plpgsql
stable
set search_path = public
as $$
declare
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  v_norm text := lower(regexp_replace(coalesce(p_name, ''), '\s+', '', 'g'));
  v_event public.result_events%rowtype;
begin
  select e.*
  into v_event
  from public.result_events e
  where e.kind <> 'other'
    and (
      lower(regexp_replace(e.name, '\s+', '', 'g')) = v_norm
      or replace(e.key, '_', '') = v_norm
      or v_norm = any (e.aliases)
    )
    and (e.unit = p_unit or (e.unit = 'm' and p_unit = 'cm'))
  order by e.sort_order
  limit 1;

  if found then
    return query select v_event.key, v_event.name, v_event.unit, v_event.lower_is_better,
      case when v_event.unit = 'm' and p_unit = 'cm' then 0.01 else 1 end::numeric;
    return;
  end if;

  return query select 'other'::text, coalesce(nullif(v_name, ''), 'Other'), p_unit, (p_unit = 's'), 1::numeric;
end;
$$;

-- "4.05s", "185kg", "1:52.30", "72 cm" as a number and a unit. No rows when it is not a mark.
create or replace function public.parse_legacy_mark(p_text text, p_category text)
returns table (mark_value numeric, mark_unit text)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_raw text := btrim(coalesce(p_text, ''));
  v_match text[];
  v_suffix text;
  v_unit text;
  v_number numeric;
begin
  v_match := regexp_match(v_raw, '^(\d{1,3}):(\d{1,2})(?:[.,](\d{1,3}))?\s*[a-zA-Z]*$');
  if v_match is not null then
    return query select (v_match[1]::numeric * 60 + (v_match[2] || '.' || coalesce(v_match[3], '0'))::numeric), 's'::text;
    return;
  end if;

  v_match := regexp_match(v_raw, '^(\d{1,7}(?:[.,]\d{1,3})?)\s*([a-zA-Z]*)$');
  if v_match is null then
    return;
  end if;

  v_number := replace(v_match[1], ',', '.')::numeric;
  v_suffix := lower(v_match[2]);
  v_unit := case
    when v_suffix in ('s', 'sec', 'secs', 'second', 'seconds') then 's'
    when v_suffix in ('m', 'metres', 'meters') then 'm'
    when v_suffix = 'cm' then 'cm'
    when v_suffix in ('kg', 'kgs') then 'kg'
    when v_suffix in ('pts', 'pt', 'points') then 'pts'
    when v_suffix <> '' then null
    when lower(coalesce(p_category, '')) in ('sprint', 'sprints', 'mid', 'hurdles', 'middle distance') then 's'
    when lower(coalesce(p_category, '')) = 'strength' then 'kg'
    when lower(coalesce(p_category, '')) in ('jumps', 'jump') then 'cm'
    when lower(coalesce(p_category, '')) in ('distance', 'throws', 'throw') then 'm'
    else 'pts'
  end;

  if v_unit is null or v_number <= 0 then
    return;
  end if;
  return query select v_number, v_unit;
end;
$$;

-- The season a date falls in: the club's season when the date is inside it, otherwise the calendar year.
create or replace function public.results_season_bounds(p_tenant_id uuid, p_on date default current_date)
returns table (season_start date, season_end date)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(cp.season_start, date_trunc('year', p_on)::date),
    coalesce(cp.season_end, (date_trunc('year', p_on) + interval '1 year - 1 day')::date)
  from (select 1) one
  left join public.club_profiles cp
    on cp.tenant_id = p_tenant_id
   and p_on between cp.season_start and cp.season_end
$$;

-- The same, for the signed-in member's own club. No rows for anyone who is not an active member.
create or replace function public.get_current_results_season()
returns table (season_start date, season_end date)
language sql
stable
security definer
set search_path = public
as $$
  select s.season_start, s.season_end
  from public.results_season_bounds(public.current_tenant_id(), current_date) s
  where public.current_tenant_id() is not null
$$;

-- The best result of an athlete in an event, optionally inside a date range and from wind legal
-- marks only. Ties go to the mark that was set first. Runs with the caller's row access.
create or replace function public.athlete_event_best(
  p_athlete_id uuid,
  p_event_group text,
  p_from date default null,
  p_to date default null,
  p_legal_only boolean default true
)
returns uuid
language sql
stable
set search_path = public
as $$
  select r.id
  from public.athlete_results r
  where r.athlete_id = p_athlete_id
    and r.event_group = p_event_group
    and (p_from is null or r.result_date >= p_from)
    and (p_to is null or r.result_date <= p_to)
    and (not coalesce(p_legal_only, true) or r.is_wind_legal)
  order by case when r.lower_is_better then r.compare_value else -r.compare_value end, r.result_date, r.created_at, r.id
  limit 1
$$;

revoke all on function public.format_result_mark(numeric, text, text) from public, anon;
revoke all on function public.result_mark_text(text, text) from public, anon;
revoke all on function public.format_wind(numeric) from public, anon;
revoke all on function public.resolve_result_event(text, text) from public, anon;
revoke all on function public.parse_legacy_mark(text, text) from public, anon, authenticated;
revoke all on function public.results_season_bounds(uuid, date) from public, anon, authenticated;
revoke all on function public.get_current_results_season() from public, anon;
revoke all on function public.athlete_event_best(uuid, text, date, date, boolean) from public, anon;

grant execute on function public.format_result_mark(numeric, text, text) to authenticated, service_role;
grant execute on function public.result_mark_text(text, text) to authenticated, service_role;
grant execute on function public.format_wind(numeric) to authenticated, service_role;
grant execute on function public.resolve_result_event(text, text) to authenticated, service_role;
grant execute on function public.parse_legacy_mark(text, text) to service_role;
grant execute on function public.results_season_bounds(uuid, date) to service_role;
grant execute on function public.get_current_results_season() to authenticated, service_role;
grant execute on function public.athlete_event_best(uuid, text, date, date, boolean) to authenticated, service_role;

-- 5. Access helpers -----------------------------------------------------------------------
-- The policies of competitions and competition_entries need each other. These read the tables
-- directly (security definer), so the policies never call one another.

-- Competitions the signed-in athlete may see: their team's, club wide ones, ones they added and
-- ones they are entered in. Empty for everyone else.
create or replace function public.current_athlete_competition_ids()
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
  visible as (
    select c.id
    from me
    join public.competitions c
      on c.tenant_id = me.tenant_id
    where (c.scope = 'team' and c.team_id is not null and c.team_id = me.team_id)
       or c.scope = 'club'
       or (c.scope = 'athlete' and c.owner_athlete_id = me.id)
    union
    select ce.competition_id
    from me
    join public.competition_entries ce
      on ce.athlete_id = me.id
     and ce.tenant_id = me.tenant_id
  )
  select coalesce(array_agg(visible.id), '{}'::uuid[])
  from visible
$$;

-- Staff: may the signed-in coach or club admin see this competition?
-- Club admin: any in the club. Coach: a team they are assigned to, club wide ones, and the
-- competitions athletes on their teams added for themselves.
create or replace function public.staff_can_view_competition(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.competitions c
    where c.id = p_competition_id
      and c.tenant_id = public.current_tenant_id()
      and (
        public.is_club_admin()
        or (c.scope = 'team' and c.team_id is not null and public.is_team_coach(c.team_id))
        or (c.scope = 'club' and public.is_coach_or_admin())
        or (c.scope = 'athlete' and public.is_coach_of_athlete(c.owner_athlete_id))
      )
  )
$$;

revoke all on function public.current_athlete_competition_ids() from public, anon;
revoke all on function public.staff_can_view_competition(uuid) from public, anon;
grant execute on function public.current_athlete_competition_ids() to authenticated, service_role;
grant execute on function public.staff_can_view_competition(uuid) to authenticated, service_role;

-- 6. Row triggers: fill in and check what the client must not decide ------------------------

create or replace function public.competitions_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.venue := nullif(btrim(coalesce(new.venue, '')), '');
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.end_date := coalesce(new.end_date, new.start_date);
  new.updated_at := now();

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by_user_id := auth.uid();
    end if;
    if new.scope = 'athlete' then
      select a.tenant_id into new.tenant_id from public.athletes a where a.id = new.owner_athlete_id;
      if not found then
        raise exception 'This athlete does not exist.' using errcode = '23503';
      end if;
      new.team_id := null;
    elsif new.scope = 'team' then
      if new.team_id is null or not exists (
        select 1 from public.teams t where t.id = new.team_id and t.tenant_id = new.tenant_id
      ) then
        raise exception 'Choose a team of this club for a team competition.' using errcode = '23514';
      end if;
    end if;
  else
    -- What a competition belongs to never changes after it is created.
    new.tenant_id := old.tenant_id;
    new.scope := old.scope;
    new.owner_athlete_id := old.owner_athlete_id;
    new.created_by_user_id := old.created_by_user_id;
    new.created_at := old.created_at;
    if new.team_id is distinct from old.team_id and new.team_id is not null and not exists (
      select 1 from public.teams t where t.id = new.team_id and t.tenant_id = new.tenant_id
    ) then
      raise exception 'Choose a team of this club for a team competition.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists competitions_normalise on public.competitions;
create trigger competitions_normalise
before insert or update on public.competitions
for each row
execute function public.competitions_normalise();

create or replace function public.competition_entries_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competition public.competitions%rowtype;
  v_event public.result_events%rowtype;
begin
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.updated_at := now();

  if tg_op = 'UPDATE' then
    -- Only the status and the notes of an entry change. To change the event, remove it and add another.
    new.tenant_id := old.tenant_id;
    new.competition_id := old.competition_id;
    new.athlete_id := old.athlete_id;
    new.event_key := old.event_key;
    new.event_label := old.event_label;
    new.event_group := old.event_group;
    new.entered_by_user_id := old.entered_by_user_id;
    new.created_at := old.created_at;
    return new;
  end if;

  select c.* into v_competition from public.competitions c where c.id = new.competition_id;
  if not found then
    raise exception 'This competition does not exist.' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.athletes a where a.id = new.athlete_id and a.tenant_id = v_competition.tenant_id
  ) then
    raise exception 'This athlete is not in the club of this competition.' using errcode = '23514';
  end if;
  new.tenant_id := v_competition.tenant_id;

  select e.* into v_event from public.result_events e where e.key = new.event_key;
  if not found then
    raise exception 'Unknown event.' using errcode = '23503';
  end if;
  if v_event.kind = 'other' then
    new.event_label := left(btrim(regexp_replace(coalesce(new.event_label, ''), '\s+', ' ', 'g')), 80);
    if new.event_label = '' then
      raise exception 'Name the event.' using errcode = '23514';
    end if;
    new.event_group := 'o:' || lower(new.event_label);
  else
    new.event_label := v_event.name;
    new.event_group := 'k:' || v_event.key;
  end if;

  if auth.uid() is not null then
    new.entered_by_user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists competition_entries_normalise on public.competition_entries;
create trigger competition_entries_normalise
before insert or update on public.competition_entries
for each row
execute function public.competition_entries_normalise();

create or replace function public.athlete_results_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.result_events%rowtype;
  v_entry public.competition_entries%rowtype;
  v_competition public.competitions%rowtype;
  v_tenant_id uuid;
begin
  if tg_op = 'UPDATE' then
    -- Whose result it is, where it came from and who entered it never change.
    new.athlete_id := old.athlete_id;
    new.tenant_id := old.tenant_id;
    new.source := old.source;
    new.test_result_id := old.test_result_id;
    new.legacy_pr_record_id := old.legacy_pr_record_id;
    new.entered_by_user_id := old.entered_by_user_id;
    new.created_at := old.created_at;
    if old.competition_entry_id is not null and new.competition_entry_id is not null then
      new.competition_entry_id := old.competition_entry_id;
    end if;
  end if;

  select a.tenant_id into v_tenant_id from public.athletes a where a.id = new.athlete_id;
  if not found then
    raise exception 'This athlete does not exist.' using errcode = '23503';
  end if;
  new.tenant_id := v_tenant_id;

  -- A result for a competition entry takes its athlete, event and competition from the entry.
  if new.competition_entry_id is not null and (tg_op = 'INSERT' or old.competition_entry_id is null) then
    select ce.* into v_entry from public.competition_entries ce where ce.id = new.competition_entry_id;
    if not found or v_entry.athlete_id <> new.athlete_id then
      raise exception 'This entry does not belong to this athlete.' using errcode = '23514';
    end if;
    new.competition_id := v_entry.competition_id;
    new.event_key := v_entry.event_key;
    new.event_label := v_entry.event_label;
  end if;

  if new.competition_id is not null then
    select c.* into v_competition from public.competitions c where c.id = new.competition_id;
    if not found or v_competition.tenant_id <> new.tenant_id then
      raise exception 'This competition does not exist.' using errcode = '23503';
    end if;
    new.result_date := coalesce(new.result_date, v_competition.start_date);
    if new.result_date < v_competition.start_date or new.result_date > v_competition.end_date then
      raise exception 'The date of a competition result must be on a day of the competition.' using errcode = '23514';
    end if;
    new.environment := v_competition.environment;
    new.location := coalesce(nullif(btrim(coalesce(new.location, '')), ''), v_competition.name);
  elsif new.source = 'competition' and tg_op = 'INSERT' then
    raise exception 'A competition result needs its competition.' using errcode = '23514';
  end if;

  if new.result_date is null then
    raise exception 'A result needs a date.' using errcode = '23514';
  end if;
  if new.result_date > current_date + 1 then
    raise exception 'A result cannot be dated in the future.' using errcode = '23514';
  end if;

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

  new.mark_value := case new.mark_unit
    when 'm' then round(new.mark_value, 2)
    when 'cm' then round(new.mark_value, 1)
    when 'kg' then round(new.mark_value, 2)
    when 'pts' then round(new.mark_value, 0)
    else round(new.mark_value, 3)
  end;

  if new.mark_unit <> 's' then
    new.timing := null;
  end if;
  new.compare_value := new.mark_value + case when new.timing = 'hand' then v_event.hand_time_adjust else 0 end;
  new.mark_display := public.format_result_mark(new.mark_value, new.mark_unit, new.timing);

  -- Wind only where it is measured: the six wind events, outdoors.
  if not v_event.wind_applies or new.environment = 'indoor' then
    new.wind := null;
    new.is_wind_legal := true;
  elsif new.wind is not null then
    new.wind := round(new.wind, 1);
    new.is_wind_legal := new.wind <= 2.0;
  elsif new.source <> 'imported' then
    -- No reading: the mark counts. (An imported record may carry "not legal" without a reading.)
    new.is_wind_legal := true;
  end if;

  if new.competition_id is null then
    new.place := null;
  end if;
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.updated_at := now();

  if tg_op = 'INSERT' and auth.uid() is not null and new.source not in ('test_week', 'imported') then
    new.entered_by_user_id := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists athlete_results_normalise on public.athlete_results;
create trigger athlete_results_normalise
before insert or update on public.athlete_results
for each row
execute function public.athlete_results_normalise();

revoke all on function public.competitions_normalise() from public, anon, authenticated;
revoke all on function public.competition_entries_normalise() from public, anon, authenticated;
revoke all on function public.athlete_results_normalise() from public, anon, authenticated;

-- 7. pr_records as a projection -----------------------------------------------------------

-- Rewrites the one pr_records row for an athlete and event group from the history:
-- the best wind legal mark, or the best wind assisted mark (is_legal = false) when there is no
-- legal one. Removes the row when the athlete has no result left for the event.
create or replace function public.refresh_pr_record(p_athlete_id uuid, p_event_group text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_best public.athlete_results%rowtype;
  v_best_id uuid;
  v_existing public.pr_records%rowtype;
  v_previous text;
  v_best_text text;
  v_category text;
  v_source_ref text;
begin
  if p_athlete_id is null or p_event_group is null then
    return;
  end if;

  v_best_id := public.athlete_event_best(p_athlete_id, p_event_group, null, null, true);
  if v_best_id is null then
    v_best_id := public.athlete_event_best(p_athlete_id, p_event_group, null, null, false);
  end if;

  if v_best_id is null then
    delete from public.pr_records pr
    where pr.athlete_id = p_athlete_id
      and pr.event_group = p_event_group;
    return;
  end if;

  select r.* into v_best from public.athlete_results r where r.id = v_best_id;
  v_best_text := public.result_mark_text(v_best.mark_display, v_best.mark_unit);

  select pr.*
  into v_existing
  from public.pr_records pr
  where pr.athlete_id = p_athlete_id
    and (pr.event_group = p_event_group or (pr.event_group is null and lower(btrim(pr.event)) = lower(v_best.event_label)))
  order by (pr.event_group = p_event_group) desc nulls last, pr.measured_on desc
  limit 1;

  -- "Before": the best legal mark set earlier than the current best. When the history has none,
  -- the value that was there is kept as long as the best itself has not changed.
  select public.result_mark_text(r.mark_display, r.mark_unit)
  into v_previous
  from public.athlete_results r
  where r.athlete_id = p_athlete_id
    and r.event_group = p_event_group
    and r.id <> v_best.id
    and r.is_wind_legal
    and (r.result_date, r.created_at) < (v_best.result_date, v_best.created_at)
  order by case when r.lower_is_better then r.compare_value else -r.compare_value end, r.result_date
  limit 1;

  if v_previous is null and v_existing.id is not null and v_existing.best_value = v_best_text then
    v_previous := v_existing.previous_value;
  end if;

  select case
    when e.kind <> 'other' then e.category
    when v_best.mark_unit = 's' then 'Sprint'
    when v_best.mark_unit = 'kg' then 'Strength'
    when v_best.mark_unit = 'cm' then 'Jumps'
    when v_best.mark_unit = 'm' then 'Distance'
    else 'Performance'
  end
  into v_category
  from public.result_events e
  where e.key = v_best.event_key;

  select case
    when v_best.test_result_id is not null then (
      select tr.test_week_id::text || ':' || tr.test_definition_id::text
      from public.test_results tr
      where tr.id = v_best.test_result_id
    )
    when v_best.competition_id is not null then v_best.competition_id::text
  end
  into v_source_ref;

  if v_existing.id is not null then
    update public.pr_records pr
    set event_group = p_event_group,
        category = coalesce(v_category, pr.category),
        best_value = v_best_text,
        previous_value = v_previous,
        measured_on = v_best.result_date,
        source_type = case v_best.source when 'test_week' then 'test-week' when 'imported' then 'import' else 'manual' end,
        source_ref = v_source_ref,
        is_legal = v_best.is_wind_legal,
        wind = public.format_wind(v_best.wind),
        note = v_best.notes,
        recorded_by_user_id = v_best.entered_by_user_id
    where pr.id = v_existing.id
      and (
        pr.event_group is distinct from p_event_group
        or pr.best_value is distinct from v_best_text
        or pr.previous_value is distinct from v_previous
        or pr.measured_on is distinct from v_best.result_date
        or pr.is_legal is distinct from v_best.is_wind_legal
        or pr.wind is distinct from public.format_wind(v_best.wind)
        or pr.note is distinct from v_best.notes
        or pr.source_ref is distinct from v_source_ref
      );
    return;
  end if;

  insert into public.pr_records (
    tenant_id, athlete_id, event, event_group, category, best_value, previous_value, measured_on,
    source_type, source_ref, is_legal, wind, note, recorded_by_user_id
  )
  values (
    v_best.tenant_id, p_athlete_id, v_best.event_label, p_event_group, coalesce(v_category, 'Performance'),
    v_best_text, v_previous, v_best.result_date,
    case v_best.source when 'test_week' then 'test-week' when 'imported' then 'import' else 'manual' end,
    v_source_ref, v_best.is_wind_legal, public.format_wind(v_best.wind), v_best.notes, v_best.entered_by_user_id
  )
  on conflict (athlete_id, event) do update
  set event_group = excluded.event_group,
      category = excluded.category,
      best_value = excluded.best_value,
      previous_value = excluded.previous_value,
      measured_on = excluded.measured_on,
      source_type = excluded.source_type,
      source_ref = excluded.source_ref,
      is_legal = excluded.is_legal,
      wind = excluded.wind,
      note = excluded.note,
      recorded_by_user_id = excluded.recorded_by_user_id;
end;
$$;

create or replace function public.athlete_results_refresh_pr_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The backfill at the end of this file refreshes every event once, after all rows are in.
  if current_setting('sktr.results_backfill', true) = 'on' then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_pr_record(old.athlete_id, old.event_group);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.event_group is distinct from old.event_group) then
    perform public.refresh_pr_record(new.athlete_id, new.event_group);
  end if;
  return null;
end;
$$;

drop trigger if exists athlete_results_refresh_pr_record on public.athlete_results;
create trigger athlete_results_refresh_pr_record
after insert or update or delete on public.athlete_results
for each row
execute function public.athlete_results_refresh_pr_record();

revoke all on function public.refresh_pr_record(uuid, text) from public, anon, authenticated;
revoke all on function public.athlete_results_refresh_pr_record() from public, anon, authenticated;

-- Athletes used to write pr_records from the browser after a test week. The projection does that
-- now, so the two policies that allowed it go. (Staff keep pr_records_staff_all; reads are unchanged.)
drop policy if exists pr_records_insert_own_test_week on public.pr_records;
drop policy if exists pr_records_update_own_test_week on public.pr_records;

-- 8. Test week results feed the history -----------------------------------------------------

create or replace function public.sync_test_result_to_history(p_test_result_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_event record;
  v_unit text;
begin
  select tr.id, tr.athlete_id, tr.value_numeric, tr.submitted_at, tr.submitted_by_user_id,
         td.name as test_name, td.unit as test_unit, td.scheduled_date, tw.name as test_week_name
  into v_row
  from public.test_results tr
  join public.test_definitions td on td.id = tr.test_definition_id
  join public.test_weeks tw on tw.id = tr.test_week_id
  where tr.id = p_test_result_id;

  if not found then
    return;
  end if;

  -- A result that is not a positive number has no place in the history.
  if v_row.value_numeric is null or v_row.value_numeric <= 0 then
    delete from public.athlete_results r where r.test_result_id = p_test_result_id;
    return;
  end if;

  v_unit := case v_row.test_unit
    when 'time' then 's'
    when 'distance' then 'm'
    when 'weight' then 'kg'
    when 'height' then 'cm'
    else 'pts'
  end;

  select * into v_event from public.resolve_result_event(v_row.test_name, v_unit);

  insert into public.athlete_results (
    athlete_id, event_key, event_label, mark_unit, lower_is_better, mark_value, result_date,
    source, test_result_id, location, entered_by_user_id
  )
  values (
    v_row.athlete_id, v_event.event_key, v_event.event_label, v_event.mark_unit, v_event.lower_is_better,
    v_row.value_numeric * v_event.factor,
    least(v_row.scheduled_date, (v_row.submitted_at at time zone 'utc')::date),
    'test_week', v_row.id, left(v_row.test_week_name, 160), v_row.submitted_by_user_id
  )
  on conflict (test_result_id) where test_result_id is not null do update
  set event_key = excluded.event_key,
      event_label = excluded.event_label,
      mark_unit = excluded.mark_unit,
      lower_is_better = excluded.lower_is_better,
      mark_value = excluded.mark_value,
      result_date = excluded.result_date,
      location = excluded.location;
end;
$$;

create or replace function public.test_results_sync_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_test_result_to_history(new.id);
  return null;
end;
$$;

drop trigger if exists test_results_sync_history on public.test_results;
create trigger test_results_sync_history
after insert or update of value_numeric, value_text, test_definition_id, submitted_at on public.test_results
for each row
execute function public.test_results_sync_history();

-- A coach renaming a test or changing its unit moves its results to the right event.
create or replace function public.test_definitions_sync_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  for v_id in select tr.id from public.test_results tr where tr.test_definition_id = new.id
  loop
    perform public.sync_test_result_to_history(v_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists test_definitions_sync_history on public.test_definitions;
create trigger test_definitions_sync_history
after update of name, unit, scheduled_date on public.test_definitions
for each row
when (old.name is distinct from new.name or old.unit is distinct from new.unit or old.scheduled_date is distinct from new.scheduled_date)
execute function public.test_definitions_sync_history();

revoke all on function public.sync_test_result_to_history(uuid) from public, anon, authenticated;
revoke all on function public.test_results_sync_history() from public, anon, authenticated;
revoke all on function public.test_definitions_sync_history() from public, anon, authenticated;

-- 9. Bests as a view ------------------------------------------------------------------------
-- One row per athlete, event and kind of best. Runs with the reader's row access
-- (security_invoker), so it shows exactly the results the reader may read.
--   personal_best        best wind legal mark ever
--   season_best          best wind legal mark of the current season
--   wind_assisted_best   best mark with a wind reading over +2.0 (shown separately, never a record)

create or replace view public.athlete_event_bests
with (security_invoker = true)
as
with marks as (
  select
    r.*,
    case when r.lower_is_better then r.compare_value else -r.compare_value end as rank_value,
    coalesce(cp.season_start, date_trunc('year', current_date)::date) as season_start,
    coalesce(cp.season_end, (date_trunc('year', current_date) + interval '1 year - 1 day')::date) as season_end
  from public.athlete_results r
  left join public.club_profiles cp
    on cp.tenant_id = r.tenant_id
   and current_date between cp.season_start and cp.season_end
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

-- 10. Row level security --------------------------------------------------------------------

alter table public.competitions enable row level security;
alter table public.competition_entries enable row level security;
alter table public.athlete_results enable row level security;

revoke all on public.competitions from anon;
revoke all on public.competition_entries from anon;
revoke all on public.athlete_results from anon;
grant select, insert, update, delete on public.competitions to authenticated, service_role;
grant select, insert, update, delete on public.competition_entries to authenticated, service_role;
grant select, insert, update, delete on public.athlete_results to authenticated, service_role;

-- competitions
drop policy if exists competitions_select_scope on public.competitions;
create policy competitions_select_scope
on public.competitions
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    id = any ((select public.current_athlete_competition_ids())::uuid[])
    or (select public.is_club_admin())
    or (scope = 'team' and team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
    or (scope = 'club' and (select public.is_coach_or_admin()))
    or (scope = 'athlete' and owner_athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
    -- The row a member has just created (an athlete's own meet is in the list above only once it is stored).
    or (scope = 'athlete' and owner_athlete_id = (select public.current_athlete_id()))
  )
);

drop policy if exists competitions_insert_athlete_own on public.competitions;
create policy competitions_insert_athlete_own
on public.competitions
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and scope = 'athlete'
  and owner_athlete_id = (select public.current_athlete_id())
);

drop policy if exists competitions_update_athlete_own on public.competitions;
create policy competitions_update_athlete_own
on public.competitions
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and scope = 'athlete'
  and owner_athlete_id = (select public.current_athlete_id())
)
with check (
  tenant_id = public.current_tenant_id()
  and scope = 'athlete'
  and owner_athlete_id = (select public.current_athlete_id())
);

drop policy if exists competitions_delete_athlete_own on public.competitions;
create policy competitions_delete_athlete_own
on public.competitions
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and scope = 'athlete'
  and owner_athlete_id = (select public.current_athlete_id())
);

-- Staff: a club admin writes team and club competitions; a coach writes the competitions of the
-- teams they are assigned to. Nobody but the athlete writes an athlete's own competition.
drop policy if exists competitions_insert_staff on public.competitions;
create policy competitions_insert_staff
on public.competitions
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and (
    (scope in ('team', 'club') and (select public.is_club_admin()))
    or (scope = 'team' and team_id = any ((select public.current_coach_team_ids())::uuid[]))
  )
);

drop policy if exists competitions_update_staff on public.competitions;
create policy competitions_update_staff
on public.competitions
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (scope in ('team', 'club') and (select public.is_club_admin()))
    or (scope = 'team' and team_id = any ((select public.current_coach_team_ids())::uuid[]))
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and (
    (scope in ('team', 'club') and (select public.is_club_admin()))
    or (scope = 'team' and team_id = any ((select public.current_coach_team_ids())::uuid[]))
  )
);

drop policy if exists competitions_delete_staff on public.competitions;
create policy competitions_delete_staff
on public.competitions
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (scope in ('team', 'club') and (select public.is_club_admin()))
    or (scope = 'team' and team_id = any ((select public.current_coach_team_ids())::uuid[]))
  )
);

-- competition_entries
drop policy if exists competition_entries_select_scope on public.competition_entries;
create policy competition_entries_select_scope
on public.competition_entries
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

-- An athlete enters themselves in a competition they can see.
drop policy if exists competition_entries_insert_athlete_own on public.competition_entries;
create policy competition_entries_insert_athlete_own
on public.competition_entries
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id = (select public.current_athlete_id())
  and competition_id = any ((select public.current_athlete_competition_ids())::uuid[])
);

-- An athlete may scratch or annotate any entry of their own, and remove the ones they made.
drop policy if exists competition_entries_update_athlete_own on public.competition_entries;
create policy competition_entries_update_athlete_own
on public.competition_entries
for update
to authenticated
using (tenant_id = public.current_tenant_id() and athlete_id = (select public.current_athlete_id()))
with check (tenant_id = public.current_tenant_id() and athlete_id = (select public.current_athlete_id()));

drop policy if exists competition_entries_delete_athlete_own on public.competition_entries;
create policy competition_entries_delete_athlete_own
on public.competition_entries
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and athlete_id = (select public.current_athlete_id())
  and entered_by_user_id = auth.uid()
);

drop policy if exists competition_entries_insert_staff on public.competition_entries;
create policy competition_entries_insert_staff
on public.competition_entries
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  and public.staff_can_view_competition(competition_id)
);

drop policy if exists competition_entries_update_staff on public.competition_entries;
create policy competition_entries_update_staff
on public.competition_entries
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

drop policy if exists competition_entries_delete_staff on public.competition_entries;
create policy competition_entries_delete_staff
on public.competition_entries
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

-- athlete_results
drop policy if exists athlete_results_select_scope on public.athlete_results;
create policy athlete_results_select_scope
on public.athlete_results
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

-- An athlete adds their own manual, training and competition results. Test week results come
-- from test_results (trigger), imported ones from the backfill: neither can be inserted by hand.
drop policy if exists athlete_results_insert_athlete_own on public.athlete_results;
create policy athlete_results_insert_athlete_own
on public.athlete_results
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id = (select public.current_athlete_id())
  and source in ('manual', 'training', 'competition')
  and test_result_id is null
  and legacy_pr_record_id is null
  and (competition_id is null or competition_id = any ((select public.current_athlete_competition_ids())::uuid[]))
);

-- ... and changes or deletes only the ones they entered themselves.
drop policy if exists athlete_results_update_athlete_own on public.athlete_results;
create policy athlete_results_update_athlete_own
on public.athlete_results
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and athlete_id = (select public.current_athlete_id())
  and entered_by_user_id = auth.uid()
  and source in ('manual', 'training', 'competition')
)
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id = (select public.current_athlete_id())
  and entered_by_user_id = auth.uid()
  and source in ('manual', 'training', 'competition')
  and (competition_id is null or competition_id = any ((select public.current_athlete_competition_ids())::uuid[]))
);

drop policy if exists athlete_results_delete_athlete_own on public.athlete_results;
create policy athlete_results_delete_athlete_own
on public.athlete_results
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and athlete_id = (select public.current_athlete_id())
  and entered_by_user_id = auth.uid()
  and source in ('manual', 'training', 'competition')
);

-- Staff add results for, and correct the results of, the athletes they manage. A test week
-- result is corrected in the test week (test_results), not here.
drop policy if exists athlete_results_insert_staff on public.athlete_results;
create policy athlete_results_insert_staff
on public.athlete_results
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  and source in ('manual', 'training', 'competition')
  and test_result_id is null
  and legacy_pr_record_id is null
  and (competition_id is null or public.staff_can_view_competition(competition_id))
);

drop policy if exists athlete_results_update_staff on public.athlete_results;
create policy athlete_results_update_staff
on public.athlete_results
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  and source <> 'test_week'
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  and source <> 'test_week'
  and (competition_id is null or public.staff_can_view_competition(competition_id))
);

drop policy if exists athlete_results_delete_staff on public.athlete_results;
create policy athlete_results_delete_staff
on public.athlete_results
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  and source <> 'test_week'
);

-- 11. Notifications ---------------------------------------------------------------------------

-- 11a. A new result is a personal or season best: tell the coaches of the athlete's team, in-app.
-- Quiet on purpose for: the first mark ever in an event (nothing was beaten), marks more than two
-- weeks old (an athlete filling in last season), wind assisted marks, imports and the backfill.
create or replace function public.athlete_results_notify_best()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete record;
  v_season record;
  v_kind text;
  v_previous record;
  v_name text;
  v_coach_user_id uuid;
begin
  if current_setting('sktr.results_backfill', true) = 'on'
     or new.source = 'imported'
     or not new.is_wind_legal
     or new.result_date < current_date - 14 then
    return null;
  end if;

  select a.id, a.team_id into v_athlete from public.athletes a where a.id = new.athlete_id;
  if not found or v_athlete.team_id is null then
    return null;
  end if;

  if public.athlete_event_best(new.athlete_id, new.event_group, null, null, true) = new.id then
    select r.mark_display, r.mark_unit
    into v_previous
    from public.athlete_results r
    where r.athlete_id = new.athlete_id
      and r.event_group = new.event_group
      and r.id <> new.id
      and r.is_wind_legal
    order by case when r.lower_is_better then r.compare_value else -r.compare_value end, r.result_date
    limit 1;
    if found then
      v_kind := 'personal_best';
    end if;
  end if;

  if v_kind is null then
    select * into v_season from public.results_season_bounds(new.tenant_id, current_date);
    if new.result_date between v_season.season_start and v_season.season_end
       and public.athlete_event_best(new.athlete_id, new.event_group, v_season.season_start, v_season.season_end, true) = new.id then
      select r.mark_display, r.mark_unit
      into v_previous
      from public.athlete_results r
      where r.athlete_id = new.athlete_id
        and r.event_group = new.event_group
        and r.id <> new.id
        and r.is_wind_legal
        and r.result_date between v_season.season_start and v_season.season_end
      order by case when r.lower_is_better then r.compare_value else -r.compare_value end, r.result_date
      limit 1;
      if found then
        v_kind := 'season_best';
      end if;
    end if;
  end if;

  if v_kind is null then
    return null;
  end if;

  v_name := public.notification_athlete_name(new.athlete_id);

  for v_coach_user_id in select public.notification_team_coach_user_ids(v_athlete.team_id)
  loop
    perform public.enqueue_notification(
      new.tenant_id,
      v_coach_user_id,
      'athlete_new_best',
      format(
        '%s set a %s in the %s',
        v_name,
        case when v_kind = 'personal_best' then 'personal best' else 'season best' end,
        new.event_label
      ),
      format(
        '%s%s on %s%s. Before: %s.',
        public.result_mark_text(new.mark_display, new.mark_unit),
        case when new.wind is null then '' else format(' (%s)', public.format_wind(new.wind)) end,
        public.notification_date_label(new.result_date),
        case when new.location is null then '' else format(', %s', new.location) end,
        public.result_mark_text(v_previous.mark_display, v_previous.mark_unit)
      ),
      jsonb_build_object(
        'athlete_id', new.athlete_id::text,
        'team_id', v_athlete.team_id::text,
        'result_id', new.id::text,
        'best_kind', v_kind
      ),
      array['in-app'],
      'result_best:' || new.id::text,
      interval '1 day'
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists athlete_results_notify_best on public.athlete_results;
create trigger athlete_results_notify_best
after insert on public.athlete_results
for each row
execute function public.athlete_results_notify_best();

-- 11b. Someone else entered the athlete in a competition: tell the athlete, in-app and by email.
-- One notification per athlete and competition however many events were entered at once.
create or replace function public.enqueue_competition_entry_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  for v_row in
    select
      c.id as competition_id, c.tenant_id, c.name, c.start_date, c.end_date, c.venue,
      a.id as athlete_id, a.user_id,
      string_agg(nr.event_label, ', ' order by nr.event_label) as events
    from new_rows nr
    join public.competitions c on c.id = nr.competition_id
    join public.athletes a on a.id = nr.athlete_id and a.tenant_id = nr.tenant_id
    where a.user_id is not null
      and a.is_active
      and nr.status = 'entered'
      -- An athlete entering themselves knows already.
      and nr.entered_by_user_id is distinct from a.user_id
    group by c.id, c.tenant_id, c.name, c.start_date, c.end_date, c.venue, a.id, a.user_id
  loop
    perform public.enqueue_notification(
      v_row.tenant_id,
      v_row.user_id,
      'competition_entry_added',
      format('You are entered in %s', v_row.name),
      format(
        '%s%s. Events: %s.',
        case
          when v_row.end_date > v_row.start_date then
            format('%s to %s', public.notification_date_label(v_row.start_date), public.notification_date_label(v_row.end_date))
          else public.notification_date_label(v_row.start_date)
        end,
        case when v_row.venue is null then '' else format(', %s', v_row.venue) end,
        v_row.events
      ),
      jsonb_build_object('competition_id', v_row.competition_id::text, 'athlete_id', v_row.athlete_id::text),
      array['in-app', 'email'],
      'competition_entry:' || v_row.competition_id::text || ':' || v_row.athlete_id::text,
      interval '10 minutes'
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists queue_competition_entry_notifications on public.competition_entries;
create trigger queue_competition_entry_notifications
after insert on public.competition_entries
referencing new table as new_rows
for each statement
execute function public.enqueue_competition_entry_notifications();

revoke all on function public.athlete_results_notify_best() from public, anon, authenticated;
revoke all on function public.enqueue_competition_entry_notifications() from public, anon, authenticated;

-- 12. Backfill, once --------------------------------------------------------------------------
-- Runs inside one block so the two "be quiet" switches last exactly as long as the copy:
-- no notification is created for anything that happened before this file ran, and pr_records is
-- refreshed once at the end instead of once per copied row.
--   a. Every test result with a positive number that the history does not hold yet.
--   b. Every pr_records row not handled before (event_group is null) whose best the history does
--      not already contain: copied as 'imported', dated measured_on.
--   c. pr_records refreshed from the history for every athlete and event.
-- Safe to run again: (a) skips test results already linked, (b) skips rows already handled.

do $$
declare
  v_id uuid;
  v_pr record;
  v_mark record;
  v_event record;
  v_group text;
  v_value numeric;
  v_wind numeric;
  v_pair record;
begin
  perform set_config('sktr.results_backfill', 'on', true);

  for v_id in
    select tr.id
    from public.test_results tr
    where tr.value_numeric is not null
      and tr.value_numeric > 0
      and not exists (select 1 from public.athlete_results r where r.test_result_id = tr.id)
    order by tr.submitted_at
  loop
    perform public.sync_test_result_to_history(v_id);
  end loop;

  for v_pr in
    select pr.*
    from public.pr_records pr
    where pr.event_group is null
      and not exists (select 1 from public.athlete_results r where r.legacy_pr_record_id = pr.id)
    order by pr.measured_on
  loop
    select * into v_mark from public.parse_legacy_mark(v_pr.best_value, v_pr.category);
    if not found then
      -- Not a readable mark ("fast"). The row stays as it is and is never touched by the projection.
      continue;
    end if;

    select * into v_event from public.resolve_result_event(v_pr.event, v_mark.mark_unit);
    v_group := case when v_event.event_key = 'other' then 'o:' || lower(v_event.event_label) else 'k:' || v_event.event_key end;
    v_value := v_mark.mark_value * v_event.factor;

    if not exists (
      select 1
      from public.athlete_results r
      where r.athlete_id = v_pr.athlete_id
        and r.event_group = v_group
        and abs(r.mark_value - v_value) < 0.0005
    ) then
      v_wind := case
        when btrim(coalesce(v_pr.wind, '')) ~ '^[+-]?\d(\.\d)?$' then btrim(v_pr.wind)::numeric
      end;

      insert into public.athlete_results (
        athlete_id, event_key, event_label, mark_unit, lower_is_better, mark_value, result_date,
        source, legacy_pr_record_id, wind, is_wind_legal, notes, entered_by_user_id
      )
      values (
        v_pr.athlete_id, v_event.event_key, v_event.event_label, v_event.mark_unit, v_event.lower_is_better,
        v_value, least(v_pr.measured_on, current_date), 'imported', v_pr.id, v_wind, v_pr.is_legal,
        v_pr.note, v_pr.recorded_by_user_id
      );
    end if;

    update public.pr_records pr
    set event_group = v_group
    where pr.id = v_pr.id
      and not exists (
        select 1 from public.pr_records other
        where other.athlete_id = v_pr.athlete_id and other.event_group = v_group and other.id <> v_pr.id
      );
  end loop;

  for v_pair in
    select distinct r.athlete_id, r.event_group
    from public.athlete_results r
  loop
    perform public.refresh_pr_record(v_pair.athlete_id, v_pair.event_group);
  end loop;

  perform set_config('sktr.results_backfill', 'off', true);
end;
$$;

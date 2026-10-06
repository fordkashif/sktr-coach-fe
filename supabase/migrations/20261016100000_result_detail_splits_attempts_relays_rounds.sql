-- SKTR Coach: result detail (rounds and heats, splits, attempt series) and relays
-- Created: 2026-10-16
--
-- BEFORE THIS FILE
--   A result was one number: a mark, with wind and place. An entry at a competition could hold
--   one result, so a heat and a final could not both be kept. There was nowhere to keep the
--   splits of a race, the six attempts of a jump or throw, the heights of a high jump, or a relay.
--
-- WHAT THIS FILE ADDS
--   1. Rounds and heats on athlete_results: round (heat, quarter final, semi final, final, timed
--      final), heat number, lane and a qualifier mark (Q or q). place is the place in that race.
--      An entry can now hold one result per round (athlete_results_entry_round_uniq replaces
--      athlete_results_entry_uniq). Every round is a row of the history, so the best legal mark
--      across rounds counts for records, season bests and goals exactly as before.
--   2. athlete_results.detail (jsonb): the splits of a race, the reaction time, the attempt series
--      of a horizontal jump or throw, the heights of a vertical jump. One canonical shape, checked
--      and rewritten by apply_result_detail(), the same rules as applyResultDetail() in
--      src/lib/data/pr/marks.ts. Keep the two in step.
--        splits     { "every": 200, "times": [24.10, 49.80] }   running (cumulative) seconds
--        reaction   0.152
--        attempts   [ { "result": "mark", "mark": 6.42, "wind": 1.2 }, { "result": "foul" }, { "result": "pass" } ]
--        heights    [ { "height": 1.80, "tries": "O" }, { "height": 1.85, "tries": "XO" } ]
--      With a series the mark is COMPUTED: the best measured attempt, or the highest height
--      cleared. Whatever the client sent as the mark is replaced.
--   3. The best wind legal attempt of a series. When the best attempt had a wind over +2.0 and
--      another attempt of the series was wind legal, that legal attempt is kept as its own row of
--      the history (derived_from_result_id points at the series) so it counts for records.
--      It follows the series: changed with it, deleted with it.
--   4. Relays. relay_entries is a team entry at a competition (event, team, round, and the time
--      once it is run); relay_entry_legs are its four legs in order, each an athlete of the club
--      with an optional leg split. A relay is NOT a row of athlete_results, so it never becomes
--      anyone's individual record. relay_team_bests is the best time per team and relay event.
--        save_relay_entry(jsonb)            coach (lead or coach, not assistant) or club admin
--        get_relay_entries(competition, athlete)   the relays the caller may see, with leg names
--
-- WHO CAN DO WHAT (details in SUPABASE_RLS_POLICY_MATRIX.md)
--   Result detail has no policy of its own: it is a column, so it is read and written exactly
--   like the result it belongs to.
--   Relays     read: the athletes who ran a leg (their own relays only, with the names of that
--              relay's legs), the staff of the relay's team or of a leg athlete's team (assistants
--              included, like results), club admins.
--              write: club admins, and lead coaches and coaches for a team they coach with
--              athletes they coach. Athletes never write a relay.
--   Guardians (20261016090000): NO policy on relay_entries or relay_entry_legs and nothing from
--              get_relay_entries(), so a parent reads no relay, not even their child's (a relay
--              names three other athletes). Result detail is a column of athlete_results, so a
--              guardian who already reads the child's result through athlete_results_select_guardian
--              reads its round, splits and attempts with it. That is deliberate: it is the same
--              result, and it names nobody else.
--   Everyone else, a deactivated member and anyone in a suspended or cancelled club: nothing.
--
-- DELETION
--   Club deletion: both new tables have tenant_id and are swept by sweep_rows_by_column().
--   Athlete deletion (their own account, or by a club admin): the relay stays for the other three
--   and for the team record list; the leg is kept with no athlete ("Former member"). A trigger
--   turns a delete of one leg into that, so the catalogue sweep of athlete_id needs no change.
--
-- Idempotent: add column if not exists, create ... if not exists, create or replace, drop
-- constraint/policy/trigger if exists + create. One index is replaced (see 1). No row is changed.

-- 1. Rounds, heats and detail on a result ------------------------------------------------------

alter table public.athlete_results
  add column if not exists round text,
  add column if not exists heat_number int,
  add column if not exists lane int,
  add column if not exists qualifier text,
  add column if not exists detail jsonb,
  add column if not exists derived_from_result_id uuid references public.athlete_results(id) on delete cascade;

alter table public.athlete_results drop constraint if exists athlete_results_round_check;
alter table public.athlete_results add constraint athlete_results_round_check
  check (round is null or round in ('heat', 'quarter_final', 'semi_final', 'final', 'timed_final'));
alter table public.athlete_results drop constraint if exists athlete_results_heat_number_check;
alter table public.athlete_results add constraint athlete_results_heat_number_check
  check (heat_number is null or heat_number between 1 and 99);
alter table public.athlete_results drop constraint if exists athlete_results_lane_check;
alter table public.athlete_results add constraint athlete_results_lane_check
  check (lane is null or lane between 1 and 20);
alter table public.athlete_results drop constraint if exists athlete_results_qualifier_check;
alter table public.athlete_results add constraint athlete_results_qualifier_check
  check (qualifier is null or qualifier in ('Q', 'q'));
alter table public.athlete_results drop constraint if exists athlete_results_detail_check;
alter table public.athlete_results add constraint athlete_results_detail_check
  check (detail is null or jsonb_typeof(detail) = 'object');

comment on column public.athlete_results.round is
  'heat, quarter_final, semi_final, final or timed_final. Null when the event had one round or nobody said.';
comment on column public.athlete_results.place is
  'Place in this race or round (in the heat for a heat, in the final for a final).';
comment on column public.athlete_results.qualifier is
  'Q: went through on place. q: went through on time.';
comment on column public.athlete_results.detail is
  'Splits, reaction time, attempt series or heights. Shape and rules: apply_result_detail().';
comment on column public.athlete_results.derived_from_result_id is
  'Set on the row that holds the best wind legal attempt of a series whose best attempt was wind assisted. Maintained by trigger; follows the series.';

-- One result per round of an entry. The deciding round is one slot: a result with no round, a
-- final and a timed final cannot both exist for the same entry.
drop index if exists public.athlete_results_entry_uniq;
create unique index if not exists athlete_results_entry_round_uniq
on public.athlete_results (
  competition_entry_id,
  (case when round in ('heat', 'quarter_final', 'semi_final') then round else 'final' end)
)
where competition_entry_id is not null;

create unique index if not exists athlete_results_derived_uniq
on public.athlete_results (derived_from_result_id)
where derived_from_result_id is not null;

-- 2. The rules of result detail ------------------------------------------------------------------
-- Checks the detail a client sent and returns its canonical form with what follows from it:
--   detail   the cleaned detail, or null when nothing applies to this event
--   series   true when the mark comes from the detail (an attempt series or heights)
--   mark     the best measured attempt or the highest height cleared (p_mark when no series)
--   wind     the wind of that attempt
--   legal    { mark, wind } of the best wind legal attempt, only when the best attempt itself
--            had a wind over +2.0 and another attempt was legal
-- Parts that do not belong to the event are dropped, not refused: splits and reaction are for
-- times, attempts for distances that are not the high jump or pole vault, heights for those two.
create or replace function public.apply_result_detail(
  p_detail jsonb,
  p_event_key text,
  p_unit text,
  p_wind_applies boolean,
  p_mark numeric
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_vertical boolean := coalesce(p_event_key, '') in ('high_jump', 'pole_vault');
  v_item jsonb;
  v_list jsonb;
  v_built jsonb;
  v_value numeric;
  v_prev numeric;
  v_every numeric;
  v_wind numeric;
  v_kind text;
  v_tries text;
  v_run int := 0;
  v_series boolean := false;
  v_best numeric;
  v_best_wind numeric;
  v_legal numeric;
  v_legal_wind numeric;
  v_legal_out jsonb;
begin
  if p_detail is null or jsonb_typeof(p_detail) = 'null' then
    return jsonb_build_object('detail', null, 'series', false, 'mark', p_mark, 'wind', null, 'legal', null);
  end if;
  if jsonb_typeof(p_detail) <> 'object' then
    raise exception 'The detail of a result is not readable.' using errcode = '23514';
  end if;

  -- Splits: running times, each later than the one before, none after the finish.
  if p_unit = 's' and jsonb_typeof(p_detail -> 'splits') = 'object' and jsonb_typeof(p_detail #> '{splits,times}') = 'array' then
    v_list := p_detail #> '{splits,times}';
    if jsonb_array_length(v_list) > 40 then
      raise exception 'A result can hold 40 splits at most.' using errcode = '23514';
    end if;
    v_built := '[]'::jsonb;
    v_prev := null;
    for v_item in select t.value from jsonb_array_elements(v_list) with ordinality as t(value, n) order by t.n
    loop
      if jsonb_typeof(v_item) <> 'number' then
        raise exception 'Every split must be a time.' using errcode = '23514';
      end if;
      v_value := round((v_item #>> '{}')::numeric, 2);
      if v_value <= 0 then
        raise exception 'Every split must be more than 0.' using errcode = '23514';
      end if;
      if v_prev is not null and v_value <= v_prev then
        raise exception 'Each split must be later than the one before it.' using errcode = '23514';
      end if;
      if p_mark is not null and v_value > p_mark then
        raise exception 'A split cannot be larger than the final time.' using errcode = '23514';
      end if;
      -- A last split equal to the final time is the finish itself, which is the mark.
      if p_mark is null or v_value < p_mark then
        v_built := v_built || to_jsonb(v_value);
      end if;
      v_prev := v_value;
    end loop;
    v_every := null;
    if jsonb_typeof(p_detail #> '{splits,every}') = 'number' then
      v_every := (p_detail #>> '{splits,every}')::numeric;
      if v_every <> trunc(v_every) or v_every < 10 or v_every > 10000 then
        raise exception 'The distance between splits is a whole number of metres, like 200.' using errcode = '23514';
      end if;
    end if;
    if jsonb_array_length(v_built) > 0 then
      v_out := v_out || jsonb_build_object('splits', jsonb_build_object('every', v_every::int, 'times', v_built));
    end if;
  end if;

  -- Reaction time.
  if p_unit = 's' and p_detail ? 'reaction' and jsonb_typeof(p_detail -> 'reaction') <> 'null' then
    if jsonb_typeof(p_detail -> 'reaction') <> 'number' then
      raise exception 'A reaction time is a number of seconds, like 0.152.' using errcode = '23514';
    end if;
    v_value := round((p_detail ->> 'reaction')::numeric, 3);
    if v_value <= 0 or v_value >= 1 then
      raise exception 'A reaction time is under one second, like 0.152.' using errcode = '23514';
    end if;
    v_out := v_out || jsonb_build_object('reaction', v_value);
  end if;

  -- Attempt series of a horizontal jump or a throw: up to six, each a mark, a foul or a pass.
  if p_unit = 'm' and not v_vertical and jsonb_typeof(p_detail -> 'attempts') = 'array' and jsonb_array_length(p_detail -> 'attempts') > 0 then
    v_list := p_detail -> 'attempts';
    if jsonb_array_length(v_list) > 6 then
      raise exception 'A series has six attempts at most.' using errcode = '23514';
    end if;
    v_built := '[]'::jsonb;
    for v_item in select t.value from jsonb_array_elements(v_list) with ordinality as t(value, n) order by t.n
    loop
      v_kind := case when jsonb_typeof(v_item) = 'object' then v_item ->> 'result' end;
      if v_kind = 'foul' or v_kind = 'pass' then
        v_built := v_built || jsonb_build_object('result', v_kind);
      elsif v_kind = 'mark' and jsonb_typeof(v_item -> 'mark') = 'number' then
        v_value := round((v_item ->> 'mark')::numeric, 2);
        if v_value <= 0 or v_value >= 1000 then
          raise exception 'Every measured attempt needs a distance in metres, like 6.42.' using errcode = '23514';
        end if;
        v_wind := null;
        if coalesce(p_wind_applies, false) and jsonb_typeof(v_item -> 'wind') = 'number' then
          v_wind := round((v_item ->> 'wind')::numeric, 1);
          if v_wind < -9.9 or v_wind > 9.9 then
            raise exception 'Wind must be between -9.9 and +9.9.' using errcode = '23514';
          end if;
        end if;
        v_built := v_built || case
          when v_wind is null then jsonb_build_object('result', 'mark', 'mark', v_value)
          else jsonb_build_object('result', 'mark', 'mark', v_value, 'wind', v_wind)
        end;
        -- The best attempt: the longest; of two equal ones, a wind legal one, then the earlier.
        if v_best is null or v_value > v_best
           or (v_value = v_best and coalesce(v_best_wind, 0) > 2.0 and coalesce(v_wind, 0) <= 2.0) then
          v_best := v_value;
          v_best_wind := v_wind;
        end if;
        if coalesce(v_wind, 0) <= 2.0 and (v_legal is null or v_value > v_legal) then
          v_legal := v_value;
          v_legal_wind := v_wind;
        end if;
      else
        raise exception 'An attempt is a distance, a foul (X) or a pass (-).' using errcode = '23514';
      end if;
    end loop;
    if v_best is null then
      raise exception 'A series needs at least one measured attempt. With only fouls and passes there is no mark to save.' using errcode = '23514';
    end if;
    v_series := true;
    if coalesce(v_best_wind, 0) > 2.0 and v_legal is not null then
      v_legal_out := jsonb_build_object('mark', v_legal, 'wind', v_legal_wind);
    end if;
    v_out := v_out || jsonb_build_object('attempts', v_built);
  end if;

  -- Heights of a vertical jump: O cleared, X failed, - passed. "XO" is over at the second try.
  if v_vertical and jsonb_typeof(p_detail -> 'heights') = 'array' and jsonb_array_length(p_detail -> 'heights') > 0 then
    v_list := p_detail -> 'heights';
    if jsonb_array_length(v_list) > 30 then
      raise exception 'A competition can hold 30 heights at most.' using errcode = '23514';
    end if;
    v_built := '[]'::jsonb;
    v_prev := null;
    v_best := null;
    for v_item in select t.value from jsonb_array_elements(v_list) with ordinality as t(value, n) order by t.n
    loop
      if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'height') <> 'number' then
        raise exception 'Every line needs a height in metres, like 1.85.' using errcode = '23514';
      end if;
      v_value := round((v_item ->> 'height')::numeric, 2);
      v_tries := upper(btrim(coalesce(v_item ->> 'tries', '')));
      if v_value <= 0 or v_value >= 10 then
        raise exception 'Every line needs a height in metres, like 1.85.' using errcode = '23514';
      end if;
      if v_tries !~ '^(O|XO|XXO|X|XX|XXX|-|X-|XX-)$' then
        raise exception 'Write the attempts at a height with O, X and -, like O, XO or XXX.' using errcode = '23514';
      end if;
      if v_prev is not null and v_value <= v_prev then
        raise exception 'Heights go up: each one must be higher than the one before.' using errcode = '23514';
      end if;
      if v_run >= 3 then
        raise exception 'After three failures in a row the competition is over, so no height can follow.' using errcode = '23514';
      end if;
      if right(v_tries, 1) = 'O' then
        v_run := 0;
        v_best := v_value;
      else
        v_run := v_run + (length(v_tries) - length(replace(v_tries, 'X', '')));
      end if;
      v_built := v_built || jsonb_build_object('height', v_value, 'tries', v_tries);
      v_prev := v_value;
    end loop;
    if v_best is null then
      raise exception 'No height was cleared, so there is no mark to save.' using errcode = '23514';
    end if;
    v_series := true;
    v_best_wind := null;
    v_out := v_out || jsonb_build_object('heights', v_built);
  end if;

  return jsonb_build_object(
    'detail', case when v_out = '{}'::jsonb then null else v_out end,
    'series', v_series,
    'mark', case when v_series then v_best else p_mark end,
    'wind', case when v_series then v_best_wind end,
    'legal', v_legal_out
  );
end;
$$;

revoke all on function public.apply_result_detail(jsonb, text, text, boolean, numeric) from public, anon;
grant execute on function public.apply_result_detail(jsonb, text, text, boolean, numeric) to authenticated, service_role;

-- Runs before athlete_results_normalise (triggers fire in name order), so the mark it computes
-- is rounded, written and ranked by the existing trigger like any other mark.
create or replace function public.athlete_results_apply_detail()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sync boolean := coalesce(current_setting('sktr.result_series_sync', true), '') = 'on';
  v_source text := case when tg_op = 'UPDATE' then old.source else new.source end;
  v_entry_id uuid := new.competition_entry_id;
  v_competition_id uuid := new.competition_id;
  v_event_key text := new.event_key;
  v_environment text := coalesce(new.environment, 'outdoor');
  v_event public.result_events%rowtype;
  v_applied jsonb;
begin
  -- The row that holds the legal attempt of a series belongs to the series. Only the trigger
  -- that maintains it may set what it says; anyone else's change to those columns is undone.
  if tg_op = 'UPDATE' then
    new.derived_from_result_id := old.derived_from_result_id;
    if old.derived_from_result_id is not null and not v_sync then
      new.mark_value := old.mark_value;
      new.wind := old.wind;
      new.timing := old.timing;
      new.result_date := old.result_date;
      new.event_key := old.event_key;
      new.event_label := old.event_label;
      new.mark_unit := old.mark_unit;
    end if;
  elsif not v_sync then
    new.derived_from_result_id := null;
  end if;

  if new.derived_from_result_id is not null then
    new.detail := null;
    new.place := null;
    new.lane := null;
    new.qualifier := null;
    return new;
  end if;

  -- Test week results and imported records are single marks.
  if v_source in ('test_week', 'imported') then
    new.detail := null;
    new.round := null;
    new.heat_number := null;
    new.lane := null;
    new.qualifier := null;
    return new;
  end if;

  if new.detail is null then
    return new;
  end if;

  -- The event and the setting the way athlete_results_normalise will decide them.
  if tg_op = 'UPDATE' and old.competition_entry_id is not null and new.competition_entry_id is not null then
    v_entry_id := old.competition_entry_id;
  end if;
  if v_entry_id is not null then
    select ce.event_key, ce.competition_id into v_event_key, v_competition_id
    from public.competition_entries ce
    where ce.id = v_entry_id;
  end if;
  if v_competition_id is not null then
    select c.environment into v_environment from public.competitions c where c.id = v_competition_id;
  end if;

  select e.* into v_event from public.result_events e where e.key = v_event_key;
  if not found then
    -- athlete_results_normalise says what is wrong with the event.
    return new;
  end if;

  v_applied := public.apply_result_detail(
    new.detail,
    v_event.key,
    coalesce(v_event.unit, new.mark_unit),
    v_event.wind_applies and coalesce(v_environment, 'outdoor') = 'outdoor',
    new.mark_value
  );

  new.detail := case when jsonb_typeof(v_applied -> 'detail') = 'object' then v_applied -> 'detail' end;
  if (v_applied ->> 'series')::boolean then
    new.mark_value := (v_applied ->> 'mark')::numeric;
    new.wind := (v_applied ->> 'wind')::numeric;
  end if;
  return new;
end;
$$;

drop trigger if exists athlete_results_detail on public.athlete_results;
create trigger athlete_results_detail
before insert or update on public.athlete_results
for each row
execute function public.athlete_results_apply_detail();

-- 3. The best wind legal attempt of a series, as its own row -------------------------------------

create or replace function public.athlete_results_sync_series_legal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_legal jsonb;
begin
  if new.derived_from_result_id is not null then
    return null;
  end if;

  if new.detail ? 'attempts' and not new.is_wind_legal then
    -- The detail is already canonical, so this only reads it. Wind is kept on the attempts only
    -- where it applies, which is why p_wind_applies can be true here.
    v_legal := public.apply_result_detail(new.detail, new.event_key, new.mark_unit, true, new.mark_value) -> 'legal';
    if jsonb_typeof(v_legal) <> 'object' then
      v_legal := null;
    end if;
  end if;

  if v_legal is null then
    delete from public.athlete_results r where r.derived_from_result_id = new.id;
    return null;
  end if;

  perform set_config('sktr.result_series_sync', 'on', true);
  insert into public.athlete_results (
    athlete_id, event_key, event_label, mark_unit, lower_is_better, mark_value, wind, result_date,
    source, competition_id, round, heat_number, environment, is_altitude, location,
    entered_by_user_id, derived_from_result_id
  )
  values (
    new.athlete_id, new.event_key, new.event_label, new.mark_unit, new.lower_is_better,
    (v_legal ->> 'mark')::numeric, (v_legal ->> 'wind')::numeric, new.result_date,
    -- A competition result whose competition was deleted keeps its place in the history as a mark set by hand.
    case when new.source = 'competition' and new.competition_id is null then 'manual' else new.source end,
    new.competition_id, new.round, new.heat_number, new.environment, new.is_altitude, new.location,
    new.entered_by_user_id, new.id
  )
  on conflict (derived_from_result_id) where derived_from_result_id is not null do update
  set event_key = excluded.event_key,
      event_label = excluded.event_label,
      mark_unit = excluded.mark_unit,
      mark_value = excluded.mark_value,
      wind = excluded.wind,
      result_date = excluded.result_date,
      competition_id = excluded.competition_id,
      round = excluded.round,
      heat_number = excluded.heat_number,
      environment = excluded.environment,
      is_altitude = excluded.is_altitude,
      location = excluded.location;
  perform set_config('sktr.result_series_sync', 'off', true);
  return null;
end;
$$;

drop trigger if exists athlete_results_series_legal_insert on public.athlete_results;
create trigger athlete_results_series_legal_insert
after insert on public.athlete_results
for each row
when (new.detail is not null and new.derived_from_result_id is null)
execute function public.athlete_results_sync_series_legal();

drop trigger if exists athlete_results_series_legal_update on public.athlete_results;
create trigger athlete_results_series_legal_update
after update on public.athlete_results
for each row
when ((old.detail is not null or new.detail is not null) and new.derived_from_result_id is null)
execute function public.athlete_results_sync_series_legal();

revoke all on function public.athlete_results_apply_detail() from public, anon, authenticated;
revoke all on function public.athlete_results_sync_series_legal() from public, anon, authenticated;

-- 4. Relays ----------------------------------------------------------------------------------------

create table if not exists public.relay_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- Results that were run stay in the team's record list when the competition is deleted.
  competition_id uuid references public.competitions(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  event_key text not null references public.result_events(key),
  event_label text not null check (char_length(event_label) between 1 and 80),
  -- What the relay team is called on the day: "Sprint Group A".
  team_label text not null check (char_length(btrim(team_label)) between 1 and 60),
  round text check (round is null or round in ('heat', 'quarter_final', 'semi_final', 'final', 'timed_final')),
  heat_number int check (heat_number is null or heat_number between 1 and 99),
  lane int check (lane is null or lane between 1 and 20),
  place int check (place is null or place between 1 and 999),
  qualifier text check (qualifier is null or qualifier in ('Q', 'q')),
  -- Null until the relay is run: the team is entered, there is no time yet.
  mark_value numeric(12, 3) check (mark_value is null or (mark_value > 0 and mark_value < 1000000)),
  compare_value numeric(12, 3),
  mark_display text,
  timing text check (timing is null or timing in ('electronic', 'hand')),
  result_date date not null,
  environment text not null default 'outdoor' check (environment in ('outdoor', 'indoor')),
  location text check (location is null or char_length(location) <= 160),
  notes text check (notes is null or char_length(notes) <= 1000),
  entered_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.relay_entries is
  'A relay team at a competition: event, team, round and, once it is run, the time. Its four legs are relay_entry_legs. Never copied to athlete_results, so a relay is nobody''s individual record.';

create index if not exists relay_entries_tenant_date_idx on public.relay_entries (tenant_id, result_date desc);
create index if not exists relay_entries_competition_idx on public.relay_entries (competition_id);
create index if not exists relay_entries_team_event_idx on public.relay_entries (team_id, event_key);

-- One result per relay team, event and round at a competition (the deciding round is one slot).
create unique index if not exists relay_entries_team_round_uniq
on public.relay_entries (
  competition_id,
  event_key,
  lower(btrim(team_label)),
  (case when round in ('heat', 'quarter_final', 'semi_final') then round else 'final' end)
)
where competition_id is not null;

create table if not exists public.relay_entry_legs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  relay_entry_id uuid not null references public.relay_entries(id) on delete cascade,
  leg_number int not null check (leg_number between 1 and 4),
  -- Null once the athlete's data was deleted: the leg stays, with nobody's name on it.
  athlete_id uuid references public.athletes(id) on delete set null,
  -- The time of this leg in seconds, when someone took it.
  split_value numeric(8, 2) check (split_value is null or (split_value > 0 and split_value < 100000)),
  created_at timestamptz not null default now(),
  unique (relay_entry_id, leg_number)
);

comment on table public.relay_entry_legs is
  'The four legs of a relay in running order. A delete of one leg (an athlete''s data being deleted) is turned into "no athlete" by trigger, so the relay keeps four legs.';

create unique index if not exists relay_entry_legs_athlete_uniq
on public.relay_entry_legs (relay_entry_id, athlete_id)
where athlete_id is not null;

create index if not exists relay_entry_legs_athlete_idx on public.relay_entry_legs (athlete_id);
create index if not exists relay_entry_legs_tenant_idx on public.relay_entry_legs (tenant_id);

-- 4a. Row triggers ---------------------------------------------------------------------------------

create or replace function public.relay_entries_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.result_events%rowtype;
  v_competition public.competitions%rowtype;
begin
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
    new.created_at := old.created_at;
    -- A relay stays at its competition. The link can only be lost (the competition was deleted).
    if new.competition_id is not null then
      new.competition_id := old.competition_id;
    end if;
  end if;

  select e.* into v_event from public.result_events e where e.key = new.event_key;
  if not found or v_event.category <> 'Relays' then
    raise exception 'Choose a relay event.' using errcode = '23514';
  end if;
  new.event_label := v_event.name;

  if new.competition_id is not null then
    select c.* into v_competition from public.competitions c where c.id = new.competition_id;
    if not found then
      raise exception 'This competition does not exist.' using errcode = '23503';
    end if;
    if tg_op = 'INSERT' then
      new.tenant_id := v_competition.tenant_id;
    elsif v_competition.tenant_id <> new.tenant_id then
      raise exception 'This competition does not exist.' using errcode = '23503';
    end if;
    new.result_date := coalesce(new.result_date, v_competition.start_date);
    if new.result_date < v_competition.start_date or new.result_date > v_competition.end_date then
      raise exception 'The date of a relay must be on a day of the competition.' using errcode = '23514';
    end if;
    new.environment := v_competition.environment;
    new.location := coalesce(nullif(btrim(coalesce(new.location, '')), ''), v_competition.name);
  elsif tg_op = 'INSERT' then
    raise exception 'A relay needs its competition.' using errcode = '23514';
  end if;

  if new.team_id is not null and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id) and not exists (
    select 1 from public.teams t where t.id = new.team_id and t.tenant_id = new.tenant_id
  ) then
    raise exception 'Choose a team of this club for the relay.' using errcode = '23514';
  end if;

  new.team_label := btrim(regexp_replace(coalesce(new.team_label, ''), '\s+', ' ', 'g'));
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.location := nullif(btrim(coalesce(new.location, '')), '');

  if new.mark_value is null then
    new.timing := null;
    new.compare_value := null;
    new.mark_display := null;
    new.place := null;
    new.qualifier := null;
  else
    if new.result_date > current_date + 1 then
      raise exception 'A relay time cannot be dated in the future.' using errcode = '23514';
    end if;
    new.mark_value := round(new.mark_value, 2);
    new.timing := coalesce(new.timing, 'electronic');
    new.compare_value := new.mark_value + case when new.timing = 'hand' then v_event.hand_time_adjust else 0 end;
    new.mark_display := public.format_result_mark(new.mark_value, 's', new.timing);
  end if;

  new.updated_at := now();
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.entered_by_user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists relay_entries_normalise on public.relay_entries;
create trigger relay_entries_normalise
before insert or update on public.relay_entries
for each row
execute function public.relay_entries_normalise();

create or replace function public.relay_entry_legs_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  select r.tenant_id into v_tenant_id from public.relay_entries r where r.id = new.relay_entry_id;
  if not found then
    raise exception 'This relay does not exist.' using errcode = '23503';
  end if;
  new.tenant_id := v_tenant_id;
  if tg_op = 'UPDATE' then
    new.relay_entry_id := old.relay_entry_id;
    new.leg_number := old.leg_number;
    new.created_at := old.created_at;
  end if;
  if new.athlete_id is not null and not exists (
    select 1 from public.athletes a where a.id = new.athlete_id and a.tenant_id = v_tenant_id
  ) then
    raise exception 'Every leg must be run by an athlete of this club.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists relay_entry_legs_normalise on public.relay_entry_legs;
create trigger relay_entry_legs_normalise
before insert or update on public.relay_entry_legs
for each row
execute function public.relay_entry_legs_normalise();

-- A relay always has its legs. Deleting ONE leg only happens when an athlete's data is deleted
-- (the catalogue sweep of athlete_id): the leg is kept and loses its athlete. When the relay
-- itself is going (it is no longer there for this trigger to see), the leg goes with it.
create or replace function public.relay_entry_legs_keep_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.relay_entries r where r.id = old.relay_entry_id) then
    update public.relay_entry_legs l set athlete_id = null where l.id = old.id and l.athlete_id is not null;
    return null;
  end if;
  return old;
end;
$$;

drop trigger if exists relay_entry_legs_keep_on_delete on public.relay_entry_legs;
create trigger relay_entry_legs_keep_on_delete
before delete on public.relay_entry_legs
for each row
execute function public.relay_entry_legs_keep_on_delete();

-- A relay team that was entered but never ran goes with its competition. One that has a time
-- stays (competition_id becomes null) for the team's record list.
create or replace function public.competitions_drop_unrun_relays()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.relay_entries r where r.competition_id = old.id and r.mark_value is null;
  return old;
end;
$$;

drop trigger if exists competitions_drop_unrun_relays on public.competitions;
create trigger competitions_drop_unrun_relays
before delete on public.competitions
for each row
execute function public.competitions_drop_unrun_relays();

revoke all on function public.relay_entries_normalise() from public, anon, authenticated;
revoke all on function public.relay_entry_legs_normalise() from public, anon, authenticated;
revoke all on function public.relay_entry_legs_keep_on_delete() from public, anon, authenticated;
revoke all on function public.competitions_drop_unrun_relays() from public, anon, authenticated;

-- 4b. Access helpers -------------------------------------------------------------------------------
-- They read the tables directly (security definer), so the policies of the two tables never call
-- one another.

-- The relays the signed-in athlete ran a leg of. Empty for everyone else.
create or replace function public.current_athlete_relay_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct l.relay_entry_id), '{}'::uuid[])
  from public.relay_entry_legs l
  where l.athlete_id = public.current_athlete_id()
$$;

-- Staff: a club admin sees every relay of the club. A coach (assistants included, as for results)
-- sees the relays of a team they are on and the relays an athlete of their teams ran in.
create or replace function public.staff_can_view_relay(p_relay_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.relay_entries r
    where r.id = p_relay_entry_id
      and r.tenant_id = public.current_tenant_id()
      and (
        public.is_club_admin()
        or (r.team_id is not null and r.team_id = any (public.current_staff_team_ids()))
        or exists (
          select 1
          from public.relay_entry_legs l
          where l.relay_entry_id = r.id
            and l.athlete_id = any (public.current_staff_athlete_ids())
        )
      )
  )
$$;

-- Writing is stricter: a club admin, or a lead coach or coach of the relay's team. Not assistants.
create or replace function public.staff_can_manage_relay(p_relay_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.relay_entries r
    where r.id = p_relay_entry_id
      and r.tenant_id = public.current_tenant_id()
      and (
        public.is_club_admin()
        or (r.team_id is not null and r.team_id = any (public.current_coach_team_ids()))
      )
  )
$$;

revoke all on function public.current_athlete_relay_ids() from public, anon;
revoke all on function public.staff_can_view_relay(uuid) from public, anon;
revoke all on function public.staff_can_manage_relay(uuid) from public, anon;
grant execute on function public.current_athlete_relay_ids() to authenticated, service_role;
grant execute on function public.staff_can_view_relay(uuid) to authenticated, service_role;
grant execute on function public.staff_can_manage_relay(uuid) to authenticated, service_role;

-- An athlete who runs a relay at a competition sees that competition, like one they are entered
-- in. Same function as 20261008100000 with the relay legs added.
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
    union
    select r.competition_id
    from me
    join public.relay_entry_legs l
      on l.athlete_id = me.id
     and l.tenant_id = me.tenant_id
    join public.relay_entries r
      on r.id = l.relay_entry_id
    where r.competition_id is not null
  )
  select coalesce(array_agg(visible.id), '{}'::uuid[])
  from visible
$$;

-- 4c. Row level security ---------------------------------------------------------------------------
-- Reads go through policies. Inserts and updates only happen inside save_relay_entry(), so there
-- is no insert or update policy and no grant for them.

alter table public.relay_entries enable row level security;
alter table public.relay_entry_legs enable row level security;

revoke all on public.relay_entries from anon, authenticated;
revoke all on public.relay_entry_legs from anon, authenticated;
grant select, delete on public.relay_entries to authenticated;
grant select on public.relay_entry_legs to authenticated;
grant select, insert, update, delete on public.relay_entries to service_role;
grant select, insert, update, delete on public.relay_entry_legs to service_role;

drop policy if exists relay_entries_select_scope on public.relay_entries;
create policy relay_entries_select_scope
on public.relay_entries
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    id = any ((select public.current_athlete_relay_ids())::uuid[])
    or (select public.is_club_admin())
    or public.staff_can_view_relay(id)
  )
);

drop policy if exists relay_entries_delete_staff on public.relay_entries;
create policy relay_entries_delete_staff
on public.relay_entries
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or (team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
  )
);

drop policy if exists relay_entry_legs_select_scope on public.relay_entry_legs;
create policy relay_entry_legs_select_scope
on public.relay_entry_legs
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    relay_entry_id = any ((select public.current_athlete_relay_ids())::uuid[])
    or (select public.is_club_admin())
    or public.staff_can_view_relay(relay_entry_id)
  )
);

-- 4d. Saving a relay -------------------------------------------------------------------------------
-- One call, one transaction: the entry and its four legs.
--   p_relay = {
--     "id": null | uuid,                       null adds a relay
--     "competition_id": uuid,                  needed to add
--     "event_key": "4x100m",
--     "team_id": uuid, "team_label": "Sprint Group A",
--     "legs": [ { "leg": 1, "athlete_id": uuid, "split": 10.9 | null }, ... four of them ],
--     "mark": 43.12 | null, "timing": "electronic" | "hand" | null,
--     "round": ..., "heat_number": ..., "lane": ..., "place": ..., "qualifier": ...,
--     "result_date": "2026-10-10" | null, "notes": text | null
--   }
-- Returns the relay's id.
create or replace function public.save_relay_entry(p_relay jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_admin boolean;
  v_id uuid := nullif(p_relay ->> 'id', '')::uuid;
  v_existing public.relay_entries%rowtype;
  v_competition_id uuid := nullif(p_relay ->> 'competition_id', '')::uuid;
  v_team_id uuid := nullif(p_relay ->> 'team_id', '')::uuid;
  v_team_name text;
  v_label text;
  v_mark numeric := nullif(p_relay ->> 'mark', '')::numeric;
  v_legs jsonb := p_relay -> 'legs';
  v_leg jsonb;
  v_leg_number int;
  v_athlete_id uuid;
  v_split numeric;
  v_seen_legs int[] := '{}';
  v_seen_athletes uuid[] := '{}';
  v_split_sum numeric := 0;
  v_split_count int := 0;
  v_old_athlete_id uuid;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_tenant_id := public.current_tenant_id();
  v_admin := public.is_club_admin();
  if v_tenant_id is null or not public.is_coach_or_admin() then
    raise exception 'Only a coach or a club admin can enter a relay.' using errcode = '42501';
  end if;

  if v_id is not null then
    select r.* into v_existing from public.relay_entries r where r.id = v_id and r.tenant_id = v_tenant_id for update;
    if not found or not public.staff_can_manage_relay(v_id) then
      -- The same answer for "does not exist", "another club" and "not your team".
      raise exception 'You cannot change this relay.' using errcode = '42501';
    end if;
    v_competition_id := v_existing.competition_id;
    v_team_id := coalesce(v_team_id, v_existing.team_id);
  else
    if v_competition_id is null or not exists (
      select 1 from public.competitions c where c.id = v_competition_id and c.tenant_id = v_tenant_id
    ) or not public.staff_can_view_competition(v_competition_id) then
      raise exception 'This competition is not on your calendar.' using errcode = '42501';
    end if;
  end if;

  if v_team_id is null then
    raise exception 'Choose the team the relay runs for.' using errcode = '23514';
  end if;
  select t.name into v_team_name from public.teams t where t.id = v_team_id and t.tenant_id = v_tenant_id;
  if not found then
    raise exception 'Choose a team of this club for the relay.' using errcode = '23514';
  end if;
  if not v_admin and not (v_team_id = any (public.current_coach_team_ids())) then
    raise exception 'You can only enter a relay for a team you coach.' using errcode = '42501';
  end if;

  v_label := btrim(regexp_replace(coalesce(p_relay ->> 'team_label', ''), '\s+', ' ', 'g'));
  if v_label = '' then
    v_label := v_team_name;
  end if;
  if char_length(v_label) > 60 then
    raise exception 'Keep the relay team''s name to 60 characters.' using errcode = '23514';
  end if;

  if v_mark is not null and v_mark <= 0 then
    raise exception 'The time must be more than 0.' using errcode = '23514';
  end if;

  -- The four legs.
  if jsonb_typeof(v_legs) <> 'array' or jsonb_array_length(v_legs) <> 4 then
    raise exception 'A relay has four legs. Choose an athlete for each.' using errcode = '23514';
  end if;
  for v_leg in select t.value from jsonb_array_elements(v_legs) as t(value)
  loop
    v_leg_number := (v_leg ->> 'leg')::int;
    v_athlete_id := nullif(v_leg ->> 'athlete_id', '')::uuid;
    v_split := nullif(v_leg ->> 'split', '')::numeric;
    if v_leg_number is null or v_leg_number < 1 or v_leg_number > 4 or v_leg_number = any (v_seen_legs) then
      raise exception 'A relay has four legs, numbered 1 to 4.' using errcode = '23514';
    end if;
    v_seen_legs := v_seen_legs || v_leg_number;

    v_old_athlete_id := null;
    if v_id is not null then
      select l.athlete_id into v_old_athlete_id
      from public.relay_entry_legs l
      where l.relay_entry_id = v_id and l.leg_number = v_leg_number;
    end if;

    if v_athlete_id is null then
      -- Only a leg whose athlete was deleted may stay without one.
      if v_id is null or v_old_athlete_id is not null or not exists (
        select 1 from public.relay_entry_legs l where l.relay_entry_id = v_id and l.leg_number = v_leg_number
      ) then
        raise exception 'Choose an athlete for leg %.', v_leg_number using errcode = '23514';
      end if;
    else
      if v_athlete_id = any (v_seen_athletes) then
        raise exception 'An athlete can run one leg of a relay. Choose four different athletes.' using errcode = '23514';
      end if;
      v_seen_athletes := v_seen_athletes || v_athlete_id;
      if not exists (select 1 from public.athletes a where a.id = v_athlete_id and a.tenant_id = v_tenant_id) then
        raise exception 'Every leg must be run by an athlete of this club.' using errcode = '23514';
      end if;
      -- A coach names athletes they coach. A leg that was already there may stay as it is.
      if not v_admin
         and v_athlete_id is distinct from v_old_athlete_id
         and not (v_athlete_id = any (public.current_coach_athlete_ids())) then
        raise exception 'You can only name athletes you coach in a relay.' using errcode = '42501';
      end if;
    end if;

    if v_split is not null then
      if v_split <= 0 then
        raise exception 'A leg split must be more than 0.' using errcode = '23514';
      end if;
      if v_mark is not null and v_split >= v_mark then
        raise exception 'The split of leg % is larger than the relay''s time.', v_leg_number using errcode = '23514';
      end if;
      v_split_sum := v_split_sum + round(v_split, 2);
      v_split_count := v_split_count + 1;
    end if;
  end loop;

  if v_mark is not null and v_split_count > 0 and v_split_sum > v_mark + 1 then
    raise exception 'The leg splits add up to more than the relay''s time. Check the splits or the time.' using errcode = '23514';
  end if;
  if v_mark is not null and v_split_count = 4 and abs(v_split_sum - v_mark) > 1 then
    raise exception 'The four leg splits do not add up to the relay''s time. Check the splits or the time.' using errcode = '23514';
  end if;

  begin
    if v_id is null then
      insert into public.relay_entries (
        tenant_id, competition_id, team_id, event_key, event_label, team_label, round, heat_number, lane,
        place, qualifier, mark_value, timing, result_date, notes
      )
      values (
        v_tenant_id, v_competition_id, v_team_id, p_relay ->> 'event_key', 'relay', v_label,
        nullif(p_relay ->> 'round', ''), nullif(p_relay ->> 'heat_number', '')::int, nullif(p_relay ->> 'lane', '')::int,
        nullif(p_relay ->> 'place', '')::int, nullif(p_relay ->> 'qualifier', ''), v_mark, nullif(p_relay ->> 'timing', ''),
        nullif(p_relay ->> 'result_date', '')::date, p_relay ->> 'notes'
      )
      returning id into v_id;
    else
      update public.relay_entries r
      set team_id = v_team_id,
          event_key = coalesce(nullif(p_relay ->> 'event_key', ''), r.event_key),
          team_label = v_label,
          round = nullif(p_relay ->> 'round', ''),
          heat_number = nullif(p_relay ->> 'heat_number', '')::int,
          lane = nullif(p_relay ->> 'lane', '')::int,
          place = nullif(p_relay ->> 'place', '')::int,
          qualifier = nullif(p_relay ->> 'qualifier', ''),
          mark_value = v_mark,
          timing = nullif(p_relay ->> 'timing', ''),
          result_date = coalesce(nullif(p_relay ->> 'result_date', '')::date, r.result_date),
          notes = p_relay ->> 'notes'
      where r.id = v_id;
    end if;
  exception when unique_violation then
    raise exception 'This relay team already has a result for that round. Change that one instead of adding another.' using errcode = '23505';
  end;

  -- Legs: written in two steps so two athletes can swap legs without tripping the "one leg per athlete" rule.
  update public.relay_entry_legs l set athlete_id = null
  where l.relay_entry_id = v_id
    and l.athlete_id is not null
    and l.athlete_id is distinct from (
      select nullif(x.value ->> 'athlete_id', '')::uuid
      from jsonb_array_elements(v_legs) as x(value)
      where (x.value ->> 'leg')::int = l.leg_number
    );
  for v_leg in select t.value from jsonb_array_elements(v_legs) as t(value)
  loop
    insert into public.relay_entry_legs (tenant_id, relay_entry_id, leg_number, athlete_id, split_value)
    values (v_tenant_id, v_id, (v_leg ->> 'leg')::int, nullif(v_leg ->> 'athlete_id', '')::uuid, round(nullif(v_leg ->> 'split', '')::numeric, 2))
    on conflict (relay_entry_id, leg_number) do update
    set athlete_id = excluded.athlete_id,
        split_value = excluded.split_value;
  end loop;

  return v_id;
end;
$$;

revoke all on function public.save_relay_entry(jsonb) from public, anon;
grant execute on function public.save_relay_entry(jsonb) to authenticated, service_role;

-- 4e. Reading relays, with leg names ---------------------------------------------------------------
-- An athlete cannot read other athletes' records, so the names of the legs come from here. The
-- caller gets a relay only when the policies above would show it to them: an athlete their own
-- relays, staff the relays of their teams and athletes, a club admin the club's.
--   p_competition_id   keep one competition
--   p_athlete_id       keep the relays this athlete ran in
-- Newest first, 500 at most. A leg with no athlete is "Former member".
create or replace function public.get_relay_entries(p_competition_id uuid default null, p_athlete_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_mine uuid[];
  v_admin boolean;
  v_out jsonb;
begin
  perform public.assert_caller_active();

  v_tenant_id := public.current_tenant_id();
  if auth.uid() is null or v_tenant_id is null then
    return '[]'::jsonb;
  end if;
  v_mine := public.current_athlete_relay_ids();
  v_admin := public.is_club_admin();

  select coalesce(jsonb_agg(x.entry order by x.result_date desc, x.created_at desc), '[]'::jsonb)
  into v_out
  from (
    select
      r.result_date,
      r.created_at,
      jsonb_build_object(
        'id', r.id,
        'competition_id', r.competition_id,
        'competition_name', c.name,
        'team_id', r.team_id,
        'team_name', t.name,
        'team_label', r.team_label,
        'event_key', r.event_key,
        'event_label', r.event_label,
        'round', r.round,
        'heat_number', r.heat_number,
        'lane', r.lane,
        'place', r.place,
        'qualifier', r.qualifier,
        'mark_value', r.mark_value,
        'compare_value', r.compare_value,
        'mark_display', r.mark_display,
        'timing', r.timing,
        'result_date', r.result_date,
        'environment', r.environment,
        'location', r.location,
        'notes', r.notes,
        'created_at', r.created_at,
        'can_manage', v_admin or (r.team_id is not null and r.team_id = any (public.current_coach_team_ids())),
        'legs', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'leg', l.leg_number,
              'athlete_id', l.athlete_id,
              'name', case
                when l.athlete_id is null then 'Former member'
                else coalesce(nullif(btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), ''), 'Unnamed athlete')
              end,
              'split', l.split_value
            )
            order by l.leg_number
          )
          from public.relay_entry_legs l
          left join public.athletes a on a.id = l.athlete_id
          where l.relay_entry_id = r.id
        ), '[]'::jsonb)
      ) as entry
    from public.relay_entries r
    left join public.competitions c on c.id = r.competition_id
    left join public.teams t on t.id = r.team_id
    where r.tenant_id = v_tenant_id
      and (p_competition_id is null or r.competition_id = p_competition_id)
      and (p_athlete_id is null or exists (
        select 1 from public.relay_entry_legs l where l.relay_entry_id = r.id and l.athlete_id = p_athlete_id
      ))
      and (r.id = any (v_mine) or v_admin or public.staff_can_view_relay(r.id))
    order by r.result_date desc, r.created_at desc
    limit 500
  ) x;

  return v_out;
end;
$$;

revoke all on function public.get_relay_entries(uuid, uuid) from public, anon;
grant execute on function public.get_relay_entries(uuid, uuid) to authenticated, service_role;

-- 4f. Relay records per team -----------------------------------------------------------------------
-- The best time of each team in each relay event. Runs with the reader's row access.
create or replace view public.relay_team_bests
with (security_invoker = true)
as
select distinct on (r.tenant_id, r.team_id, r.event_key)
  r.tenant_id,
  r.team_id,
  r.event_key,
  r.event_label,
  r.id as relay_entry_id,
  r.team_label,
  r.mark_value,
  r.compare_value,
  r.mark_display,
  r.timing,
  r.result_date,
  r.competition_id,
  r.location
from public.relay_entries r
where r.mark_value is not null
  and r.team_id is not null
order by r.tenant_id, r.team_id, r.event_key, r.compare_value, r.result_date, r.created_at, r.id;

revoke all on public.relay_team_bests from anon;
grant select on public.relay_team_bests to authenticated, service_role;

-- 5. Deleted accounts ------------------------------------------------------------------------------
-- relay_entries.entered_by_user_id points at auth.users with "on delete set null" (20261014120000).
do $$ begin perform public.install_deleted_account_triggers(); end $$;

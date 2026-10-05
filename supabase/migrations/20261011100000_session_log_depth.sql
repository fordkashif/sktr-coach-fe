-- SKTR Coach: session log depth
-- Created: 2026-10-11
--
-- The athlete log now saves the effort of each set and a note per exercise, and shows what the
-- athlete did the last time for the same exercise, set by set.
--
-- 1. session_row_logs.rpe (per set effort, 1 to 10) and session_row_logs.note already exist
--    (20261005090000) but the app never wrote them. They are added here "if not exists" so this
--    file also stands on a database where they are missing, and the note gets a length limit.
--    The note of an exercise is kept on its lowest numbered set.
-- 2. exercise_match_key(): how an exercise is matched between sessions. Session rows carry no
--    stable exercise id, so the name is used with case, punctuation and extra spaces ignored.
--    The app twin is exerciseMatchKey() in src/lib/data/session/log-assist.ts.
-- 3. get_my_last_exercise_logs(): for every exercise asked for, the sets of the athlete's most
--    recent completed session holding that exercise, with per set effort, the exercise note and
--    the effort given to that whole session. One call for the whole screen.
--
-- No new table, so no new policies: the function runs as the caller and the existing row policies
-- on session_row_logs decide what is visible (own rows for an athlete, athletes of their teams
-- for a coach, the tenant for a club admin, nothing across tenants).
--
-- Idempotent and additive. Nothing is dropped, no data is changed.

-- 1. Columns ------------------------------------------------------------------------------------

alter table public.session_row_logs
  add column if not exists rpe smallint;

alter table public.session_row_logs
  add column if not exists note text;

comment on column public.session_row_logs.rpe is
  'How hard this one set was, 1 (very easy) to 10 (max effort). Null when the athlete did not rate it.';
comment on column public.session_row_logs.note is
  'The athlete''s note for the exercise. The app keeps it on the lowest numbered set of the row.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'session_row_logs_rpe_range' and conrelid = 'public.session_row_logs'::regclass
  ) and not exists (
    -- the inline check from 20261005090000 already covers it
    select 1 from pg_constraint c
    where c.conrelid = 'public.session_row_logs'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%rpe%'
  ) then
    alter table public.session_row_logs
      add constraint session_row_logs_rpe_range
      check (rpe is null or (rpe >= 1 and rpe <= 10)) not valid;
  end if;

  -- "not valid": existing rows are not checked (none has a note, the app never wrote one).
  if not exists (
    select 1 from pg_constraint
    where conname = 'session_row_logs_note_length' and conrelid = 'public.session_row_logs'::regclass
  ) then
    alter table public.session_row_logs
      add constraint session_row_logs_note_length
      check (note is null or char_length(note) <= 500) not valid;
  end if;
end
$$;

-- 2. Matching an exercise by name -----------------------------------------------------------------

create or replace function public.exercise_match_key(p_label text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select btrim(regexp_replace(lower(coalesce(p_label, '')), '[^[:alnum:]]+', ' ', 'g'))
$$;

revoke all on function public.exercise_match_key(text) from public, anon;
grant execute on function public.exercise_match_key(text) to authenticated, service_role;

-- 3. "Last time", set by set --------------------------------------------------------------------
-- Runs as the caller (security invoker), so row level security applies to every table it reads.
-- It also filters on current_athlete_id(), so a coach or admin calling it gets nothing back:
-- it is the signed-in athlete's own history only.
create or replace function public.get_my_last_exercise_logs(
  p_labels text[],
  p_before date default current_date,
  p_exclude_session_id uuid default null
)
returns table (
  label_key text,
  session_id uuid,
  session_date date,
  session_rpe smallint,
  log_kind text,
  block_type text,
  set_index int,
  reps numeric,
  load_kg numeric,
  time_seconds numeric,
  distance_m numeric,
  mark numeric,
  rpe smallint,
  note text
)
language sql
stable
set search_path = public
as $$
  with wanted as (
    select distinct public.exercise_match_key(x) as label_key
    from unnest(coalesce(p_labels, '{}'::text[])) as x
    where public.exercise_match_key(x) <> ''
  ),
  mine as (
    select
      public.exercise_match_key(r.label) as label_key,
      s.id as session_id,
      s.scheduled_for,
      r.id as row_id,
      r.sort_order as row_order,
      sb.sort_order as block_order,
      r.log_kind,
      sb.block_type,
      l.set_index,
      l.reps,
      l.load_kg,
      l.time_seconds,
      l.distance_m,
      l.mark,
      l.rpe,
      l.note
    from public.session_row_logs l
    join public.session_block_rows r on r.id = l.session_block_row_id
    join public.session_blocks sb on sb.id = r.session_block_id
    join public.sessions s on s.id = l.session_id
    where l.athlete_id = public.current_athlete_id()
      and s.athlete_id = l.athlete_id
      and l.completed
      and s.status = 'completed'
      and s.scheduled_for <= coalesce(p_before, current_date)
      and (p_exclude_session_id is null or s.id <> p_exclude_session_id)
      and public.exercise_match_key(r.label) in (select w.label_key from wanted w)
  ),
  -- The newest session per exercise, and inside it one row (a session can name an exercise twice).
  latest as (
    select distinct on (m.label_key) m.label_key, m.session_id, m.row_id
    from mine m
    order by m.label_key, m.scheduled_for desc, m.session_id, m.block_order, m.row_order, m.row_id
  )
  select
    m.label_key,
    m.session_id,
    m.scheduled_for,
    (
      select c.rpe
      from public.session_completions c
      where c.session_id = m.session_id
      limit 1
    ) as session_rpe,
    m.log_kind,
    m.block_type,
    m.set_index,
    m.reps,
    m.load_kg,
    m.time_seconds,
    m.distance_m,
    m.mark,
    m.rpe,
    m.note
  from mine m
  join latest t on t.label_key = m.label_key and t.session_id = m.session_id and t.row_id = m.row_id
  order by m.label_key, m.set_index
$$;

revoke all on function public.get_my_last_exercise_logs(text[], date, uuid) from public, anon;
grant execute on function public.get_my_last_exercise_logs(text[], date, uuid) to authenticated;

-- SKTR Coach: exercise library, loads as a percentage of a best lift, per athlete loads
-- Created: 2026-10-11
--
-- 1. exercise_library: the saved exercises of a club, shared by its coaches (name, category,
--    what it is measured in, a coaching cue, a link to a video or reference page, archived flag).
--    Athletes never read this table: the cue and the link are copied onto the session rows that
--    are made for them, so a later edit or archive in the library never changes a session.
-- 2. athlete_lift_maxes: an athlete's best single lift (1RM) per lift, one current row per
--    athlete and lift. Entered by a coach of the athlete's team, a club admin or the athlete.
--    When no row exists, the best kilogram result in athlete_results with the same lift name
--    is used (test week results land there), so most clubs start with usable numbers.
-- 3. session_block_rows gets the pieces of a percentage prescription (percent_1rm, lift_name,
--    target_volume), the coaching cue and the reference link. A trigger turns the percentage
--    into kilograms for the athlete the session belongs to (rounded to the nearest 2.5 kg) and
--    writes it into the columns the athlete screens already read (target, target_load, helper).
--    When a best lift is added or corrected, the athlete's sessions that are not finished are
--    worked out again.
--
-- Per athlete changes to a plan row ("except David: 70%") live in training_plans.builder_state
-- and are applied by the app when the athlete's session rows are written, so they need no table.
--
-- Idempotent and additive: create table/index if not exists, add column if not exists,
-- create or replace function, drop policy/trigger if exists before create. No data is changed.

-- 1. Lift names ---------------------------------------------------------------------------

-- How lift names are matched: lower case, no punctuation, no "1RM" or "max" wording, single
-- spaces. "Back Squat", "back squat 1RM" and "Back squat (1 rep max)" are one lift.
-- The app has the same rule in src/lib/data/exercises/loads.ts (liftKey).
create or replace function public.lift_key(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
    btrim(
      regexp_replace(
        regexp_replace(lower(coalesce(p_name, '')), '\m(1\s*rm|one\s*rep\s*max|1\s*rep\s*max|rep\s*max|max)\M', ' ', 'g'),
        '[^a-z0-9]+', ' ', 'g'
      )
    ),
    '\s+', ' ', 'g'
  )
$$;

-- "120", "122.5", "82.5": a number without trailing zeros.
create or replace function public.format_load_number(p_value numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select rtrim(rtrim(to_char(round(p_value, 2), 'FM9999990.00'), '0'), '.')
$$;

-- 2. Exercise library ---------------------------------------------------------------------

create table if not exists public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- lift_key(name), set by trigger. One exercise per name in a club, archived ones included.
  name_key text not null,
  category text not null default 'other'
    check (category in ('sprint', 'strength', 'plyometric', 'throws', 'jumps', 'mobility', 'conditioning', 'other')),
  measure text not null default 'reps_load' check (measure in ('reps_load', 'time', 'distance')),
  cue text check (cue is null or char_length(cue) <= 500),
  -- A link only, never a file. http or https, no spaces.
  link_url text check (link_url is null or (char_length(link_url) <= 500 and link_url ~* '^https?://[^[:space:]/?#]+\.[^[:space:]]+$')),
  is_archived boolean not null default false,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists exercise_library_tenant_name_uniq
on public.exercise_library (tenant_id, name_key);

create index if not exists exercise_library_tenant_active_idx
on public.exercise_library (tenant_id, is_archived, name);

create or replace function public.exercise_library_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.name_key := public.lift_key(new.name);
  if new.name_key = '' then
    raise exception 'Give the exercise a name.' using errcode = '23514';
  end if;
  new.cue := nullif(btrim(coalesce(new.cue, '')), '');
  new.link_url := nullif(btrim(coalesce(new.link_url, '')), '');
  if tg_op = 'INSERT' then
    new.created_by_user_id := coalesce(auth.uid(), new.created_by_user_id);
  else
    -- Who made it and which club it belongs to never change.
    new.tenant_id := old.tenant_id;
    new.created_by_user_id := old.created_by_user_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists exercise_library_before_write on public.exercise_library;
create trigger exercise_library_before_write
before insert or update on public.exercise_library
for each row
execute function public.exercise_library_before_write();

alter table public.exercise_library enable row level security;

-- Coaches and club admins of the club read and manage the library. Nobody else sees it.
drop policy if exists exercise_library_select_staff on public.exercise_library;
create policy exercise_library_select_staff
on public.exercise_library
for select
to authenticated
using (tenant_id = public.current_tenant_id() and public.is_coach_or_admin());

drop policy if exists exercise_library_insert_staff on public.exercise_library;
create policy exercise_library_insert_staff
on public.exercise_library
for insert
to authenticated
with check (tenant_id = public.current_tenant_id() and public.is_coach_or_admin());

drop policy if exists exercise_library_update_staff on public.exercise_library;
create policy exercise_library_update_staff
on public.exercise_library
for update
to authenticated
using (tenant_id = public.current_tenant_id() and public.is_coach_or_admin())
with check (tenant_id = public.current_tenant_id() and public.is_coach_or_admin());

-- No delete policy: exercises are archived, never deleted, so old plans keep their link.
revoke all on table public.exercise_library from anon, authenticated;
grant select, insert, update on table public.exercise_library to authenticated;
grant all on table public.exercise_library to service_role;

-- 3. Athlete best lifts -------------------------------------------------------------------

create table if not exists public.athlete_lift_maxes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  -- lift_key(lift_name), set by trigger.
  lift_key text not null,
  lift_name text not null check (char_length(btrim(lift_name)) between 1 and 80),
  exercise_id uuid references public.exercise_library(id) on delete set null,
  value_kg numeric(6, 2) not null check (value_kg > 0 and value_kg <= 1000),
  measured_on date not null default current_date,
  -- Who entered it. Set by trigger from the caller, not by the browser.
  source text not null default 'coach' check (source in ('coach', 'athlete')),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists athlete_lift_maxes_athlete_lift_uniq
on public.athlete_lift_maxes (athlete_id, lift_key);

create index if not exists athlete_lift_maxes_tenant_idx
on public.athlete_lift_maxes (tenant_id, athlete_id);

create or replace function public.athlete_lift_maxes_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  select a.tenant_id into v_tenant_id from public.athletes a where a.id = new.athlete_id;
  if v_tenant_id is null or v_tenant_id is distinct from new.tenant_id then
    raise exception 'This athlete does not belong to this club.' using errcode = '42501';
  end if;
  new.lift_name := btrim(new.lift_name);
  new.lift_key := public.lift_key(new.lift_name);
  if new.lift_key = '' then
    raise exception 'Name the lift.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
    new.athlete_id := old.athlete_id;
    new.created_at := old.created_at;
  end if;
  if auth.uid() is not null then
    new.updated_by_user_id := auth.uid();
    new.source := case when public.current_athlete_id() = new.athlete_id then 'athlete' else 'coach' end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.athlete_lift_maxes_before_write() from public, anon, authenticated;

drop trigger if exists athlete_lift_maxes_before_write on public.athlete_lift_maxes;
create trigger athlete_lift_maxes_before_write
before insert or update on public.athlete_lift_maxes
for each row
execute function public.athlete_lift_maxes_before_write();

alter table public.athlete_lift_maxes enable row level security;

-- The athlete, the coaches of the athlete's team and the club admins. The same people may
-- enter or correct it. A coach of another team and anyone in another club see nothing.
drop policy if exists athlete_lift_maxes_select on public.athlete_lift_maxes;
create policy athlete_lift_maxes_select
on public.athlete_lift_maxes
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (athlete_id = public.current_athlete_id() or public.can_manage_athlete(athlete_id))
);

drop policy if exists athlete_lift_maxes_insert on public.athlete_lift_maxes;
create policy athlete_lift_maxes_insert
on public.athlete_lift_maxes
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and (athlete_id = public.current_athlete_id() or public.can_manage_athlete(athlete_id))
);

drop policy if exists athlete_lift_maxes_update on public.athlete_lift_maxes;
create policy athlete_lift_maxes_update
on public.athlete_lift_maxes
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (athlete_id = public.current_athlete_id() or public.can_manage_athlete(athlete_id))
)
with check (
  tenant_id = public.current_tenant_id()
  and (athlete_id = public.current_athlete_id() or public.can_manage_athlete(athlete_id))
);

drop policy if exists athlete_lift_maxes_delete on public.athlete_lift_maxes;
create policy athlete_lift_maxes_delete
on public.athlete_lift_maxes
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (athlete_id = public.current_athlete_id() or public.can_manage_athlete(athlete_id))
);

revoke all on table public.athlete_lift_maxes from anon, authenticated;
grant select, insert, update, delete on table public.athlete_lift_maxes to authenticated;
grant all on table public.athlete_lift_maxes to service_role;

-- 4. Session rows: the pieces of a percentage prescription, the cue and the link -----------

alter table public.session_block_rows
  add column if not exists exercise_id uuid references public.exercise_library(id) on delete set null;

alter table public.session_block_rows
  add column if not exists percent_1rm numeric(5, 2);

alter table public.session_block_rows
  add column if not exists lift_name text;

alter table public.session_block_rows
  add column if not exists lift_key text;

alter table public.session_block_rows
  add column if not exists target_volume text;

alter table public.session_block_rows
  add column if not exists cue text;

alter table public.session_block_rows
  add column if not exists reference_url text;

comment on column public.session_block_rows.percent_1rm is
  'Load as a percentage of the athlete''s best lift (1RM) for lift_name. When set, target, target_load and helper are written by resolve_session_row_load().';
comment on column public.session_block_rows.lift_name is
  'The lift the percentage refers to. Defaults to the row label.';
comment on column public.session_block_rows.target_volume is
  'The sets and reps part of the target ("4 x 4"), kept apart so the load can be worked out again.';
comment on column public.session_block_rows.cue is
  'Coaching cue for the athlete (from the exercise library, plus a per athlete note). Shown through helper.';
comment on column public.session_block_rows.reference_url is
  'http or https link to a video or reference page for this exercise.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'session_block_rows_percent_range' and conrelid = 'public.session_block_rows'::regclass
  ) then
    alter table public.session_block_rows
      add constraint session_block_rows_percent_range
      check (percent_1rm is null or (percent_1rm > 0 and percent_1rm <= 200));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'session_block_rows_reference_url_http' and conrelid = 'public.session_block_rows'::regclass
  ) then
    alter table public.session_block_rows
      add constraint session_block_rows_reference_url_http
      check (reference_url is null or (char_length(reference_url) <= 500 and reference_url ~* '^https?://[^[:space:]/?#]+\.[^[:space:]]+$'));
  end if;
end
$$;

create index if not exists session_block_rows_lift_key_idx
on public.session_block_rows (lift_key)
where percent_1rm is not null;

-- 5. Working out the load -----------------------------------------------------------------

-- The best lift used for an athlete: the saved max, otherwise the best kilogram result with
-- the same lift name. Internal (used by triggers only): it checks nobody, so nobody may call it.
create or replace function public.athlete_lift_max_kg_unchecked(p_athlete_id uuid, p_lift_key text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.value_kg
      from public.athlete_lift_maxes m
      where m.athlete_id = p_athlete_id
        and m.lift_key = p_lift_key
    ),
    (
      select max(r.mark_value)
      from public.athlete_results r
      where r.athlete_id = p_athlete_id
        and r.mark_unit = 'kg'
        and public.lift_key(r.event_label) = p_lift_key
    )
  )
$$;

revoke all on function public.athlete_lift_max_kg_unchecked(uuid, text) from public, anon, authenticated;

-- Writes target, target_load and helper of a percentage row for the athlete the session belongs to.
-- "4 x 4 at 80%, 120 kg" when the best lift is known (nearest 2.5 kg), otherwise "4 x 4 at 80%"
-- and a short hint. The same wording as resolvePercentTarget() in src/lib/data/exercises/loads.ts.
create or replace function public.resolve_session_row_load()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_max numeric;
  v_kg numeric;
  v_load text;
  v_hint text;
  v_volume text;
begin
  new.cue := nullif(btrim(coalesce(new.cue, '')), '');
  if new.percent_1rm is null then
    new.lift_key := case when nullif(btrim(coalesce(new.lift_name, '')), '') is null then null else public.lift_key(new.lift_name) end;
    return new;
  end if;

  new.lift_name := coalesce(nullif(btrim(coalesce(new.lift_name, '')), ''), btrim(new.label));
  new.lift_key := public.lift_key(new.lift_name);

  select s.athlete_id
  into v_athlete_id
  from public.session_blocks sb
  join public.sessions s on s.id = sb.session_id
  where sb.id = new.session_block_id;

  v_max := public.athlete_lift_max_kg_unchecked(v_athlete_id, new.lift_key);
  v_volume := nullif(btrim(coalesce(new.target_volume, '')), '');

  if v_max is null or v_max <= 0 then
    v_load := public.format_load_number(new.percent_1rm) || '%';
    new.target_load := v_load;
    v_hint := 'No best ' || new.lift_name || ' saved yet, so there is no weight to show. Ask your coach to add it.';
  else
    v_kg := round(v_max * new.percent_1rm / 100 / 2.5) * 2.5;
    new.target_load := public.format_load_number(v_kg) || ' kg';
    v_load := public.format_load_number(new.percent_1rm) || '%, ' || new.target_load;
    v_hint := null;
  end if;

  new.target := case when v_volume is null then v_load else v_volume || ' at ' || v_load end;
  new.helper := nullif(concat_ws(' ', new.cue, v_hint), '');
  new.log_kind := 'strength';
  return new;
end;
$$;

revoke all on function public.resolve_session_row_load() from public, anon, authenticated;

drop trigger if exists resolve_session_row_load on public.session_block_rows;
create trigger resolve_session_row_load
before insert or update on public.session_block_rows
for each row
execute function public.resolve_session_row_load();

-- Works the loads out again for one athlete and one lift, in sessions that are not finished.
-- Internal: called by the two triggers below.
create or replace function public.refresh_athlete_session_loads(p_athlete_id uuid, p_lift_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_athlete_id is null or coalesce(p_lift_key, '') = '' then
    return;
  end if;

  -- Setting a column to itself is enough: the before update trigger does the work.
  update public.session_block_rows r
  set percent_1rm = r.percent_1rm
  from public.session_blocks sb
  join public.sessions s on s.id = sb.session_id
  where sb.id = r.session_block_id
    and s.athlete_id = p_athlete_id
    and s.status in ('scheduled', 'in-progress')
    and r.percent_1rm is not null
    and r.lift_key = p_lift_key;
end;
$$;

revoke all on function public.refresh_athlete_session_loads(uuid, text) from public, anon, authenticated;

create or replace function public.refresh_loads_after_lift_max_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_athlete_session_loads(old.athlete_id, old.lift_key);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_athlete_session_loads(new.athlete_id, new.lift_key);
  end if;
  return null;
end;
$$;

revoke all on function public.refresh_loads_after_lift_max_change() from public, anon, authenticated;

drop trigger if exists refresh_loads_after_lift_max_change on public.athlete_lift_maxes;
create trigger refresh_loads_after_lift_max_change
after insert or update or delete on public.athlete_lift_maxes
for each row
execute function public.refresh_loads_after_lift_max_change();

-- A new kilogram result (a test week squat) can be the best lift when no max was saved.
create or replace function public.refresh_loads_after_result_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.mark_unit = 'kg' then
    perform public.refresh_athlete_session_loads(old.athlete_id, public.lift_key(old.event_label));
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.mark_unit = 'kg' then
    perform public.refresh_athlete_session_loads(new.athlete_id, public.lift_key(new.event_label));
  end if;
  return null;
end;
$$;

revoke all on function public.refresh_loads_after_result_change() from public, anon, authenticated;

drop trigger if exists refresh_loads_after_result_change on public.athlete_results;
create trigger refresh_loads_after_result_change
after insert or update or delete on public.athlete_results
for each row
execute function public.refresh_loads_after_result_change();

grant execute on function public.lift_key(text) to authenticated, service_role;
grant execute on function public.format_load_number(numeric) to authenticated, service_role;

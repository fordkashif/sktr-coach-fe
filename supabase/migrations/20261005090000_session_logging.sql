-- SKTR Coach Session Logging
-- Created: 2026-10-05
--
-- Makes "coach publishes plan -> athlete logs the session -> coach sees it" work:
-- 1. sessions get a stable link back to the plan slot they were created from
--    (plan_id + plan_week_number + plan_day_index). training_plan_days rows are deleted and
--    re-created on every publish, so the slot is used instead of a foreign key to the day row.
--    A unique index on the slot makes re-publishing idempotent.
-- 2. session_block_rows get a structured target (sets, reps, load) and a log kind so the
--    athlete screen knows which inputs to show.
-- 3. session_row_logs stores what the athlete actually did, one row per set.
-- 4. session_completions get the overall effort (RPE) and the athlete comment, and the
--    athlete can update their own completion (needed for an idempotent upsert).
-- 5. Athletes cannot update sessions, so two triggers keep sessions.status in step with
--    what the athlete logged.
-- 6. Athletes may create their own session from a published plan (covers athletes who join
--    a team after the plan was published). Everything else about sessions stays staff only.
--
-- Additive only: no drops of tables or columns, no backfills.

-- 1. Sessions: link to the plan slot ------------------------------------------------------

alter table public.sessions
  add column if not exists plan_id uuid references public.training_plans(id) on delete set null;

alter table public.sessions
  add column if not exists plan_week_number int;

alter table public.sessions
  add column if not exists plan_day_index int;

alter table public.sessions
  add column if not exists session_type text;

alter table public.sessions
  add column if not exists location text;

comment on column public.sessions.plan_id is
  'Training plan this session was created from. Null for sessions created by hand.';
comment on column public.sessions.plan_week_number is
  'Week number of the plan slot (1-based). With plan_id and plan_day_index it identifies the planned day.';
comment on column public.sessions.plan_day_index is
  'Day index of the plan slot (0 to 6).';

-- Rows without a plan have null slot columns, and nulls never collide in a unique index,
-- so existing sessions are unaffected.
create unique index if not exists sessions_athlete_plan_slot_uniq
on public.sessions (athlete_id, plan_id, plan_week_number, plan_day_index);

create index if not exists sessions_plan_idx
on public.sessions (plan_id);

-- 2. Session rows: structured target ------------------------------------------------------

alter table public.session_block_rows
  add column if not exists log_kind text;

alter table public.session_block_rows
  add column if not exists target_sets int;

alter table public.session_block_rows
  add column if not exists target_reps text;

alter table public.session_block_rows
  add column if not exists target_load text;

comment on column public.session_block_rows.log_kind is
  'Which inputs the athlete gets: strength (reps and load), time, mark (distance or height) or check (tick only). Null means infer from the block type.';

-- 3. Logged results -----------------------------------------------------------------------

create table if not exists public.session_row_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  session_id uuid not null references public.sessions(id) on delete cascade,
  session_block_row_id uuid not null references public.session_block_rows(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  set_index int not null check (set_index >= 1),
  completed boolean not null default true,
  reps numeric(7, 2) check (reps is null or reps >= 0),
  load_kg numeric(8, 2) check (load_kg is null or load_kg >= 0),
  time_seconds numeric(10, 3) check (time_seconds is null or time_seconds >= 0),
  distance_m numeric(10, 3) check (distance_m is null or distance_m >= 0),
  mark numeric(10, 3) check (mark is null or mark >= 0),
  rpe smallint check (rpe is null or (rpe >= 1 and rpe <= 10)),
  note text,
  logged_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_block_row_id, athlete_id, set_index)
);

create index if not exists session_row_logs_session_idx
on public.session_row_logs (session_id);

create index if not exists session_row_logs_tenant_athlete_idx
on public.session_row_logs (tenant_id, athlete_id);

drop trigger if exists set_updated_at_session_row_logs on public.session_row_logs;
create trigger set_updated_at_session_row_logs
before update on public.session_row_logs
for each row
execute function public.set_updated_at();

-- 4. Completions: overall effort and comment ----------------------------------------------

alter table public.session_completions
  add column if not exists rpe smallint;

alter table public.session_completions
  add column if not exists athlete_comment text;

alter table public.session_completions
  add column if not exists updated_at timestamptz not null default now();

-- "not valid" skips checking existing rows (the column is new, so they are all null anyway).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'session_completions_rpe_range'
      and conrelid = 'public.session_completions'::regclass
  ) then
    alter table public.session_completions
      add constraint session_completions_rpe_range
      check (rpe is null or (rpe >= 1 and rpe <= 10)) not valid;
  end if;
end
$$;

drop trigger if exists set_updated_at_session_completions on public.session_completions;
create trigger set_updated_at_session_completions
before update on public.session_completions
for each row
execute function public.set_updated_at();

-- 5. Keep sessions.status in step with what the athlete logged -----------------------------

create or replace function public.mark_session_completed_from_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sessions s
  set status = 'completed',
      completed_at = coalesce(s.completed_at, new.completed_at, now())
  where s.id = new.session_id
    and s.athlete_id = new.athlete_id
    and (s.status <> 'completed' or s.completed_at is null);
  return new;
end;
$$;

drop trigger if exists mark_session_completed_on_completion on public.session_completions;
create trigger mark_session_completed_on_completion
after insert or update on public.session_completions
for each row
execute function public.mark_session_completed_from_completion();

create or replace function public.mark_session_in_progress_from_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sessions s
  set status = 'in-progress'
  where s.id = new.session_id
    and s.athlete_id = new.athlete_id
    and s.status = 'scheduled';
  return new;
end;
$$;

drop trigger if exists mark_session_in_progress_on_log on public.session_row_logs;
create trigger mark_session_in_progress_on_log
after insert on public.session_row_logs
for each row
execute function public.mark_session_in_progress_from_log();

-- 6. RLS ----------------------------------------------------------------------------------

alter table public.session_row_logs enable row level security;

drop policy if exists session_row_logs_select_own on public.session_row_logs;
create policy session_row_logs_select_own
on public.session_row_logs
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists session_row_logs_insert_own on public.session_row_logs;
create policy session_row_logs_insert_own
on public.session_row_logs
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
  and exists (
    select 1
    from public.session_block_rows r
    join public.session_blocks sb on sb.id = r.session_block_id
    join public.sessions s on s.id = sb.session_id
    where r.id = session_row_logs.session_block_row_id
      and s.id = session_row_logs.session_id
      and s.athlete_id = session_row_logs.athlete_id
      and s.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists session_row_logs_update_own on public.session_row_logs;
create policy session_row_logs_update_own
on public.session_row_logs
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
  and exists (
    select 1
    from public.session_block_rows r
    join public.session_blocks sb on sb.id = r.session_block_id
    join public.sessions s on s.id = sb.session_id
    where r.id = session_row_logs.session_block_row_id
      and s.id = session_row_logs.session_id
      and s.athlete_id = session_row_logs.athlete_id
      and s.tenant_id = public.current_tenant_id()
  )
);

-- Staff read what athletes logged, scoped like sessions_select_tenant_staff. They do not write logs.
drop policy if exists session_row_logs_select_tenant_staff on public.session_row_logs;
create policy session_row_logs_select_tenant_staff
on public.session_row_logs
for select
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());

-- Completions: the athlete can update their own row (effort, comment, re-finishing a session).
drop policy if exists session_completions_update_own on public.session_completions;
create policy session_completions_update_own
on public.session_completions
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
  and exists (
    select 1
    from public.sessions s
    where s.id = session_completions.session_id
      and s.athlete_id = session_completions.athlete_id
      and s.tenant_id = public.current_tenant_id()
  )
);

-- Athletes may create their own session from a published plan in their tenant.
-- The session must be linked to a plan slot and start as 'scheduled'.
drop policy if exists sessions_insert_own_from_plan on public.sessions;
create policy sessions_insert_own_from_plan
on public.sessions
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and status = 'scheduled'
  and plan_id is not null
  and plan_week_number is not null
  and plan_day_index is not null
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
  and exists (
    select 1
    from public.training_plans tp
    where tp.id = sessions.plan_id
      and tp.tenant_id = public.current_tenant_id()
      and tp.status = 'published'
  )
);

drop policy if exists session_blocks_insert_own_from_plan on public.session_blocks;
create policy session_blocks_insert_own_from_plan
on public.session_blocks
for insert
to authenticated
with check (
  exists (
    select 1
    from public.sessions s
    join public.athletes a on a.id = s.athlete_id
    where s.id = session_blocks.session_id
      and s.plan_id is not null
      and s.status = 'scheduled'
      and a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists session_block_rows_insert_own_from_plan on public.session_block_rows;
create policy session_block_rows_insert_own_from_plan
on public.session_block_rows
for insert
to authenticated
with check (
  exists (
    select 1
    from public.session_blocks sb
    join public.sessions s on s.id = sb.session_id
    join public.athletes a on a.id = s.athlete_id
    where sb.id = session_block_rows.session_block_id
      and s.plan_id is not null
      and s.status = 'scheduled'
      and a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
);

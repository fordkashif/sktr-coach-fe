-- SKTR Coach: skip a session, athlete availability, sessions added by the athlete
-- Created: 2026-10-08
--
-- What this adds (wave 1, athlete training):
-- 1. A session can be SKIPPED with a reason. sessions.status gains 'skipped', with skip_reason,
--    skip_note and skipped_at. Athletes cannot update sessions, so they go through
--    skip_my_session() and unskip_my_session().
-- 2. sessions.origin says who set the session: 'plan' (the coach, through a plan or by hand) or
--    'athlete' (the athlete logged something that was not planned). An athlete may insert an
--    origin = 'athlete' session for themselves, with its blocks and exercise rows, and delete it
--    again. They can never insert a planned session outside the published-plan path that already
--    existed, and never a session for someone else.
-- 3. athlete_availability: the athlete is injured, sick or away from one date until another (or
--    until further notice). Read by the athlete, the coaches of the athlete's team and the club
--    admin. Written only through set_athlete_availability() and end_athlete_availability(), which
--    the athlete (for themselves), a coach of their team and the club admin may call. Both write an
--    audit event and tell the other side in the app.
-- 4. get_my_last_exercise_results(): what the athlete did the last time for the same exercise.
--
-- Adherence (computed in the app, see src/lib/data/session/adherence.ts) is now
--   sessions completed / sessions that were due and not excused
-- where "due" is origin = 'plan' and scheduled up to today, and "excused" is skipped with a reason
-- or scheduled inside an availability period. Sessions added by the athlete are in neither number.
--
-- Idempotent and additive: add column if not exists, create table/index if not exists,
-- create or replace function, drop policy if exists + create policy. No data is changed or removed.
-- The status check constraint is replaced by a wider one (every existing row still passes).

-- 1. Sessions: skipped, and who set the session ------------------------------------------------

alter table public.sessions
  add column if not exists origin text not null default 'plan';

alter table public.sessions
  add column if not exists skip_reason text;

alter table public.sessions
  add column if not exists skip_note text;

alter table public.sessions
  add column if not exists skipped_at timestamptz;

comment on column public.sessions.origin is
  '''plan'': set by the coach (from a training plan or by hand). ''athlete'': logged by the athlete without being planned. Athlete sessions never count towards plan adherence.';
comment on column public.sessions.skip_reason is
  'Why the athlete skipped the session: sick, injured, travelling, competing, school_work or other. Set only while status is ''skipped''.';

-- Widen the status check. The original is the unnamed inline check from the v1 foundation
-- (sessions_status_check); any check on status that does not know 'skipped' is replaced.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.sessions'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
      and pg_get_constraintdef(c.oid) ilike '%in-progress%'
      and pg_get_constraintdef(c.oid) not ilike '%skipped%'
  loop
    execute format('alter table public.sessions drop constraint %I', v_constraint.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_status_check' and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_status_check
      check (status in ('scheduled', 'in-progress', 'completed', 'skipped'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_origin_check' and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_origin_check
      check (origin in ('plan', 'athlete'));
  end if;

  -- A session the athlete added can never sit in a plan slot.
  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_athlete_origin_has_no_plan' and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_athlete_origin_has_no_plan
      check (origin <> 'athlete' or (plan_id is null and plan_week_number is null and plan_day_index is null));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_skip_reason_check' and conrelid = 'public.sessions'::regclass
  ) then
    alter table public.sessions
      add constraint sessions_skip_reason_check
      check (
        (skip_reason is null or skip_reason in ('sick', 'injured', 'travelling', 'competing', 'school_work', 'other'))
        and (status <> 'skipped' or skip_reason is not null)
        and (skip_note is null or char_length(skip_note) <= 280)
      );
  end if;
end
$$;

-- The history list and the adherence window both read "this athlete, newest first".
create index if not exists sessions_athlete_scheduled_idx
on public.sessions (athlete_id, scheduled_for desc);

-- Whenever a session stops being skipped (un-skipped, or finished after all) the reason goes with it,
-- whoever made the change.
create or replace function public.clear_session_skip_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'skipped' then
    new.skip_reason := null;
    new.skip_note := null;
    new.skipped_at := null;
  elsif new.skipped_at is null then
    new.skipped_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists clear_session_skip_fields on public.sessions;
create trigger clear_session_skip_fields
before insert or update of status, skip_reason, skip_note, skipped_at on public.sessions
for each row
execute function public.clear_session_skip_fields();

-- 2. Skip and un-skip, for the athlete ---------------------------------------------------------
-- Both start with assert_caller_active() (20261006180000): a deactivated athlete, or one in a
-- suspended or cancelled club, is refused with the access_paused error.

create or replace function public.skip_my_session(
  p_session_id uuid,
  p_reason text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_session record;
  v_note text;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  v_athlete_id := public.current_athlete_id();
  if v_athlete_id is null then
    raise exception 'Only an athlete can skip their own session.' using errcode = '42501';
  end if;

  if p_reason is null or p_reason not in ('sick', 'injured', 'travelling', 'competing', 'school_work', 'other') then
    raise exception 'Choose a reason for skipping this session.' using errcode = '23514';
  end if;

  v_note := nullif(left(btrim(coalesce(p_note, '')), 280), '');

  select s.id, s.status, s.origin
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.athlete_id = v_athlete_id
    and s.tenant_id = public.current_tenant_id()
  for update;

  if not found then
    raise exception 'That session is not yours to skip.' using errcode = '42501';
  end if;
  if v_session.origin = 'athlete' then
    raise exception 'A session you added yourself cannot be skipped. Remove it instead.' using errcode = '23514';
  end if;
  if v_session.status = 'completed' then
    raise exception 'This session is already logged as done.' using errcode = '23514';
  end if;

  update public.sessions s
  set status = 'skipped',
      skip_reason = p_reason,
      skip_note = v_note,
      skipped_at = now()
  where s.id = v_session.id;
end;
$$;

create or replace function public.unskip_my_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_session record;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  v_athlete_id := public.current_athlete_id();
  if v_athlete_id is null then
    raise exception 'Only an athlete can change their own session.' using errcode = '42501';
  end if;

  select s.id, s.status
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.athlete_id = v_athlete_id
    and s.tenant_id = public.current_tenant_id()
  for update;

  if not found then
    raise exception 'That session is not yours to change.' using errcode = '42501';
  end if;
  if v_session.status <> 'skipped' then
    return;
  end if;

  -- Back to where it was: in progress when sets were already logged, otherwise scheduled.
  update public.sessions s
  set status = case
        when exists (select 1 from public.session_row_logs l where l.session_id = s.id) then 'in-progress'
        else 'scheduled'
      end
  where s.id = v_session.id;
end;
$$;

revoke all on function public.skip_my_session(uuid, text, text) from public, anon;
revoke all on function public.unskip_my_session(uuid) from public, anon;
grant execute on function public.skip_my_session(uuid, text, text) to authenticated;
grant execute on function public.unskip_my_session(uuid) to authenticated;

-- 3. Sessions added by the athlete -------------------------------------------------------------

-- Same policy as 20261006150000 with one addition: origin must be 'plan'. Without it the new origin
-- column would let an athlete file a planned slot as their own extra session.
drop policy if exists sessions_insert_own_from_plan on public.sessions;
create policy sessions_insert_own_from_plan
on public.sessions
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and status = 'scheduled'
  and origin = 'plan'
  and plan_id is not null
  and plan_week_number is not null
  and plan_day_index is not null
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
  and plan_id = any ((select public.current_athlete_plan_ids())::uuid[])
  and exists (
    select 1
    from public.training_plans tp
    where tp.id = sessions.plan_id
      and tp.tenant_id = public.current_tenant_id()
      and tp.status = 'published'
  )
);

-- New: an athlete adds a session that was not planned. Only for themselves, only marked as theirs,
-- never in a plan slot, never with a coach note, and not far in the past or the future.
drop policy if exists sessions_insert_own_extra on public.sessions;
create policy sessions_insert_own_extra
on public.sessions
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and origin = 'athlete'
  and status = 'scheduled'
  and plan_id is null
  and plan_week_number is null
  and plan_day_index is null
  and coach_note is null
  and skip_reason is null
  and created_by_user_id = auth.uid()
  and athlete_id = (select public.current_athlete_id())
  and scheduled_for between current_date - 90 and current_date + 1
);

-- New: the athlete removes a session they added themselves (a mistake). Planned sessions stay staff only.
drop policy if exists sessions_delete_own_extra on public.sessions;
create policy sessions_delete_own_extra
on public.sessions
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and origin = 'athlete'
  and athlete_id = (select public.current_athlete_id())
);

-- New: the blocks and exercise rows of a session the athlete added. Unlike the from-plan policies
-- these do not require status 'scheduled': exercises are added while the session is being logged.
drop policy if exists session_blocks_insert_own_extra on public.session_blocks;
create policy session_blocks_insert_own_extra
on public.session_blocks
for insert
to authenticated
with check (
  coach_note is null
  and exists (
    select 1
    from public.sessions s
    where s.id = session_blocks.session_id
      and s.origin = 'athlete'
      and s.tenant_id = public.current_tenant_id()
      and s.athlete_id = (select public.current_athlete_id())
  )
);

drop policy if exists session_block_rows_insert_own_extra on public.session_block_rows;
create policy session_block_rows_insert_own_extra
on public.session_block_rows
for insert
to authenticated
with check (
  exists (
    select 1
    from public.session_blocks sb
    join public.sessions s on s.id = sb.session_id
    where sb.id = session_block_rows.session_block_id
      and s.origin = 'athlete'
      and s.tenant_id = public.current_tenant_id()
      and s.athlete_id = (select public.current_athlete_id())
  )
);

-- 4. Availability ------------------------------------------------------------------------------

create table if not exists public.athlete_availability (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  kind text not null check (kind in ('injured', 'sick', 'away')),
  starts_on date not null,
  -- Last day the athlete is unavailable. Null means until further notice.
  ends_on date,
  note text check (note is null or char_length(note) <= 280),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_role text,
  -- Set when someone ended the period by hand ("I'm back"). ends_on is moved to the last day off.
  ended_at timestamptz,
  ended_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- ends_on = starts_on - 1 is a period that was cancelled before it began: it excuses nothing.
  constraint athlete_availability_range check (ends_on is null or ends_on >= starts_on - 1)
);

comment on table public.athlete_availability is
  'Periods an athlete cannot train (injured, sick, away). Planned sessions inside a period are excused: they do not count as missed.';

create index if not exists athlete_availability_athlete_idx
on public.athlete_availability (athlete_id, starts_on desc);

create index if not exists athlete_availability_tenant_idx
on public.athlete_availability (tenant_id, starts_on desc);

drop trigger if exists set_updated_at_athlete_availability on public.athlete_availability;
create trigger set_updated_at_athlete_availability
before update on public.athlete_availability
for each row
execute function public.set_updated_at();

alter table public.athlete_availability enable row level security;

-- Read: the athlete (own rows), the coaches of the athlete's team, the club admin. Nobody writes
-- directly: there is no insert, update or delete policy, and the grants below are select only.
drop policy if exists athlete_availability_select_own_or_staff on public.athlete_availability;
create policy athlete_availability_select_own_or_staff
on public.athlete_availability
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

revoke all on table public.athlete_availability from anon, authenticated;
grant select on table public.athlete_availability to authenticated;
grant all on table public.athlete_availability to service_role;

-- "Injured", "Sick", "Away": the words used in notifications and the audit log.
create or replace function public.availability_kind_label(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_kind when 'injured' then 'injured' when 'sick' then 'sick' else 'away' end
$$;

-- Marks an athlete unavailable. p_athlete_id null means "me" (the signed-in athlete).
-- Allowed: the athlete for themselves, a coach of the athlete's team, the club admin of the club
-- (can_manage_athlete from 20261006120000). Returns the id of the new period.
-- Any period of the athlete that is still open and overlaps the new one is closed first, so an
-- athlete has one period at a time and "set it again" works as "change it".
create or replace function public.set_athlete_availability(
  p_kind text,
  p_starts_on date,
  p_ends_on date default null,
  p_note text default null,
  p_athlete_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_athlete record;
  v_is_self boolean;
  v_role text;
  v_note text;
  v_id uuid;
  v_when text;
  v_actor_name text;
  v_coach_user_id uuid;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('injured', 'sick', 'away') then
    raise exception 'Choose injured, sick or away.' using errcode = '23514';
  end if;
  if p_starts_on is null then
    raise exception 'Choose the first day.' using errcode = '23514';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'The last day cannot be before the first day.' using errcode = '23514';
  end if;
  if p_starts_on < current_date - 60 or p_starts_on > current_date + 365 then
    raise exception 'Choose a first day within the last 60 days or the next year.' using errcode = '23514';
  end if;

  v_self_id := public.current_athlete_id();
  v_is_self := p_athlete_id is null or p_athlete_id = v_self_id;

  if v_is_self then
    if v_self_id is null then
      raise exception 'Choose the athlete this is for.' using errcode = '42501';
    end if;
  elsif not public.can_manage_athlete(p_athlete_id) then
    raise exception 'You can only set this for athletes on your own teams.' using errcode = '42501';
  end if;

  select a.id, a.tenant_id, a.team_id, a.user_id
  into v_athlete
  from public.athletes a
  where a.id = coalesce(p_athlete_id, v_self_id)
    and a.tenant_id = public.current_tenant_id();

  if not found then
    raise exception 'Athlete not found.' using errcode = '42501';
  end if;

  v_role := public.current_app_role();
  v_note := nullif(left(btrim(coalesce(p_note, '')), 280), '');

  -- Close what the new period replaces.
  update public.athlete_availability av
  set ended_at = now(),
      ended_by_user_id = auth.uid(),
      ends_on = greatest(av.starts_on - 1, least(coalesce(av.ends_on, p_starts_on - 1), p_starts_on - 1))
  where av.athlete_id = v_athlete.id
    and av.ended_at is null
    and (av.ends_on is null or av.ends_on >= p_starts_on)
    and (p_ends_on is null or av.starts_on <= p_ends_on);

  insert into public.athlete_availability (
    tenant_id, athlete_id, kind, starts_on, ends_on, note, created_by_user_id, created_by_role
  )
  values (
    v_athlete.tenant_id, v_athlete.id, p_kind, p_starts_on, p_ends_on, v_note, auth.uid(), v_role
  )
  returning id into v_id;

  v_when := case
    when p_ends_on is null then format('from %s until further notice', public.notification_date_label(p_starts_on))
    when p_ends_on = p_starts_on then format('on %s', public.notification_date_label(p_starts_on))
    else format('from %s to %s', public.notification_date_label(p_starts_on), public.notification_date_label(p_ends_on))
  end;

  -- The note can hold health details, so it stays out of the audit log and the notifications.
  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    v_athlete.tenant_id,
    auth.uid(),
    coalesce(v_role, 'unknown'),
    'athlete_availability_set',
    public.notification_athlete_name(v_athlete.id),
    format('Marked %s %s%s.', public.availability_kind_label(p_kind), v_when, case when v_is_self then ' (by the athlete)' else '' end)
  );

  if v_is_self then
    -- Tell the coaches of the athlete's team, in the app only.
    if v_athlete.team_id is not null then
      for v_coach_user_id in select public.notification_team_coach_user_ids(v_athlete.team_id)
      loop
        perform public.enqueue_notification(
          v_athlete.tenant_id,
          v_coach_user_id,
          'athlete_unavailable',
          format('%s is %s', public.notification_athlete_name(v_athlete.id), public.availability_kind_label(p_kind)),
          format('Unavailable %s. Planned sessions in that time will not count as missed.', v_when),
          jsonb_build_object(
            'athlete_id', v_athlete.id::text,
            'team_id', v_athlete.team_id::text,
            'availability_id', v_id::text
          ),
          array['in-app'],
          'athlete_unavailable:' || v_athlete.id::text || ':' || to_char(p_starts_on, 'YYYY-MM-DD'),
          interval '10 minutes'
        );
      end loop;
    end if;
  else
    -- Tell the athlete that someone set this for them.
    select nullif(left(btrim(coalesce(p.display_name, '')), 80), '')
    into v_actor_name
    from public.profiles p
    where p.user_id = auth.uid()
      and p.tenant_id = v_athlete.tenant_id;

    perform public.enqueue_notification(
      v_athlete.tenant_id,
      v_athlete.user_id,
      'availability_set_by_coach',
      format('%s marked you as %s', coalesce(v_actor_name, case when v_role = 'club-admin' then 'Your club' else 'Your coach' end), public.availability_kind_label(p_kind)),
      format('Unavailable %s. Planned sessions in that time will not count as missed. You can end it yourself when you are back.', v_when),
      jsonb_build_object('athlete_id', v_athlete.id::text, 'availability_id', v_id::text),
      array['in-app', 'email'],
      'availability_set:' || v_athlete.id::text || ':' || to_char(p_starts_on, 'YYYY-MM-DD'),
      interval '10 minutes'
    );
  end if;

  return v_id;
end;
$$;

-- Ends a period ("I'm back"). p_last_day is the last day the athlete was unavailable; it defaults
-- to yesterday, so sessions from today on count again. Same people as set_athlete_availability().
create or replace function public.end_athlete_availability(
  p_availability_id uuid,
  p_last_day date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_self_id uuid;
  v_is_self boolean;
  v_role text;
  v_last date;
  v_athlete record;
  v_actor_name text;
  v_coach_user_id uuid;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select av.id, av.athlete_id, av.tenant_id, av.starts_on, av.ends_on, av.ended_at, av.kind
  into v_row
  from public.athlete_availability av
  where av.id = p_availability_id
    and av.tenant_id = public.current_tenant_id()
  for update;

  if not found then
    raise exception 'That is not yours to change.' using errcode = '42501';
  end if;

  v_self_id := public.current_athlete_id();
  v_is_self := v_self_id is not null and v_row.athlete_id = v_self_id;
  if not v_is_self and not public.can_manage_athlete(v_row.athlete_id) then
    raise exception 'That is not yours to change.' using errcode = '42501';
  end if;

  if v_row.ended_at is not null then
    return;
  end if;

  v_role := public.current_app_role();
  v_last := coalesce(p_last_day, current_date - 1);
  -- The client sends its own local date; allow for time zones, nothing more.
  if v_last > current_date + 1 then
    v_last := current_date + 1;
  end if;

  update public.athlete_availability av
  set ended_at = now(),
      ended_by_user_id = auth.uid(),
      ends_on = greatest(av.starts_on - 1, least(coalesce(av.ends_on, v_last), v_last))
  where av.id = v_row.id;

  select a.id, a.tenant_id, a.team_id, a.user_id
  into v_athlete
  from public.athletes a
  where a.id = v_row.athlete_id;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    v_row.tenant_id,
    auth.uid(),
    coalesce(v_role, 'unknown'),
    'athlete_availability_ended',
    public.notification_athlete_name(v_row.athlete_id),
    format('Available again%s.', case when v_is_self then ' (by the athlete)' else '' end)
  );

  if v_is_self then
    if v_athlete.team_id is not null then
      for v_coach_user_id in select public.notification_team_coach_user_ids(v_athlete.team_id)
      loop
        perform public.enqueue_notification(
          v_row.tenant_id,
          v_coach_user_id,
          'athlete_available_again',
          format('%s is back', public.notification_athlete_name(v_row.athlete_id)),
          'They marked themselves available again. Planned sessions count from today.',
          jsonb_build_object('athlete_id', v_row.athlete_id::text, 'team_id', v_athlete.team_id::text),
          array['in-app'],
          'athlete_available:' || v_row.athlete_id::text,
          interval '10 minutes'
        );
      end loop;
    end if;
  else
    select nullif(left(btrim(coalesce(p.display_name, '')), 80), '')
    into v_actor_name
    from public.profiles p
    where p.user_id = auth.uid()
      and p.tenant_id = v_row.tenant_id;

    perform public.enqueue_notification(
      v_row.tenant_id,
      v_athlete.user_id,
      'availability_set_by_coach',
      format('%s marked you as available again', coalesce(v_actor_name, case when v_role = 'club-admin' then 'Your club' else 'Your coach' end)),
      'Your planned sessions count again from today.',
      jsonb_build_object('athlete_id', v_row.athlete_id::text, 'availability_id', v_row.id::text),
      array['in-app'],
      'availability_ended:' || v_row.id::text,
      interval '10 minutes'
    );
  end if;
end;
$$;

revoke all on function public.availability_kind_label(text) from public, anon;
revoke all on function public.set_athlete_availability(text, date, date, text, uuid) from public, anon;
revoke all on function public.end_athlete_availability(uuid, date) from public, anon;
grant execute on function public.availability_kind_label(text) to authenticated, service_role;
grant execute on function public.set_athlete_availability(text, date, date, text, uuid) to authenticated;
grant execute on function public.end_athlete_availability(uuid, date) to authenticated;

-- 5. "Last time" for the log screen ------------------------------------------------------------
-- For each exercise name: the sets of the athlete's most recent COMPLETED session that has that
-- exercise, before p_before and not the session being logged. Runs as the caller, so the row
-- policies decide what is visible (an athlete only ever reads their own logs).
create or replace function public.get_my_last_exercise_results(
  p_labels text[],
  p_before date default current_date,
  p_exclude_session_id uuid default null
)
returns table (
  label_key text,
  session_date date,
  log_kind text,
  block_type text,
  set_index int,
  reps numeric,
  load_kg numeric,
  time_seconds numeric,
  distance_m numeric,
  mark numeric
)
language sql
stable
set search_path = public
as $$
  with mine as (
    select
      lower(btrim(r.label)) as label_key,
      s.id as session_id,
      s.scheduled_for,
      r.log_kind,
      sb.block_type,
      l.set_index,
      l.reps,
      l.load_kg,
      l.time_seconds,
      l.distance_m,
      l.mark
    from public.session_row_logs l
    join public.session_block_rows r on r.id = l.session_block_row_id
    join public.session_blocks sb on sb.id = r.session_block_id
    join public.sessions s on s.id = l.session_id
    where l.athlete_id = public.current_athlete_id()
      and l.completed
      and s.status = 'completed'
      and s.scheduled_for <= coalesce(p_before, current_date)
      and (p_exclude_session_id is null or s.id <> p_exclude_session_id)
      and lower(btrim(r.label)) = any (
        select lower(btrim(x)) from unnest(coalesce(p_labels, '{}'::text[])) as x
      )
  ),
  latest as (
    select distinct on (m.label_key) m.label_key, m.session_id
    from mine m
    order by m.label_key, m.scheduled_for desc, m.session_id
  )
  select m.label_key, m.scheduled_for, m.log_kind, m.block_type, m.set_index, m.reps, m.load_kg, m.time_seconds, m.distance_m, m.mark
  from mine m
  join latest t on t.label_key = m.label_key and t.session_id = m.session_id
  order by m.label_key, m.set_index
$$;

revoke all on function public.get_my_last_exercise_results(text[], date, uuid) from public, anon;
grant execute on function public.get_my_last_exercise_results(text[], date, uuid) to authenticated;

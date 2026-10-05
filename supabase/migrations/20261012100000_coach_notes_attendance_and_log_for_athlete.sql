-- SKTR Coach: private coach notes, attendance, and a coach logging a session for an athlete
-- Created: 2026-10-12
--
-- What this adds
--   1. public.coach_athlete_notes: dated notes a coach keeps about an athlete. Read by the coaches
--      of the athlete's current team and by club admins. NEVER by the athlete: there is no athlete
--      policy, so an athlete reads zero rows about themselves or anyone else. A note is changed
--      only by the person who wrote it; it is removed by its author or a club admin.
--   2. public.athlete_attendance: one mark per team, athlete and day (present, late, absent or
--      excused, with an optional short reason), and the session of that day when there is one.
--      Written by the coaches of that team and by club admins. The athlete reads their own rows
--      and writes nothing.
--   3. Logging for an athlete: the coaches of an athlete's team and club admins may now insert and
--      update public.session_row_logs for ANY athlete on their teams (before this, only for an
--      athlete without a login). Completions were already writable by staff (20261006120000).
--      Who typed it is kept honest by two triggers: session_row_logs.logged_by_user_id and
--      session_completions.completed_by_user_id are stamped with the caller, never with a user
--      the client names. get_session_logged_by() tells the athlete (and staff) who entered a
--      session when it was not the athlete.
--
-- Uses the helpers of 20261005180000, 20261006120000 and 20261006150000, so a deactivated member
-- or a member of a suspended or cancelled club is refused here as everywhere else.
--
-- Idempotent: create table / index if not exists, create or replace function, drop trigger and
-- drop policy if exists before each create. Safe to apply twice. No data changes.

-- 1. Coach notes -------------------------------------------------------------------------------

create table if not exists public.coach_athlete_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  -- Who wrote it. Stamped by trigger, never taken from the client.
  author_user_id uuid references auth.users(id) on delete set null,
  -- The day the note is about (today unless the coach picks another day).
  note_date date not null default current_date,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.coach_athlete_notes is
  'Private notes coaches keep about an athlete. Staff only: coaches of the athlete''s current team and club admins. The athlete can never read them.';

create index if not exists coach_athlete_notes_athlete_idx
on public.coach_athlete_notes (athlete_id, note_date desc, created_at desc);

create index if not exists coach_athlete_notes_tenant_idx
on public.coach_athlete_notes (tenant_id);

create or replace function public.coach_athlete_notes_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  if tg_op = 'UPDATE' then
    -- Whose note it is, who wrote it and when never change.
    new.athlete_id := old.athlete_id;
    new.tenant_id := old.tenant_id;
    new.author_user_id := old.author_user_id;
    new.created_at := old.created_at;
  else
    select a.tenant_id into v_tenant_id from public.athletes a where a.id = new.athlete_id;
    if not found then
      raise exception 'This athlete does not exist.' using errcode = '23503';
    end if;
    new.tenant_id := v_tenant_id;
    if auth.uid() is not null then
      new.author_user_id := auth.uid();
    end if;
    new.created_at := now();
  end if;

  new.body := btrim(coalesce(new.body, ''));
  new.note_date := coalesce(new.note_date, current_date);
  new.pinned := coalesce(new.pinned, false);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.coach_athlete_notes_normalise() from public, anon, authenticated;

drop trigger if exists coach_athlete_notes_normalise on public.coach_athlete_notes;
create trigger coach_athlete_notes_normalise
before insert or update on public.coach_athlete_notes
for each row
execute function public.coach_athlete_notes_normalise();

alter table public.coach_athlete_notes enable row level security;

-- Read: coaches of the athlete's current team and club admins. No athlete policy exists.
drop policy if exists coach_athlete_notes_select_staff on public.coach_athlete_notes;
create policy coach_athlete_notes_select_staff
on public.coach_athlete_notes
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

drop policy if exists coach_athlete_notes_insert_staff on public.coach_athlete_notes;
create policy coach_athlete_notes_insert_staff
on public.coach_athlete_notes
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and author_user_id = auth.uid()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

-- Change (text, day, pin): only the author, and only while they still may see the athlete.
drop policy if exists coach_athlete_notes_update_author on public.coach_athlete_notes;
create policy coach_athlete_notes_update_author
on public.coach_athlete_notes
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and author_user_id = auth.uid()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and author_user_id = auth.uid()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

-- Remove: the author, or a club admin (who can clear a note of a coach who has left).
drop policy if exists coach_athlete_notes_delete_author_or_admin on public.coach_athlete_notes;
create policy coach_athlete_notes_delete_author_or_admin
on public.coach_athlete_notes
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or (author_user_id = auth.uid() and athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  )
);

revoke all on table public.coach_athlete_notes from anon, authenticated;
grant select, insert, update, delete on table public.coach_athlete_notes to authenticated;
grant all on table public.coach_athlete_notes to service_role;

-- 2. Attendance --------------------------------------------------------------------------------

create table if not exists public.athlete_attendance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  attendance_date date not null,
  -- The athlete's planned session of that day, when there is one.
  session_id uuid references public.sessions(id) on delete set null,
  status text not null check (status in ('present', 'late', 'absent', 'excused')),
  reason text check (reason is null or char_length(reason) <= 200),
  -- Who took the mark last. Stamped by trigger.
  marked_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint athlete_attendance_one_per_day unique (tenant_id, team_id, athlete_id, attendance_date)
);

comment on table public.athlete_attendance is
  'Attendance taken by a coach: one mark per team, athlete and day. The athlete can read their own rows and cannot write.';

create index if not exists athlete_attendance_athlete_idx
on public.athlete_attendance (athlete_id, attendance_date desc);

create index if not exists athlete_attendance_team_date_idx
on public.athlete_attendance (team_id, attendance_date desc);

create or replace function public.athlete_attendance_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_tenant uuid;
  v_athlete_tenant uuid;
  v_athlete_team uuid;
begin
  if tg_op = 'UPDATE' then
    -- Which team, athlete and day the mark is for never change.
    new.tenant_id := old.tenant_id;
    new.team_id := old.team_id;
    new.athlete_id := old.athlete_id;
    new.attendance_date := old.attendance_date;
    new.created_at := old.created_at;
  else
    select t.tenant_id into v_team_tenant from public.teams t where t.id = new.team_id;
    if not found then
      raise exception 'This team does not exist.' using errcode = '23503';
    end if;
    select a.tenant_id, a.team_id into v_athlete_tenant, v_athlete_team from public.athletes a where a.id = new.athlete_id;
    if not found or v_athlete_tenant is distinct from v_team_tenant then
      raise exception 'This athlete does not exist.' using errcode = '23503';
    end if;
    if v_athlete_team is distinct from new.team_id then
      raise exception 'This athlete is not on that team.' using errcode = '23514';
    end if;
    if new.attendance_date > current_date + 1 then
      raise exception 'Attendance cannot be taken for a day that has not come yet.' using errcode = '23514';
    end if;
    new.tenant_id := v_team_tenant;
    new.created_at := now();
  end if;

  -- A session that is not this athlete's is dropped rather than stored.
  if new.session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.session_id and s.athlete_id = new.athlete_id
  ) then
    new.session_id := null;
  end if;

  new.reason := nullif(left(btrim(regexp_replace(coalesce(new.reason, ''), '\s+', ' ', 'g')), 200), '');
  if auth.uid() is not null then
    new.marked_by_user_id := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.athlete_attendance_normalise() from public, anon, authenticated;

drop trigger if exists athlete_attendance_normalise on public.athlete_attendance;
create trigger athlete_attendance_normalise
before insert or update on public.athlete_attendance
for each row
execute function public.athlete_attendance_normalise();

alter table public.athlete_attendance enable row level security;

-- Read: the athlete (own rows), the coaches of the team the mark was taken for, the coaches of
-- the athlete's current team (so history follows a move), and club admins.
drop policy if exists athlete_attendance_select_own_or_staff on public.athlete_attendance;
create policy athlete_attendance_select_own_or_staff
on public.athlete_attendance
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    athlete_id = (select public.current_athlete_id())
    or (select public.is_club_admin())
    or team_id = any ((select public.current_coach_team_ids())::uuid[])
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

-- Write: the coaches of that team and club admins. There is no athlete write policy.
drop policy if exists athlete_attendance_insert_staff on public.athlete_attendance;
create policy athlete_attendance_insert_staff
on public.athlete_attendance
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
);

drop policy if exists athlete_attendance_update_staff on public.athlete_attendance;
create policy athlete_attendance_update_staff
on public.athlete_attendance
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
);

drop policy if exists athlete_attendance_delete_staff on public.athlete_attendance;
create policy athlete_attendance_delete_staff
on public.athlete_attendance
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
);

revoke all on table public.athlete_attendance from anon, authenticated;
grant select, insert, update, delete on table public.athlete_attendance to authenticated;
grant all on table public.athlete_attendance to service_role;

-- 3. A coach logs a session for an athlete -----------------------------------------------------

-- Staff could already read the sets of athletes on their teams, and write them for an athlete
-- without a login (session_row_logs_staff_write_managed). These two let the coaches of the
-- athlete's team and club admins enter and correct sets for any athlete on their teams. Nobody
-- else gains anything: a coach of another team and another club match neither branch.
drop policy if exists session_row_logs_staff_insert_team on public.session_row_logs;
create policy session_row_logs_staff_insert_team
on public.session_row_logs
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
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

drop policy if exists session_row_logs_staff_update_team on public.session_row_logs;
create policy session_row_logs_staff_update_team
on public.session_row_logs
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
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

-- Who entered a set. A signed-in caller can only ever put their own id here: on insert it is
-- stamped, on update any change of it becomes the caller. Without a signed-in user (service
-- role, a migration) the value is left as given.
create or replace function public.stamp_session_row_log_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.logged_by_user_id := auth.uid();
  elsif new.logged_by_user_id is distinct from old.logged_by_user_id then
    new.logged_by_user_id := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_session_row_log_author() from public, anon, authenticated;

drop trigger if exists stamp_session_row_log_author on public.session_row_logs;
create trigger stamp_session_row_log_author
before insert or update on public.session_row_logs
for each row
execute function public.stamp_session_row_log_author();

-- Who finished a session. Stamped with the caller on insert and never changed afterwards, so
-- "Logged by Coach Rivera" stays true when the athlete later corrects a number or the comment.
create or replace function public.stamp_session_completion_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.completed_by_user_id := auth.uid();
  else
    new.completed_by_user_id := old.completed_by_user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_session_completion_author() from public, anon, authenticated;

drop trigger if exists stamp_session_completion_author on public.session_completions;
create trigger stamp_session_completion_author
before insert or update on public.session_completions
for each row
execute function public.stamp_session_completion_author();

-- Who entered a session, when it was not the athlete. One row (user, name, role) or none.
-- For the athlete of the session, the coaches of their team and club admins. Anyone else, and a
-- session of another club, gets no row.
create or replace function public.get_session_logged_by(p_session_id uuid)
returns table (user_id uuid, display_name text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_athlete_id uuid;
  v_athlete_user_id uuid;
  v_by uuid;
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    return;
  end if;

  select s.tenant_id, s.athlete_id, a.user_id
  into v_tenant_id, v_athlete_id, v_athlete_user_id
  from public.sessions s
  join public.athletes a on a.id = s.athlete_id
  where s.id = p_session_id
    and s.tenant_id = public.current_tenant_id();
  if not found then
    return;
  end if;

  if not (
    v_athlete_id is not distinct from public.current_athlete_id()
    or public.is_club_admin()
    or public.is_coach_of_athlete(v_athlete_id)
  ) then
    return;
  end if;

  select c.completed_by_user_id into v_by
  from public.session_completions c
  where c.session_id = p_session_id and c.athlete_id = v_athlete_id
  limit 1;

  -- Not finished yet: the staff member who last typed a set.
  if not found then
    select l.logged_by_user_id into v_by
    from public.session_row_logs l
    where l.session_id = p_session_id
      and l.athlete_id = v_athlete_id
      and l.logged_by_user_id is not null
      and l.logged_by_user_id is distinct from v_athlete_user_id
    order by l.updated_at desc
    limit 1;
  end if;

  if v_by is null or v_by is not distinct from v_athlete_user_id then
    return;
  end if;

  return query
  select p.user_id, p.display_name, p.role
  from public.profiles p
  where p.user_id = v_by
    and p.tenant_id = v_tenant_id
    and p.role in ('coach', 'club-admin');
end;
$$;

revoke all on function public.get_session_logged_by(uuid) from public, anon;
grant execute on function public.get_session_logged_by(uuid) to authenticated, service_role;

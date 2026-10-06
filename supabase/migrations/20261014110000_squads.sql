-- Squads: small named groups inside one team.
-- Created: 2026-10-14
--
-- An athlete is on ONE team. A squad is a named group of athletes of that one team ("Short
-- sprints", "400m", "Juniors"), managed by the team's coaches and the club's admins. It is not a
-- second team: it never changes who can see an athlete. An athlete can be in several squads of
-- their team, or in none.
--
-- What this adds
--   1. team_squads and team_squad_members, with row level security.
--        read   the team's coaches, club admins, and an athlete for the squads they are in
--               (their own membership rows only, never another athlete's).
--        write  the team's coaches and club admins. Nobody else, no other team, no other club.
--      A member must be on the squad's team (trigger). When an athlete moves team, is taken off
--      a team or is deactivated, their memberships on the old team end (trigger). Archiving a
--      squad ends its memberships.
--   2. Plans for squads: training_plan_assignments gets scope 'squad' and squad_id. The plan
--      reaches the members at the time and anyone added later (current_athlete_plan_ids, the
--      publish notification). When a membership ends, the untouched upcoming sessions the athlete
--      only had through that squad are removed; anything started, done or in the past stays.
--      The sessions themselves are written by the app, exactly as for a team plan.
--   3. Test weeks for squads: test_weeks.squad_ids (empty means the whole team). Athletes outside
--      the chosen squads do not see the week, cannot enter results in it and are not told about it.
--
-- Idempotent: create ... if not exists, add column if not exists, drop constraint / policy /
-- trigger if exists before create, create or replace function. Safe to apply twice.

-- 1. Tables ---------------------------------------------------------------------------------

create table if not exists public.team_squads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  color text,
  note text,
  archived_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_squads_name_length check (char_length(name) between 1 and 60),
  constraint team_squads_note_length check (note is null or char_length(note) <= 280),
  constraint team_squads_color_known check (color is null or color in ('blue', 'green', 'yellow', 'coral', 'ink'))
);

create table if not exists public.team_squad_members (
  squad_id uuid not null references public.team_squads(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete cascade,
  added_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (squad_id, athlete_id)
);

-- Two live squads of one team cannot share a name. An archived squad frees its name.
create unique index if not exists team_squads_team_name_idx
on public.team_squads (team_id, lower(name))
where archived_at is null;

create index if not exists team_squads_tenant_idx on public.team_squads (tenant_id);
create index if not exists team_squad_members_athlete_idx on public.team_squad_members (athlete_id);
create index if not exists team_squad_members_team_idx on public.team_squad_members (team_id);

drop trigger if exists set_updated_at_team_squads on public.team_squads;
create trigger set_updated_at_team_squads
before update on public.team_squads
for each row
execute function public.set_updated_at();

-- 2. Keeping the rows honest ------------------------------------------------------------------

-- A squad takes its club from its team and never changes team.
create or replace function public.team_squads_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team record;
begin
  new.name := left(btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g')), 60);
  if new.name = '' then
    raise exception 'Give the squad a name.' using errcode = '23514';
  end if;
  new.note := nullif(left(btrim(coalesce(new.note, '')), 280), '');
  new.color := nullif(btrim(coalesce(new.color, '')), '');

  if tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'A squad stays on its team.' using errcode = '23514';
    end if;
    new.created_by_user_id := old.created_by_user_id;
    new.created_at := old.created_at;
    return new;
  end if;

  select t.id, t.tenant_id into v_team from public.teams t where t.id = new.team_id;
  if not found then
    raise exception 'Team not found.' using errcode = '23503';
  end if;
  new.tenant_id := v_team.tenant_id;
  new.archived_at := null;
  if auth.uid() is not null then
    new.created_by_user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists team_squads_normalise on public.team_squads;
create trigger team_squads_normalise
before insert or update on public.team_squads
for each row
execute function public.team_squads_normalise();

-- A member must be an active athlete of the squad's own team. The club and the team on the row
-- are copied from the squad, so they cannot be made up by the caller.
create or replace function public.team_squad_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_squad record;
  v_athlete record;
begin
  if tg_op = 'UPDATE' and (new.squad_id is distinct from old.squad_id or new.athlete_id is distinct from old.athlete_id) then
    raise exception 'Remove the athlete from the squad and add them again instead.' using errcode = '23514';
  end if;

  select s.id, s.tenant_id, s.team_id, s.archived_at into v_squad
  from public.team_squads s
  where s.id = new.squad_id;
  if not found then
    raise exception 'Squad not found.' using errcode = '23503';
  end if;
  if v_squad.archived_at is not null then
    raise exception 'This squad is archived.' using errcode = '23514';
  end if;

  select a.id, a.tenant_id, a.team_id, a.is_active into v_athlete
  from public.athletes a
  where a.id = new.athlete_id;
  if not found
     or v_athlete.tenant_id is distinct from v_squad.tenant_id
     or v_athlete.team_id is distinct from v_squad.team_id
     or not v_athlete.is_active then
    raise exception 'Only athletes on this team can be in its squads.' using errcode = '23514';
  end if;

  new.tenant_id := v_squad.tenant_id;
  new.team_id := v_squad.team_id;
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.added_by_user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists team_squad_members_guard on public.team_squad_members;
create trigger team_squad_members_guard
before insert or update on public.team_squad_members
for each row
execute function public.team_squad_members_guard();

-- 3. Who is in what -----------------------------------------------------------------------------

-- The live squads the signed-in athlete is in. Empty for everyone else.
create or replace function public.current_athlete_squad_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(m.squad_id), '{}'::uuid[])
  from public.team_squad_members m
  join public.team_squads s
    on s.id = m.squad_id
  join public.athletes a
    on a.id = m.athlete_id
   and a.team_id = s.team_id
  where m.athlete_id = public.current_athlete_id()
    and s.archived_at is null
$$;

-- True when the list is empty (the whole team) or the athlete is in one of those squads.
-- Internal: used by the test week rules below.
create or replace function public.squads_include_athlete(p_squad_ids uuid[], p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(cardinality(p_squad_ids), 0) = 0
    or exists (
      select 1
      from public.team_squad_members m
      join public.team_squads s
        on s.id = m.squad_id
      where m.squad_id = any (p_squad_ids)
        and m.athlete_id = p_athlete_id
        and s.archived_at is null
    )
$$;

-- 4. Row level security ---------------------------------------------------------------------------

alter table public.team_squads enable row level security;
alter table public.team_squad_members enable row level security;

drop policy if exists team_squads_select on public.team_squads;
create policy team_squads_select
on public.team_squads
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or team_id = any ((select public.current_coach_team_ids())::uuid[])
    or id = any ((select public.current_athlete_squad_ids())::uuid[])
  )
);

drop policy if exists team_squads_staff_write on public.team_squads;
create policy team_squads_staff_write
on public.team_squads
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
);

-- An athlete reads their own membership rows only. Teammates' memberships stay with the staff.
drop policy if exists team_squad_members_select on public.team_squad_members;
create policy team_squad_members_select
on public.team_squad_members
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or team_id = any ((select public.current_coach_team_ids())::uuid[])
    or athlete_id = (select public.current_athlete_id())
  )
);

drop policy if exists team_squad_members_staff_write on public.team_squad_members;
create policy team_squad_members_staff_write
on public.team_squad_members
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
);

revoke all on public.team_squads from anon;
revoke all on public.team_squad_members from anon;
grant select, insert, update, delete on public.team_squads to authenticated;
grant select, insert, delete on public.team_squad_members to authenticated;
grant all on public.team_squads to service_role;
grant all on public.team_squad_members to service_role;

-- 5. Plans for squads -----------------------------------------------------------------------------

alter table public.training_plan_assignments
  add column if not exists squad_id uuid references public.team_squads(id) on delete cascade;

alter table public.training_plan_assignments drop constraint if exists training_plan_assignments_scope_check;
alter table public.training_plan_assignments
  add constraint training_plan_assignments_scope_check check (scope in ('team', 'athlete', 'squad'));

alter table public.training_plan_assignments drop constraint if exists training_plan_assignments_check;
alter table public.training_plan_assignments
  add constraint training_plan_assignments_check check (
    (scope = 'team' and team_id is not null and athlete_id is null and squad_id is null)
    or (scope = 'athlete' and athlete_id is not null and squad_id is null)
    or (scope = 'squad' and squad_id is not null and team_id is null and athlete_id is null)
  );

create unique index if not exists training_plan_assignments_plan_squad_idx
on public.training_plan_assignments (plan_id, squad_id)
where scope = 'squad';

create index if not exists training_plan_assignments_squad_idx
on public.training_plan_assignments (squad_id);

-- A plan can only go to a live squad of the plan's own team. With the write policy (the caller
-- must manage the plan, so coach the plan's team) this means a coach can only assign to squads
-- of a team they coach.
create or replace function public.training_plan_assignments_squad_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_squad record;
  v_plan record;
begin
  if new.scope is distinct from 'squad' then
    return new;
  end if;

  select s.id, s.tenant_id, s.team_id, s.archived_at into v_squad
  from public.team_squads s
  where s.id = new.squad_id;
  select tp.id, tp.tenant_id, tp.team_id into v_plan
  from public.training_plans tp
  where tp.id = new.plan_id;

  if v_squad.id is null or v_plan.id is null
     or v_squad.tenant_id is distinct from new.tenant_id
     or v_plan.tenant_id is distinct from new.tenant_id
     or v_plan.team_id is distinct from v_squad.team_id then
    raise exception 'A plan can only be sent to squads of the plan''s own team.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and v_squad.archived_at is not null then
    raise exception 'This squad is archived.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists training_plan_assignments_squad_guard on public.training_plan_assignments;
create trigger training_plan_assignments_squad_guard
before insert or update of scope, squad_id, plan_id, tenant_id on public.training_plan_assignments
for each row
execute function public.training_plan_assignments_squad_guard();

-- The select policy of 20261006120000 with one more way in for an athlete: a squad they are in.
drop policy if exists training_plan_assignments_select_own_or_staff on public.training_plan_assignments;
create policy training_plan_assignments_select_own_or_staff
on public.training_plan_assignments
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or athlete_id in (
      select a.id
      from public.athletes a
      where a.user_id = auth.uid()
        and a.tenant_id = public.current_tenant_id()
    )
    or team_id in (
      select a.team_id
      from public.athletes a
      where a.user_id = auth.uid()
        and a.tenant_id = public.current_tenant_id()
    )
    or (squad_id is not null and squad_id = any ((select public.current_athlete_squad_ids())::uuid[]))
    or public.can_manage_training_plan(plan_id)
  )
);

-- Published plans assigned to the signed-in athlete: directly, through their current team, or
-- (new) through a squad they are in now. (20261006150000 with the third branch added.)
create or replace function public.current_athlete_plan_ids()
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
  assigned as (
    select tpa.plan_id
    from me
    join public.training_plan_assignments tpa
      on tpa.athlete_id = me.id
     and tpa.tenant_id = me.tenant_id
    union
    select tpa.plan_id
    from me
    join public.training_plan_assignments tpa
      on tpa.team_id = me.team_id
     and tpa.tenant_id = me.tenant_id
    union
    select tpa.plan_id
    from me
    join public.team_squad_members m
      on m.athlete_id = me.id
     and m.team_id = me.team_id
    join public.team_squads s
      on s.id = m.squad_id
     and s.archived_at is null
    join public.training_plan_assignments tpa
      on tpa.squad_id = m.squad_id
     and tpa.scope = 'squad'
     and tpa.tenant_id = me.tenant_id
  )
  select coalesce(array_agg(tp.id), '{}'::uuid[])
  from assigned
  join public.training_plans tp
    on tp.id = assigned.plan_id
  where tp.status = 'published'
    and tp.tenant_id = (select me.tenant_id from me)
$$;

-- The publish notice (20261007090000), unchanged except that a squad assignment tells the squad's
-- members.
create or replace function public.notify_training_plan_audience(
  p_plan_id uuid,
  p_event_type text,
  p_assignment_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_team_name text;
  v_recipient record;
  v_subject text;
  v_body text;
  v_count integer := 0;
begin
  select tp.id, tp.tenant_id, tp.team_id, tp.name, tp.start_date, tp.status
  into v_plan
  from public.training_plans tp
  where tp.id = p_plan_id;

  -- Athletes cannot see a plan that is not published, so they are not told about it.
  if not found or v_plan.status <> 'published' then
    return 0;
  end if;

  select tm.name into v_team_name from public.teams tm where tm.id = v_plan.team_id;

  if p_event_type = 'training_plan_updated' then
    v_subject := format('Your plan changed: %s', coalesce(nullif(btrim(v_plan.name), ''), 'Training plan'));
    v_body := 'Your coach updated the plan. Open it to see what is different.';
  else
    v_subject := format('New training plan: %s', coalesce(nullif(btrim(v_plan.name), ''), 'Training plan'));
    v_body := format(
      'Your coach published a plan for %s%s.',
      case when v_team_name is null then 'you' else v_team_name end,
      case when v_plan.start_date is null then '' else format('. It starts on %s', public.notification_date_label(v_plan.start_date)) end
    );
  end if;

  for v_recipient in
    select distinct a.user_id
    from public.training_plan_assignments tpa
    join public.athletes a
      on a.tenant_id = tpa.tenant_id
     and (
       (tpa.scope = 'athlete' and a.id = tpa.athlete_id)
       or (tpa.scope = 'team' and a.team_id = tpa.team_id)
       or (
         tpa.scope = 'squad'
         and exists (
           select 1
           from public.team_squad_members m
           join public.team_squads sq on sq.id = m.squad_id
           where m.squad_id = tpa.squad_id
             and m.athlete_id = a.id
             and sq.archived_at is null
         )
       )
     )
    where tpa.plan_id = v_plan.id
      and tpa.tenant_id = v_plan.tenant_id
      and tpa.visibility_start = 'immediate'
      and (p_assignment_id is null or tpa.id = p_assignment_id)
      and a.user_id is not null
      and a.is_active
  loop
    v_count := v_count + public.enqueue_notification(
      v_plan.tenant_id,
      v_recipient.user_id,
      p_event_type,
      v_subject,
      v_body,
      jsonb_build_object('plan_id', v_plan.id::text, 'team_id', v_plan.team_id::text),
      array['in-app', 'email'],
      'plan:' || v_plan.id::text,
      interval '1 hour'
    );
  end loop;

  return v_count;
end;
$$;
revoke all on function public.notify_training_plan_audience(uuid, text, uuid) from public, anon, authenticated;

-- When a membership ends: the athlete stops getting NEW sessions from plans that only reached
-- them through that squad. Their upcoming sessions of those plans that they have not touched are
-- removed. A session they started or finished, and anything in the past, stays as it is. A plan
-- that still reaches them another way (the whole team, another of their squads, or by name) is
-- left alone.
create or replace function public.squad_prune_member_sessions(p_athlete_id uuid, p_squad_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer := 0;
begin
  with removed as (
    delete from public.sessions s
    where s.athlete_id = p_athlete_id
      and s.status = 'scheduled'
      and s.scheduled_for >= current_date
      and s.plan_id is not null
      and exists (
        select 1 from public.training_plan_assignments tpa
        where tpa.plan_id = s.plan_id and tpa.scope = 'squad' and tpa.squad_id = p_squad_id
      )
      and not exists (
        select 1
        from public.training_plan_assignments tpa
        join public.athletes a on a.id = s.athlete_id
        where tpa.plan_id = s.plan_id
          and (
            (tpa.scope = 'athlete' and tpa.athlete_id = a.id)
            or (tpa.scope = 'team' and tpa.team_id = a.team_id)
            or (
              tpa.scope = 'squad'
              and tpa.squad_id <> p_squad_id
              and exists (
                select 1
                from public.team_squad_members m
                join public.team_squads sq on sq.id = m.squad_id
                where m.squad_id = tpa.squad_id
                  and m.athlete_id = a.id
                  and sq.archived_at is null
              )
            )
          )
      )
      and not exists (select 1 from public.session_completions sc where sc.session_id = s.id)
      and not exists (select 1 from public.session_row_logs l where l.session_id = s.id)
    returning 1
  )
  select count(*)::int into v_removed from removed;
  return v_removed;
end;
$$;

revoke all on function public.squad_prune_member_sessions(uuid, uuid) from public, anon, authenticated;

create or replace function public.team_squad_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.squad_prune_member_sessions(old.athlete_id, old.squad_id);
  return old;
end;
$$;

drop trigger if exists team_squad_members_after_delete on public.team_squad_members;
create trigger team_squad_members_after_delete
after delete on public.team_squad_members
for each row
execute function public.team_squad_members_after_delete();

-- Archiving a squad ends its memberships (which prunes sessions, above). Deleting one does the
-- same first, while its plan assignments still say which sessions came from it.
create or replace function public.team_squads_end_memberships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.team_squad_members m where m.squad_id = old.id;
    return old;
  end if;
  if new.archived_at is not null and old.archived_at is null then
    delete from public.team_squad_members m where m.squad_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists team_squads_end_memberships_on_archive on public.team_squads;
create trigger team_squads_end_memberships_on_archive
after update of archived_at on public.team_squads
for each row
execute function public.team_squads_end_memberships();

drop trigger if exists team_squads_end_memberships_on_delete on public.team_squads;
create trigger team_squads_end_memberships_on_delete
before delete on public.team_squads
for each row
execute function public.team_squads_end_memberships();

-- An athlete who moves team, is taken off their team or is deactivated leaves the squads of the
-- team they were on. Runs for every way the team can change (move, remove, a club admin's edit).
create or replace function public.athletes_end_squad_memberships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.team_squad_members m
  where m.athlete_id = new.id
    and (not new.is_active or new.team_id is null or m.team_id <> new.team_id);
  return new;
end;
$$;

drop trigger if exists athletes_end_squad_memberships on public.athletes;
create trigger athletes_end_squad_memberships
after update of team_id, is_active on public.athletes
for each row
when (old.team_id is distinct from new.team_id or (old.is_active and not new.is_active))
execute function public.athletes_end_squad_memberships();

revoke all on function public.team_squads_normalise() from public, anon, authenticated;
revoke all on function public.team_squad_members_guard() from public, anon, authenticated;
revoke all on function public.training_plan_assignments_squad_guard() from public, anon, authenticated;
revoke all on function public.team_squad_members_after_delete() from public, anon, authenticated;
revoke all on function public.team_squads_end_memberships() from public, anon, authenticated;
revoke all on function public.athletes_end_squad_memberships() from public, anon, authenticated;
revoke all on function public.current_athlete_squad_ids() from public, anon;
revoke all on function public.squads_include_athlete(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.current_athlete_squad_ids() to authenticated, service_role;
grant execute on function public.squads_include_athlete(uuid[], uuid) to service_role;

-- 6. Test weeks for squads ------------------------------------------------------------------------

-- Empty means the whole team.
alter table public.test_weeks
  add column if not exists squad_ids uuid[] not null default '{}'::uuid[];

-- Every chosen squad must be a squad of the test week's own team.
create or replace function public.test_weeks_squads_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.squad_ids := coalesce((select array_agg(distinct x order by x) from unnest(new.squad_ids) as x where x is not null), '{}'::uuid[]);
  if cardinality(new.squad_ids) = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.squad_ids = old.squad_ids and new.team_id is not distinct from old.team_id then
    return new;
  end if;
  if new.team_id is null or exists (
    select 1
    from unnest(new.squad_ids) as x
    left join public.team_squads s
      on s.id = x
     and s.team_id = new.team_id
     and s.tenant_id = new.tenant_id
    where s.id is null
  ) then
    raise exception 'A test week can only be for squads of its own team.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists test_weeks_squads_guard on public.test_weeks;
create trigger test_weeks_squads_guard
before insert or update of squad_ids, team_id on public.test_weeks
for each row
execute function public.test_weeks_squads_guard();

revoke all on function public.test_weeks_squads_guard() from public, anon, authenticated;

-- 20261006150000 with the squad check added: a week for chosen squads is only for their members.
-- A week the athlete already has a result in stays readable, as before.
create or replace function public.current_athlete_test_week_ids()
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
  weeks as (
    select tw.id
    from me
    join public.test_weeks tw
      on tw.team_id = me.team_id
     and tw.tenant_id = me.tenant_id
    where tw.status in ('published', 'closed')
      and not tw.is_archived
      and public.squads_include_athlete(tw.squad_ids, me.id)
    union
    select tr.test_week_id
    from me
    join public.test_results tr
      on tr.tenant_id = me.tenant_id
     and tr.athlete_id = me.id
  )
  select coalesce(array_agg(weeks.id), '{}'::uuid[])
  from weeks
$$;

-- 20261006150000 with the squad check added.
create or replace function public.athlete_can_enter_test_result(
  p_test_week_id uuid,
  p_test_definition_id uuid,
  p_athlete_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_athlete_id is not null
    and p_athlete_id = public.current_athlete_id()
    and exists (
      select 1
      from public.athletes a
      join public.test_weeks tw
        on tw.team_id = a.team_id
       and tw.tenant_id = a.tenant_id
      join public.test_definitions td
        on td.test_week_id = tw.id
      where a.id = p_athlete_id
        and tw.id = p_test_week_id
        and td.id = p_test_definition_id
        and tw.status = 'published'
        and not tw.is_archived
        and tw.start_date <= (now() at time zone 'utc')::date + 1
        and public.squads_include_athlete(tw.squad_ids, a.id)
    )
$$;

-- The reopen notice and the publish notice (20261009100000), each with one more condition on who
-- is told: the athlete must be in the week's audience.
create or replace function public.test_weeks_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := coalesce(nullif(left(btrim(new.name), 160), ''), 'Test week');
  v_reopened boolean := old.status = 'closed' and new.status = 'published';
  v_recipient record;
begin
  if not v_reopened and not (old.status = 'published' and new.status = 'closed') then
    return new;
  end if;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    new.tenant_id,
    auth.uid(),
    coalesce(public.current_app_role(), 'system'),
    case when v_reopened then 'test_week_reopened' else 'test_week_closed' end,
    v_name,
    case
      when v_reopened then 'Reopened. Athletes can enter and change results again.'
      else 'Closed. Athletes can no longer enter or change results.'
    end
  );

  if v_reopened and not new.is_archived and new.team_id is not null then
    for v_recipient in
      select distinct a.user_id
      from public.athletes a
      where a.team_id = new.team_id
        and a.tenant_id = new.tenant_id
        and a.user_id is not null
        and a.is_active
        and public.squads_include_athlete(new.squad_ids, a.id)
    loop
      perform public.enqueue_notification(
        new.tenant_id,
        v_recipient.user_id,
        'test_week_reopened',
        format('Test week reopened: %s', v_name),
        'Your coach reopened this test week. You can enter or change your results again.',
        jsonb_build_object('test_week_id', new.id::text, 'team_id', new.team_id::text),
        array['in-app'],
        'test_week_reopened:' || new.id::text,
        interval '10 minutes'
      );
    end loop;
  end if;

  return new;
end;
$$;

create or replace function public.enqueue_test_week_published_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_name text;
  v_recipient record;
begin
  if tg_op = 'UPDATE' and old.status = 'closed' then
    return new;
  end if;

  if new.status <> 'published' or new.is_archived or new.team_id is null then
    return new;
  end if;

  select tm.name into v_team_name from public.teams tm where tm.id = new.team_id;

  for v_recipient in
    select distinct a.user_id
    from public.athletes a
    where a.team_id = new.team_id
      and a.tenant_id = new.tenant_id
      and a.user_id is not null
      and a.is_active
      and public.squads_include_athlete(new.squad_ids, a.id)
  loop
    perform public.enqueue_notification(
      new.tenant_id,
      v_recipient.user_id,
      'test_week_published',
      format('Test week: %s', coalesce(nullif(btrim(new.name), ''), 'Test week')),
      format(
        'Your coach opened a test week%s. It runs from %s to %s.',
        case when v_team_name is null then '' else format(' for %s', v_team_name) end,
        public.notification_date_label(new.start_date),
        public.notification_date_label(new.end_date)
      ),
      jsonb_build_object('test_week_id', new.id::text, 'team_id', new.team_id::text),
      array['in-app', 'email'],
      'test_week:' || new.id::text,
      interval '1 day'
    );
  end loop;

  return new;
end;
$$;
revoke all on function public.test_weeks_status_changed() from public, anon, authenticated;
revoke all on function public.enqueue_test_week_published_notifications() from public, anon, authenticated;

-- The "test week closes today" reminder (run_reminders, 20261011120000) lists the athletes of the
-- week's team. That function is several hundred lines and this migration only needs one more
-- condition in it, so the condition is added to the function as it stands instead of repeating
-- the whole body here. Nothing happens when it is already there (second run) or when the line it
-- attaches to is no longer in the function (a later rewrite, which must then carry the condition).
do $$
declare
  v_proc regprocedure;
  v_def text;
  v_anchor constant text := 'and a.team_id = v_row.team_id';
  v_added constant text := 'and a.team_id = v_row.team_id and public.squads_include_athlete((select tw2.squad_ids from public.test_weeks tw2 where tw2.id = v_row.id), a.id)';
begin
  select p.oid::regprocedure into v_proc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'run_reminders'
  limit 1;
  if v_proc is null then
    raise notice 'run_reminders not found, test week reminder left as it is';
    return;
  end if;
  v_def := pg_get_functiondef(v_proc);
  if position('squads_include_athlete' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise notice 'run_reminders has changed, test week reminder left as it is';
    return;
  end if;
  execute replace(v_def, v_anchor, v_added);
end;
$$;

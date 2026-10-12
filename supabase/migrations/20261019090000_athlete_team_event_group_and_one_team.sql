-- Athletes and their team (Kash, 12 Oct 2026):
--
-- 1. An athlete's event group follows their team. Joining a Throws team with a code or an invite
--    left the athlete's own event group empty, so plans, filters and results that go by event group
--    did not know they throw. Now the team's group is copied onto the athlete whenever they are
--    added to a team or moved to another one, unless the athlete already has a different group of
--    their own (someone on a Throws team who has been set to Jumps keeps Jumps).
-- 2. When a club admin changes a team's event group, athletes who had the old group (or none)
--    follow it.
-- 3. Athletes already on a team with no event group get their team's group now.
-- 4. An athlete is on one team at a time and does not move themselves. Accepting an invite from
--    another team used to move them; it now refuses, like the join code already did.

create or replace function public.athlete_event_group_from_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_group text;
  v_old_group text;
begin
  if new.team_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.team_id is not distinct from old.team_id then
    return new;
  end if;

  select t.event_group into v_new_group from public.teams t where t.id = new.team_id;
  if v_new_group is null or v_new_group not in ('Sprint', 'Mid', 'Distance', 'Jumps', 'Throws') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.team_id is not null then
    select t.event_group into v_old_group from public.teams t where t.id = old.team_id;
  end if;

  -- Fill an empty group, or follow the team when the athlete's group was just the old team's.
  if new.event_group is null or (tg_op = 'UPDATE' and new.event_group is not distinct from old.event_group and old.event_group is not distinct from v_old_group) then
    new.event_group := v_new_group;
  end if;
  return new;
end;
$$;

drop trigger if exists athletes_event_group_from_team on public.athletes;
create trigger athletes_event_group_from_team
before insert or update of team_id on public.athletes
for each row execute function public.athlete_event_group_from_team();

create or replace function public.team_event_group_to_athletes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_group is not distinct from old.event_group then
    return new;
  end if;
  if new.event_group is null or new.event_group not in ('Sprint', 'Mid', 'Distance', 'Jumps', 'Throws') then
    return new;
  end if;
  update public.athletes a
  set event_group = new.event_group,
      updated_at = now()
  where a.team_id = new.id
    and (a.event_group is null or a.event_group is not distinct from old.event_group);
  return new;
end;
$$;

drop trigger if exists teams_event_group_to_athletes on public.teams;
create trigger teams_event_group_to_athletes
after update of event_group on public.teams
for each row execute function public.team_event_group_to_athletes();

-- Athletes already on a team with no event group of their own.
update public.athletes a
set event_group = t.event_group,
    updated_at = now()
from public.teams t
where a.team_id = t.id
  and a.event_group is null
  and t.event_group in ('Sprint', 'Mid', 'Distance', 'Jumps', 'Throws');

-- Accepting an invite no longer moves an athlete who is already on another team.
-- Same as 20261009090000_roster_bulk_join_codes_managed_athletes.sql, with the check marked NEW.
create or replace function public.accept_athlete_invite(
  p_invite_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_has_profile boolean;
  v_invite public.athlete_invites%rowtype;
  v_athlete public.athletes%rowtype;
  v_managed public.athletes%rowtype;
  v_user_email text;
  v_invite_email text;
  v_meta_name text;
  v_display_name text;
  v_first_name text;
  v_last_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    lower(btrim(coalesce(au.email, ''))),
    nullif(
      btrim(
        coalesce(
          au.raw_user_meta_data ->> 'display_name',
          au.raw_user_meta_data ->> 'full_name',
          au.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      ''
    )
  into v_user_email, v_meta_name
  from auth.users au
  where au.id = v_user_id
    and au.email_confirmed_at is not null;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  v_has_profile := found;

  if v_has_profile and v_profile.role <> 'athlete' then
    raise exception 'Only athlete users can accept athlete invites';
  end if;

  select *
  into v_invite
  from public.athlete_invites ai
  where ai.id = p_invite_id
  limit 1
  for update;

  if not found then
    raise exception 'Invite not found';
  end if;

  -- Lifecycle guard (20261006180000). An invite of a suspended or cancelled club
  -- cannot be accepted by anyone, new or existing. A deactivated athlete cannot use
  -- any invite (a team join code included) to move team or switch themselves back
  -- on: only the club admin restores an athlete.
  if public.tenant_access_blocked(v_invite.tenant_id)
     or (v_has_profile and not v_profile.is_active) then
    perform public.raise_access_paused();
  end if;

  v_invite_email := nullif(lower(btrim(coalesce(v_invite.email, ''))), '');

  if not v_has_profile and v_invite_email is null then
    -- A join code is not addressed to anyone, so it cannot create an account.
    raise exception 'Profile not found';
  end if;

  if v_has_profile and v_invite.tenant_id <> v_profile.tenant_id then
    raise exception 'Invite does not belong to your tenant';
  end if;

  if v_invite.status = 'accepted' and v_invite.accepted_by_user_id = v_user_id and v_has_profile then
    return v_invite.team_id;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'Invite is not pending';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Invite has expired';
  end if;

  if v_invite_email is not null and v_invite_email <> coalesce(v_user_email, '') then
    raise exception 'This invite is for a different email address';
  end if;

  -- NEW: "give them a login". The invite points at a managed athlete: link the caller to that
  -- row, with all its history, instead of creating a second one.
  if v_invite.athlete_id is not null then
    if v_invite_email is null then
      -- A login invite is always addressed. One that is not was not made by the function.
      raise exception 'Invite not found';
    end if;

    select *
    into v_managed
    from public.athletes a
    where a.id = v_invite.athlete_id
    for update;

    -- Still the same managed athlete, on the team the invite was made for.
    if not found
       or v_managed.tenant_id <> v_invite.tenant_id
       or v_managed.user_id is not null
       or not v_managed.is_active
       or v_managed.team_id is distinct from v_invite.team_id then
      raise exception 'Invite is not pending';
    end if;

    if exists (
      select 1
      from public.athletes a
      where a.user_id = v_user_id
        and a.tenant_id = v_invite.tenant_id
    ) then
      raise exception 'Your account already has an athlete record in this club. Ask your coach for help.';
    end if;

    if not v_has_profile then
      insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
      values (
        v_user_id,
        v_invite.tenant_id,
        'athlete',
        coalesce(v_meta_name, nullif(btrim(v_managed.first_name || ' ' || v_managed.last_name), '')),
        true
      )
      returning *
      into v_profile;
    end if;

    update public.athletes
    set user_id = v_user_id,
        login_linked_at = now(),
        updated_at = now()
    where id = v_managed.id;

    update public.athlete_invites
    set status = 'accepted',
        accepted_by_user_id = v_user_id,
        accepted_at = now(),
        updated_at = now()
    where id = v_invite.id;

    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (
      v_invite.tenant_id,
      v_user_id,
      'athlete',
      'managed_athlete_login_linked',
      v_managed.id::text,
      'login linked to an existing athlete record through invite ' || v_invite.id::text
    );

    return v_invite.team_id;
  end if;

  if not v_has_profile then
    insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
    -- NEW: the name the coach typed on the invite, when the account brings none.
    values (v_user_id, v_invite.tenant_id, 'athlete', coalesce(v_meta_name, nullif(btrim(coalesce(v_invite.invitee_name, '')), '')), true)
    returning *
    into v_profile;
  end if;

  select *
  into v_athlete
  from public.athletes a
  where a.user_id = v_user_id
    and a.tenant_id = v_profile.tenant_id
  limit 1;

  -- NEW: an athlete is on one team at a time, and only a coach or the club moves them. An invite
  -- from another team no longer moves someone who is already on a team (the join code refuses the
  -- same thing with 'other_team').
  if found and v_athlete.team_id is not null and v_athlete.team_id is distinct from v_invite.team_id then
    raise exception 'You are already on another team. Only a coach or your club can move you between teams.';
  end if;

  if not found then
    v_display_name := coalesce(nullif(btrim(coalesce(v_profile.display_name, '')), ''), v_meta_name, 'Athlete User');

    v_first_name := split_part(v_display_name, ' ', 1);
    v_last_name := nullif(btrim(substr(v_display_name, length(v_first_name) + 1)), '');
    if v_last_name is null then
      v_last_name := 'Athlete';
    end if;

    insert into public.athletes (
      tenant_id,
      user_id,
      team_id,
      first_name,
      last_name,
      event_group,
      primary_event,
      readiness,
      is_active
    )
    values (
      v_profile.tenant_id,
      v_user_id,
      v_invite.team_id,
      v_first_name,
      v_last_name,
      null,
      null,
      'yellow',
      true
    )
    returning *
    into v_athlete;
  end if;

  update public.athletes
  set team_id = v_invite.team_id,
      is_active = true,
      updated_at = now()
  where id = v_athlete.id;

  update public.athlete_invites
  set status = 'accepted',
      accepted_by_user_id = v_user_id,
      accepted_at = now(),
      updated_at = now()
  where id = v_invite.id;

  insert into public.audit_events (
    tenant_id,
    actor_user_id,
    actor_role,
    action,
    target,
    detail
  )
  values (
    v_invite.tenant_id,
    v_user_id,
    'athlete',
    'athlete_invite_accept',
    coalesce(nullif(v_user_email, ''), v_user_id::text),
    'joined team ' || v_invite.team_id::text
  );

  return v_invite.team_id;
end;
$$;


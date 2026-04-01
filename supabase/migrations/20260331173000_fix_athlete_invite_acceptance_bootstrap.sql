-- Athlete invite acceptance should self-heal missing athlete rows
-- Created: 2026-03-31

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
  v_invite public.athlete_invites%rowtype;
  v_athlete public.athletes%rowtype;
  v_user_email text;
  v_display_name text;
  v_first_name text;
  v_last_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role <> 'athlete' then
    raise exception 'Only athlete users can accept athlete invites';
  end if;

  select *
  into v_invite
  from public.athlete_invites ai
  where ai.id = p_invite_id
  limit 1;

  if not found then
    raise exception 'Invite not found';
  end if;

  if v_invite.tenant_id <> v_profile.tenant_id then
    raise exception 'Invite does not belong to your tenant';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'Invite is not pending';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    update public.athlete_invites
    set status = 'expired',
        updated_at = now()
    where id = v_invite.id;

    raise exception 'Invite has expired';
  end if;

  select lower(coalesce(email, '')) into v_user_email from auth.users where id = v_user_id;

  if nullif(trim(coalesce(v_invite.email, '')), '') is not null
     and lower(trim(v_invite.email)) <> lower(coalesce(v_user_email, '')) then
    raise exception 'This invite is for a different email address';
  end if;

  select *
  into v_athlete
  from public.athletes a
  where a.user_id = v_user_id
    and a.tenant_id = v_profile.tenant_id
  limit 1;

  if not found then
    v_display_name := nullif(trim(coalesce(v_profile.display_name, '')), '');
    if v_display_name is null then
      select
        nullif(
          trim(
            coalesce(raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', '')
          ),
          ''
        )
      into v_display_name
      from auth.users
      where id = v_user_id;
    end if;

    if v_display_name is null then
      v_display_name := 'Athlete User';
    end if;

    v_first_name := split_part(v_display_name, ' ', 1);
    v_last_name := nullif(trim(substr(v_display_name, length(v_first_name) + 1)), '');
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
    coalesce(v_user_email, v_user_id::text),
    'joined team ' || v_invite.team_id::text
  );

  return v_invite.team_id;
end;
$$;

grant execute on function public.accept_athlete_invite(uuid) to authenticated;

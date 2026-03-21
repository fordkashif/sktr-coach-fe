-- Coach invite acceptance RPC
-- Created: 2026-03-21

create or replace function public.accept_coach_invite(
  p_invite_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite public.coach_invites%rowtype;
  v_profile public.profiles%rowtype;
  v_display_name text;
  v_role text;
  v_target text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select lower(coalesce(au.email, ''))
  into v_user_email
  from auth.users au
  where au.id = v_user_id;

  if v_user_email is null or v_user_email = '' then
    raise exception 'Authenticated user email not found';
  end if;

  select *
  into v_invite
  from public.coach_invites ci
  where ci.id = p_invite_id
  limit 1;

  if not found then
    raise exception 'Invite not found';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'Invite is not pending';
  end if;

  if lower(v_invite.email) <> v_user_email then
    raise exception 'Invite email does not match signed-in user';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    update public.coach_invites
    set status = 'expired',
        updated_at = now()
    where id = v_invite.id;
    raise exception 'Invite has expired';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  v_role := coalesce(v_invite.role, 'coach');
  if v_role not in ('coach', 'club-admin') then
    v_role := 'coach';
  end if;

  if found then
    if v_profile.tenant_id <> v_invite.tenant_id then
      raise exception 'User already belongs to another tenant';
    end if;

    if v_profile.role <> v_role then
      update public.profiles
      set role = v_role,
          is_active = true,
          updated_at = now()
      where user_id = v_user_id;
    else
      update public.profiles
      set is_active = true,
          updated_at = now()
      where user_id = v_user_id;
    end if;
  else
    v_display_name := nullif(coalesce(v_invite.metadata ->> 'display_name', ''), '');

    insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
    values (v_user_id, v_invite.tenant_id, v_role, v_display_name, true);
  end if;

  update public.coach_invites
  set status = 'accepted',
      accepted_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('accepted_user_id', v_user_id::text),
      updated_at = now()
  where id = v_invite.id;

  v_target := coalesce(v_user_email, v_user_id::text);

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
    v_role,
    'coach_invite_accept',
    v_target,
    case
      when v_invite.team_id is null then 'accepted without team'
      else 'accepted for team ' || v_invite.team_id::text
    end
  );

  return v_invite.tenant_id;
end;
$$;

grant execute on function public.accept_coach_invite(uuid) to authenticated;

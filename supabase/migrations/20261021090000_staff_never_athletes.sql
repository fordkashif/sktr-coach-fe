-- Staff are never made athletes.
--
-- The People screen offered "Make athlete" for coaches and club admins. A club admin or coach is
-- never an athlete: athletes join a team with their own athlete record. The screen no longer offers
-- it, and the database now refuses it too. Everything else in this function is unchanged
-- (copied from 20261006180000_definer_functions_respect_lifecycle.sql).

create or replace function public.set_tenant_member_access(
  p_user_id uuid,
  p_role text,
  p_is_active boolean
)
returns table (user_id uuid, role text, is_active boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_caller public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_other_active_admins int;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_caller
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found or v_caller.role <> 'club-admin' or not v_caller.is_active then
    raise exception 'Only active club-admin users can change member access';
  end if;

  if p_user_id is null then
    raise exception 'Member is required';
  end if;

  if p_role is null or p_role not in ('athlete', 'coach', 'club-admin') then
    raise exception 'Role must be athlete, coach or club-admin';
  end if;

  if p_is_active is null then
    raise exception 'Active flag is required';
  end if;

  -- Lock every club-admin row of the tenant (in a stable order) so two admins
  -- demoting each other at the same time cannot both pass the last-admin check.
  perform 1
  from public.profiles p
  where p.tenant_id = v_caller.tenant_id
    and p.role = 'club-admin'
  order by p.user_id
  for update;

  -- Re-read the caller now that the locks are held: a concurrent call may have
  -- demoted or deactivated them while this one was waiting.
  select *
  into v_caller
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found or v_caller.role <> 'club-admin' or not v_caller.is_active then
    raise exception 'Only active club-admin users can change member access';
  end if;

  select *
  into v_target
  from public.profiles p
  where p.user_id = p_user_id
    and p.tenant_id = v_caller.tenant_id
  for update;

  if not found then
    -- Same message for "does not exist" and "belongs to another club".
    raise exception 'Member not found in this club';
  end if;

  if v_target.user_id = auth.uid()
     and (p_role <> v_target.role or p_is_active is distinct from v_target.is_active) then
    raise exception 'You cannot change your own role or deactivate yourself';
  end if;

  -- Staff (coaches and club admins) are never turned into athletes. An athlete is a person on a
  -- team with their own athlete record, joined through an invite or a join code.
  if p_role = 'athlete' and v_target.role in ('coach', 'club-admin') then
    raise exception 'Staff cannot be made athletes';
  end if;

  if v_target.role = 'club-admin' and v_target.is_active
     and (p_role <> 'club-admin' or not p_is_active) then
    select count(*)
    into v_other_active_admins
    from public.profiles p
    where p.tenant_id = v_caller.tenant_id
      and p.role = 'club-admin'
      and p.is_active
      and p.user_id <> v_target.user_id;

    if v_other_active_admins = 0 then
      raise exception 'A club must keep at least one active club-admin';
    end if;
  end if;

  update public.profiles p
  set role = p_role,
      is_active = p_is_active,
      updated_at = now()
  where p.user_id = v_target.user_id
    and p.tenant_id = v_caller.tenant_id;

  if p_role = 'athlete' and v_target.role <> 'athlete' then
    delete from public.team_coaches tc
    where tc.user_id = v_target.user_id
      and tc.tenant_id = v_caller.tenant_id;
  end if;

  return query
  select p.user_id, p.role, p.is_active
  from public.profiles p
  where p.user_id = v_target.user_id
    and p.tenant_id = v_caller.tenant_id;
end;
$$;

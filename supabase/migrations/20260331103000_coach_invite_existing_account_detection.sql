-- Coach invite claim should resolve account existence automatically
-- Created: 2026-03-31

drop function if exists public.get_public_coach_invite(uuid);

create or replace function public.get_public_coach_invite(
  p_invite_id uuid
)
returns table (
  invite_id uuid,
  email text,
  status text,
  tenant_id uuid,
  organization_name text,
  team_id uuid,
  team_name text,
  has_existing_account boolean
)
language sql
security definer
set search_path = public
as $$
  select
    ci.id as invite_id,
    ci.email,
    ci.status,
    ci.tenant_id,
    t.name as organization_name,
    ci.team_id,
    tm.name as team_name,
    exists(
      select 1
      from auth.users au
      where lower(coalesce(au.email, '')) = lower(ci.email)
    ) as has_existing_account
  from public.coach_invites ci
  join public.tenants t on t.id = ci.tenant_id
  left join public.teams tm on tm.id = ci.team_id
  where ci.id = p_invite_id
  limit 1
$$;

grant execute on function public.get_public_coach_invite(uuid) to anon, authenticated;

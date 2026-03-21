-- Athlete invite lifecycle
-- Created: 2026-03-21

create table if not exists public.athlete_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'expired', 'revoked')) default 'pending',
  invited_by_user_id uuid references auth.users(id) on delete set null,
  accepted_by_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists athlete_invites_tenant_status_idx
on public.athlete_invites (tenant_id, status, created_at desc);

create index if not exists athlete_invites_team_idx
on public.athlete_invites (team_id, status, created_at desc);

drop trigger if exists set_updated_at_athlete_invites on public.athlete_invites;
create trigger set_updated_at_athlete_invites
before update on public.athlete_invites
for each row
execute function public.set_updated_at();

alter table public.athlete_invites enable row level security;

drop policy if exists athlete_invites_select_tenant on public.athlete_invites;
create policy athlete_invites_select_tenant
on public.athlete_invites
for select
to authenticated
using (tenant_id = public.current_tenant_id());

drop policy if exists athlete_invites_staff_all on public.athlete_invites;
create policy athlete_invites_staff_all
on public.athlete_invites
for all
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id())
with check (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());

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

  select *
  into v_athlete
  from public.athletes a
  where a.user_id = v_user_id
    and a.tenant_id = v_profile.tenant_id
  limit 1;

  if not found then
    raise exception 'Athlete profile record not found';
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

  select lower(coalesce(email, '')) into v_user_email from auth.users where id = v_user_id;

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

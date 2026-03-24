-- Athlete invite claim + onboarding
-- Created: 2026-03-24

alter table public.profiles
  add column if not exists password_set_at timestamptz,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists setup_guide_dismissed_at timestamptz;

update public.profiles
set password_set_at = coalesce(password_set_at, now()),
    onboarding_completed_at = coalesce(onboarding_completed_at, now())
where role = 'athlete';

create or replace function public.get_public_athlete_invite(
  p_invite_id uuid
)
returns table (
  invite_id uuid,
  tenant_id uuid,
  team_id uuid,
  team_name text,
  organization_name text,
  event_group text,
  status text
)
language sql
security definer
set search_path = public
as $$
  select
    ai.id as invite_id,
    ai.tenant_id,
    ai.team_id,
    t.name as team_name,
    ten.name as organization_name,
    t.event_group,
    ai.status
  from public.athlete_invites ai
  join public.teams t on t.id = ai.team_id
  join public.tenants ten on ten.id = ai.tenant_id
  where ai.id = p_invite_id
  limit 1;
$$;

grant execute on function public.get_public_athlete_invite(uuid) to anon, authenticated;

create or replace function public.complete_current_athlete_onboarding(
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_display_name text := nullif(trim(coalesce(p_display_name, '')), '');
  v_first_name text;
  v_last_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role <> 'athlete' then
    raise exception 'Only athlete users can complete athlete onboarding';
  end if;

  if v_display_name is null then
    raise exception 'Display name is required';
  end if;

  v_first_name := split_part(v_display_name, ' ', 1);
  v_last_name := nullif(trim(substr(v_display_name, length(v_first_name) + 1)), '');
  if v_last_name is null then
    v_last_name := 'Athlete';
  end if;

  update public.profiles
  set display_name = v_display_name,
      password_set_at = coalesce(password_set_at, now()),
      onboarding_completed_at = coalesce(onboarding_completed_at, now()),
      setup_guide_dismissed_at = coalesce(setup_guide_dismissed_at, null),
      updated_at = now()
  where user_id = auth.uid();

  update public.athletes
  set first_name = v_first_name,
      last_name = v_last_name,
      is_active = true,
      updated_at = now()
  where user_id = auth.uid()
    and tenant_id = v_profile.tenant_id;
end;
$$;

grant execute on function public.complete_current_athlete_onboarding(text) to authenticated;

create or replace function public.set_current_athlete_setup_guide_dismissed(
  p_dismissed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role <> 'athlete' then
    raise exception 'Only athlete users can update athlete guide state';
  end if;

  update public.profiles
  set setup_guide_dismissed_at = case when p_dismissed then now() else null end,
      updated_at = now()
  where user_id = auth.uid();
end;
$$;

grant execute on function public.set_current_athlete_setup_guide_dismissed(boolean) to authenticated;

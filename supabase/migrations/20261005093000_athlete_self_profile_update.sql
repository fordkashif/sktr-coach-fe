-- Athlete self-service profile edits and read-only team context
-- Created: 2026-10-05
--
-- RLS gives athletes read-only access to their own athletes/profiles rows.
-- Rather than widening those policies (a row-level update policy cannot
-- restrict columns, so it would also expose team_id, tenant_id, readiness
-- and is_active), athletes go through security definer functions that touch
-- an explicit list of personal columns on their own row only.
-- Idempotent: only create or replace function + grant. No table changes.

create or replace function public.update_current_athlete_profile(
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_event_group text,
  p_primary_event text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_first_name text := nullif(trim(coalesce(p_first_name, '')), '');
  v_last_name text := nullif(trim(coalesce(p_last_name, '')), '');
  v_event_group text := nullif(trim(coalesce(p_event_group, '')), '');
  v_primary_event text := nullif(trim(coalesce(p_primary_event, '')), '');
  v_athlete_id uuid;
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
    raise exception 'Only athlete users can update an athlete profile';
  end if;

  if v_first_name is null or v_last_name is null then
    raise exception 'First name and last name are required';
  end if;

  if length(v_first_name) > 60 or length(v_last_name) > 60 then
    raise exception 'Names must be 60 characters or fewer';
  end if;

  if v_event_group is not null and length(v_event_group) > 60 then
    raise exception 'Event group must be 60 characters or fewer';
  end if;

  if v_primary_event is not null and length(v_primary_event) > 60 then
    raise exception 'Primary event must be 60 characters or fewer';
  end if;

  if p_date_of_birth is not null
     and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then
    raise exception 'Date of birth is not valid';
  end if;

  update public.athletes
  set first_name = v_first_name,
      last_name = v_last_name,
      date_of_birth = p_date_of_birth,
      event_group = v_event_group,
      primary_event = v_primary_event,
      updated_at = now()
  where user_id = auth.uid()
    and tenant_id = v_profile.tenant_id
  returning id into v_athlete_id;

  if v_athlete_id is null then
    raise exception 'Athlete record not found';
  end if;

  update public.profiles
  set display_name = v_first_name || ' ' || v_last_name,
      updated_at = now()
  where user_id = auth.uid();
end;
$$;

grant execute on function public.update_current_athlete_profile(text, text, date, text, text) to authenticated;

-- The signed-in athlete's team, club and the names of that team's coaches.
-- Athletes cannot read team_coaches or other users' profiles under RLS.
create or replace function public.get_current_athlete_team_context()
returns table (
  team_id uuid,
  team_name text,
  team_event_group text,
  organization_name text,
  coach_names text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id as team_id,
    t.name as team_name,
    t.event_group as team_event_group,
    ten.name as organization_name,
    (
      select string_agg(trim(cp.display_name), ', ' order by tc.is_primary desc, trim(cp.display_name))
      from public.team_coaches tc
      join public.profiles cp
        on cp.user_id = tc.user_id
       and cp.tenant_id = tc.tenant_id
      where tc.team_id = t.id
        and tc.tenant_id = a.tenant_id
        and nullif(trim(coalesce(cp.display_name, '')), '') is not null
    ) as coach_names
  from public.athletes a
  join public.profiles me
    on me.user_id = a.user_id
   and me.tenant_id = a.tenant_id
  join public.teams t
    on t.id = a.team_id
   and t.tenant_id = a.tenant_id
  join public.tenants ten on ten.id = a.tenant_id
  where a.user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.get_current_athlete_team_context() to authenticated;

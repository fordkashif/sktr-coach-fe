-- SKTR Coach: units of measure (kilograms or pounds, centimetres or feet and inches)
-- Created: 2026-10-17
--
-- Everything stays STORED metric: load_kg, value_kg, weight_kg, height_cm and kilogram results are
-- not touched by this migration. It adds only a preference for what a person reads and types
-- (the app converts at the edge, src/lib/units.ts). Track and field marks stay metric always.
--
-- 1. unit_preferences: one row per person, their own choice. A null unit means "same as my club".
--    Own row only: nobody else reads or writes it, not coaches, not club admins.
-- 2. club_unit_defaults: one row per club, what members get until they choose. Every member of the
--    club (guardians included) reads it; only set_club_unit_defaults() writes it, club admins only.
--
-- Deleting: a person's row goes with their account (on delete cascade from auth.users), and both
-- tables carry tenant_id, so delete_closed_club() sweeps them like every other tenant table.
-- No column here points at auth.users with "on delete set null".
--
-- Safe to run twice.

-- 1. A person's own units ---------------------------------------------------------------------------

create table if not exists public.unit_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Filled in from the caller's club; the insert policy refuses any other club.
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  -- Null: same as the club.
  weight_unit text check (weight_unit is null or weight_unit in ('kg', 'lb')),
  height_unit text check (height_unit is null or height_unit in ('cm', 'ft_in')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.unit_preferences is
  'What units a person reads and types in. Display only: stored loads, weights and heights stay metric.';

create index if not exists unit_preferences_tenant_idx on public.unit_preferences (tenant_id);

create or replace function public.unit_preferences_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    -- A row belongs to one person in one club for good.
    new.user_id := old.user_id;
    new.tenant_id := old.tenant_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function public.unit_preferences_before_write() from public, anon, authenticated;

drop trigger if exists unit_preferences_before_write on public.unit_preferences;
create trigger unit_preferences_before_write
before insert or update on public.unit_preferences
for each row
execute function public.unit_preferences_before_write();

alter table public.unit_preferences enable row level security;

drop policy if exists unit_preferences_select_own on public.unit_preferences;
create policy unit_preferences_select_own
on public.unit_preferences
for select
to authenticated
using (user_id = auth.uid() and tenant_id = public.current_tenant_id());

drop policy if exists unit_preferences_insert_own on public.unit_preferences;
create policy unit_preferences_insert_own
on public.unit_preferences
for insert
to authenticated
with check (user_id = auth.uid() and tenant_id = public.current_tenant_id());

drop policy if exists unit_preferences_update_own on public.unit_preferences;
create policy unit_preferences_update_own
on public.unit_preferences
for update
to authenticated
using (user_id = auth.uid() and tenant_id = public.current_tenant_id())
with check (user_id = auth.uid() and tenant_id = public.current_tenant_id());

drop policy if exists unit_preferences_delete_own on public.unit_preferences;
create policy unit_preferences_delete_own
on public.unit_preferences
for delete
to authenticated
using (user_id = auth.uid() and tenant_id = public.current_tenant_id());

revoke all on table public.unit_preferences from anon, authenticated;
grant select, insert, update, delete on table public.unit_preferences to authenticated;
grant all on table public.unit_preferences to service_role;

-- 2. The club's default -----------------------------------------------------------------------------

create table if not exists public.club_unit_defaults (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  height_unit text not null default 'cm' check (height_unit in ('cm', 'ft_in')),
  updated_at timestamptz not null default now()
);

comment on table public.club_unit_defaults is
  'The units members of a club read and type in until they choose their own. Changed with set_club_unit_defaults().';

alter table public.club_unit_defaults enable row level security;

-- Every active member of the club, guardians included. current_tenant_id() is null for a
-- deactivated member and for a suspended or cancelled club.
drop policy if exists club_unit_defaults_select_member on public.club_unit_defaults;
create policy club_unit_defaults_select_member
on public.club_unit_defaults
for select
to authenticated
using (tenant_id = public.current_tenant_id());

-- No insert, update or delete policy: the function below is the only way in.
revoke all on table public.club_unit_defaults from anon, authenticated;
grant select on table public.club_unit_defaults to authenticated;
grant all on table public.club_unit_defaults to service_role;

-- Club admins only. Returns the saved row.
create or replace function public.set_club_unit_defaults(p_weight_unit text, p_height_unit text)
returns public.club_unit_defaults
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_previous public.club_unit_defaults%rowtype;
  v_saved public.club_unit_defaults%rowtype;
begin
  perform public.assert_caller_active();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  if not found or v_profile.role <> 'club-admin' or not v_profile.is_active then
    raise exception 'Only active club-admin users can change the club units' using errcode = '42501';
  end if;

  if p_weight_unit is null or p_weight_unit not in ('kg', 'lb') or p_height_unit is null or p_height_unit not in ('cm', 'ft_in') then
    raise exception 'Unknown unit' using errcode = '22023';
  end if;

  select * into v_previous
  from public.club_unit_defaults d
  where d.tenant_id = v_profile.tenant_id
  for update;

  insert into public.club_unit_defaults as d (tenant_id, weight_unit, height_unit, updated_at)
  values (v_profile.tenant_id, p_weight_unit, p_height_unit, now())
  on conflict (tenant_id) do update
  set weight_unit = excluded.weight_unit,
      height_unit = excluded.height_unit,
      updated_at = now()
  returning d.* into v_saved;

  if coalesce(v_previous.weight_unit, 'kg') is distinct from p_weight_unit
     or coalesce(v_previous.height_unit, 'cm') is distinct from p_height_unit then
    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (
      v_profile.tenant_id, v_user_id, 'club-admin', 'profile_update', 'Club profile',
      format('Club units changed from %s and %s to %s and %s',
        coalesce(v_previous.weight_unit, 'kg'), coalesce(v_previous.height_unit, 'cm'), p_weight_unit, p_height_unit)
    );
  end if;

  return v_saved;
end;
$$;

revoke all on function public.set_club_unit_defaults(text, text) from public, anon;
grant execute on function public.set_club_unit_defaults(text, text) to authenticated, service_role;

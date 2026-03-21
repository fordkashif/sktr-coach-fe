-- Club admin profile + billing runtime tables
-- Created: 2026-03-21

create table if not exists public.club_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  club_name text not null,
  short_name text not null,
  primary_color text not null default '#16a34a',
  season_year text not null,
  season_start date not null,
  season_end date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (season_start <= season_end)
);

create table if not exists public.billing_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  plan text not null check (plan in ('starter', 'pro', 'enterprise')),
  seats int not null check (seats > 0),
  renewal_date date not null,
  payment_method_last4 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(payment_method_last4) between 1 and 4)
);

create index if not exists club_profiles_tenant_idx on public.club_profiles (tenant_id);
create index if not exists billing_profiles_tenant_idx on public.billing_profiles (tenant_id);

drop trigger if exists set_updated_at_club_profiles on public.club_profiles;
create trigger set_updated_at_club_profiles
before update on public.club_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_billing_profiles on public.billing_profiles;
create trigger set_updated_at_billing_profiles
before update on public.billing_profiles
for each row
execute function public.set_updated_at();

alter table public.club_profiles enable row level security;
alter table public.billing_profiles enable row level security;

drop policy if exists club_profiles_select_tenant on public.club_profiles;
create policy club_profiles_select_tenant
on public.club_profiles
for select
to authenticated
using (tenant_id = public.current_tenant_id());

drop policy if exists club_profiles_modify_admin on public.club_profiles;
create policy club_profiles_modify_admin
on public.club_profiles
for all
to authenticated
using (public.is_club_admin() and tenant_id = public.current_tenant_id())
with check (public.is_club_admin() and tenant_id = public.current_tenant_id());

drop policy if exists billing_profiles_select_tenant on public.billing_profiles;
create policy billing_profiles_select_tenant
on public.billing_profiles
for select
to authenticated
using (tenant_id = public.current_tenant_id());

drop policy if exists billing_profiles_modify_admin on public.billing_profiles;
create policy billing_profiles_modify_admin
on public.billing_profiles
for all
to authenticated
using (public.is_club_admin() and tenant_id = public.current_tenant_id())
with check (public.is_club_admin() and tenant_id = public.current_tenant_id());

-- Fix first-access profile bootstrap against tenant RLS
-- Created: 2026-03-24

create or replace function public.is_active_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.is_active = true
  )
$$;

drop policy if exists profiles_insert_self_bootstrap on public.profiles;
create policy profiles_insert_self_bootstrap
on public.profiles
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_active_tenant(tenant_id)
  and role in ('athlete', 'coach', 'club-admin')
);

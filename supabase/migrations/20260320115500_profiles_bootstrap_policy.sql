-- PaceLab Profile Bootstrap Policy
-- Created: 2026-03-20

drop policy if exists profiles_insert_self_bootstrap on public.profiles;
create policy profiles_insert_self_bootstrap
on public.profiles
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (select 1 from public.tenants t where t.id = tenant_id and t.is_active = true)
  and role in ('athlete', 'coach', 'club-admin')
);

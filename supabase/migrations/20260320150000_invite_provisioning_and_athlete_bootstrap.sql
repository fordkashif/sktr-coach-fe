-- Invite provisioning + athlete bootstrap policy updates (Wave 6)
-- Created: 2026-03-20

alter table public.coach_invites
  drop constraint if exists coach_invites_role_check;

alter table public.coach_invites
  add constraint coach_invites_role_check
  check (role in ('coach', 'club-admin', 'athlete'));

drop policy if exists athletes_insert_self_bootstrap on public.athletes;
create policy athletes_insert_self_bootstrap
on public.athletes
for insert
to authenticated
with check (
  user_id = auth.uid()
  and tenant_id = public.current_tenant_id()
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.tenant_id = public.current_tenant_id()
      and p.role = 'athlete'
  )
);

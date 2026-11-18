-- One name for a club (Kash, 18 Nov 2026).
--
-- A club admin names the club on its profile (club_profiles.club_name). Most screens and emails
-- read tenants.name instead, which still held the name typed on the club request, so a club renamed
-- from "Elite Club" to "Strongside" still showed as Elite Club on athletes' profiles, invites and
-- elsewhere. The tenant's name now follows the club profile whenever the club name is saved, and
-- clubs already renamed are brought in line now.

create or replace function public.sync_tenant_name_from_club_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(new.club_name, ''));
begin
  if v_name <> '' then
    update public.tenants
    set name = v_name
    where id = new.tenant_id
      and name is distinct from v_name;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_tenant_name_from_club_profile() from public, anon, authenticated;

drop trigger if exists club_profiles_sync_tenant_name on public.club_profiles;
create trigger club_profiles_sync_tenant_name
after insert or update of club_name on public.club_profiles
for each row execute function public.sync_tenant_name_from_club_profile();

update public.tenants t
set name = btrim(cp.club_name)
from public.club_profiles cp
where cp.tenant_id = t.id
  and btrim(coalesce(cp.club_name, '')) <> ''
  and t.name is distinct from btrim(cp.club_name);

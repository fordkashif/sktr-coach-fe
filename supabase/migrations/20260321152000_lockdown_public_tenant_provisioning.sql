-- Lock down self-serve tenant provisioning execution
-- Created: 2026-03-21

revoke all on function public.provision_club_admin_tenant(text, text, text, text, date, date) from anon;
revoke all on function public.provision_club_admin_tenant(text, text, text, text, date, date) from authenticated;
grant execute on function public.provision_club_admin_tenant(text, text, text, text, date, date) to service_role;

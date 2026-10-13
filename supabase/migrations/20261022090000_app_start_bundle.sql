-- One start-up call instead of about fifteen.
--
-- Timing from a real phone showed every screen opening with a burst of 20 to 30 small requests
-- (your account, your own profile and athlete record asked for six different ways, units, club
-- brand, timezone, notices, unread counts). The server answered them almost one at a time, so the
-- last one came back after 3 to 4 seconds. get_app_start() answers all of them in one request.
--
-- The app sends it once when it opens (and again after a save or when it comes back to the
-- front), and answers those requests from it (src/lib/supabase/app-start.ts). Anything it cannot
-- answer exactly still goes to the server as before.
--
-- It runs with the caller's own rights (security invoker), so every part sees exactly what the
-- same request would have seen on its own: the same access rules apply. A part that fails (for
-- example a function a club admin only may call) comes back as null and that request simply goes
-- to the server.

create or replace function public.get_app_start()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb := jsonb_build_object('uid', v_uid);
begin
  if v_uid is null then
    return v_out;
  end if;

  -- Own rows, looked up by the caller's login. "rows" are every row the caller can see with that
  -- login, so a request filtered on user_id = the caller is answered exactly.
  begin
    v_out := v_out || jsonb_build_object('profiles', (
      select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.profiles p where p.user_id = v_uid));
  exception when others then null;
  end;

  begin
    v_out := v_out || jsonb_build_object('athletes', (
      select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('teams', (select jsonb_build_object('name', t.name) from public.teams t where t.id = a.team_id))), '[]'::jsonb)
      from public.athletes a where a.user_id = v_uid));
  exception when others then null;
  end;

  begin
    v_out := v_out || jsonb_build_object('unit_preferences', (
      select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from public.unit_preferences u where u.user_id = v_uid));
  exception when others then null;
  end;

  -- Club-wide rows: every row the caller can see, at most 3. With more than 2 the app does not use
  -- them (it cannot tell which one the server would pick).
  begin
    v_out := v_out || jsonb_build_object('club_unit_defaults', (
      select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from (select * from public.club_unit_defaults limit 3) d));
  exception when others then null;
  end;

  begin
    v_out := v_out || jsonb_build_object('club_profiles', (
      select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (select * from public.club_profiles limit 3) c));
  exception when others then null;
  end;

  -- Functions every screen asks for with no arguments.
  begin
    v_out := v_out || jsonb_build_object('rpc:get_current_account', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.get_current_account() r));
  exception when others then null;
  end;
  begin
    v_out := v_out || jsonb_build_object('rpc:get_visible_avatars', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.get_visible_avatars() r));
  exception when others then null;
  end;
  begin
    v_out := v_out || jsonb_build_object('rpc:get_current_club_brand', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.get_current_club_brand() r));
  exception when others then null;
  end;
  begin
    v_out := v_out || jsonb_build_object('rpc:get_my_platform_notices', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.get_my_platform_notices() r));
  exception when others then null;
  end;
  begin
    v_out := v_out || jsonb_build_object('rpc:get_message_unread_counts', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.get_message_unread_counts() r));
  exception when others then null;
  end;
  begin
    v_out := v_out || jsonb_build_object('rpc:get_current_tenant_package', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.get_current_tenant_package() r));
  exception when others then null;
  end;
  begin
    v_out := v_out || jsonb_build_object('rpc:get_current_athlete_team_context', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.get_current_athlete_team_context() r));
  exception when others then null;
  end;
  begin
    v_out := v_out || jsonb_build_object('rpc:get_current_athlete_team_coaches', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.get_current_athlete_team_coaches() r));
  exception when others then null;
  end;
  begin
    v_out := v_out || jsonb_build_object('rpc:get_current_club_admin_activation_state', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.get_current_club_admin_activation_state() r));
  exception when others then null;
  end;

  return v_out;
end;
$$;

revoke all on function public.get_app_start() from public, anon;
grant execute on function public.get_app_start() to authenticated, service_role;

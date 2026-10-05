-- An athlete could take themselves off their team (leave_current_athlete_team, 20261008110000).
-- The owner's rule: membership is decided by the club. An athlete joins by invite or join code and
-- only a coach of the team or a club admin moves or removes them. So the self-service function goes.
-- Nothing else lets an athlete change their own team: athletes have no update policy on
-- athletes.team_id, and a join code refuses someone who is already on another team (other_team).

revoke all on function public.leave_current_athlete_team() from public, anon, authenticated;

create or replace function public.leave_current_athlete_team()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Athletes cannot leave a team themselves. Ask your coach or club admin.' using errcode = '42501';
end;
$$;

revoke all on function public.leave_current_athlete_team() from public, anon, authenticated;

-- A goal is reached by a result dated on or after the day the goal was set. That day was taken
-- from the goal's creation time in UTC, while a result's date is the athlete's local day. In the
-- evening in Jamaica the UTC day is already tomorrow, so a result logged minutes after setting the
-- goal was dated "before" it and never counted. Allow one day of slack on the start day.
-- Patches the one comparison inside athlete_goals_normalise() (20261011110000). Safe to run twice.
do $$
declare
  v_def text;
  v_old constant text := 'r.result_date >= (new.created_at at time zone ''utc'')::date';
  v_new constant text := 'r.result_date >= ((new.created_at at time zone ''utc'')::date - 1)';
begin
  select pg_get_functiondef('public.athlete_goals_normalise()'::regprocedure) into v_def;
  if position(v_new in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'athlete_goals_normalise() no longer contains the comparison this migration patches';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

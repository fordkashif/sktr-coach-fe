-- Test weeks: close and reopen, and results a coach enters for an athlete
-- Created: 2026-10-09
--
-- WHAT THIS ADDS
--   1. Close and reopen (C30). set_test_week_open(test week, open) moves a published test week
--      to 'closed' and a closed one back to 'published'. Athletes may only enter results while a
--      week is 'published' (athlete_can_enter_test_result(), 20261006150000), so closing stops
--      entry and reopening allows it again without any change to the athlete rules.
--        * Who: a club admin, or a coach assigned to the week's team (can_manage_test_week()).
--        * A draft cannot be closed, an archived week can be neither closed nor reopened.
--        * Every close and reopen is written to audit_events, whichever way the status was
--          changed (the function, or a direct update through the row policy).
--        * Reopening tells the team's athletes who have an account, in the app only
--          ('test_week_reopened'). Closing tells nobody.
--        * The "test week published" notification (in-app and email) no longer fires when a
--          CLOSED week goes back to published. It still fires for a new or a draft week.
--   2. Results entered by a coach (C16). Staff could already write test_results rows for the
--      athletes they manage (test_results_staff_all, 20261006120000). What was missing:
--        * test_results.entered_by_role says who typed the result: 'athlete', 'coach' or
--          'club-admin'. The database sets it from the signed-in user; the browser cannot.
--          submitted_by_user_id is stamped the same way.
--        * A guard on every write: the test must belong to the test week, the row's club must be
--          the week's club, and the value must be a number above 0 (the rule the athlete form
--          has always applied). For staff also: the week must be one they manage and must not be
--          a draft, and a new result must be for an athlete on the week's team. Before this a
--          coach could attach a result of one of their athletes to another team's test week.
--          Staff may write into a closed week (corrections); athletes still may not.
--      Nothing else changes: the row policies stay as they are, and the triggers of
--      20261008100000 copy every result into the results history and refresh the bests exactly
--      as they do for a result the athlete typed. Athletes with no login are covered because
--      nothing here looks at athletes.user_id except to tell "the athlete" from "staff".
--
-- Idempotent and additive: add column if not exists, a guarded constraint, create or replace,
-- drop trigger if exists + create trigger. No table, column, policy or row is removed. One
-- backfill fills entered_by_role for existing results where it can be told; it only touches rows
-- where the column is still empty.

-- 1. Who entered a result -------------------------------------------------------------------

alter table public.test_results
  add column if not exists entered_by_role text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'test_results_entered_by_role_check'
      and conrelid = 'public.test_results'::regclass
  ) then
    alter table public.test_results
      add constraint test_results_entered_by_role_check
      check (entered_by_role is null or entered_by_role in ('athlete', 'coach', 'club-admin'));
  end if;
end;
$$;

comment on column public.test_results.entered_by_role is
  'Who typed this result: athlete, coach or club-admin. Set by the database from the signed-in user. Null for rows from before 20261009100000 where it cannot be told.';

-- Existing rows: the athlete when they submitted it themselves, otherwise the staff role of
-- whoever did. Runs before the guard below exists and only where the column is empty.
update public.test_results tr
set entered_by_role = case
  when a.user_id is not null and tr.submitted_by_user_id = a.user_id then 'athlete'
  else (
    select p.role
    from public.profiles p
    where p.user_id = tr.submitted_by_user_id
      and p.role in ('coach', 'club-admin')
    limit 1
  )
end
from public.athletes a
where a.id = tr.athlete_id
  and tr.entered_by_role is null
  and tr.submitted_by_user_id is not null;

-- 2. The guard on test results ----------------------------------------------------------------

-- Runs before a result is added, moved or its value changed. The row policies have already
-- decided whether this user may write the row at all; this adds the checks a policy cannot
-- express well and stamps who entered it. Calls with no signed-in user (service role, SQL
-- editor) get the consistency checks only.
create or replace function public.test_results_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_week record;
  v_athlete record;
  v_definition_week uuid;
  v_is_self boolean;
  v_keys_changed boolean;
  v_value_changed boolean;
begin
  v_keys_changed := tg_op = 'INSERT'
    or new.test_week_id is distinct from old.test_week_id
    or new.test_definition_id is distinct from old.test_definition_id
    or new.athlete_id is distinct from old.athlete_id
    or new.tenant_id is distinct from old.tenant_id;
  v_value_changed := tg_op = 'INSERT'
    or new.value_numeric is distinct from old.value_numeric
    or new.value_text is distinct from old.value_text;

  select tw.id, tw.tenant_id, tw.team_id, tw.status
  into v_week
  from public.test_weeks tw
  where tw.id = new.test_week_id;
  if not found then
    raise exception 'This test week no longer exists.' using errcode = '23503';
  end if;

  select a.id, a.tenant_id, a.team_id, a.user_id
  into v_athlete
  from public.athletes a
  where a.id = new.athlete_id;
  if not found then
    raise exception 'Athlete not found.' using errcode = '23503';
  end if;

  if v_keys_changed then
    select td.test_week_id into v_definition_week
    from public.test_definitions td
    where td.id = new.test_definition_id;
    if v_definition_week is distinct from new.test_week_id then
      raise exception 'That test does not belong to this test week.' using errcode = '23514';
    end if;
    if new.tenant_id is distinct from v_week.tenant_id or v_athlete.tenant_id is distinct from v_week.tenant_id then
      raise exception 'The athlete and the test week must belong to the same club.' using errcode = '23514';
    end if;
  end if;

  if v_uid is null then
    return new;
  end if;

  v_is_self := v_athlete.user_id is not null and v_athlete.user_id = v_uid;

  if not v_is_self then
    if not public.can_manage_test_week(new.test_week_id) or not public.can_manage_athlete(new.athlete_id) then
      raise exception 'You can only enter results for athletes and test weeks of your own teams.' using errcode = '42501';
    end if;
    if v_week.status = 'draft' then
      raise exception 'Publish this test week before entering results.' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and v_week.team_id is not null and v_athlete.team_id is distinct from v_week.team_id then
      raise exception 'This athlete is not on the team this test week is for.' using errcode = '23514';
    end if;
  end if;

  if v_value_changed then
    if new.value_numeric is null or new.value_numeric <= 0 or new.value_numeric >= 100000 then
      raise exception 'Enter a number greater than 0.' using errcode = '23514';
    end if;
    new.submitted_by_user_id := v_uid;
    new.entered_by_role := case when v_is_self then 'athlete' else public.current_app_role() end;
  end if;

  return new;
end;
$$;

drop trigger if exists test_results_guard on public.test_results;
create trigger test_results_guard
before insert or update of test_week_id, test_definition_id, athlete_id, tenant_id, value_text, value_numeric
on public.test_results
for each row
execute function public.test_results_guard();

revoke all on function public.test_results_guard() from public, anon, authenticated;

-- 3. Close and reopen ---------------------------------------------------------------------------

-- A draft has never been open, so it cannot be closed. (Everything else about who may change a
-- test week stays with the row policy test_weeks_staff_all.)
create or replace function public.test_weeks_status_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'draft' and new.status = 'closed' then
    raise exception 'This test week is still a draft. Publish it before closing it.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists test_weeks_status_guard on public.test_weeks;
create trigger test_weeks_status_guard
before update of status on public.test_weeks
for each row
when (old.status is distinct from new.status)
execute function public.test_weeks_status_guard();

-- Audit every close and reopen, and tell the athletes about a reopen (in the app only).
create or replace function public.test_weeks_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := coalesce(nullif(left(btrim(new.name), 160), ''), 'Test week');
  v_reopened boolean := old.status = 'closed' and new.status = 'published';
  v_recipient record;
begin
  if not v_reopened and not (old.status = 'published' and new.status = 'closed') then
    return new;
  end if;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    new.tenant_id,
    auth.uid(),
    coalesce(public.current_app_role(), 'system'),
    case when v_reopened then 'test_week_reopened' else 'test_week_closed' end,
    v_name,
    case
      when v_reopened then 'Reopened. Athletes can enter and change results again.'
      else 'Closed. Athletes can no longer enter or change results.'
    end
  );

  if v_reopened and not new.is_archived and new.team_id is not null then
    for v_recipient in
      select distinct a.user_id
      from public.athletes a
      where a.team_id = new.team_id
        and a.tenant_id = new.tenant_id
        and a.user_id is not null
        and a.is_active
    loop
      perform public.enqueue_notification(
        new.tenant_id,
        v_recipient.user_id,
        'test_week_reopened',
        format('Test week reopened: %s', v_name),
        'Your coach reopened this test week. You can enter or change your results again.',
        jsonb_build_object('test_week_id', new.id::text, 'team_id', new.team_id::text),
        array['in-app'],
        'test_week_reopened:' || new.id::text,
        interval '10 minutes'
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists test_weeks_status_changed on public.test_weeks;
create trigger test_weeks_status_changed
after update of status on public.test_weeks
for each row
when (old.status is distinct from new.status)
execute function public.test_weeks_status_changed();

revoke all on function public.test_weeks_status_guard() from public, anon, authenticated;
revoke all on function public.test_weeks_status_changed() from public, anon, authenticated;

-- The "test week published" notice (20261007090000), unchanged except for the first check: a
-- closed week going back to published is a reopen, which has its own quieter notice above.
create or replace function public.enqueue_test_week_published_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_name text;
  v_recipient record;
begin
  if tg_op = 'UPDATE' and old.status = 'closed' then
    return new;
  end if;

  if new.status <> 'published' or new.is_archived or new.team_id is null then
    return new;
  end if;

  select tm.name into v_team_name from public.teams tm where tm.id = new.team_id;

  for v_recipient in
    select distinct a.user_id
    from public.athletes a
    where a.team_id = new.team_id
      and a.tenant_id = new.tenant_id
      and a.user_id is not null
      and a.is_active
  loop
    perform public.enqueue_notification(
      new.tenant_id,
      v_recipient.user_id,
      'test_week_published',
      format('Test week: %s', coalesce(nullif(btrim(new.name), ''), 'Test week')),
      format(
        'Your coach opened a test week%s. It runs from %s to %s.',
        case when v_team_name is null then '' else format(' for %s', v_team_name) end,
        public.notification_date_label(new.start_date),
        public.notification_date_label(new.end_date)
      ),
      jsonb_build_object('test_week_id', new.id::text, 'team_id', new.team_id::text),
      array['in-app', 'email'],
      'test_week:' || new.id::text,
      interval '1 day'
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.enqueue_test_week_published_notifications() from public, anon, authenticated;

-- The one call the coach screen makes. Returns the status the week has afterwards.
-- Refused (42501, hint access_paused) for a deactivated member or a suspended or cancelled club.
create or replace function public.set_test_week_open(p_test_week_id uuid, p_open boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week record;
  v_next text;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_test_week_id is null or p_open is null then
    raise exception 'Choose the test week and whether to close or reopen it.' using errcode = '23514';
  end if;

  select tw.id, tw.status, tw.is_archived
  into v_week
  from public.test_weeks tw
  where tw.id = p_test_week_id
    and tw.tenant_id = public.current_tenant_id()
  for update;

  if not found or not public.can_manage_test_week(p_test_week_id) then
    raise exception 'You can only close or reopen test weeks of your own teams.' using errcode = '42501';
  end if;
  if v_week.is_archived then
    raise exception 'This test week is archived. Restore it first.' using errcode = '23514';
  end if;
  if v_week.status = 'draft' then
    raise exception 'This test week is still a draft. Publish it first.' using errcode = '23514';
  end if;

  v_next := case when p_open then 'published' else 'closed' end;
  if v_week.status = v_next then
    return v_next;
  end if;

  update public.test_weeks
  set status = v_next
  where id = p_test_week_id;

  return v_next;
end;
$$;

revoke all on function public.set_test_week_open(uuid, boolean) from public, anon;
grant execute on function public.set_test_week_open(uuid, boolean) to authenticated, service_role;

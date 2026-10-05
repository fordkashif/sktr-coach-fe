-- SKTR Coach: reminders
-- Created: 2026-10-11
--
-- BEFORE THIS FILE
--   Every notification was the answer to something somebody did (a plan published, a result
--   entered). Nothing reminded anyone of what they had NOT done yet.
--
-- WHAT THIS FILE ADDS
--   1. A club time zone: club_profiles.timezone (IANA name, default 'America/Jamaica').
--      set_current_club_timezone(name) is how a club admin changes it. A trigger refuses a name
--      Postgres does not know, whoever writes the column.
--   2. reminder_deliveries: one private row per reminder sent, unique on
--      (user_id, reminder_type, subject_id, local_date). That is what makes a reminder go out at
--      most once per person per subject per local day, however often the job runs.
--   3. run_reminders(now, club): the job. For every club that is not paused it works out the
--      club's local date and hour and sends:
--        reminder_session_today            athlete, 07:00 local. A session planned for today that
--                                          is not done and not skipped. Not sent while the athlete
--                                          is marked injured, sick or away. One per athlete per day.
--        reminder_checkin                  athlete, 09:00 local. No wellness check-in for today.
--        reminder_test_week_closing        athlete, on the last day of an open test week, from
--                                          08:00 to 20:00 local (the week closes at the end of that
--                                          day, so this is inside its last 24 hours). Only when a
--                                          required test still has no result.
--        reminder_test_week_closing_coach  the coaches of that week's team, same window, with the
--                                          number of athletes who still have results missing.
--        reminder_athletes_not_logged      coach, 08:00 local. ONE notification with how many
--                                          athletes on the coach's teams did not log yesterday's
--                                          session (skipped and excused sessions do not count).
--      Everything goes through enqueue_notification() (20261007090000), so the existing rules
--      hold: active members only, never a suspended or cancelled club, the person's channel
--      choices, and email through the existing queue and dispatch function.
--   4. A pg_cron job, every hour at minute 0. Guarded: without pg_cron this file still applies.
--
-- EMAIL DEFAULTS
--   Session today, check-in and the coach digest are in-app only unless the person switches
--   email on for them. Test week closing (athlete and coach) is emailed unless switched off.
--   This file does NOT replace notification_default_enabled(): other migrations written at the
--   same time replace it too and the newest would win. Instead the job only queues an email for
--   a "default off" reminder when the person has an explicit "on" row for it. The settings screen
--   shows the same defaults (src/lib/notification-categories.ts).
--
-- Idempotent and additive: add column if not exists, create table if not exists, create or
-- replace, drop trigger if exists + create trigger, unschedule then schedule. Nothing is removed
-- and no reminder is created by applying this file.

-- 1. Club time zone -----------------------------------------------------------------------------

alter table public.club_profiles
  add column if not exists timezone text not null default 'America/Jamaica';

comment on column public.club_profiles.timezone is
  'IANA time zone of the club (for example America/Jamaica). Reminders are timed in it. Changed with set_current_club_timezone().';

create or replace function public.is_known_timezone(p_timezone text)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_timezone is not null
     and exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_timezone)
$$;

create or replace function public.club_profiles_check_timezone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.timezone is null then
    new.timezone := 'America/Jamaica';
  end if;
  if (tg_op = 'INSERT' or new.timezone is distinct from old.timezone)
     and not public.is_known_timezone(new.timezone) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists club_profiles_check_timezone on public.club_profiles;
create trigger club_profiles_check_timezone
before insert or update of timezone on public.club_profiles
for each row
execute function public.club_profiles_check_timezone();

-- The club's time zone for the job. Never fails: a club with no profile row, or with a name this
-- server no longer knows, is timed in the default.
create or replace function public.reminder_tenant_timezone(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select cp.timezone
      from public.club_profiles cp
      where cp.tenant_id = p_tenant_id
        and public.is_known_timezone(cp.timezone)
    ),
    'America/Jamaica'
  )
$$;

-- Club admins only. Returns the saved name.
create or replace function public.set_current_club_timezone(p_timezone text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_timezone text := nullif(btrim(coalesce(p_timezone, '')), '');
  v_previous text;
begin
  perform public.assert_caller_active();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  if not found or v_profile.role <> 'club-admin' or not v_profile.is_active then
    raise exception 'Only active club-admin users can change the club time zone';
  end if;

  if not public.is_known_timezone(v_timezone) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;

  select cp.timezone into v_previous
  from public.club_profiles cp
  where cp.tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'Club profile not found' using errcode = 'P0002';
  end if;

  if v_previous is distinct from v_timezone then
    update public.club_profiles cp
    set timezone = v_timezone
    where cp.tenant_id = v_profile.tenant_id;

    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (v_profile.tenant_id, v_user_id, 'club-admin', 'profile_update', 'Club profile', format('Time zone changed from %s to %s', v_previous, v_timezone));
  end if;

  return v_timezone;
end;
$$;

revoke all on function public.is_known_timezone(text) from public, anon;
revoke all on function public.club_profiles_check_timezone() from public, anon, authenticated;
revoke all on function public.reminder_tenant_timezone(uuid) from public, anon, authenticated;
revoke all on function public.set_current_club_timezone(text) from public, anon;
grant execute on function public.is_known_timezone(text) to authenticated, service_role;
grant execute on function public.reminder_tenant_timezone(uuid) to service_role;
grant execute on function public.set_current_club_timezone(text) to authenticated, service_role;

-- 2. What was already sent ------------------------------------------------------------------------

create table if not exists public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_type text not null check (reminder_type in (
    'reminder_session_today',
    'reminder_checkin',
    'reminder_test_week_closing',
    'reminder_test_week_closing_coach',
    'reminder_athletes_not_logged'
  )),
  -- What the reminder is about: the athlete (session today, check-in), the test week, or the
  -- club (coach digest).
  subject_id text not null,
  -- The day in the club's own time zone.
  local_date date not null,
  -- How many notification rows were queued (0 when the person has it switched off everywhere).
  queued_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint reminder_deliveries_once_per_day unique (user_id, reminder_type, subject_id, local_date)
);

comment on table public.reminder_deliveries is
  'One row per reminder handed to the notification queue. The unique key is what stops a reminder going out twice. Private: written and read only by run_reminders().';

create index if not exists reminder_deliveries_tenant_date_idx
on public.reminder_deliveries (tenant_id, local_date desc);

-- No policies on purpose: nobody reaches this table through the API.
alter table public.reminder_deliveries enable row level security;
revoke all on table public.reminder_deliveries from public, anon, authenticated;
grant all on table public.reminder_deliveries to service_role;

-- 3. Sending one reminder ---------------------------------------------------------------------------

-- Records the reminder and, only when it was not recorded before, queues it. Returns how many
-- notification rows were queued (0, 1 or 2).
--   p_email_by_default  false: email only for a person who switched email on for this reminder.
create or replace function public.send_reminder(
  p_tenant_id uuid,
  p_user_id uuid,
  p_reminder_type text,
  p_subject_id text,
  p_local_date date,
  p_subject text,
  p_body text,
  p_metadata jsonb,
  p_email_by_default boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_channels text[] := array['in-app'];
  v_count integer := 0;
begin
  if p_tenant_id is null or p_user_id is null or p_subject_id is null or p_local_date is null then
    return 0;
  end if;

  -- An active member of this club only (enqueue_notification checks again; this keeps the
  -- record clean for people who could never be told).
  if not exists (
    select 1 from public.profiles p
    where p.user_id = p_user_id and p.tenant_id = p_tenant_id and p.is_active
  ) then
    return 0;
  end if;

  insert into public.reminder_deliveries (tenant_id, user_id, reminder_type, subject_id, local_date)
  values (p_tenant_id, p_user_id, p_reminder_type, p_subject_id, p_local_date)
  on conflict on constraint reminder_deliveries_once_per_day do nothing
  returning id into v_id;

  if v_id is null then
    return 0;
  end if;

  if coalesce(p_email_by_default, false) or exists (
    select 1
    from public.notification_preferences np
    where np.user_id = p_user_id
      and np.channel = 'email'
      and np.event_type = p_reminder_type
      and np.enabled
  ) then
    v_channels := array_append(v_channels, 'email');
  end if;

  v_count := public.enqueue_notification(
    p_tenant_id,
    p_user_id,
    p_reminder_type,
    p_subject,
    p_body,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('reminder', true, 'local_date', to_char(p_local_date, 'YYYY-MM-DD')),
    v_channels
  );

  update public.reminder_deliveries rd set queued_count = v_count where rd.id = v_id;
  return v_count;
end;
$$;

revoke all on function public.send_reminder(uuid, uuid, text, text, date, text, text, jsonb, boolean) from public, anon, authenticated;

-- 4. The job ----------------------------------------------------------------------------------------

-- Local hours. One place, so the tests and the job agree.
create or replace function public.reminder_local_hour(p_reminder_type text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_reminder_type
    when 'reminder_session_today' then 7
    when 'reminder_athletes_not_logged' then 8
    when 'reminder_checkin' then 9
    -- First hour of the window on the last day of a test week (the window ends at 20:59).
    when 'reminder_test_week_closing' then 8
    when 'reminder_test_week_closing_coach' then 8
  end
$$;

revoke all on function public.reminder_local_hour(text) from public, anon, authenticated;

-- Runs every hour. p_now exists so the job can be checked with a fixed time; p_tenant_id limits a
-- run to one club. Returns one row per reminder type with how many notification rows it queued.
-- Safe to run as often as you like: reminder_deliveries decides what was already sent.
create or replace function public.run_reminders(
  p_now timestamptz default now(),
  p_tenant_id uuid default null
)
returns table (reminder_type text, queued integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant record;
  v_row record;
  v_coach_user_id uuid;
  v_tz text;
  v_local timestamp;
  v_date date;
  v_hour integer;
  v_session integer := 0;
  v_checkin integer := 0;
  v_test_athlete integer := 0;
  v_test_coach integer := 0;
  v_digest integer := 0;
begin
  for v_tenant in
    select t.id
    from public.tenants t
    where t.is_active
      and (p_tenant_id is null or t.id = p_tenant_id)
      and not public.tenant_access_blocked(t.id)
    order by t.id
  loop
    begin
      v_tz := public.reminder_tenant_timezone(v_tenant.id);
      v_local := coalesce(p_now, now()) at time zone v_tz;
      v_date := v_local::date;
      v_hour := extract(hour from v_local)::integer;

      -- 4a. Session today.
      if v_hour = public.reminder_local_hour('reminder_session_today') then
        for v_row in
          select a.id as athlete_id, a.user_id, count(*) as session_count, min(s.title) as first_title
          from public.sessions s
          join public.athletes a
            on a.id = s.athlete_id
           and a.tenant_id = s.tenant_id
          where s.tenant_id = v_tenant.id
            and s.scheduled_for = v_date
            and s.status in ('scheduled', 'in-progress')
            and a.is_active
            and a.user_id is not null
            -- Only what the athlete can see: their own session, or one from a published plan.
            and (
              s.plan_id is null
              or exists (select 1 from public.training_plans tp where tp.id = s.plan_id and tp.status = 'published')
            )
            and not exists (select 1 from public.session_completions sc where sc.session_id = s.id)
            and not exists (
              select 1
              from public.athlete_availability av
              where av.athlete_id = a.id
                and av.starts_on <= v_date
                and (av.ends_on is null or av.ends_on >= v_date)
            )
          group by a.id, a.user_id
        loop
          v_session := v_session + public.send_reminder(
            v_tenant.id,
            v_row.user_id,
            'reminder_session_today',
            v_row.athlete_id::text,
            v_date,
            case
              when v_row.session_count > 1 then format('You have %s sessions today', v_row.session_count)
              else format('Today: %s', coalesce(nullif(left(btrim(v_row.first_title), 80), ''), 'your session'))
            end,
            'Open your log to see what is planned and to log it when you are done.',
            jsonb_build_object('athlete_id', v_row.athlete_id::text, 'session_date', to_char(v_date, 'YYYY-MM-DD')),
            false
          );
        end loop;
      end if;

      -- 4b. Check-in not done.
      if v_hour = public.reminder_local_hour('reminder_checkin') then
        for v_row in
          select a.id as athlete_id, a.user_id
          from public.athletes a
          where a.tenant_id = v_tenant.id
            and a.is_active
            and a.user_id is not null
            and a.team_id is not null
            and not exists (
              select 1 from public.wellness_entries we
              where we.athlete_id = a.id and we.entry_date = v_date
            )
        loop
          v_checkin := v_checkin + public.send_reminder(
            v_tenant.id,
            v_row.user_id,
            'reminder_checkin',
            v_row.athlete_id::text,
            v_date,
            'Your check-in for today is not done',
            'It takes under a minute and tells your coach how you are feeling before training.',
            jsonb_build_object('athlete_id', v_row.athlete_id::text, 'entry_date', to_char(v_date, 'YYYY-MM-DD')),
            false
          );
        end loop;
      end if;

      -- 4c. Test week closing. The week closes at the end of its last day, so any hour of that
      -- day is inside the last 24 hours. Sent from 08:00 to 20:00 so that a week published on
      -- its last day still reminds people, and nobody is woken at midnight.
      if v_hour between public.reminder_local_hour('reminder_test_week_closing') and 20 then
        for v_row in
          select tw.id, tw.team_id, tw.name,
                 coalesce(nullif(left(btrim(tw.name), 80), ''), 'Test week') as label
          from public.test_weeks tw
          where tw.tenant_id = v_tenant.id
            and tw.status = 'published'
            and not tw.is_archived
            and tw.team_id is not null
            and tw.end_date = v_date
            and exists (select 1 from public.test_definitions td where td.test_week_id = tw.id and td.is_required)
        loop
          declare
            v_missing record;
            v_athletes_missing integer := 0;
          begin
            for v_missing in
              select a.id as athlete_id, a.user_id, count(*) as missing_count
              from public.athletes a
              join public.test_definitions td
                on td.test_week_id = v_row.id
               and td.is_required
              where a.tenant_id = v_tenant.id
                and a.team_id = v_row.team_id
                and a.is_active
                and not exists (
                  select 1 from public.test_results tr
                  where tr.test_week_id = v_row.id
                    and tr.test_definition_id = td.id
                    and tr.athlete_id = a.id
                )
              group by a.id, a.user_id
            loop
              v_athletes_missing := v_athletes_missing + 1;
              -- An athlete with no login cannot be told; their coach still counts them below.
              if v_missing.user_id is not null then
                v_test_athlete := v_test_athlete + public.send_reminder(
                  v_tenant.id,
                  v_missing.user_id,
                  'reminder_test_week_closing',
                  v_row.id::text,
                  v_date,
                  format('%s closes tonight', v_row.label),
                  case
                    when v_missing.missing_count = 1 then 'You still have 1 required test without a result. Add it before the end of today.'
                    else format('You still have %s required tests without a result. Add them before the end of today.', v_missing.missing_count)
                  end,
                  jsonb_build_object('test_week_id', v_row.id::text, 'team_id', v_row.team_id::text, 'missing_count', v_missing.missing_count),
                  true
                );
              end if;
            end loop;

            if v_athletes_missing > 0 then
              -- Team scope: only the coaches assigned to this week's team.
              for v_coach_user_id in select public.notification_team_coach_user_ids(v_row.team_id)
              loop
                v_test_coach := v_test_coach + public.send_reminder(
                  v_tenant.id,
                  v_coach_user_id,
                  'reminder_test_week_closing_coach',
                  v_row.id::text,
                  v_date,
                  format('%s closes tonight', v_row.label),
                  case
                    when v_athletes_missing = 1 then '1 athlete still has required results missing.'
                    else format('%s athletes still have required results missing.', v_athletes_missing)
                  end,
                  jsonb_build_object('test_week_id', v_row.id::text, 'team_id', v_row.team_id::text, 'athlete_count', v_athletes_missing),
                  true
                );
              end loop;
            end if;
          end;
        end loop;
      end if;

      -- 4d. Coach digest: who did not log yesterday. One row per coach, across the teams they
      -- coach. A skipped session (the athlete said why) and a session inside an injured, sick
      -- or away period are not "not logged".
      if v_hour = public.reminder_local_hour('reminder_athletes_not_logged') then
        for v_row in
          select tc.user_id,
                 count(distinct a.id) as athlete_count,
                 count(distinct a.team_id) as team_count,
                 (array_agg(distinct a.team_id::text))[1] as first_team_id
          from public.team_coaches tc
          join public.profiles p
            on p.user_id = tc.user_id
           and p.tenant_id = tc.tenant_id
           and p.is_active
           and p.role in ('coach', 'club-admin')
          join public.athletes a
            on a.team_id = tc.team_id
           and a.tenant_id = tc.tenant_id
           and a.is_active
          join public.sessions s
            on s.athlete_id = a.id
           and s.tenant_id = a.tenant_id
           and s.scheduled_for = v_date - 1
           and s.status in ('scheduled', 'in-progress')
          where tc.tenant_id = v_tenant.id
            and (
              s.plan_id is null
              or exists (select 1 from public.training_plans tp where tp.id = s.plan_id and tp.status = 'published')
            )
            and not exists (select 1 from public.session_completions sc where sc.session_id = s.id)
            and not exists (
              select 1
              from public.athlete_availability av
              where av.athlete_id = a.id
                and av.starts_on <= v_date - 1
                and (av.ends_on is null or av.ends_on >= v_date - 1)
            )
          group by tc.user_id
        loop
          v_digest := v_digest + public.send_reminder(
            v_tenant.id,
            v_row.user_id,
            'reminder_athletes_not_logged',
            v_tenant.id::text,
            v_date,
            case
              when v_row.athlete_count = 1 then '1 athlete did not log yesterday''s session'
              else format('%s athletes did not log yesterday''s session', v_row.athlete_count)
            end,
            case
              when v_row.team_count > 1 then format('Across %s of your teams, for %s.', v_row.team_count, public.notification_date_label(v_date - 1))
              else format('For %s. Open the team to see who.', public.notification_date_label(v_date - 1))
            end,
            jsonb_build_object(
              'athlete_count', v_row.athlete_count,
              'session_date', to_char(v_date - 1, 'YYYY-MM-DD')
            ) || case when v_row.team_count = 1 then jsonb_build_object('team_id', v_row.first_team_id) else '{}'::jsonb end,
            false
          );
        end loop;
      end if;
    exception
      when others then
        -- One club's problem must not stop the reminders of every other club.
        raise warning 'run_reminders: club % failed: %', v_tenant.id, sqlerrm;
    end;
  end loop;

  reminder_type := 'reminder_session_today'; queued := v_session; return next;
  reminder_type := 'reminder_checkin'; queued := v_checkin; return next;
  reminder_type := 'reminder_test_week_closing'; queued := v_test_athlete; return next;
  reminder_type := 'reminder_test_week_closing_coach'; queued := v_test_coach; return next;
  reminder_type := 'reminder_athletes_not_logged'; queued := v_digest; return next;
end;
$$;

revoke all on function public.run_reminders(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.run_reminders(timestamptz, uuid) to service_role;

-- 5. Schedule ---------------------------------------------------------------------------------------
-- Every hour on the hour (every club time zone the app is likely to meet is a whole or half hour
-- from UTC; a half hour zone is served in the second half of its local hour). Guarded like
-- 20261007090000: without pg_cron nothing is scheduled and the file still applies.
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron is not installed: no reminder schedule created.';
    return;
  end if;

  begin
    execute 'select cron.unschedule(jobname) from cron.job where jobname = ''sktr-run-reminders''';
  exception
    when others then
      raise notice 'Could not remove the earlier reminder schedule (%).', sqlerrm;
  end;

  execute 'select cron.schedule(''sktr-run-reminders'', ''0 * * * *'', ''select public.run_reminders()'')';
exception
  when others then
    raise notice 'Could not create the reminder schedule (%). Reminders will not be sent until it exists.', sqlerrm;
end
$$;

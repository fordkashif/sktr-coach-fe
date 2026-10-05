-- SKTR Coach: notifications that reach people
-- Created: 2026-10-07
--
-- BEFORE THIS FILE
--   * Notification emails were only sent when a platform admin pressed "Send queued emails".
--   * Only seven things ever notified anyone (club requests, invites accepted, plan published,
--     test week published).
--   * The plan and test week triggers did not look at deactivated members.
--   * A preference row for one kind of update beat "turn the whole channel off".
--
-- WHAT THIS FILE DOES
--   1. Preferences: every kind of update has a default per channel
--      (notification_default_enabled). "Whole channel off" now wins over everything.
--   2. One way to queue a notification (enqueue_notification) that applies the same rules every
--      time: never the person who did the thing, never a deactivated member, never a member of a
--      suspended or cancelled club, never another club, never a channel the person switched off,
--      and never the same thing twice inside a short window.
--   3. New events (triggers), next to the existing ones:
--        athlete     training_plan_published (rewritten), training_plan_updated,
--                    test_week_published (rewritten), session_note_added,
--                    athlete_team_added, athlete_team_removed
--        coach       athlete_session_completed (in-app, rolled up per team per day),
--                    athlete_test_results_submitted (in-app, rolled up per test week),
--                    athlete_low_readiness (in-app; email off unless switched on),
--                    coach_team_assigned, coach_team_removed
--        club admin  package_request_reviewed, club_suspended, club_reactivated
--   4. Email delivery without a manual step:
--        * claim_notification_emails / complete_notification_email: the queue. Rows are claimed
--          with FOR UPDATE SKIP LOCKED, so two runs never send the same email. Failures are
--          retried with a growing delay, five attempts at most.
--        * notification_dispatch_config: one private row holding a random token made here. The
--          database sends it when it calls the dispatch-notification-emails edge function and the
--          function checks it. The service role key is never stored in SQL.
--        * request_notification_email_dispatch(): calls the edge function through pg_net when
--          there is something due. It runs (a) every minute from pg_cron and (b) straight after
--          any statement that queues an email. Both are guarded: if pg_cron or pg_net is not
--          available this file still applies, and email falls back to the app asking the edge
--          function to send its club's queue after an action (see the edge function).
--        * The address of the edge function is learned without setup: from the issuer of the
--          signed-in user's token on the first write that queues an email, and from the edge
--          function itself whenever it runs (register_notification_dispatch_url).
--   5. Realtime: user_notifications joins the supabase_realtime publication (guarded).
--   6. get_platform_notification_email_stats(): counts for the platform admin dashboard.
--
-- Idempotent and additive: add column if not exists, create ... if not exists, create or replace,
-- drop trigger if exists + create trigger, insert ... on conflict do nothing. No table or column
-- is dropped, no existing row is changed, and no notification is created for anything that
-- happened before this file ran.
--
-- One behaviour to know about: the queue will not send an email that is more than 72 hours old.
-- When delivery runs, such rows are marked 'suppressed' with the reason in last_error instead of
-- arriving months late. That only happens at delivery time, never in this migration.

-- 0. Columns and indexes ------------------------------------------------------------------

alter table public.notification_events
  add column if not exists next_attempt_at timestamptz;

comment on column public.notification_events.next_attempt_at is
  'Email channel: do not retry before this time. Set after a failed attempt (growing delay).';

-- The email queue: only rows still waiting are indexed.
create index if not exists notification_events_email_queue_idx
on public.notification_events (created_at)
where channel = 'email' and status in ('pending', 'failed');

-- "Did we already tell this person about this?" and the per-user feed.
create index if not exists notification_events_recipient_type_created_idx
on public.notification_events (recipient_user_id, event_type, created_at desc);

create index if not exists user_notifications_recipient_created_idx
on public.user_notifications (recipient_user_id, created_at desc);

-- 1. Preferences --------------------------------------------------------------------------

-- The default for a kind of update on a channel, used when the person has not chosen.
-- Keep in step with src/lib/notification-categories.ts (the settings screen shows the same defaults).
create or replace function public.notification_default_enabled(p_channel text, p_event_type text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_channel = 'email' and p_event_type in (
      'training_plan_updated',
      'athlete_low_readiness',
      'athlete_session_completed',
      'athlete_test_results_submitted'
    ) then false
    else true
  end
$$;

-- Answer order:
--   1. the whole channel is off ('*' row with enabled = false): no.
--   2. the person chose for this kind of update: their choice.
--   3. otherwise the default above.
-- (Before this file a choice for one kind of update beat "whole channel off", which contradicted
-- what the settings screen says.)
create or replace function public.notification_channel_enabled(
  p_channel text,
  p_event_type text,
  p_recipient_user_id uuid default null,
  p_recipient_email text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select np.event_type, np.enabled
    from public.notification_preferences np
    where np.channel = p_channel
      and np.event_type in ('*', p_event_type)
      and (
        (p_recipient_user_id is not null and np.user_id = p_recipient_user_id)
        or (p_recipient_user_id is null and p_recipient_email is not null and lower(np.email) = lower(p_recipient_email))
      )
  )
  select case
    when exists (select 1 from mine m where m.event_type = '*' and m.enabled = false) then false
    else coalesce(
      (select m.enabled from mine m where m.event_type = p_event_type limit 1),
      public.notification_default_enabled(p_channel, p_event_type)
    )
  end
$$;

revoke all on function public.notification_default_enabled(text, text) from public, anon;
grant execute on function public.notification_default_enabled(text, text) to authenticated, service_role;
revoke all on function public.notification_channel_enabled(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.notification_channel_enabled(text, text, uuid, text) to service_role;

-- 2. Who can be told ----------------------------------------------------------------------

-- Active coaches assigned to a team. Same rule as is_team_coach() in 20261006120000, written for
-- "everyone on this team" instead of "the signed-in user". The club's lifecycle is checked once
-- by the caller (enqueue_notification), not per coach.
create or replace function public.notification_team_coach_user_ids(p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tc.user_id
  from public.team_coaches tc
  join public.teams t
    on t.id = tc.team_id
   and t.tenant_id = tc.tenant_id
  join public.profiles p
    on p.user_id = tc.user_id
   and p.tenant_id = tc.tenant_id
  where tc.team_id = p_team_id
    and p.role in ('coach', 'club-admin')
    and p.is_active
$$;

-- Active club admins of a club.
create or replace function public.notification_club_admin_user_ids(p_tenant_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id
  from public.profiles p
  where p.tenant_id = p_tenant_id
    and p.role = 'club-admin'
    and p.is_active
$$;

-- "Maya Chen". Names are user input: kept to one tidy line.
create or replace function public.notification_athlete_name(p_athlete_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(left(btrim(regexp_replace(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, ''), '\s+', ' ', 'g')), 80), ''),
    'An athlete'
  )
  from public.athletes a
  where a.id = p_athlete_id
$$;

-- "5 Oct 2026"
create or replace function public.notification_date_label(p_date date)
returns text
language sql
immutable
set search_path = public
as $$
  select to_char(p_date, 'FMDD Mon YYYY')
$$;

-- The one way to queue a notification. Returns how many rows it queued (0, 1 or 2).
--   p_tenant_id            the club this is about. NULL only for platform level events.
--   p_channels             'in-app', 'email' or both.
--   p_dedupe_key/window    skip when this person was already told about the same thing (same key,
--                          same channel) inside the window. An advisory lock makes that safe when
--                          two writes land at the same moment.
--   p_allow_blocked_tenant true only for the "your club is paused" notice.
-- It never raises: a problem queueing a notification must not undo the write that caused it
-- (publishing a plan, finishing a session). The problem is logged as a warning instead.
create or replace function public.enqueue_notification(
  p_tenant_id uuid,
  p_recipient_user_id uuid,
  p_event_type text,
  p_subject text,
  p_body text,
  p_metadata jsonb default '{}'::jsonb,
  p_channels text[] default array['in-app', 'email'],
  p_dedupe_key text default null,
  p_dedupe_window interval default null,
  p_allow_blocked_tenant boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_channel text;
  v_metadata jsonb;
  v_count integer := 0;
begin
  if p_recipient_user_id is null or p_event_type is null or p_subject is null then
    return 0;
  end if;

  -- Never tell someone about what they just did themselves.
  if auth.uid() is not null and auth.uid() = p_recipient_user_id then
    return 0;
  end if;

  -- The account must still exist (this also keeps a delete of the account from failing when a
  -- trigger fires while its rows are being removed).
  select lower(nullif(btrim(coalesce(au.email, '')), ''))
  into v_email
  from auth.users au
  where au.id = p_recipient_user_id;
  if not found then
    return 0;
  end if;

  if p_tenant_id is not null then
    -- Only an active member of this club.
    if not exists (
      select 1
      from public.profiles p
      where p.user_id = p_recipient_user_id
        and p.tenant_id = p_tenant_id
        and p.is_active
    ) then
      return 0;
    end if;

    -- Nobody in a suspended or cancelled club, except for the notice about that itself.
    if not coalesce(p_allow_blocked_tenant, false) and public.tenant_access_blocked(p_tenant_id) then
      return 0;
    end if;
  end if;

  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  if p_dedupe_key is not null then
    v_metadata := v_metadata || jsonb_build_object('dedupe_key', p_dedupe_key);
    perform pg_advisory_xact_lock(hashtextextended('notification:' || p_recipient_user_id::text || ':' || p_dedupe_key, 0));
  end if;

  foreach v_channel in array coalesce(p_channels, array['in-app', 'email'])
  loop
    if v_channel not in ('in-app', 'email') then
      continue;
    end if;
    if v_channel = 'email' and v_email is null then
      continue;
    end if;
    if not public.notification_channel_enabled(v_channel, p_event_type, p_recipient_user_id, v_email) then
      continue;
    end if;
    if p_dedupe_key is not null and p_dedupe_window is not null and exists (
      select 1
      from public.notification_events e
      where e.recipient_user_id = p_recipient_user_id
        and e.channel = v_channel
        and e.metadata ->> 'dedupe_key' = p_dedupe_key
        and e.created_at > now() - p_dedupe_window
    ) then
      continue;
    end if;

    insert into public.notification_events (
      tenant_id, recipient_user_id, recipient_email, channel, event_type, subject, body, status, metadata
    )
    values (
      p_tenant_id, p_recipient_user_id, v_email, v_channel, p_event_type,
      left(p_subject, 200), nullif(left(coalesce(p_body, ''), 1000), ''), 'pending', v_metadata
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
exception
  when others then
    raise warning 'enqueue_notification(%) failed: %', p_event_type, sqlerrm;
    return 0;
end;
$$;

-- In-app roll-up for things that happen many times a day ("3 athletes finished a session").
-- While the coach has not read the notification for this key, the next athlete is added to it
-- instead of creating another one. In-app only: these never become emails.
--   p_rollup_key     what is being counted, for example 'session_completed:<team>:<date>'.
--   p_single_subject subject while one athlete is in it. '%s' is replaced by the name.
--   p_many_subject   subject for two or more. '%s' is replaced by the count.
--   p_context        short text after the names ("Sprints").
--   p_repeat_after   an athlete already reported for this key inside this window is not reported again.
create or replace function public.enqueue_rollup_notification(
  p_tenant_id uuid,
  p_recipient_user_id uuid,
  p_event_type text,
  p_rollup_key text,
  p_athlete_id uuid,
  p_single_subject text,
  p_many_subject text,
  p_context text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_repeat_after interval default interval '6 hours'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_event_id uuid;
  v_metadata jsonb;
  v_ids jsonb;
  v_names jsonb;
  v_count integer;
  v_body text;
begin
  if p_recipient_user_id is null or p_athlete_id is null or p_rollup_key is null then
    return 0;
  end if;
  if auth.uid() is not null and auth.uid() = p_recipient_user_id then
    return 0;
  end if;
  if not exists (select 1 from auth.users au where au.id = p_recipient_user_id) then
    return 0;
  end if;
  if p_tenant_id is null
     or public.tenant_access_blocked(p_tenant_id)
     or not exists (
       select 1 from public.profiles p
       where p.user_id = p_recipient_user_id and p.tenant_id = p_tenant_id and p.is_active
     ) then
    return 0;
  end if;
  if not public.notification_channel_enabled('in-app', p_event_type, p_recipient_user_id, null) then
    return 0;
  end if;

  v_name := coalesce(public.notification_athlete_name(p_athlete_id), 'An athlete');
  perform pg_advisory_xact_lock(hashtextextended('notification:' || p_recipient_user_id::text || ':' || p_rollup_key, 0));

  -- Already reported for this key a moment ago (read or not): say nothing.
  if exists (
    select 1
    from public.notification_events e
    where e.recipient_user_id = p_recipient_user_id
      and e.channel = 'in-app'
      and e.event_type = p_event_type
      and e.metadata ->> 'rollup_key' = p_rollup_key
      and e.metadata -> 'athlete_ids' ? p_athlete_id::text
      and e.created_at > now() - coalesce(p_repeat_after, interval '6 hours')
  ) then
    return 0;
  end if;

  select e.id, e.metadata
  into v_event_id, v_metadata
  from public.notification_events e
  join public.user_notifications un
    on un.event_id = e.id
   and un.recipient_user_id = e.recipient_user_id
  where e.recipient_user_id = p_recipient_user_id
    and e.channel = 'in-app'
    and e.event_type = p_event_type
    and e.metadata ->> 'rollup_key' = p_rollup_key
    and un.state = 'unread'
  order by e.created_at desc
  limit 1
  for update of e;

  if v_event_id is null then
    insert into public.notification_events (
      tenant_id, recipient_user_id, recipient_email, channel, event_type, subject, body, status, metadata
    )
    values (
      p_tenant_id, p_recipient_user_id, null, 'in-app', p_event_type,
      left(format(p_single_subject, v_name), 200),
      nullif(coalesce(p_context, ''), ''),
      'pending',
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'rollup_key', p_rollup_key,
        'athlete_ids', jsonb_build_array(p_athlete_id::text),
        'athlete_names', jsonb_build_array(v_name),
        'athlete_id', p_athlete_id::text
      )
    );
    return 1;
  end if;

  v_ids := coalesce(v_metadata -> 'athlete_ids', '[]'::jsonb) || to_jsonb(p_athlete_id::text);
  v_names := coalesce(v_metadata -> 'athlete_names', '[]'::jsonb) || to_jsonb(v_name);
  v_count := jsonb_array_length(v_ids);
  v_body := case
    when v_count = 2 then format('%s and %s', v_names ->> 0, v_names ->> 1)
    when v_count = 3 then format('%s, %s and %s', v_names ->> 0, v_names ->> 1, v_names ->> 2)
    else format('%s, %s and %s more', v_names ->> 0, v_names ->> 1, v_count - 2)
  end || case when nullif(coalesce(p_context, ''), '') is null then '' else format(' (%s)', p_context) end;

  update public.notification_events e
  set subject = left(format(p_many_subject, v_count), 200),
      body = left(v_body, 1000),
      metadata = (e.metadata - 'athlete_id') || jsonb_build_object('athlete_ids', v_ids, 'athlete_names', v_names),
      created_at = now()
  where e.id = v_event_id;

  -- Moves it back to the top of the feed (and tells Realtime listeners).
  update public.user_notifications un
  set created_at = now()
  where un.event_id = v_event_id
    and un.recipient_user_id = p_recipient_user_id;

  return 1;
exception
  when others then
    raise warning 'enqueue_rollup_notification(%) failed: %', p_event_type, sqlerrm;
    return 0;
end;
$$;

revoke all on function public.notification_team_coach_user_ids(uuid) from public, anon, authenticated;
revoke all on function public.notification_club_admin_user_ids(uuid) from public, anon, authenticated;
revoke all on function public.notification_athlete_name(uuid) from public, anon, authenticated;
revoke all on function public.notification_date_label(date) from public, anon, authenticated;
revoke all on function public.enqueue_notification(uuid, uuid, text, text, text, jsonb, text[], text, interval, boolean) from public, anon, authenticated;
revoke all on function public.enqueue_rollup_notification(uuid, uuid, text, text, uuid, text, text, text, jsonb, interval) from public, anon, authenticated;

-- 3. Athlete events -----------------------------------------------------------------------

-- 3a. Training plan published or updated.
-- Tells every athlete a published plan currently reaches (immediate assignments only): the
-- athletes named in athlete assignments and the active athletes of the teams in team assignments.
-- One notification per athlete per plan per hour, whatever combination of writes a publish makes
-- (the dedupe key is the plan, shared by "published" and "updated").
create or replace function public.notify_training_plan_audience(
  p_plan_id uuid,
  p_event_type text,
  p_assignment_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_team_name text;
  v_recipient record;
  v_subject text;
  v_body text;
  v_count integer := 0;
begin
  select tp.id, tp.tenant_id, tp.team_id, tp.name, tp.start_date, tp.status
  into v_plan
  from public.training_plans tp
  where tp.id = p_plan_id;

  -- Athletes cannot see a plan that is not published, so they are not told about it.
  if not found or v_plan.status <> 'published' then
    return 0;
  end if;

  select tm.name into v_team_name from public.teams tm where tm.id = v_plan.team_id;

  if p_event_type = 'training_plan_updated' then
    v_subject := format('Your plan changed: %s', coalesce(nullif(btrim(v_plan.name), ''), 'Training plan'));
    v_body := 'Your coach updated the plan. Open it to see what is different.';
  else
    v_subject := format('New training plan: %s', coalesce(nullif(btrim(v_plan.name), ''), 'Training plan'));
    v_body := format(
      'Your coach published a plan for %s%s.',
      case when v_team_name is null then 'you' else v_team_name end,
      case when v_plan.start_date is null then '' else format('. It starts on %s', public.notification_date_label(v_plan.start_date)) end
    );
  end if;

  for v_recipient in
    select distinct a.user_id
    from public.training_plan_assignments tpa
    join public.athletes a
      on a.tenant_id = tpa.tenant_id
     and (
       (tpa.scope = 'athlete' and a.id = tpa.athlete_id)
       or (tpa.scope = 'team' and a.team_id = tpa.team_id)
     )
    where tpa.plan_id = v_plan.id
      and tpa.tenant_id = v_plan.tenant_id
      and tpa.visibility_start = 'immediate'
      and (p_assignment_id is null or tpa.id = p_assignment_id)
      and a.user_id is not null
      and a.is_active
  loop
    v_count := v_count + public.enqueue_notification(
      v_plan.tenant_id,
      v_recipient.user_id,
      p_event_type,
      v_subject,
      v_body,
      jsonb_build_object('plan_id', v_plan.id::text, 'team_id', v_plan.team_id::text),
      array['in-app', 'email'],
      'plan:' || v_plan.id::text,
      interval '1 hour'
    );
  end loop;

  return v_count;
end;
$$;

revoke all on function public.notify_training_plan_audience(uuid, text, uuid) from public, anon, authenticated;

-- Assignment written (the usual publish path), or an assignment that was scheduled becomes immediate.
create or replace function public.enqueue_training_plan_assignment_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility_start <> 'immediate' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.visibility_start = 'immediate' then
    return new;
  end if;

  perform public.notify_training_plan_audience(new.plan_id, 'training_plan_published', new.id);
  return new;
end;
$$;

drop trigger if exists queue_training_plan_assignment_notifications on public.training_plan_assignments;
create trigger queue_training_plan_assignment_notifications
after insert on public.training_plan_assignments
for each row
execute function public.enqueue_training_plan_assignment_notifications();

drop trigger if exists queue_training_plan_assignment_notifications_on_update on public.training_plan_assignments;
create trigger queue_training_plan_assignment_notifications_on_update
after update of visibility_start on public.training_plan_assignments
for each row
when (old.visibility_start is distinct from new.visibility_start and new.visibility_start = 'immediate')
execute function public.enqueue_training_plan_assignment_notifications();

-- The plan row itself: published after its assignments already existed, or a published plan edited.
-- A publish writes many rows (weeks, days, blocks, sessions) but exactly one update of the plan row
-- carries the edit, so this fires once per publish and never per session.
create or replace function public.enqueue_training_plan_change_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'published' then
    return new;
  end if;

  if old.status is distinct from 'published' then
    perform public.notify_training_plan_audience(new.id, 'training_plan_published', null);
  elsif (new.name, new.start_date, new.weeks, new.notes, new.builder_state)
        is distinct from (old.name, old.start_date, old.weeks, old.notes, old.builder_state) then
    perform public.notify_training_plan_audience(new.id, 'training_plan_updated', null);
  end if;

  return new;
end;
$$;

drop trigger if exists queue_training_plan_change_notifications on public.training_plans;
create trigger queue_training_plan_change_notifications
after update on public.training_plans
for each row
execute function public.enqueue_training_plan_change_notifications();

-- 3b. Test week published (on insert, and when a draft is published later: 20261004121000).
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

-- (Both test week triggers from 20260322190000 and 20261004121000 stay as they are; they call the
-- function above.)

-- 3c. The coach added or changed the note on one of the athlete's sessions.
create or replace function public.enqueue_session_note_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete_user_id uuid;
  v_coach_name text;
begin
  if nullif(btrim(coalesce(new.coach_note, '')), '') is null
     or new.coach_note is not distinct from old.coach_note then
    return new;
  end if;

  select a.user_id
  into v_athlete_user_id
  from public.athletes a
  where a.id = new.athlete_id
    and a.tenant_id = new.tenant_id
    and a.is_active;

  select nullif(left(btrim(coalesce(p.display_name, '')), 80), '')
  into v_coach_name
  from public.profiles p
  where p.user_id = auth.uid()
    and p.tenant_id = new.tenant_id;

  perform public.enqueue_notification(
    new.tenant_id,
    v_athlete_user_id,
    'session_note_added',
    format('%s left a note on your session', coalesce(v_coach_name, 'Your coach')),
    format('%s, %s. Open the session to read it.', coalesce(nullif(btrim(new.title), ''), 'Session'), public.notification_date_label(new.scheduled_for)),
    jsonb_build_object(
      'session_id', new.id::text,
      'athlete_id', new.athlete_id::text,
      'session_date', to_char(new.scheduled_for, 'YYYY-MM-DD')
    ),
    array['in-app', 'email'],
    'session_note:' || new.id::text,
    interval '10 minutes'
  );

  return new;
end;
$$;

drop trigger if exists queue_session_note_notifications on public.sessions;
create trigger queue_session_note_notifications
after update of coach_note on public.sessions
for each row
when (new.coach_note is distinct from old.coach_note)
execute function public.enqueue_session_note_notifications();

-- 3d. The athlete was added to, moved to or removed from a team by someone else.
-- (Joining with a code or an invite is the athlete's own action, so it tells them nothing.)
create or replace function public.enqueue_athlete_team_change_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_team text;
  v_new_team text;
begin
  if new.team_id is not distinct from old.team_id or new.user_id is null or not new.is_active then
    return new;
  end if;

  select tm.name into v_old_team from public.teams tm where tm.id = old.team_id;
  select tm.name into v_new_team from public.teams tm where tm.id = new.team_id;

  if new.team_id is not null then
    perform public.enqueue_notification(
      new.tenant_id,
      new.user_id,
      'athlete_team_added',
      format('You were added to %s', coalesce(v_new_team, 'a team')),
      case
        when v_old_team is null then 'Plans and test weeks for this team will now show up for you.'
        else format('You moved from %s. Plans and test weeks for your new team will now show up for you.', v_old_team)
      end,
      jsonb_build_object('team_id', new.team_id::text, 'athlete_id', new.id::text),
      array['in-app', 'email'],
      'athlete_team:' || new.id::text || ':' || new.team_id::text,
      interval '10 minutes'
    );
  elsif v_old_team is not null then
    -- old.team_id set and the team still exists: a real removal, not a team being deleted.
    perform public.enqueue_notification(
      new.tenant_id,
      new.user_id,
      'athlete_team_removed',
      format('You were removed from %s', v_old_team),
      'You are not on a team right now. Ask your coach or club if this was not expected.',
      jsonb_build_object('athlete_id', new.id::text),
      array['in-app', 'email'],
      'athlete_team:' || new.id::text || ':none',
      interval '10 minutes'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists queue_athlete_team_change_notifications on public.athletes;
create trigger queue_athlete_team_change_notifications
after update of team_id on public.athletes
for each row
when (old.team_id is distinct from new.team_id)
execute function public.enqueue_athlete_team_change_notifications();

-- 4. Coach events -------------------------------------------------------------------------

-- 4a. An athlete finished a session. In-app only, one notification per team per day that grows
-- ("3 athletes finished a session today") while the coach has not read it.
create or replace function public.enqueue_session_completed_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete record;
  v_team_name text;
  v_coach_user_id uuid;
begin
  select a.id, a.team_id, a.tenant_id
  into v_athlete
  from public.athletes a
  where a.id = new.athlete_id
    and a.tenant_id = new.tenant_id;

  if not found or v_athlete.team_id is null then
    return new;
  end if;

  select tm.name into v_team_name from public.teams tm where tm.id = v_athlete.team_id;

  for v_coach_user_id in select public.notification_team_coach_user_ids(v_athlete.team_id)
  loop
    perform public.enqueue_rollup_notification(
      new.tenant_id,
      v_coach_user_id,
      'athlete_session_completed',
      'session_completed:' || v_athlete.team_id::text || ':' || to_char(new.completion_date, 'YYYY-MM-DD'),
      new.athlete_id,
      '%s finished a session',
      '%s athletes finished a session',
      v_team_name,
      jsonb_build_object(
        'team_id', v_athlete.team_id::text,
        'session_id', new.session_id::text,
        'completion_date', to_char(new.completion_date, 'YYYY-MM-DD')
      ),
      interval '20 hours'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists queue_session_completed_notifications on public.session_completions;
create trigger queue_session_completed_notifications
after insert on public.session_completions
for each row
execute function public.enqueue_session_completed_notifications();

-- 4b. An athlete submitted test week results. In-app only. A submission writes one row per test
-- in one statement, so this is a statement trigger: one notification per athlete per test week,
-- rolled up per test week ("4 athletes submitted results").
create or replace function public.enqueue_test_results_submitted_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_coach_user_id uuid;
begin
  for v_row in
    select distinct nr.tenant_id, nr.test_week_id, nr.athlete_id, tw.name as test_week_name,
           coalesce(tw.team_id, a.team_id) as team_id
    from new_rows nr
    join public.athletes a on a.id = nr.athlete_id and a.tenant_id = nr.tenant_id
    join public.test_weeks tw on tw.id = nr.test_week_id and tw.tenant_id = nr.tenant_id
    -- Only what the athlete entered themselves. A coach entering results knows already.
    where a.user_id is not null
      and nr.submitted_by_user_id = a.user_id
  loop
    if v_row.team_id is null then
      continue;
    end if;
    for v_coach_user_id in select public.notification_team_coach_user_ids(v_row.team_id)
    loop
      perform public.enqueue_rollup_notification(
        v_row.tenant_id,
        v_coach_user_id,
        'athlete_test_results_submitted',
        'test_results:' || v_row.test_week_id::text,
        v_row.athlete_id,
        '%s submitted test week results',
        '%s athletes submitted test week results',
        nullif(btrim(coalesce(v_row.test_week_name, '')), ''),
        jsonb_build_object('test_week_id', v_row.test_week_id::text, 'team_id', v_row.team_id::text),
        interval '12 hours'
      );
    end loop;
  end loop;

  return null;
end;
$$;

drop trigger if exists queue_test_results_submitted_notifications on public.test_results;
create trigger queue_test_results_submitted_notifications
after insert on public.test_results
referencing new table as new_rows
for each statement
execute function public.enqueue_test_results_submitted_notifications();

-- 4c. An athlete's check-in for today came back red. In-app; email only for coaches who switch it on.
create or replace function public.enqueue_low_readiness_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete record;
  v_team_name text;
  v_name text;
  v_coach_user_id uuid;
begin
  if new.readiness <> 'red' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.readiness = 'red' then
    return new;
  end if;
  -- Today's check-in only (a day either side covers time zones). Back-filled days stay quiet.
  if new.entry_date < current_date - 1 or new.entry_date > current_date + 1 then
    return new;
  end if;

  select a.id, a.team_id
  into v_athlete
  from public.athletes a
  where a.id = new.athlete_id
    and a.tenant_id = new.tenant_id
    and a.is_active;

  if not found or v_athlete.team_id is null then
    return new;
  end if;

  select tm.name into v_team_name from public.teams tm where tm.id = v_athlete.team_id;
  v_name := public.notification_athlete_name(new.athlete_id);

  for v_coach_user_id in select public.notification_team_coach_user_ids(v_athlete.team_id)
  loop
    perform public.enqueue_notification(
      new.tenant_id,
      v_coach_user_id,
      'athlete_low_readiness',
      format('%s reported low readiness', v_name),
      format(
        'Their check-in for %s needs a look before training%s.',
        public.notification_date_label(new.entry_date),
        case when v_team_name is null then '' else format(' (%s)', v_team_name) end
      ),
      jsonb_build_object(
        'athlete_id', new.athlete_id::text,
        'team_id', v_athlete.team_id::text,
        'entry_date', to_char(new.entry_date, 'YYYY-MM-DD')
      ),
      array['in-app', 'email'],
      'readiness:' || new.athlete_id::text || ':' || to_char(new.entry_date, 'YYYY-MM-DD'),
      interval '1 day'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists queue_low_readiness_notifications on public.wellness_entries;
create trigger queue_low_readiness_notifications
after insert or update of readiness on public.wellness_entries
for each row
execute function public.enqueue_low_readiness_notifications();

-- 4d. A coach was assigned to or removed from a team by a club admin.
-- (Accepting an invite adds the coach to the team as their own action, so it tells them nothing.)
create or replace function public.enqueue_team_coach_change_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.team_coaches%rowtype;
  v_team_name text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  -- The team must still exist. When a team is deleted its coach rows go with it: say nothing.
  select tm.name into v_team_name from public.teams tm where tm.id = v_row.team_id and tm.tenant_id = v_row.tenant_id;
  if not found then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform public.enqueue_notification(
      v_row.tenant_id,
      v_row.user_id,
      'coach_team_assigned',
      format('You now coach %s', v_team_name),
      'You can see this team''s athletes, build plans for them and run test weeks.',
      jsonb_build_object('team_id', v_row.team_id::text),
      array['in-app', 'email'],
      'coach_team:' || v_row.team_id::text || ':assigned',
      interval '10 minutes'
    );
  else
    perform public.enqueue_notification(
      v_row.tenant_id,
      v_row.user_id,
      'coach_team_removed',
      format('You no longer coach %s', v_team_name),
      'A club admin changed the coaches of this team. Its athletes and plans no longer show up for you.',
      jsonb_build_object('removed_team_id', v_row.team_id::text),
      array['in-app', 'email'],
      'coach_team:' || v_row.team_id::text || ':removed',
      interval '10 minutes'
    );
  end if;

  return null;
end;
$$;

drop trigger if exists queue_team_coach_change_notifications on public.team_coaches;
create trigger queue_team_coach_change_notifications
after insert or delete on public.team_coaches
for each row
execute function public.enqueue_team_coach_change_notifications();

-- 5. Club admin events --------------------------------------------------------------------

-- 5a. A package request was approved or declined by the platform.
create or replace function public.enqueue_package_request_reviewed_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_user_id uuid;
  v_package text;
  v_note text;
begin
  if old.status <> 'pending' or new.status not in ('approved', 'rejected') then
    return new;
  end if;

  v_package := initcap(coalesce(new.requested_package, 'new'));
  v_note := nullif(left(btrim(regexp_replace(coalesce(new.review_notes, ''), '\s+', ' ', 'g')), 300), '');

  for v_admin_user_id in select public.notification_club_admin_user_ids(new.tenant_id)
  loop
    perform public.enqueue_notification(
      new.tenant_id,
      v_admin_user_id,
      'package_request_reviewed',
      case when new.status = 'approved' then 'Package request approved' else 'Package request declined' end,
      case
        when new.status = 'approved' then format('Your club is now on the %s package.', v_package)
        else format('Your request to move to the %s package was declined.%s', v_package, case when v_note is null then '' else format(' Note from SKTR Coach: %s', v_note) end)
      end,
      jsonb_build_object('package_request_id', new.id::text, 'status', new.status, 'requested_package', new.requested_package),
      array['in-app', 'email'],
      'package_request:' || new.id::text,
      interval '1 day'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists queue_package_request_reviewed_notifications on public.tenant_package_upgrade_requests;
create trigger queue_package_request_reviewed_notifications
after update of status on public.tenant_package_upgrade_requests
for each row
when (old.status is distinct from new.status)
execute function public.enqueue_package_request_reviewed_notifications();

-- 5b. The club was suspended or its access was turned back on.
-- Suspended: email only (nobody in the club can open the app to see anything else), and it is the
-- one notice allowed for a blocked club. Back on: email and in-app.
create or replace function public.enqueue_club_lifecycle_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_user_id uuid;
  v_club_name text;
  v_event_type text;
begin
  if new.provisioned_tenant_id is null or new.lifecycle_status is not distinct from old.lifecycle_status then
    return new;
  end if;

  if new.lifecycle_status = 'suspended' then
    v_event_type := 'club_suspended';
  elsif old.lifecycle_status = 'suspended' and new.lifecycle_status in ('active', 'active_onboarding') then
    v_event_type := 'club_reactivated';
  else
    return new;
  end if;

  -- Only the club's latest provisioning record decides its access (same rule as the row policies).
  if exists (
    select 1
    from public.tenant_provision_requests newer
    where newer.provisioned_tenant_id = new.provisioned_tenant_id
      and newer.created_at > new.created_at
  ) then
    return new;
  end if;

  select t.name into v_club_name from public.tenants t where t.id = new.provisioned_tenant_id;
  v_club_name := coalesce(nullif(left(btrim(coalesce(v_club_name, new.organization_name, '')), 80), ''), 'your club');

  for v_admin_user_id in select public.notification_club_admin_user_ids(new.provisioned_tenant_id)
  loop
    if v_event_type = 'club_suspended' then
      perform public.enqueue_notification(
        new.provisioned_tenant_id,
        v_admin_user_id,
        'club_suspended',
        format('Access to SKTR Coach is paused for %s', v_club_name),
        'Coaches and athletes cannot use the club in SKTR Coach until access is turned back on. Nothing has been deleted. Contact SKTR Coach support if you have questions.',
        jsonb_build_object('tenant_provision_request_id', new.id::text, 'lifecycle_status', new.lifecycle_status),
        array['email'],
        'club_lifecycle:' || new.provisioned_tenant_id::text || ':suspended',
        interval '10 minutes',
        true
      );
    else
      perform public.enqueue_notification(
        new.provisioned_tenant_id,
        v_admin_user_id,
        'club_reactivated',
        format('Access to SKTR Coach is back on for %s', v_club_name),
        'Coaches and athletes can sign in again. Everything is as you left it.',
        jsonb_build_object('tenant_provision_request_id', new.id::text, 'lifecycle_status', new.lifecycle_status),
        array['in-app', 'email'],
        'club_lifecycle:' || new.provisioned_tenant_id::text || ':reactivated',
        interval '10 minutes'
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists queue_club_lifecycle_notifications on public.tenant_provision_requests;
create trigger queue_club_lifecycle_notifications
after update of lifecycle_status on public.tenant_provision_requests
for each row
when (old.lifecycle_status is distinct from new.lifecycle_status)
execute function public.enqueue_club_lifecycle_notifications();

-- Trigger functions are not part of the API.
revoke all on function public.enqueue_training_plan_assignment_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_training_plan_change_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_test_week_published_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_session_note_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_athlete_team_change_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_session_completed_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_test_results_submitted_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_low_readiness_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_team_coach_change_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_package_request_reviewed_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_club_lifecycle_notifications() from public, anon, authenticated;

-- 6. The email queue ----------------------------------------------------------------------

-- One private row. No policies: nobody reaches it through the API; the functions below read it.
create table if not exists public.notification_dispatch_config (
  id boolean primary key default true check (id),
  scheduler_token text not null,
  function_url text,
  last_requested_at timestamptz,
  last_request_source text,
  last_run_at timestamptz,
  last_run_mode text,
  last_run_summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notification_dispatch_config is
  'Single private row: the random token the database presents to the dispatch-notification-emails edge function, the function address, and when delivery last ran. Never exposed through the API.';

alter table public.notification_dispatch_config enable row level security;
revoke all on table public.notification_dispatch_config from public, anon, authenticated;

-- 64 hex characters (244 random bits) from gen_random_uuid() (built in, needs no extension).
-- Made once: applying this file again keeps the token.
insert into public.notification_dispatch_config (id, scheduler_token)
values (true, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

drop trigger if exists set_updated_at_notification_dispatch_config on public.notification_dispatch_config;
create trigger set_updated_at_notification_dispatch_config
before update on public.notification_dispatch_config
for each row
execute function public.set_updated_at();

-- The edge function asks "is this the token?". It never reads the token.
create or replace function public.verify_notification_scheduler_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(length(p_token) >= 32 and exists (
    select 1 from public.notification_dispatch_config c where c.scheduler_token = p_token
  ), false)
$$;

-- The edge function tells the database where it lives, so the scheduler needs no setup.
-- Only an address that ends in the function's own path is accepted.
create or replace function public.register_notification_dispatch_url(p_url text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
begin
  if v_url !~ '^https?://[A-Za-z0-9.:-]+/functions/v1/dispatch-notification-emails$' then
    return false;
  end if;

  update public.notification_dispatch_config c
  set function_url = v_url
  where c.id and c.function_url is distinct from v_url;

  return true;
end;
$$;

-- The edge function records each run, for the platform admin dashboard.
create or replace function public.record_notification_dispatch_run(p_mode text, p_summary jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_dispatch_config c
  set last_run_at = now(),
      last_run_mode = left(coalesce(p_mode, ''), 40),
      last_run_summary = p_summary
  where c.id
$$;

-- How long an email may wait before it is no longer worth sending.
create or replace function public.notification_email_max_age()
returns interval
language sql
immutable
set search_path = public
as $$
  select interval '72 hours'
$$;

-- Takes up to p_limit emails off the queue and returns them to be sent.
--   * FOR UPDATE SKIP LOCKED: two runs at the same moment get different rows.
--   * A claimed row carries processing_started_at; it is not claimed again for 10 minutes. If the
--     sender died in between, the row comes back after that (the provider is sent an idempotency
--     key per row, so even then the email is not delivered twice).
--   * Rows that must not be sent are marked 'suppressed' here, with the reason in last_error:
--     no address, too old, the club is suspended or cancelled, the recipient is no longer an
--     active member of the club, or the recipient switched this email off.
--   * p_tenant_id limits the run to one club (used when the app asks for its own club's queue).
--   * p_ignore_backoff: the platform admin's manual "Send queued emails" retries failed rows now.
create or replace function public.claim_notification_emails(
  p_limit integer default 20,
  p_tenant_id uuid default null,
  p_event_ids uuid[] default null,
  p_ignore_backoff boolean default false
)
returns table (
  id uuid,
  tenant_id uuid,
  tenant_name text,
  recipient_user_id uuid,
  recipient_email text,
  recipient_role text,
  event_type text,
  subject text,
  body text,
  metadata jsonb,
  created_at timestamptz,
  delivery_attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.notification_events%rowtype;
  v_email text;
  v_reason text;
  v_role text;
begin
  for v_event in
    select e.*
    from public.notification_events e
    where e.channel = 'email'
      and e.status in ('pending', 'failed')
      and e.delivery_attempt_count < 5
      and (e.processing_started_at is null or e.processing_started_at < now() - interval '10 minutes')
      and (coalesce(p_ignore_backoff, false) or e.next_attempt_at is null or e.next_attempt_at <= now())
      and (p_tenant_id is null or e.tenant_id = p_tenant_id)
      and (p_event_ids is null or e.id = any (p_event_ids))
    order by e.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  loop
    v_reason := null;
    v_role := null;

    v_email := lower(nullif(btrim(coalesce(v_event.recipient_email, '')), ''));
    if v_email is null and v_event.recipient_user_id is not null then
      select lower(nullif(btrim(coalesce(au.email, '')), '')) into v_email
      from auth.users au where au.id = v_event.recipient_user_id;
    end if;

    if v_event.recipient_user_id is not null then
      select p.role into v_role from public.profiles p where p.user_id = v_event.recipient_user_id;
      if v_role is null and exists (
        select 1 from public.platform_admin_contacts pac
        where pac.is_active and (pac.user_id = v_event.recipient_user_id or lower(pac.email) = v_email)
      ) then
        v_role := 'platform-admin';
      end if;
    end if;

    if v_email is null or v_email !~ '^[^[:space:]@<>"]+@[^[:space:]@<>"]+\.[^[:space:]@<>"]+$' then
      v_reason := 'Not sent: no valid email address.';
    elsif v_event.created_at < now() - public.notification_email_max_age() then
      v_reason := 'Not sent: it was more than 72 hours old when delivery ran.';
    elsif v_event.tenant_id is not null
          and v_event.event_type <> 'club_suspended'
          and public.tenant_access_blocked(v_event.tenant_id) then
      v_reason := 'Not sent: the club is suspended or cancelled.';
    elsif v_event.tenant_id is not null
          and v_event.recipient_user_id is not null
          and not exists (
            select 1 from public.profiles p
            where p.user_id = v_event.recipient_user_id
              and p.tenant_id = v_event.tenant_id
              and p.is_active
          ) then
      v_reason := 'Not sent: the recipient is no longer an active member of the club.';
    elsif not public.notification_channel_enabled('email', v_event.event_type, v_event.recipient_user_id, v_email) then
      v_reason := 'Not sent: turned off in the recipient''s notification settings.';
    end if;

    if v_reason is not null then
      update public.notification_events e
      set status = 'suppressed',
          last_error = v_reason,
          processing_started_at = null,
          next_attempt_at = null
      where e.id = v_event.id;
      continue;
    end if;

    update public.notification_events e
    set processing_started_at = now(),
        delivery_attempt_count = e.delivery_attempt_count + 1
    where e.id = v_event.id;

    id := v_event.id;
    tenant_id := v_event.tenant_id;
    tenant_name := (select t.name from public.tenants t where t.id = v_event.tenant_id);
    recipient_user_id := v_event.recipient_user_id;
    recipient_email := v_email;
    recipient_role := v_role;
    event_type := v_event.event_type;
    subject := v_event.subject;
    body := v_event.body;
    metadata := v_event.metadata;
    created_at := v_event.created_at;
    delivery_attempt_count := v_event.delivery_attempt_count + 1;
    return next;
  end loop;

  return;
end;
$$;

-- Records what happened to a claimed email. Only a row that is still claimed can be completed,
-- so a run that lost its claim cannot overwrite the result of the run that took over.
--   sent                 status 'sent', delivered_at now.
--   failed, p_retry      status 'failed', next attempt after 2, 4, 8, 16 minutes (5 attempts in all).
--   failed, not p_retry  status 'failed' for good (the provider will never accept it).
create or replace function public.complete_notification_email(
  p_event_id uuid,
  p_sent boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_retry boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.notification_events e
  set status = case when p_sent then 'sent' else 'failed' end,
      delivered_at = case when p_sent then now() else e.delivered_at end,
      provider_message_id = coalesce(nullif(left(coalesce(p_provider_message_id, ''), 200), ''), e.provider_message_id),
      last_error = case when p_sent then null else left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'Unknown email delivery failure.'), 500) end,
      next_attempt_at = case
        when p_sent or not coalesce(p_retry, true) then null
        else now() + (interval '1 minute' * power(2, least(e.delivery_attempt_count, 6)))
      end,
      delivery_attempt_count = case
        when not p_sent and not coalesce(p_retry, true) then greatest(e.delivery_attempt_count, 5)
        else e.delivery_attempt_count
      end,
      processing_started_at = null
  where e.id = p_event_id
    and e.channel = 'email'
    and e.status in ('pending', 'failed')
    and e.processing_started_at is not null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Is there an email that could be sent right now?
create or replace function public.notification_email_queue_due()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.notification_events e
    where e.channel = 'email'
      and e.status in ('pending', 'failed')
      and e.delivery_attempt_count < 5
      and (e.processing_started_at is null or e.processing_started_at < now() - interval '10 minutes')
      and (e.next_attempt_at is null or e.next_attempt_at <= now())
  )
$$;

-- Asks the edge function to send what is due. Used by the scheduler and by the insert trigger.
-- Returns what it did, for checking by hand:
--   'idle'       nothing is due (no HTTP call is made)
--   'no_pg_net'  the pg_net extension is not available in this database
--   'no_url'     the address of the edge function is not known yet
--   'requested'  the call was queued (pg_net sends it after this transaction commits)
--   'error: ...' pg_net refused the call
-- It never raises.
create or replace function public.request_notification_email_dispatch(p_source text default 'manual')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config public.notification_dispatch_config%rowtype;
begin
  if not public.notification_email_queue_due() then
    return 'idle';
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return 'no_pg_net';
  end if;

  select * into v_config from public.notification_dispatch_config c where c.id;
  if not found or v_config.function_url is null then
    return 'no_url';
  end if;

  execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := $4)'
  using
    v_config.function_url,
    jsonb_build_object('source', coalesce(p_source, 'manual')),
    jsonb_build_object('Content-Type', 'application/json', 'x-sktr-scheduler-token', v_config.scheduler_token),
    30000;

  -- Bookkeeping only. Skipped rather than waited for when another transaction holds the row,
  -- so two writers that queue email at the same moment never wait on each other.
  update public.notification_dispatch_config c
  set last_requested_at = now(),
      last_request_source = left(coalesce(p_source, 'manual'), 40)
  where c.id
    and c.id in (select c2.id from public.notification_dispatch_config c2 where c2.id for update skip locked);

  return 'requested';
exception
  when others then
    return 'error: ' || sqlerrm;
end;
$$;

-- Straight after a statement queues an email: learn the edge function's address if it is not
-- known yet, and ask for delivery. Nothing here can fail the statement that queued the email.
create or replace function public.notification_events_request_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issuer text;
begin
  if not exists (select 1 from new_events ne where ne.channel = 'email' and ne.status = 'pending') then
    return null;
  end if;

  -- Once per transaction is enough: a publish to a team of forty queues forty emails, one
  -- statement each, and they are all there by the time the call goes out (after commit).
  if current_setting('sktr.notification_dispatch_requested', true) = txid_current()::text then
    return null;
  end if;

  begin
    perform set_config('sktr.notification_dispatch_requested', txid_current()::text, true);

    -- A hosted project's tokens are issued by https://<project>.supabase.co/auth/v1, and its
    -- functions live at https://<project>.supabase.co/functions/v1. The issuer comes from the
    -- verified token of the signed-in user, never from anything a caller can type.
    if exists (select 1 from public.notification_dispatch_config c where c.id and c.function_url is null) then
      v_issuer := coalesce(auth.jwt() ->> 'iss', '');
      if v_issuer ~ '^https://[a-z0-9-]+\.supabase\.(co|in|red)/auth/v1$' then
        update public.notification_dispatch_config c
        set function_url = regexp_replace(v_issuer, '/auth/v1$', '/functions/v1/dispatch-notification-emails')
        where c.id and c.function_url is null;
      end if;
    end if;

    perform public.request_notification_email_dispatch('insert');
  exception
    when others then
      raise warning 'notification_events_request_dispatch failed: %', sqlerrm;
  end;

  return null;
end;
$$;

drop trigger if exists request_dispatch_after_email_queued on public.notification_events;
create trigger request_dispatch_after_email_queued
after insert on public.notification_events
referencing new table as new_events
for each statement
execute function public.notification_events_request_dispatch();

revoke all on function public.verify_notification_scheduler_token(text) from public, anon, authenticated;
revoke all on function public.register_notification_dispatch_url(text) from public, anon, authenticated;
revoke all on function public.record_notification_dispatch_run(text, jsonb) from public, anon, authenticated;
revoke all on function public.notification_email_max_age() from public, anon, authenticated;
revoke all on function public.claim_notification_emails(integer, uuid, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.complete_notification_email(uuid, boolean, text, text, boolean) from public, anon, authenticated;
revoke all on function public.notification_email_queue_due() from public, anon, authenticated;
revoke all on function public.request_notification_email_dispatch(text) from public, anon, authenticated;
revoke all on function public.notification_events_request_dispatch() from public, anon, authenticated;
grant execute on function public.verify_notification_scheduler_token(text) to service_role;
grant execute on function public.register_notification_dispatch_url(text) to service_role;
grant execute on function public.record_notification_dispatch_run(text, jsonb) to service_role;
grant execute on function public.claim_notification_emails(integer, uuid, uuid[], boolean) to service_role;
grant execute on function public.complete_notification_email(uuid, boolean, text, text, boolean) to service_role;
grant execute on function public.notification_email_queue_due() to service_role;

-- 7. Scheduler ----------------------------------------------------------------------------
-- Both extensions ship with hosted Supabase projects. Each step is guarded on its own, so this
-- file applies cleanly where an extension is missing or may not be created; delivery then relies
-- on the other paths (see the header).

do $$
begin
  create extension if not exists pg_net;
exception
  when others then
    raise notice 'pg_net is not available here (%). Emails will be sent when the app asks for it.', sqlerrm;
end
$$;

do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron is not available here (%). Emails are still sent straight after they are queued (pg_net) or when the app asks for it.', sqlerrm;
end
$$;

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron is not installed: no schedule created.';
    return;
  end if;

  -- Re-applying this file replaces the jobs instead of adding more.
  begin
    execute 'select cron.unschedule(jobid) from cron.job where jobname in (''sktr-dispatch-notification-emails'', ''sktr-trim-cron-run-history'')';
  exception
    when others then
      raise notice 'Could not remove earlier schedules (%).', sqlerrm;
  end;

  -- Every minute. The function makes no HTTP call when nothing is due.
  execute 'select cron.schedule(''sktr-dispatch-notification-emails'', ''* * * * *'', ''select public.request_notification_email_dispatch(''''cron'''')'')';

  -- pg_cron keeps one history row per run and never removes them: keep a week.
  if to_regclass('cron.job_run_details') is not null then
    execute 'select cron.schedule(''sktr-trim-cron-run-history'', ''17 3 * * *'', ''delete from cron.job_run_details where end_time < now() - interval ''''7 days'''''')';
  end if;
exception
  when others then
    raise notice 'Could not create the email schedule (%). Emails are still sent straight after they are queued (pg_net) or when the app asks for it.', sqlerrm;
end
$$;

-- 8. Realtime -----------------------------------------------------------------------------
-- Lets the app hear about a new notification as it happens. Realtime applies the table's own
-- row policies, so a person only ever receives their own rows. Guarded: without the publication
-- (or when it already covers every table) nothing happens and the app falls back to polling.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_notifications'
     ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
exception
  when others then
    raise notice 'user_notifications was not added to the realtime publication (%).', sqlerrm;
end
$$;

-- 9. Platform admin: is email working? ----------------------------------------------------
-- Counts only, platform admins only (anyone else gets no rows).
--   sent_24h           emails delivered in the last 24 hours
--   failed_24h         emails from the last 24 hours that failed and will not be retried
--   retrying           failed at least once, will be tried again
--   waiting            queued and not tried yet
--   not_sent_24h       held back in the last 24 hours (switched off, deactivated, suspended, too old)
--   oldest_waiting_at  when the oldest email still in the queue was created
--   delivery_mode      'scheduled' (pg_cron + pg_net), 'on_queue' (pg_net only), 'on_request' (neither:
--                      the app or the "Send queued emails" button), 'waiting_for_address' (the
--                      extensions are there but the edge function's address is not known yet)
--   last_run_at        when the edge function last ran
create or replace function public.get_platform_notification_email_stats()
returns table (
  sent_24h integer,
  failed_24h integer,
  retrying integer,
  waiting integer,
  not_sent_24h integer,
  oldest_waiting_at timestamptz,
  delivery_mode text,
  last_run_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has_net boolean := to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null;
  v_has_job boolean := false;
  v_url text;
begin
  if not public.is_platform_admin() then
    return;
  end if;

  if to_regclass('cron.job') is not null then
    begin
      execute 'select exists (select 1 from cron.job where jobname = ''sktr-dispatch-notification-emails'' and active)' into v_has_job;
    exception
      when others then
        v_has_job := false;
    end;
  end if;

  select c.function_url, c.last_run_at into v_url, last_run_at
  from public.notification_dispatch_config c where c.id;

  delivery_mode := case
    when not v_has_net then 'on_request'
    when v_url is null then 'waiting_for_address'
    when v_has_job then 'scheduled'
    else 'on_queue'
  end;

  select
    count(*) filter (where e.status = 'sent' and e.delivered_at > now() - interval '24 hours'),
    count(*) filter (where e.status = 'failed' and e.delivery_attempt_count >= 5 and e.created_at > now() - interval '24 hours'),
    count(*) filter (where e.status = 'failed' and e.delivery_attempt_count < 5 and e.created_at > now() - public.notification_email_max_age()),
    count(*) filter (where e.status = 'pending' and e.created_at > now() - public.notification_email_max_age()),
    count(*) filter (where e.status = 'suppressed' and e.created_at > now() - interval '24 hours'),
    min(e.created_at) filter (where e.status in ('pending', 'failed') and e.delivery_attempt_count < 5 and e.created_at > now() - public.notification_email_max_age())
  into sent_24h, failed_24h, retrying, waiting, not_sent_24h, oldest_waiting_at
  from public.notification_events e
  where e.channel = 'email'
    and e.created_at > now() - interval '8 days';

  return next;
end;
$$;

revoke all on function public.get_platform_notification_email_stats() from public, anon;
grant execute on function public.get_platform_notification_email_stats() to authenticated, service_role;

-- SKTR Coach: push notifications (Web Push)
-- Created: 2026-10-16
--
-- WHY
--   The bell only helps once the app is open. A phone that has the app on its Home Screen, or a
--   browser that allows it, can be told at once: "you have a new message", "your plan is out".
--
-- HOW IT FITS WHAT IS ALREADY THERE
--   The bell stays the source of truth. Push is an extra on top of it: every push is made FROM an
--   in-app notification (a notification_events row with channel 'in-app'), by a trigger, for each
--   device the person switched push on for. So every rule that decides whether the in-app
--   notification exists (never the person who did the thing, never a deactivated member, never a
--   paused club, never another club, dedupe windows) holds for push with no second copy of it,
--   and a role added later gets push the day it gets notifications. Nothing here lists roles.
--
--   Consequence to know about: a kind of update whose in-app switch is off is not pushed either.
--   The settings screen says so.
--
-- WHAT THIS FILE ADDS
--   1. notification_preferences accepts a third channel, 'push'. The existing own-row policies
--      cover it. push_default_enabled(type) holds the defaults (keep in step with
--      src/lib/notifications/push-defaults.ts); push_notification_enabled(user, type) answers for
--      one person the same way notification_channel_enabled does: whole channel off wins, then
--      the person's choice for that kind of update, then the default.
--   2. push_subscriptions: one row per browser or installed app a person switched push on for.
--        register_push_subscription(...)   the only way a row is written. Takes the endpoint
--                                          over when another account used this browser before.
--        remove_push_subscription(endpoint) sign out and "turn off" on this device.
--        send_test_push(subscription)      queues one test message to one of the caller's devices.
--      A person reads and deletes only their own rows.
--   3. push_deliveries: the queue, one row per notification per device, with its own claimed
--      state, apart from the email queue. A failing push never holds an email back.
--        claim_push_deliveries      FOR UPDATE SKIP LOCKED; holds back what must not be sent
--                                   (paused club, deactivated member, switched off, device turned
--                                   off, already read in the app, too old).
--        complete_push_delivery     sent / gone (404 or 410: the device is disabled) / retry /
--                                   failed.
--      Never sent twice: a row is claimed by one run only, and a claimed row that never reported
--      back is closed as failed instead of being sent again (email can retry safely because the
--      provider takes an idempotency key; a push service does not).
--   4. Delivery uses the pipeline that already sends email: request_push_dispatch() calls the
--      dispatch-notification-emails edge function with the same scheduler token, straight after
--      a push is queued and every minute from pg_cron. Guarded the same way: without pg_net or
--      pg_cron this file still applies and the app asks the function itself.
--
-- DELETION
--   Both tables carry tenant_id (cascade) and a cascade to auth.users, so delete_my_account,
--   delete_closed_club and sweep_rows_by_column (20261014120000) remove them with no change.
--   No column here references auth.users with "set null".
--
-- Idempotent: create table if not exists, create or replace function, drop policy / trigger if
-- exists before create, unschedule then schedule. Applying it twice changes nothing.

-- 1. Preferences: a third channel ---------------------------------------------------------------

-- The channel check was written inline in 20260322170000, so its name was chosen by Postgres.
-- Every check on this table that mentions the channel is replaced by the one below.
do $$
declare
  v_name text;
begin
  for v_name in
    select k.conname
    from pg_catalog.pg_constraint k
    where k.conrelid = 'public.notification_preferences'::regclass
      and k.contype = 'c'
      and pg_get_constraintdef(k.oid) ilike '%channel%'
      and k.conname <> 'notification_preferences_channel_check_v2'
  loop
    execute format('alter table public.notification_preferences drop constraint %I', v_name);
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_constraint k
    where k.conrelid = 'public.notification_preferences'::regclass
      and k.conname = 'notification_preferences_channel_check_v2'
  ) then
    alter table public.notification_preferences
      add constraint notification_preferences_channel_check_v2 check (channel in ('in-app', 'email', 'push'));
  end if;
end
$$;

-- Push is on unless switched off for the things a person would want to know about now, and off
-- unless switched on for everything else (roll-ups, digests, account housekeeping).
-- Keep in step with src/lib/notifications/push-defaults.ts.
create or replace function public.push_default_enabled(p_event_type text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_event_type in (
    'direct_message_received',
    'announcement_posted',
    'training_plan_published',
    'test_week_published',
    'test_week_reopened',
    'athlete_pain_reported',
    'athlete_report_shared',
    'reminder_session_today',
    'reminder_checkin',
    'reminder_test_week_closing',
    'reminder_test_week_closing_coach',
    'push_test'
  ), false)
$$;

-- Answer order, the same as notification_channel_enabled():
--   1. the whole push channel is off ('*' row with enabled = false): no.
--   2. the person chose for this kind of update: their choice.
--   3. otherwise the default above.
create or replace function public.push_notification_enabled(p_user_id uuid, p_event_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select np.event_type, np.enabled
    from public.notification_preferences np
    where np.channel = 'push'
      and np.user_id = p_user_id
      and np.event_type in ('*', p_event_type)
  )
  select case
    when p_user_id is null then false
    when exists (select 1 from mine m where m.event_type = '*' and m.enabled = false) then false
    else coalesce(
      (select m.enabled from mine m where m.event_type = p_event_type limit 1),
      public.push_default_enabled(p_event_type)
    )
  end
$$;

revoke all on function public.push_default_enabled(text) from public, anon;
grant execute on function public.push_default_enabled(text) to authenticated, service_role;
revoke all on function public.push_notification_enabled(uuid, text) from public, anon, authenticated;
grant execute on function public.push_notification_enabled(uuid, text) to service_role;

-- 2. Devices ------------------------------------------------------------------------------------

-- The server posts to the endpoint a browser hands over, so only the push services of the
-- browsers this app supports are accepted: Chrome and other Chromium browsers (Google), Firefox
-- (Mozilla), Edge (Windows), Safari and the iOS Home Screen app (Apple). Anything else would let
-- a member point the server at an address of their choosing.
-- Keep in step with isAllowedPushEndpoint() in supabase/functions/_shared/push-message.ts.
create or replace function public.push_endpoint_allowed(p_endpoint text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    length(p_endpoint) <= 2000
    and p_endpoint ~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|jmt17\.google\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)/[^[:space:]]+$',
    false
  )
$$;

revoke all on function public.push_endpoint_allowed(text) from public, anon;
grant execute on function public.push_endpoint_allowed(text) to authenticated, service_role;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The person's club when the device was registered. NULL for a platform admin.
  tenant_id uuid references public.tenants(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  -- "Chrome on Android", "Safari on iPhone": worked out in the browser, shown in the device list.
  device_label text not null default 'This device',
  created_at timestamptz not null default now(),
  -- The last time this device opened the app with push on.
  last_used_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0,
  disabled_at timestamptz,
  disabled_reason text,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_allowed check (public.push_endpoint_allowed(endpoint)),
  constraint push_subscriptions_keys_shape check (
    p256dh ~ '^[A-Za-z0-9_-]{86,88}$' and auth ~ '^[A-Za-z0-9_-]{22,24}$'
  ),
  constraint push_subscriptions_label_length check (char_length(device_label) between 1 and 80)
);

comment on table public.push_subscriptions is
  'One row per browser or installed app a person switched push notifications on for. Written only by register_push_subscription(); a person reads and deletes their own rows.';

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id) where disabled_at is null;
create index if not exists push_subscriptions_tenant_idx on public.push_subscriptions (tenant_id);

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, delete on table public.push_subscriptions to authenticated;
grant all on table public.push_subscriptions to service_role;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
on public.push_subscriptions
for select
to authenticated
using (user_id = auth.uid());

-- Removing a device is always allowed for its owner, also for a deactivated member or a member
-- of a paused club: it only ever takes something away from themselves.
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
on public.push_subscriptions
for delete
to authenticated
using (user_id = auth.uid());

-- No insert or update policy on purpose: register_push_subscription() is the only writer.

-- "Chrome on Android" and nothing a person could use to put markup or a paragraph in a list.
create or replace function public.clean_push_device_label(p_label text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p_label, ''), '[[:cntrl:]<>]', ' ', 'g'), '\s+', ' ', 'g')), 80), ''),
    'This device'
  )
$$;

revoke all on function public.clean_push_device_label(text) from public, anon, authenticated;

-- Switches push on for the browser the caller is using, or refreshes it when the app opens.
--   * The caller must be signed in and active (assert_caller_active).
--   * A browser has one subscription, whoever is signed in. When another account registered this
--     endpoint before (a shared phone), that row is replaced: the device now belongs to the caller
--     and the earlier person stops getting pushes on it.
--   * p_replaces_endpoint: the browser handed out a new endpoint for the same device
--     (pushsubscriptionchange). The caller's row for the old one is removed.
--   * At most 10 devices per person; the least recently used are dropped.
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_device_label text default null,
  p_replaces_endpoint text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to turn on push notifications.' using errcode = '42501';
  end if;
  perform public.assert_caller_active();

  if not public.push_endpoint_allowed(v_endpoint) then
    raise exception 'Push notifications are not available for this browser yet.'
      using errcode = '22023', hint = 'push_endpoint_not_allowed';
  end if;
  if coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{86,88}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{22,24}$' then
    raise exception 'The browser did not hand over a usable push subscription.'
      using errcode = '22023', hint = 'push_keys_invalid';
  end if;

  select p.tenant_id into v_tenant from public.profiles p where p.user_id = v_uid;

  -- Someone else's row for this browser: theirs no longer.
  delete from public.push_subscriptions s where s.endpoint = v_endpoint and s.user_id <> v_uid;

  if p_replaces_endpoint is not null and btrim(p_replaces_endpoint) <> v_endpoint then
    delete from public.push_subscriptions s where s.endpoint = btrim(p_replaces_endpoint) and s.user_id = v_uid;
  end if;

  insert into public.push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth, device_label)
  values (v_uid, v_tenant, v_endpoint, p_p256dh, p_auth, public.clean_push_device_label(p_device_label))
  on conflict on constraint push_subscriptions_endpoint_key do update
    set tenant_id = excluded.tenant_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        device_label = excluded.device_label,
        last_used_at = now(),
        failure_count = 0,
        disabled_at = null,
        disabled_reason = null
  returning id into v_id;

  delete from public.push_subscriptions s
  where s.user_id = v_uid
    and s.id in (
      select s2.id
      from public.push_subscriptions s2
      where s2.user_id = v_uid
      order by (s2.id = v_id) desc, (s2.disabled_at is null) desc, s2.last_used_at desc
      offset 10
    );

  return v_id;
end;
$$;

-- Sign out, and "turn off" on this device. No active check: it must work for anyone signed in.
create or replace function public.remove_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null or p_endpoint is null then
    return false;
  end if;
  delete from public.push_subscriptions s
  where s.endpoint = btrim(p_endpoint) and s.user_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- 3. The push queue -----------------------------------------------------------------------------

create table if not exists public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  -- The in-app notification this push is about. NULL for a test message.
  event_id uuid references public.notification_events(id) on delete cascade,
  event_type text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'suppressed', 'gone')),
  attempt_count integer not null default 0,
  -- Set while one run of the sender holds this row.
  processing_started_at timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.push_deliveries is
  'The push queue: one row per in-app notification per device. Worked only by the dispatch edge function through claim_push_deliveries / complete_push_delivery. Never exposed through the API.';

-- One push per notification per device, whatever fires twice.
create unique index if not exists push_deliveries_event_subscription_key
on public.push_deliveries (event_id, subscription_id)
where event_id is not null;

create index if not exists push_deliveries_queue_idx
on public.push_deliveries (created_at)
where status in ('pending', 'failed');

create index if not exists push_deliveries_subscription_idx on public.push_deliveries (subscription_id, created_at desc);
create index if not exists push_deliveries_recipient_idx on public.push_deliveries (recipient_user_id);
create index if not exists push_deliveries_tenant_idx on public.push_deliveries (tenant_id);

-- No policies on purpose: nobody reaches this table through the API.
alter table public.push_deliveries enable row level security;
revoke all on table public.push_deliveries from public, anon, authenticated;
grant all on table public.push_deliveries to service_role;

-- How many times one push is tried, and how long it stays worth sending.
create or replace function public.push_max_attempts()
returns integer
language sql
immutable
set search_path = public
as $$ select 3 $$;

create or replace function public.push_max_age()
returns interval
language sql
immutable
set search_path = public
as $$ select interval '24 hours' $$;

revoke all on function public.push_max_attempts() from public, anon, authenticated;
revoke all on function public.push_max_age() from public, anon, authenticated;

-- An in-app notification was written: queue a push for each of the person's devices, when push
-- is on for this kind of update. Nothing here can fail the write that made the notification.
create or replace function public.queue_push_for_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel <> 'in-app' or new.recipient_user_id is null then
    return new;
  end if;

  begin
    if not exists (
      select 1 from public.push_subscriptions s
      where s.user_id = new.recipient_user_id and s.disabled_at is null
    ) then
      return new;
    end if;

    if not public.push_notification_enabled(new.recipient_user_id, new.event_type) then
      return new;
    end if;

    insert into public.push_deliveries (tenant_id, recipient_user_id, subscription_id, event_id, event_type)
    select new.tenant_id, new.recipient_user_id, s.id, new.id, new.event_type
    from public.push_subscriptions s
    where s.user_id = new.recipient_user_id
      and s.disabled_at is null
    on conflict do nothing;
  exception
    when others then
      raise warning 'queue_push_for_notification(%) failed: %', new.event_type, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.queue_push_for_notification() from public, anon, authenticated;

drop trigger if exists queue_push_after_in_app_notification on public.notification_events;
create trigger queue_push_after_in_app_notification
after insert on public.notification_events
for each row
when (new.channel = 'in-app' and new.recipient_user_id is not null)
execute function public.queue_push_for_notification();

-- "Send a test" in notification settings: one message to one of the caller's own devices.
-- Returns 'queued', or 'wait' when a test went to this device in the last 15 seconds.
create or replace function public.send_test_push(p_subscription_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sub public.push_subscriptions%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in to send a test notification.' using errcode = '42501';
  end if;
  perform public.assert_caller_active();

  select * into v_sub
  from public.push_subscriptions s
  where s.id = p_subscription_id and s.user_id = v_uid;
  if not found then
    raise exception 'That device is not one of yours.' using errcode = '42501', hint = 'push_device_not_found';
  end if;
  if v_sub.disabled_at is not null then
    raise exception 'Push is no longer on for that device. Turn it on again from that device.'
      using errcode = '22023', hint = 'push_device_disabled';
  end if;

  if exists (
    select 1 from public.push_deliveries d
    where d.subscription_id = v_sub.id
      and d.event_type = 'push_test'
      and d.created_at > now() - interval '15 seconds'
  ) then
    return 'wait';
  end if;

  insert into public.push_deliveries (tenant_id, recipient_user_id, subscription_id, event_id, event_type)
  values (v_sub.tenant_id, v_uid, v_sub.id, null, 'push_test');

  return 'queued';
end;
$$;

revoke all on function public.send_test_push(uuid) from public, anon;
grant execute on function public.send_test_push(uuid) to authenticated;

-- Takes up to p_limit pushes off the queue and returns them to be sent.
--   * FOR UPDATE SKIP LOCKED: two runs at the same moment get different rows.
--   * A claimed row carries processing_started_at and is never handed out again. A claimed row
--     that has not reported back after 10 minutes is closed as failed: the message may have gone
--     out, and a push service has no way to refuse a repeat.
--   * Rows that must not be sent are marked 'suppressed' with the reason in last_error.
--   * p_tenant_id limits the run to one club (the app asking for its own club's queue).
create or replace function public.claim_push_deliveries(
  p_limit integer default 20,
  p_tenant_id uuid default null
)
returns table (
  id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  recipient_user_id uuid,
  recipient_role text,
  event_type text,
  subject text,
  metadata jsonb,
  created_at timestamptz,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row public.push_deliveries%rowtype;
  v_sub public.push_subscriptions%rowtype;
  v_event public.notification_events%rowtype;
  v_reason text;
  v_role text;
begin
  update public.push_deliveries d
  set status = 'failed',
      attempt_count = public.push_max_attempts(),
      processing_started_at = null,
      next_attempt_at = null,
      completed_at = now(),
      last_error = 'Not sent again: the first attempt never reported back.'
  where d.status in ('pending', 'failed')
    and d.processing_started_at is not null
    and d.processing_started_at < now() - interval '10 minutes';

  for v_row in
    select d.*
    from public.push_deliveries d
    where d.status in ('pending', 'failed')
      and d.attempt_count < public.push_max_attempts()
      and d.processing_started_at is null
      and (d.next_attempt_at is null or d.next_attempt_at <= now())
      and (p_tenant_id is null or d.tenant_id = p_tenant_id)
    order by d.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  loop
    v_reason := null;
    v_role := null;
    v_event := null;

    select * into v_sub from public.push_subscriptions s where s.id = v_row.subscription_id;
    if v_row.event_id is not null then
      select * into v_event from public.notification_events e where e.id = v_row.event_id;
    end if;

    select p.role into v_role from public.profiles p where p.user_id = v_row.recipient_user_id;
    if v_role is null and exists (
      select 1 from public.platform_admin_contacts pac
      where pac.is_active and pac.user_id = v_row.recipient_user_id
    ) then
      v_role := 'platform-admin';
    end if;

    if v_sub.id is null or v_sub.disabled_at is not null or v_sub.user_id <> v_row.recipient_user_id then
      v_reason := 'Not sent: push is no longer on for this device.';
    elsif v_row.created_at < now() - public.push_max_age() then
      v_reason := 'Not sent: it was more than 24 hours old when delivery ran.';
    elsif v_row.tenant_id is not null
          and v_row.event_type <> 'club_suspended'
          and public.tenant_access_blocked(v_row.tenant_id) then
      v_reason := 'Not sent: the club is suspended or cancelled.';
    elsif v_row.tenant_id is not null and not exists (
            select 1 from public.profiles p
            where p.user_id = v_row.recipient_user_id
              and p.tenant_id = v_row.tenant_id
              and p.is_active
          ) then
      v_reason := 'Not sent: the recipient is no longer an active member of the club.';
    elsif v_row.event_type <> 'push_test'
          and not public.push_notification_enabled(v_row.recipient_user_id, v_row.event_type) then
      v_reason := 'Not sent: turned off in the recipient''s notification settings.';
    elsif v_row.event_id is not null and exists (
            select 1 from public.user_notifications un
            where un.event_id = v_row.event_id
              and un.recipient_user_id = v_row.recipient_user_id
              and un.state <> 'unread'
          ) then
      v_reason := 'Not sent: already read in the app.';
    end if;

    if v_reason is not null then
      update public.push_deliveries d
      set status = 'suppressed',
          last_error = v_reason,
          processing_started_at = null,
          next_attempt_at = null,
          completed_at = now()
      where d.id = v_row.id;
      continue;
    end if;

    update public.push_deliveries d
    set processing_started_at = now(),
        attempt_count = d.attempt_count + 1
    where d.id = v_row.id;

    id := v_row.id;
    subscription_id := v_sub.id;
    endpoint := v_sub.endpoint;
    p256dh := v_sub.p256dh;
    auth := v_sub.auth;
    recipient_user_id := v_row.recipient_user_id;
    recipient_role := v_role;
    event_type := v_row.event_type;
    subject := v_event.subject;
    metadata := coalesce(v_event.metadata, '{}'::jsonb);
    created_at := v_row.created_at;
    attempt_count := v_row.attempt_count + 1;
    return next;
  end loop;

  return;
end;
$$;

-- Records what happened to a claimed push. Only a row that is still claimed can be completed.
--   'sent'    accepted by the push service. The device's failure count goes back to 0.
--   'gone'    the push service answered 404 or 410: the device is disabled and anything else
--             waiting for it is dropped.
--   'retry'   try again after 2, then 4 minutes (3 attempts in all).
--   'failed'  refused for good. A device refused 8 times in a row with nothing accepted in
--             between is disabled.
create or replace function public.complete_push_delivery(
  p_delivery_id uuid,
  p_result text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.push_deliveries%rowtype;
  v_error text := left(coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'Unknown push delivery failure.'), 500);
  v_final boolean;
begin
  if p_result not in ('sent', 'gone', 'retry', 'failed') then
    return false;
  end if;

  select * into v_row
  from public.push_deliveries d
  where d.id = p_delivery_id
    and d.status in ('pending', 'failed')
    and d.processing_started_at is not null
  for update;
  if not found then
    return false;
  end if;

  if p_result = 'sent' then
    update public.push_deliveries d
    set status = 'sent', completed_at = now(), processing_started_at = null, next_attempt_at = null, last_error = null
    where d.id = v_row.id;

    update public.push_subscriptions s
    set last_success_at = now(), failure_count = 0
    where s.id = v_row.subscription_id;
    return true;
  end if;

  if p_result = 'gone' then
    update public.push_deliveries d
    set status = 'gone', completed_at = now(), processing_started_at = null, next_attempt_at = null, last_error = v_error
    where d.id = v_row.id;

    update public.push_subscriptions s
    set disabled_at = coalesce(s.disabled_at, now()),
        disabled_reason = coalesce(s.disabled_reason, 'gone'),
        failure_count = s.failure_count + 1
    where s.id = v_row.subscription_id;

    update public.push_deliveries d
    set status = 'suppressed', completed_at = now(), next_attempt_at = null,
        last_error = 'Not sent: push is no longer on for this device.'
    where d.subscription_id = v_row.subscription_id
      and d.id <> v_row.id
      and d.status in ('pending', 'failed')
      and d.processing_started_at is null;
    return true;
  end if;

  v_final := p_result = 'failed' or v_row.attempt_count >= public.push_max_attempts();

  update public.push_deliveries d
  set status = 'failed',
      last_error = v_error,
      processing_started_at = null,
      attempt_count = case when v_final then greatest(d.attempt_count, public.push_max_attempts()) else d.attempt_count end,
      next_attempt_at = case when v_final then null else now() + (interval '1 minute' * power(2, least(d.attempt_count, 6))) end,
      completed_at = case when v_final then now() else null end
  where d.id = v_row.id;

  update public.push_subscriptions s
  set failure_count = s.failure_count + 1,
      disabled_at = case when s.failure_count + 1 >= 8 then coalesce(s.disabled_at, now()) else s.disabled_at end,
      disabled_reason = case when s.failure_count + 1 >= 8 then coalesce(s.disabled_reason, 'failing') else s.disabled_reason end
  where s.id = v_row.subscription_id;

  return true;
end;
$$;

-- A run that had to stop hands back what it claimed and did not try. No attempt is used up.
create or replace function public.release_push_delivery(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.push_deliveries d
  set processing_started_at = null,
      attempt_count = greatest(0, d.attempt_count - 1)
  where d.id = p_delivery_id
    and d.status in ('pending', 'failed')
    and d.processing_started_at is not null;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- The sender has no keys (push is not set up for this environment): nothing waits forever.
create or replace function public.suppress_pending_push_deliveries(p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.push_deliveries d
  set status = 'suppressed',
      completed_at = now(),
      next_attempt_at = null,
      last_error = left(coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Not sent: push is not set up.'), 500)
  where d.status in ('pending', 'failed')
    and d.processing_started_at is null;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- Is there a push that could be sent right now?
create or replace function public.push_queue_due()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.push_deliveries d
    where d.status in ('pending', 'failed')
      and d.attempt_count < public.push_max_attempts()
      and d.processing_started_at is null
      and (d.next_attempt_at is null or d.next_attempt_at <= now())
  )
$$;

-- Asks the edge function that sends email to send what is due here too. The same private row
-- (notification_dispatch_config, 20261007090000) holds its address and the token it checks.
-- Returns 'idle', 'no_pg_net', 'no_url', 'requested' or 'error: ...'. It never raises.
create or replace function public.request_push_dispatch(p_source text default 'manual')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config public.notification_dispatch_config%rowtype;
begin
  if not public.push_queue_due() then
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
    jsonb_build_object('source', 'push-' || coalesce(p_source, 'manual')),
    jsonb_build_object('Content-Type', 'application/json', 'x-sktr-scheduler-token', v_config.scheduler_token),
    30000;

  return 'requested';
exception
  when others then
    return 'error: ' || sqlerrm;
end;
$$;

-- Straight after a statement queues a push: learn the edge function's address if it is not known
-- yet (same rule as for email), and ask for delivery once per transaction.
create or replace function public.push_deliveries_request_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issuer text;
begin
  if current_setting('sktr.push_dispatch_requested', true) = txid_current()::text then
    return null;
  end if;

  begin
    perform set_config('sktr.push_dispatch_requested', txid_current()::text, true);

    if exists (select 1 from public.notification_dispatch_config c where c.id and c.function_url is null) then
      v_issuer := coalesce(auth.jwt() ->> 'iss', '');
      if v_issuer ~ '^https://[a-z0-9-]+\.supabase\.(co|in|red)/auth/v1$' then
        update public.notification_dispatch_config c
        set function_url = regexp_replace(v_issuer, '/auth/v1$', '/functions/v1/dispatch-notification-emails')
        where c.id and c.function_url is null;
      end if;
    end if;

    perform public.request_push_dispatch('insert');
  exception
    when others then
      raise warning 'push_deliveries_request_dispatch failed: %', sqlerrm;
  end;

  return null;
end;
$$;

drop trigger if exists request_dispatch_after_push_queued on public.push_deliveries;
create trigger request_dispatch_after_push_queued
after insert on public.push_deliveries
for each statement
execute function public.push_deliveries_request_dispatch();

-- Housekeeping: finished queue rows are kept 30 days, a disabled device 30 days.
create or replace function public.trim_push_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
  v_total integer := 0;
begin
  delete from public.push_deliveries d
  where d.status not in ('pending')
    and d.created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.push_subscriptions s
  where s.disabled_at is not null
    and s.disabled_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_total + v_deleted;
end;
$$;

revoke all on function public.claim_push_deliveries(integer, uuid) from public, anon, authenticated;
revoke all on function public.complete_push_delivery(uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_push_delivery(uuid) from public, anon, authenticated;
revoke all on function public.suppress_pending_push_deliveries(text) from public, anon, authenticated;
revoke all on function public.push_queue_due() from public, anon, authenticated;
revoke all on function public.request_push_dispatch(text) from public, anon, authenticated;
revoke all on function public.push_deliveries_request_dispatch() from public, anon, authenticated;
revoke all on function public.trim_push_history() from public, anon, authenticated;
grant execute on function public.claim_push_deliveries(integer, uuid) to service_role;
grant execute on function public.complete_push_delivery(uuid, text, text) to service_role;
grant execute on function public.release_push_delivery(uuid) to service_role;
grant execute on function public.suppress_pending_push_deliveries(text) to service_role;
grant execute on function public.push_queue_due() to service_role;

-- 4. Scheduler ----------------------------------------------------------------------------------
-- Every minute, next to the email job. The function makes no HTTP call when nothing is due.
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron is not installed: no push schedule created. Pushes are still sent straight after they are queued (pg_net) or when the app asks for it.';
    return;
  end if;

  begin
    execute 'select cron.unschedule(jobname) from cron.job where jobname in (''sktr-dispatch-push'', ''sktr-trim-push-history'')';
  exception
    when others then
      raise notice 'Could not remove earlier push schedules (%).', sqlerrm;
  end;

  execute 'select cron.schedule(''sktr-dispatch-push'', ''* * * * *'', ''select public.request_push_dispatch(''''cron'''')'')';
  execute 'select cron.schedule(''sktr-trim-push-history'', ''41 3 * * *'', ''select public.trim_push_history()'')';
exception
  when others then
    raise notice 'Could not create the push schedule (%). Pushes are still sent straight after they are queued (pg_net) or when the app asks for it.', sqlerrm;
end
$$;

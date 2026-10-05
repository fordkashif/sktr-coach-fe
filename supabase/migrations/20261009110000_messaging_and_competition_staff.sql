-- SKTR Coach: messaging (announcements and coach to athlete messages), and the staff side of
-- competitions
-- Created: 2026-10-09
--
-- WHY
--   Clubs fall back to WhatsApp for "training moved to 5pm" and "how did the knee feel?". This file
--   gives them the two things they need inside the app and nothing more. It is NOT a chat app.
--
-- WHAT THIS FILE ADDS
--   1. announcements + announcement_recipients: one-way broadcasts. A coach posts to a team they
--      coach; a club admin posts to the whole club, to all coaches or to one team. Each recipient
--      has a read state. There are no replies.
--   2. message_threads + messages: a two-person thread between ONE coach and ONE athlete on a team
--      that coach is assigned to. Text only, 1000 characters, no attachments, no groups, no
--      athlete to athlete, no coach to coach.
--   3. Safeguarding, built in:
--        * every thread is readable (never writable) by the club's admins;
--        * a message cannot be edited or deleted by anyone through the API: there is no insert,
--          update or delete grant on messages at all, every write is one of the functions below;
--        * a participant can report the other person's message to the club admins
--          (message_reports); a club admin can hide a message, which moves its text out of the
--          messages row into message_moderation (club admins only) and leaves a stub. Both write
--          an audit event that never contains the message text;
--        * club_profiles.guardian_cc_enabled (default false) records the club's choice for copying
--          guardians in. Nothing reads it to send anything yet.
--   4. Lifecycle, enforced by the helpers of 20261005180000, 20261006120000, 20261006150000 and
--      the guard of 20261006180000:
--        * a coach removed from the thread's team, a deactivated coach, and everyone in a
--          suspended or cancelled club: no access to the thread;
--        * the athlete keeps reading their own threads; a thread whose coach is gone, or whose
--          athlete left the team, is read only;
--        * an athlete with no login (athletes.user_id is null) cannot be messaged and is skipped
--          by announcements.
--   5. Rate limits per sender, kept in one private row (messaging_settings): 30 direct messages an
--      hour, 20 announcements a day. To change one later:
--        update public.messaging_settings set dm_per_hour = 60;
--   6. Delivery through the existing queue (enqueue_notification, 20261007090000). No second sender.
--        announcement_posted        in-app and email to every recipient.
--        direct_message_received    in-app (one unread notification per thread at a time) and at
--                                   most ONE email per thread per recipient per hour. Neither ever
--                                   contains the message text.
--        message_reported           in-app and email to the club admins. No message text.
--      All three are on by default on both channels, which is what
--      notification_default_enabled() already answers for a type it does not list, so that
--      function is deliberately NOT replaced here.
--   7. Realtime: messages and message_threads join the supabase_realtime publication (guarded), so
--      an open thread updates live under the same row policies.
--
-- COMPETITIONS (staff side)
--   Checked against 20261008100000: a coach already sees a competition an athlete on one of their
--   teams added for themselves (competitions_select_scope, scope = 'athlete' and owner in
--   current_coach_athlete_ids()), sees that athlete's entries, and may record results for them
--   (staff_can_view_competition covers scope 'athlete'). So NO rule changes. What was missing was
--   in the app: the team calendar asked for "this team's or club wide" and left the athlete's own
--   meets out. That is fixed in src/lib/data/competition/competition-data.ts. This file only adds
--   an index for the calendar's lookup of entries by competition.
--
-- Idempotent and additive: create ... if not exists, add column if not exists, create or replace,
-- drop policy if exists + create policy, insert ... on conflict do nothing. Nothing is dropped and
-- no existing row is changed.

-- 0. Competitions: one index ------------------------------------------------------------------

create index if not exists competition_entries_competition_idx
on public.competition_entries (competition_id);

-- 1. Settings ---------------------------------------------------------------------------------

create table if not exists public.messaging_settings (
  id boolean primary key default true check (id),
  dm_per_hour int not null default 30 check (dm_per_hour > 0),
  announcements_per_day int not null default 20 check (announcements_per_day > 0),
  max_length int not null default 1000 check (max_length between 1 and 1000),
  dm_email_window interval not null default interval '1 hour',
  created_at timestamptz not null default now()
);

-- RLS on and no policy: only security definer functions and the service role reach it.
alter table public.messaging_settings enable row level security;
revoke all on public.messaging_settings from public, anon, authenticated;

insert into public.messaging_settings (id) values (true) on conflict (id) do nothing;

-- The club's choice for copying a guardian in on messages to an athlete under 18. Recorded only:
-- nothing sends guardian emails in this version.
alter table public.club_profiles
  add column if not exists guardian_cc_enabled boolean not null default false;

comment on column public.club_profiles.guardian_cc_enabled is
  'Reserved: copy the guardian on file in on direct messages to an athlete under 18. Default off. Not read by any sender yet.';

-- 2. Tables -----------------------------------------------------------------------------------

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- 'team': one team (athletes and its other coaches). 'club': every member. 'coaches': every coach.
  audience text not null check (audience in ('team', 'club', 'coaches')),
  team_id uuid references public.teams(id) on delete set null,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('coach', 'club-admin')),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  check (audience = 'team' or team_id is null)
);

create index if not exists announcements_tenant_created_idx on public.announcements (tenant_id, created_at desc);
create index if not exists announcements_team_idx on public.announcements (team_id);
create index if not exists announcements_sender_created_idx on public.announcements (sender_user_id, created_at desc);

-- Who an announcement went to, fixed when it is posted, and whether they have read it.
create table if not exists public.announcement_recipients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (announcement_id, recipient_user_id)
);

create index if not exists announcement_recipients_user_idx
on public.announcement_recipients (recipient_user_id, created_at desc);

-- One thread per coach and athlete. team_id is the team the conversation belongs to: the
-- athlete's team when the thread was last opened or written to by the coach.
create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  team_id uuid references public.teams(id) on delete set null,
  coach_user_id uuid references auth.users(id) on delete set null,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  last_message_at timestamptz,
  coach_last_read_at timestamptz,
  athlete_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (coach_user_id, athlete_id)
);

create index if not exists message_threads_tenant_last_idx on public.message_threads (tenant_id, last_message_at desc);
create index if not exists message_threads_athlete_idx on public.message_threads (athlete_id);
create index if not exists message_threads_team_idx on public.message_threads (team_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('coach', 'athlete')),
  -- Null once a club admin has hidden the message; the text then lives in message_moderation.
  body text check (body is null or char_length(body) between 1 and 1000),
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  check ((body is null) = (hidden_at is not null))
);

create index if not exists messages_thread_created_idx on public.messages (thread_id, created_at);
create index if not exists messages_sender_created_idx on public.messages (sender_user_id, created_at desc);

-- The text of a hidden message, for the club's admins only.
create table if not exists public.message_moderation (
  message_id uuid primary key references public.messages(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  original_body text not null,
  reason text check (reason is null or char_length(reason) <= 300),
  hidden_by_user_id uuid references auth.users(id) on delete set null,
  hidden_at timestamptz not null default now()
);

create index if not exists message_moderation_thread_idx on public.message_moderation (thread_id);

create table if not exists public.message_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  reporter_user_id uuid references auth.users(id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 300),
  -- 'hidden' or 'dismissed' once a club admin has looked at it.
  resolution text check (resolution is null or resolution in ('hidden', 'dismissed')),
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (message_id, reporter_user_id)
);

create index if not exists message_reports_tenant_open_idx
on public.message_reports (tenant_id, created_at desc)
where resolved_at is null;

create index if not exists message_reports_thread_idx on public.message_reports (thread_id);

-- 3. Helpers ----------------------------------------------------------------------------------

-- What a person typed, made safe to store: no control characters, at most one blank line in a
-- row, no leading or trailing space. Never raises.
create or replace function public.clean_message_body(p_body text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        replace(replace(coalesce(p_body, ''), E'\r\n', E'\n'), E'\r', E'\n'),
        '[\x01-\x09\x0B-\x1F\x7F]', '', 'g'
      ),
      E'\n{3,}', E'\n\n', 'g'
    ),
    E' \n\t'
  )
$$;

-- "Coach Rivera" for notifications and lists. A person with no name yet is "Coach".
create or replace function public.message_member_name(p_user_id uuid, p_fallback text default 'Coach')
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select nullif(left(btrim(regexp_replace(coalesce(p.display_name, ''), '\s+', ' ', 'g')), 80), '')
      from public.profiles p
      where p.user_id = p_user_id
    ),
    p_fallback
  )
$$;

-- Can anything be sent in this thread at all? True only while the athlete has a login, is active
-- and is on a team, the thread's coach is an active coach assigned to THAT team, and the club is
-- open. It does not look at who is asking.
create or replace function public.message_thread_is_open(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.message_threads t
    join public.athletes a
      on a.id = t.athlete_id
     and a.tenant_id = t.tenant_id
    join public.profiles ap
      on ap.user_id = a.user_id
     and ap.tenant_id = t.tenant_id
     and ap.role = 'athlete'
     and ap.is_active
    join public.team_coaches tc
      on tc.team_id = a.team_id
     and tc.tenant_id = t.tenant_id
     and tc.user_id = t.coach_user_id
    join public.profiles cp
      on cp.user_id = t.coach_user_id
     and cp.tenant_id = t.tenant_id
     and cp.role in ('coach', 'club-admin')
     and cp.is_active
    where t.id = p_thread_id
      and a.is_active
      and a.user_id is not null
      and a.team_id is not null
      and not public.tenant_access_blocked(t.tenant_id)
  )
$$;

-- Threads the signed-in person takes part in and may still read: an athlete's own threads, and a
-- coach's threads on teams they are still assigned to. Empty for everyone else, for a deactivated
-- member and for anyone in a suspended or cancelled club (the helpers answer null or empty).
create or replace function public.current_message_thread_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(t.id), '{}'::uuid[])
  from public.message_threads t
  where t.tenant_id = public.current_tenant_id()
    and (
      t.athlete_id = public.current_athlete_id()
      or (
        t.coach_user_id = auth.uid()
        and t.team_id is not null
        and t.team_id = any (public.current_coach_team_ids())
      )
    )
$$;

-- Announcements the signed-in person received.
create or replace function public.current_announcement_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(ar.announcement_id), '{}'::uuid[])
  from public.announcement_recipients ar
  where ar.recipient_user_id = auth.uid()
    and ar.tenant_id = public.current_tenant_id()
$$;

-- May the signed-in person see who has read this announcement? Its sender, the club's admins and
-- the coaches of the team it went to.
create or replace function public.can_manage_announcement(p_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.announcements an
    where an.id = p_announcement_id
      and an.tenant_id = public.current_tenant_id()
      and (
        public.is_club_admin()
        or (an.sender_user_id = auth.uid() and public.is_coach_or_admin())
        or (an.audience = 'team' and an.team_id is not null and public.is_team_coach(an.team_id))
      )
  )
$$;

revoke all on function public.clean_message_body(text) from public, anon;
revoke all on function public.message_member_name(uuid, text) from public, anon, authenticated;
revoke all on function public.message_thread_is_open(uuid) from public, anon;
revoke all on function public.current_message_thread_ids() from public, anon;
revoke all on function public.current_announcement_ids() from public, anon;
revoke all on function public.can_manage_announcement(uuid) from public, anon;
grant execute on function public.clean_message_body(text) to authenticated, service_role;
grant execute on function public.message_thread_is_open(uuid) to authenticated, service_role;
grant execute on function public.current_message_thread_ids() to authenticated, service_role;
grant execute on function public.current_announcement_ids() to authenticated, service_role;
grant execute on function public.can_manage_announcement(uuid) to authenticated, service_role;

-- 4. Row level security -------------------------------------------------------------------------
-- Reading goes through these policies (and Realtime applies them too). There is NO write policy
-- and no write grant on any of the six tables: every write is a function in section 5 to 7.

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.message_threads enable row level security;
alter table public.messages enable row level security;
alter table public.message_moderation enable row level security;
alter table public.message_reports enable row level security;

revoke all on public.announcements from public, anon, authenticated;
revoke all on public.announcement_recipients from public, anon, authenticated;
revoke all on public.message_threads from public, anon, authenticated;
revoke all on public.messages from public, anon, authenticated;
revoke all on public.message_moderation from public, anon, authenticated;
revoke all on public.message_reports from public, anon, authenticated;
grant select on public.announcements to authenticated;
grant select on public.announcement_recipients to authenticated;
grant select on public.message_threads to authenticated;
grant select on public.messages to authenticated;
grant select on public.message_moderation to authenticated;
grant select on public.message_reports to authenticated;
grant all on public.announcements to service_role;
grant all on public.announcement_recipients to service_role;
grant all on public.message_threads to service_role;
grant all on public.messages to service_role;
grant all on public.message_moderation to service_role;
grant all on public.message_reports to service_role;

drop policy if exists announcements_select_scope on public.announcements;
create policy announcements_select_scope
on public.announcements
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or (sender_user_id = auth.uid() and (select public.is_coach_or_admin()))
    or (audience = 'team' and team_id is not null and team_id = any ((select public.current_coach_team_ids())::uuid[]))
    or id = any ((select public.current_announcement_ids())::uuid[])
  )
);

-- A person reads their own read state; club admins read everyone's. A coach reads the read
-- states of an announcement they manage through get_announcement_recipients().
drop policy if exists announcement_recipients_select_scope on public.announcement_recipients;
create policy announcement_recipients_select_scope
on public.announcement_recipients
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (recipient_user_id = auth.uid() or (select public.is_club_admin()))
);

drop policy if exists message_threads_select_scope on public.message_threads;
create policy message_threads_select_scope
on public.message_threads
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or id = any ((select public.current_message_thread_ids())::uuid[])
  )
);

drop policy if exists messages_select_scope on public.messages;
create policy messages_select_scope
on public.messages
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or thread_id = any ((select public.current_message_thread_ids())::uuid[])
  )
);

drop policy if exists message_moderation_select_admin on public.message_moderation;
create policy message_moderation_select_admin
on public.message_moderation
for select
to authenticated
using (tenant_id = public.current_tenant_id() and (select public.is_club_admin()));

-- The person who reported sees their own report (so the screen can say "Reported"); club admins
-- see all of them.
drop policy if exists message_reports_select_scope on public.message_reports;
create policy message_reports_select_scope
on public.message_reports
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (reporter_user_id = auth.uid() or (select public.is_club_admin()))
);

-- 5. Direct messages ----------------------------------------------------------------------------

-- Finds or creates the thread between a coach and an athlete and returns its id. RAISES.
--   A coach (or a club admin who is assigned to the team as a coach) passes p_athlete_id.
--   An athlete passes p_coach_user_id: one of the coaches of their own team.
-- Refused: an athlete on a team the caller does not coach, another team's coach, an athlete with
-- no login, anyone outside the club, a deactivated member, a suspended or cancelled club.
create or replace function public.open_message_thread(
  p_athlete_id uuid default null,
  p_coach_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_athlete public.athletes%rowtype;
  v_coach_user_id uuid;
  v_thread_id uuid;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile from public.profiles p where p.user_id = auth.uid() limit 1;
  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role in ('coach', 'club-admin') then
    if p_athlete_id is null then
      raise exception 'Choose an athlete to message.' using errcode = '22023';
    end if;
    select * into v_athlete
    from public.athletes a
    where a.id = p_athlete_id and a.tenant_id = v_profile.tenant_id;
    if not found or not public.is_coach_of_athlete(p_athlete_id) then
      raise exception 'You can only message athletes on a team you coach.'
        using errcode = '42501', hint = 'not_your_athlete';
    end if;
    v_coach_user_id := auth.uid();
  elsif v_profile.role = 'athlete' then
    if p_coach_user_id is null then
      raise exception 'Choose a coach to message.' using errcode = '22023';
    end if;
    select * into v_athlete
    from public.athletes a
    where a.id = public.current_athlete_id();
    if not found then
      raise exception 'Athlete record not found';
    end if;
    if v_athlete.team_id is null or not exists (
      select 1
      from public.team_coaches tc
      join public.profiles cp
        on cp.user_id = tc.user_id
       and cp.tenant_id = tc.tenant_id
       and cp.role in ('coach', 'club-admin')
       and cp.is_active
      where tc.team_id = v_athlete.team_id
        and tc.tenant_id = v_athlete.tenant_id
        and tc.user_id = p_coach_user_id
    ) then
      raise exception 'You can only message the coaches of your own team.'
        using errcode = '42501', hint = 'not_your_coach';
    end if;
    v_coach_user_id := p_coach_user_id;
  else
    raise exception 'Messages are between a coach and an athlete.' using errcode = '42501';
  end if;

  if v_athlete.user_id is null or not v_athlete.is_active then
    raise exception 'This athlete has no login yet, so they cannot be messaged.'
      using errcode = '42501', hint = 'no_login';
  end if;

  insert into public.message_threads (tenant_id, team_id, coach_user_id, athlete_id, created_by_user_id)
  values (v_athlete.tenant_id, v_athlete.team_id, v_coach_user_id, v_athlete.id, auth.uid())
  on conflict (coach_user_id, athlete_id)
  -- The athlete moved to another team this coach also coaches: the conversation follows.
  do update set team_id = excluded.team_id
  returning id into v_thread_id;

  return v_thread_id;
end;
$$;

-- Sends one message in a thread and returns its id. RAISES.
--   * Only the thread's coach and the thread's athlete may send. A club admin reads; they never
--     write into a conversation.
--   * The thread must be open (message_thread_is_open).
--   * Text only, 1 to messaging_settings.max_length characters after cleaning.
--   * At most messaging_settings.dm_per_hour messages per sender per hour.
-- The other person gets an in-app notification unless one for this thread is still unread, and
-- at most one email per thread per hour. Neither contains the message text.
create or replace function public.send_direct_message(p_thread_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread public.message_threads%rowtype;
  v_settings public.messaging_settings%rowtype;
  v_athlete public.athletes%rowtype;
  v_body text := public.clean_message_body(p_body);
  v_role text;
  v_recent integer;
  v_message_id uuid;
  v_recipient uuid;
  v_sender_name text;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_thread
  from public.message_threads t
  where t.id = p_thread_id
    and t.tenant_id = public.current_tenant_id()
  for update;
  if not found then
    raise exception 'You are not part of this conversation.' using errcode = '42501', hint = 'not_participant';
  end if;

  if v_thread.coach_user_id = auth.uid() then
    v_role := 'coach';
  elsif v_thread.athlete_id = public.current_athlete_id() then
    v_role := 'athlete';
  else
    raise exception 'You are not part of this conversation.' using errcode = '42501', hint = 'not_participant';
  end if;

  if not public.message_thread_is_open(v_thread.id) then
    raise exception 'This conversation is read only. Nothing more can be sent in it.'
      using errcode = '42501', hint = 'thread_read_only';
  end if;

  select * into v_settings from public.messaging_settings s where s.id;
  if v_body = '' then
    raise exception 'Write a message first.' using errcode = '23514', hint = 'message_empty';
  end if;
  if char_length(v_body) > coalesce(v_settings.max_length, 1000) then
    raise exception 'Keep the message to % characters.', coalesce(v_settings.max_length, 1000)
      using errcode = '23514', hint = 'message_too_long';
  end if;

  -- One sender at a time through the count, so two tabs cannot both slip under the limit.
  perform pg_advisory_xact_lock(hashtextextended('message-rate:' || auth.uid()::text, 0));
  select count(*) into v_recent
  from public.messages m
  where m.sender_user_id = auth.uid()
    and m.created_at > now() - interval '1 hour';
  if v_recent >= coalesce(v_settings.dm_per_hour, 30) then
    raise exception 'You have sent a lot of messages in the last hour. Wait a little, then try again.'
      using errcode = '54000', hint = 'rate_limited';
  end if;

  select * into v_athlete from public.athletes a where a.id = v_thread.athlete_id;

  insert into public.messages (tenant_id, thread_id, sender_user_id, sender_role, body)
  values (v_thread.tenant_id, v_thread.id, auth.uid(), v_role, v_body)
  returning id into v_message_id;

  update public.message_threads t
  set last_message_at = now(),
      team_id = v_athlete.team_id,
      coach_last_read_at = case when v_role = 'coach' then now() else t.coach_last_read_at end,
      athlete_last_read_at = case when v_role = 'athlete' then now() else t.athlete_last_read_at end
  where t.id = v_thread.id;

  -- Replying means the sender has read the thread: its notification stops counting in the bell.
  update public.user_notifications un
  set state = 'read', read_at = now()
  from public.notification_events e
  where un.event_id = e.id
    and un.recipient_user_id = auth.uid()
    and un.state = 'unread'
    and e.event_type = 'direct_message_received'
    and e.metadata ->> 'thread_id' = v_thread.id::text;

  if v_role = 'coach' then
    v_recipient := v_athlete.user_id;
    v_sender_name := public.message_member_name(auth.uid(), 'your coach');
  else
    v_recipient := v_thread.coach_user_id;
    v_sender_name := coalesce(public.notification_athlete_name(v_athlete.id), 'An athlete');
  end if;

  if not exists (
    select 1
    from public.notification_events e
    join public.user_notifications un
      on un.event_id = e.id
     and un.recipient_user_id = e.recipient_user_id
    where e.recipient_user_id = v_recipient
      and e.channel = 'in-app'
      and e.event_type = 'direct_message_received'
      and e.metadata ->> 'thread_id' = v_thread.id::text
      and un.state = 'unread'
  ) then
    perform public.enqueue_notification(
      v_thread.tenant_id,
      v_recipient,
      'direct_message_received',
      format('New message from %s', v_sender_name),
      'Open the conversation to read it.',
      jsonb_build_object('thread_id', v_thread.id::text),
      array['in-app']
    );
  end if;

  perform public.enqueue_notification(
    v_thread.tenant_id,
    v_recipient,
    'direct_message_received',
    format('You have a new message from %s', v_sender_name),
    'Open SKTR Coach to read it and reply. For your privacy the message is not included in this email.',
    jsonb_build_object('thread_id', v_thread.id::text),
    array['email'],
    'dm_email:' || v_thread.id::text,
    coalesce(v_settings.dm_email_window, interval '1 hour')
  );

  return v_message_id;
end;
$$;

-- "I have read this thread." Moves the caller's read marker and marks the thread's notification
-- read, so the bell and the Messages badge agree. Does nothing for anyone who is not one of the
-- two people in the thread (a club admin reading in oversight leaves no trace on read state).
create or replace function public.mark_message_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread public.message_threads%rowtype;
begin
  if auth.uid() is null or not public.caller_is_active_member() then
    return;
  end if;

  select * into v_thread
  from public.message_threads t
  where t.id = p_thread_id
    and t.id = any (public.current_message_thread_ids());
  if not found then
    return;
  end if;

  -- Only when there is something newer than the marker: an open thread calls this on every refresh,
  -- and a write that changes nothing would still wake everyone listening to the thread.
  if v_thread.coach_user_id = auth.uid() then
    update public.message_threads t
    set coach_last_read_at = now()
    where t.id = v_thread.id
      and (t.coach_last_read_at is null or t.coach_last_read_at < t.last_message_at);
  else
    update public.message_threads t
    set athlete_last_read_at = now()
    where t.id = v_thread.id
      and (t.athlete_last_read_at is null or t.athlete_last_read_at < t.last_message_at);
  end if;

  update public.user_notifications un
  set state = 'read', read_at = now()
  from public.notification_events e
  where un.event_id = e.id
    and un.recipient_user_id = auth.uid()
    and un.state = 'unread'
    and e.event_type = 'direct_message_received'
    and e.metadata ->> 'thread_id' = v_thread.id::text;
end;
$$;

-- The caller's own conversations that have at least one message, newest first. For a coach,
-- p_team_id keeps one team. NO ROWS for anyone whose access is paused.
create or replace function public.get_message_threads(p_team_id uuid default null)
returns table (
  thread_id uuid,
  team_id uuid,
  team_name text,
  athlete_id uuid,
  athlete_name text,
  athlete_user_id uuid,
  coach_user_id uuid,
  coach_name text,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_hidden boolean,
  last_message_from_me boolean,
  unread_count integer,
  can_send boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.team_id,
    tm.name,
    t.athlete_id,
    public.notification_athlete_name(t.athlete_id),
    a.user_id,
    t.coach_user_id,
    public.message_member_name(t.coach_user_id, 'Coach'),
    t.last_message_at,
    left(lm.body, 140),
    lm.hidden_at is not null,
    lm.sender_user_id = auth.uid(),
    (
      select count(*)::integer
      from public.messages m
      where m.thread_id = t.id
        and m.sender_user_id is distinct from auth.uid()
        and m.hidden_at is null
        and m.created_at > coalesce(
          case when t.coach_user_id = auth.uid() then t.coach_last_read_at else t.athlete_last_read_at end,
          '-infinity'::timestamptz
        )
    ),
    public.message_thread_is_open(t.id)
  from public.message_threads t
  join public.athletes a on a.id = t.athlete_id
  left join public.teams tm on tm.id = t.team_id
  left join lateral (
    select m.body, m.hidden_at, m.sender_user_id
    from public.messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where public.caller_is_active_member()
    and t.id = any (public.current_message_thread_ids())
    and t.last_message_at is not null
    and (p_team_id is null or t.team_id = p_team_id)
  order by t.last_message_at desc
$$;

-- Everything the thread screen needs besides the messages themselves. One row, or none when the
-- caller may not read the thread.
--   viewer_side             'coach', 'athlete' or 'oversight' (a club admin who is not in it).
--   read_only_reason        why nothing can be sent: 'athlete_left_team', 'coach_not_on_team',
--                           'no_login', 'inactive'. Null while the thread is open.
--   other_last_read_at      when the other person last read the thread (for "Seen").
--   guardian_contact_on_file  the athlete is under 18 by date of birth and a guardian email is on
--                           file. Only answered for the coach and for club admins; never for the athlete.
create or replace function public.get_message_thread(p_thread_id uuid)
returns table (
  thread_id uuid,
  team_id uuid,
  team_name text,
  athlete_id uuid,
  athlete_name text,
  athlete_user_id uuid,
  coach_user_id uuid,
  coach_name text,
  viewer_side text,
  can_send boolean,
  read_only_reason text,
  other_last_read_at timestamptz,
  guardian_contact_on_file boolean,
  guardian_cc_enabled boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with seen as (
    select
      t.*,
      case
        when t.coach_user_id = auth.uid() and t.id = any (public.current_message_thread_ids()) then 'coach'
        when t.athlete_id = public.current_athlete_id() then 'athlete'
        when public.is_club_admin() then 'oversight'
        else null
      end as side,
      public.message_thread_is_open(t.id) as is_open
    from public.message_threads t
    where t.id = p_thread_id
      and t.tenant_id = public.current_tenant_id()
  )
  select
    s.id,
    s.team_id,
    tm.name,
    s.athlete_id,
    public.notification_athlete_name(s.athlete_id),
    a.user_id,
    s.coach_user_id,
    public.message_member_name(s.coach_user_id, 'Coach'),
    s.side,
    s.is_open and s.side in ('coach', 'athlete'),
    case
      when s.is_open then null
      when a.user_id is null then 'no_login'
      when not a.is_active or not exists (
        select 1 from public.profiles ap where ap.user_id = a.user_id and ap.is_active
      ) then 'inactive'
      when a.team_id is null or a.team_id is distinct from s.team_id then 'athlete_left_team'
      else 'coach_not_on_team'
    end,
    case when s.side = 'coach' then s.athlete_last_read_at when s.side = 'athlete' then s.coach_last_read_at else null end,
    case
      when s.side in ('coach', 'oversight') then
        coalesce(a.date_of_birth > (current_date - interval '18 years')::date, false)
        and exists (
          select 1
          from public.athlete_private_details d
          where d.athlete_id = a.id
            and nullif(btrim(coalesce(d.guardian_email, '')), '') is not null
        )
      else null
    end,
    case
      when s.side in ('coach', 'oversight') then
        coalesce((select cp.guardian_cc_enabled from public.club_profiles cp where cp.tenant_id = s.tenant_id), false)
      else null
    end
  from seen s
  join public.athletes a on a.id = s.athlete_id
  left join public.teams tm on tm.id = s.team_id
  where s.side is not null
    and public.caller_is_active_member()
$$;

-- 6. Reporting and moderation -----------------------------------------------------------------------

-- One of the two people in a thread reports the OTHER person's message to the club's admins.
-- Reporting twice changes nothing. RAISES for anyone else.
create or replace function public.report_message(p_message_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.messages%rowtype;
  v_thread public.message_threads%rowtype;
  v_role text;
  v_report_id uuid;
  v_reason text := nullif(left(public.clean_message_body(p_reason), 300), '');
  v_admin uuid;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select m.* into v_message
  from public.messages m
  where m.id = p_message_id
    and m.thread_id = any (public.current_message_thread_ids());
  if not found then
    raise exception 'You can only report a message in one of your own conversations.' using errcode = '42501';
  end if;
  if v_message.sender_user_id = auth.uid() then
    raise exception 'You cannot report your own message.' using errcode = '23514';
  end if;

  select * into v_thread from public.message_threads t where t.id = v_message.thread_id;
  v_role := case when v_thread.coach_user_id = auth.uid() then 'coach' else 'athlete' end;

  insert into public.message_reports (tenant_id, thread_id, message_id, reporter_user_id, reason)
  values (v_message.tenant_id, v_message.thread_id, v_message.id, auth.uid(), v_reason)
  on conflict (message_id, reporter_user_id) do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select r.id into v_report_id
    from public.message_reports r
    where r.message_id = v_message.id and r.reporter_user_id = auth.uid();
    return v_report_id;
  end if;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    v_message.tenant_id,
    auth.uid(),
    v_role,
    'message_reported',
    'message ' || v_message.id::text,
    format(
      'Reported a message in the conversation between %s and %s.',
      public.message_member_name(v_thread.coach_user_id, 'a coach'),
      coalesce(public.notification_athlete_name(v_thread.athlete_id), 'an athlete')
    )
  );

  for v_admin in select public.notification_club_admin_user_ids(v_message.tenant_id)
  loop
    perform public.enqueue_notification(
      v_message.tenant_id,
      v_admin,
      'message_reported',
      'A message was reported',
      format(
        'In the conversation between %s and %s. Open message oversight to review it.',
        public.message_member_name(v_thread.coach_user_id, 'a coach'),
        coalesce(public.notification_athlete_name(v_thread.athlete_id), 'an athlete')
      ),
      jsonb_build_object('thread_id', v_thread.id::text, 'message_id', v_message.id::text),
      array['in-app', 'email'],
      'message_report:' || v_message.id::text,
      interval '10 minutes'
    );
  end loop;

  return v_report_id;
end;
$$;

-- A club admin hides a message. Its text moves to message_moderation (club admins only), the
-- messages row keeps who sent it and when and reads "Message hidden by a club admin" to both
-- people. Open reports about it are closed. Writes an audit event without the text. RAISES.
create or replace function public.hide_message(p_message_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.messages%rowtype;
  v_thread public.message_threads%rowtype;
  v_reason text := nullif(left(public.clean_message_body(p_reason), 300), '');
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.is_club_admin() then
    raise exception 'Only a club admin can hide a message.' using errcode = '42501';
  end if;

  select m.* into v_message
  from public.messages m
  where m.id = p_message_id
    and m.tenant_id = public.current_tenant_id()
  for update;
  if not found then
    raise exception 'This message does not exist.' using errcode = '42501';
  end if;

  select * into v_thread from public.message_threads t where t.id = v_message.thread_id;

  if v_message.hidden_at is null then
    insert into public.message_moderation (message_id, tenant_id, thread_id, original_body, reason, hidden_by_user_id)
    values (v_message.id, v_message.tenant_id, v_message.thread_id, v_message.body, v_reason, auth.uid())
    on conflict (message_id) do nothing;

    update public.messages m
    set body = null,
        hidden_at = now()
    where m.id = v_message.id;

    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (
      v_message.tenant_id,
      auth.uid(),
      'club-admin',
      'message_hidden',
      'message ' || v_message.id::text,
      format(
        'Hid a message in the conversation between %s and %s.%s',
        public.message_member_name(v_thread.coach_user_id, 'a coach'),
        coalesce(public.notification_athlete_name(v_thread.athlete_id), 'an athlete'),
        case when v_reason is null then '' else ' Reason: ' || v_reason end
      )
    );
  end if;

  update public.message_reports r
  set resolution = 'hidden',
      resolved_at = now(),
      resolved_by_user_id = auth.uid()
  where r.message_id = v_message.id
    and r.resolved_at is null;
end;
$$;

-- A club admin looked at a reported message and leaves it in place. Closes its open reports and
-- writes an audit event. RAISES.
create or replace function public.dismiss_message_reports(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.messages%rowtype;
  v_closed integer;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.is_club_admin() then
    raise exception 'Only a club admin can review a report.' using errcode = '42501';
  end if;

  select m.* into v_message
  from public.messages m
  where m.id = p_message_id
    and m.tenant_id = public.current_tenant_id();
  if not found then
    raise exception 'This message does not exist.' using errcode = '42501';
  end if;

  update public.message_reports r
  set resolution = 'dismissed',
      resolved_at = now(),
      resolved_by_user_id = auth.uid()
  where r.message_id = v_message.id
    and r.resolved_at is null;
  get diagnostics v_closed = row_count;

  if v_closed > 0 then
    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (
      v_message.tenant_id,
      auth.uid(),
      'club-admin',
      'message_report_dismissed',
      'message ' || v_message.id::text,
      'Reviewed a reported message and left it in place.'
    );
  end if;
end;
$$;

-- Message oversight for club admins: every conversation in the club that has messages, the ones
-- with an open report first. NO ROWS for anyone else.
create or replace function public.get_message_oversight_threads()
returns table (
  thread_id uuid,
  team_id uuid,
  team_name text,
  athlete_id uuid,
  athlete_name text,
  athlete_user_id uuid,
  coach_user_id uuid,
  coach_name text,
  last_message_at timestamptz,
  message_count integer,
  open_report_count integer,
  hidden_count integer,
  is_open boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.team_id,
    tm.name,
    t.athlete_id,
    public.notification_athlete_name(t.athlete_id),
    a.user_id,
    t.coach_user_id,
    public.message_member_name(t.coach_user_id, 'Coach'),
    t.last_message_at,
    (select count(*)::integer from public.messages m where m.thread_id = t.id),
    (select count(distinct r.message_id)::integer from public.message_reports r where r.thread_id = t.id and r.resolved_at is null),
    (select count(*)::integer from public.messages m where m.thread_id = t.id and m.hidden_at is not null),
    public.message_thread_is_open(t.id)
  from public.message_threads t
  join public.athletes a on a.id = t.athlete_id
  left join public.teams tm on tm.id = t.team_id
  where public.caller_is_active_member()
    and public.is_club_admin()
    and t.tenant_id = public.current_tenant_id()
    and t.last_message_at is not null
  order by
    (select count(*) from public.message_reports r where r.thread_id = t.id and r.resolved_at is null) > 0 desc,
    t.last_message_at desc
$$;

-- 7. Announcements --------------------------------------------------------------------------------

-- Posts an announcement and returns its id. RAISES.
--   coach        p_audience 'team' and a team they are assigned to.
--   club admin   'club' (every member), 'coaches' (every coach) or 'team' (any team of the club).
-- Recipients are fixed now: active members with a login, never the sender. Each gets an in-app
-- notification and (unless they switched it off) an email, both carrying the announcement.
create or replace function public.post_announcement(
  p_audience text,
  p_body text,
  p_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_settings public.messaging_settings%rowtype;
  v_body text := public.clean_message_body(p_body);
  v_team_name text;
  v_recent integer;
  v_announcement_id uuid;
  v_recipient uuid;
  v_sender_name text;
  v_subject text;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile from public.profiles p where p.user_id = auth.uid() limit 1;
  if not found or v_profile.role not in ('coach', 'club-admin') then
    raise exception 'Only a coach or a club admin can post an announcement.' using errcode = '42501';
  end if;

  if p_audience not in ('team', 'club', 'coaches') then
    raise exception 'Choose who the announcement is for.' using errcode = '22023';
  end if;

  if p_audience = 'team' then
    if p_team_id is null or not public.can_manage_team(p_team_id) then
      raise exception 'You can only post to a team you coach.' using errcode = '42501', hint = 'not_your_team';
    end if;
    select tm.name into v_team_name from public.teams tm where tm.id = p_team_id;
  elsif v_profile.role <> 'club-admin' then
    raise exception 'Only a club admin can post to the whole club or to all coaches.'
      using errcode = '42501', hint = 'not_your_team';
  end if;

  select * into v_settings from public.messaging_settings s where s.id;
  if v_body = '' then
    raise exception 'Write the announcement first.' using errcode = '23514', hint = 'message_empty';
  end if;
  if char_length(v_body) > coalesce(v_settings.max_length, 1000) then
    raise exception 'Keep the announcement to % characters.', coalesce(v_settings.max_length, 1000)
      using errcode = '23514', hint = 'message_too_long';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('announcement-rate:' || auth.uid()::text, 0));
  select count(*) into v_recent
  from public.announcements an
  where an.sender_user_id = auth.uid()
    and an.created_at > now() - interval '24 hours';
  if v_recent >= coalesce(v_settings.announcements_per_day, 20) then
    raise exception 'You have posted a lot of announcements today. Try again tomorrow.'
      using errcode = '54000', hint = 'rate_limited';
  end if;

  insert into public.announcements (tenant_id, audience, team_id, sender_user_id, sender_role, body)
  values (
    v_profile.tenant_id,
    p_audience,
    case when p_audience = 'team' then p_team_id else null end,
    auth.uid(),
    v_profile.role,
    v_body
  )
  returning id into v_announcement_id;

  insert into public.announcement_recipients (announcement_id, recipient_user_id, tenant_id)
  select v_announcement_id, r.user_id, v_profile.tenant_id
  from (
    -- Athletes of the team (or of the whole club) who have a login.
    select a.user_id
    from public.athletes a
    join public.profiles p
      on p.user_id = a.user_id
     and p.tenant_id = a.tenant_id
     and p.is_active
    where p_audience in ('team', 'club')
      and a.tenant_id = v_profile.tenant_id
      and a.is_active
      and a.user_id is not null
      and (p_audience = 'club' or a.team_id = p_team_id)
    union
    -- The other coaches of the team.
    select tc.user_id
    from public.team_coaches tc
    join public.profiles p
      on p.user_id = tc.user_id
     and p.tenant_id = tc.tenant_id
     and p.is_active
     and p.role in ('coach', 'club-admin')
    where p_audience = 'team'
      and tc.team_id = p_team_id
      and tc.tenant_id = v_profile.tenant_id
    union
    -- Every coach, and for the whole club every club admin as well.
    select p.user_id
    from public.profiles p
    where p_audience in ('club', 'coaches')
      and p.tenant_id = v_profile.tenant_id
      and p.is_active
      and (p.role = 'coach' or (p_audience = 'club' and p.role = 'club-admin'))
  ) r
  where r.user_id is not null
    and r.user_id <> auth.uid()
  on conflict do nothing;

  v_sender_name := public.message_member_name(auth.uid(), case when v_profile.role = 'coach' then 'Your coach' else 'Your club' end);
  v_subject := case
    when p_audience = 'team' then format('%s: announcement from %s', coalesce(v_team_name, 'Your team'), v_sender_name)
    when p_audience = 'coaches' then format('For coaches: announcement from %s', v_sender_name)
    else format('Club announcement from %s', v_sender_name)
  end;

  for v_recipient in
    select ar.recipient_user_id from public.announcement_recipients ar where ar.announcement_id = v_announcement_id
  loop
    perform public.enqueue_notification(
      v_profile.tenant_id,
      v_recipient,
      'announcement_posted',
      v_subject,
      v_body,
      jsonb_build_object('announcement_id', v_announcement_id::text, 'team_id', p_team_id::text),
      array['in-app', 'email']
    );
  end loop;

  return v_announcement_id;
end;
$$;

-- "I have read this announcement." Also marks its notification read. Does nothing for anyone who
-- did not receive it.
create or replace function public.mark_announcement_read(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.caller_is_active_member() then
    return;
  end if;

  update public.announcement_recipients ar
  set read_at = now()
  where ar.announcement_id = p_announcement_id
    and ar.recipient_user_id = auth.uid()
    and ar.tenant_id = public.current_tenant_id()
    and ar.read_at is null;

  update public.user_notifications un
  set state = 'read', read_at = now()
  from public.notification_events e
  where un.event_id = e.id
    and un.recipient_user_id = auth.uid()
    and un.state = 'unread'
    and e.event_type = 'announcement_posted'
    and e.metadata ->> 'announcement_id' = p_announcement_id::text;
end;
$$;

-- The announcements the caller received, sent or (club admin, team coach) may manage, newest
-- first. read_at is the caller's own read state (null for one they sent). recipient_count and
-- read_count are only filled for someone who may see who read it. p_team_id keeps one team's
-- announcements plus the club wide ones. NO ROWS for anyone whose access is paused.
create or replace function public.get_announcements(p_team_id uuid default null)
returns table (
  announcement_id uuid,
  audience text,
  team_id uuid,
  team_name text,
  sender_user_id uuid,
  sender_name text,
  sender_role text,
  body text,
  created_at timestamptz,
  is_mine boolean,
  is_recipient boolean,
  read_at timestamptz,
  can_manage boolean,
  recipient_count integer,
  read_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    select
      an.*,
      mine.read_at as my_read_at,
      mine.recipient_user_id is not null as is_recipient,
      (
        public.is_club_admin()
        or (an.sender_user_id = auth.uid() and public.is_coach_or_admin())
        or (an.audience = 'team' and an.team_id is not null and an.team_id = any (public.current_coach_team_ids()))
      ) as manage
    from public.announcements an
    left join public.announcement_recipients mine
      on mine.announcement_id = an.id
     and mine.recipient_user_id = auth.uid()
    where an.tenant_id = public.current_tenant_id()
  )
  select
    v.id,
    v.audience,
    v.team_id,
    tm.name,
    v.sender_user_id,
    public.message_member_name(v.sender_user_id, case when v.sender_role = 'coach' then 'Coach' else 'Club admin' end),
    v.sender_role,
    v.body,
    v.created_at,
    v.sender_user_id = auth.uid(),
    v.is_recipient,
    v.my_read_at,
    v.manage,
    case when v.manage then (select count(*)::integer from public.announcement_recipients ar where ar.announcement_id = v.id) else null end,
    case when v.manage then (select count(*)::integer from public.announcement_recipients ar where ar.announcement_id = v.id and ar.read_at is not null) else null end
  from visible v
  left join public.teams tm on tm.id = v.team_id
  where public.caller_is_active_member()
    and (v.is_recipient or v.manage)
    and (p_team_id is null or v.team_id = p_team_id or v.audience <> 'team')
  order by v.created_at desc
  limit 200
$$;

-- Who an announcement went to and who has read it. Only for someone who may manage it; NO ROWS
-- otherwise.
create or replace function public.get_announcement_recipients(p_announcement_id uuid)
returns table (
  recipient_user_id uuid,
  recipient_name text,
  recipient_role text,
  athlete_id uuid,
  read_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ar.recipient_user_id,
    case
      when a.id is not null then public.notification_athlete_name(a.id)
      else public.message_member_name(ar.recipient_user_id, 'Member')
    end,
    p.role,
    a.id,
    ar.read_at
  from public.announcement_recipients ar
  left join public.profiles p
    on p.user_id = ar.recipient_user_id
   and p.tenant_id = ar.tenant_id
  left join public.athletes a
    on a.user_id = ar.recipient_user_id
   and a.tenant_id = ar.tenant_id
   and p.role = 'athlete'
  where public.caller_is_active_member()
    and public.can_manage_announcement(p_announcement_id)
    and ar.announcement_id = p_announcement_id
  order by ar.read_at is not null, 2
$$;

-- 8. Unread counts for the Messages button ----------------------------------------------------------

-- direct_unread: messages from the other person the caller has not read, in threads they can still
-- read. announcements_unread: announcements received and not read. open_reports: reported messages
-- waiting for a club admin (0 for everyone else). One row, all zero for a paused caller.
create or replace function public.get_message_unread_counts()
returns table (
  direct_unread integer,
  announcements_unread integer,
  open_reports integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select count(*)::integer
      from public.messages m
      join public.message_threads t on t.id = m.thread_id
      where public.caller_is_active_member()
        and t.id = any (public.current_message_thread_ids())
        and m.sender_user_id is distinct from auth.uid()
        and m.hidden_at is null
        and m.created_at > coalesce(
          case when t.coach_user_id = auth.uid() then t.coach_last_read_at else t.athlete_last_read_at end,
          '-infinity'::timestamptz
        )
    ), 0),
    coalesce((
      select count(*)::integer
      from public.announcement_recipients ar
      where ar.recipient_user_id = auth.uid()
        and ar.tenant_id = public.current_tenant_id()
        and ar.read_at is null
    ), 0),
    coalesce((
      select count(distinct r.message_id)::integer
      from public.message_reports r
      where public.is_club_admin()
        and r.tenant_id = public.current_tenant_id()
        and r.resolved_at is null
    ), 0)
$$;

-- 9. Grants -----------------------------------------------------------------------------------------

revoke all on function public.open_message_thread(uuid, uuid) from public, anon;
revoke all on function public.send_direct_message(uuid, text) from public, anon;
revoke all on function public.mark_message_thread_read(uuid) from public, anon;
revoke all on function public.get_message_threads(uuid) from public, anon;
revoke all on function public.get_message_thread(uuid) from public, anon;
revoke all on function public.report_message(uuid, text) from public, anon;
revoke all on function public.hide_message(uuid, text) from public, anon;
revoke all on function public.dismiss_message_reports(uuid) from public, anon;
revoke all on function public.get_message_oversight_threads() from public, anon;
revoke all on function public.post_announcement(text, text, uuid) from public, anon;
revoke all on function public.mark_announcement_read(uuid) from public, anon;
revoke all on function public.get_announcements(uuid) from public, anon;
revoke all on function public.get_announcement_recipients(uuid) from public, anon;
revoke all on function public.get_message_unread_counts() from public, anon;

grant execute on function public.open_message_thread(uuid, uuid) to authenticated, service_role;
grant execute on function public.send_direct_message(uuid, text) to authenticated, service_role;
grant execute on function public.mark_message_thread_read(uuid) to authenticated, service_role;
grant execute on function public.get_message_threads(uuid) to authenticated, service_role;
grant execute on function public.get_message_thread(uuid) to authenticated, service_role;
grant execute on function public.report_message(uuid, text) to authenticated, service_role;
grant execute on function public.hide_message(uuid, text) to authenticated, service_role;
grant execute on function public.dismiss_message_reports(uuid) to authenticated, service_role;
grant execute on function public.get_message_oversight_threads() to authenticated, service_role;
grant execute on function public.post_announcement(text, text, uuid) to authenticated, service_role;
grant execute on function public.mark_announcement_read(uuid) to authenticated, service_role;
grant execute on function public.get_announcements(uuid) to authenticated, service_role;
grant execute on function public.get_announcement_recipients(uuid) to authenticated, service_role;
grant execute on function public.get_message_unread_counts() to authenticated, service_role;

-- 10. Realtime ----------------------------------------------------------------------------------------
-- An open thread hears about a new message, a hidden message and the other person reading it.
-- Realtime applies the row policies above, so nobody receives a row they could not select.
-- Guarded like 20261007090000: without the publication the app refetches on focus and on a timer.
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_table in array array['messages', 'message_threads']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
exception
  when others then
    raise notice 'Messaging tables were not added to the realtime publication (%).', sqlerrm;
end
$$;

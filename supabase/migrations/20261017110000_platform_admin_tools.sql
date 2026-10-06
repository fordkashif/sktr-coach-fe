-- Platform admin tools: the product owner's own screens.
--
-- WHAT THIS ADDS
--   1. Club overview for support (read only).
--        get_platform_club_overview(tenant)   one jsonb of counts and club facts. Names and emails
--                                             of the owner and the club admins only. No athlete
--                                             health data, no message text, no notes, no results
--                                             per athlete. Every call writes a platform audit
--                                             event (who, which club, when).
--   2. Managing platform admins.
--        list_platform_admins()
--        add_platform_admin(email, name)      the same access the first platform admin has: a row
--                                             in platform_admin_contacts, matched by the email of
--                                             the account that signs in. Refused for an email that
--                                             belongs to a club member.
--        set_platform_admin_active(id, bool)  not yourself, never the last active one.
--      Every change is written to platform_audit_events.
--   3. Usage.
--        get_platform_usage(days)             7, 28 or 90 days. Counts per club and sessions
--                                             logged per week. No per person rows except the club
--                                             owner's name and email.
--   4. A notice to all clubs.
--        platform_notices, platform_notice_dismissals (not tenant tables: a notice is for every
--        club; a dismissal belongs to one login and goes with it).
--        send_platform_notice(...)            in-app notification for the audience through
--                                             enqueue_notification, email to club admins only
--                                             when asked.
--        list_platform_notices(), withdraw_platform_notice(id)
--        get_my_platform_notices()            the banner: what the caller should see now.
--        dismiss_platform_notice(id)
--      Audience: everyone / staff (coaches and club admins) / club_admins. An athlete or a
--      guardian gets a notice only when the audience is everyone.
--   5. System status.
--        get_platform_system_status()         email, reminders, push, storage clean-up, the
--                                             latest migration when readable, paused and closing
--                                             clubs.
--
-- ACCESS
--   Every function is security definer with search_path set, and refuses with 42501 unless
--   is_platform_admin(), except get_my_platform_notices() and dismiss_platform_notice(), which
--   are for club members and answer only an active member of a club that is not paused
--   (current_app_role()). Both new tables have row level security on and no policy for a club
--   member: they are read and written through the functions only.
--
-- DELETION
--   platform_notice_dismissals.user_id cascades from auth.users. No column here references
--   auth.users with "set null": who added an admin or sent a notice is kept as plain text.
--
-- Idempotent: create table if not exists, add column if not exists, create or replace function,
-- drop policy if exists before create policy. Applying it twice changes nothing.

-- 1. Platform admins: who added one, and when one was switched off -------------------------------

alter table public.platform_admin_contacts add column if not exists added_by_email text;
alter table public.platform_admin_contacts add column if not exists deactivated_at timestamptz;

-- The caller's own contact row, active or not.
create or replace function public.platform_admin_contact_is_caller(p_user_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (p_user_id is not null and p_user_id = auth.uid())
      or lower(btrim(coalesce(p_email, ''))) = lower(btrim(coalesce(nullif(auth.jwt() ->> 'email', ''), '-')))
$$;

revoke all on function public.platform_admin_contact_is_caller(uuid, text) from public, anon, authenticated;

-- Does this email belong to someone in a club (club admin, coach, athlete, guardian), or to an
-- approved club request whose requester gets club admin access by email?
create or replace function public.platform_email_is_club_member(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users au
    where lower(btrim(au.email)) = lower(btrim(coalesce(p_email, '')))
      and (
        exists (select 1 from public.profiles p where p.user_id = au.id)
        or exists (select 1 from public.athletes a where a.user_id = au.id)
        or exists (select 1 from public.athlete_guardians g where g.guardian_user_id = au.id)
      )
  )
  or exists (
    select 1
    from public.tenant_provision_requests r
    where lower(btrim(r.requestor_email)) = lower(btrim(coalesce(p_email, '')))
      and r.status = 'approved'
  )
$$;

revoke all on function public.platform_email_is_club_member(text) from public, anon, authenticated;

create or replace function public.list_platform_admins()
returns table (
  id uuid,
  email text,
  display_name text,
  is_active boolean,
  is_self boolean,
  added_at timestamptz,
  added_by_email text,
  deactivated_at timestamptz,
  last_sign_in_at timestamptz,
  has_account boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can see platform admins.' using errcode = '42501';
  end if;

  return query
  select
    pac.id,
    lower(pac.email),
    nullif(btrim(coalesce(pac.display_name, '')), ''),
    pac.is_active,
    public.platform_admin_contact_is_caller(pac.user_id, pac.email),
    pac.created_at,
    pac.added_by_email,
    pac.deactivated_at,
    u.last_sign_in_at,
    u.id is not null
  from public.platform_admin_contacts pac
  left join lateral (
    select au.id, au.last_sign_in_at
    from auth.users au
    where au.id = pac.user_id
       or (au.email_confirmed_at is not null and lower(btrim(au.email)) = lower(btrim(pac.email)))
    order by (au.id = pac.user_id) desc nulls last, au.last_sign_in_at desc nulls last
    limit 1
  ) u on true
  order by pac.is_active desc, pac.created_at;
end;
$$;

create or replace function public.add_platform_admin(p_email text, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(left(btrim(coalesce(p_display_name, '')), 120), '');
  v_user_id uuid;
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can add a platform admin.' using errcode = '42501';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a full email address.' using errcode = '22023';
  end if;

  lock table public.platform_admin_contacts in share row exclusive mode;

  if exists (select 1 from public.platform_admin_contacts pac where lower(btrim(pac.email)) = v_email) then
    raise exception 'That email is already a platform admin. Reactivate it in the list if it is switched off.' using errcode = '23505';
  end if;

  if public.platform_email_is_club_member(v_email) then
    raise exception 'That email belongs to a club member. A platform admin needs an email that is not used in any club.' using errcode = '22023';
  end if;

  -- An account that already confirmed this email is linked now. Otherwise the email alone gives
  -- access once an account with it signs in, the same way the first platform admin got in.
  select au.id into v_user_id
  from auth.users au
  where lower(btrim(au.email)) = v_email
    and au.email_confirmed_at is not null
  order by au.created_at
  limit 1;

  insert into public.platform_admin_contacts (user_id, email, is_active, display_name, added_by_email)
  values (v_user_id, v_email, true, v_name, lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), '')))
  returning id into v_id;

  perform public.insert_platform_audit_event(
    auth.uid(), auth.jwt() ->> 'email', 'platform-admin',
    'platform_admin_added', v_email,
    'Added as a platform admin',
    jsonb_build_object('contact_id', v_id, 'email', v_email, 'has_account', v_user_id is not null)
  );

  return v_id;
end;
$$;

create or replace function public.set_platform_admin_active(p_contact_id uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.platform_admin_contacts%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can change a platform admin.' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'Say whether the platform admin is active.' using errcode = '22023';
  end if;

  -- Two admins switching each other off at the same moment must not leave nobody.
  lock table public.platform_admin_contacts in share row exclusive mode;

  select * into v_row from public.platform_admin_contacts pac where pac.id = p_contact_id;
  if not found then
    raise exception 'That platform admin was not found.' using errcode = 'P0002';
  end if;

  if v_row.is_active = p_active then
    return false;
  end if;

  if not p_active then
    if not exists (
      select 1 from public.platform_admin_contacts other
      where other.is_active and other.id <> v_row.id
    ) then
      raise exception 'This is the last active platform admin. Add another one first.' using errcode = '22023';
    end if;
    if public.platform_admin_contact_is_caller(v_row.user_id, v_row.email) then
      raise exception 'You cannot switch off your own access. Ask another platform admin.' using errcode = '22023';
    end if;
  else
    if public.platform_email_is_club_member(v_row.email) then
      raise exception 'That email now belongs to a club member, so it cannot be a platform admin.' using errcode = '22023';
    end if;
  end if;

  update public.platform_admin_contacts pac
  set is_active = p_active,
      deactivated_at = case when p_active then null else now() end
  where pac.id = v_row.id;

  perform public.insert_platform_audit_event(
    auth.uid(), auth.jwt() ->> 'email', 'platform-admin',
    case when p_active then 'platform_admin_reactivated' else 'platform_admin_deactivated' end,
    lower(v_row.email),
    case when p_active then 'Platform admin access switched back on' else 'Platform admin access switched off' end,
    jsonb_build_object('contact_id', v_row.id, 'email', lower(v_row.email))
  );

  return true;
end;
$$;

revoke all on function public.list_platform_admins() from public, anon;
revoke all on function public.add_platform_admin(text, text) from public, anon;
revoke all on function public.set_platform_admin_active(uuid, boolean) from public, anon;
grant execute on function public.list_platform_admins() to authenticated;
grant execute on function public.add_platform_admin(text, text) to authenticated;
grant execute on function public.set_platform_admin_active(uuid, boolean) to authenticated;

-- 2. Club overview for support --------------------------------------------------------------------

-- Club activity that is safe to show the platform: the kind of event, the role that did it and
-- when. Never the target or the detail (they can hold a person's name), and never an event about
-- messages or health.
create or replace function public.platform_safe_club_action(p_action text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_action, '') <> ''
     and p_action !~* '(message|health|pain|wellness|readiness|injur|availability|note|medical)'
$$;

create or replace function public.get_platform_club_overview(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_request record;
  v_name text;
  v_owner_id uuid;
  v_result jsonb;
  v_media_items bigint := 0;
  v_media_bytes bigint := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can open a club overview.' using errcode = '42501';
  end if;

  select * into v_tenant from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'That club was not found.' using errcode = 'P0002';
  end if;

  v_name := public.club_display_name(p_tenant_id);

  select tpr.id, tpr.requested_plan, tpr.lifecycle_status, tpr.billing_status, tpr.created_at
  into v_request
  from public.tenant_provision_requests tpr
  where tpr.provisioned_tenant_id = p_tenant_id
  order by tpr.created_at desc
  limit 1;

  select co.owner_user_id into v_owner_id from public.club_owners co where co.tenant_id = p_tenant_id;

  select count(*), coalesce(sum(m.bytes), 0) into v_media_items, v_media_bytes
  from public.session_media m
  where m.tenant_id = p_tenant_id;

  v_result := jsonb_build_object(
    'tenant_id', p_tenant_id,
    'club_name', v_name,
    'request_id', v_request.id,
    'package', v_request.requested_plan,
    'lifecycle_status', v_request.lifecycle_status,
    'billing_status', v_request.billing_status,
    'created_at', v_tenant.created_at,
    'closure', (
      select jsonb_build_object('closed_at', cc.closed_at, 'delete_after', cc.delete_after)
      from public.club_closures cc
      where cc.tenant_id = p_tenant_id and cc.reopened_at is null
      order by cc.closed_at desc
      limit 1
    ),
    'admins', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', coalesce(nullif(btrim(p.display_name), ''), 'Club admin'),
          'email', lower(au.email),
          'is_owner', p.user_id = v_owner_id,
          'is_active', p.is_active
        )
        order by (p.user_id = v_owner_id) desc nulls last, p.created_at
      )
      from public.profiles p
      left join auth.users au on au.id = p.user_id
      where p.tenant_id = p_tenant_id and p.role = 'club-admin'
    ), '[]'::jsonb),
    'usage', jsonb_build_object(
      'teams', (select count(*) from public.teams tm where tm.tenant_id = p_tenant_id and not tm.is_archived and tm.status <> 'archived'),
      'coaches', (select count(*) from public.profiles p where p.tenant_id = p_tenant_id and p.role = 'coach' and p.is_active),
      'club_admins', (select count(*) from public.profiles p where p.tenant_id = p_tenant_id and p.role = 'club-admin' and p.is_active),
      'athletes', (select count(*) from public.athletes a where a.tenant_id = p_tenant_id),
      'athletes_with_login', (select count(*) from public.athletes a where a.tenant_id = p_tenant_id and a.user_id is not null),
      'guardians', (select count(distinct g.guardian_user_id) from public.athlete_guardians g where g.tenant_id = p_tenant_id and g.status = 'active'),
      'media_items', v_media_items,
      'media_bytes', v_media_bytes
    ),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', tm.name,
          'event_group', tm.event_group,
          'archived', tm.is_archived or tm.status = 'archived',
          'athletes', (select count(*) from public.athletes a where a.team_id = tm.id),
          'coaches', (select count(distinct tc.user_id) from public.team_coaches tc where tc.team_id = tm.id),
          'squads', (select count(*) from public.team_squads sq where sq.team_id = tm.id)
        )
        order by (tm.is_archived or tm.status = 'archived'), tm.name
      )
      from public.teams tm
      where tm.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'season', coalesce(
      (
        select jsonb_build_object('name', s.name, 'start_date', s.start_date, 'end_date', s.end_date, 'status', s.status)
        from public.club_seasons s
        where s.tenant_id = p_tenant_id
        order by (s.status = 'current') desc, s.start_date desc
        limit 1
      ),
      (
        select jsonb_build_object('name', cp.season_year, 'start_date', cp.season_start, 'end_date', cp.season_end, 'status', null)
        from public.club_profiles cp
        where cp.tenant_id = p_tenant_id and (cp.season_start is not null or nullif(btrim(coalesce(cp.season_year, '')), '') is not null)
        limit 1
      )
    ),
    -- The newest sign-in of anyone with that role. A date, not a person.
    'last_active', coalesce((
      select jsonb_object_agg(r.role, r.last_at)
      from (
        select p.role, max(au.last_sign_in_at) as last_at
        from public.profiles p
        join auth.users au on au.id = p.user_id
        where p.tenant_id = p_tenant_id
        group by p.role
      ) r
    ), '{}'::jsonb),
    'counts', jsonb_build_object(
      'plans', (select count(*) from public.training_plans tp where tp.tenant_id = p_tenant_id),
      'plans_published', (select count(*) from public.training_plans tp where tp.tenant_id = p_tenant_id and tp.published_at is not null),
      'sessions_logged_28d', (select count(*) from public.session_completions sc where sc.tenant_id = p_tenant_id and sc.completed_at > now() - interval '28 days'),
      'test_weeks', (select count(*) from public.test_weeks tw where tw.tenant_id = p_tenant_id),
      'messages', (select count(*) from public.messages m where m.tenant_id = p_tenant_id),
      'announcements', (select count(*) from public.announcements an where an.tenant_id = p_tenant_id),
      'failed_emails_28d', (
        select count(*) from public.notification_events e
        where e.tenant_id = p_tenant_id and e.channel = 'email' and e.status = 'failed'
          and e.created_at > now() - interval '28 days'
      )
    ),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object('action', x.action, 'actor_role', x.actor_role, 'occurred_at', x.occurred_at) order by x.occurred_at desc)
      from (
        select ae.action, ae.actor_role, ae.occurred_at
        from public.audit_events ae
        where ae.tenant_id = p_tenant_id
          and public.platform_safe_club_action(ae.action)
        order by ae.occurred_at desc
        limit 15
      ) x
    ), '[]'::jsonb)
  );

  -- Who looked inside which club, and when.
  perform public.insert_platform_audit_event(
    auth.uid(), auth.jwt() ->> 'email', 'platform-admin',
    'platform_club_overview_opened', v_name,
    'Opened the club overview for support',
    jsonb_build_object('tenant_id', p_tenant_id, 'request_id', v_request.id)
  );

  return v_result;
end;
$$;

revoke all on function public.platform_safe_club_action(text) from public, anon;
revoke all on function public.get_platform_club_overview(uuid) from public, anon;
grant execute on function public.get_platform_club_overview(uuid) to authenticated;

-- 3. Usage ---------------------------------------------------------------------------------------

create or replace function public.get_platform_usage(p_days integer default 28)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can see usage.' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 28, 90) then
    raise exception 'Choose 7, 28 or 90 days.' using errcode = '22023';
  end if;

  v_from := now() - make_interval(days => p_days);

  with active_users as (
    -- Signed in, or did something: logged a session, sent a message, or an action in the club's log.
    select au.id as user_id from auth.users au where au.last_sign_in_at >= v_from
    union
    select sc.completed_by_user_id from public.session_completions sc where sc.completed_at >= v_from and sc.completed_by_user_id is not null
    union
    select m.sender_user_id from public.messages m where m.created_at >= v_from and m.sender_user_id is not null
    union
    select ae.actor_user_id from public.audit_events ae where ae.occurred_at >= v_from and ae.actor_user_id is not null
  ),
  clubs as (
    select
      t.id as tenant_id,
      public.club_display_name(t.id) as club_name,
      r.lifecycle_status,
      r.requested_plan,
      exists (select 1 from public.club_closures cc where cc.tenant_id = t.id and cc.reopened_at is null) as is_closed,
      o.owner_name,
      o.owner_email,
      (select count(*) from public.profiles p join active_users a on a.user_id = p.user_id where p.tenant_id = t.id and p.is_active and p.role = 'club-admin') as active_club_admins,
      (select count(*) from public.profiles p join active_users a on a.user_id = p.user_id where p.tenant_id = t.id and p.is_active and p.role = 'coach') as active_coaches,
      (select count(*) from public.profiles p join active_users a on a.user_id = p.user_id where p.tenant_id = t.id and p.is_active and p.role = 'athlete') as active_athletes,
      (select count(*) from public.profiles p join active_users a on a.user_id = p.user_id where p.tenant_id = t.id and p.is_active and p.role = 'guardian') as active_guardians,
      (select count(*) from public.session_completions sc where sc.tenant_id = t.id and sc.completed_at >= v_from) as sessions_logged,
      (select count(*) from public.training_plans tp where tp.tenant_id = t.id and tp.published_at >= v_from) as plans_published,
      (select count(*) from public.messages m where m.tenant_id = t.id and m.created_at >= v_from) as messages_sent,
      (select count(*) from public.reminder_deliveries rd where rd.tenant_id = t.id and rd.created_at >= v_from and rd.queued_count > 0) as reminders_sent,
      (select count(*) from public.push_deliveries pd where pd.tenant_id = t.id and pd.status = 'sent' and pd.completed_at >= v_from) as pushes_sent,
      (select count(*) from public.notification_events e where e.tenant_id = t.id and e.channel = 'email' and e.status = 'sent' and e.delivered_at >= v_from) as emails_sent,
      (select count(*) from public.notification_events e where e.tenant_id = t.id and e.channel = 'email' and e.status = 'failed' and e.created_at >= v_from) as emails_failed,
      (select count(*) from public.athletes a where a.tenant_id = t.id and a.created_at >= v_from) as new_athletes
    from public.tenants t
    left join lateral (
      select tpr.lifecycle_status, tpr.requested_plan, tpr.requestor_name, tpr.requestor_email
      from public.tenant_provision_requests tpr
      where tpr.provisioned_tenant_id = t.id
      order by tpr.created_at desc
      limit 1
    ) r on true
    left join lateral (
      -- The club owner's contact. A club with no owner row yet: the person who asked for the club.
      select
        coalesce((select nullif(btrim(p.display_name), '') from public.profiles p where p.user_id = co.owner_user_id), r.requestor_name) as owner_name,
        coalesce((select lower(au.email) from auth.users au where au.id = co.owner_user_id), lower(r.requestor_email)) as owner_email
      from (select 1) one
      left join public.club_owners co on co.tenant_id = t.id
    ) o on true
  )
  select jsonb_build_object(
    'days', p_days,
    'from', v_from,
    'to', now(),
    'clubs', coalesce((select jsonb_agg(to_jsonb(c) order by c.club_name) from clubs c), '[]'::jsonb),
    -- Sessions logged per week across every club, the last 12 weeks, oldest first. Weeks start on Monday (UTC).
    'weeks', (
      select jsonb_agg(jsonb_build_object('week_start', w.week_start::date, 'sessions_logged', w.n) order by w.week_start)
      from (
        select g.week_start,
               (select count(*) from public.session_completions sc where sc.completed_at >= g.week_start and sc.completed_at < g.week_start + interval '7 days') as n
        from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '7 days') as g(week_start)
      ) w
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_platform_usage(integer) from public, anon;
grant execute on function public.get_platform_usage(integer) to authenticated;

-- 4. A notice to all clubs -----------------------------------------------------------------------

create table if not exists public.platform_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  link_url text,
  audience text not null default 'everyone',
  expires_at timestamptz,
  email_club_admins boolean not null default false,
  reach_in_app integer not null default 0,
  reach_email integer not null default 0,
  sent_by_email text,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by_email text,
  constraint platform_notices_title_length check (char_length(btrim(title)) between 3 and 120),
  constraint platform_notices_body_length check (char_length(btrim(body)) between 1 and 500),
  constraint platform_notices_audience check (audience in ('everyone', 'staff', 'club_admins')),
  constraint platform_notices_link check (link_url is null or (char_length(link_url) <= 300 and (link_url ~ '^https://[^\s]+$' or link_url ~ '^/[^/\s][^\s]*$')))
);

create table if not exists public.platform_notice_dismissals (
  notice_id uuid not null references public.platform_notices (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (notice_id, user_id)
);

create index if not exists platform_notice_dismissals_user_idx on public.platform_notice_dismissals (user_id);

alter table public.platform_notices enable row level security;
alter table public.platform_notice_dismissals enable row level security;

-- Club members never read these tables: the banner goes through get_my_platform_notices().
drop policy if exists platform_notices_select_platform_admin on public.platform_notices;
create policy platform_notices_select_platform_admin
on public.platform_notices
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists platform_notice_dismissals_select_own on public.platform_notice_dismissals;
create policy platform_notice_dismissals_select_own
on public.platform_notice_dismissals
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.platform_notices from public, anon, authenticated;
revoke all on public.platform_notice_dismissals from public, anon, authenticated;
grant select on public.platform_notices to authenticated;
grant select on public.platform_notice_dismissals to authenticated;

-- Which roles an audience reaches. An athlete or a guardian only with "everyone".
create or replace function public.platform_notice_reaches(p_audience text, p_role text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_audience
    when 'everyone' then p_role in ('athlete', 'coach', 'club-admin', 'guardian')
    when 'staff' then p_role in ('coach', 'club-admin')
    when 'club_admins' then p_role = 'club-admin'
    else false
  end
$$;

create or replace function public.send_platform_notice(
  p_title text,
  p_body text,
  p_link_url text default null,
  p_audience text default 'everyone',
  p_expires_at timestamptz default null,
  p_email_club_admins boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_link text := nullif(btrim(coalesce(p_link_url, '')), '');
  v_audience text := coalesce(nullif(btrim(coalesce(p_audience, '')), ''), 'everyone');
  v_id uuid;
  v_member record;
  v_in_app integer := 0;
  v_email integer := 0;
  v_metadata jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can send a notice.' using errcode = '42501';
  end if;
  if char_length(v_title) < 3 or char_length(v_title) > 120 then
    raise exception 'Give the notice a title of 3 to 120 characters.' using errcode = '22023';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Write the notice in 1 to 500 characters.' using errcode = '22023';
  end if;
  if v_audience not in ('everyone', 'staff', 'club_admins') then
    raise exception 'Choose who the notice is for.' using errcode = '22023';
  end if;
  if v_link is not null and not (char_length(v_link) <= 300 and (v_link ~ '^https://[^\s]+$' or v_link ~ '^/[^/\s][^\s]*$')) then
    raise exception 'The link must start with https:// or be a page in the app that starts with /.' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The end date must be in the future.' using errcode = '22023';
  end if;

  insert into public.platform_notices (title, body, link_url, audience, expires_at, email_club_admins, sent_by_email)
  values (v_title, v_body, v_link, v_audience, p_expires_at, coalesce(p_email_club_admins, false), lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), '')))
  returning id into v_id;

  v_metadata := jsonb_build_object('notice_id', v_id) || case when v_link is null then '{}'::jsonb else jsonb_build_object('link', v_link) end;

  -- Active members of clubs that are open. enqueue_notification checks the member and the club
  -- again and respects what each person switched off.
  for v_member in
    select p.user_id, p.tenant_id, p.role
    from public.profiles p
    where p.is_active
      and public.platform_notice_reaches(v_audience, p.role)
      and not public.tenant_access_blocked(p.tenant_id)
      and not public.club_is_closed(p.tenant_id)
  loop
    v_in_app := v_in_app + public.enqueue_notification(
      v_member.tenant_id, v_member.user_id, 'platform_notice', v_title, v_body, v_metadata,
      array['in-app'], 'platform_notice:' || v_id::text, interval '10 years'
    );
    if coalesce(p_email_club_admins, false) and v_member.role = 'club-admin' then
      v_email := v_email + public.enqueue_notification(
        v_member.tenant_id, v_member.user_id, 'platform_notice', v_title, v_body, v_metadata,
        array['email'], 'platform_notice:' || v_id::text, interval '10 years'
      );
    end if;
  end loop;

  update public.platform_notices n set reach_in_app = v_in_app, reach_email = v_email where n.id = v_id;

  perform public.insert_platform_audit_event(
    auth.uid(), auth.jwt() ->> 'email', 'platform-admin',
    'platform_notice_sent', v_title,
    format('Notice sent to %s (%s in the app, %s by email)', v_audience, v_in_app, v_email),
    jsonb_build_object('notice_id', v_id, 'audience', v_audience, 'reach_in_app', v_in_app, 'reach_email', v_email, 'expires_at', p_expires_at)
  );

  return jsonb_build_object('id', v_id, 'reach_in_app', v_in_app, 'reach_email', v_email);
end;
$$;

create or replace function public.withdraw_platform_notice(p_notice_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.platform_notices%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can withdraw a notice.' using errcode = '42501';
  end if;

  select * into v_row from public.platform_notices n where n.id = p_notice_id for update;
  if not found then
    raise exception 'That notice was not found.' using errcode = 'P0002';
  end if;
  if v_row.withdrawn_at is not null then
    return false;
  end if;

  update public.platform_notices n
  set withdrawn_at = now(),
      withdrawn_by_email = lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''))
  where n.id = p_notice_id;

  -- It also leaves each person's notification list, and an email not sent yet is not sent.
  update public.user_notifications un
  set state = 'dismissed', dismissed_at = now(), updated_at = now()
  from public.notification_events e
  where e.id = un.event_id
    and e.event_type = 'platform_notice'
    and e.metadata ->> 'notice_id' = p_notice_id::text
    and un.state <> 'dismissed';

  update public.notification_events e
  set status = 'suppressed', last_error = 'Notice withdrawn'
  where e.event_type = 'platform_notice'
    and e.channel = 'email'
    and e.status in ('pending', 'failed')
    and e.metadata ->> 'notice_id' = p_notice_id::text;

  perform public.insert_platform_audit_event(
    auth.uid(), auth.jwt() ->> 'email', 'platform-admin',
    'platform_notice_withdrawn', v_row.title,
    'Notice withdrawn',
    jsonb_build_object('notice_id', p_notice_id)
  );

  return true;
end;
$$;

create or replace function public.list_platform_notices()
returns table (
  id uuid,
  title text,
  body text,
  link_url text,
  audience text,
  expires_at timestamptz,
  email_club_admins boolean,
  reach_in_app integer,
  reach_email integer,
  dismissed_count integer,
  sent_by_email text,
  created_at timestamptz,
  withdrawn_at timestamptz,
  state text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can list notices.' using errcode = '42501';
  end if;

  return query
  select
    n.id, n.title, n.body, n.link_url, n.audience, n.expires_at, n.email_club_admins,
    n.reach_in_app, n.reach_email,
    (select count(*)::int from public.platform_notice_dismissals d where d.notice_id = n.id),
    n.sent_by_email, n.created_at, n.withdrawn_at,
    case
      when n.withdrawn_at is not null then 'withdrawn'
      when n.expires_at is not null and n.expires_at <= now() then 'expired'
      else 'live'
    end
  from public.platform_notices n
  order by n.created_at desc
  limit 200;
end;
$$;

-- The banner. Only an active member of a club that is not paused or closed, only notices for their
-- role that are live and that they have not dismissed.
create or replace function public.get_my_platform_notices()
returns table (id uuid, title text, body text, link_url text, created_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.title, n.body, n.link_url, n.created_at, n.expires_at
  from public.platform_notices n
  where auth.uid() is not null
    and n.withdrawn_at is null
    and (n.expires_at is null or n.expires_at > now())
    and public.platform_notice_reaches(n.audience, public.current_app_role())
    and not coalesce(public.club_is_closed(public.current_tenant_id()), false)
    and not exists (
      select 1 from public.platform_notice_dismissals d
      where d.notice_id = n.id and d.user_id = auth.uid()
    )
  order by n.created_at desc
  limit 3
$$;

create or replace function public.dismiss_platform_notice(p_notice_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  -- Only a notice this person can actually see.
  if not exists (
    select 1 from public.platform_notices n
    where n.id = p_notice_id
      and public.platform_notice_reaches(n.audience, public.current_app_role())
  ) then
    return false;
  end if;

  insert into public.platform_notice_dismissals (notice_id, user_id)
  values (p_notice_id, auth.uid())
  on conflict do nothing;
  return true;
end;
$$;

revoke all on function public.platform_notice_reaches(text, text) from public, anon;
revoke all on function public.send_platform_notice(text, text, text, text, timestamptz, boolean) from public, anon;
revoke all on function public.withdraw_platform_notice(uuid) from public, anon;
revoke all on function public.list_platform_notices() from public, anon;
revoke all on function public.get_my_platform_notices() from public, anon;
revoke all on function public.dismiss_platform_notice(uuid) from public, anon;
grant execute on function public.send_platform_notice(text, text, text, text, timestamptz, boolean) to authenticated;
grant execute on function public.withdraw_platform_notice(uuid) to authenticated;
grant execute on function public.list_platform_notices() to authenticated;
grant execute on function public.get_my_platform_notices() to authenticated;
grant execute on function public.dismiss_platform_notice(uuid) to authenticated;

-- 5. System status -------------------------------------------------------------------------------

create or replace function public.get_platform_system_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_config public.notification_dispatch_config%rowtype;
  v_has_net boolean := to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null;
  v_has_cron boolean := to_regclass('cron.job') is not null;
  v_jobs jsonb := '{}'::jsonb;
  v_reminder_last_run timestamptz;
  v_migration text;
  v_email jsonb;
  v_push jsonb;
  v_storage jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can see the system status.' using errcode = '42501';
  end if;

  select * into v_config from public.notification_dispatch_config c where c.id;

  -- Which scheduled jobs exist and are switched on.
  if v_has_cron then
    begin
      execute 'select coalesce(jsonb_object_agg(j.jobname, jsonb_build_object(''active'', j.active, ''schedule'', j.schedule)), ''{}''::jsonb) from cron.job j where j.jobname like ''sktr-%''' into v_jobs;
    exception when others then
      v_jobs := '{}'::jsonb;
    end;
    -- When the reminder job last finished, where the scheduler keeps a history.
    if to_regclass('cron.job_run_details') is not null then
      begin
        execute 'select max(d.end_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = ''sktr-run-reminders'' and d.status = ''succeeded''' into v_reminder_last_run;
      exception when others then
        v_reminder_last_run := null;
      end;
    end if;
  end if;

  -- The newest migration, when this database keeps the list where the Supabase CLI writes it.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    begin
      execute 'select m.version || coalesce(''_'' || nullif(m.name, ''''), '''') from supabase_migrations.schema_migrations m order by m.version desc limit 1' into v_migration;
    exception when others then
      v_migration := null;
    end;
  end if;

  select jsonb_build_object(
    'address_set', v_config.function_url is not null,
    'can_call_out', v_has_net,
    'scheduled', coalesce((v_jobs -> 'sktr-dispatch-notification-emails' ->> 'active')::boolean, false),
    'last_run_at', v_config.last_run_at,
    'last_requested_at', v_config.last_requested_at,
    'queued', count(*) filter (where e.status = 'pending' and e.created_at > now() - public.notification_email_max_age()),
    'retrying', count(*) filter (where e.status = 'failed' and e.delivery_attempt_count < 5 and e.created_at > now() - public.notification_email_max_age()),
    'failed_24h', count(*) filter (where e.status = 'failed' and e.delivery_attempt_count >= 5 and e.created_at > now() - interval '24 hours'),
    'sent_24h', count(*) filter (where e.status = 'sent' and e.delivered_at > now() - interval '24 hours'),
    'oldest_queued_at', min(e.created_at) filter (where e.status = 'pending' and e.created_at > now() - public.notification_email_max_age())
  ) into v_email
  from public.notification_events e
  where e.channel = 'email'
    and e.created_at > now() - interval '8 days';

  select jsonb_build_object(
    -- What the sending function said about its keys the last time it ran. Null: it has not run since push was added.
    'configured', case when v_config.last_run_summary ? 'push' then (v_config.last_run_summary -> 'push' ->> 'configured')::boolean else null end,
    'problem', v_config.last_run_summary -> 'push' ->> 'problem',
    'scheduled', coalesce((v_jobs -> 'sktr-dispatch-push' ->> 'active')::boolean, false),
    'last_run_at', v_config.last_run_at,
    'devices', (select count(*) from public.push_subscriptions s where s.disabled_at is null),
    'queued', count(*) filter (where d.status = 'pending'),
    'failed_24h', count(*) filter (where d.status = 'failed' and d.created_at > now() - interval '24 hours'),
    'sent_24h', count(*) filter (where d.status = 'sent' and d.completed_at > now() - interval '24 hours')
  ) into v_push
  from public.push_deliveries d
  where d.created_at > now() - interval '8 days';

  select jsonb_build_object(
    'queued', count(*) filter (where q.done_at is null),
    'failing', count(*) filter (where q.done_at is null and q.attempts >= 3),
    'oldest_queued_at', min(q.queued_at) filter (where q.done_at is null),
    'last_done_at', max(q.done_at)
  ) into v_storage
  from public.storage_deletion_queue q;

  return jsonb_build_object(
    'checked_at', now(),
    'email', v_email,
    'reminders', jsonb_build_object(
      'scheduled', coalesce((v_jobs -> 'sktr-run-reminders' ->> 'active')::boolean, false),
      'schedule', v_jobs -> 'sktr-run-reminders' ->> 'schedule',
      'last_run_at', v_reminder_last_run,
      'last_reminder_at', (select max(rd.created_at) from public.reminder_deliveries rd),
      'sent_24h', (select count(*) from public.reminder_deliveries rd where rd.created_at > now() - interval '24 hours' and rd.queued_count > 0)
    ),
    'push', v_push,
    'storage', v_storage,
    'scheduler_available', v_has_cron,
    'latest_migration', v_migration,
    'clubs', jsonb_build_object(
      'paused', coalesce((
        select jsonb_agg(jsonb_build_object('tenant_id', t.id, 'club_name', public.club_display_name(t.id)) order by public.club_display_name(t.id))
        from public.tenants t
        where (
          select tpr.lifecycle_status
          from public.tenant_provision_requests tpr
          where tpr.provisioned_tenant_id = t.id
          order by tpr.created_at desc
          limit 1
        ) = 'suspended'
        and not public.club_is_closed(t.id)
      ), '[]'::jsonb),
      'closing', coalesce((
        select jsonb_agg(jsonb_build_object('tenant_id', cc.tenant_id, 'club_name', cc.club_name, 'closed_at', cc.closed_at, 'delete_after', cc.delete_after) order by cc.delete_after)
        from public.club_closures cc
        where cc.reopened_at is null
          and exists (select 1 from public.tenants t where t.id = cc.tenant_id)
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_platform_system_status() from public, anon;
grant execute on function public.get_platform_system_status() to authenticated;

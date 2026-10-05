-- Coach roster: bulk invites, team join codes (QR), athletes without a login, moving teams
-- Created: 2026-10-09
--
-- WHAT THIS ADDS
--   A. Bulk invites. preview_athlete_invites() and create_athlete_invites() take a list of
--      "name, email" lines for one team, say for every line whether it can be invited (invalid,
--      already on the team, already invited, a staff account, over the package limit) and create
--      the invites that can. One audit event for the batch, no notification per invite.
--   B. Team join codes. A coach of the team or a club admin creates one code per team
--      (create_team_join_code), shows it as a QR code, and can turn it off (disable_team_join_code).
--      A signed-in person with a CONFIRMED email uses it with join_team_with_code(). The public
--      page reads get_public_team_join_code(), which never says anything about a wrong code.
--   C. Managed athletes: an athletes row with no login (user_id is null), created and edited by
--      staff (create_managed_athlete, update_managed_athlete, remove_managed_athlete). They count
--      towards the package limit. create_athlete_login_invite() sends an invite that, when it is
--      accepted, links the new account to the EXISTING row, so all history is kept.
--   D. move_athlete_to_team(): a club admin moves any athlete of the club; a coach only between
--      two teams they coach. Untouched future sessions of the old team's plans are removed.
--   Seats. tenant_athlete_limit() and tenant_athlete_seats_used() put the package limit on athletes
--      in the database for the first time (it was a browser-side check only). get_roster_capacity()
--      gives staff the numbers.
--
-- THE RULE THAT MUST NOT BREAK (20261005200000_lock_down_profile_bootstrap.sql)
--   A profile only comes into existence through a server-side path that proves the caller is
--   entitled to it, and nobody chooses their own club or role. This file adds ONE such path:
--   join_team_with_code(). What it can grant is fixed in its body and comes from the code row,
--   never from the caller:
--     * role: 'athlete' only. There is no argument for a role, a club or a team.
--     * club and team: the ones the code was created for.
--     * who: a signed-in account whose email is confirmed (auth.users.email_confirmed_at).
--     * an account that already has a profile keeps it exactly as it is: a coach or club admin is
--       refused, a member of another club is refused, a deactivated member is refused, an athlete
--       who is on another team is refused (moving team is a staff action, see D).
--     * an email that carries access of its own (platform admin contact, requestor of an approved
--       club request) is refused, the same rule the claim-athlete-invite-account function uses.
--     * the code must be the newest one of its team, not turned off, not expired, not used up; the
--       club must not be suspended or cancelled and must have an athlete seat left.
--   Every join writes team_join_code_uses and audit_events and tells the team's coaches in-app.
--
-- WHAT CHANGES FOR EXISTING OBJECTS (each is its latest definition with the change described)
--   * accept_athlete_invite (latest: 20261007100000): two additions, nothing removed.
--       1. an invite that carries athlete_id links the caller to that managed athlete instead of
--          creating a new athletes row;
--       2. a new profile takes the name the coach typed on the invite when the account has none.
--   * current_tenant_athlete_count (20261006120000): counts active athletes only. No athlete row
--     was ever inactive before this file (remove_managed_athlete is the first writer of
--     is_active = false), so the number is unchanged for every existing club.
--   * trigger queue_athlete_invite_notifications: same function, plus a WHEN clause so a bulk
--     create does not send the inviter one "invite ready to share" notification per line.
--   * athletes and athlete_invites get a BEFORE trigger each that stops the API roles from writing
--     the columns that link a login (athletes.user_id) or a managed athlete (athlete_invites.
--     athlete_id). Nothing in the app wrote them through the API.
--
-- Idempotent and additive: add column if not exists, create table/index if not exists, create or
-- replace function, drop policy/trigger if exists then create. No row is changed or deleted.

-- 1. Columns ------------------------------------------------------------------------------

alter table public.athletes
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists login_linked_at timestamptz;

comment on column public.athletes.user_id is
  'The login this athlete signs in with. NULL for a managed athlete (no login): staff enter everything for them. Only accept_athlete_invite() and join_team_with_code() set it.';
comment on column public.athletes.created_by_user_id is
  'Staff member who added a managed athlete. NULL for athletes who joined by invite or join code.';
comment on column public.athletes.login_linked_at is
  'When a managed athlete was given a login (an invite created by create_athlete_login_invite() was accepted).';

alter table public.athlete_invites
  add column if not exists invitee_name text,
  add column if not exists athlete_id uuid references public.athletes(id) on delete set null;

alter table public.athlete_invites drop constraint if exists athlete_invites_invitee_name_length;
alter table public.athlete_invites
  add constraint athlete_invites_invitee_name_length
  check (invitee_name is null or length(invitee_name) <= 120);

comment on column public.athlete_invites.invitee_name is
  'Name the inviter typed for this person (bulk invites). Used as the display name of a new account that has none.';
comment on column public.athlete_invites.athlete_id is
  'Set only by create_athlete_login_invite(): accepting this invite links the account to this existing managed athlete instead of creating a new athletes row.';

create index if not exists athlete_invites_athlete_idx
on public.athlete_invites (athlete_id)
where athlete_id is not null;

-- Seats are counted on active athletes of a club.
create index if not exists athletes_tenant_active_idx
on public.athletes (tenant_id)
where is_active;

-- 2. Who may write the linking columns ------------------------------------------------------
-- Staff keep their row policies on athletes and athlete_invites (20261006120000). Without these
-- two triggers a coach could use those policies to point an athletes row at any account, or
-- point one of their invites at a managed athlete of another team, and so hand one person's
-- history to another login. Security definer functions run as the function owner and are not
-- affected; neither is the service role.

create or replace function public.protect_athlete_login_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.user_id := null;
      new.login_linked_at := null;
    else
      new.user_id := old.user_id;
      new.login_linked_at := old.login_linked_at;
      new.created_by_user_id := old.created_by_user_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_athlete_login_link on public.athletes;
create trigger protect_athlete_login_link
before insert or update on public.athletes
for each row
execute function public.protect_athlete_login_link();

create or replace function public.protect_athlete_invite_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.athlete_id := null;
    else
      new.athlete_id := old.athlete_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_athlete_invite_link on public.athlete_invites;
create trigger protect_athlete_invite_link
before insert or update on public.athlete_invites
for each row
execute function public.protect_athlete_invite_link();

-- 3. Seats: the package limit on athletes, in the database ----------------------------------

-- Athletes a club's package allows. NULL means no limit (Enterprise, or a club with no
-- provisioning record). KEEP IN STEP WITH src/lib/billing/package-catalog.ts.
create or replace function public.tenant_athlete_limit(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case lower(coalesce((
      select tpr.requested_plan
      from public.tenant_provision_requests tpr
      where tpr.provisioned_tenant_id = p_tenant_id
      order by tpr.created_at desc
      limit 1
    ), ''))
    when 'starter' then 40
    when 'pro' then 150
    else null
  end
$$;

-- Seats in use: active athletes of the club, with or without a login, on a team or not.
create or replace function public.tenant_athlete_seats_used(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.athletes a
  where a.tenant_id = p_tenant_id
    and a.is_active
$$;

-- Invites that will each take a seat when accepted: pending, not expired, not for a managed
-- athlete (that seat is already taken) and not addressed to someone who is an athlete of the
-- club already.
create or replace function public.tenant_pending_athlete_invite_seats(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct lower(btrim(ai.email)))::int
  from public.athlete_invites ai
  where ai.tenant_id = p_tenant_id
    and ai.status = 'pending'
    and (ai.expires_at is null or ai.expires_at >= now())
    and ai.athlete_id is null
    and nullif(btrim(coalesce(ai.email, '')), '') is not null
    and not exists (
      select 1
      from auth.users au
      join public.athletes a
        on a.user_id = au.id
       and a.tenant_id = ai.tenant_id
       and a.is_active
      where lower(btrim(au.email)) = lower(btrim(ai.email))
    )
$$;

-- Serialises everything that takes a seat in one club, so two requests at the same moment
-- cannot both take the last one. Released at the end of the transaction.
create or replace function public.lock_tenant_athlete_seats(p_tenant_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  select pg_advisory_xact_lock(hashtextextended('athlete_seats:' || p_tenant_id::text, 0))
$$;

revoke all on function public.tenant_athlete_limit(uuid) from public, anon, authenticated;
revoke all on function public.tenant_athlete_seats_used(uuid) from public, anon, authenticated;
revoke all on function public.tenant_pending_athlete_invite_seats(uuid) from public, anon, authenticated;
revoke all on function public.lock_tenant_athlete_seats(uuid) from public, anon, authenticated;
grant execute on function public.tenant_athlete_limit(uuid) to service_role;
grant execute on function public.tenant_athlete_seats_used(uuid) to service_role;

-- The numbers behind "12 of 40 athletes" for staff of the caller's own club. No rows for anyone
-- else. seats_left is NULL when the package has no limit.
create or replace function public.get_roster_capacity()
returns table (
  athlete_limit integer,
  athletes_used integer,
  pending_invites integer,
  seats_left integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    x.athlete_limit,
    x.athletes_used,
    x.pending_invites,
    case when x.athlete_limit is null then null
         else greatest(x.athlete_limit - x.athletes_used - x.pending_invites, 0)
    end
  from (
    select
      public.tenant_athlete_limit(public.current_tenant_id()) as athlete_limit,
      public.tenant_athlete_seats_used(public.current_tenant_id()) as athletes_used,
      public.tenant_pending_athlete_invite_seats(public.current_tenant_id()) as pending_invites
  ) x
  where public.is_coach_or_admin()
$$;

revoke all on function public.get_roster_capacity() from public, anon;
grant execute on function public.get_roster_capacity() to authenticated, service_role;

-- Same function as 20261006120000 with "and a.is_active" added, so it agrees with
-- tenant_athlete_seats_used(). The browser's own package check reads this one.
create or replace function public.current_tenant_athlete_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_coach_or_admin() then (
      select count(*)::int
      from public.athletes a
      where a.tenant_id = public.current_tenant_id()
        and a.is_active
    )
  end
$$;

revoke all on function public.current_tenant_athlete_count() from public, anon;
grant execute on function public.current_tenant_athlete_count() to authenticated, service_role;

-- 4. Bulk invites ---------------------------------------------------------------------------

-- A bulk create inserts many invites in one statement. Each insert used to queue an in-app
-- "Athlete invite ready to share" notification for the inviter, which would be one per line.
-- create_athlete_invites() switches that off for its own transaction with a transaction-local
-- setting. The API cannot set it: set_config() is not exposed through PostgREST.
drop trigger if exists queue_athlete_invite_notifications on public.athlete_invites;
create trigger queue_athlete_invite_notifications
after insert or update on public.athlete_invites
for each row
when (coalesce(current_setting('sktr.suppress_invite_created_notice', true), '') <> '1')
execute function public.enqueue_athlete_invite_notifications();

-- What one email is to one team. Internal.
--   invalid        not an email address
--   on_team        an active athlete of this team signs in with it
--   invited        a pending, unexpired invite of this team is addressed to it
--   staff_account  a coach or club admin of THIS club signs in with it (they cannot accept an
--                  athlete invite). Accounts of other clubs are never reported.
--   existing       an active athlete of this club who is on another team or on none: the invite
--                  works and takes no new seat
--   ok             anything else
create or replace function public.classify_athlete_invite_email(
  p_tenant_id uuid,
  p_team_id uuid,
  p_email text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user_id uuid;
  v_role text;
  v_team_id uuid;
  v_athlete_found boolean := false;
begin
  if v_email = '' or not public.contact_email_is_valid(v_email) or v_email ~ '[<>"'',;\s]' then
    return 'invalid';
  end if;

  select au.id into v_user_id
  from auth.users au
  where lower(btrim(au.email)) = v_email
  order by au.created_at
  limit 1;

  if v_user_id is not null then
    select p.role into v_role
    from public.profiles p
    where p.user_id = v_user_id
      and p.tenant_id = p_tenant_id;

    if v_role in ('coach', 'club-admin') then
      return 'staff_account';
    end if;

    select a.team_id, true into v_team_id, v_athlete_found
    from public.athletes a
    where a.user_id = v_user_id
      and a.tenant_id = p_tenant_id
      and a.is_active
    limit 1;

    if coalesce(v_athlete_found, false) and v_team_id = p_team_id then
      return 'on_team';
    end if;
  end if;

  if exists (
    select 1
    from public.athlete_invites ai
    where ai.tenant_id = p_tenant_id
      and ai.team_id = p_team_id
      and ai.status = 'pending'
      and (ai.expires_at is null or ai.expires_at >= now())
      and lower(btrim(ai.email)) = v_email
  ) then
    return 'invited';
  end if;

  if coalesce(v_athlete_found, false) then
    return 'existing';
  end if;

  return 'ok';
end;
$$;

revoke all on function public.classify_athlete_invite_email(uuid, uuid, text) from public, anon, authenticated;

-- The one implementation behind the preview and the create, so they can never disagree.
-- p_entries is a JSON array of {"email": "...", "name": "..."} in the order the coach typed them.
-- Returned status per line: invalid, duplicate (same email earlier in the list), on_team, invited,
-- staff_account, over_limit, and ok (preview) or created (create).
create or replace function public.process_athlete_invites(
  p_team_id uuid,
  p_entries jsonb,
  p_expires_in_days integer,
  p_dry_run boolean
)
returns table (
  line_no integer,
  email text,
  status text,
  invite_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_team_name text;
  v_days integer := greatest(1, least(coalesce(p_expires_in_days, 7), 30));
  v_limit integer;
  v_seats_left integer;
  v_entry jsonb;
  v_index integer := 0;
  v_email text;
  v_name text;
  v_status text;
  v_seen text[] := '{}';
  v_invite_id uuid;
  v_created integer := 0;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_team_id is null or not public.can_manage_team(p_team_id) then
    raise exception 'You can only invite athletes to a team you coach.' using errcode = '42501';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Expected a list of people to invite.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) = 0 then
    return;
  end if;
  if jsonb_array_length(p_entries) > 200 then
    raise exception 'Invite up to 200 people at a time.' using errcode = '22023';
  end if;

  select t.tenant_id, t.name into v_tenant_id, v_team_name
  from public.teams t
  where t.id = p_team_id
    and t.tenant_id = public.current_tenant_id();

  if v_tenant_id is null then
    raise exception 'Team not found.' using errcode = '42501';
  end if;

  if not p_dry_run then
    perform public.lock_tenant_athlete_seats(v_tenant_id);
    perform set_config('sktr.suppress_invite_created_notice', '1', true);
  end if;

  v_limit := public.tenant_athlete_limit(v_tenant_id);
  if v_limit is not null then
    v_seats_left := greatest(
      v_limit - public.tenant_athlete_seats_used(v_tenant_id) - public.tenant_pending_athlete_invite_seats(v_tenant_id),
      0
    );
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries)
  loop
    v_index := v_index + 1;
    v_invite_id := null;
    v_email := lower(btrim(coalesce(case when jsonb_typeof(v_entry) = 'object' then v_entry ->> 'email' else null end, '')));
    v_name := nullif(left(btrim(regexp_replace(coalesce(case when jsonb_typeof(v_entry) = 'object' then v_entry ->> 'name' else null end, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 120), '');

    v_status := public.classify_athlete_invite_email(v_tenant_id, p_team_id, v_email);

    if v_status <> 'invalid' and v_email = any (v_seen) then
      v_status := 'duplicate';
    end if;

    if v_status in ('ok', 'existing') then
      v_seen := array_append(v_seen, v_email);
      if v_status = 'ok' and v_seats_left is not null then
        if v_seats_left <= 0 then
          v_status := 'over_limit';
        else
          v_seats_left := v_seats_left - 1;
        end if;
      end if;
    end if;

    if v_status in ('ok', 'existing') then
      if p_dry_run then
        v_status := 'ok';
      else
        insert into public.athlete_invites (tenant_id, team_id, email, invitee_name, invited_by_user_id, status, expires_at)
        values (v_tenant_id, p_team_id, v_email, v_name, auth.uid(), 'pending', now() + make_interval(days => v_days))
        returning id into v_invite_id;
        v_created := v_created + 1;
        v_status := 'created';
      end if;
    end if;

    line_no := v_index;
    email := left(v_email, 254);
    status := v_status;
    invite_id := v_invite_id;
    return next;
  end loop;

  if not p_dry_run then
    perform set_config('sktr.suppress_invite_created_notice', '', true);
    if v_created > 0 then
      insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
      values (
        v_tenant_id,
        auth.uid(),
        public.current_app_role(),
        'athlete_invites_bulk_created',
        coalesce(v_team_name, p_team_id::text),
        format('%s athlete invites created for team %s, valid for %s days', v_created, p_team_id::text, v_days)
      );
    end if;
  end if;
end;
$$;

revoke all on function public.process_athlete_invites(uuid, jsonb, integer, boolean) from public, anon, authenticated;

-- The preview table of "Add athletes, many at once". Changes nothing.
create or replace function public.preview_athlete_invites(p_team_id uuid, p_entries jsonb)
returns table (line_no integer, email text, status text)
language sql
security definer
set search_path = public
as $$
  select r.line_no, r.email, r.status
  from public.process_athlete_invites(p_team_id, p_entries, 7, true) r
$$;

-- Creates the invites that can be created and reports every line. Emails are sent afterwards by
-- the send-invite-email function, one invite id at a time, with its own checks.
create or replace function public.create_athlete_invites(
  p_team_id uuid,
  p_entries jsonb,
  p_expires_in_days integer default 7
)
returns table (line_no integer, email text, status text, invite_id uuid)
language sql
security definer
set search_path = public
as $$
  select r.line_no, r.email, r.status, r.invite_id
  from public.process_athlete_invites(p_team_id, p_entries, p_expires_in_days, false) r
$$;

revoke all on function public.preview_athlete_invites(uuid, jsonb) from public, anon;
revoke all on function public.create_athlete_invites(uuid, jsonb, integer) from public, anon;
grant execute on function public.preview_athlete_invites(uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_athlete_invites(uuid, jsonb, integer) to authenticated, service_role;

-- 5. Managed athletes (no login) --------------------------------------------------------------

-- Tidy a name typed by staff: one line, no control characters.
create or replace function public.roster_clean_name(p_value text, p_max integer)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(left(btrim(regexp_replace(coalesce(p_value, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), p_max), '')
$$;

revoke all on function public.roster_clean_name(text, integer) from public, anon, authenticated;

-- Guardian contact of a managed athlete, written by staff. Internal: the two functions below
-- call it after their own permission checks. Only the three guardian fields are touched.
create or replace function public.save_managed_athlete_guardian(
  p_athlete_id uuid,
  p_tenant_id uuid,
  p_guardian_name text,
  p_guardian_phone text,
  p_guardian_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := public.roster_clean_name(p_guardian_name, 120);
  v_phone text := nullif(btrim(coalesce(p_guardian_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_guardian_email, ''))), '');
begin
  if v_phone is not null and not public.contact_phone_is_valid(v_phone) then
    raise exception 'Enter the guardian''s phone number with digits, spaces, + or -.' using errcode = '23514';
  end if;
  if v_email is not null and not public.contact_email_is_valid(v_email) then
    raise exception 'Enter a valid guardian email address.' using errcode = '23514';
  end if;

  if v_name is null and v_phone is null and v_email is null
     and not exists (select 1 from public.athlete_private_details d where d.athlete_id = p_athlete_id) then
    return;
  end if;

  insert into public.athlete_private_details (athlete_id, tenant_id, guardian_name, guardian_phone, guardian_email, updated_by_user_id)
  values (p_athlete_id, p_tenant_id, v_name, v_phone, v_email, auth.uid())
  on conflict (athlete_id) do update
  set guardian_name = excluded.guardian_name,
      guardian_phone = excluded.guardian_phone,
      guardian_email = excluded.guardian_email,
      updated_by_user_id = excluded.updated_by_user_id;
end;
$$;

revoke all on function public.save_managed_athlete_guardian(uuid, uuid, text, text, text) from public, anon, authenticated;

-- Adds an athlete who has no login. Coach of the team or club admin. Takes a seat.
create or replace function public.create_managed_athlete(
  p_team_id uuid,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date default null,
  p_event_group text default null,
  p_primary_event text default null,
  p_guardian_name text default null,
  p_guardian_phone text default null,
  p_guardian_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_first text := public.roster_clean_name(p_first_name, 60);
  v_last text := public.roster_clean_name(p_last_name, 60);
  v_group text := nullif(btrim(coalesce(p_event_group, '')), '');
  v_event text := public.roster_clean_name(p_primary_event, 60);
  v_limit integer;
  v_id uuid;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_team_id is null or not public.can_manage_team(p_team_id) then
    raise exception 'You can only add athletes to a team you coach.' using errcode = '42501';
  end if;

  select t.tenant_id into v_tenant_id
  from public.teams t
  where t.id = p_team_id
    and t.tenant_id = public.current_tenant_id()
    and t.status = 'active'
    and not t.is_archived;
  if v_tenant_id is null then
    raise exception 'Team not found.' using errcode = '42501';
  end if;

  if v_first is null or v_last is null then
    raise exception 'Enter the athlete''s first and last name.' using errcode = '23514';
  end if;
  if p_date_of_birth is not null and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then
    raise exception 'Enter a date of birth in the past.' using errcode = '23514';
  end if;
  if v_group is not null and v_group not in ('Sprint', 'Mid', 'Distance', 'Jumps', 'Throws') then
    raise exception 'Choose one of the event groups.' using errcode = '23514';
  end if;

  perform public.lock_tenant_athlete_seats(v_tenant_id);
  v_limit := public.tenant_athlete_limit(v_tenant_id);
  if v_limit is not null and public.tenant_athlete_seats_used(v_tenant_id) >= v_limit then
    raise exception 'Your club has reached the athlete limit of its package (%). Ask a club admin to upgrade before adding more athletes.', v_limit
      using errcode = '23514', hint = 'athlete_limit';
  end if;

  insert into public.athletes (
    tenant_id, user_id, team_id, first_name, last_name, date_of_birth, event_group, primary_event,
    readiness, is_active, created_by_user_id
  )
  values (
    v_tenant_id, null, p_team_id, v_first, v_last, p_date_of_birth, v_group, v_event,
    null, true, auth.uid()
  )
  returning id into v_id;

  perform public.save_managed_athlete_guardian(v_id, v_tenant_id, p_guardian_name, p_guardian_phone, p_guardian_email);

  -- Names of children stay out of the audit log: the athlete id is enough to find the row.
  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_tenant_id, auth.uid(), public.current_app_role(), 'managed_athlete_created', v_id::text,
          'athlete without a login added to team ' || p_team_id::text);

  return v_id;
end;
$$;

-- Edits a managed athlete. Refused once the athlete has a login: from then on the athlete keeps
-- their own details (update_current_athlete_profile, update_current_athlete_private_details).
create or replace function public.update_managed_athlete(
  p_athlete_id uuid,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date default null,
  p_event_group text default null,
  p_primary_event text default null,
  p_guardian_name text default null,
  p_guardian_phone text default null,
  p_guardian_email text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete public.athletes%rowtype;
  v_first text := public.roster_clean_name(p_first_name, 60);
  v_last text := public.roster_clean_name(p_last_name, 60);
  v_group text := nullif(btrim(coalesce(p_event_group, '')), '');
  v_event text := public.roster_clean_name(p_primary_event, 60);
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_athlete_id is null or not public.can_manage_athlete(p_athlete_id) then
    raise exception 'You can only edit athletes on your own teams.' using errcode = '42501';
  end if;

  select * into v_athlete
  from public.athletes a
  where a.id = p_athlete_id
    and a.tenant_id = public.current_tenant_id()
  for update;
  if not found then
    raise exception 'Athlete not found.' using errcode = '42501';
  end if;
  if v_athlete.user_id is not null then
    raise exception 'This athlete has their own login now and keeps their own details.' using errcode = '42501';
  end if;

  if v_first is null or v_last is null then
    raise exception 'Enter the athlete''s first and last name.' using errcode = '23514';
  end if;
  if p_date_of_birth is not null and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then
    raise exception 'Enter a date of birth in the past.' using errcode = '23514';
  end if;
  if v_group is not null and v_group not in ('Sprint', 'Mid', 'Distance', 'Jumps', 'Throws') then
    raise exception 'Choose one of the event groups.' using errcode = '23514';
  end if;

  update public.athletes
  set first_name = v_first,
      last_name = v_last,
      date_of_birth = p_date_of_birth,
      event_group = v_group,
      primary_event = v_event,
      updated_at = now()
  where id = v_athlete.id;

  perform public.save_managed_athlete_guardian(v_athlete.id, v_athlete.tenant_id, p_guardian_name, p_guardian_phone, p_guardian_email);

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_athlete.tenant_id, auth.uid(), public.current_app_role(), 'managed_athlete_updated', v_athlete.id::text,
          'details of an athlete without a login changed');
end;
$$;

-- Removes a managed athlete from the club. Nothing is deleted: the row is switched off and taken
-- off its team, which frees the seat and keeps every session and result. Pending "give them a
-- login" invites for the athlete stop working. Returns false when nothing was changed.
create or replace function public.remove_managed_athlete(p_athlete_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete public.athletes%rowtype;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_athlete_id is null or not public.can_manage_athlete(p_athlete_id) then
    return false;
  end if;

  select * into v_athlete
  from public.athletes a
  where a.id = p_athlete_id
    and a.tenant_id = public.current_tenant_id()
  for update;
  if not found or not v_athlete.is_active then
    return false;
  end if;
  if v_athlete.user_id is not null then
    raise exception 'This athlete has their own login. Remove them from the team instead.' using errcode = '42501';
  end if;

  update public.athletes
  set is_active = false,
      team_id = null,
      updated_at = now()
  where id = v_athlete.id;

  update public.athlete_invites
  set status = 'revoked',
      updated_at = now()
  where athlete_id = v_athlete.id
    and status = 'pending';

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_athlete.tenant_id, auth.uid(), public.current_app_role(), 'managed_athlete_removed', v_athlete.id::text,
          'athlete without a login removed from the club, history kept');

  return true;
end;
$$;

-- "Give them a login": an invite addressed to p_email that, when accepted, links the new account
-- to this managed athlete (accept_athlete_invite, section 7). Takes no new seat.
-- An email that already belongs to a member of THIS club is refused (an athlete of the club has
-- a record of their own already; two records are not merged). Nothing is said about accounts of
-- other clubs: such an invite simply cannot be accepted.
create or replace function public.create_athlete_login_invite(
  p_athlete_id uuid,
  p_email text,
  p_expires_in_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete public.athletes%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_days integer := greatest(1, least(coalesce(p_expires_in_days, 7), 30));
  v_invite_id uuid;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_athlete_id is null or not public.can_manage_athlete(p_athlete_id) then
    raise exception 'You can only do this for athletes on your own teams.' using errcode = '42501';
  end if;

  select * into v_athlete
  from public.athletes a
  where a.id = p_athlete_id
    and a.tenant_id = public.current_tenant_id()
  for update;
  if not found or not v_athlete.is_active then
    raise exception 'Athlete not found.' using errcode = '42501';
  end if;
  if v_athlete.user_id is not null then
    raise exception 'This athlete already has a login.' using errcode = '23514';
  end if;
  if v_athlete.team_id is null then
    raise exception 'Put the athlete on a team first.' using errcode = '23514';
  end if;

  if v_email = '' or not public.contact_email_is_valid(v_email) or v_email ~ '[<>"'',;\s]' then
    raise exception 'Enter a valid email address.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from auth.users au
    join public.profiles p on p.user_id = au.id
    where lower(btrim(au.email)) = v_email
      and p.tenant_id = v_athlete.tenant_id
  ) then
    raise exception 'This email already belongs to someone in your club. Use an email address that has no SKTR Coach account yet.'
      using errcode = '23514';
  end if;

  -- One live login invite per athlete.
  update public.athlete_invites
  set status = 'revoked',
      updated_at = now()
  where athlete_id = v_athlete.id
    and status = 'pending';

  insert into public.athlete_invites (tenant_id, team_id, email, invitee_name, athlete_id, invited_by_user_id, status, expires_at)
  values (
    v_athlete.tenant_id, v_athlete.team_id, v_email,
    public.roster_clean_name(v_athlete.first_name || ' ' || v_athlete.last_name, 120),
    v_athlete.id, auth.uid(), 'pending', now() + make_interval(days => v_days)
  )
  returning id into v_invite_id;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_athlete.tenant_id, auth.uid(), public.current_app_role(), 'managed_athlete_login_invited', v_athlete.id::text,
          'login invite ' || v_invite_id::text || ' created for an athlete without a login');

  return v_invite_id;
end;
$$;

revoke all on function public.create_managed_athlete(uuid, text, text, date, text, text, text, text, text) from public, anon;
revoke all on function public.update_managed_athlete(uuid, text, text, date, text, text, text, text, text) from public, anon;
revoke all on function public.remove_managed_athlete(uuid) from public, anon;
revoke all on function public.create_athlete_login_invite(uuid, text, integer) from public, anon;
grant execute on function public.create_managed_athlete(uuid, text, text, date, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.update_managed_athlete(uuid, text, text, date, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.remove_managed_athlete(uuid) to authenticated, service_role;
grant execute on function public.create_athlete_login_invite(uuid, text, integer) to authenticated, service_role;

-- Staff already write sessions, completions, wellness, results and availability for the athletes
-- they manage (20261006120000, 20261008090000, 20261008100000). The one table they could only
-- read is session_row_logs (the sets). This lets staff log sets FOR an athlete who has no login,
-- which is what "log a session for them" needs. Athletes with a login keep logging their own.
drop policy if exists session_row_logs_staff_write_managed on public.session_row_logs;
create policy session_row_logs_staff_write_managed
on public.session_row_logs
for all
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  and exists (
    select 1
    from public.athletes a
    where a.id = session_row_logs.athlete_id
      and a.user_id is null
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
  and exists (
    select 1
    from public.athletes a
    where a.id = session_row_logs.athlete_id
      and a.user_id is null
  )
  and exists (
    select 1
    from public.session_block_rows r
    join public.session_blocks sb on sb.id = r.session_block_id
    join public.sessions s on s.id = sb.session_id
    where r.id = session_row_logs.session_block_row_id
      and s.id = session_row_logs.session_id
      and s.athlete_id = session_row_logs.athlete_id
      and s.tenant_id = public.current_tenant_id()
  )
);

-- 6. Team join codes --------------------------------------------------------------------------

create table if not exists public.team_join_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete cascade,
  -- 32 hex characters from gen_random_uuid(): 122 random bits from the server's secure generator.
  code text not null check (code ~ '^[0-9a-f]{32}$'),
  expires_at timestamptz not null,
  max_uses integer not null check (max_uses between 1 and 500),
  use_count integer not null default 0 check (use_count >= 0),
  disabled_at timestamptz,
  disabled_by_user_id uuid references auth.users(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.team_join_codes is
  'Open join codes for a team (QR code at practice). Written only by create_team_join_code(), disable_team_join_code() and join_team_with_code(). The code is a secret: readable by the team''s coaches and club admins only.';

create unique index if not exists team_join_codes_code_uniq
on public.team_join_codes (code);

-- At most one code per team is live. create_team_join_code() turns the previous one off first.
create unique index if not exists team_join_codes_one_live_per_team
on public.team_join_codes (team_id)
where disabled_at is null;

create index if not exists team_join_codes_tenant_idx
on public.team_join_codes (tenant_id, created_at desc);

create table if not exists public.team_join_code_uses (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.team_join_codes(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete cascade,
  athlete_id uuid references public.athletes(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  -- new_athlete: the account had no profile and got an athlete profile. existing_athlete: an
  -- athlete of the club who was on no team.
  outcome text not null check (outcome in ('new_athlete', 'existing_athlete')),
  joined_at timestamptz not null default now()
);

comment on table public.team_join_code_uses is
  'One row per join through a team join code: who, when, and whether an account was created. Written only by join_team_with_code().';

create index if not exists team_join_code_uses_code_idx
on public.team_join_code_uses (code_id, joined_at desc);

create index if not exists team_join_code_uses_team_idx
on public.team_join_code_uses (team_id, joined_at desc);

alter table public.team_join_codes enable row level security;
alter table public.team_join_code_uses enable row level security;

drop policy if exists team_join_codes_select_team_staff on public.team_join_codes;
create policy team_join_codes_select_team_staff
on public.team_join_codes
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
);

drop policy if exists team_join_code_uses_select_team_staff on public.team_join_code_uses;
create policy team_join_code_uses_select_team_staff
on public.team_join_code_uses
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or team_id = any ((select public.current_coach_team_ids())::uuid[]))
);

-- Read only for signed-in API roles, nothing at all for anon. Every write is a function below.
revoke all on public.team_join_codes from public, anon, authenticated;
revoke all on public.team_join_code_uses from public, anon, authenticated;
grant select on public.team_join_codes to authenticated;
grant select on public.team_join_code_uses to authenticated;
grant all on public.team_join_codes to service_role;
grant all on public.team_join_code_uses to service_role;

-- Creates the join code of a team and turns off the one before it. Coach of the team or club
-- admin. p_expires_in_days is 1, 7 or 30. p_max_uses defaults to the athlete seats the club has
-- left (100 when the package has no limit) and is never more than 500.
create or replace function public.create_team_join_code(
  p_team_id uuid,
  p_expires_in_days integer default 7,
  p_max_uses integer default null
)
returns table (
  id uuid,
  team_id uuid,
  code text,
  expires_at timestamptz,
  max_uses integer,
  use_count integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_team_name text;
  v_days integer := coalesce(p_expires_in_days, 7);
  v_limit integer;
  v_seats_left integer;
  v_max integer;
  v_row public.team_join_codes%rowtype;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_team_id is null or not public.can_manage_team(p_team_id) then
    raise exception 'You can only create a join code for a team you coach.' using errcode = '42501';
  end if;
  if v_days not in (1, 7, 30) then
    raise exception 'A join code lasts 1, 7 or 30 days.' using errcode = '22023';
  end if;

  select t.tenant_id, t.name into v_tenant_id, v_team_name
  from public.teams t
  where t.id = p_team_id
    and t.tenant_id = public.current_tenant_id()
    and t.status = 'active'
    and not t.is_archived;
  if v_tenant_id is null then
    raise exception 'Team not found.' using errcode = '42501';
  end if;

  perform public.lock_tenant_athlete_seats(v_tenant_id);
  v_limit := public.tenant_athlete_limit(v_tenant_id);
  if v_limit is not null then
    v_seats_left := greatest(
      v_limit - public.tenant_athlete_seats_used(v_tenant_id) - public.tenant_pending_athlete_invite_seats(v_tenant_id),
      0
    );
    if v_seats_left = 0 and p_max_uses is null then
      raise exception 'Your club has no athlete seats left in its package (%). Ask a club admin to upgrade before sharing a join code.', v_limit
        using errcode = '23514', hint = 'athlete_limit';
    end if;
  end if;

  v_max := coalesce(p_max_uses, v_seats_left, 100);
  if v_max < 1 or v_max > 500 then
    raise exception 'A join code can be used between 1 and 500 times.' using errcode = '22023';
  end if;

  update public.team_join_codes c
  set disabled_at = now(),
      disabled_by_user_id = auth.uid()
  where c.team_id = p_team_id
    and c.disabled_at is null;

  insert into public.team_join_codes (tenant_id, team_id, code, expires_at, max_uses, created_by_user_id)
  values (
    v_tenant_id, p_team_id, replace(gen_random_uuid()::text, '-', ''),
    now() + make_interval(days => v_days), v_max, auth.uid()
  )
  returning * into v_row;

  -- The code itself never goes into the audit log.
  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_tenant_id, auth.uid(), public.current_app_role(), 'team_join_code_created', coalesce(v_team_name, p_team_id::text),
          format('join code %s for team %s, valid %s days, up to %s uses', v_row.id::text, p_team_id::text, v_days, v_max));

  return query select v_row.id, v_row.team_id, v_row.code, v_row.expires_at, v_row.max_uses, v_row.use_count;
end;
$$;

-- Turns a join code off at once. Returns false when there was nothing to turn off.
create or replace function public.disable_team_join_code(p_code_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.team_join_codes%rowtype;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_row
  from public.team_join_codes c
  where c.id = p_code_id
    and c.tenant_id = public.current_tenant_id()
  for update;

  if not found or not public.can_manage_team(v_row.team_id) or v_row.disabled_at is not null then
    return false;
  end if;

  update public.team_join_codes
  set disabled_at = now(),
      disabled_by_user_id = auth.uid()
  where id = v_row.id;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_row.tenant_id, auth.uid(), public.current_app_role(), 'team_join_code_disabled', v_row.team_id::text,
          format('join code %s turned off after %s of %s uses', v_row.id::text, v_row.use_count, v_row.max_uses));

  return true;
end;
$$;

revoke all on function public.create_team_join_code(uuid, integer, integer) from public, anon;
revoke all on function public.disable_team_join_code(uuid) from public, anon;
grant execute on function public.create_team_join_code(uuid, integer, integer) to authenticated, service_role;
grant execute on function public.disable_team_join_code(uuid) to authenticated, service_role;

-- Wrong guesses are counted in request_form_attempts (20261006181000), which holds salted hashes
-- only and is closed to every API role. Internal.
--   form 'join_code_lookup'  one row per wrong code looked up on the public page, by network address
--   form 'join_code_use'     one row per wrong code a signed-in account tried to join with
create or replace function public.join_code_note_wrong_guess(p_form text, p_subject_hash text, p_ip_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.request_form_attempts a
  where a.form in ('join_code_lookup', 'join_code_use')
    and a.created_at < now() - interval '1 day';

  insert into public.request_form_attempts (form, email_hash, ip_hash)
  values (p_form, p_subject_hash, p_ip_hash);
end;
$$;

revoke all on function public.join_code_note_wrong_guess(text, text, text) from public, anon, authenticated;

create index if not exists request_form_attempts_ip_idx
on public.request_form_attempts (form, ip_hash, created_at desc);

create index if not exists request_form_attempts_subject_idx
on public.request_form_attempts (form, email_hash, created_at desc);

-- What the public join page shows for a code. Callable signed out.
-- ALWAYS returns exactly one row with the same columns. The team and club names are filled in only
-- for a code that can be used right now; for every other answer they are NULL:
--   active        a code that works: team, club and event group are returned
--   expired, disabled, full, unavailable   a real code that cannot be used (unavailable: the club
--                 is paused or the team is archived). No names.
--   invalid       no such code. No names. Indistinguishable from any other wrong string.
--   rate_limited  too many wrong codes from this network address (20 in 10 minutes) or in total
--                 (2,000 an hour). Nothing is looked up, so a right code gets this answer too.
create or replace function public.get_public_team_join_code(p_code text)
returns table (
  status text,
  team_name text,
  organization_name text,
  event_group text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_ip_hash text := public.request_form_ip_hash();
  v_row public.team_join_codes%rowtype;
  v_team public.teams%rowtype;
  v_org text;
begin
  if (v_ip_hash is not null and (
        select count(*) from public.request_form_attempts a
        where a.form = 'join_code_lookup' and a.ip_hash = v_ip_hash and a.created_at > now() - interval '10 minutes'
      ) >= 20)
     or (
        select count(*) from public.request_form_attempts a
        where a.form = 'join_code_lookup' and a.created_at > now() - interval '1 hour'
      ) >= 2000 then
    return query select 'rate_limited'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_code ~ '^[0-9a-f]{32}$' then
    select * into v_row from public.team_join_codes c where c.code = v_code;
  end if;

  if v_row.id is null then
    perform public.join_code_note_wrong_guess('join_code_lookup', null, v_ip_hash);
    return query select 'invalid'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_row.disabled_at is not null then
    return query select 'disabled'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if v_row.expires_at < now() then
    return query select 'expired'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if v_row.use_count >= v_row.max_uses then
    return query select 'full'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select * into v_team from public.teams t where t.id = v_row.team_id;
  if v_team.id is null or v_team.status <> 'active' or v_team.is_archived
     or public.tenant_access_blocked(v_row.tenant_id) then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select tn.name into v_org from public.tenants tn where tn.id = v_row.tenant_id;

  return query select 'active'::text, v_team.name, v_org, v_team.event_group, v_row.expires_at;
end;
$$;

revoke all on function public.get_public_team_join_code(text) from public;
grant execute on function public.get_public_team_join_code(text) to anon, authenticated, service_role;

-- Joins the team a code belongs to. See "THE RULE THAT MUST NOT BREAK" at the top of this file.
-- ALWAYS returns exactly one row. status is one of:
--   joined             the caller is now an athlete on the team (athlete_id, team_id filled in)
--   already_member     the caller was on this team already; nothing changed, no use was counted
--   invalid            no such code
--   expired, disabled, full, unavailable   a real code that cannot be used
--   unconfirmed_email  the account's email address is not confirmed yet
--   not_athlete        the caller is a coach or club admin (their role is never changed)
--   wrong_club         the caller belongs to another club
--   other_team         the caller is an athlete on another team of this club (staff move athletes)
--   inactive_athlete   the caller's athlete record was switched off
--   has_other_access   the email is a platform admin's or the requestor of an approved club request
--   club_full          the club has no athlete seat left
--   rate_limited       10 wrong codes from this account in an hour
-- RAISES the access_paused error (20261006180000) for a deactivated member and for a paused club,
-- so the app shows the same "access paused" page as everywhere else.
create or replace function public.join_team_with_code(p_code text)
returns table (
  status text,
  team_id uuid,
  team_name text,
  athlete_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_subject_hash text;
  v_email text;
  v_meta_name text;
  v_row public.team_join_codes%rowtype;
  v_team public.teams%rowtype;
  v_profile public.profiles%rowtype;
  v_has_profile boolean;
  v_athlete public.athletes%rowtype;
  v_has_athlete boolean := false;
  v_outcome text;
  v_display_name text;
  v_first_name text;
  v_last_name text;
  v_limit integer;
  v_coach uuid;
  v_athlete_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_subject_hash := encode(sha256(convert_to('join_code_use:' || v_user_id::text, 'UTF8')), 'hex');

  if (
    select count(*) from public.request_form_attempts a
    where a.form = 'join_code_use' and a.email_hash = v_subject_hash and a.created_at > now() - interval '1 hour'
  ) >= 10 then
    return query select 'rate_limited'::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  if v_code ~ '^[0-9a-f]{32}$' then
    select * into v_row from public.team_join_codes c where c.code = v_code for update;
  end if;

  if v_row.id is null then
    perform public.join_code_note_wrong_guess('join_code_use', v_subject_hash, public.request_form_ip_hash());
    return query select 'invalid'::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  -- Only a confirmed address proves who the caller is. Read from auth.users, never from the token.
  select
    lower(btrim(coalesce(au.email, ''))),
    nullif(btrim(coalesce(
      au.raw_user_meta_data ->> 'display_name',
      au.raw_user_meta_data ->> 'full_name',
      au.raw_user_meta_data ->> 'name',
      ''
    )), '')
  into v_email, v_meta_name
  from auth.users au
  where au.id = v_user_id
    and au.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    return query select 'unconfirmed_email'::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  select * into v_profile from public.profiles p where p.user_id = v_user_id limit 1;
  v_has_profile := found;

  -- Lifecycle guard, as in accept_athlete_invite: nobody enters a paused club, and a deactivated
  -- member cannot switch themselves back on.
  if public.tenant_access_blocked(v_row.tenant_id) or (v_has_profile and not v_profile.is_active) then
    perform public.raise_access_paused();
  end if;

  if v_has_profile then
    if v_profile.tenant_id <> v_row.tenant_id then
      return query select 'wrong_club'::text, null::uuid, null::text, null::uuid;
      return;
    end if;
    if v_profile.role <> 'athlete' then
      return query select 'not_athlete'::text, null::uuid, null::text, null::uuid;
      return;
    end if;

    select * into v_athlete
    from public.athletes a
    where a.user_id = v_user_id
      and a.tenant_id = v_profile.tenant_id
    limit 1
    for update;
    v_has_athlete := found;

    if v_has_athlete and not v_athlete.is_active then
      return query select 'inactive_athlete'::text, null::uuid, null::text, null::uuid;
      return;
    end if;
  end if;

  select * into v_team from public.teams t where t.id = v_row.team_id;

  if v_has_athlete and v_athlete.team_id = v_row.team_id then
    return query select 'already_member'::text, v_row.team_id, v_team.name, v_athlete.id;
    return;
  end if;
  if v_has_athlete and v_athlete.team_id is not null then
    return query select 'other_team'::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  if v_row.disabled_at is not null then
    return query select 'disabled'::text, null::uuid, null::text, null::uuid;
    return;
  end if;
  if v_row.expires_at < now() then
    return query select 'expired'::text, null::uuid, null::text, null::uuid;
    return;
  end if;
  if v_row.use_count >= v_row.max_uses then
    return query select 'full'::text, null::uuid, null::text, null::uuid;
    return;
  end if;
  if v_team.id is null or v_team.status <> 'active' or v_team.is_archived then
    return query select 'unavailable'::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  if not v_has_profile then
    -- Access that is granted by email alone elsewhere must not get an athlete profile on top.
    if exists (select 1 from public.platform_admin_contacts pac where lower(btrim(pac.email)) = v_email)
       or exists (
         select 1 from public.tenant_provision_requests r
         where lower(btrim(r.requestor_email)) = v_email and r.status = 'approved'
       ) then
      return query select 'has_other_access'::text, null::uuid, null::text, null::uuid;
      return;
    end if;
  end if;

  if not v_has_athlete then
    -- A new athletes row takes a seat.
    perform public.lock_tenant_athlete_seats(v_row.tenant_id);
    v_limit := public.tenant_athlete_limit(v_row.tenant_id);
    if v_limit is not null and public.tenant_athlete_seats_used(v_row.tenant_id) >= v_limit then
      return query select 'club_full'::text, null::uuid, null::text, null::uuid;
      return;
    end if;
  end if;

  if not v_has_profile then
    -- THE ONLY PROFILE THIS FUNCTION CAN CREATE: an athlete of the code's club.
    insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
    values (v_user_id, v_row.tenant_id, 'athlete', v_meta_name, true)
    returning * into v_profile;
    v_outcome := 'new_athlete';
  else
    v_outcome := 'existing_athlete';
  end if;

  if not v_has_athlete then
    v_display_name := coalesce(nullif(btrim(coalesce(v_profile.display_name, '')), ''), v_meta_name, 'Athlete User');
    v_first_name := split_part(v_display_name, ' ', 1);
    v_last_name := nullif(btrim(substr(v_display_name, length(v_first_name) + 1)), '');
    if v_last_name is null then
      v_last_name := 'Athlete';
    end if;

    insert into public.athletes (tenant_id, user_id, team_id, first_name, last_name, readiness, is_active)
    values (v_row.tenant_id, v_user_id, v_row.team_id, v_first_name, v_last_name, 'yellow', true)
    returning * into v_athlete;
  else
    -- An athlete of the club who was on no team. The team change is their own action, so the
    -- "you were added to a team" trigger tells them nothing (enqueue_notification skips the actor).
    update public.athletes
    set team_id = v_row.team_id,
        updated_at = now()
    where id = v_athlete.id;
  end if;

  update public.team_join_codes
  set use_count = use_count + 1
  where id = v_row.id;

  insert into public.team_join_code_uses (code_id, tenant_id, team_id, athlete_id, user_id, outcome)
  values (v_row.id, v_row.tenant_id, v_row.team_id, v_athlete.id, v_user_id, v_outcome);

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_row.tenant_id, v_user_id, 'athlete', 'team_join_code_used', v_email,
          format('joined team %s with join code %s (%s)', v_row.team_id::text, v_row.id::text, v_outcome));

  v_athlete_name := public.notification_athlete_name(v_athlete.id);
  for v_coach in select public.notification_team_coach_user_ids(v_row.team_id)
  loop
    perform public.enqueue_notification(
      v_row.tenant_id,
      v_coach,
      'athlete_joined_team',
      format('%s joined %s', v_athlete_name, coalesce(v_team.name, 'your team')),
      'They used the team join code.',
      jsonb_build_object('team_id', v_row.team_id::text, 'athlete_id', v_athlete.id::text),
      array['in-app'],
      'athlete_joined:' || v_athlete.id::text || ':' || v_row.team_id::text,
      interval '10 minutes'
    );
  end loop;

  return query select 'joined'::text, v_row.team_id, v_team.name, v_athlete.id;
end;
$$;

revoke all on function public.join_team_with_code(text) from public, anon;
grant execute on function public.join_team_with_code(text) to authenticated, service_role;

-- 7. Accepting an invite: link a managed athlete, keep the typed name ----------------------------
-- Latest definition (20261007100000) with two additions, marked NEW. Error texts already in use
-- are unchanged; the screens match on them.
create or replace function public.accept_athlete_invite(
  p_invite_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_has_profile boolean;
  v_invite public.athlete_invites%rowtype;
  v_athlete public.athletes%rowtype;
  v_managed public.athletes%rowtype;
  v_user_email text;
  v_invite_email text;
  v_meta_name text;
  v_display_name text;
  v_first_name text;
  v_last_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    lower(btrim(coalesce(au.email, ''))),
    nullif(
      btrim(
        coalesce(
          au.raw_user_meta_data ->> 'display_name',
          au.raw_user_meta_data ->> 'full_name',
          au.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      ''
    )
  into v_user_email, v_meta_name
  from auth.users au
  where au.id = v_user_id
    and au.email_confirmed_at is not null;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  v_has_profile := found;

  if v_has_profile and v_profile.role <> 'athlete' then
    raise exception 'Only athlete users can accept athlete invites';
  end if;

  select *
  into v_invite
  from public.athlete_invites ai
  where ai.id = p_invite_id
  limit 1
  for update;

  if not found then
    raise exception 'Invite not found';
  end if;

  -- Lifecycle guard (20261006180000). An invite of a suspended or cancelled club
  -- cannot be accepted by anyone, new or existing. A deactivated athlete cannot use
  -- any invite (a team join code included) to move team or switch themselves back
  -- on: only the club admin restores an athlete.
  if public.tenant_access_blocked(v_invite.tenant_id)
     or (v_has_profile and not v_profile.is_active) then
    perform public.raise_access_paused();
  end if;

  v_invite_email := nullif(lower(btrim(coalesce(v_invite.email, ''))), '');

  if not v_has_profile and v_invite_email is null then
    -- A join code is not addressed to anyone, so it cannot create an account.
    raise exception 'Profile not found';
  end if;

  if v_has_profile and v_invite.tenant_id <> v_profile.tenant_id then
    raise exception 'Invite does not belong to your tenant';
  end if;

  if v_invite.status = 'accepted' and v_invite.accepted_by_user_id = v_user_id and v_has_profile then
    return v_invite.team_id;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'Invite is not pending';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Invite has expired';
  end if;

  if v_invite_email is not null and v_invite_email <> coalesce(v_user_email, '') then
    raise exception 'This invite is for a different email address';
  end if;

  -- NEW: "give them a login". The invite points at a managed athlete: link the caller to that
  -- row, with all its history, instead of creating a second one.
  if v_invite.athlete_id is not null then
    if v_invite_email is null then
      -- A login invite is always addressed. One that is not was not made by the function.
      raise exception 'Invite not found';
    end if;

    select *
    into v_managed
    from public.athletes a
    where a.id = v_invite.athlete_id
    for update;

    -- Still the same managed athlete, on the team the invite was made for.
    if not found
       or v_managed.tenant_id <> v_invite.tenant_id
       or v_managed.user_id is not null
       or not v_managed.is_active
       or v_managed.team_id is distinct from v_invite.team_id then
      raise exception 'Invite is not pending';
    end if;

    if exists (
      select 1
      from public.athletes a
      where a.user_id = v_user_id
        and a.tenant_id = v_invite.tenant_id
    ) then
      raise exception 'Your account already has an athlete record in this club. Ask your coach for help.';
    end if;

    if not v_has_profile then
      insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
      values (
        v_user_id,
        v_invite.tenant_id,
        'athlete',
        coalesce(v_meta_name, nullif(btrim(v_managed.first_name || ' ' || v_managed.last_name), '')),
        true
      )
      returning *
      into v_profile;
    end if;

    update public.athletes
    set user_id = v_user_id,
        login_linked_at = now(),
        updated_at = now()
    where id = v_managed.id;

    update public.athlete_invites
    set status = 'accepted',
        accepted_by_user_id = v_user_id,
        accepted_at = now(),
        updated_at = now()
    where id = v_invite.id;

    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (
      v_invite.tenant_id,
      v_user_id,
      'athlete',
      'managed_athlete_login_linked',
      v_managed.id::text,
      'login linked to an existing athlete record through invite ' || v_invite.id::text
    );

    return v_invite.team_id;
  end if;

  if not v_has_profile then
    insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
    -- NEW: the name the coach typed on the invite, when the account brings none.
    values (v_user_id, v_invite.tenant_id, 'athlete', coalesce(v_meta_name, nullif(btrim(coalesce(v_invite.invitee_name, '')), '')), true)
    returning *
    into v_profile;
  end if;

  select *
  into v_athlete
  from public.athletes a
  where a.user_id = v_user_id
    and a.tenant_id = v_profile.tenant_id
  limit 1;

  if not found then
    v_display_name := coalesce(nullif(btrim(coalesce(v_profile.display_name, '')), ''), v_meta_name, 'Athlete User');

    v_first_name := split_part(v_display_name, ' ', 1);
    v_last_name := nullif(btrim(substr(v_display_name, length(v_first_name) + 1)), '');
    if v_last_name is null then
      v_last_name := 'Athlete';
    end if;

    insert into public.athletes (
      tenant_id,
      user_id,
      team_id,
      first_name,
      last_name,
      event_group,
      primary_event,
      readiness,
      is_active
    )
    values (
      v_profile.tenant_id,
      v_user_id,
      v_invite.team_id,
      v_first_name,
      v_last_name,
      null,
      null,
      'yellow',
      true
    )
    returning *
    into v_athlete;
  end if;

  update public.athletes
  set team_id = v_invite.team_id,
      is_active = true,
      updated_at = now()
  where id = v_athlete.id;

  update public.athlete_invites
  set status = 'accepted',
      accepted_by_user_id = v_user_id,
      accepted_at = now(),
      updated_at = now()
  where id = v_invite.id;

  insert into public.audit_events (
    tenant_id,
    actor_user_id,
    actor_role,
    action,
    target,
    detail
  )
  values (
    v_invite.tenant_id,
    v_user_id,
    'athlete',
    'athlete_invite_accept',
    coalesce(nullif(v_user_email, ''), v_user_id::text),
    'joined team ' || v_invite.team_id::text
  );

  return v_invite.team_id;
end;
$$;

revoke all on function public.accept_athlete_invite(uuid) from public, anon;
grant execute on function public.accept_athlete_invite(uuid) to authenticated, service_role;

-- 8. Moving an athlete between teams -------------------------------------------------------------
-- Who: a club admin, for any active athlete of the club (an athlete on no team included); a coach,
-- only when they coach BOTH the team the athlete is on and the team the athlete goes to.
-- What moves: nothing has to. Sessions, results, wellness and availability hang on the athlete,
-- and the row policies follow the athlete's current team (20261006120000), so the new team's
-- coaches see the history and the old team's coaches no longer do.
-- Sessions: upcoming sessions of the OLD team's plans that the athlete has not touched are
-- removed. Sessions from a plan assigned to the athlete personally stay. The new team's plan
-- sessions are created by the app right after this call (and, for an athlete with a login, by
-- their own app when they open a planned day).
-- Told: the athlete (existing trigger queue_athlete_team_change_notifications, skipped for an
-- athlete with no login) and the coaches of both teams, in-app. Audited.
create or replace function public.move_athlete_to_team(
  p_athlete_id uuid,
  p_to_team_id uuid
)
returns table (
  from_team_id uuid,
  to_team_id uuid,
  removed_sessions integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_athlete public.athletes%rowtype;
  v_to public.teams%rowtype;
  v_from_name text;
  v_name text;
  v_removed integer := 0;
  v_coach uuid;
  v_told uuid[] := '{}';
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_athlete_id is null or p_to_team_id is null then
    raise exception 'Choose the athlete and the team.' using errcode = '22023';
  end if;

  select * into v_athlete
  from public.athletes a
  where a.id = p_athlete_id
    and a.tenant_id = public.current_tenant_id()
  for update;

  select * into v_to
  from public.teams t
  where t.id = p_to_team_id
    and t.tenant_id = public.current_tenant_id();

  -- One answer for "no such athlete", "no such team" and "not yours to move", so the function
  -- cannot be used to find out what exists on other teams.
  if v_athlete.id is null or v_to.id is null or not v_athlete.is_active
     or not (
       public.is_club_admin()
       or (
         v_athlete.team_id is not null
         and public.is_team_coach(v_athlete.team_id)
         and public.is_team_coach(v_to.id)
       )
     ) then
    raise exception 'You can only move an athlete between teams you coach.' using errcode = '42501';
  end if;

  if v_to.status <> 'active' or v_to.is_archived then
    raise exception 'That team is not active.' using errcode = '23514';
  end if;
  if v_athlete.team_id = v_to.id then
    raise exception 'The athlete is already on that team.' using errcode = '23514';
  end if;

  select t.name into v_from_name from public.teams t where t.id = v_athlete.team_id;

  if v_athlete.team_id is not null then
    with removed as (
      delete from public.sessions s
      where s.athlete_id = v_athlete.id
        and s.status = 'scheduled'
        and s.scheduled_for >= current_date
        and s.plan_id is not null
        and (
          exists (
            select 1 from public.training_plan_assignments tpa
            where tpa.plan_id = s.plan_id and tpa.scope = 'team' and tpa.team_id = v_athlete.team_id
          )
          or exists (
            select 1 from public.training_plans tp
            where tp.id = s.plan_id and tp.team_id = v_athlete.team_id
          )
        )
        and not exists (
          select 1 from public.training_plan_assignments tpa
          where tpa.plan_id = s.plan_id and tpa.scope = 'athlete' and tpa.athlete_id = v_athlete.id
        )
        and not exists (select 1 from public.session_completions sc where sc.session_id = s.id)
        and not exists (select 1 from public.session_row_logs l where l.session_id = s.id)
      returning 1
    )
    select count(*)::int into v_removed from removed;
  end if;

  update public.athletes
  set team_id = v_to.id,
      updated_at = now()
  where id = v_athlete.id;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    v_athlete.tenant_id, auth.uid(), public.current_app_role(), 'athlete_moved_team', v_athlete.id::text,
    format('moved from team %s to team %s, %s untouched upcoming sessions removed',
           coalesce(v_athlete.team_id::text, 'none'), v_to.id::text, v_removed)
  );

  v_name := public.notification_athlete_name(v_athlete.id);

  -- The new team's coaches can open the athlete; the old team's coaches no longer can.
  for v_coach in select public.notification_team_coach_user_ids(v_to.id)
  loop
    v_told := array_append(v_told, v_coach);
    perform public.enqueue_notification(
      v_athlete.tenant_id, v_coach, 'athlete_moved_team',
      format('%s moved to %s', v_name, v_to.name),
      case when v_from_name is null then 'They were not on a team before.'
           else format('They moved from %s. Their history came with them.', v_from_name) end,
      jsonb_build_object('team_id', v_to.id::text, 'athlete_id', v_athlete.id::text),
      array['in-app'],
      'athlete_moved:' || v_athlete.id::text || ':' || v_to.id::text,
      interval '10 minutes'
    );
  end loop;

  if v_athlete.team_id is not null then
    for v_coach in select public.notification_team_coach_user_ids(v_athlete.team_id)
    loop
      if v_coach = any (v_told) then
        continue;
      end if;
      perform public.enqueue_notification(
        v_athlete.tenant_id, v_coach, 'athlete_moved_team',
        format('%s moved to %s', v_name, v_to.name),
        format('They are no longer on %s.', coalesce(v_from_name, 'your team')),
        jsonb_build_object('team_id', v_athlete.team_id::text),
        array['in-app'],
        'athlete_moved:' || v_athlete.id::text || ':' || v_to.id::text,
        interval '10 minutes'
      );
    end loop;
  end if;

  return query select v_athlete.team_id, v_to.id, v_removed;
end;
$$;

revoke all on function public.move_athlete_to_team(uuid, uuid) from public, anon;
grant execute on function public.move_athlete_to_team(uuid, uuid) to authenticated, service_role;

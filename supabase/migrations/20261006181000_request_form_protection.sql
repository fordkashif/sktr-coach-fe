-- Public "Request access for your club" form: rate limits, validation, honeypot
-- Created: 2026-10-06
--
-- THE HOLE
--   submit_tenant_provision_request is the one write the public API offers to visitors
--   who are not signed in. It had no rate limit, no check on the shape or size of what
--   it stored, and every call queued one email (plus one in-app notification) to every
--   platform admin. A script could fill the Requests screen and the owner's inbox with
--   as many rows, of any size, as it cared to send.
--   Two older doors led to the same kind of write:
--     * the first version of the function (six arguments, 20260321165000) was never
--       removed and anyone still held EXECUTE on it, next to the current one. It had
--       none of the later checks;
--     * submit_account_request (20260321103000) let anyone, signed in or not, add an
--       "account request" to ANY club by typing the club's name, and the policy
--       account_requests_insert_authenticated let any member insert one for their own
--       club. No screen creates account requests: the club admin Requests tab only
--       reads and reviews them.
--
-- WHAT THIS FILE DOES
--   1. request_form_settings: one private row holding the limits and a random salt.
--   2. request_form_attempts: one small row per accepted request (hashes only).
--   3. submit_tenant_provision_request: one function, with validation, a honeypot,
--      a minimum fill time and three rate limits. The two older versions are dropped.
--   4. Account requests can no longer be created through the API.
--
-- WHO GETS EMAILED BY A SUBMISSION
--   Only the platform admins (platform_admin_contacts), one email each per accepted
--   request. The requester is NOT emailed when they submit; they are emailed once, later,
--   when a platform admin approves or rejects the request. So the form cannot be used to
--   make the system email an arbitrary address, and the per-email limit below caps how
--   many requests (and therefore later review emails) one address can collect.
--
-- NOTHING TO SET UP BY HAND. The salt is generated here, once, and never leaves the
-- database. To change a limit later, run one statement in the Supabase SQL editor, e.g.
--   update public.request_form_settings set per_email_max = 5;
--
-- Idempotent: create table if not exists, insert ... on conflict do nothing, drop
-- function if exists (old signatures only), create or replace function, drop policy if
-- exists, revoke/grant. No existing row is changed.

-- 1. Settings: the limits live here and nowhere else ------------------------------
--   per_email_max / per_email_window   accepted requests per email address
--   per_ip_max    / per_ip_window      accepted requests per visitor network address
--   global_hour_max, global_day_max    accepted requests from everyone together; this is
--                                      the ceiling on how many emails a flood from many
--                                      addresses can put in the platform admins' inbox
--   min_fill_ms                        a form reported as filled faster than this was
--                                      not filled by a person
--   ip_salt                            random, generated once below; mixed into the
--                                      hashes so they cannot be turned back into an IP
--                                      or email address by guessing
create table if not exists public.request_form_settings (
  id boolean primary key default true check (id),
  ip_salt text not null,
  per_email_max int not null default 3 check (per_email_max > 0),
  per_email_window interval not null default interval '24 hours',
  per_ip_max int not null default 5 check (per_ip_max > 0),
  per_ip_window interval not null default interval '24 hours',
  global_hour_max int not null default 30 check (global_hour_max > 0),
  global_day_max int not null default 150 check (global_day_max > 0),
  min_fill_ms int not null default 2500 check (min_fill_ms >= 0),
  created_at timestamptz not null default now()
);

-- RLS on and no policy: no API role can read or write it. Only security definer
-- functions (which run as the owner) and the service role reach it.
alter table public.request_form_settings enable row level security;
revoke all on public.request_form_settings from public, anon, authenticated;

-- gen_random_uuid() is built into Postgres (no extension needed). Two of them give 244
-- random bits. on conflict do nothing: a second run keeps the first salt.
insert into public.request_form_settings (id, ip_salt)
values (true, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

-- 2. Attempts: what the limits count -------------------------------------------------
-- One row per ACCEPTED request. A refused call raises, which rolls its row back, and a
-- honeypot hit writes nothing at all, so this table cannot be grown by a flood beyond
-- global_day_max rows a day. Rows older than the longest window are deleted by the
-- function itself on the next call (no scheduled job).
-- Neither the IP nor the email is stored here, only salted SHA-256 hashes.
create table if not exists public.request_form_attempts (
  id bigint generated always as identity primary key,
  form text not null default 'club_request',
  email_hash text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists request_form_attempts_created_idx
on public.request_form_attempts (form, created_at desc);

alter table public.request_form_attempts enable row level security;
revoke all on public.request_form_attempts from public, anon, authenticated;

-- The visitor's network address, salted and hashed. PostgREST exposes the request
-- headers as the setting request.headers. Order of trust:
--   cf-connecting-ip   set by the CDN in front of Supabase; a visitor cannot forge it
--   x-real-ip          set by the gateway
--   x-forwarded-for    first entry; a visitor CAN put a made-up value in front of it,
--                      so on its own this limit can be dodged, which is why the per-email
--                      and global limits do not depend on it
-- No header, no usable value, or a call that did not come through the API (SQL editor,
-- service role): NULL, and the per-IP limit is simply skipped.
-- An IPv6 address is reduced to its /64 network, because one visitor normally owns the
-- whole /64 and could otherwise use a new address for every request.
create or replace function public.request_form_ip_hash()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_headers json;
  v_raw text;
  v_ip inet;
  v_key text;
  v_salt text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;

  if v_headers is null then
    return null;
  end if;

  v_raw := coalesce(
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(v_headers ->> 'x-real-ip'), ''),
    nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '')
  );

  if v_raw is null or length(v_raw) > 64 then
    return null;
  end if;

  begin
    v_ip := v_raw::inet;
    if family(v_ip) = 6 then
      v_key := host(network(set_masklen(v_ip, 64)));
    else
      v_key := host(v_ip);
    end if;
  exception when others then
    -- Not an address we can parse: still usable as an opaque key.
    v_key := lower(v_raw);
  end;

  select s.ip_salt into v_salt from public.request_form_settings s where s.id;
  if v_salt is null then
    return null;
  end if;

  return encode(sha256(convert_to(v_salt || ':ip:' || v_key, 'UTF8')), 'hex');
end;
$$;

revoke all on function public.request_form_ip_hash() from public, anon, authenticated;

-- Checks one free-text answer of the form. Returns the trimmed value (NULL when empty).
-- Raises with a message the browser maps to a friendly sentence (src/lib/auth-errors.ts).
-- Control characters (anything below a space, and DEL) are refused; p_multiline lets
-- tab, line feed and carriage return through for the notes box.
create or replace function public.request_form_clean_text(
  p_value text,
  p_label text,
  p_max_length int,
  p_multiline boolean default false
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value text := nullif(btrim(replace(coalesce(p_value, ''), E'\r\n', E'\n')), '');
begin
  if v_value is null then
    return null;
  end if;

  if length(v_value) > p_max_length then
    raise exception '% is too long (maximum % characters)', p_label, p_max_length
      using errcode = '22023';
  end if;

  if (not p_multiline and v_value ~ '[\x01-\x1F\x7F]')
     or (p_multiline and v_value ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]') then
    raise exception '% contains characters that are not allowed', p_label
      using errcode = '22023';
  end if;

  return v_value;
end;
$$;

revoke all on function public.request_form_clean_text(text, text, int, boolean) from public, anon, authenticated;

-- 3. The request function ---------------------------------------------------------------
-- The two older signatures go first. If they stayed, the six-argument one would remain
-- a version with no protection at all, and the API could no longer tell the
-- thirteen-argument one from the new one (both would match the same call). The new function accepts exactly the
-- arguments the current screen sends, plus two optional ones, so a browser tab that
-- still has the previous version of the app open keeps working.
drop function if exists public.submit_tenant_provision_request(text, text, text, text, text, integer);
drop function if exists public.submit_tenant_provision_request(
  text, text, text, text, text, integer, text, text, text, text, integer, integer, date
);

-- Same behaviour as 20260324103000_expand_tenant_request_intake_fields.sql for a normal
-- request: one row in tenant_provision_requests, one email and one in-app notification
-- per active platform admin, one platform audit event, and the same "pending request
-- already exists" refusal for a repeat of the same club and email.
--
-- Added, in this order:
--   a. Honeypot. p_reference_code is a field people never see. If it has anything in it,
--      or the form reports it was filled in less than min_fill_ms, the call returns a
--      made-up id and stores NOTHING: no request, no notification, no audit event, no
--      attempt row. The sender sees success and learns nothing.
--   b. Validation of every answer (shape, size, ranges, no control characters).
--   c. The existing duplicate check.
--   d. Rate limits, read from request_form_settings. Over any limit the call is refused
--      with SQLSTATE PT429 (PostgREST answers HTTP 429), hint 'rate_limited' and the
--      message "Too many requests. Try again later."
--   e. Old attempt rows are deleted.
-- Returns the id of the new request.
create or replace function public.submit_tenant_provision_request(
  p_requestor_name text,
  p_requestor_email text,
  p_organization_name text,
  p_notes text default null,
  p_requested_plan text default 'starter',
  p_expected_seats integer default null,
  p_job_title text default null,
  p_organization_type text default null,
  p_organization_website text default null,
  p_region text default null,
  p_expected_coach_count integer default null,
  p_expected_athlete_count integer default null,
  p_desired_start_date date default null,
  p_reference_code text default null,
  p_fill_ms integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_headcount constant int := 100000;
  v_settings public.request_form_settings%rowtype;
  v_request_id uuid;
  v_subject text;
  v_body text;
  v_actor_email text;
  v_expected_seats int;
  v_name text;
  v_email text;
  v_organization text;
  v_job_title text;
  v_organization_type text;
  v_region text;
  v_website text;
  v_notes text;
  v_email_key text;
  v_email_hash text;
  v_ip_hash text;
begin
  select * into v_settings from public.request_form_settings s where s.id;
  if not found then
    raise exception 'Request form settings are missing';
  end if;

  -- a. Honeypot and minimum fill time: accept silently, store nothing.
  if nullif(btrim(coalesce(p_reference_code, '')), '') is not null
     or (p_fill_ms is not null and p_fill_ms < v_settings.min_fill_ms) then
    return gen_random_uuid();
  end if;

  -- b. Validation. The first three messages and the plan, job title, type, region and
  -- count messages are the ones the screen already knows.
  v_name := public.request_form_clean_text(p_requestor_name, 'Requestor name', 160);
  if v_name is null then
    raise exception 'Requestor name is required';
  end if;

  v_email := lower(public.request_form_clean_text(p_requestor_email, 'Requestor email', 254));
  if v_email is null then
    raise exception 'Requestor email is required';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Requestor email is not valid' using errcode = '22023';
  end if;

  v_organization := public.request_form_clean_text(p_organization_name, 'Organization name', 160);
  if v_organization is null then
    raise exception 'Organization name is required';
  end if;

  if p_requested_plan is null or p_requested_plan not in ('starter', 'pro', 'enterprise') then
    raise exception 'Invalid requested plan';
  end if;

  v_job_title := public.request_form_clean_text(p_job_title, 'Job title', 120);
  if v_job_title is null then
    raise exception 'Job title is required';
  end if;

  v_organization_type := public.request_form_clean_text(p_organization_type, 'Organization type', 80);
  if v_organization_type is null then
    raise exception 'Organization type is required';
  end if;

  v_region := public.request_form_clean_text(p_region, 'Region', 120);
  if v_region is null then
    raise exception 'Region is required';
  end if;

  -- Empty, or a plain http(s) address with a dot in the host and no spaces. This keeps
  -- javascript:, data: and similar out of a value the platform admin screen shows as a link.
  v_website := public.request_form_clean_text(p_organization_website, 'Organization website', 300);
  if v_website is not null and v_website !~* '^https?://[^[:space:]/?#@]+\.[^[:space:]/?#@]+([/?#][^[:space:]]*)?$' then
    raise exception 'Organization website must be a web address starting with http:// or https://'
      using errcode = '22023';
  end if;

  v_notes := public.request_form_clean_text(p_notes, 'Notes', 1000, true);

  if p_expected_coach_count is null or p_expected_coach_count < 0 or p_expected_coach_count > c_max_headcount then
    raise exception 'Expected coach count must be between 0 and %', c_max_headcount;
  end if;

  if p_expected_athlete_count is null or p_expected_athlete_count < 0 or p_expected_athlete_count > c_max_headcount then
    raise exception 'Expected athlete count must be between 0 and %', c_max_headcount;
  end if;

  if p_expected_seats is not null and (p_expected_seats < 0 or p_expected_seats > 2 * c_max_headcount) then
    raise exception 'Expected seats must be between 0 and %', 2 * c_max_headcount;
  end if;

  v_expected_seats := coalesce(p_expected_seats, 0);
  if v_expected_seats <= 0 then
    v_expected_seats := greatest(1, p_expected_coach_count + p_expected_athlete_count);
  end if;

  -- A start date is optional. One a little in the past is fine (time zones, a form left
  -- open overnight); years away in either direction is not a real answer.
  if p_desired_start_date is not null
     and (p_desired_start_date < current_date - 31 or p_desired_start_date > current_date + 1826) then
    raise exception 'Desired start date is not valid' using errcode = '22023';
  end if;

  -- c. Same club and email already waiting for review (unchanged).
  if exists (
    select 1
    from public.tenant_provision_requests r
    where lower(r.organization_name) = lower(v_organization)
      and lower(r.requestor_email) = v_email
      and r.status = 'pending'
  ) then
    raise exception 'A pending request already exists for this organization and email';
  end if;

  -- d. Rate limits. One submission at a time gets past this line, so two requests
  -- arriving together cannot both slip under a limit. Held only until this call ends.
  perform pg_advisory_xact_lock(hashtext('public.submit_tenant_provision_request'));

  -- e. Housekeeping first, so the counts below never look at expired rows.
  delete from public.request_form_attempts a
  where a.created_at < now() - greatest(v_settings.per_email_window, v_settings.per_ip_window, interval '24 hours');

  -- "name+anything@host" is the same mailbox as "name@host" for the limit.
  v_email_key := regexp_replace(split_part(v_email, '@', 1), '\+.*$', '') || '@' || split_part(v_email, '@', 2);
  v_email_hash := encode(sha256(convert_to(v_settings.ip_salt || ':email:' || v_email_key, 'UTF8')), 'hex');
  v_ip_hash := public.request_form_ip_hash();

  if (
       select count(*)
       from public.request_form_attempts a
       where a.form = 'club_request'
         and a.email_hash = v_email_hash
         and a.created_at > now() - v_settings.per_email_window
     ) >= v_settings.per_email_max
     or (
       v_ip_hash is not null
       and (
         select count(*)
         from public.request_form_attempts a
         where a.form = 'club_request'
           and a.ip_hash = v_ip_hash
           and a.created_at > now() - v_settings.per_ip_window
       ) >= v_settings.per_ip_max
     )
     or (
       select count(*)
       from public.request_form_attempts a
       where a.form = 'club_request'
         and a.created_at > now() - interval '1 hour'
     ) >= v_settings.global_hour_max
     or (
       select count(*)
       from public.request_form_attempts a
       where a.form = 'club_request'
         and a.created_at > now() - interval '24 hours'
     ) >= v_settings.global_day_max then
    raise exception 'Too many requests. Try again later.'
      using errcode = 'PT429', hint = 'rate_limited';
  end if;

  insert into public.request_form_attempts (form, email_hash, ip_hash)
  values ('club_request', v_email_hash, v_ip_hash);

  insert into public.tenant_provision_requests (
    organization_name,
    requestor_name,
    requestor_email,
    requested_plan,
    expected_seats,
    notes,
    status,
    submitted_by_user_id,
    job_title,
    organization_type,
    organization_website,
    region,
    expected_coach_count,
    expected_athlete_count,
    desired_start_date
  )
  values (
    v_organization,
    v_name,
    v_email,
    p_requested_plan,
    v_expected_seats,
    v_notes,
    'pending',
    auth.uid(),
    v_job_title,
    v_organization_type,
    v_website,
    v_region,
    p_expected_coach_count,
    p_expected_athlete_count,
    p_desired_start_date
  )
  returning id into v_request_id;

  v_subject := 'New tenant provisioning request';
  v_body := format(
    'Organization: %s | Requestor: %s | Email: %s | Title: %s | Type: %s | Region: %s | Plan: %s | Coaches: %s | Athletes: %s | Seats: %s | Desired start: %s',
    v_organization,
    v_name,
    v_email,
    v_job_title,
    v_organization_type,
    v_region,
    p_requested_plan,
    p_expected_coach_count,
    p_expected_athlete_count,
    v_expected_seats,
    coalesce(p_desired_start_date::text, 'Not specified')
  );

  insert into public.notification_events (
    tenant_id,
    recipient_user_id,
    recipient_email,
    channel,
    event_type,
    subject,
    body,
    status,
    metadata
  )
  select
    null,
    c.user_id,
    c.email,
    'email',
    'tenant_provision_request_submitted',
    v_subject,
    v_body,
    'pending',
    jsonb_build_object('tenant_provision_request_id', v_request_id::text)
  from public.platform_admin_contacts c
  where c.is_active = true;

  insert into public.notification_events (
    tenant_id,
    recipient_user_id,
    recipient_email,
    channel,
    event_type,
    subject,
    body,
    status,
    metadata
  )
  select
    null,
    c.user_id,
    c.email,
    'in-app',
    'tenant_provision_request_submitted',
    v_subject,
    v_body,
    'pending',
    jsonb_build_object('tenant_provision_request_id', v_request_id::text)
  from public.platform_admin_contacts c
  where c.is_active = true
    and c.user_id is not null;

  select lower(coalesce(auth.jwt() ->> 'email', v_email))
  into v_actor_email;

  perform public.insert_platform_audit_event(
    auth.uid(),
    v_actor_email,
    case when auth.uid() is null then 'anonymous-requestor' else 'requestor' end,
    'tenant_provision_request_submitted',
    v_email,
    format('Organization %s requested on plan %s for %s seats', v_organization, p_requested_plan, v_expected_seats),
    jsonb_build_object(
      'tenant_provision_request_id', v_request_id::text,
      'organization_name', v_organization,
      'requested_plan', p_requested_plan,
      'expected_seats', v_expected_seats,
      'job_title', v_job_title,
      'organization_type', v_organization_type,
      'organization_website', v_website,
      'region', v_region,
      'expected_coach_count', p_expected_coach_count,
      'expected_athlete_count', p_expected_athlete_count,
      'desired_start_date', p_desired_start_date,
      'status', 'pending'
    )
  );

  return v_request_id;
end;
$$;

-- Visitors who are not signed in must be able to call it: that is what the form is.
revoke all on function public.submit_tenant_provision_request(
  text, text, text, text, text, integer, text, text, text, text, integer, integer, date, text, integer
) from public;
grant execute on function public.submit_tenant_provision_request(
  text, text, text, text, text, integer, text, text, text, text, integer, integer, date, text, integer
) to anon, authenticated, service_role;

-- 4. Account requests cannot be created through the API ------------------------------
-- Before: submit_account_request was callable by anyone, signed in or not, and added a
-- row to the Requests tab of whichever club was named, with no limit. And
-- account_requests_insert_authenticated let every member of a club (athletes included)
-- insert rows for their own club directly.
-- No screen creates account requests. The club admin Users page reads and reviews them
-- through account_requests_staff_all, which is untouched, so existing rows still show
-- and can still be approved or declined.
-- After: only the service role can call the function (it is kept, not dropped, in case
-- a public "ask to join a club" form is built later; it would need the same protection
-- as the function above first), and no member can insert.
revoke all on function public.submit_account_request(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_account_request(text, text, text, text, text)
  to service_role;

drop policy if exists account_requests_insert_authenticated on public.account_requests;

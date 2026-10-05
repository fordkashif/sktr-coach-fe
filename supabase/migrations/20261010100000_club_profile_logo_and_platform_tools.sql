-- SKTR Coach: club logo and contact details, and two platform admin tools
-- Created: 2026-10-10
--
-- WHAT THIS ADDS
--   A. Club logo.
--        * club_profiles.logo_path: where the club's logo lives in Storage. Every member of the
--          club can already read their club_profiles row (club_profiles_select_tenant), so the
--          logo is readable by the same people who can read the club's name, and by nobody else.
--        * A Storage bucket "club-logos". A logo is "<club id>/<random>.jpg|png|webp".
--          Only an active club admin of that club can upload, replace or remove a file, and only
--          inside their own club's folder.
--        * set_current_club_logo(path): the way the path is saved. It checks the path is in the
--          caller's club folder and that the file was really uploaded, and returns the previous
--          path so the browser can delete the old file.
--        * A check constraint on club_profiles so the column can never hold a path outside the
--          club's own folder, whoever writes it (club_profiles_modify_admin lets a club admin
--          write the row directly).
--        * get_current_club_brand(): the club's name, short name, colour and logo path for the
--          signed-in member. The app shell shows it. Nothing else comes back.
--   B. Club contact details: club_contact_details (contact email and phone, city, region,
--      country, website). Its own table, readable and writable by the club's admins only,
--      because coaches and athletes can read club_profiles and must not gain the contact
--      details by this change.
--   C. Platform admin: change a club's package directly.
--      platform_admin_set_tenant_package(club, package, reason). It rewrites requested_plan on
--      the club's latest provisioning record, which is exactly what approving a package request
--      does (review_tenant_package_upgrade_request), so tenant_athlete_limit(),
--      get_current_tenant_package() and the browser's package limits all follow at once.
--      A reason is required. It is written to the platform audit and to the club's own
--      activity, and the club's admins are told.
--   D. Platform admin: notification emails that failed.
--      get_platform_failed_notification_emails(limit): the latest failed emails with the
--      error, WITHOUT the message body. retry_platform_notification_email(id): puts one back
--      in the queue.
--
-- PUBLIC OR PRIVATE BUCKET
--   Public, for the same reasons as the avatars bucket (20261007100000): a logo is shown in
--   the top bar on every screen, a public bucket gives one stable address the browser can
--   cache, and the address cannot be guessed (a club id plus a random name, new on every
--   upload). A club logo is not confidential. The bucket cannot be listed by anyone who is
--   not an admin of that club.
--
-- LIFECYCLE (20261006180000)
--   set_current_club_logo starts with assert_caller_active(). The storage policies and the
--   contact details policies go through is_club_admin() and current_tenant_id(), which are
--   false / NULL for a deactivated member and for a suspended or cancelled club.
--   get_current_club_brand() returns no rows for such a caller.
--   The platform admin functions check is_platform_admin().
--
-- Idempotent and additive: add column if not exists, create table if not exists, constraints
-- and policies are dropped and recreated by name, create or replace function, revoke/grant.
-- Nothing is deleted and no existing row is changed.

-- A. Club logo ------------------------------------------------------------------------------

alter table public.club_profiles add column if not exists logo_path text;

comment on column public.club_profiles.logo_path is
  'Object name of the club logo in the public "club-logos" bucket: "<tenant id>/<random>.jpg|png|webp". Written by set_current_club_logo().';

-- A path is "<the club's id>/<8 to 64 url-safe characters>.<jpg|png|webp>". No slashes beyond
-- the one and no dots beyond the extension, so it can never climb out of the club's folder.
create or replace function public.club_logo_path_is_valid_for(p_tenant_id uuid, p_path text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_tenant_id is not null
     and p_path is not null
     and p_path ~ ('^' || p_tenant_id::text || '/[A-Za-z0-9_-]{8,64}\.(jpg|png|webp)$')
$$;

alter table public.club_profiles drop constraint if exists club_profiles_logo_path_own_folder;
alter table public.club_profiles
  add constraint club_profiles_logo_path_own_folder
  check (logo_path is null or public.club_logo_path_is_valid_for(tenant_id, logo_path));

-- Used by the storage policies: is this object name a valid logo path in the folder of the
-- caller's own club, and is the caller an active admin of that club.
create or replace function public.club_logo_object_is_callers(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_club_admin()
     and public.club_logo_path_is_valid_for(public.current_tenant_id(), p_name)
$$;

revoke all on function public.club_logo_path_is_valid_for(uuid, text) from public, anon;
revoke all on function public.club_logo_object_is_callers(text) from public, anon;
grant execute on function public.club_logo_path_is_valid_for(uuid, text) to authenticated, service_role;
grant execute on function public.club_logo_object_is_callers(text) to authenticated, service_role;

-- Guarded: a database without the Supabase storage schema (a plain Postgres used for a local
-- check) skips this block instead of failing the migration.
do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not found: club-logos bucket and policies skipped';
    return;
  end if;

  -- 2 MB after the browser has fitted the logo into a 512px square (typically under 100 KB).
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('club-logos', 'club-logos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  exception when undefined_column then
    insert into storage.buckets (id, name, public)
    values ('club-logos', 'club-logos', true)
    on conflict (id) do nothing;
  end;

  -- Reading through the public address does not use these policies. They cover the API:
  -- upload, overwrite, remove, and select of the club's own objects (the storage API needs
  -- select in order to remove or overwrite). All four: an active admin of that club only.
  drop policy if exists club_logos_select_admin on storage.objects;
  create policy club_logos_select_admin on storage.objects
    for select to authenticated
    using (bucket_id = 'club-logos' and public.club_logo_object_is_callers(name));

  drop policy if exists club_logos_insert_admin on storage.objects;
  create policy club_logos_insert_admin on storage.objects
    for insert to authenticated
    with check (bucket_id = 'club-logos' and public.club_logo_object_is_callers(name));

  drop policy if exists club_logos_update_admin on storage.objects;
  create policy club_logos_update_admin on storage.objects
    for update to authenticated
    using (bucket_id = 'club-logos' and public.club_logo_object_is_callers(name))
    with check (bucket_id = 'club-logos' and public.club_logo_object_is_callers(name));

  drop policy if exists club_logos_delete_admin on storage.objects;
  create policy club_logos_delete_admin on storage.objects
    for delete to authenticated
    using (bucket_id = 'club-logos' and public.club_logo_object_is_callers(name));
end;
$storage$;

-- set_current_club_logo(path): path is null to remove the logo, or an object in the folder of
-- the caller's club in the club-logos bucket. Returns the PREVIOUS path so the browser can
-- delete the old file. Club admins only. RAISES the access_paused error for a deactivated
-- admin or a suspended or cancelled club.
create or replace function public.set_current_club_logo(p_logo_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_path text := nullif(btrim(coalesce(p_logo_path, '')), '');
  v_previous text;
  v_exists boolean;
  v_tenant_name text;
  v_year text := to_char(current_date, 'YYYY');
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
    raise exception 'Only active club-admin users can change the club logo';
  end if;

  if v_path is not null and not public.club_logo_path_is_valid_for(v_profile.tenant_id, v_path) then
    raise exception 'Logo path is not valid for this club' using errcode = '22023';
  end if;

  -- When the storage schema is here, the file has to exist: a logo that was never uploaded
  -- would show as a broken image for the whole club.
  if v_path is not null and to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''club-logos'' and o.name = $1)'
      into v_exists
      using v_path;
    if not v_exists then
      raise exception 'Logo has not been uploaded' using errcode = '22023';
    end if;
  end if;

  select cp.logo_path into v_previous
  from public.club_profiles cp
  where cp.tenant_id = v_profile.tenant_id
  for update;

  if found then
    update public.club_profiles
    set logo_path = v_path
    where tenant_id = v_profile.tenant_id;
  elsif v_path is not null then
    -- A club with no profile row yet (older clubs): create it from the club's name, with the
    -- same defaults the app shows before the profile is first saved.
    select t.name into v_tenant_name from public.tenants t where t.id = v_profile.tenant_id;
    insert into public.club_profiles (tenant_id, club_name, short_name, season_year, season_start, season_end, logo_path)
    values (
      v_profile.tenant_id,
      coalesce(nullif(btrim(coalesce(v_tenant_name, '')), ''), 'Club'),
      coalesce(nullif(upper(left(regexp_replace(coalesce(v_tenant_name, ''), '[^A-Za-z0-9]', '', 'g'), 4)), ''), 'CLUB'),
      v_year,
      make_date(v_year::int, 1, 1),
      make_date(v_year::int, 12, 31),
      v_path
    );
  end if;

  return v_previous;
end;
$$;

-- The club the signed-in member belongs to, as the app shell shows it: name, short name,
-- colour and logo path. One row, or none for a deactivated member, a member of a suspended
-- or cancelled club, and anyone with no club (a platform admin). Billing and contact details
-- are not part of it.
create or replace function public.get_current_club_brand()
returns table (club_name text, short_name text, primary_color text, logo_path text)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(btrim(coalesce(cp.club_name, '')), ''), t.name) as club_name,
    nullif(btrim(coalesce(cp.short_name, '')), '') as short_name,
    cp.primary_color,
    cp.logo_path
  from public.tenants t
  left join public.club_profiles cp
    on cp.tenant_id = t.id
  where t.id = public.current_tenant_id()
$$;

revoke all on function public.set_current_club_logo(text) from public, anon;
revoke all on function public.get_current_club_brand() from public, anon;
grant execute on function public.set_current_club_logo(text) to authenticated;
grant execute on function public.get_current_club_brand() to authenticated;

-- B. Club contact details ---------------------------------------------------------------------

create table if not exists public.club_contact_details (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  contact_email text,
  contact_phone text,
  city text,
  region text,
  country text,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.club_contact_details is
  'How to reach a club and where it is. Readable and writable by the club''s admins only; coaches and athletes cannot read it.';

alter table public.club_contact_details drop constraint if exists club_contact_details_values_ok;
alter table public.club_contact_details
  add constraint club_contact_details_values_ok
  check (
    (contact_email is null or (length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    and (contact_phone is null or (length(contact_phone) <= 40 and contact_phone ~ '^[0-9+() .-]{5,40}$'))
    and (city is null or length(city) <= 80)
    and (region is null or length(region) <= 80)
    and (country is null or length(country) <= 80)
    and (website is null or (length(website) <= 200 and website ~* '^https?://[^[:space:]]+$'))
  );

drop trigger if exists set_updated_at_club_contact_details on public.club_contact_details;
create trigger set_updated_at_club_contact_details
before update on public.club_contact_details
for each row
execute function public.set_updated_at();

alter table public.club_contact_details enable row level security;

drop policy if exists club_contact_details_select_admin on public.club_contact_details;
create policy club_contact_details_select_admin
on public.club_contact_details
for select
to authenticated
using (public.is_club_admin() and tenant_id = public.current_tenant_id());

drop policy if exists club_contact_details_modify_admin on public.club_contact_details;
create policy club_contact_details_modify_admin
on public.club_contact_details
for all
to authenticated
using (public.is_club_admin() and tenant_id = public.current_tenant_id())
with check (public.is_club_admin() and tenant_id = public.current_tenant_id());

revoke all on public.club_contact_details from public, anon, authenticated;
grant select, insert, update on public.club_contact_details to authenticated;
grant all on public.club_contact_details to service_role;

-- C. Platform admin changes a club's package ---------------------------------------------------
-- The same effect as approving a package request: requested_plan on the club's LATEST
-- provisioning record is the plan in force. Returns the package the club was on before.
--   * platform admins only; a reason of at least 3 characters is required;
--   * refused for a club that is not approved, has no workspace, or is cancelled, and when the
--     club is already on that package;
--   * a pending package request from the club for this same package is marked approved with
--     the reason as its note (the club is told by the existing trigger). A pending request for
--     a different package is left waiting;
--   * otherwise the club's admins get one notification saying which package they are on now;
--   * one row in platform_audit_events (tenant_package_changed) and one in the club's own
--     audit_events (package_changed, actor role platform-admin).
create or replace function public.platform_admin_set_tenant_package(
  p_tenant_id uuid,
  p_package text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_email text := lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''));
  v_reason text := nullif(left(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), 500), '');
  v_request public.tenant_provision_requests%rowtype;
  v_previous text;
  v_closed_request_id uuid;
  v_admin_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Only active platform admins can change a club''s package.';
  end if;

  if p_package is null or p_package not in ('starter', 'pro', 'enterprise') then
    raise exception 'Package is invalid.' using errcode = '22023';
  end if;

  if v_reason is null or length(v_reason) < 3 then
    raise exception 'A reason is required to change a club''s package.' using errcode = '22023';
  end if;

  select *
  into v_request
  from public.tenant_provision_requests tpr
  where tpr.provisioned_tenant_id = p_tenant_id
  order by tpr.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No club was found for this workspace.';
  end if;

  if v_request.status <> 'approved' then
    raise exception 'Only an approved club has a package to change.';
  end if;

  if v_request.lifecycle_status = 'cancelled' then
    raise exception 'The package of a cancelled club cannot be changed. Restore the club first.';
  end if;

  v_previous := v_request.requested_plan;

  if v_previous = p_package then
    raise exception 'This club is already on the % package.', p_package;
  end if;

  update public.tenant_provision_requests
  set requested_plan = p_package,
      updated_at = now()
  where id = v_request.id;

  update public.tenant_package_upgrade_requests
  set status = 'approved',
      review_notes = v_reason,
      reviewed_by_user_id = auth.uid(),
      reviewed_at = now()
  where tenant_id = p_tenant_id
    and status = 'pending'
    and requested_package = p_package
  returning id into v_closed_request_id;

  if v_closed_request_id is null then
    for v_admin_user_id in select public.notification_club_admin_user_ids(p_tenant_id)
    loop
      perform public.enqueue_notification(
        p_tenant_id,
        v_admin_user_id,
        'package_request_reviewed',
        'Your club''s package changed',
        format('Your club is now on the %s package. Note from SKTR Coach: %s', initcap(p_package), v_reason),
        jsonb_build_object('status', 'changed', 'previous_package', v_previous, 'requested_package', p_package),
        array['in-app', 'email'],
        'package_changed:' || v_request.id::text || ':' || p_package,
        interval '1 hour'
      );
    end loop;
  end if;

  perform public.insert_platform_audit_event(
    p_actor_user_id := auth.uid(),
    p_actor_email := v_actor_email,
    p_actor_role := 'platform-admin',
    p_action := 'tenant_package_changed',
    p_target := v_request.organization_name,
    p_detail := format('Package changed from %s to %s.', v_previous, p_package),
    p_metadata := jsonb_build_object(
      'tenant_id', p_tenant_id,
      'request_id', v_request.id,
      'previous_package', v_previous,
      'current_package', v_previous,
      'requested_package', p_package,
      'review_notes', v_reason,
      'closed_upgrade_request_id', v_closed_request_id
    )
  );

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    p_tenant_id,
    auth.uid(),
    'platform-admin',
    'package_changed',
    p_package,
    format('Package changed from %s to %s by the SKTR team. Reason: %s', v_previous, p_package, v_reason)
  );

  return v_previous;
end;
$$;

revoke all on function public.platform_admin_set_tenant_package(uuid, text, text) from public, anon;
grant execute on function public.platform_admin_set_tenant_package(uuid, text, text) to authenticated;

-- D. Platform admin: notification emails that failed -------------------------------------------
-- The latest failed emails of the last 8 days, newest first. Platform admins only (anyone
-- else gets no rows). The message BODY and the metadata are never returned: the subject, the
-- kind of update, who it was for, the club and the provider's error are enough to act on.
--   will_retry  the queue will try it again by itself (fewer than five tries, not too old)
--   can_retry   it is not too old to be sent (72 hours), so "Try again" can put it back
create or replace function public.get_platform_failed_notification_emails(p_limit integer default 50)
returns table (
  id uuid,
  tenant_id uuid,
  tenant_name text,
  recipient_email text,
  event_type text,
  subject text,
  last_error text,
  delivery_attempt_count integer,
  created_at timestamptz,
  next_attempt_at timestamptz,
  will_retry boolean,
  can_retry boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.tenant_id,
    (select t.name from public.tenants t where t.id = e.tenant_id) as tenant_name,
    coalesce(
      nullif(lower(btrim(coalesce(e.recipient_email, ''))), ''),
      (select lower(btrim(au.email)) from auth.users au where au.id = e.recipient_user_id)
    ) as recipient_email,
    e.event_type,
    e.subject,
    e.last_error,
    e.delivery_attempt_count,
    e.created_at,
    e.next_attempt_at,
    (e.delivery_attempt_count < 5 and e.created_at > now() - public.notification_email_max_age()) as will_retry,
    (e.created_at > now() - public.notification_email_max_age()) as can_retry
  from public.notification_events e
  where public.is_platform_admin()
    and e.channel = 'email'
    and e.status = 'failed'
    and e.created_at > now() - interval '8 days'
  order by e.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

-- Puts one failed email back in the queue with a clean count, so the next delivery run (or
-- "Send queued emails") tries it again. Platform admins only. Refused for an email that is
-- not failed, or is too old to be sent. Returns true when the row was put back.
create or replace function public.retry_platform_notification_email(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_email text := lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''));
  v_event public.notification_events%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Only active platform admins can retry a notification email.';
  end if;

  select * into v_event
  from public.notification_events e
  where e.id = p_event_id
    and e.channel = 'email'
  for update;

  if not found then
    raise exception 'Notification email not found.';
  end if;

  if v_event.status <> 'failed' then
    return false;
  end if;

  if v_event.created_at <= now() - public.notification_email_max_age() then
    raise exception 'This email is more than 72 hours old, so it will not be sent.';
  end if;

  update public.notification_events e
  set status = 'pending',
      delivery_attempt_count = 0,
      next_attempt_at = null,
      processing_started_at = null
  where e.id = p_event_id;

  perform public.insert_platform_audit_event(
    p_actor_user_id := auth.uid(),
    p_actor_email := v_actor_email,
    p_actor_role := 'platform-admin',
    p_action := 'notification_email_retry_requested',
    p_target := coalesce((select t.name from public.tenants t where t.id = v_event.tenant_id), 'platform'),
    p_detail := 'A failed notification email was put back in the queue.',
    p_metadata := jsonb_build_object(
      'notification_event_id', v_event.id,
      'tenant_id', v_event.tenant_id,
      'event_type', v_event.event_type
    )
  );

  return true;
end;
$$;

revoke all on function public.get_platform_failed_notification_emails(integer) from public, anon;
revoke all on function public.retry_platform_notification_email(uuid) from public, anon;
grant execute on function public.get_platform_failed_notification_emails(integer) to authenticated;
grant execute on function public.retry_platform_notification_email(uuid) to authenticated;

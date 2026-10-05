-- Account basics: profile photos, own display name, and email-change safety
-- Created: 2026-10-07
--
-- WHAT THIS ADDS
--   1. Profile photos.
--        * account_avatars: one row per account that has a photo. It is its own table,
--          not a column on profiles, because every coach can read every profile row of
--          their club (profiles_select_tenant_for_staff) and a photo must only reach the
--          people listed below. Each account can read only its own row; everything else
--          goes through get_visible_avatars().
--        * platform_admin_contacts.display_name (a platform admin has no profile row;
--          their contact row is their identity).
--        * A Storage bucket "avatars" with row policies on storage.objects.
--        * set_current_avatar(path): the only way to set a photo. Caller's own row only.
--        * get_visible_avatars(): the photos the caller is allowed to see, in one call.
--   2. Your own name: update_current_display_name(name) for coaches, club admins and
--      platform admins (API roles have no direct write on profiles since 20261005200000).
--      Athletes keep using update_current_athlete_profile (first and last name).
--   3. get_current_account(): the caller's own name and photo, whatever kind of account.
--   4. Email-change safety (see section 6).
--
-- PUBLIC OR PRIVATE BUCKET (decided deliberately)
--   The bucket is PUBLIC. A photo is served from
--       <project>/storage/v1/object/public/avatars/<user id>/<random uuid>.jpg
--   to anyone who has that exact address, signed in or not.
--   Why: photos are shown in long lists (rosters, People). A private bucket needs a signed
--   URL per photo; signed URLs expire, so lists would have to re-sign every photo on every
--   load and cached pages would show broken images. A public bucket has one stable address
--   per photo that browsers and the CDN can cache.
--   What protects the photo: the address cannot be guessed (a user id plus a random uuid,
--   new on every upload), the bucket cannot be listed (there is no select policy that lets
--   one user list another user's folder), and the path is only ever handed out by
--   get_visible_avatars() to people who may see that person anyway.
--   The trade-off: someone who was given an address (a former coach, a copied link) can
--   keep opening that one image until the owner replaces or removes the photo, which
--   deletes the file. A profile photo is not treated as confidential. If that changes,
--   flip the bucket to private and sign URLs in the browser; nothing else here depends on it.
--
-- WHO CAN SEE WHOSE PHOTO (get_visible_avatars; no table policy is widened)
--   everyone        their own
--   club admin      every member of their own club
--   coach           athletes on the teams they coach (current_coach_athlete_ids, 20261006120000)
--   athlete         the coaches of their current team (current_athlete_team_id, 20261006150000)
--   platform admin  their own
--   deactivated member, member of a suspended or cancelled club: nothing (no rows).
--
-- LIFECYCLE (20261006180000): the two write functions start with assert_caller_active().
--   The storage policies use caller_can_manage_own_avatar(), which is
--   caller_is_active_member() or is_platform_admin().
--
-- Idempotent and additive: create table / add column if not exists, constraints and policies are dropped
-- and recreated by name, create or replace function, revoke/grant. Nothing is deleted.

-- 1. Tables and columns ---------------------------------------------------------------------
alter table public.platform_admin_contacts add column if not exists display_name text;

alter table public.platform_admin_contacts drop constraint if exists platform_admin_contacts_display_name_length;
alter table public.platform_admin_contacts
  add constraint platform_admin_contacts_display_name_length
  check (display_name is null or length(display_name) <= 120);

-- A path is "<the owner's user id>/<8 to 64 url-safe characters>.<jpg|png|webp>".
-- No slashes beyond the one, no dots beyond the extension, so it can never climb out of
-- the owner's folder or name another bucket.
create or replace function public.avatar_path_is_valid_for(p_user_id uuid, p_path text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_user_id is not null
     and p_path is not null
     and p_path ~ ('^' || p_user_id::text || '/[A-Za-z0-9_-]{8,64}\.(jpg|png|webp)$')
$$;

create table if not exists public.account_avatars (
  user_id uuid primary key references auth.users(id) on delete cascade,
  avatar_path text not null,
  updated_at timestamptz not null default now()
);

alter table public.account_avatars drop constraint if exists account_avatars_path_own_folder;
alter table public.account_avatars
  add constraint account_avatars_path_own_folder
  check (public.avatar_path_is_valid_for(user_id, avatar_path));

alter table public.account_avatars enable row level security;

-- Own row only. No insert, update or delete policy and no write privilege: the only writer
-- is set_current_avatar().
drop policy if exists account_avatars_select_own on public.account_avatars;
create policy account_avatars_select_own
on public.account_avatars
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.account_avatars from public, anon, authenticated;
grant select on public.account_avatars to authenticated;
grant all on public.account_avatars to service_role;

-- A platform admin contact can be matched by email only (user_id empty). Link every such
-- row to its account now, so the account keeps its admin rights by user id after an email
-- change and can set a name. Only a confirmed address counts.
update public.platform_admin_contacts pac
set user_id = au.id
from auth.users au
where pac.user_id is null
  and lower(btrim(pac.email)) = lower(btrim(au.email))
  and au.email_confirmed_at is not null;

-- 2. Who may have a photo -------------------------------------------------------------------
-- An active member of an open club, or an active platform admin.
create or replace function public.caller_can_manage_own_avatar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and (public.caller_is_active_member() or public.is_platform_admin())
$$;

-- Used by the storage policies: is this object name a valid photo path in the caller's own
-- folder, and may the caller have a photo at all.
create or replace function public.avatar_object_is_callers(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.caller_can_manage_own_avatar()
     and public.avatar_path_is_valid_for(auth.uid(), p_name)
$$;

revoke all on function public.avatar_path_is_valid_for(uuid, text) from public, anon;
revoke all on function public.caller_can_manage_own_avatar() from public, anon;
revoke all on function public.avatar_object_is_callers(text) from public, anon;
grant execute on function public.avatar_path_is_valid_for(uuid, text) to authenticated, service_role;
grant execute on function public.caller_can_manage_own_avatar() to authenticated, service_role;
grant execute on function public.avatar_object_is_callers(text) to authenticated, service_role;

-- 3. Storage bucket and its policies --------------------------------------------------------
-- Guarded: a database without the Supabase storage schema (a plain Postgres used for a
-- local check) skips this block instead of failing the migration.
do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not found: avatars bucket and policies skipped';
    return;
  end if;

  -- 2 MB after the browser has cropped and resized the photo to 512px (typically 40 to 90 KB).
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  exception when undefined_column then
    -- A very old storage schema without the limit columns: create the bucket anyway.
    insert into storage.buckets (id, name, public)
    values ('avatars', 'avatars', true)
    on conflict (id) do nothing;
  end;

  -- Reading through the public address does not use these policies. They cover the API:
  -- upload (insert), overwrite (update), remove (delete), and select of the caller's own
  -- objects, which the storage API needs in order to remove or overwrite them.
  drop policy if exists avatars_select_own on storage.objects;
  create policy avatars_select_own on storage.objects
    for select to authenticated
    using (bucket_id = 'avatars' and public.avatar_path_is_valid_for(auth.uid(), name));

  drop policy if exists avatars_insert_own on storage.objects;
  create policy avatars_insert_own on storage.objects
    for insert to authenticated
    with check (bucket_id = 'avatars' and public.avatar_object_is_callers(name));

  drop policy if exists avatars_update_own on storage.objects;
  create policy avatars_update_own on storage.objects
    for update to authenticated
    using (bucket_id = 'avatars' and public.avatar_object_is_callers(name))
    with check (bucket_id = 'avatars' and public.avatar_object_is_callers(name));

  drop policy if exists avatars_delete_own on storage.objects;
  create policy avatars_delete_own on storage.objects
    for delete to authenticated
    using (bucket_id = 'avatars' and public.avatar_object_is_callers(name));
end;
$storage$;

-- 4. Writes: the caller's own photo and name --------------------------------------------------
-- set_current_avatar(path): path is null to remove the photo, or an object in the caller's
-- own folder of the avatars bucket. There is no bucket argument: the path is only ever
-- read as a name inside "avatars". Returns the PREVIOUS path so the browser can delete the
-- old file. RAISES the access_paused error for a deactivated member or a blocked club.
create or replace function public.set_current_avatar(p_avatar_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_path text := nullif(btrim(coalesce(p_avatar_path, '')), '');
  v_previous text;
  v_exists boolean;
begin
  perform public.assert_caller_active();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_path is not null and not public.avatar_path_is_valid_for(v_user_id, v_path) then
    raise exception 'Photo path is not valid for this account' using errcode = '22023';
  end if;

  -- When the storage schema is here, the file has to exist: a photo that was never
  -- uploaded would show as a broken image for everyone.
  if v_path is not null and to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''avatars'' and o.name = $1)'
      into v_exists
      using v_path;
    if not v_exists then
      raise exception 'Photo has not been uploaded' using errcode = '22023';
    end if;
  end if;

  if not public.caller_can_manage_own_avatar() then
    raise exception 'Account not found';
  end if;

  select aa.avatar_path into v_previous
  from public.account_avatars aa
  where aa.user_id = v_user_id
  for update;

  if v_path is null then
    delete from public.account_avatars where user_id = v_user_id;
  else
    insert into public.account_avatars (user_id, avatar_path, updated_at)
    values (v_user_id, v_path, now())
    on conflict (user_id) do update
      set avatar_path = excluded.avatar_path,
          updated_at = excluded.updated_at;
  end if;

  return v_previous;
end;
$$;

-- update_current_display_name(name): the caller's own display name. Coaches, club admins
-- and platform admins. An athlete's name lives on the athletes row as first and last name
-- and is changed with update_current_athlete_profile, so athletes are refused here.
-- Returns the cleaned name. RAISES the access_paused error like set_current_avatar.
create or replace function public.update_current_display_name(p_display_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  -- Control characters out, runs of spaces to one, trimmed.
  v_name text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '');
begin
  perform public.assert_caller_active();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_name is null then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  if length(v_name) > 120 then
    raise exception 'Name must be 120 characters or fewer' using errcode = '22023';
  end if;

  select p.role into v_role
  from public.profiles p
  where p.user_id = v_user_id;

  if found then
    if v_role = 'athlete' then
      raise exception 'Athletes change their name on their athlete profile';
    end if;

    update public.profiles
    set display_name = v_name,
        updated_at = now()
    where user_id = v_user_id;
    return v_name;
  end if;

  update public.platform_admin_contacts
  set display_name = v_name
  where user_id = v_user_id
    and is_active;

  if not found then
    raise exception 'Account not found';
  end if;

  return v_name;
end;
$$;

-- 5. Reads ----------------------------------------------------------------------------------
-- The caller's own name and photo. One row, or none for an account with neither a profile
-- nor a platform admin contact. It answers a deactivated member too: it is their own row,
-- which profiles_select_own already lets them read.
create or replace function public.get_current_account()
returns table (account_kind text, role text, display_name text, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select s.account_kind, s.role, s.display_name,
         (select aa.avatar_path from public.account_avatars aa where aa.user_id = auth.uid())
  from (
    select 'member'::text as account_kind, p.role, nullif(btrim(coalesce(p.display_name, '')), '') as display_name
    from public.profiles p
    where p.user_id = auth.uid()
    union all
    select 'platform-admin'::text, 'platform-admin'::text, nullif(btrim(coalesce(pac.display_name, '')), '')
    from public.platform_admin_contacts pac
    where pac.user_id = auth.uid()
      and pac.is_active
      and not exists (select 1 from public.profiles p where p.user_id = auth.uid())
    limit 1
  ) s
$$;

-- The photos the caller may see (table at the top of this file). athlete_id is filled when
-- the person is an athlete, so rosters (keyed by athletes.id) and People lists (keyed by
-- user id) can both look a photo up. RETURNS NO ROWS for a caller whose access is paused.
create or replace function public.get_visible_avatars()
returns table (user_id uuid, athlete_id uuid, avatar_path text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, a.id as athlete_id, aa.avatar_path
  from public.profiles me
  join public.profiles p
    on p.tenant_id = me.tenant_id
  join public.account_avatars aa
    on aa.user_id = p.user_id
  left join public.athletes a
    on a.user_id = p.user_id
   and a.tenant_id = p.tenant_id
  where me.user_id = auth.uid()
    and public.caller_is_active_member()
    and (
      p.user_id = me.user_id
      or me.role = 'club-admin'
      or (me.role = 'coach' and a.id = any (public.current_coach_athlete_ids()))
      or (
        me.role = 'athlete'
        and exists (
          select 1
          from public.team_coaches tc
          where tc.user_id = p.user_id
            and tc.tenant_id = me.tenant_id
            and tc.team_id = public.current_athlete_team_id()
        )
      )
    )
  union all
  select aa.user_id, null::uuid, aa.avatar_path
  from public.account_avatars aa
  where aa.user_id = auth.uid()
    and public.is_platform_admin()
    and not exists (select 1 from public.profiles p where p.user_id = auth.uid())
$$;

revoke all on function public.set_current_avatar(text) from public, anon;
revoke all on function public.update_current_display_name(text) from public, anon;
revoke all on function public.get_current_account() from public, anon;
revoke all on function public.get_visible_avatars() from public, anon;
grant execute on function public.set_current_avatar(text) to authenticated;
grant execute on function public.update_current_display_name(text) to authenticated;
grant execute on function public.get_current_account() to authenticated;
grant execute on function public.get_visible_avatars() to authenticated;

-- 6. Email-change safety ----------------------------------------------------------------------
-- The app now lets a signed-in user ask for a new email address (supabase.auth.updateUser).
-- Supabase keeps the OLD address in auth.users.email until the link sent to the NEW address
-- is opened (the requested one waits in auth.users.email_change), so asking for somebody
-- else's address gives no access to anything matched by email. That holds only while the
-- project setting "Confirm email" is ON; see SUPABASE_RLS_POLICY_MATRIX.md.
--
-- Reviewed, everything that matches a person by email:
--   bootstrap_current_profile()            already requires email_confirmed_at. No change.
--   accept_coach_invite / accept_athlete_invite
--                                          read auth.users.email WITHOUT checking that it is
--                                          confirmed. Closed below: an unconfirmed address
--                                          now matches no invite.
--   current_athlete_email(), get_athlete_invite_preview()
--                                          same gap for reading invites. Closed below.
--   is_platform_admin() and the policies that compare auth.jwt() ->> 'email'
--                                          the token carries auth.users.email, the confirmed
--                                          one. No change. But see the trigger below.
--
-- 6a. A platform admin's contact row follows their account's email.
--   Without this, after a platform admin changes email their contact row would keep the old
--   address: functions that match by email only would stop recognising them, and whoever
--   later registered the old address would be matched as a platform admin.
create or replace function public.sync_platform_admin_contact_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    begin
      update public.platform_admin_contacts pac
      set email = lower(btrim(new.email)),
          user_id = new.id
      where pac.user_id = new.id
         or (
           pac.user_id is null
           and old.email_confirmed_at is not null
           and lower(btrim(pac.email)) = lower(btrim(old.email))
         );
    exception when others then
      -- Never block a sign-in or an email change because of this copy.
      raise warning 'sync_platform_admin_contact_email failed for user %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_platform_admin_contact_email() from public, anon, authenticated;

do $trigger$
begin
  drop trigger if exists sync_platform_admin_contact_email on auth.users;
  create trigger sync_platform_admin_contact_email
  after update of email on auth.users
  for each row execute function public.sync_platform_admin_contact_email();
exception when insufficient_privilege then
  raise notice 'no privilege to create a trigger on auth.users: platform admin contact email will not follow an email change';
end;
$trigger$;

-- 6b. Reading invites: only a confirmed address counts.
-- Latest definition: 20261006150000_athlete_read_scope.sql, with one condition added.
create or replace function public.current_athlete_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(lower(btrim(au.email)), '')
  from auth.users au
  where au.id = auth.uid()
    and au.email_confirmed_at is not null
    and public.current_athlete_id() is not null
$$;

-- Latest definition: 20261006150000_athlete_read_scope.sql, with one condition added.
create or replace function public.get_athlete_invite_preview(p_invite_id uuid)
returns table (
  invite_id uuid,
  team_id uuid,
  team_name text,
  event_group text,
  status text,
  expires_at timestamptz,
  is_for_caller boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ai.id as invite_id,
    ai.team_id,
    t.name as team_name,
    t.event_group,
    ai.status,
    ai.expires_at,
    (
      nullif(lower(btrim(coalesce(ai.email, ''))), '') is null
      or coalesce(
        lower(btrim(ai.email)) = (
          select lower(btrim(au.email))
          from auth.users au
          where au.id = auth.uid()
            and au.email_confirmed_at is not null
        ),
        false
      )
    ) as is_for_caller
  from public.athlete_invites ai
  join public.teams t
    on t.id = ai.team_id
   and t.tenant_id = ai.tenant_id
  where ai.id = p_invite_id
    and ai.tenant_id = public.current_tenant_id()
  limit 1
$$;

-- 6c. Accepting invites: only a confirmed address counts.
-- Both functions are their latest definitions (20261006180000) with ONE line added to the
-- lookup of the caller's email: "and au.email_confirmed_at is not null". With an
-- unconfirmed address the lookup finds nothing, so an addressed invite is refused with the
-- message it already used for a wrong address.
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

  if not v_has_profile then
    insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
    values (v_user_id, v_invite.tenant_id, 'athlete', v_meta_name, true)
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

create or replace function public.accept_coach_invite(
  p_invite_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite public.coach_invites%rowtype;
  v_profile public.profiles%rowtype;
  v_display_name text;
  v_role text;
  v_target text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select lower(btrim(coalesce(au.email, '')))
  into v_user_email
  from auth.users au
  where au.id = v_user_id
    and au.email_confirmed_at is not null;

  if v_user_email is null or v_user_email = '' then
    raise exception 'Authenticated user email not found';
  end if;

  select *
  into v_invite
  from public.coach_invites ci
  where ci.id = p_invite_id
  limit 1
  for update;

  if not found then
    raise exception 'Invite not found';
  end if;

  -- Lifecycle guard (20261006180000). An invite of a suspended or cancelled club
  -- cannot be accepted by anyone, new or existing. The rule for a deactivated member
  -- further down is unchanged: an invite created after the deactivation restores
  -- access, an older one is refused.
  if public.tenant_access_blocked(v_invite.tenant_id) then
    perform public.raise_access_paused();
  end if;

  if v_invite.status = 'accepted'
     and v_invite.metadata ->> 'accepted_user_id' = v_user_id::text
     and exists (
       select 1
       from public.profiles p
       where p.user_id = v_user_id
         and p.tenant_id = v_invite.tenant_id
     ) then
    return v_invite.tenant_id;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'Invite is not pending';
  end if;

  if lower(btrim(v_invite.email)) <> v_user_email then
    raise exception 'Invite email does not match signed-in user';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Invite has expired';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  v_role := coalesce(v_invite.role, 'coach');
  if v_role not in ('coach', 'club-admin') then
    v_role := 'coach';
  end if;

  if found then
    if v_profile.tenant_id <> v_invite.tenant_id then
      raise exception 'User already belongs to another tenant';
    end if;

    if not v_profile.is_active and v_invite.created_at <= v_profile.updated_at then
      raise exception 'Your access to this club was turned off after this invite was sent. Ask your club admin for a new invite.';
    end if;

    if v_profile.role <> v_role then
      update public.profiles
      set role = v_role,
          is_active = true,
          updated_at = now()
      where user_id = v_user_id;
    else
      update public.profiles
      set is_active = true,
          updated_at = now()
      where user_id = v_user_id;
    end if;
  else
    v_display_name := nullif(coalesce(v_invite.metadata ->> 'display_name', ''), '');

    insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
    values (v_user_id, v_invite.tenant_id, v_role, v_display_name, true);
  end if;

  if v_invite.team_id is not null then
    insert into public.team_coaches (
      tenant_id,
      team_id,
      user_id,
      is_primary,
      created_by_user_id
    )
    values (
      v_invite.tenant_id,
      v_invite.team_id,
      v_user_id,
      true,
      v_invite.invited_by_user_id
    )
    on conflict (team_id, user_id) do update
    set is_primary = excluded.is_primary;
  end if;

  update public.coach_invites
  set status = 'accepted',
      accepted_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('accepted_user_id', v_user_id::text),
      updated_at = now()
  where id = v_invite.id;

  v_target := coalesce(v_user_email, v_user_id::text);

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
    v_role,
    'coach_invite_accept',
    v_target,
    case
      when v_invite.team_id is null then 'accepted without team'
      else 'accepted for team ' || v_invite.team_id::text
    end
  );

  return v_invite.tenant_id;
end;
$$;


revoke all on function public.current_athlete_email() from public, anon;
revoke all on function public.get_athlete_invite_preview(uuid) from public, anon;
revoke all on function public.accept_athlete_invite(uuid) from public, anon;
revoke all on function public.accept_coach_invite(uuid) from public, anon;
grant execute on function public.current_athlete_email() to authenticated, service_role;
grant execute on function public.get_athlete_invite_preview(uuid) to authenticated, service_role;
grant execute on function public.accept_athlete_invite(uuid) to authenticated, service_role;
grant execute on function public.accept_coach_invite(uuid) to authenticated, service_role;

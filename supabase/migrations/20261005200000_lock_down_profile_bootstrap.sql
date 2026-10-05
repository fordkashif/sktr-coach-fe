-- Lock down profile bootstrap: a profile can no longer be self-inserted
-- Created: 2026-10-05
--
-- THE HOLE
--   The policy profiles_insert_self_bootstrap (20260320115500, replaced in
--   20260324094500) let ANY signed-in user who had no profile yet insert a
--   profile row for themselves with ANY active tenant and ANY role, including
--   club-admin. The browser used it to seed a profile from the user's auth
--   metadata (tenant_id, role), and auth metadata can be set by the user at
--   sign-up or later. One insert through the public API was enough to become
--   club admin of somebody else's club: read every member, athlete and email,
--   demote or deactivate the real admin, invite accomplices, delete teams.
--
-- THE RULE FROM NOW ON
--   A profile (and an athletes row linked to a login) only comes into existence
--   through a server-side path that proves the caller is entitled to it:
--     * accept_coach_invite(invite)      pending coach invite addressed to the
--                                        caller's email (already created the
--                                        profile itself; hardened in section 4)
--     * accept_athlete_invite(invite)    pending athlete invite addressed to the
--                                        caller's email (now creates the profile
--                                        itself; section 3)
--     * bootstrap_current_profile()      approved club request whose requestor
--                                        email is the caller's email: club admin
--                                        first access (new; section 2)
--     * the service role (edge functions, SQL editor), which bypasses RLS.
--   Nobody chooses their own tenant or role any more. No path grants
--   platform-admin: that role is not a profile, it is a row in
--   platform_admin_contacts, which no API role can write.
--
-- SIBLING HOLES CLOSED HERE (each section says what was possible before)
--   1. profiles_insert_self_bootstrap                     (the hole above)
--   1. athletes_insert_self_bootstrap                     (self-created athlete row on any team)
--   3. accept_athlete_invite needed the self-insert       (flow moved server side)
--   4. accept_coach_invite: stale invite gave a deactivated member access back
--   5. provision_club_admin_tenant was callable by every signed-in user
--   6. write privileges on profiles / platform_admin_contacts for API roles
--
-- Idempotent: drop policy if exists, create or replace function, revoke/grant.
-- No table definition changes. NO existing row is modified or deleted, so a
-- profile that was created through the hole is still there after this runs.
--
-- AUDIT QUERY (read-only, run it by hand in the Supabase SQL editor)
--   Lists every profile that no legitimate path explains: no coach invite and
--   no athlete invite for that email in that club, no approved club request for
--   that email and club, and no athlete record. An empty result means the hole
--   was never used. Rows that show up are not proof of abuse (accounts seeded by
--   hand for testing show up too), but each one should be a person you
--   recognise. Check the club-admin rows first.
--   Stricter variant: someone who gave themselves an ATHLETE profile could also
--   give themselves an athlete record, which hides them from this query. To see
--   those too, delete the last "and not exists (... public.athletes ...)" block.
--
--   select
--     p.role,
--     t.name        as club,
--     u.email,
--     p.display_name,
--     p.is_active,
--     p.created_at  as profile_created_at,
--     u.created_at  as account_created_at,
--     p.user_id,
--     p.tenant_id
--   from public.profiles p
--   join public.tenants t on t.id = p.tenant_id
--   left join auth.users u on u.id = p.user_id
--   where not exists (
--           select 1 from public.coach_invites ci
--           where ci.tenant_id = p.tenant_id
--             and lower(ci.email) = lower(u.email))
--     and not exists (
--           select 1 from public.athlete_invites ai
--           where ai.tenant_id = p.tenant_id
--             and (ai.accepted_by_user_id = p.user_id or lower(ai.email) = lower(u.email)))
--     and not exists (
--           select 1 from public.tenant_provision_requests r
--           where r.provisioned_tenant_id = p.tenant_id
--             and r.status = 'approved'
--             and lower(r.requestor_email) = lower(u.email))
--     and not exists (
--           select 1 from public.athletes a
--           where a.tenant_id = p.tenant_id
--             and a.user_id = p.user_id)
--   order by (p.role = 'club-admin') desc, p.created_at desc;

-- 1. No more self-insert ------------------------------------------------------
-- Before: any signed-in user without a profile could run
--   insert into profiles (user_id, tenant_id, role) values (<me>, <any club>, 'club-admin')
-- and it was accepted.
-- After: profiles has no insert, update or delete policy at all. Every write
-- goes through a security definer function or the service role.
drop policy if exists profiles_insert_self_bootstrap on public.profiles;

-- Before: a user with an athlete profile (which anyone could give themselves,
-- see above) could insert their own athletes row with any team_id, including a
-- team they were never invited to. Only the browser bootstrap used this policy.
-- After: athletes rows for a login are created by accept_athlete_invite (from
-- the invite's team) or by staff of the club (athletes_modify_tenant_staff).
drop policy if exists athletes_insert_self_bootstrap on public.athletes;

-- 2. Club admin first access ---------------------------------------------------
-- Replaces the browser-side insert for the one flow that has no invite id to
-- accept: the requestor of an approved club request opening their access link.
--
-- Takes NO arguments. Tenant and role come only from what the database already
-- knows about the signed-in user:
--   * already has a profile                     -> returns it, changes nothing
--   * confirmed email = requestor_email of an approved request that has a
--     provisioned, active club                  -> club-admin of that club
--                                                  (latest reviewed request wins)
--   * anything else                             -> no profile is created
-- The email is read from auth.users, not from the token or from user metadata.
--
-- Always returns exactly one row. status is one of:
--   existing        the profile was already there
--   created         a club-admin profile was created just now
--   invite_pending  no profile; a pending invite is addressed to this email and
--                   has to be accepted through its own link (accept_*_invite)
--   none            no profile and nothing this user is entitled to
-- Safe to call any number of times and from two tabs at once.
create or replace function public.bootstrap_current_profile()
returns table (
  user_id uuid,
  tenant_id uuid,
  role text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_profile public.profiles%rowtype;
  v_request public.tenant_provision_requests%rowtype;
  v_created int;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  if found then
    return query select v_profile.user_id, v_profile.tenant_id, v_profile.role, 'existing'::text;
    return;
  end if;

  -- An unconfirmed address proves nothing about who the caller is.
  select lower(btrim(au.email))
  into v_email
  from auth.users au
  where au.id = v_user_id
    and au.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    return query select v_user_id, null::uuid, null::text, 'none'::text;
    return;
  end if;

  select r.*
  into v_request
  from public.tenant_provision_requests r
  join public.tenants t
    on t.id = r.provisioned_tenant_id
  where lower(btrim(r.requestor_email)) = v_email
    and r.status = 'approved'
    and r.provisioned_tenant_id is not null
    and t.is_active
  order by r.reviewed_at desc nulls last, r.created_at desc
  limit 1;

  if found then
    insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
    values (
      v_user_id,
      v_request.provisioned_tenant_id,
      'club-admin',
      nullif(btrim(coalesce(v_request.requestor_name, '')), ''),
      true
    )
    on conflict (user_id) do nothing;

    get diagnostics v_created = row_count;

    if v_created > 0 then
      insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
      values (
        v_request.provisioned_tenant_id,
        v_user_id,
        'club-admin',
        'club_admin_first_access',
        v_email,
        'Club admin profile created from approved club request ' || v_request.id::text
      );
    end if;

    -- Re-read: a second tab may have created the row between the two statements.
    select *
    into v_profile
    from public.profiles p
    where p.user_id = v_user_id
    limit 1;

    return query
    select v_profile.user_id, v_profile.tenant_id, v_profile.role,
           case when v_created > 0 then 'created' else 'existing' end;
    return;
  end if;

  if exists (
       select 1
       from public.coach_invites ci
       where lower(btrim(ci.email)) = v_email
         and ci.status = 'pending'
         and (ci.expires_at is null or ci.expires_at >= now())
     )
     or exists (
       select 1
       from public.athlete_invites ai
       where lower(btrim(ai.email)) = v_email
         and ai.status = 'pending'
         and (ai.expires_at is null or ai.expires_at >= now())
     ) then
    return query select v_user_id, null::uuid, null::text, 'invite_pending'::text;
    return;
  end if;

  return query select v_user_id, null::uuid, null::text, 'none'::text;
end;
$$;

revoke all on function public.bootstrap_current_profile() from public, anon;
grant execute on function public.bootstrap_current_profile() to authenticated, service_role;

-- 3. Athlete invite acceptance creates the profile itself -----------------------
-- Before: accept_athlete_invite refused anyone without an athlete profile, so
-- the browser first self-inserted a profile (through the policy dropped above)
-- using the tenant and role found in auth metadata, then called this function.
-- After: when the caller has no profile, this function creates the athlete
-- profile from the invite, and only when the invite is addressed to the
-- caller's own email. An invite with no email (a team join code) can still only
-- be used by someone who is already an athlete of that club, as before.
--
-- Same definition as 20260331173000_fix_athlete_invite_acceptance_bootstrap.sql
-- with these changes:
--   * the invite row is locked, so two tabs cannot accept it twice;
--   * an invite this same user already accepted returns its team again instead
--     of failing with "not pending" (a retry or double click is harmless);
--   * the profile is created from the invite when there is none.
-- Error texts are unchanged; the screens match on them.
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
  where au.id = v_user_id;

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

revoke all on function public.accept_athlete_invite(uuid) from public, anon;
grant execute on function public.accept_athlete_invite(uuid) to authenticated, service_role;

-- 4. Coach invite acceptance: a stale invite no longer restores access ----------
-- This function already created the profile itself, from the invite, for the
-- invited email only. It needs nothing from the dropped policy.
--
-- Before: for a member who already had a profile in the club, accepting ANY
-- pending invite set is_active back to true. A coach who had two invites (for
-- example a resend) used one, was later deactivated by the club admin, and
-- could then accept the other one and switch their own access back on.
-- After: a deactivated member can only come back through an invite that was
-- created AFTER their profile last changed (that is, after the deactivation),
-- or by the club admin restoring access. Older invites are refused.
--
-- Same definition as 20260324133000_team_coach_memberships.sql otherwise, plus:
--   * the invite row is locked, so two tabs cannot accept it twice;
--   * an invite this same user already accepted returns its club again instead
--     of failing with "not pending".
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
  where au.id = v_user_id;

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

revoke all on function public.accept_coach_invite(uuid) from public, anon;
grant execute on function public.accept_coach_invite(uuid) to authenticated, service_role;

-- 5. Self-serve club creation is really service-role only -----------------------
-- Before: 20260321152000 revoked provision_club_admin_tenant from anon and
-- authenticated, but every function also carries a default EXECUTE grant to
-- PUBLIC, which was left in place, so the revoke changed nothing. Any signed-in
-- user without a profile could call it and get a brand new active club with
-- themselves as club admin, skipping the request, the platform admin's approval
-- and billing. (It could not reach an existing club.)
-- After: only the service role can call it, which is what 20260321152000 meant.
revoke all on function public.provision_club_admin_tenant(text, text, text, text, date, date)
  from public, anon, authenticated;
grant execute on function public.provision_club_admin_tenant(text, text, text, text, date, date)
  to service_role;

-- 6. Table privileges: belt and braces ------------------------------------------
-- Before: anon and authenticated held INSERT/UPDATE/DELETE on these tables and
-- only RLS stood in the way, so one permissive policy (like the one dropped in
-- section 1) was enough to open them. Nothing in the app writes to either table
-- directly: profiles are written by security definer functions, and platform
-- admins are added by hand in the SQL editor.
-- After: the API roles cannot write to them even if a policy allows it. Reads
-- are unchanged. The service role and the security definer functions (which run
-- as the function owner) are not affected.
revoke insert, update, delete, truncate on public.profiles from public, anon, authenticated;
revoke insert, update, delete, truncate on public.platform_admin_contacts from public, anon, authenticated;

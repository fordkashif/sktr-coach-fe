-- Security definer functions respect deactivation, suspension and cancellation
-- Created: 2026-10-06
--
-- THE HOLE
--   20261005180000 closed every table to a deactivated member (profiles.is_active =
--   false) and to everyone in a suspended or cancelled club, by making the RLS helpers
--   answer NULL / false for them. Functions declared "security definer" do not go
--   through row policies. The ones that looked the caller up in profiles themselves
--   never checked is_active or the club's lifecycle status, so they stayed open:
--     * a deactivated athlete could still read their team, club and coach names and
--       rewrite their own athlete record (name, date of birth, events);
--     * a deactivated coach or athlete could still write to their profile through the
--       onboarding and setup guide functions;
--     * a deactivated club admin could still complete billing setup (which moves the
--       club to active_onboarding), move the club's setup step and file a package
--       upgrade request;
--     * the club admin of a SUSPENDED or CANCELLED club could still deactivate, restore
--       and re-role every member, read every member's email address, change the billing
--       contact (suspended only) and file package upgrade requests;
--     * an invite of a suspended or cancelled club could still be accepted, creating a
--       new member in it, and a deactivated athlete could still use a team join code
--       to move themselves to another team.
--
-- THE RULE FROM NOW ON
--   "Active member" has ONE definition: current_tenant_id() from 20261005180000 returns
--   a tenant. That is: auth.uid() has a profile, the profile is active, and the club's
--   latest provisioning record is not suspended or cancelled (a club with no record at
--   all, a legacy club, counts as open). caller_is_active_member() below is nothing but
--   "current_tenant_id() is not null", so the row policies and the functions can never
--   disagree about who is locked out.
--   Functions that write on behalf of the signed-in member start with
--   assert_caller_active() and are REFUSED with one error:
--       SQLSTATE 42501, hint 'access_paused', message "Your access is paused. ..."
--   (PostgREST turns 42501 into HTTP 403; the browser matches on the hint.)
--   Functions a screen calls while loading return NO ROWS instead, so nothing crashes.
--   Each function below says which of the two it does.
--
-- WHAT DELIBERATELY STILL WORKS (checked one by one, see SUPABASE_RLS_POLICY_MATRIX.md)
--   * get_current_tenant_package(): unchanged. A member of a suspended or cancelled club
--     still gets lifecycle_status back; the "access paused" page depends on it. It
--     returns the package name and the status of the caller's own club, nothing else.
--   * get_current_club_admin_activation_state(): still returns lifecycle_status to a
--     blocked club admin (same reason); the billing details are blanked for them.
--   * profiles_select_own (a row policy, not touched): a deactivated member can still
--     read their own profile row, which is how the app learns they are deactivated.
--   * bootstrap_current_profile(): unchanged. It returns the caller's own existing
--     profile (user id, club id, role) whatever its state, creates a club-admin profile
--     only for the requestor of an approved club request, and reads nothing else.
--   * A brand new user accepting an invite, and a deactivated member accepting an invite
--     that was created after the deactivation (accept_coach_invite, 20261005200000).
--   * Platform admin functions. A platform admin has no profile; those functions check
--     is_platform_admin() and never call the guard.
--   * Trigger functions and service role calls. There auth.uid() is NULL, and the guard
--     only ever refuses a signed-in user who HAS a profile. None of the functions
--     guarded here is called from a trigger.
--   * Billing setup and retry for a club in approved_pending_billing or billing_failed:
--     those statuses are not suspended or cancelled, so the admin counts as active.
--   * The public invite previews (get_public_coach_invite, get_public_athlete_invite)
--     and the public club request form (see 20261006181000).
--
-- Idempotent: create or replace function, alter policy, revoke/grant. No table
-- definition changes and no data changes. Every function is its latest definition (the
-- one in force after 20261006150000) with only the guard added; the comment above each
-- one says what the guard does there and why.

-- 1. The guard ----------------------------------------------------------------
-- caller_is_active_member(): the boolean form. True only for a signed-in user with an
-- active profile in a club that is not suspended or cancelled. It calls
-- current_tenant_id() rather than repeating its conditions.
create or replace function public.caller_is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_tenant_id() is not null
$$;

-- The one refusal. Every guarded function raises exactly this, so the browser has a
-- single thing to recognise (hint = 'access_paused').
create or replace function public.raise_access_paused()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  raise exception 'Your access is paused. Either your club''s access is paused or has ended, or a club admin turned your access off. Reload the page to see what to do next.'
    using errcode = '42501', hint = 'access_paused';
end;
$$;

-- assert_caller_active(): the raising form, called first thing by member functions.
--   * no signed-in user (service role, SQL editor, a trigger): returns. The function's
--     own "Authentication required" check still runs next, as before.
--   * active member of an open club: returns.
--   * signed-in user with NO profile (a platform admin, a brand new account): returns.
--     Every guarded function looks the caller's profile up itself and refuses a caller
--     without one with the message it always used, so that behaviour is unchanged.
--   * anything else, which can only be a deactivated member or a member of a suspended
--     or cancelled club: raises the access_paused error.
create or replace function public.assert_caller_active()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if public.caller_is_active_member() then
    return;
  end if;

  if not exists (select 1 from public.profiles p where p.user_id = auth.uid()) then
    return;
  end if;

  perform public.raise_access_paused();
end;
$$;

-- tenant_access_blocked(club): true when the club's latest provisioning record is
-- suspended or cancelled. Needed where the caller has no profile yet, so
-- current_tenant_id() has nothing to say: accepting an invite, and the edge functions
-- that create the account for an invite. The condition is the one current_tenant_id()
-- uses, written for a given club instead of the caller's club. A club with no record
-- (legacy) or a NULL status is not blocked.
create or replace function public.tenant_access_blocked(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    select tpr.lifecycle_status in ('suspended', 'cancelled')
    from public.tenant_provision_requests tpr
    where tpr.provisioned_tenant_id = p_tenant_id
    order by tpr.created_at desc
    limit 1
  ) is not distinct from true
$$;

-- caller_is_active_member() only tells a caller about themselves, so signed-in users
-- may call it. The other three are internal: the security definer functions below run
-- as the function owner, who keeps EXECUTE. The service role (edge functions) keeps
-- tenant_access_blocked.
revoke all on function public.caller_is_active_member() from public, anon;
grant execute on function public.caller_is_active_member() to authenticated, service_role;
revoke all on function public.raise_access_paused() from public, anon, authenticated;
revoke all on function public.assert_caller_active() from public, anon, authenticated;
revoke all on function public.tenant_access_blocked(uuid) from public, anon, authenticated;
grant execute on function public.tenant_access_blocked(uuid) to service_role;

-- 2. Member writes: refused with the access_paused error ----------------------
-- Each function is its latest definition with one line added at the top:
--   perform public.assert_caller_active();

-- Athlete finishing first sign-in. RAISES: it is a write on profiles and athletes.
create or replace function public.complete_current_athlete_onboarding(
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_display_name text := nullif(trim(coalesce(p_display_name, '')), '');
  v_first_name text;
  v_last_name text;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role <> 'athlete' then
    raise exception 'Only athlete users can complete athlete onboarding';
  end if;

  if v_display_name is null then
    raise exception 'Display name is required';
  end if;

  v_first_name := split_part(v_display_name, ' ', 1);
  v_last_name := nullif(trim(substr(v_display_name, length(v_first_name) + 1)), '');
  if v_last_name is null then
    v_last_name := 'Athlete';
  end if;

  update public.profiles
  set display_name = v_display_name,
      password_set_at = coalesce(password_set_at, now()),
      onboarding_completed_at = coalesce(onboarding_completed_at, now()),
      setup_guide_dismissed_at = coalesce(setup_guide_dismissed_at, null),
      updated_at = now()
  where user_id = auth.uid();

  update public.athletes
  set first_name = v_first_name,
      last_name = v_last_name,
      is_active = true,
      updated_at = now()
  where user_id = auth.uid()
    and tenant_id = v_profile.tenant_id;
end;
$$;


-- Coach finishing first sign-in. RAISES: it is a write on profiles.
create or replace function public.complete_current_coach_onboarding(
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  perform public.assert_caller_active();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.profiles
  set
    display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
    password_set_at = coalesce(password_set_at, now()),
    onboarding_completed_at = coalesce(onboarding_completed_at, now()),
    updated_at = now()
  where user_id = v_user_id
    and role = 'coach';

  if not found then
    raise exception 'Coach profile not found for current user';
  end if;
end;
$$;


-- Club admin billing setup and billing retry. RAISES for a deactivated club admin.
-- Still works for approved_pending_billing and billing_failed clubs: those are not
-- suspended or cancelled, so the guard lets their active admin through.
create or replace function public.complete_current_club_admin_mock_billing_setup(
  p_billing_contact_name text,
  p_billing_contact_email text,
  p_billing_cycle text default 'monthly'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_request public.tenant_provision_requests%rowtype;
begin
  perform public.assert_caller_active();

  if v_user_id is null then
    raise exception 'No authenticated user';
  end if;

  if p_billing_contact_name is null or btrim(p_billing_contact_name) = '' then
    raise exception 'Billing contact name is required';
  end if;

  if p_billing_contact_email is null or btrim(p_billing_contact_email) = '' then
    raise exception 'Billing contact email is required';
  end if;

  if p_billing_cycle not in ('monthly', 'annual') then
    raise exception 'Billing cycle must be monthly or annual';
  end if;

  select *
  into v_profile
  from public.profiles
  where user_id = v_user_id
    and role = 'club-admin'
  limit 1;

  if not found then
    raise exception 'Only club-admin users can complete billing setup';
  end if;

  select *
  into v_request
  from public.tenant_provision_requests
  where provisioned_tenant_id = v_profile.tenant_id
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No tenant request found for current tenant';
  end if;

  if v_request.lifecycle_status not in ('approved_pending_billing', 'billing_failed') then
    raise exception 'Billing setup is only available for approved tenants awaiting billing';
  end if;

  update public.tenant_provision_requests
  set
    billing_contact_name = btrim(p_billing_contact_name),
    billing_contact_email = lower(btrim(p_billing_contact_email)),
    billing_cycle = p_billing_cycle,
    billing_status = 'mocked_complete',
    billing_started_at = coalesce(billing_started_at, now()),
    lifecycle_status = 'active_onboarding'
  where id = v_request.id;

  update public.tenants
  set onboarding_step = coalesce(onboarding_step, 'club_profile')
  where id = v_profile.tenant_id;

  perform public.insert_platform_audit_event(
    v_user_id,
    lower(btrim(p_billing_contact_email)),
    'club-admin',
    'tenant_mock_billing_completed',
    v_request.organization_name,
    format('Mock billing setup completed for tenant %s on %s cycle', v_profile.tenant_id::text, p_billing_cycle),
    jsonb_build_object(
      'tenant_id', v_profile.tenant_id::text,
      'tenant_provision_request_id', v_request.id::text,
      'billing_cycle', p_billing_cycle,
      'billing_status', 'mocked_complete'
    )
  );

  return v_profile.tenant_id;
end;
$$;


-- Athlete setup guide flag. RAISES: it is a write on profiles.
create or replace function public.set_current_athlete_setup_guide_dismissed(
  p_dismissed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role <> 'athlete' then
    raise exception 'Only athlete users can update athlete guide state';
  end if;

  update public.profiles
  set setup_guide_dismissed_at = case when p_dismissed then now() else null end,
      updated_at = now()
  where user_id = auth.uid();
end;
$$;


-- Coach setup guide flag. RAISES: it is a write on profiles.
create or replace function public.set_current_coach_setup_guide_dismissed(
  p_dismissed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  perform public.assert_caller_active();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.profiles
  set
    setup_guide_dismissed_at = case when p_dismissed then now() else null end,
    updated_at = now()
  where user_id = v_user_id
    and role = 'coach';

  if not found then
    raise exception 'Coach profile not found for current user';
  end if;
end;
$$;


-- Club admin changes a member's role or switches access on or off. RAISES. It already
-- refused a deactivated admin; the admin of a suspended or cancelled club is new.
create or replace function public.set_tenant_member_access(
  p_user_id uuid,
  p_role text,
  p_is_active boolean
)
returns table (user_id uuid, role text, is_active boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_caller public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_other_active_admins int;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_caller
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found or v_caller.role <> 'club-admin' or not v_caller.is_active then
    raise exception 'Only active club-admin users can change member access';
  end if;

  if p_user_id is null then
    raise exception 'Member is required';
  end if;

  if p_role is null or p_role not in ('athlete', 'coach', 'club-admin') then
    raise exception 'Role must be athlete, coach or club-admin';
  end if;

  if p_is_active is null then
    raise exception 'Active flag is required';
  end if;

  -- Lock every club-admin row of the tenant (in a stable order) so two admins
  -- demoting each other at the same time cannot both pass the last-admin check.
  perform 1
  from public.profiles p
  where p.tenant_id = v_caller.tenant_id
    and p.role = 'club-admin'
  order by p.user_id
  for update;

  -- Re-read the caller now that the locks are held: a concurrent call may have
  -- demoted or deactivated them while this one was waiting.
  select *
  into v_caller
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found or v_caller.role <> 'club-admin' or not v_caller.is_active then
    raise exception 'Only active club-admin users can change member access';
  end if;

  select *
  into v_target
  from public.profiles p
  where p.user_id = p_user_id
    and p.tenant_id = v_caller.tenant_id
  for update;

  if not found then
    -- Same message for "does not exist" and "belongs to another club".
    raise exception 'Member not found in this club';
  end if;

  if v_target.user_id = auth.uid()
     and (p_role <> v_target.role or p_is_active is distinct from v_target.is_active) then
    raise exception 'You cannot change your own role or deactivate yourself';
  end if;

  if v_target.role = 'club-admin' and v_target.is_active
     and (p_role <> 'club-admin' or not p_is_active) then
    select count(*)
    into v_other_active_admins
    from public.profiles p
    where p.tenant_id = v_caller.tenant_id
      and p.role = 'club-admin'
      and p.is_active
      and p.user_id <> v_target.user_id;

    if v_other_active_admins = 0 then
      raise exception 'A club must keep at least one active club-admin';
    end if;
  end if;

  update public.profiles p
  set role = p_role,
      is_active = p_is_active,
      updated_at = now()
  where p.user_id = v_target.user_id
    and p.tenant_id = v_caller.tenant_id;

  if p_role = 'athlete' and v_target.role <> 'athlete' then
    delete from public.team_coaches tc
    where tc.user_id = v_target.user_id
      and tc.tenant_id = v_caller.tenant_id;
  end if;

  return query
  select p.user_id, p.role, p.is_active
  from public.profiles p
  where p.user_id = v_target.user_id
    and p.tenant_id = v_caller.tenant_id;
end;
$$;


-- Club admin asks for another package. RAISES. A deactivated admin and the admin of a
-- suspended or cancelled club could both still file a request and write an audit row.
create or replace function public.submit_tenant_package_upgrade_request(
  p_requested_package text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_request public.tenant_provision_requests%rowtype;
  v_existing public.tenant_package_upgrade_requests%rowtype;
  v_upgrade_id uuid;
begin
  perform public.assert_caller_active();

  select *
  into v_profile
  from public.profiles
  where user_id = auth.uid()
    and role = 'club-admin'
  limit 1;

  if v_profile.user_id is null then
    raise exception 'Only club-admin users can submit package upgrade requests.';
  end if;

  if p_requested_package not in ('starter', 'pro', 'enterprise') then
    raise exception 'Requested package is invalid.';
  end if;

  select *
  into v_request
  from public.tenant_provision_requests
  where provisioned_tenant_id = v_profile.tenant_id
  order by created_at desc
  limit 1;

  if v_request.id is null then
    raise exception 'No tenant provisioning request was found for the current tenant.';
  end if;

  if v_request.requested_plan = p_requested_package then
    raise exception 'Requested package matches the current tenant package.';
  end if;

  select *
  into v_existing
  from public.tenant_package_upgrade_requests
  where tenant_id = v_profile.tenant_id
    and status = 'pending'
  limit 1;

  if v_existing.id is not null then
    raise exception 'A pending package upgrade request already exists for this tenant.';
  end if;

  insert into public.tenant_package_upgrade_requests (
    tenant_id,
    requested_by_user_id,
    current_package,
    requested_package,
    reason,
    status
  ) values (
    v_profile.tenant_id,
    auth.uid(),
    v_request.requested_plan,
    p_requested_package,
    nullif(trim(coalesce(p_reason, '')), ''),
    'pending'
  )
  returning id into v_upgrade_id;

  insert into public.audit_events (
    tenant_id,
    actor_user_id,
    actor_role,
    action,
    target,
    detail
  ) values (
    v_profile.tenant_id,
    auth.uid(),
    'club-admin',
    'package_upgrade_requested',
    p_requested_package,
    format('Requested package upgrade from %s to %s.', v_request.requested_plan, p_requested_package)
  );

  return v_upgrade_id;
end;
$$;


-- Athlete edits their own name, date of birth and events. RAISES: it is a write on
-- athletes and profiles.
create or replace function public.update_current_athlete_profile(
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_event_group text,
  p_primary_event text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_first_name text := nullif(trim(coalesce(p_first_name, '')), '');
  v_last_name text := nullif(trim(coalesce(p_last_name, '')), '');
  v_event_group text := nullif(trim(coalesce(p_event_group, '')), '');
  v_primary_event text := nullif(trim(coalesce(p_primary_event, '')), '');
  v_athlete_id uuid;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role <> 'athlete' then
    raise exception 'Only athlete users can update an athlete profile';
  end if;

  if v_first_name is null or v_last_name is null then
    raise exception 'First name and last name are required';
  end if;

  if length(v_first_name) > 60 or length(v_last_name) > 60 then
    raise exception 'Names must be 60 characters or fewer';
  end if;

  if v_event_group is not null and length(v_event_group) > 60 then
    raise exception 'Event group must be 60 characters or fewer';
  end if;

  if v_primary_event is not null and length(v_primary_event) > 60 then
    raise exception 'Primary event must be 60 characters or fewer';
  end if;

  if p_date_of_birth is not null
     and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then
    raise exception 'Date of birth is not valid';
  end if;

  update public.athletes
  set first_name = v_first_name,
      last_name = v_last_name,
      date_of_birth = p_date_of_birth,
      event_group = v_event_group,
      primary_event = v_primary_event,
      updated_at = now()
  where user_id = auth.uid()
    and tenant_id = v_profile.tenant_id
  returning id into v_athlete_id;

  if v_athlete_id is null then
    raise exception 'Athlete record not found';
  end if;

  update public.profiles
  set display_name = v_first_name || ' ' || v_last_name,
      updated_at = now()
  where user_id = auth.uid();
end;
$$;


-- Club admin edits the billing contact. RAISES. It already refused a deactivated admin
-- and a cancelled club; the admin of a suspended club is new.
create or replace function public.update_current_club_admin_billing_contact(
  p_billing_contact_name text,
  p_billing_contact_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_request public.tenant_provision_requests%rowtype;
  v_name text := nullif(btrim(coalesce(p_billing_contact_name, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_billing_contact_email, ''))), '');
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found or v_profile.role <> 'club-admin' or not v_profile.is_active then
    raise exception 'Only active club-admin users can update the billing contact';
  end if;

  if v_name is null then
    raise exception 'Billing contact name is required';
  end if;

  if length(v_name) > 120 then
    raise exception 'Billing contact name must be 120 characters or fewer';
  end if;

  if v_email is null then
    raise exception 'Billing contact email is required';
  end if;

  if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Billing contact email is not valid';
  end if;

  select *
  into v_request
  from public.tenant_provision_requests tpr
  where tpr.provisioned_tenant_id = v_profile.tenant_id
  order by tpr.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No tenant request found for current tenant';
  end if;

  if v_request.lifecycle_status = 'cancelled' then
    raise exception 'The billing contact cannot be changed for a cancelled workspace';
  end if;

  update public.tenant_provision_requests
  set billing_contact_name = v_name,
      billing_contact_email = v_email
  where id = v_request.id;
end;
$$;


-- Club admin setup progress (and the move to 'active' on the last step). RAISES. A
-- deactivated club admin could still move the club's setup step.
create or replace function public.update_current_club_admin_onboarding_step(
  p_step text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_request public.tenant_provision_requests%rowtype;
begin
  perform public.assert_caller_active();

  if v_user_id is null then
    raise exception 'No authenticated user';
  end if;

  if p_step not in ('club_profile', 'branding', 'first_team', 'coach_access', 'review', 'complete') then
    raise exception 'Invalid onboarding step';
  end if;

  select *
  into v_profile
  from public.profiles
  where user_id = v_user_id
    and role = 'club-admin'
  limit 1;

  if not found then
    raise exception 'Only club-admin users can update onboarding progression';
  end if;

  update public.tenants
  set
    onboarding_step = p_step,
    branding_completed_at = case when p_step in ('branding', 'first_team', 'coach_access', 'review', 'complete') then coalesce(branding_completed_at, now()) else branding_completed_at end,
    first_team_completed_at = case when p_step in ('coach_access', 'review', 'complete') then coalesce(first_team_completed_at, now()) else first_team_completed_at end,
    coach_access_completed_at = case when p_step in ('review', 'complete') then coalesce(coach_access_completed_at, now()) else coach_access_completed_at end
  where id = v_profile.tenant_id;

  if p_step = 'complete' then
    select *
    into v_request
    from public.tenant_provision_requests
    where provisioned_tenant_id = v_profile.tenant_id
    order by created_at desc
    limit 1
    for update;

    if found and v_request.lifecycle_status = 'active_onboarding' then
      update public.tenant_provision_requests
      set lifecycle_status = 'active'
      where id = v_request.id;

      perform public.insert_platform_audit_event(
        p_actor_user_id := v_user_id,
        p_actor_email := auth.jwt() ->> 'email',
        p_actor_role := 'club-admin',
        p_action := 'tenant_request_lifecycle_updated',
        p_target := v_request.organization_name,
        p_detail := 'Lifecycle moved to active when the club admin finished setup.',
        p_metadata := jsonb_build_object(
          'request_id', v_request.id,
          'tenant_id', v_profile.tenant_id,
          'requestor_email', v_request.requestor_email,
          'previous_lifecycle_status', 'active_onboarding',
          'lifecycle_status', 'active',
          'billing_status', v_request.billing_status,
          'source', 'onboarding_complete'
        )
      );
    end if;
  end if;

  return v_profile.tenant_id;
end;
$$;


-- 3. Member reads: no rows instead of an error -----------------------------------

-- Athlete's team, club name and coach names. RETURNS NO ROW instead of raising: the
-- athlete profile and home screens call it while loading and treat no row as "no team".
create or replace function public.get_current_athlete_team_context()
returns table (team_id uuid, team_name text, team_event_group text, organization_name text, coach_names text)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id as team_id,
    t.name as team_name,
    t.event_group as team_event_group,
    ten.name as organization_name,
    (
      select string_agg(trim(cp.display_name), ', ' order by tc.is_primary desc, trim(cp.display_name))
      from public.team_coaches tc
      join public.profiles cp
        on cp.user_id = tc.user_id
       and cp.tenant_id = tc.tenant_id
      where tc.team_id = t.id
        and tc.tenant_id = a.tenant_id
        and nullif(trim(coalesce(cp.display_name, '')), '') is not null
    ) as coach_names
  from public.athletes a
  join public.profiles me
    on me.user_id = a.user_id
   and me.tenant_id = a.tenant_id
  join public.teams t
    on t.id = a.team_id
   and t.tenant_id = a.tenant_id
  join public.tenants ten on ten.id = a.tenant_id
  where a.user_id = auth.uid()
    and public.caller_is_active_member()
  limit 1;
$$;


-- Every member's email address, for the club admin Users screen. RETURNS NO ROWS
-- instead of raising. It already answered nothing to a deactivated admin; the admin of
-- a suspended or cancelled club still got every address.
create or replace function public.get_tenant_member_emails()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, lower(u.email::text) as email
  from public.profiles me
  join public.profiles p
    on p.tenant_id = me.tenant_id
  join auth.users u
    on u.id = p.user_id
  where me.user_id = auth.uid()
    and me.role = 'club-admin'
    and me.is_active
    and public.caller_is_active_member()
    and u.email is not null;
$$;


-- 4. Invite acceptance --------------------------------------------------------------
-- Latest definitions: 20261005200000_lock_down_profile_bootstrap.sql.

-- Athlete invite acceptance. RAISES for an invite of a suspended or cancelled club and
-- for a deactivated athlete. A brand new user with no profile and an active athlete
-- are handled exactly as in 20261005200000.
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


-- Coach invite acceptance. RAISES for an invite of a suspended or cancelled club.
-- Everything else is 20261005200000, including: a brand new user gets their profile
-- from the invite, and a deactivated member comes back only through an invite created
-- after the deactivation.
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


-- 5. The one read a blocked club admin keeps -----------------------------------------
-- Latest definition: 20260402152000_tenant_billing_gate_and_activation_functions.sql.

-- Club admin activation state. KEEPS ANSWERING, because the route guard reads the
-- club's lifecycle_status from it to choose between the app and the "access paused" /
-- "access ended" notice. For a caller who is not an active member of an open club it
-- now returns tenant_id and lifecycle_status only: the billing contact name and email,
-- billing status, provider, cycle and the setup step come back NULL.
create or replace function public.get_current_club_admin_activation_state()
returns table (tenant_id uuid, lifecycle_status text, billing_status text, billing_provider text, billing_contact_name text, billing_contact_email text, billing_cycle text, onboarding_step text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_open boolean := public.caller_is_active_member();
begin
  if v_user_id is null then
    raise exception 'No authenticated user';
  end if;

  return query
  select
    p.tenant_id,
    tpr.lifecycle_status,
    case when v_open then tpr.billing_status end,
    case when v_open then tpr.billing_provider end,
    case when v_open then tpr.billing_contact_name end,
    case when v_open then tpr.billing_contact_email end,
    case when v_open then tpr.billing_cycle end,
    case when v_open then t.onboarding_step end
  from public.profiles p
  join public.tenants t
    on t.id = p.tenant_id
  left join public.tenant_provision_requests tpr
    on tpr.provisioned_tenant_id = p.tenant_id
  where p.user_id = v_user_id
    and p.role = 'club-admin'
  order by tpr.created_at desc nulls last
  limit 1;
end;
$$;


-- 6. Package upgrade request policies ------------------------------------------
-- These two policies look the caller up in profiles themselves. 20261005180000 added
-- is_active to them but not the club's status, so the admin of a suspended or cancelled
-- club could still read the club's package requests and insert one straight into the
-- table, around submit_tenant_package_upgrade_request. They now use the same helpers as
-- every other club admin policy. alter policy keeps the policy in place.
alter policy tenant_package_upgrade_requests_club_admin_select
on public.tenant_package_upgrade_requests
using (
  public.is_club_admin()
  and tenant_id = public.current_tenant_id()
);

alter policy tenant_package_upgrade_requests_club_admin_insert
on public.tenant_package_upgrade_requests
with check (
  requested_by_user_id = auth.uid()
  and public.is_club_admin()
  and tenant_id = public.current_tenant_id()
);

-- 7. Grants ----------------------------------------------------------------------
-- The functions below are for signed-in users only, but most were created without a
-- revoke, so they kept the default EXECUTE for PUBLIC and anon. Each one already
-- refuses a caller with no session, so this changes no behaviour; it just stops the
-- public API from offering them to visitors who are not signed in.
revoke all on function public.complete_current_athlete_onboarding(text) from public, anon;
revoke all on function public.complete_current_coach_onboarding(text) from public, anon;
revoke all on function public.complete_current_club_admin_mock_billing_setup(text, text, text) from public, anon;
revoke all on function public.set_current_athlete_setup_guide_dismissed(boolean) from public, anon;
revoke all on function public.set_current_coach_setup_guide_dismissed(boolean) from public, anon;
revoke all on function public.set_tenant_member_access(uuid, text, boolean) from public, anon;
revoke all on function public.submit_tenant_package_upgrade_request(text, text) from public, anon;
revoke all on function public.update_current_athlete_profile(text, text, date, text, text) from public, anon;
revoke all on function public.update_current_club_admin_billing_contact(text, text) from public, anon;
revoke all on function public.update_current_club_admin_onboarding_step(text) from public, anon;
revoke all on function public.get_current_athlete_team_context() from public, anon;
revoke all on function public.get_tenant_member_emails() from public, anon;
revoke all on function public.get_current_club_admin_activation_state() from public, anon;
revoke all on function public.accept_athlete_invite(uuid) from public, anon;
revoke all on function public.accept_coach_invite(uuid) from public, anon;
-- Platform admin functions: same tidy-up, their is_platform_admin() checks are untouched.
revoke all on function public.approve_and_provision_tenant_request(uuid, text) from public, anon;
revoke all on function public.review_tenant_provision_request(uuid, text, text) from public, anon;
revoke all on function public.review_tenant_package_upgrade_request(uuid, text, text) from public, anon;
revoke all on function public.log_platform_admin_export(text, text, integer, jsonb) from public, anon;

grant execute on function public.complete_current_athlete_onboarding(text) to authenticated, service_role;
grant execute on function public.complete_current_coach_onboarding(text) to authenticated, service_role;
grant execute on function public.complete_current_club_admin_mock_billing_setup(text, text, text) to authenticated, service_role;
grant execute on function public.set_current_athlete_setup_guide_dismissed(boolean) to authenticated, service_role;
grant execute on function public.set_current_coach_setup_guide_dismissed(boolean) to authenticated, service_role;
grant execute on function public.set_tenant_member_access(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.submit_tenant_package_upgrade_request(text, text) to authenticated, service_role;
grant execute on function public.update_current_athlete_profile(text, text, date, text, text) to authenticated, service_role;
grant execute on function public.update_current_club_admin_billing_contact(text, text) to authenticated, service_role;
grant execute on function public.update_current_club_admin_onboarding_step(text) to authenticated, service_role;
grant execute on function public.get_current_athlete_team_context() to authenticated, service_role;
grant execute on function public.get_tenant_member_emails() to authenticated, service_role;
grant execute on function public.get_current_club_admin_activation_state() to authenticated, service_role;
grant execute on function public.accept_athlete_invite(uuid) to authenticated, service_role;
grant execute on function public.accept_coach_invite(uuid) to authenticated, service_role;
grant execute on function public.approve_and_provision_tenant_request(uuid, text) to authenticated, service_role;
grant execute on function public.review_tenant_provision_request(uuid, text, text) to authenticated, service_role;
grant execute on function public.review_tenant_package_upgrade_request(uuid, text, text) to authenticated, service_role;
grant execute on function public.log_platform_admin_export(text, text, integer, jsonb) to authenticated, service_role;

-- notification_channel_enabled(channel, event, user, email) answers whether ANY user or
-- email address has switched a notification off, to anyone who asks, signed in or not.
-- The browser never calls it. Its callers are the notification trigger (security
-- definer, runs as the owner) and the edge functions (service role).
revoke all on function public.notification_channel_enabled(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.notification_channel_enabled(text, text, uuid, text) to service_role;

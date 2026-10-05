-- Tenant lifecycle enforcement: deactivated members, suspended and cancelled
-- clubs, activation on setup complete, request review auditing, live club sizes
-- Created: 2026-10-05
--
-- What the screens said was "not enforced yet", and what this file changes:
--   1. A deactivated member (profiles.is_active = false) kept full access,
--      because no policy looked at the flag.
--   2. A suspended or cancelled club kept full access, because lifecycle_status
--      was a label on the provisioning record and nothing else.
--   3. A club stayed in active_onboarding forever unless a platform admin
--      clicked "Mark active".
--   4. Reviewing a club request stopped writing a platform audit event in
--      20260402152000.
--   5. A platform admin could not see how many teams, coaches and athletes a
--      club really has.
--   6. insert_platform_audit_event could be called by anyone, signed in or not.
--   7. set_tenant_request_lifecycle_state matched the admin by exact email only
--      and accepted any status from any status.
--
-- Idempotent. Only: create index if not exists, create or replace function,
-- alter policy, revoke/grant, and one guarded data change (section 3). Nothing
-- is dropped and no table definition changes.

-- 0. Index ------------------------------------------------------------------
-- "The latest provisioning record of a tenant" is looked up from inside the RLS
-- helpers, so it runs once per row checked. This index makes it a single
-- backward-ordered index probe. (The column is provisioned_tenant_id; the table
-- has no tenant_id column.)
create index if not exists tenant_provision_requests_tenant_created_idx
on public.tenant_provision_requests (provisioned_tenant_id, created_at desc);

-- 1. RLS helpers: inactive members and blocked clubs -------------------------
-- Every tenant-scoped policy compares tenant_id with current_tenant_id(), and
-- every role check goes through is_coach_or_admin() / is_club_admin(). Making
-- the helpers answer NULL / false is therefore enough to shut every
-- tenant-scoped policy, with no policy rewritten.
--
-- current_tenant_id() and current_app_role() are the definitions from
-- 20260320113000_schema_v1_rls_policies.sql with two conditions added:
--   * p.is_active: a deactivated member has no tenant and no role.
--   * the tenant's LATEST provisioning record is not 'suspended' or
--     'cancelled'. A tenant with no provisioning record at all (legacy
--     tenants) yields NULL from the subquery, "NULL is distinct from true"
--     holds, and the tenant is treated as active. Same for a NULL status.
--
-- is_coach_or_admin() and is_club_admin() keep their meaning (the caller's role
-- is coach or club-admin / is club-admin) but are rewritten to read profiles
-- directly instead of calling current_app_role(). Reason: they are evaluated
-- once per row in most policies, and a SQL function that calls another
-- non-inlinable SQL function re-plans the inner one on every call. Measured on
-- a throwaway Postgres 16 with 4,000 provisioning records: the nested form cost
-- about 40 microseconds per call before this file and 88 with the lifecycle
-- lookup added; the direct form costs about 10. A coach reading 6,000 sessions
-- went from 370 ms (before this file) to about 150 ms.
--
-- What deliberately still works, because it does not use these helpers:
--   * profiles_select_own (user_id = auth.uid()): a deactivated or suspended
--     member can still read their own profile row, so the app can tell them
--     why they are locked out instead of looping to the login page.
--   * profiles_insert_self_bootstrap (is_active_tenant(), which reads
--     tenants.is_active): a brand new user can still create their profile.
--   * get_public_coach_invite / get_public_athlete_invite, accept_*_invite and
--     the complete_current_*_onboarding functions: security definer, they read
--     profiles and invites directly.
--   * get_current_tenant_package() and get_current_club_admin_activation_state():
--     security definer, they join profiles directly and never call
--     current_tenant_id(), so a member of a suspended club still gets
--     lifecycle_status = 'suspended' back. That is the one read the "this club
--     is paused" screen needs.
--   * A user's own notifications and notification preferences (keyed on
--     auth.uid() / email, not on the tenant).
--
-- Cost: one extra index probe on tenant_provision_requests per evaluation, next
-- to the existing primary key probe on profiles. All four functions stay STABLE.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.tenant_id
  from public.profiles p
  where p.user_id = auth.uid()
    and p.is_active
    and (
      select tpr.lifecycle_status in ('suspended', 'cancelled')
      from public.tenant_provision_requests tpr
      where tpr.provisioned_tenant_id = p.tenant_id
      order by tpr.created_at desc
      limit 1
    ) is distinct from true
  limit 1
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.user_id = auth.uid()
    and p.is_active
    and (
      select tpr.lifecycle_status in ('suspended', 'cancelled')
      from public.tenant_provision_requests tpr
      where tpr.provisioned_tenant_id = p.tenant_id
      order by tpr.created_at desc
      limit 1
    ) is distinct from true
  limit 1
$$;

create or replace function public.is_coach_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('coach', 'club-admin')
      and p.is_active
      and (
        select tpr.lifecycle_status in ('suspended', 'cancelled')
        from public.tenant_provision_requests tpr
        where tpr.provisioned_tenant_id = p.tenant_id
        order by tpr.created_at desc
        limit 1
      ) is distinct from true
  )
$$;

create or replace function public.is_club_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'club-admin'
      and p.is_active
      and (
        select tpr.lifecycle_status in ('suspended', 'cancelled')
        from public.tenant_provision_requests tpr
        where tpr.provisioned_tenant_id = p.tenant_id
        order by tpr.created_at desc
        limit 1
      ) is distinct from true
  )
$$;

-- The two club admin policies on tenant_package_upgrade_requests looked the
-- caller up in profiles themselves instead of using the helpers, so they would
-- have stayed open to a deactivated club admin. Only "and p.is_active" is added
-- (alter policy keeps the policy in place, nothing is dropped). The admin of a
-- suspended club can still read the club's own package requests here; writes
-- go through submit_tenant_package_upgrade_request.
alter policy tenant_package_upgrade_requests_club_admin_select
on public.tenant_package_upgrade_requests
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.tenant_id = tenant_package_upgrade_requests.tenant_id
      and p.role = 'club-admin'
      and p.is_active
  )
);

alter policy tenant_package_upgrade_requests_club_admin_insert
on public.tenant_package_upgrade_requests
with check (
  requested_by_user_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.tenant_id = tenant_package_upgrade_requests.tenant_id
      and p.role = 'club-admin'
      and p.is_active
  )
);

-- 2. Platform audit insert is internal only ----------------------------------
-- insert_platform_audit_event had no grants of its own, so it kept the default
-- EXECUTE for PUBLIC (and Supabase's default grants to anon and authenticated).
-- Any visitor could call it through the API and write any audit row, with any
-- actor, into the platform audit.
-- The browser never calls it directly: every caller is another security definer
-- function (review, provision, lifecycle, billing setup, export logging through
-- log_platform_admin_export), and those run as the function owner, who keeps
-- EXECUTE. So the minimal safe change is to take EXECUTE away from the API
-- roles. The function body is untouched. service_role keeps it for edge
-- functions.
revoke all on function public.insert_platform_audit_event(uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_platform_audit_event(uuid, text, text, text, text, text, jsonb)
  to service_role;

-- 3. Clubs become active when setup finishes ---------------------------------
-- Same definition as 20260402165000_club_admin_onboarding_step_progression.sql.
-- The only addition is the block after the tenants update: on step 'complete',
-- the tenant's latest provisioning record moves from active_onboarding to
-- active and a platform audit event is written in the same shape
-- set_tenant_request_lifecycle_state uses (action
-- tenant_request_lifecycle_updated, target = club name, lifecycle_status in the
-- metadata). Only active_onboarding moves: a suspended, cancelled or
-- billing-blocked club is left alone, and a second call finds the record already
-- active and does nothing, so there is one audit row however often it runs.
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

grant execute on function public.update_current_club_admin_onboarding_step(text) to authenticated;

-- One-off catch-up for clubs that finished setup before this file existed:
-- club_profiles.onboarding_completed_at is set and the tenant's LATEST
-- provisioning record is still active_onboarding. Each moved record gets one
-- audit row with actor role 'system'. Running it again matches nothing, because
-- the moved records are no longer active_onboarding.
with latest as (
  select distinct on (tpr.provisioned_tenant_id)
    tpr.id,
    tpr.provisioned_tenant_id,
    tpr.lifecycle_status
  from public.tenant_provision_requests tpr
  where tpr.provisioned_tenant_id is not null
  order by tpr.provisioned_tenant_id, tpr.created_at desc
),
moved as (
  update public.tenant_provision_requests tpr
  set lifecycle_status = 'active'
  from latest l
  join public.club_profiles cp
    on cp.tenant_id = l.provisioned_tenant_id
  where tpr.id = l.id
    and l.lifecycle_status = 'active_onboarding'
    and tpr.lifecycle_status = 'active_onboarding'
    and cp.onboarding_completed_at is not null
  returning tpr.id, tpr.provisioned_tenant_id, tpr.organization_name, tpr.requestor_email, tpr.billing_status
)
insert into public.platform_audit_events (actor_user_id, actor_email, actor_role, action, target, detail, metadata)
select
  null,
  null,
  'system',
  'tenant_request_lifecycle_updated',
  m.organization_name,
  'Lifecycle moved to active: setup was already finished before activation became automatic.',
  jsonb_build_object(
    'request_id', m.id,
    'tenant_id', m.provisioned_tenant_id,
    'requestor_email', m.requestor_email,
    'previous_lifecycle_status', 'active_onboarding',
    'lifecycle_status', 'active',
    'billing_status', m.billing_status,
    'source', 'migration_20261005180000'
  )
from moved m;

-- 4. Request reviews are audited again ---------------------------------------
-- Same definition as 20260402152000_tenant_billing_gate_and_activation_functions.sql
-- with the audit insert from 20260322193000 put back at the end. Two details of
-- that insert follow what the screens read today rather than the 2026-03-22
-- text:
--   * target is the club name (it was the requestor email), like every other
--     lifecycle event, because the audit sentence is "<target> was approved".
--     The requestor email moves into the metadata.
--   * metadata carries both 'status' and 'to_status' (the Clubs history reads
--     'status', the audit page reads either).
-- Approving through approve_and_provision_tenant_request calls this function,
-- so an approval writes two events as it did before 2026-04-02: reviewed, then
-- provisioned.
create or replace function public.review_tenant_provision_request(
  p_request_id uuid,
  p_status text,
  p_review_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.tenant_provision_requests%rowtype;
  v_subject text;
  v_body text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform-admin users can review tenant provision requests';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'Review status must be approved or rejected';
  end if;

  select *
  into v_request
  from public.tenant_provision_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Tenant provision request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Only pending requests can be reviewed';
  end if;

  update public.tenant_provision_requests
  set status = p_status,
      lifecycle_status = case
        when p_status = 'approved' then 'approved_pending_billing'
        else 'cancelled'
      end,
      billing_status = case
        when p_status = 'approved' then coalesce(billing_status, 'pending')
        else 'cancelled'
      end,
      reviewed_by_user_id = auth.uid(),
      review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
      reviewed_at = now()
  where id = p_request_id;

  v_subject := case
    when p_status = 'approved' then 'Tenant request approved'
    else 'Tenant request rejected'
  end;

  v_body := case
    when p_status = 'approved' then format(
      'Your request for %s has been approved. Billing setup is the next step before workspace activation.',
      v_request.organization_name
    )
    else format(
      'Your request for %s has been rejected. %s',
      v_request.organization_name,
      coalesce(nullif(btrim(coalesce(p_review_notes, '')), ''), 'No review note was provided.')
    )
  end;

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
  values (
    null,
    v_request.submitted_by_user_id,
    v_request.requestor_email,
    'email',
    'tenant_provision_request_reviewed',
    v_subject,
    v_body,
    'pending',
    jsonb_build_object(
      'tenant_provision_request_id', v_request.id::text,
      'status', p_status,
      'lifecycle_status', case when p_status = 'approved' then 'approved_pending_billing' else 'cancelled' end
    )
  );

  if v_request.submitted_by_user_id is not null then
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
    values (
      null,
      v_request.submitted_by_user_id,
      v_request.requestor_email,
      'in-app',
      'tenant_provision_request_reviewed',
      v_subject,
      v_body,
      'pending',
      jsonb_build_object(
        'tenant_provision_request_id', v_request.id::text,
        'status', p_status,
        'lifecycle_status', case when p_status = 'approved' then 'approved_pending_billing' else 'cancelled' end
      )
    );
  end if;

  perform public.insert_platform_audit_event(
    auth.uid(),
    auth.jwt() ->> 'email',
    'platform-admin',
    'tenant_provision_request_reviewed',
    v_request.organization_name,
    format('Request for %s moved from pending to %s', v_request.organization_name, p_status),
    jsonb_build_object(
      'tenant_provision_request_id', v_request.id::text,
      'organization_name', v_request.organization_name,
      'requestor_email', v_request.requestor_email,
      'from_status', 'pending',
      'to_status', p_status,
      'status', p_status,
      'lifecycle_status', case when p_status = 'approved' then 'approved_pending_billing' else 'cancelled' end,
      'review_notes', nullif(btrim(coalesce(p_review_notes, '')), '')
    )
  );
end;
$$;

grant execute on function public.review_tenant_provision_request(uuid, text, text) to authenticated;

-- 5. Real club sizes for the platform admin ----------------------------------
-- A platform admin has no profile, so current_tenant_id() is NULL for them and
-- they cannot read teams, profiles or athletes. This returns counts only, one
-- row per tenant, and zero rows for anyone who is not a platform admin.
-- The three counts are the ones package limits are checked against in
-- src/lib/tenant/package-enforcement.ts:
--   team_count    teams that are not archived (neither is_archived nor status 'archived')
--   coach_count   profiles with role 'coach' and is_active
--   athlete_count every athletes row of the tenant
create or replace function public.get_platform_tenant_sizes()
returns table (
  tenant_id uuid,
  team_count bigint,
  coach_count bigint,
  athlete_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id as tenant_id,
    (
      select count(*)
      from public.teams tm
      where tm.tenant_id = t.id
        and not tm.is_archived
        and tm.status <> 'archived'
    ) as team_count,
    (
      select count(*)
      from public.profiles p
      where p.tenant_id = t.id
        and p.role = 'coach'
        and p.is_active
    ) as coach_count,
    (
      select count(*)
      from public.athletes a
      where a.tenant_id = t.id
    ) as athlete_count
  from public.tenants t
  where public.is_platform_admin();
$$;

revoke all on function public.get_platform_tenant_sizes() from public, anon;
grant execute on function public.get_platform_tenant_sizes() to authenticated;

-- 6. Lifecycle changes by the platform admin ---------------------------------
-- Two changes to 20260402183000_platform_admin_lifecycle_controls.sql:
--
-- a) The admin check is is_platform_admin() (linked user id, or email compared
--    case-insensitively) instead of an exact match on the email column, so the
--    same person is an admin here as everywhere else.
--
-- b) Only these moves are accepted. "from" is the record's current
--    lifecycle_status; a NULL status on a record from before lifecycle existed
--    is read as approved_pending_billing when the request is approved and as
--    pending_review otherwise, the same way the screens read it.
--
--      from                       to
--      pending_review             (none: use review_tenant_provision_request)
--      approved_pending_billing   billing_failed, cancelled
--      billing_failed             approved_pending_billing, cancelled
--      active_onboarding          active, suspended, billing_failed, cancelled
--      active                     suspended, billing_failed, cancelled
--      suspended                  active, active_onboarding, cancelled,
--                                 or back to previous_lifecycle_status
--      cancelled                  approved_pending_billing, active (restore)
--
--    Also refused: a move to the status the record already has; a move to
--    active_onboarding, active or suspended for a record with no tenant (there
--    is no club to activate or suspend); and anything on a request that was
--    never approved.
--
--    These are every move the screens offer:
--      Clubs:        active_onboarding -> active; approved_pending_billing ->
--                    billing_failed; active / active_onboarding -> suspended;
--                    suspended -> previous or active; any -> cancelled
--      Club billing: approved_pending_billing / active_onboarding / active ->
--                    billing_failed; billing_failed -> approved_pending_billing
--      Requests:     the same suspend, cancel, billing and reactivate moves,
--                    plus restore: cancelled -> active or approved_pending_billing
--
-- Suspending or cancelling now blocks the club (section 1). Moving back out of
-- either status gives access back at once. The audit event keeps its action and
-- metadata keys and gains previous_lifecycle_status.
create or replace function public.set_tenant_request_lifecycle_state(
  p_request_id uuid,
  p_lifecycle_status text,
  p_billing_status text default null,
  p_review_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_email text := lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''));
  v_request public.tenant_provision_requests%rowtype;
  v_from text;
  v_allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Only active platform admins can update tenant lifecycle.';
  end if;

  select *
  into v_request
  from public.tenant_provision_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Tenant provisioning request not found.';
  end if;

  if p_lifecycle_status is null
     or p_lifecycle_status not in ('approved_pending_billing', 'billing_failed', 'active_onboarding', 'active', 'suspended', 'cancelled') then
    raise exception 'Unsupported lifecycle status %.', coalesce(p_lifecycle_status, 'null');
  end if;

  if v_request.status <> 'approved' then
    raise exception 'Only approved requests have a lifecycle to change. Review the request first.';
  end if;

  v_from := coalesce(v_request.lifecycle_status, 'approved_pending_billing');

  if v_from = p_lifecycle_status then
    raise exception 'This club is already %.', replace(p_lifecycle_status, '_', ' ');
  end if;

  if p_lifecycle_status in ('active_onboarding', 'active', 'suspended')
     and v_request.provisioned_tenant_id is null then
    raise exception 'This request has no club workspace yet, so it cannot be moved to %.', replace(p_lifecycle_status, '_', ' ');
  end if;

  v_allowed := case v_from
    when 'approved_pending_billing' then p_lifecycle_status in ('billing_failed', 'cancelled')
    when 'billing_failed' then p_lifecycle_status in ('approved_pending_billing', 'cancelled')
    when 'active_onboarding' then p_lifecycle_status in ('active', 'suspended', 'billing_failed', 'cancelled')
    when 'active' then p_lifecycle_status in ('suspended', 'billing_failed', 'cancelled')
    when 'suspended' then
      p_lifecycle_status in ('active', 'active_onboarding', 'cancelled')
      or p_lifecycle_status = v_request.previous_lifecycle_status
    when 'cancelled' then p_lifecycle_status in ('approved_pending_billing', 'active')
    else false
  end;

  if not coalesce(v_allowed, false) then
    raise exception 'A club cannot move from % to %.', replace(v_from, '_', ' '), replace(p_lifecycle_status, '_', ' ');
  end if;

  update public.tenant_provision_requests
  set lifecycle_status = p_lifecycle_status,
      previous_lifecycle_status = case
        when p_lifecycle_status = 'suspended' and lifecycle_status is distinct from 'suspended' then v_from
        when lifecycle_status = 'suspended' and p_lifecycle_status <> 'suspended' then null
        else previous_lifecycle_status
      end,
      billing_status = coalesce(p_billing_status, billing_status),
      billing_failed_at = case when p_lifecycle_status = 'billing_failed' then now() else billing_failed_at end,
      review_notes = coalesce(nullif(trim(coalesce(p_review_notes, '')), ''), review_notes),
      reviewed_at = case when reviewed_at is null then now() else reviewed_at end
  where id = p_request_id;

  perform public.insert_platform_audit_event(
    p_actor_user_id := auth.uid(),
    p_actor_email := v_actor_email,
    p_actor_role := 'platform-admin',
    p_action := 'tenant_request_lifecycle_updated',
    p_target := v_request.organization_name,
    p_detail := format('Lifecycle moved to %s.', p_lifecycle_status),
    p_metadata := jsonb_build_object(
      'request_id', p_request_id,
      'requestor_email', v_request.requestor_email,
      'previous_lifecycle_status', v_from,
      'lifecycle_status', p_lifecycle_status,
      'billing_status', coalesce(p_billing_status, v_request.billing_status),
      'review_notes', nullif(trim(coalesce(p_review_notes, '')), '')
    )
  );
end;
$$;

revoke all on function public.set_tenant_request_lifecycle_state(uuid, text, text, text) from public, anon;
grant execute on function public.set_tenant_request_lifecycle_state(uuid, text, text, text) to authenticated;

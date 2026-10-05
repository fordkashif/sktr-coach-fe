-- Club admin member access, member emails, billing contact, tenant package read
-- and billing retry after a failed billing attempt
-- Created: 2026-10-05
--
-- The club admin screens need four things RLS alone does not give them:
--   1. Changing a member's role / active flag (profiles has no update policy,
--      and a row-level policy could not stop tenant_id or user_id changing).
--   2. Member emails (they live in auth.users, which the API never exposes).
--   3. Editing the billing contact on the club's provisioning record
--      (tenant_provision_requests is only updatable by platform admins).
--   4. Reading the club's package for limit enforcement (the provisioning
--      record is only readable by the original requestor, so limits were
--      silently skipped for every other admin and for coaches).
-- Each goes through a security definer function that checks the caller and
-- touches an explicit list of columns.
-- Idempotent: only create or replace function + grant. No table changes,
-- no data backfills.

-- 1. Member role and active flag -------------------------------------------
--
-- Consistency choice when a role or active flag changes:
--   * Changing a member to 'athlete' removes their team_coaches rows in this
--     tenant. Those rows are staff assignments (they grant coach access to a
--     team and list the person as a coach to athletes), so they must not
--     outlive the staff role. coach <-> club-admin keeps them, because club
--     admins can coach teams too.
--   * Deactivating keeps team_coaches rows. Deactivation is reversible and
--     reactivating should restore the same team assignments.
--   * athletes rows are never touched. They carry training data (sessions,
--     results, wellness) and their own roster is_active flag owned by
--     coaches. A coach promoted from athlete keeps their history; a member
--     changed to athlete does not get an athletes row created here (that
--     needs a name and team and is done by the athlete invite/onboarding
--     flow).
--   * Nothing is deleted from training, invite or audit tables.
create or replace function public.set_tenant_member_access(
  p_user_id uuid,
  p_role text,
  p_is_active boolean
)
returns table (
  user_id uuid,
  role text,
  is_active boolean
)
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

revoke all on function public.set_tenant_member_access(uuid, text, boolean) from public, anon;
grant execute on function public.set_tenant_member_access(uuid, text, boolean) to authenticated;

-- 2. Member emails ----------------------------------------------------------
-- Emails live in auth.users. Only an active club-admin gets them, and only for
-- profiles in their own tenant. Any other caller gets zero rows.
create or replace function public.get_tenant_member_emails()
returns table (
  user_id uuid,
  email text
)
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
    and u.email is not null;
$$;

revoke all on function public.get_tenant_member_emails() from public, anon;
grant execute on function public.get_tenant_member_emails() to authenticated;

-- 3. Billing contact --------------------------------------------------------
-- Updates only billing_contact_name and billing_contact_email on the latest
-- provisioning record of the caller's tenant. Lifecycle and billing status are
-- left alone. A cancelled workspace cannot be edited.
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

revoke all on function public.update_current_club_admin_billing_contact(text, text) from public, anon;
grant execute on function public.update_current_club_admin_billing_contact(text, text) to authenticated;

-- 4. Tenant package ---------------------------------------------------------
-- Any member of the tenant (club-admin, coach or athlete) can read the plan key
-- and lifecycle status of their own tenant, and nothing else from the
-- provisioning record. Package limits are enforced client side for admins
-- adding teams/coaches and for coaches inviting athletes, and both need this.
-- requested_plan is the plan in force: approving an upgrade request rewrites it.
-- Returns zero rows when the tenant has no provisioning record.
create or replace function public.get_current_tenant_package()
returns table (
  requested_plan text,
  lifecycle_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select tpr.requested_plan, tpr.lifecycle_status
  from public.profiles me
  join public.tenant_provision_requests tpr
    on tpr.provisioned_tenant_id = me.tenant_id
  where me.user_id = auth.uid()
  order by tpr.created_at desc
  limit 1;
$$;

revoke all on function public.get_current_tenant_package() from public, anon;
grant execute on function public.get_current_tenant_package() to authenticated;

-- 5. Billing retry ----------------------------------------------------------
-- A club whose lifecycle status is billing_failed is sent to
-- /club-admin/setup/billing, but this function only accepted
-- approved_pending_billing, so the club could never get out. Same signature and
-- body as 20260402152000_tenant_billing_gate_and_activation_functions.sql; the
-- only change is the lifecycle check, which now also accepts billing_failed.
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

grant execute on function public.complete_current_club_admin_mock_billing_setup(text, text, text) to authenticated;

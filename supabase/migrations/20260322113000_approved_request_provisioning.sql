-- Controlled provisioning from approved tenant requests
-- Created: 2026-03-22

create or replace function public.approve_and_provision_tenant_request(
  p_request_id uuid,
  p_review_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.tenant_provision_requests%rowtype;
  v_base_slug text;
  v_slug text;
  v_tenant_id uuid;
  v_short_name text;
  v_season_year text;
  v_season_start date;
  v_season_end date;
  v_subject text;
  v_body text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform-admin users can approve and provision tenant requests';
  end if;

  select *
  into v_request
  from public.tenant_provision_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Tenant provision request not found';
  end if;

  if v_request.status not in ('pending', 'approved') then
    raise exception 'Only pending or approved requests can be provisioned';
  end if;

  if v_request.provisioned_tenant_id is not null then
    return v_request.provisioned_tenant_id;
  end if;

  v_base_slug := lower(regexp_replace(btrim(v_request.organization_name), '[^a-z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then
    v_base_slug := 'club';
  end if;

  v_slug := v_base_slug;
  if exists (select 1 from public.tenants t where t.slug = v_slug) then
    v_slug := v_base_slug || '-' || substring(replace(v_request.id::text, '-', ''), 1, 6);
  end if;

  v_short_name := upper(left(regexp_replace(btrim(v_request.organization_name), '[^A-Za-z0-9]+', '', 'g'), 10));
  if v_short_name = '' then
    v_short_name := 'CLUB';
  end if;

  v_season_year := extract(year from now())::text;
  v_season_start := make_date(extract(year from now())::int, 1, 15);
  v_season_end := make_date(extract(year from now())::int, 10, 31);

  insert into public.tenants (slug, name, is_active)
  values (v_slug, btrim(v_request.organization_name), true)
  returning id into v_tenant_id;

  insert into public.club_profiles (
    tenant_id,
    club_name,
    short_name,
    primary_color,
    season_year,
    season_start,
    season_end
  )
  values (
    v_tenant_id,
    btrim(v_request.organization_name),
    v_short_name,
    '#1368ff',
    v_season_year,
    v_season_start,
    v_season_end
  );

  insert into public.billing_profiles (
    tenant_id,
    plan,
    seats,
    renewal_date,
    payment_method_last4
  )
  values (
    v_tenant_id,
    v_request.requested_plan,
    v_request.expected_seats,
    (now() + interval '30 days')::date,
    '0000'
  );

  update public.tenant_provision_requests
  set status = 'approved',
      reviewed_by_user_id = auth.uid(),
      review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
      reviewed_at = coalesce(reviewed_at, now()),
      provisioned_tenant_id = v_tenant_id
  where id = p_request_id;

  insert into public.audit_events (
    tenant_id,
    actor_user_id,
    actor_role,
    action,
    target,
    detail
  )
  values (
    v_tenant_id,
    auth.uid(),
    'platform-admin',
    'tenant_provisioned',
    v_request.requestor_email,
    'Provisioned from tenant request approval'
  );

  v_subject := 'Tenant request approved and provisioned';
  v_body := format(
    'Your organization %s is ready. An access email can now be issued for %s.',
    v_request.organization_name,
    v_request.requestor_email
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
  values (
    v_tenant_id,
    v_request.submitted_by_user_id,
    v_request.requestor_email,
    'email',
    'tenant_provision_request_provisioned',
    v_subject,
    v_body,
    'pending',
    jsonb_build_object(
      'tenant_provision_request_id', v_request.id::text,
      'tenant_id', v_tenant_id::text
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
      v_tenant_id,
      v_request.submitted_by_user_id,
      v_request.requestor_email,
      'in-app',
      'tenant_provision_request_provisioned',
      v_subject,
      v_body,
      'pending',
      jsonb_build_object(
        'tenant_provision_request_id', v_request.id::text,
        'tenant_id', v_tenant_id::text
      )
    );
  end if;

  return v_tenant_id;
end;
$$;

grant execute on function public.approve_and_provision_tenant_request(uuid, text) to authenticated;

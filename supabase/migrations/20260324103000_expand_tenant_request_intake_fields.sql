-- Expand tenant provisioning request intake fields
-- Created: 2026-03-24

alter table public.tenant_provision_requests
  add column if not exists job_title text,
  add column if not exists organization_type text,
  add column if not exists organization_website text,
  add column if not exists region text,
  add column if not exists expected_coach_count int,
  add column if not exists expected_athlete_count int,
  add column if not exists desired_start_date date;

alter table public.tenant_provision_requests
  drop constraint if exists tenant_provision_requests_expected_coach_count_check;
alter table public.tenant_provision_requests
  add constraint tenant_provision_requests_expected_coach_count_check
  check (expected_coach_count is null or expected_coach_count >= 0);

alter table public.tenant_provision_requests
  drop constraint if exists tenant_provision_requests_expected_athlete_count_check;
alter table public.tenant_provision_requests
  add constraint tenant_provision_requests_expected_athlete_count_check
  check (expected_athlete_count is null or expected_athlete_count >= 0);

create or replace function public.submit_tenant_provision_request(
  p_requestor_name text,
  p_requestor_email text,
  p_organization_name text,
  p_notes text default null,
  p_requested_plan text default 'starter',
  p_expected_seats int default null,
  p_job_title text default null,
  p_organization_type text default null,
  p_organization_website text default null,
  p_region text default null,
  p_expected_coach_count int default null,
  p_expected_athlete_count int default null,
  p_desired_start_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_subject text;
  v_body text;
  v_actor_email text;
  v_expected_seats int;
begin
  if p_requestor_name is null or btrim(p_requestor_name) = '' then
    raise exception 'Requestor name is required';
  end if;

  if p_requestor_email is null or btrim(p_requestor_email) = '' then
    raise exception 'Requestor email is required';
  end if;

  if p_organization_name is null or btrim(p_organization_name) = '' then
    raise exception 'Organization name is required';
  end if;

  if p_requested_plan not in ('starter', 'pro', 'enterprise') then
    raise exception 'Invalid requested plan';
  end if;

  if p_job_title is null or btrim(p_job_title) = '' then
    raise exception 'Job title is required';
  end if;

  if p_organization_type is null or btrim(p_organization_type) = '' then
    raise exception 'Organization type is required';
  end if;

  if p_region is null or btrim(p_region) = '' then
    raise exception 'Region is required';
  end if;

  if p_expected_coach_count is null or p_expected_coach_count < 0 then
    raise exception 'Expected coach count must be zero or greater';
  end if;

  if p_expected_athlete_count is null or p_expected_athlete_count < 0 then
    raise exception 'Expected athlete count must be zero or greater';
  end if;

  v_expected_seats := coalesce(p_expected_seats, 0);
  if v_expected_seats <= 0 then
    v_expected_seats := greatest(1, p_expected_coach_count + p_expected_athlete_count);
  end if;

  if exists (
    select 1
    from public.tenant_provision_requests r
    where lower(r.organization_name) = lower(btrim(p_organization_name))
      and lower(r.requestor_email) = lower(btrim(p_requestor_email))
      and r.status = 'pending'
  ) then
    raise exception 'A pending request already exists for this organization and email';
  end if;

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
    btrim(p_organization_name),
    btrim(p_requestor_name),
    lower(btrim(p_requestor_email)),
    p_requested_plan,
    v_expected_seats,
    nullif(btrim(coalesce(p_notes, '')), ''),
    'pending',
    auth.uid(),
    nullif(btrim(coalesce(p_job_title, '')), ''),
    nullif(btrim(coalesce(p_organization_type, '')), ''),
    nullif(btrim(coalesce(p_organization_website, '')), ''),
    nullif(btrim(coalesce(p_region, '')), ''),
    p_expected_coach_count,
    p_expected_athlete_count,
    p_desired_start_date
  )
  returning id into v_request_id;

  v_subject := 'New tenant provisioning request';
  v_body := format(
    'Organization: %s | Requestor: %s | Email: %s | Title: %s | Type: %s | Region: %s | Plan: %s | Coaches: %s | Athletes: %s | Seats: %s | Desired start: %s',
    btrim(p_organization_name),
    btrim(p_requestor_name),
    lower(btrim(p_requestor_email)),
    btrim(p_job_title),
    btrim(p_organization_type),
    btrim(p_region),
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

  select lower(coalesce(auth.jwt() ->> 'email', lower(btrim(p_requestor_email))))
  into v_actor_email;

  perform public.insert_platform_audit_event(
    auth.uid(),
    v_actor_email,
    case when auth.uid() is null then 'anonymous-requestor' else 'requestor' end,
    'tenant_provision_request_submitted',
    lower(btrim(p_requestor_email)),
    format('Organization %s requested on plan %s for %s seats', btrim(p_organization_name), p_requested_plan, v_expected_seats),
    jsonb_build_object(
      'tenant_provision_request_id', v_request_id::text,
      'organization_name', btrim(p_organization_name),
      'requested_plan', p_requested_plan,
      'expected_seats', v_expected_seats,
      'job_title', nullif(btrim(coalesce(p_job_title, '')), ''),
      'organization_type', nullif(btrim(coalesce(p_organization_type, '')), ''),
      'organization_website', nullif(btrim(coalesce(p_organization_website, '')), ''),
      'region', nullif(btrim(coalesce(p_region, '')), ''),
      'expected_coach_count', p_expected_coach_count,
      'expected_athlete_count', p_expected_athlete_count,
      'desired_start_date', p_desired_start_date,
      'status', 'pending'
    )
  );

  return v_request_id;
end;
$$;

grant execute on function public.submit_tenant_provision_request(text, text, text, text, text, int, text, text, text, text, int, int, date) to anon, authenticated;

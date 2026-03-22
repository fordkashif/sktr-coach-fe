-- Request-only tenant provisioning intake + notification seed
-- Created: 2026-03-21

create table if not exists public.tenant_provision_requests (
  id uuid primary key default gen_random_uuid(),
  organization_name text not null,
  requestor_name text not null,
  requestor_email text not null,
  requested_plan text not null check (requested_plan in ('starter', 'pro', 'enterprise')) default 'starter',
  expected_seats int not null check (expected_seats > 0),
  notes text,
  status text not null check (status in ('pending', 'approved', 'rejected', 'cancelled')) default 'pending',
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  review_notes text,
  reviewed_at timestamptz,
  provisioned_tenant_id uuid references public.tenants(id) on delete set null,
  submitted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_provision_requests_status_created_idx
on public.tenant_provision_requests (status, created_at desc);

create unique index if not exists tenant_provision_requests_pending_unique_idx
on public.tenant_provision_requests (lower(organization_name), lower(requestor_email))
where status = 'pending';

drop trigger if exists set_updated_at_tenant_provision_requests on public.tenant_provision_requests;
create trigger set_updated_at_tenant_provision_requests
before update on public.tenant_provision_requests
for each row
execute function public.set_updated_at();

alter table public.tenant_provision_requests enable row level security;

-- Intentionally no generic direct table policies yet; request intake is RPC-only in Phase 1.

create table if not exists public.platform_admin_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_email text,
  channel text not null check (channel in ('in-app', 'email')),
  event_type text not null,
  subject text not null,
  body text,
  status text not null check (status in ('pending', 'sent', 'failed', 'read')) default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notification_events_recipient_created_idx
on public.notification_events (recipient_user_id, created_at desc);

create index if not exists notification_events_status_created_idx
on public.notification_events (status, created_at desc);

alter table public.notification_events enable row level security;

drop policy if exists notification_events_select_self on public.notification_events;
create policy notification_events_select_self
on public.notification_events
for select
to authenticated
using (recipient_user_id = auth.uid());

create or replace function public.submit_tenant_provision_request(
  p_requestor_name text,
  p_requestor_email text,
  p_organization_name text,
  p_notes text default null,
  p_requested_plan text default 'starter',
  p_expected_seats int default 25
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

  if p_expected_seats is null or p_expected_seats <= 0 then
    raise exception 'Expected seats must be greater than zero';
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
    submitted_by_user_id
  )
  values (
    btrim(p_organization_name),
    btrim(p_requestor_name),
    lower(btrim(p_requestor_email)),
    p_requested_plan,
    p_expected_seats,
    nullif(btrim(coalesce(p_notes, '')), ''),
    'pending',
    auth.uid()
  )
  returning id into v_request_id;

  v_subject := 'New tenant provisioning request';
  v_body := format(
    'Organization: %s | Requestor: %s | Email: %s | Plan: %s | Seats: %s',
    btrim(p_organization_name),
    btrim(p_requestor_name),
    lower(btrim(p_requestor_email)),
    p_requested_plan,
    p_expected_seats
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

  return v_request_id;
end;
$$;

grant execute on function public.submit_tenant_provision_request(text, text, text, text, text, int) to anon, authenticated;

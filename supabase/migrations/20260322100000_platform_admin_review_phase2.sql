-- Platform-admin request review + notification access
-- Created: 2026-03-22

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admin_contacts pac
    where pac.is_active = true
      and (
        pac.user_id = auth.uid()
        or lower(pac.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  )
$$;

alter table public.platform_admin_contacts enable row level security;

drop policy if exists platform_admin_contacts_select_self on public.platform_admin_contacts;
create policy platform_admin_contacts_select_self
on public.platform_admin_contacts
for select
to authenticated
using (
  is_active = true
  and (
    user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

drop policy if exists tenant_provision_requests_platform_admin_select on public.tenant_provision_requests;
create policy tenant_provision_requests_platform_admin_select
on public.tenant_provision_requests
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists tenant_provision_requests_platform_admin_update on public.tenant_provision_requests;
create policy tenant_provision_requests_platform_admin_update
on public.tenant_provision_requests
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists notification_events_select_self on public.notification_events;
create policy notification_events_select_self
on public.notification_events
for select
to authenticated
using (
  recipient_user_id = auth.uid()
  or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

drop policy if exists notification_events_update_self on public.notification_events;
create policy notification_events_update_self
on public.notification_events
for update
to authenticated
using (
  recipient_user_id = auth.uid()
  or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
)
with check (
  recipient_user_id = auth.uid()
  or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

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
      'Your request for %s has been approved. Provisioning is the next step.',
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
      'status', p_status
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
        'status', p_status
      )
    );
  end if;
end;
$$;

grant execute on function public.review_tenant_provision_request(uuid, text, text) to authenticated;

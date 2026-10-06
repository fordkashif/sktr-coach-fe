-- Emails to the person who asks for a club.
--
-- Before: nothing was sent when the request was made. On approval two notification emails
-- ("Tenant request approved", "Tenant request approved and provisioned") went out with a button to
-- the sign-in screen, where a new owner has no password yet, next to the access invite email that
-- carries the real "set your password" link. People pressed the wrong one and got stuck.
--
-- Now:
--   1. When a request is made, the requestor gets one email saying it arrived and what happens next.
--   2. On approval the two notification emails to the requestor are not queued. The access invite
--      email (platform-admin-send-club-admin-invite) is the one approval email, with the link.
--   3. A declined request still gets its email, in plainer words.
-- In-app rows and emails to platform admins are untouched.
--
-- Idempotent: create or replace, drop trigger if exists.

create or replace function public.shape_club_request_emails()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.channel is distinct from 'email' then
    return new;
  end if;

  if new.event_type = 'tenant_provision_request_provisioned' then
    return null;
  end if;

  if new.event_type = 'tenant_provision_request_reviewed' then
    if coalesce(new.metadata ->> 'status', '') = 'approved' then
      return null;
    end if;
    new.subject := 'About your SKTR Coach request';
    new.body := replace(new.body, 'has been rejected.', 'was not approved this time.');
    new.body := replace(new.body, 'No review note was provided.', 'If you think this is a mistake, reply to support@thesktr.com.');
  end if;

  return new;
end;
$$;

drop trigger if exists shape_club_request_emails on public.notification_events;
create trigger shape_club_request_emails
before insert on public.notification_events
for each row execute function public.shape_club_request_emails();

create or replace function public.notify_club_request_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(new.requestor_email, '')), '') is null then
    return new;
  end if;

  insert into public.notification_events (
    tenant_id, recipient_user_id, recipient_email, channel, event_type, subject, body, status, metadata
  )
  values (
    null,
    new.submitted_by_user_id,
    lower(btrim(new.requestor_email)),
    'email',
    'tenant_provision_request_received',
    'We got your SKTR Coach request',
    format(
      'Thanks. We have your request for %s and review every request within 48 hours. When it is approved you will get an email with a button to set your password. There is nothing you need to do until then.',
      new.organization_name
    ),
    'pending',
    jsonb_build_object('tenant_provision_request_id', new.id::text)
  );
  return new;
end;
$$;

revoke all on function public.notify_club_request_received() from public, anon, authenticated;

drop trigger if exists notify_club_request_received on public.tenant_provision_requests;
create trigger notify_club_request_received
after insert on public.tenant_provision_requests
for each row execute function public.notify_club_request_received();

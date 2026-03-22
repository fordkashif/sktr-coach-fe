-- User notification projection for in-app read state
-- Created: 2026-03-22

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_email text,
  state text not null check (state in ('unread', 'read', 'dismissed')) default 'unread',
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_notifications_event_user_unique_idx
on public.user_notifications (event_id, recipient_user_id)
where recipient_user_id is not null;

create unique index if not exists user_notifications_event_email_unique_idx
on public.user_notifications (event_id, lower(recipient_email))
where recipient_user_id is null and recipient_email is not null;

create index if not exists user_notifications_recipient_state_created_idx
on public.user_notifications (recipient_user_id, state, created_at desc);

create index if not exists user_notifications_email_state_created_idx
on public.user_notifications (lower(recipient_email), state, created_at desc);

drop trigger if exists set_updated_at_user_notifications on public.user_notifications;
create trigger set_updated_at_user_notifications
before update on public.user_notifications
for each row
execute function public.set_updated_at();

alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_select_self on public.user_notifications;
create policy user_notifications_select_self
on public.user_notifications
for select
to authenticated
using (
  recipient_user_id = auth.uid()
  or lower(coalesce(recipient_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

drop policy if exists user_notifications_update_self on public.user_notifications;
create policy user_notifications_update_self
on public.user_notifications
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

create or replace function public.sync_user_notification_from_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel <> 'in-app' then
    return new;
  end if;

  insert into public.user_notifications (
    event_id,
    recipient_user_id,
    recipient_email,
    state
  )
  values (
    new.id,
    new.recipient_user_id,
    lower(nullif(btrim(coalesce(new.recipient_email, '')), '')),
    case when new.status = 'read' then 'read' else 'unread' end
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists sync_user_notification_from_event on public.notification_events;
create trigger sync_user_notification_from_event
after insert on public.notification_events
for each row
execute function public.sync_user_notification_from_event();

insert into public.user_notifications (
  event_id,
  recipient_user_id,
  recipient_email,
  state,
  read_at,
  created_at
)
select
  ne.id,
  ne.recipient_user_id,
  lower(nullif(btrim(coalesce(ne.recipient_email, '')), '')),
  case when ne.status = 'read' then 'read' else 'unread' end,
  ne.read_at,
  ne.created_at
from public.notification_events ne
where ne.channel = 'in-app'
on conflict do nothing;

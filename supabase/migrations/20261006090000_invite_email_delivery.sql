-- Invite email delivery tracking
-- Created: 2026-10-06
--
-- WHY
--   Coach and athlete invites are now emailed to the invited person by the
--   send-invite-email edge function. The inviter needs to see, per invite,
--   whether the email went out and when, and the function needs somewhere to
--   count sends so it cannot be used to flood an address.
--
-- WHY COLUMNS ON THE INVITE TABLES (and not notification_events)
--   * Every pending/failed notification_events row with channel = 'email' is
--     picked up by dispatch-notification-emails (the platform admin's "Send
--     queued emails"), which would send a second, plain copy of the invite.
--   * The invite lists already read these two tables, under RLS that already
--     limits them to the club, so no new read path or policy is needed.
--   * The rate limit has to be decided atomically per invite; a conditional
--     update on the invite row does that.
--
-- WHAT IS ADDED (both coach_invites and athlete_invites)
--   last_email_attempt_at  when the function last tried to send
--   last_email_sent_at     when the provider last accepted the email
--   email_send_count       how many times the email was accepted (cap: 5)
--   last_email_error       short machine code of the last failure, null on success
--
-- WHO CAN SEE THEM
--   Exactly who can already see the invite row. No policy is added or changed:
--     coach_invites    club admins of the club (coach_invites_staff_all)
--     athlete_invites  members of the club (athlete_invites_select_tenant)
--   The public claim functions (get_public_*_invite) list their columns
--   explicitly, so a visitor holding an invite link does not get these.
--
-- WHO CAN WRITE THEM
--   Only the service role (the edge function). The existing "staff all"
--   policies let a club admin or coach update any column of an invite, which
--   would let them reset the send counter. The trigger below keeps the four
--   columns unchanged for API users, so the limit cannot be bypassed.
--
-- NO DOUBLE EMAILS
--   The invite triggers from 20260322183000 queue only 'in-app' events when an
--   invite is created ('email' events are queued on acceptance, to the inviter).
--   Nothing queues an email for invite creation, so there is nothing for the
--   queued email dispatcher to send a second time. Not changed here.
--
-- Idempotent and additive: add column if not exists, create or replace,
-- drop trigger if exists. No existing row is modified.

alter table public.coach_invites
  add column if not exists last_email_attempt_at timestamptz,
  add column if not exists last_email_sent_at timestamptz,
  add column if not exists email_send_count int not null default 0,
  add column if not exists last_email_error text;

alter table public.athlete_invites
  add column if not exists last_email_attempt_at timestamptz,
  add column if not exists last_email_sent_at timestamptz,
  add column if not exists email_send_count int not null default 0,
  add column if not exists last_email_error text;

-- Security invoker on purpose: current_user is the role the API request runs
-- as ('authenticated' or 'anon'). The service role, and security definer
-- functions such as accept_coach_invite, run as other roles and pass through.
create or replace function public.protect_invite_email_delivery_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.last_email_attempt_at := null;
      new.last_email_sent_at := null;
      new.email_send_count := 0;
      new.last_email_error := null;
    else
      new.last_email_attempt_at := old.last_email_attempt_at;
      new.last_email_sent_at := old.last_email_sent_at;
      new.email_send_count := old.email_send_count;
      new.last_email_error := old.last_email_error;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_coach_invite_email_delivery on public.coach_invites;
create trigger protect_coach_invite_email_delivery
before insert or update on public.coach_invites
for each row
execute function public.protect_invite_email_delivery_columns();

drop trigger if exists protect_athlete_invite_email_delivery on public.athlete_invites;
create trigger protect_athlete_invite_email_delivery
before insert or update on public.athlete_invites
for each row
execute function public.protect_invite_email_delivery_columns();

-- SKTR Coach: club admin invites, removing people from a club, and deleting an athlete's data
-- Created: 2026-10-10
--
-- WHY
--   K12  A club could only get a second club admin by inviting them as a coach and changing their
--        role afterwards. coach_invites.role has allowed 'club-admin' since the table was created
--        and accept_coach_invite has honoured it, but three things made a direct admin invite
--        unusable or unsafe: finishing the invite refused anyone who was not a coach, nothing
--        recorded who created an admin invite, and accepting a COACH invite silently demoted a
--        club admin to coach (even the last one).
--   K4   "Deactivate" was the only way to take someone out of a club. They stayed on the People
--        list for ever, kept their place in the package and could not join another club with the
--        same account. And there was no way at all to act on a privacy request to delete an
--        athlete's data.
--
-- WHAT THIS FILE ADDS
--   1. removed_members: one row per coach or club admin who was removed from a club: their name
--      and role at the time. Their plans, notes, messages and audit entries stay and are still
--      attributed by name (message_member_name falls back to this table).
--   2. Club admin invites, made safe:
--        * guard_club_admin_invite (trigger): only an active club admin of the invite's club can
--          create an invite that carries the club-admin role, or raise an existing invite to it.
--          The row policy already says so; the trigger is the second lock and it also writes the
--          audit entry (club_admin_invite_created), so that cannot be skipped by the browser.
--        * accept_coach_invite: same definition as 20261007100000 with two changes. A coach
--          invite never lowers a club admin to coach. A returning member's removed_members row is
--          cleared. Acceptance still needs the CONFIRMED email the invite was sent to and still
--          gives access to the invite's own club only.
--        * complete_current_coach_onboarding: also finishes the first sign-in of a club admin
--          who joined through an invite (it only ever writes the caller's own name and stamps).
--        * get_public_coach_invite_role: the role an invite carries, for the invite page wording.
--   3. remove_tenant_member(user): a club admin removes a COACH or CLUB ADMIN from the club for
--      good. Their profile and team assignments in this club are deleted, pending invites to
--      their email are cancelled, their name is kept in removed_members. Refused for yourself,
--      for the last active club admin, for a member of another club and for an athlete.
--   4. remove_athlete_from_club(athlete) / restore_athlete_to_club(athlete): a club admin takes an
--      athlete out of the club and can bring them back. NOTHING is deleted: the athlete record is
--      switched off and taken off its team (which frees the seat), their login for this club is
--      switched off, pending invites for them are cancelled. Sessions, results, wellness and
--      messages all stay.
--   5. delete_athlete_and_data(athlete, typed name): the one deliberate DELETE in this schema. For
--      privacy requests. Club admin only, and the caller has to pass the athlete's full name.
--      Removes the athlete record and every row that hangs off it (listed at the function), and
--      for an athlete with a login also their profile and notifications in this club. It does
--      NOT delete the login account itself (auth.users) or a profile photo file in storage: both
--      need the service role. See SUPABASE_RLS_POLICY_MATRIX.md.
--
-- Every function that writes starts with assert_caller_active() (20261006180000), so a
-- deactivated admin and the admin of a suspended or cancelled club are refused with the usual
-- access_paused error.
--
-- Idempotent: create table if not exists, create or replace function, drop trigger if exists +
-- create trigger, drop policy if exists + create policy, revoke/grant. Additive except for the
-- deliberate deletes inside remove_tenant_member and delete_athlete_and_data, which only run when
-- a club admin calls them. Applying this file changes no existing row.

-- 1. Former staff: the name stays ----------------------------------------------------------------

create table if not exists public.removed_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  role text not null check (role in ('coach', 'club-admin')),
  removed_by_user_id uuid references auth.users(id) on delete set null,
  removed_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

comment on table public.removed_members is
  'Coaches and club admins removed from a club (remove_tenant_member). Keeps their name so their plans, notes and messages stay attributed. Written only by security definer functions.';

alter table public.removed_members enable row level security;

revoke all on public.removed_members from public, anon, authenticated;
grant select on public.removed_members to authenticated;
grant all on public.removed_members to service_role;

-- Staff of the same club can read the names (the activity log and plan lists). Athletes get a
-- former coach's name through message_member_name only.
drop policy if exists removed_members_select_staff on public.removed_members;
create policy removed_members_select_staff
on public.removed_members
for select
to authenticated
using (tenant_id = public.current_tenant_id() and public.is_coach_or_admin());

-- Same function as 20261009110000 with the removed_members fallback added: a coach who was
-- removed from the club still shows by name in their old threads and announcements.
create or replace function public.message_member_name(p_user_id uuid, p_fallback text default 'Coach')
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select nullif(left(btrim(regexp_replace(coalesce(p.display_name, ''), '\s+', ' ', 'g')), 80), '')
      from public.profiles p
      where p.user_id = p_user_id
    ),
    (
      select nullif(left(btrim(regexp_replace(coalesce(rm.display_name, ''), '\s+', ' ', 'g')), 80), '')
      from public.removed_members rm
      where rm.user_id = p_user_id
      order by rm.removed_at desc
      limit 1
    ),
    p_fallback
  )
$$;

revoke all on function public.message_member_name(uuid, text) from public, anon, authenticated;

-- 2. Club admin invites ---------------------------------------------------------------------------

-- 2a. Second lock and audit for an invite that carries the club-admin role.
--   * A signed-in caller who is not an active club admin of the invite's club is refused. (The
--     service role and the SQL editor have no auth.uid() and pass, as everywhere else.)
--   * Only looked at when the row is created, or when its role is changed to club-admin. Accepting
--     or cancelling an existing admin invite does not change the role and is not affected.
create or replace function public.guard_club_admin_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from 'club-admin' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.role is not distinct from new.role then
    return new;
  end if;

  if auth.uid() is not null
     and not (public.is_club_admin() and new.tenant_id = public.current_tenant_id()) then
    raise exception 'Only a club admin can invite someone as a club admin.' using errcode = '42501';
  end if;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    new.tenant_id,
    auth.uid(),
    coalesce(public.current_app_role(), 'system'),
    'club_admin_invite_created',
    lower(btrim(new.email)),
    'invite ' || new.id::text || ' gives the club admin role when accepted'
  );

  return new;
end;
$$;

revoke all on function public.guard_club_admin_invite() from public, anon, authenticated;

drop trigger if exists guard_club_admin_invite on public.coach_invites;
create trigger guard_club_admin_invite
after insert or update of role on public.coach_invites
for each row
execute function public.guard_club_admin_invite();

-- 2b. The role an invite carries, for the invite page ("join as a club admin"). Same reach as
-- get_public_coach_invite: whoever holds the invite link. Null for an unknown invite.
create or replace function public.get_public_coach_invite_role(p_invite_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when ci.role = 'club-admin' then 'club-admin' else 'coach' end
  from public.coach_invites ci
  where ci.id = p_invite_id
$$;

revoke all on function public.get_public_coach_invite_role(uuid) from public;
grant execute on function public.get_public_coach_invite_role(uuid) to anon, authenticated, service_role;

-- 2c. Finishing the first sign-in after an invite. Same function as 20261006180000; the only
-- change is that a club admin who joined through an invite is accepted too. It writes the
-- caller's own name and first-sign-in stamps and nothing else.
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
    and role in ('coach', 'club-admin');

  if not found then
    raise exception 'Coach profile not found for current user';
  end if;
end;
$$;

revoke all on function public.complete_current_coach_onboarding(text) from public, anon;
grant execute on function public.complete_current_coach_onboarding(text) to authenticated, service_role;

-- 2d. Accepting a coach or club admin invite. Same definition as 20261007100000 except:
--   * an existing CLUB ADMIN who accepts a coach invite stays a club admin (before, the invite
--     rewrote their role to coach, which could leave a club with no admin);
--   * a member who was removed and is invited back loses their removed_members row;
--   * the audit entry says which role was given.
-- Unchanged: the caller's CONFIRMED email must be the invite's email, the invite must be pending
-- and not expired, the club must not be suspended or cancelled, a member of another club is
-- refused, and a deactivated member needs an invite created after the deactivation.
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
  where au.id = v_user_id
    and au.email_confirmed_at is not null;

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

    -- An invite can raise a role, never lower a club admin.
    if v_profile.role = 'club-admin' then
      v_role := 'club-admin';
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

  delete from public.removed_members rm
  where rm.tenant_id = v_invite.tenant_id
    and rm.user_id = v_user_id;

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
      when v_invite.team_id is null then 'accepted as ' || v_role || ' without team'
      else 'accepted as ' || v_role || ' for team ' || v_invite.team_id::text
    end
  );

  return v_invite.tenant_id;
end;
$$;

revoke all on function public.accept_coach_invite(uuid) from public, anon;
grant execute on function public.accept_coach_invite(uuid) to authenticated, service_role;

-- 3. Removing a coach or club admin from the club -------------------------------------------------
-- Deactivating (set_tenant_member_access) is the reversible switch: the person stays on the People
-- list and keeps their teams for when they are switched back on. This is the permanent one.
--   Deleted:   their profile in this club, their team assignments, their notifications from this
--              club, and (cancelled, not deleted) pending invites addressed to their email, so an
--              old invite link cannot bring them straight back.
--   Kept:      everything they made. Training plans, sessions, test weeks, results they entered,
--              announcements, message threads and audit entries all keep their user id, and their
--              name is kept in removed_members. A thread with an athlete stays readable for the
--              athlete and the club admins and can no longer be written to (message_thread_is_open
--              needs an active coach profile).
--   Their login account is untouched: they can be invited again, here or by another club.
-- Refused: yourself; a member of another club (same answer as "does not exist"); an athlete (use
-- remove_athlete_from_club); the last active club admin.
create or replace function public.remove_tenant_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_email text;
  v_other_active_admins int;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_user_id is null then
    raise exception 'Member is required';
  end if;

  select * into v_caller
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found or v_caller.role <> 'club-admin' or not v_caller.is_active then
    raise exception 'Only active club-admin users can remove a member';
  end if;

  -- Same locking as set_tenant_member_access, so removing and demoting admins at the same moment
  -- cannot both pass the last-admin check.
  perform 1
  from public.profiles p
  where p.tenant_id = v_caller.tenant_id
    and p.role = 'club-admin'
  order by p.user_id
  for update;

  select * into v_caller
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found or v_caller.role <> 'club-admin' or not v_caller.is_active then
    raise exception 'Only active club-admin users can remove a member';
  end if;

  select * into v_target
  from public.profiles p
  where p.user_id = p_user_id
    and p.tenant_id = v_caller.tenant_id
  for update;

  if not found then
    raise exception 'Member not found in this club';
  end if;

  if v_target.user_id = auth.uid() then
    raise exception 'You cannot remove yourself from the club';
  end if;

  if v_target.role not in ('coach', 'club-admin') then
    raise exception 'Athletes are removed from the club with their athlete record';
  end if;

  if v_target.role = 'club-admin' and v_target.is_active then
    select count(*) into v_other_active_admins
    from public.profiles p
    where p.tenant_id = v_caller.tenant_id
      and p.role = 'club-admin'
      and p.is_active
      and p.user_id <> v_target.user_id;

    if v_other_active_admins = 0 then
      raise exception 'A club must keep at least one active club-admin';
    end if;
  end if;

  select lower(btrim(au.email)) into v_email
  from auth.users au
  where au.id = v_target.user_id;

  insert into public.removed_members (tenant_id, user_id, display_name, role, removed_by_user_id, removed_at)
  values (v_caller.tenant_id, v_target.user_id, v_target.display_name, v_target.role, auth.uid(), now())
  on conflict (tenant_id, user_id) do update
  set display_name = excluded.display_name,
      role = excluded.role,
      removed_by_user_id = excluded.removed_by_user_id,
      removed_at = excluded.removed_at;

  delete from public.team_coaches tc
  where tc.user_id = v_target.user_id
    and tc.tenant_id = v_caller.tenant_id;

  if v_email is not null and v_email <> '' then
    update public.coach_invites ci
    set status = 'revoked',
        updated_at = now()
    where ci.tenant_id = v_caller.tenant_id
      and ci.status = 'pending'
      and lower(btrim(ci.email)) = v_email;
  end if;

  delete from public.notification_events ne
  where ne.recipient_user_id = v_target.user_id
    and ne.tenant_id = v_caller.tenant_id;

  delete from public.profiles p
  where p.user_id = v_target.user_id
    and p.tenant_id = v_caller.tenant_id;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    v_caller.tenant_id,
    auth.uid(),
    'club-admin',
    'member_removed',
    coalesce(nullif(v_email, ''), v_target.user_id::text),
    format('%s removed from the club (%s). Their plans, notes and messages are kept.',
           coalesce(nullif(btrim(v_target.display_name), ''), 'Member'),
           case when v_target.role = 'club-admin' then 'club admin' else 'coach' end)
  );
end;
$$;

revoke all on function public.remove_tenant_member(uuid) from public, anon;
grant execute on function public.remove_tenant_member(uuid) to authenticated, service_role;

-- 4. Taking an athlete out of the club, and bringing them back -------------------------------------
-- Works for an athlete with a login and for one without (remove_managed_athlete, 20261009090000,
-- stays as the coach's way to remove an athlete without a login from a team they coach).
-- Nothing is deleted. Returns false when there was nothing to change.
create or replace function public.remove_athlete_from_club(p_athlete_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete public.athletes%rowtype;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_club_admin() then
    raise exception 'Only a club admin can remove an athlete from the club.' using errcode = '42501';
  end if;
  if p_athlete_id is null then
    return false;
  end if;

  select * into v_athlete
  from public.athletes a
  where a.id = p_athlete_id
    and a.tenant_id = public.current_tenant_id()
  for update;
  if not found or not v_athlete.is_active then
    return false;
  end if;

  update public.athletes
  set is_active = false,
      team_id = null,
      updated_at = now()
  where id = v_athlete.id;

  -- Their login stops working for this club. Only an athlete profile is touched: someone who is
  -- also a coach or club admin keeps their staff access.
  if v_athlete.user_id is not null then
    update public.profiles p
    set is_active = false,
        updated_at = now()
    where p.user_id = v_athlete.user_id
      and p.tenant_id = v_athlete.tenant_id
      and p.role = 'athlete'
      and p.is_active;
  end if;

  update public.athlete_invites ai
  set status = 'revoked',
      updated_at = now()
  where ai.tenant_id = v_athlete.tenant_id
    and ai.status = 'pending'
    and (
      ai.athlete_id = v_athlete.id
      or (
        v_athlete.user_id is not null
        and lower(btrim(coalesce(ai.email, ''))) = (
          select lower(btrim(au.email)) from auth.users au where au.id = v_athlete.user_id
        )
      )
    );

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_athlete.tenant_id, auth.uid(), 'club-admin', 'athlete_removed_from_club', v_athlete.id::text,
          'athlete removed from the club and taken off their team, history kept');

  return true;
end;
$$;

revoke all on function public.remove_athlete_from_club(uuid) from public, anon;
grant execute on function public.remove_athlete_from_club(uuid) to authenticated, service_role;

-- Brings a removed athlete back: the record is active again (on no team, so the club admin puts
-- them on one next) and their login for this club works again. Takes a seat, so it is refused
-- when the package has none left. Returns false when there was nothing to change.
create or replace function public.restore_athlete_to_club(p_athlete_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete public.athletes%rowtype;
  v_limit integer;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_club_admin() then
    raise exception 'Only a club admin can bring an athlete back to the club.' using errcode = '42501';
  end if;
  if p_athlete_id is null then
    return false;
  end if;

  perform public.lock_tenant_athlete_seats(public.current_tenant_id());

  select * into v_athlete
  from public.athletes a
  where a.id = p_athlete_id
    and a.tenant_id = public.current_tenant_id()
  for update;
  if not found or v_athlete.is_active then
    return false;
  end if;

  v_limit := public.tenant_athlete_limit(v_athlete.tenant_id);
  if v_limit is not null
     and public.tenant_athlete_seats_used(v_athlete.tenant_id)
         + public.tenant_pending_athlete_invite_seats(v_athlete.tenant_id) >= v_limit then
    raise exception 'Your club has no athlete place left in its package.' using errcode = '23514';
  end if;

  update public.athletes
  set is_active = true,
      updated_at = now()
  where id = v_athlete.id;

  if v_athlete.user_id is not null then
    update public.profiles p
    set is_active = true,
        updated_at = now()
    where p.user_id = v_athlete.user_id
      and p.tenant_id = v_athlete.tenant_id
      and p.role = 'athlete'
      and not p.is_active;
  end if;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_athlete.tenant_id, auth.uid(), 'club-admin', 'athlete_restored_to_club', v_athlete.id::text,
          'athlete brought back to the club, not on a team yet');

  return true;
end;
$$;

revoke all on function public.restore_athlete_to_club(uuid) from public, anon;
grant execute on function public.restore_athlete_to_club(uuid) to authenticated, service_role;

-- 5. Deleting an athlete and all their data ---------------------------------------------------------
-- For a privacy request. Club admin only. The caller passes the athlete's full name as typed in
-- the confirmation box; a call without the right name changes nothing.
--
-- Deleted, in this order (the first five are "on delete restrict" towards athletes or sessions and
-- have to go first; the rest follow the athlete row through "on delete cascade"):
--   session_row_logs, session_completions          what they logged
--   athlete_results (all sources), test_results     results and test week results
--   sessions (and their session_blocks)             their planned and finished sessions
--   training_plan_assignments (scope athlete)       plans assigned to them personally; the plan
--                                                   itself is the coach's work and stays
--   athlete_invites                                 invites for them, by record, account or email
--   team_join_code_uses                             the trace of a join code they used
--   athletes                                        the record, and through cascades:
--     wellness_entries, pr_records, athlete_availability, pain_reports, athlete_private_details
--     (guardian contact), competitions they added for themselves, competition_entries,
--     message_threads with their messages, hidden message text and reports
--   notification_events / user_notifications        sent to them by this club, and sent to anyone
--                                                   about them (metadata names the athlete)
--   announcement_recipients, profiles                for an athlete with a login: their read marks
--                                                   and their profile in this club (athlete role
--                                                   only; staff access is never removed here)
--   audit_events                                    NOT deleted. Entries whose target or detail is
--                                                   exactly their name or email are blanked to
--                                                   "deleted athlete".
-- Not touched: other athletes, team plans, test weeks, competitions of the club or a team, and
-- the login account in auth.users and any profile photo in storage (service role only).
create or replace function public.delete_athlete_and_data(p_athlete_id uuid, p_confirm_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete public.athletes%rowtype;
  v_name text;
  v_email text;
  v_had_login boolean;
  v_keys text[];
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_club_admin() then
    raise exception 'Only a club admin can delete an athlete and their data.' using errcode = '42501';
  end if;
  if p_athlete_id is null then
    raise exception 'Athlete not found in this club.' using errcode = '42501';
  end if;

  select * into v_athlete
  from public.athletes a
  where a.id = p_athlete_id
    and a.tenant_id = public.current_tenant_id()
  for update;
  if not found then
    -- Same answer for "does not exist" and "belongs to another club".
    raise exception 'Athlete not found in this club.' using errcode = '42501';
  end if;

  v_name := btrim(regexp_replace(coalesce(v_athlete.first_name, '') || ' ' || coalesce(v_athlete.last_name, ''), '\s+', ' ', 'g'));
  if lower(btrim(regexp_replace(coalesce(p_confirm_name, ''), '\s+', ' ', 'g'))) is distinct from lower(v_name) or v_name = '' then
    raise exception 'Type the athlete''s full name exactly to delete their data.' using errcode = '22023';
  end if;

  v_had_login := v_athlete.user_id is not null;
  if v_had_login then
    select lower(btrim(au.email)) into v_email from auth.users au where au.id = v_athlete.user_id;
  end if;

  delete from public.session_row_logs l where l.athlete_id = v_athlete.id;
  delete from public.session_completions sc where sc.athlete_id = v_athlete.id;
  delete from public.athlete_results ar where ar.athlete_id = v_athlete.id;
  delete from public.test_results tr where tr.athlete_id = v_athlete.id;
  delete from public.sessions s where s.athlete_id = v_athlete.id;
  delete from public.training_plan_assignments tpa where tpa.athlete_id = v_athlete.id;

  delete from public.athlete_invites ai
  where ai.tenant_id = v_athlete.tenant_id
    and (
      ai.athlete_id = v_athlete.id
      or (v_had_login and ai.accepted_by_user_id = v_athlete.user_id)
      or (v_email is not null and v_email <> '' and lower(btrim(coalesce(ai.email, ''))) = v_email)
    );

  delete from public.team_join_code_uses u where u.athlete_id = v_athlete.id;

  delete from public.notification_events ne
  where ne.tenant_id = v_athlete.tenant_id
    and (
      ne.metadata ->> 'athlete_id' = v_athlete.id::text
      or (v_had_login and ne.recipient_user_id = v_athlete.user_id)
    );

  delete from public.athletes a where a.id = v_athlete.id;

  if v_had_login then
    delete from public.announcement_recipients r
    where r.recipient_user_id = v_athlete.user_id
      and r.tenant_id = v_athlete.tenant_id;

    delete from public.profiles p
    where p.user_id = v_athlete.user_id
      and p.tenant_id = v_athlete.tenant_id
      and p.role = 'athlete';
  end if;

  -- v_keys never holds an empty string, so an entry with no detail is never matched.
  v_keys := array_remove(array[lower(v_name), nullif(coalesce(v_email, ''), '')], null);
  update public.audit_events ae
  set target = case when lower(ae.target) = any (v_keys) then 'deleted athlete' else ae.target end,
      detail = case when lower(ae.detail) = any (v_keys) then 'deleted athlete' else ae.detail end
  where ae.tenant_id = v_athlete.tenant_id
    and (lower(ae.target) = any (v_keys) or lower(ae.detail) = any (v_keys));

  -- The entry names nobody: the athlete id means nothing once the record is gone.
  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_athlete.tenant_id, auth.uid(), 'club-admin', 'athlete_data_deleted', v_athlete.id::text,
          case when v_had_login then 'athlete record, history and club profile deleted on request'
               else 'athlete record and history deleted on request' end);

  return true;
end;
$$;

revoke all on function public.delete_athlete_and_data(uuid, text) from public, anon;
grant execute on function public.delete_athlete_and_data(uuid, text) to authenticated, service_role;

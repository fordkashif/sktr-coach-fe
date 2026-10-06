-- SKTR Coach: parent or guardian access
-- Created: 2026-10-16
--
-- WHY
--   Many athletes are under 18. A guardian's name, phone and email could be stored on the athlete's
--   private details and a coach could share a report by private link, but a guardian had no account.
--
-- THE RULE
--   Access is always by invite from the club. Nobody joins or leaves by themselves. A coach of the
--   athlete's team (lead or coach, not an assistant) or a club admin invites a guardian for one
--   athlete, and can end that access at any time. A guardian cannot remove themselves.
--
-- WHAT THIS FILE ADDS
--   1. The role "guardian" on profiles. A guardian belongs to one club. A guardian is never staff
--      and never an athlete: every staff helper already asks for role coach or club-admin, athlete
--      helpers ask for role athlete, and two triggers refuse mixing (a guardian profile cannot be
--      turned into another role or the other way round, and an athlete record cannot be linked to
--      a guardian login). Guardians take no athlete seat (seats count athletes rows) and no coach
--      seat (they are never on team_coaches).
--   2. athlete_guardians   one row per guardian and child. status active or revoked.
--      guardian_invites    an invite by email for one athlete, sent with send-invite-email
--                          (kind "guardian") and claimed on /guardian/claim/<id>.
--   3. Scope helpers. current_guardian_athlete_ids() is the children a guardian may read.
--      current_guardian_health_athlete_ids() is the subset whose HEALTH data they may read:
--      the athlete is under 18 (date of birth on the athlete record), or is an adult who switched
--      sharing on. An unknown date of birth counts as hidden.
--   4. Guardian SELECT policies on exactly the tables a guardian reads (see section 6). Nothing
--      else is opened: coach notes, message threads, messages, the roster (other athletes),
--      profiles, team_coaches, private details and sessions have NO guardian policy. The two
--      tables with a health column inside otherwise plain rows (sessions.skip_reason,
--      athlete_attendance.reason) and the private details are read through functions that leave
--      the health part out when it is hidden.
--   5. Notifications for guardians through the existing queue (bell and email): plan published,
--      test week published, a pain report (health visible only), a report shared, an announcement.
--   6. delete_my_account handles a guardian. Club deletion and athlete deletion need no change:
--      both tables carry tenant_id and athlete_id, which the catalogue driven sweeps of
--      20261014120000 find by themselves.
--
-- Every function a member calls starts with assert_caller_active() (20261006180000).
-- Idempotent: create table / index if not exists, create or replace function, drop trigger and
-- drop policy if exists before create. Applying it twice changes nothing.

-- 1. The role -------------------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('athlete', 'coach', 'club-admin', 'guardian'));

-- Sharing health with guardians is the ADULT athlete's own choice. It lives with the other private
-- details. athlete_private_details has no write policy (writes go through functions), so only
-- set_my_guardian_health_sharing() below can change it.
alter table public.athlete_private_details
  add column if not exists share_health_with_guardians boolean not null default false;

-- 2. Tables ---------------------------------------------------------------------------------------

create table if not exists public.athlete_guardians (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  guardian_user_id uuid not null references auth.users(id) on delete cascade,
  relationship text not null default 'Guardian' check (char_length(relationship) between 1 and 40),
  status text not null default 'active' check (status in ('active', 'revoked')),
  invited_by_user_id uuid references auth.users(id) on delete set null,
  revoked_by_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint athlete_guardians_one_per_child unique (athlete_id, guardian_user_id),
  constraint athlete_guardians_revoked_check check ((status = 'revoked') = (revoked_at is not null))
);

create index if not exists athlete_guardians_guardian_idx on public.athlete_guardians (guardian_user_id) where status = 'active';
create index if not exists athlete_guardians_tenant_idx on public.athlete_guardians (tenant_id);

create table if not exists public.guardian_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  invitee_name text check (invitee_name is null or char_length(invitee_name) <= 120),
  relationship text not null default 'Guardian' check (char_length(relationship) between 1 and 40),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by_user_id uuid references auth.users(id) on delete set null,
  accepted_by_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  accepted_at timestamptz,
  -- Written by send-invite-email (service role) only, like the other invite tables.
  last_email_attempt_at timestamptz,
  last_email_sent_at timestamptz,
  email_send_count integer not null default 0,
  last_email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists guardian_invites_one_pending on public.guardian_invites (athlete_id, email) where status = 'pending';
create index if not exists guardian_invites_tenant_idx on public.guardian_invites (tenant_id);
create index if not exists guardian_invites_email_idx on public.guardian_invites (email) where status = 'pending';

drop trigger if exists set_updated_at_athlete_guardians on public.athlete_guardians;
create trigger set_updated_at_athlete_guardians before update on public.athlete_guardians
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_guardian_invites on public.guardian_invites;
create trigger set_updated_at_guardian_invites before update on public.guardian_invites
  for each row execute function public.set_updated_at();

alter table public.athlete_guardians enable row level security;
alter table public.guardian_invites enable row level security;

-- Rows are written by the functions below only. Members may read what concerns them.
revoke all on table public.athlete_guardians from anon, authenticated;
grant select on table public.athlete_guardians to authenticated;
grant all on table public.athlete_guardians to service_role;
revoke all on table public.guardian_invites from anon, authenticated;
grant select on table public.guardian_invites to authenticated;
grant all on table public.guardian_invites to service_role;

-- 3. No mixing of roles ---------------------------------------------------------------------------

create or replace function public.guard_guardian_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.role is distinct from new.role and 'guardian' in (old.role, new.role) then
      raise exception 'A guardian account cannot become a coach, admin or athlete account, or the other way round. Use a different email address.'
        using errcode = 'P0001', hint = 'role_mixing';
    end if;
    return new;
  end if;
  if new.role = 'guardian' and exists (select 1 from public.athletes a where a.user_id = new.user_id) then
    raise exception 'This email already has an athlete account. A guardian needs their own email address.'
      using errcode = 'P0001', hint = 'role_mixing';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_guardian_role() from public, anon, authenticated;

drop trigger if exists guard_guardian_role on public.profiles;
create trigger guard_guardian_role before insert or update of role on public.profiles
  for each row execute function public.guard_guardian_role();

create or replace function public.guard_athlete_is_not_guardian()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
     and exists (select 1 from public.profiles p where p.user_id = new.user_id and p.role = 'guardian') then
    raise exception 'This email already has a guardian account. An athlete needs their own email address.'
      using errcode = 'P0001', hint = 'role_mixing';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_athlete_is_not_guardian() from public, anon, authenticated;

drop trigger if exists guard_athlete_is_not_guardian on public.athletes;
create trigger guard_athlete_is_not_guardian before insert or update of user_id on public.athletes
  for each row execute function public.guard_athlete_is_not_guardian();

-- What an email address already is, seen from one club. Internal.
--   'new'        nothing stands in the way (no account, or an account with no access anywhere)
--   'guardian'   already a guardian of THIS club: link, no new account
--   'other_club' a guardian (or anything else) of another club
--   'has_role'   a coach, club admin, athlete or platform admin, or an approved club requestor
drop function if exists public.guardian_email_standing(uuid, text);
create or replace function public.guardian_email_standing(p_tenant_id uuid, p_email text, out standing text, out found_user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_profile public.profiles%rowtype;
begin
  standing := 'new';
  select au.id into found_user_id
  from auth.users au
  where lower(btrim(au.email)) = v_email
  order by au.created_at
  limit 1;

  if exists (
       select 1 from public.platform_admin_contacts pac
       where lower(btrim(pac.email)) = v_email or (found_user_id is not null and pac.user_id = found_user_id)
     )
     or exists (
       select 1 from public.tenant_provision_requests r
       where lower(btrim(r.requestor_email)) = v_email and r.status = 'approved'
     ) then
    standing := 'has_role';
    return;
  end if;

  if found_user_id is null then
    return;
  end if;

  select * into v_profile from public.profiles p where p.user_id = found_user_id limit 1;
  if found then
    standing := case
      when v_profile.role <> 'guardian' then 'has_role'
      when v_profile.tenant_id <> p_tenant_id then 'other_club'
      else 'guardian'
    end;
    return;
  end if;
  if exists (select 1 from public.athletes a where a.user_id = found_user_id) then
    standing := 'has_role';
  end if;
end;
$$;

revoke all on function public.guardian_email_standing(uuid, text) from public, anon, authenticated;
-- claim-guardian-invite-account (service role) asks before it creates a login.
grant execute on function public.guardian_email_standing(uuid, text) to service_role;

-- 4. Scope helpers --------------------------------------------------------------------------------

-- The children the caller may read: an active guardian of an open club, an active link, an
-- athlete who is still in the club.
create or replace function public.current_guardian_athlete_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(a.id), '{}'::uuid[])
  from public.profiles p
  join public.athlete_guardians ag
    on ag.guardian_user_id = p.user_id
   and ag.tenant_id = p.tenant_id
   and ag.status = 'active'
  join public.athletes a
    on a.id = ag.athlete_id
   and a.tenant_id = p.tenant_id
   and a.is_active
  where p.user_id = auth.uid()
    and p.role = 'guardian'
    and p.is_active
    and not public.tenant_access_blocked(p.tenant_id)
$$;

revoke all on function public.current_guardian_athlete_ids() from public, anon;
grant execute on function public.current_guardian_athlete_ids() to authenticated, service_role;

-- Why a guardian may or may not read an athlete's health data. Internal: says nothing about who asks.
--   'minor'              under 18 today: visible
--   'adult_opted_in'     18 or older and the athlete switched sharing on: visible
--   'adult_not_opted_in' 18 or older, sharing off: hidden
--   'unknown_age'        no date of birth: hidden
create or replace function public.guardian_health_rule(p_athlete_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when a.date_of_birth is null then 'unknown_age'
    when a.date_of_birth > current_date - interval '18 years' then 'minor'
    when coalesce(d.share_health_with_guardians, false) then 'adult_opted_in'
    else 'adult_not_opted_in'
  end
  from public.athletes a
  left join public.athlete_private_details d on d.athlete_id = a.id
  where a.id = p_athlete_id
$$;

revoke all on function public.guardian_health_rule(uuid) from public, anon, authenticated;

create or replace function public.current_guardian_health_athlete_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(x.id), '{}'::uuid[])
  from unnest(public.current_guardian_athlete_ids()) x(id)
  where public.guardian_health_rule(x.id) in ('minor', 'adult_opted_in')
$$;

revoke all on function public.current_guardian_health_athlete_ids() from public, anon;
grant execute on function public.current_guardian_health_athlete_ids() to authenticated, service_role;

create or replace function public.current_guardian_team_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct a.team_id), '{}'::uuid[])
  from public.athletes a
  where a.id = any (public.current_guardian_athlete_ids())
    and a.team_id is not null
$$;

revoke all on function public.current_guardian_team_ids() from public, anon;
grant execute on function public.current_guardian_team_ids() to authenticated, service_role;

-- The published plans one linked child is on (same rule as current_athlete_plan_ids). Empty for
-- an athlete the caller is not a guardian of.
create or replace function public.guardian_athlete_plan_ids(p_athlete_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select a.id, a.team_id, a.tenant_id
    from public.athletes a
    where a.id = p_athlete_id
      and a.id = any (public.current_guardian_athlete_ids())
  ),
  assigned as (
    select tpa.plan_id
    from me
    join public.training_plan_assignments tpa on tpa.athlete_id = me.id and tpa.tenant_id = me.tenant_id
    union
    select tpa.plan_id
    from me
    join public.training_plan_assignments tpa on tpa.team_id = me.team_id and tpa.tenant_id = me.tenant_id
    union
    select tpa.plan_id
    from me
    join public.team_squad_members m on m.athlete_id = me.id and m.team_id = me.team_id
    join public.team_squads s on s.id = m.squad_id and s.archived_at is null
    join public.training_plan_assignments tpa on tpa.squad_id = m.squad_id and tpa.scope = 'squad' and tpa.tenant_id = me.tenant_id
  )
  select coalesce(array_agg(distinct tp.id), '{}'::uuid[])
  from assigned
  join public.training_plans tp on tp.id = assigned.plan_id
  where tp.status = 'published'
    and tp.tenant_id = (select me.tenant_id from me)
$$;

revoke all on function public.guardian_athlete_plan_ids(uuid) from public, anon;
grant execute on function public.guardian_athlete_plan_ids(uuid) to authenticated, service_role;

create or replace function public.current_guardian_plan_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
  from unnest(public.current_guardian_athlete_ids()) x(id)
  cross join lateral unnest(public.guardian_athlete_plan_ids(x.id)) p(id)
$$;

revoke all on function public.current_guardian_plan_ids() from public, anon;
grant execute on function public.current_guardian_plan_ids() to authenticated, service_role;

-- The test weeks one linked child is in (same rule as current_athlete_test_week_ids).
create or replace function public.guardian_athlete_test_week_ids(p_athlete_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select a.id, a.team_id, a.tenant_id
    from public.athletes a
    where a.id = p_athlete_id
      and a.id = any (public.current_guardian_athlete_ids())
  ),
  weeks as (
    select tw.id
    from me
    join public.test_weeks tw on tw.team_id = me.team_id and tw.tenant_id = me.tenant_id
    where tw.status in ('published', 'closed')
      and not tw.is_archived
      and public.squads_include_athlete(tw.squad_ids, me.id)
    union
    select tr.test_week_id
    from me
    join public.test_results tr on tr.tenant_id = me.tenant_id and tr.athlete_id = me.id
  )
  select coalesce(array_agg(weeks.id), '{}'::uuid[]) from weeks
$$;

revoke all on function public.guardian_athlete_test_week_ids(uuid) from public, anon;
grant execute on function public.guardian_athlete_test_week_ids(uuid) to authenticated, service_role;

create or replace function public.current_guardian_test_week_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct w.id), '{}'::uuid[])
  from unnest(public.current_guardian_athlete_ids()) x(id)
  cross join lateral unnest(public.guardian_athlete_test_week_ids(x.id)) w(id)
$$;

revoke all on function public.current_guardian_test_week_ids() from public, anon;
grant execute on function public.current_guardian_test_week_ids() to authenticated, service_role;

-- Competitions of a child's team, of the whole club, a child's own, and any a child is entered in.
create or replace function public.current_guardian_competition_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with kids as (
    select a.id, a.team_id, a.tenant_id
    from public.athletes a
    where a.id = any (public.current_guardian_athlete_ids())
  ),
  visible as (
    select c.id
    from kids
    join public.competitions c on c.tenant_id = kids.tenant_id
    where (c.scope = 'team' and c.team_id is not null and c.team_id = kids.team_id)
       or c.scope = 'club'
       or (c.scope = 'athlete' and c.owner_athlete_id = kids.id)
    union
    select ce.competition_id
    from kids
    join public.competition_entries ce on ce.athlete_id = kids.id and ce.tenant_id = kids.tenant_id
  )
  select coalesce(array_agg(visible.id), '{}'::uuid[]) from visible
$$;

revoke all on function public.current_guardian_competition_ids() from public, anon;
grant execute on function public.current_guardian_competition_ids() to authenticated, service_role;

-- 5. Policies on the two new tables ---------------------------------------------------------------

drop policy if exists athlete_guardians_select_scope on public.athlete_guardians;
create policy athlete_guardians_select_scope
on public.athlete_guardians
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    guardian_user_id = auth.uid()
    or athlete_id = (select public.current_athlete_id())
    or (select public.is_club_admin())
    -- Lead and coach only: assistants do not manage guardians.
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

drop policy if exists guardian_invites_select_staff on public.guardian_invites;
create policy guardian_invites_select_staff
on public.guardian_invites
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    (select public.is_club_admin())
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

-- 6. What a guardian reads: SELECT only, linked children only -----------------------------------
-- Not listed here means closed to a guardian.

drop policy if exists athletes_select_guardian on public.athletes;
create policy athletes_select_guardian on public.athletes for select to authenticated
using (tenant_id = public.current_tenant_id() and id = any ((select public.current_guardian_athlete_ids())::uuid[]));

-- The child's team (its name). Not its roster: athletes above is the linked children only.
drop policy if exists teams_select_guardian on public.teams;
create policy teams_select_guardian on public.teams for select to authenticated
using (tenant_id = public.current_tenant_id() and id = any ((select public.current_guardian_team_ids())::uuid[]));

drop policy if exists training_plans_select_guardian on public.training_plans;
create policy training_plans_select_guardian on public.training_plans for select to authenticated
using (tenant_id = public.current_tenant_id() and status = 'published' and id = any ((select public.current_guardian_plan_ids())::uuid[]));

drop policy if exists training_plan_weeks_select_guardian on public.training_plan_weeks;
create policy training_plan_weeks_select_guardian on public.training_plan_weeks for select to authenticated
using (plan_id = any ((select public.current_guardian_plan_ids())::uuid[]));

drop policy if exists training_plan_days_select_guardian on public.training_plan_days;
create policy training_plan_days_select_guardian on public.training_plan_days for select to authenticated
using (
  exists (
    select 1 from public.training_plan_weeks tpw
    where tpw.id = training_plan_days.plan_week_id
      and tpw.plan_id = any ((select public.current_guardian_plan_ids())::uuid[])
  )
);

drop policy if exists training_plan_blocks_select_guardian on public.training_plan_blocks;
create policy training_plan_blocks_select_guardian on public.training_plan_blocks for select to authenticated
using (
  exists (
    select 1
    from public.training_plan_days tpd
    join public.training_plan_weeks tpw on tpw.id = tpd.plan_week_id
    where tpd.id = training_plan_blocks.plan_day_id
      and tpw.plan_id = any ((select public.current_guardian_plan_ids())::uuid[])
  )
);

drop policy if exists competitions_select_guardian on public.competitions;
create policy competitions_select_guardian on public.competitions for select to authenticated
using (tenant_id = public.current_tenant_id() and id = any ((select public.current_guardian_competition_ids())::uuid[]));

drop policy if exists competition_entries_select_guardian on public.competition_entries;
create policy competition_entries_select_guardian on public.competition_entries for select to authenticated
using (tenant_id = public.current_tenant_id() and athlete_id = any ((select public.current_guardian_athlete_ids())::uuid[]));

drop policy if exists athlete_results_select_guardian on public.athlete_results;
create policy athlete_results_select_guardian on public.athlete_results for select to authenticated
using (tenant_id = public.current_tenant_id() and athlete_id = any ((select public.current_guardian_athlete_ids())::uuid[]));

drop policy if exists pr_records_select_guardian on public.pr_records;
create policy pr_records_select_guardian on public.pr_records for select to authenticated
using (tenant_id = public.current_tenant_id() and athlete_id = any ((select public.current_guardian_athlete_ids())::uuid[]));

drop policy if exists athlete_goals_select_guardian on public.athlete_goals;
create policy athlete_goals_select_guardian on public.athlete_goals for select to authenticated
using (tenant_id = public.current_tenant_id() and athlete_id = any ((select public.current_guardian_athlete_ids())::uuid[]));

drop policy if exists test_weeks_select_guardian on public.test_weeks;
create policy test_weeks_select_guardian on public.test_weeks for select to authenticated
using (tenant_id = public.current_tenant_id() and id = any ((select public.current_guardian_test_week_ids())::uuid[]));

drop policy if exists test_definitions_select_guardian on public.test_definitions;
create policy test_definitions_select_guardian on public.test_definitions for select to authenticated
using (test_week_id = any ((select public.current_guardian_test_week_ids())::uuid[]));

drop policy if exists test_results_select_guardian on public.test_results;
create policy test_results_select_guardian on public.test_results for select to authenticated
using (tenant_id = public.current_tenant_id() and athlete_id = any ((select public.current_guardian_athlete_ids())::uuid[]));

-- Reports the coach shared with the athlete. One that carries a health section (wellness trend,
-- injury notes) only when the guardian may read that child's health data.
drop policy if exists athlete_reports_select_guardian on public.athlete_reports;
create policy athlete_reports_select_guardian on public.athlete_reports for select to authenticated
using (
  tenant_id = public.current_tenant_id()
  and shared_with_athlete_at is not null
  and athlete_id = any ((select public.current_guardian_athlete_ids())::uuid[])
  and (
    not (sections && array['wellness', 'injuries']::text[])
    or athlete_id = any ((select public.current_guardian_health_athlete_ids())::uuid[])
  )
);

-- Announcements to a child's team and to the whole club. Never the ones for coaches.
drop policy if exists announcements_select_guardian on public.announcements;
create policy announcements_select_guardian on public.announcements for select to authenticated
using (
  tenant_id = public.current_tenant_id()
  and cardinality((select public.current_guardian_athlete_ids())) > 0
  and (
    audience = 'club'
    or (audience = 'team' and team_id is not null and team_id = any ((select public.current_guardian_team_ids())::uuid[]))
  )
);

-- The team calendar: events of a child's team. (Whole club events are already open to every
-- member of the club through current_club_event_ids, 20261014100000.)
drop policy if exists club_events_select_guardian on public.club_events;
create policy club_events_select_guardian on public.club_events for select to authenticated
using (
  tenant_id = public.current_tenant_id()
  and exists (
    select 1 from public.club_event_teams t
    where t.event_id = club_events.id
      and t.team_id = any ((select public.current_guardian_team_ids())::uuid[])
  )
);

drop policy if exists club_event_teams_select_guardian on public.club_event_teams;
create policy club_event_teams_select_guardian on public.club_event_teams for select to authenticated
using (tenant_id = public.current_tenant_id() and team_id = any ((select public.current_guardian_team_ids())::uuid[]));

-- Health: the stricter helper.
drop policy if exists wellness_entries_select_guardian on public.wellness_entries;
create policy wellness_entries_select_guardian on public.wellness_entries for select to authenticated
using (tenant_id = public.current_tenant_id() and athlete_id = any ((select public.current_guardian_health_athlete_ids())::uuid[]));

drop policy if exists pain_reports_select_guardian on public.pain_reports;
create policy pain_reports_select_guardian on public.pain_reports for select to authenticated
using (tenant_id = public.current_tenant_id() and athlete_id = any ((select public.current_guardian_health_athlete_ids())::uuid[]));

drop policy if exists athlete_availability_select_guardian on public.athlete_availability;
create policy athlete_availability_select_guardian on public.athlete_availability for select to authenticated
using (tenant_id = public.current_tenant_id() and athlete_id = any ((select public.current_guardian_health_athlete_ids())::uuid[]));

-- 7. Notifications --------------------------------------------------------------------------------

-- Tells every active guardian of one athlete. With p_health, only when the guardian may read the
-- athlete's health data. Internal.
create or replace function public.notify_athlete_guardians(
  p_athlete_id uuid,
  p_event_type text,
  p_subject text,
  p_body text,
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_health boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete record;
  v_guardian uuid;
  v_count integer := 0;
begin
  select a.id, a.tenant_id, a.first_name into v_athlete
  from public.athletes a
  where a.id = p_athlete_id and a.is_active;
  if not found then
    return 0;
  end if;
  if coalesce(p_health, false) and public.guardian_health_rule(p_athlete_id) not in ('minor', 'adult_opted_in') then
    return 0;
  end if;
  for v_guardian in
    select ag.guardian_user_id
    from public.athlete_guardians ag
    join public.profiles p on p.user_id = ag.guardian_user_id and p.tenant_id = ag.tenant_id and p.role = 'guardian' and p.is_active
    where ag.athlete_id = p_athlete_id and ag.status = 'active'
  loop
    v_count := v_count + public.enqueue_notification(
      v_athlete.tenant_id,
      v_guardian,
      p_event_type,
      p_subject,
      p_body,
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('athlete_id', p_athlete_id::text),
      array['in-app', 'email'],
      p_dedupe_key,
      case when p_dedupe_key is null then null else interval '1 day' end
    );
  end loop;
  return v_count;
exception
  when others then
    -- A notification must never stop the coach's own action.
    raise warning 'notify_athlete_guardians(%) failed: %', p_event_type, sqlerrm;
    return 0;
end;
$$;

revoke all on function public.notify_athlete_guardians(uuid, text, text, text, jsonb, text, boolean) from public, anon, authenticated;

-- Plan published: the athletes the plan reaches (same audience as notify_training_plan_audience,
-- but an athlete needs no login of their own for their guardian to be told).
create or replace function public.notify_guardians_of_plan(p_plan_id uuid, p_assignment_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_athlete record;
  v_count integer := 0;
begin
  select tp.id, tp.tenant_id, tp.name, tp.start_date, tp.status into v_plan
  from public.training_plans tp where tp.id = p_plan_id;
  if not found or v_plan.status <> 'published' then
    return 0;
  end if;
  for v_athlete in
    select distinct a.id, a.first_name
    from public.training_plan_assignments tpa
    join public.athletes a
      on a.tenant_id = tpa.tenant_id
     and (
       (tpa.scope = 'athlete' and a.id = tpa.athlete_id)
       or (tpa.scope = 'team' and a.team_id = tpa.team_id)
       or (
         tpa.scope = 'squad'
         and exists (
           select 1
           from public.team_squad_members m
           join public.team_squads sq on sq.id = m.squad_id
           where m.squad_id = tpa.squad_id and m.athlete_id = a.id and sq.archived_at is null
         )
       )
     )
    where tpa.plan_id = v_plan.id
      and tpa.tenant_id = v_plan.tenant_id
      and tpa.visibility_start = 'immediate'
      and (p_assignment_id is null or tpa.id = p_assignment_id)
      and a.is_active
      and exists (select 1 from public.athlete_guardians ag where ag.athlete_id = a.id and ag.status = 'active')
  loop
    v_count := v_count + public.notify_athlete_guardians(
      v_athlete.id,
      'guardian_plan_published',
      format('New training plan for %s: %s', v_athlete.first_name, coalesce(nullif(btrim(v_plan.name), ''), 'Training plan')),
      format('The coach published a plan%s. Open it to see the week.',
             case when v_plan.start_date is null then '' else format(' that starts on %s', public.notification_date_label(v_plan.start_date)) end),
      jsonb_build_object('plan_id', v_plan.id::text),
      'guardian_plan:' || v_plan.id::text || ':' || v_athlete.id::text
    );
  end loop;
  return v_count;
end;
$$;

revoke all on function public.notify_guardians_of_plan(uuid, uuid) from public, anon, authenticated;

create or replace function public.guardian_plan_assignment_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility_start = 'immediate' and (tg_op = 'INSERT' or old.visibility_start is distinct from 'immediate') then
    perform public.notify_guardians_of_plan(new.plan_id, new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.guardian_plan_assignment_notify() from public, anon, authenticated;

drop trigger if exists guardian_plan_assignment_notify on public.training_plan_assignments;
create trigger guardian_plan_assignment_notify after insert or update of visibility_start on public.training_plan_assignments
  for each row execute function public.guardian_plan_assignment_notify();

create or replace function public.guardian_plan_published_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    perform public.notify_guardians_of_plan(new.id, null);
  end if;
  return new;
end;
$$;

revoke all on function public.guardian_plan_published_notify() from public, anon, authenticated;

drop trigger if exists guardian_plan_published_notify on public.training_plans;
create trigger guardian_plan_published_notify after update of status on public.training_plans
  for each row execute function public.guardian_plan_published_notify();

create or replace function public.guardian_test_week_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete record;
begin
  if new.status <> 'published' or new.is_archived or new.team_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'closed' then
    return new;
  end if;
  for v_athlete in
    select a.id, a.first_name
    from public.athletes a
    where a.team_id = new.team_id
      and a.tenant_id = new.tenant_id
      and a.is_active
      and public.squads_include_athlete(new.squad_ids, a.id)
      and exists (select 1 from public.athlete_guardians ag where ag.athlete_id = a.id and ag.status = 'active')
  loop
    perform public.notify_athlete_guardians(
      v_athlete.id,
      'guardian_test_week_published',
      format('Test week for %s: %s', v_athlete.first_name, coalesce(nullif(btrim(new.name), ''), 'Test week')),
      format('It runs from %s to %s.', public.notification_date_label(new.start_date), public.notification_date_label(new.end_date)),
      jsonb_build_object('test_week_id', new.id::text),
      'guardian_test_week:' || new.id::text || ':' || v_athlete.id::text
    );
  end loop;
  return new;
end;
$$;

revoke all on function public.guardian_test_week_notify() from public, anon, authenticated;

drop trigger if exists guardian_test_week_notify on public.test_weeks;
create trigger guardian_test_week_notify after insert or update of status on public.test_weeks
  for each row execute function public.guardian_test_week_notify();

-- A new pain or injury report by their child. Health: only when the guardian may read it.
create or replace function public.guardian_pain_report_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.status <> 'open' then
    return new;
  end if;
  select a.first_name into v_name from public.athletes a where a.id = new.athlete_id;
  perform public.notify_athlete_guardians(
    new.athlete_id,
    'guardian_pain_reported',
    format('%s sent a pain or injury report', coalesce(v_name, 'Your child')),
    -- No health detail in the notification itself (it is also emailed): the report is read in the app.
    'Open SKTR Coach to read it. Their coach can see it too.',
    jsonb_build_object('pain_report_id', new.id::text),
    'guardian_pain:' || new.id::text,
    true
  );
  return new;
end;
$$;

revoke all on function public.guardian_pain_report_notify() from public, anon, authenticated;

drop trigger if exists guardian_pain_report_notify on public.pain_reports;
create trigger guardian_pain_report_notify after insert on public.pain_reports
  for each row execute function public.guardian_pain_report_notify();

-- A report shared with the athlete is shared with their guardians too (health sections: see the policy).
create or replace function public.guardian_report_shared_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.shared_with_athlete_at is null or old.shared_with_athlete_at is not null then
    return new;
  end if;
  select a.first_name into v_name from public.athletes a where a.id = new.athlete_id;
  perform public.notify_athlete_guardians(
    new.athlete_id,
    'guardian_report_shared',
    format('The coach shared a report about %s', coalesce(v_name, 'your child')),
    format('It covers %s to %s. Open it to read it or print it.',
           public.notification_date_label(new.period_start), public.notification_date_label(new.period_end)),
    jsonb_build_object('report_id', new.id::text),
    'guardian_report:' || new.id::text,
    new.sections && array['wellness', 'injuries']::text[]
  );
  return new;
end;
$$;

revoke all on function public.guardian_report_shared_notify() from public, anon, authenticated;

drop trigger if exists guardian_report_shared_notify on public.athlete_reports;
create trigger guardian_report_shared_notify after update of shared_with_athlete_at on public.athlete_reports
  for each row execute function public.guardian_report_shared_notify();

-- An announcement to a team or to the whole club reaches the guardians of its athletes, once each.
create or replace function public.guardian_announcement_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guardian uuid;
  v_team_name text;
begin
  if new.audience not in ('team', 'club') then
    return new;
  end if;
  select tm.name into v_team_name from public.teams tm where tm.id = new.team_id;
  for v_guardian in
    select distinct ag.guardian_user_id
    from public.athlete_guardians ag
    join public.athletes a on a.id = ag.athlete_id and a.tenant_id = ag.tenant_id and a.is_active
    join public.profiles p on p.user_id = ag.guardian_user_id and p.tenant_id = ag.tenant_id and p.role = 'guardian' and p.is_active
    where ag.tenant_id = new.tenant_id
      and ag.status = 'active'
      and (new.audience = 'club' or a.team_id = new.team_id)
  loop
    perform public.enqueue_notification(
      new.tenant_id,
      v_guardian,
      'guardian_announcement_posted',
      case when new.audience = 'team' then format('%s: announcement', coalesce(v_team_name, 'Team')) else 'Club announcement' end,
      new.body,
      jsonb_build_object('announcement_id', new.id::text),
      array['in-app', 'email']
    );
  end loop;
  return new;
exception
  when others then
    raise warning 'guardian_announcement_notify failed: %', sqlerrm;
    return new;
end;
$$;

revoke all on function public.guardian_announcement_notify() from public, anon, authenticated;

drop trigger if exists guardian_announcement_notify on public.announcements;
create trigger guardian_announcement_notify after insert on public.announcements
  for each row execute function public.guardian_announcement_notify();

-- 8. Inviting, linking, revoking (staff) ----------------------------------------------------------

-- Invites a guardian for one athlete, or links a guardian who already has an account in this club.
-- Returns {"outcome": "invited", "invite_id": ...} or {"outcome": "linked", "link_id": ...}.
create or replace function public.invite_guardian(p_athlete_id uuid, p_email text, p_name text default null, p_relationship text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete public.athletes%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := public.roster_clean_name(p_name, 120);
  v_relationship text := coalesce(public.roster_clean_name(p_relationship, 40), 'Guardian');
  v_standing record;
  v_link_id uuid;
  v_invite_id uuid;
  v_count integer;
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_athlete
  from public.athletes a
  where a.id = p_athlete_id and a.tenant_id = public.current_tenant_id() and a.is_active;
  -- can_manage_athlete: a lead or coach of the athlete's team, or a club admin. Not an assistant.
  if not found or not public.can_manage_athlete(p_athlete_id) then
    raise exception 'Only a coach of this athlete''s team or a club admin can invite a guardian.'
      using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_email = '' or not public.contact_email_is_valid(v_email) or v_email ~ '[<>"'',;\s]' then
    raise exception 'Enter a valid email address for the guardian.' using errcode = '23514', hint = 'invalid_email';
  end if;

  select * into v_standing from public.guardian_email_standing(v_athlete.tenant_id, v_email);
  if v_standing.standing = 'has_role' then
    raise exception 'This email already has a coach, admin or athlete account. A guardian needs their own email address.'
      using errcode = 'P0001', hint = 'role_mixing';
  end if;
  if v_standing.standing = 'other_club' then
    raise exception 'This email already has an account at another club. A guardian needs a different email address for this club.'
      using errcode = 'P0001', hint = 'role_mixing';
  end if;

  select count(*) into v_count
  from (
    select ag.id from public.athlete_guardians ag where ag.athlete_id = p_athlete_id and ag.status = 'active'
    union all
    select gi.id from public.guardian_invites gi
    where gi.athlete_id = p_athlete_id and gi.status = 'pending' and gi.email <> v_email
      and (gi.expires_at is null or gi.expires_at >= now())
  ) x;
  if v_count >= 6 then
    raise exception 'This athlete already has 6 guardians or open invites. Remove one first.' using errcode = 'P0001', hint = 'too_many';
  end if;

  if v_standing.standing = 'guardian' then
    insert into public.athlete_guardians (tenant_id, athlete_id, guardian_user_id, relationship, status, invited_by_user_id)
    values (v_athlete.tenant_id, p_athlete_id, v_standing.found_user_id, v_relationship, 'active', auth.uid())
    on conflict (athlete_id, guardian_user_id) do update
    set status = 'active', revoked_at = null, revoked_by_user_id = null,
        relationship = excluded.relationship, invited_by_user_id = excluded.invited_by_user_id
    returning id into v_link_id;
    update public.guardian_invites gi
    set status = 'revoked'
    where gi.athlete_id = p_athlete_id and gi.email = v_email and gi.status = 'pending';
    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (v_athlete.tenant_id, auth.uid(), coalesce(public.current_app_role(), 'coach'), 'guardian_linked', v_email,
            format('an existing guardian account was linked to athlete %s as %s', p_athlete_id, v_relationship));
    perform public.enqueue_notification(
      v_athlete.tenant_id, v_standing.found_user_id, 'guardian_linked',
      format('You can now follow %s', v_athlete.first_name),
      'The club added them to your account.',
      jsonb_build_object('athlete_id', p_athlete_id::text)
    );
    return jsonb_build_object('outcome', 'linked', 'link_id', v_link_id);
  end if;

  insert into public.guardian_invites (tenant_id, athlete_id, email, invitee_name, relationship, status, invited_by_user_id, expires_at)
  values (v_athlete.tenant_id, p_athlete_id, v_email, v_name, v_relationship, 'pending', auth.uid(), now() + interval '14 days')
  on conflict (athlete_id, email) where status = 'pending' do update
  set invitee_name = excluded.invitee_name,
      relationship = excluded.relationship,
      invited_by_user_id = excluded.invited_by_user_id,
      expires_at = excluded.expires_at
  returning id into v_invite_id;
  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_athlete.tenant_id, auth.uid(), coalesce(public.current_app_role(), 'coach'), 'guardian_invite_created', v_email,
          format('guardian invite %s for athlete %s as %s', v_invite_id, p_athlete_id, v_relationship));
  return jsonb_build_object('outcome', 'invited', 'invite_id', v_invite_id);
end;
$$;

revoke all on function public.invite_guardian(uuid, text, text, text) from public, anon;
grant execute on function public.invite_guardian(uuid, text, text, text) to authenticated, service_role;

-- May the caller send (or resend) this invite's email? Asked by send-invite-email as the caller.
create or replace function public.can_send_guardian_invite(p_invite_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.guardian_invites gi
    where gi.id = p_invite_id
      and gi.tenant_id = public.current_tenant_id()
      and public.can_manage_athlete(gi.athlete_id)
  )
$$;

revoke all on function public.can_send_guardian_invite(uuid) from public, anon;
grant execute on function public.can_send_guardian_invite(uuid) to authenticated, service_role;

-- Ends a guardian's access to one child at once. Staff only: a guardian cannot do this themselves.
create or replace function public.revoke_guardian_link(p_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.athlete_guardians%rowtype;
  v_name text;
begin
  perform public.assert_caller_active();
  select * into v_link from public.athlete_guardians ag
  where ag.id = p_link_id and ag.tenant_id = public.current_tenant_id()
  for update;
  if not found or not public.can_manage_athlete(v_link.athlete_id) then
    raise exception 'Only a coach of this athlete''s team or a club admin can remove a guardian.'
      using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_link.status = 'revoked' then
    return false;
  end if;
  update public.athlete_guardians
  set status = 'revoked', revoked_at = now(), revoked_by_user_id = auth.uid()
  where id = v_link.id;
  select a.first_name into v_name from public.athletes a where a.id = v_link.athlete_id;
  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_link.tenant_id, auth.uid(), coalesce(public.current_app_role(), 'coach'), 'guardian_access_removed', v_link.athlete_id::text,
          'a guardian''s access to this athlete was removed');
  perform public.enqueue_notification(
    v_link.tenant_id, v_link.guardian_user_id, 'guardian_unlinked',
    format('Your access to %s has ended', coalesce(v_name, 'an athlete')),
    'The club removed it. Contact the club if you think this is a mistake.',
    '{}'::jsonb
  );
  return true;
end;
$$;

revoke all on function public.revoke_guardian_link(uuid) from public, anon;
grant execute on function public.revoke_guardian_link(uuid) to authenticated, service_role;

create or replace function public.cancel_guardian_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.guardian_invites%rowtype;
begin
  perform public.assert_caller_active();
  select * into v_invite from public.guardian_invites gi
  where gi.id = p_invite_id and gi.tenant_id = public.current_tenant_id()
  for update;
  if not found or not public.can_manage_athlete(v_invite.athlete_id) then
    raise exception 'Only a coach of this athlete''s team or a club admin can cancel this invite.'
      using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_invite.status <> 'pending' then
    return false;
  end if;
  update public.guardian_invites set status = 'revoked' where id = v_invite.id;
  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_invite.tenant_id, auth.uid(), coalesce(public.current_app_role(), 'coach'), 'guardian_invite_cancelled', v_invite.email,
          format('guardian invite %s cancelled', v_invite.id));
  return true;
end;
$$;

revoke all on function public.cancel_guardian_invite(uuid) from public, anon;
grant execute on function public.cancel_guardian_invite(uuid) to authenticated, service_role;

-- The guardians and open invites of one athlete, for the coach's athlete page. Lead, coach or
-- club admin. Also says whether guardians can read the athlete's health data, and why.
create or replace function public.get_athlete_guardians(p_athlete_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_athlete public.athletes%rowtype;
begin
  perform public.assert_caller_active();
  select * into v_athlete from public.athletes a
  where a.id = p_athlete_id and a.tenant_id = public.current_tenant_id();
  if not found or not public.can_manage_athlete(p_athlete_id) then
    return null;
  end if;
  return jsonb_build_object(
    'health_rule', public.guardian_health_rule(p_athlete_id),
    'stored_guardian', (
      select jsonb_build_object('name', d.guardian_name, 'email', d.guardian_email)
      from public.athlete_private_details d where d.athlete_id = p_athlete_id
    ),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ag.id,
        'name', nullif(btrim(coalesce(p.display_name, '')), ''),
        'email', lower(au.email),
        'relationship', ag.relationship,
        'since', ag.created_at
      ) order by ag.created_at)
      from public.athlete_guardians ag
      left join public.profiles p on p.user_id = ag.guardian_user_id
      left join auth.users au on au.id = ag.guardian_user_id
      where ag.athlete_id = p_athlete_id and ag.status = 'active'
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gi.id,
        'name', gi.invitee_name,
        'email', gi.email,
        'relationship', gi.relationship,
        'expires_at', gi.expires_at,
        'expired', gi.expires_at is not null and gi.expires_at < now(),
        'last_email_sent_at', gi.last_email_sent_at
      ) order by gi.created_at)
      from public.guardian_invites gi
      where gi.athlete_id = p_athlete_id and gi.status = 'pending'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_athlete_guardians(uuid) from public, anon;
grant execute on function public.get_athlete_guardians(uuid) to authenticated, service_role;

-- Every guardian link and open invite of the club, for the club admin's People screen.
create or replace function public.get_club_guardians()
returns table (
  kind text,
  id uuid,
  athlete_id uuid,
  athlete_name text,
  team_name text,
  guardian_name text,
  email text,
  relationship text,
  since timestamptz,
  expired boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select 'link'::text, ag.id, a.id, btrim(a.first_name || ' ' || a.last_name), t.name,
         nullif(btrim(coalesce(p.display_name, '')), ''), lower(au.email)::text, ag.relationship, ag.created_at, false
  from public.athlete_guardians ag
  join public.athletes a on a.id = ag.athlete_id
  left join public.teams t on t.id = a.team_id
  left join public.profiles p on p.user_id = ag.guardian_user_id
  left join auth.users au on au.id = ag.guardian_user_id
  where public.is_club_admin()
    and ag.tenant_id = public.current_tenant_id()
    and ag.status = 'active'
  union all
  select 'invite'::text, gi.id, a.id, btrim(a.first_name || ' ' || a.last_name), t.name,
         gi.invitee_name, gi.email, gi.relationship, gi.created_at, gi.expires_at is not null and gi.expires_at < now()
  from public.guardian_invites gi
  join public.athletes a on a.id = gi.athlete_id
  left join public.teams t on t.id = a.team_id
  where public.is_club_admin()
    and gi.tenant_id = public.current_tenant_id()
    and gi.status = 'pending'
  order by 4, 9
$$;

revoke all on function public.get_club_guardians() from public, anon;
grant execute on function public.get_club_guardians() to authenticated, service_role;

-- 9. Claiming an invite ---------------------------------------------------------------------------

-- What the claim page shows before sign-in. The invite id is the secret, as for coach invites.
create or replace function public.get_public_guardian_invite(p_invite_id uuid)
returns table (
  invite_id uuid,
  email text,
  status text,
  expired boolean,
  organization_name text,
  athlete_first_name text,
  invitee_name text,
  relationship text,
  has_existing_account boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    gi.id,
    gi.email,
    gi.status,
    gi.expires_at is not null and gi.expires_at < now(),
    public.club_display_name(gi.tenant_id),
    a.first_name,
    gi.invitee_name,
    gi.relationship,
    exists (select 1 from auth.users au where lower(btrim(coalesce(au.email, ''))) = gi.email)
  from public.guardian_invites gi
  join public.athletes a on a.id = gi.athlete_id
  where gi.id = p_invite_id
  limit 1
$$;

revoke all on function public.get_public_guardian_invite(uuid) from public;
grant execute on function public.get_public_guardian_invite(uuid) to anon, authenticated, service_role;

-- The signed-in person accepts an invite sent to their (confirmed) email. Creates the guardian
-- profile on first use, and links every open invite the same club sent to that email, so a parent
-- invited for two children accepts once. Returns the club.
create or replace function public.accept_guardian_invite(p_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_meta_name text;
  v_invite public.guardian_invites%rowtype;
  v_other public.guardian_invites%rowtype;
  v_profile public.profiles%rowtype;
  v_standing record;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select lower(btrim(coalesce(au.email, ''))),
         nullif(btrim(coalesce(au.raw_user_meta_data ->> 'display_name', au.raw_user_meta_data ->> 'full_name', '')), '')
  into v_email, v_meta_name
  from auth.users au
  where au.id = v_user_id and au.email_confirmed_at is not null;
  if v_email is null or v_email = '' then
    raise exception 'Confirm your email address first.' using errcode = 'P0001', hint = 'email_not_confirmed';
  end if;

  select * into v_invite from public.guardian_invites gi where gi.id = p_invite_id for update;
  if not found then
    raise exception 'Invite not found' using errcode = 'P0001', hint = 'invite_not_found';
  end if;
  if public.tenant_access_blocked(v_invite.tenant_id) then
    perform public.raise_access_paused();
  end if;
  if v_invite.email <> v_email then
    raise exception 'This invite is for a different email address.' using errcode = 'P0001', hint = 'wrong_email';
  end if;
  if v_invite.status = 'accepted' and v_invite.accepted_by_user_id = v_user_id then
    return v_invite.tenant_id;
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'This invite is no longer open. Ask the club for a new one.' using errcode = 'P0001', hint = 'invite_not_pending';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'This invite has expired. Ask the club for a new one.' using errcode = 'P0001', hint = 'invite_expired';
  end if;

  select * into v_profile from public.profiles p where p.user_id = v_user_id limit 1;
  if found then
    if v_profile.role <> 'guardian' then
      raise exception 'This email already has a coach, admin or athlete account. A guardian needs their own email address.'
        using errcode = 'P0001', hint = 'role_mixing';
    end if;
    if v_profile.tenant_id <> v_invite.tenant_id then
      raise exception 'This email already has an account at another club.' using errcode = 'P0001', hint = 'role_mixing';
    end if;
    if not v_profile.is_active then
      perform public.raise_access_paused();
    end if;
  else
    select * into v_standing from public.guardian_email_standing(v_invite.tenant_id, v_email);
    if v_standing.standing <> 'new' then
      raise exception 'This email already has a coach, admin or athlete account. A guardian needs their own email address.'
        using errcode = 'P0001', hint = 'role_mixing';
    end if;
    insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
    values (v_user_id, v_invite.tenant_id, 'guardian', coalesce(v_meta_name, v_invite.invitee_name), true);
  end if;

  for v_other in
    select * from public.guardian_invites gi
    where gi.tenant_id = v_invite.tenant_id
      and gi.email = v_email
      and gi.status = 'pending'
      and (gi.expires_at is null or gi.expires_at >= now())
    order by gi.created_at
    for update
  loop
    if exists (select 1 from public.athletes a where a.id = v_other.athlete_id and a.tenant_id = v_other.tenant_id and a.is_active) then
      insert into public.athlete_guardians (tenant_id, athlete_id, guardian_user_id, relationship, status, invited_by_user_id)
      values (v_other.tenant_id, v_other.athlete_id, v_user_id, v_other.relationship, 'active', v_other.invited_by_user_id)
      on conflict (athlete_id, guardian_user_id) do update
      set status = 'active', revoked_at = null, revoked_by_user_id = null,
          relationship = excluded.relationship, invited_by_user_id = excluded.invited_by_user_id;
    end if;
    update public.guardian_invites
    set status = 'accepted', accepted_at = now(), accepted_by_user_id = v_user_id
    where id = v_other.id;
    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (v_other.tenant_id, v_user_id, 'guardian', 'guardian_invite_accepted', v_email,
            format('guardian invite %s accepted for athlete %s', v_other.id, v_other.athlete_id));
    if v_other.invited_by_user_id is not null then
      perform public.enqueue_notification(
        v_other.tenant_id, v_other.invited_by_user_id, 'guardian_invite_accepted',
        format('%s accepted the guardian invite', coalesce(v_other.invitee_name, v_email)),
        format('They can now follow %s.', public.notification_athlete_name(v_other.athlete_id)),
        jsonb_build_object('athlete_id', v_other.athlete_id::text),
        array['in-app']
      );
    end if;
  end loop;

  return v_invite.tenant_id;
end;
$$;

revoke all on function public.accept_guardian_invite(uuid) from public, anon;
grant execute on function public.accept_guardian_invite(uuid) to authenticated, service_role;

-- 10. What a guardian calls -----------------------------------------------------------------------

-- The caller's children, with whether health is visible and why.
create or replace function public.get_guardian_children()
returns table (
  link_id uuid,
  athlete_id uuid,
  first_name text,
  last_name text,
  team_id uuid,
  team_name text,
  primary_event text,
  relationship text,
  health_rule text,
  club_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select ag.id, a.id, a.first_name, a.last_name, a.team_id, t.name, a.primary_event, ag.relationship,
         public.guardian_health_rule(a.id), public.club_display_name(a.tenant_id)
  from public.athlete_guardians ag
  join public.athletes a on a.id = ag.athlete_id
  left join public.teams t on t.id = a.team_id
  where ag.guardian_user_id = auth.uid()
    and ag.status = 'active'
    and a.id = any (public.current_guardian_athlete_ids())
  order by a.first_name, a.last_name
$$;

revoke all on function public.get_guardian_children() from public, anon;
grant execute on function public.get_guardian_children() to authenticated, service_role;

-- One child's sessions between two days: what was planned, done or skipped. The reason for a
-- skip can be "sick" or "injured", so it is only returned when health is visible.
create or replace function public.get_guardian_child_sessions(p_athlete_id uuid, p_from date, p_to date)
returns table (
  id uuid,
  scheduled_for date,
  title text,
  session_type text,
  status text,
  plan_id uuid,
  completed_at timestamptz,
  skip_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.scheduled_for, s.title, s.session_type, s.status, s.plan_id, s.completed_at,
         case when p_athlete_id = any (public.current_guardian_health_athlete_ids()) then s.skip_reason else null end
  from public.sessions s
  where s.athlete_id = p_athlete_id
    and p_athlete_id = any (public.current_guardian_athlete_ids())
    and s.scheduled_for between p_from and p_to
    and p_to - p_from <= 400
  order by s.scheduled_for
$$;

revoke all on function public.get_guardian_child_sessions(uuid, date, date) from public, anon;
grant execute on function public.get_guardian_child_sessions(uuid, date, date) to authenticated, service_role;

-- One child's attendance. The reason is free text a coach typed ("sick"), so health rules apply to it.
create or replace function public.get_guardian_child_attendance(p_athlete_id uuid, p_from date, p_to date)
returns table (
  attendance_date date,
  status text,
  reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select aa.attendance_date, aa.status,
         case when p_athlete_id = any (public.current_guardian_health_athlete_ids()) then aa.reason else null end
  from public.athlete_attendance aa
  where aa.athlete_id = p_athlete_id
    and p_athlete_id = any (public.current_guardian_athlete_ids())
    and aa.attendance_date between p_from and p_to
    and p_to - p_from <= 400
  order by aa.attendance_date desc
$$;

revoke all on function public.get_guardian_child_attendance(uuid, date, date) from public, anon;
grant execute on function public.get_guardian_child_attendance(uuid, date, date) to authenticated, service_role;

-- The coaches of one child's team: name and role, and the email only of a coach who chose to
-- show it to athletes (coach_contact_settings).
create or replace function public.get_guardian_child_coaches(p_athlete_id uuid)
returns table (
  display_name text,
  team_role text,
  contact_email text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(btrim(coalesce(cp.display_name, '')), ''), 'Coach'),
    tc.role,
    case
      when coalesce(ccs.show_email_to_athletes, false) and au.email_confirmed_at is not null
        then nullif(lower(btrim(au.email)), '')
      else null
    end
  from public.athletes a
  join public.team_coaches tc on tc.team_id = a.team_id and tc.tenant_id = a.tenant_id
  join public.profiles cp on cp.user_id = tc.user_id and cp.tenant_id = tc.tenant_id and cp.is_active and cp.role in ('coach', 'club-admin')
  left join public.coach_contact_settings ccs on ccs.user_id = tc.user_id and ccs.tenant_id = tc.tenant_id
  left join auth.users au on au.id = tc.user_id
  where a.id = p_athlete_id
    and a.id = any (public.current_guardian_athlete_ids())
  order by case tc.role when 'lead' then 0 when 'coach' then 1 else 2 end, 1
$$;

revoke all on function public.get_guardian_child_coaches(uuid) from public, anon;
grant execute on function public.get_guardian_child_coaches(uuid) to authenticated, service_role;

-- The guardian contact stored for one child, and the medical notes when health is visible.
create or replace function public.get_guardian_child_details(p_athlete_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_details public.athlete_private_details%rowtype;
  v_health boolean;
begin
  perform public.assert_caller_active();
  if p_athlete_id is null or not (p_athlete_id = any (public.current_guardian_athlete_ids())) then
    return null;
  end if;
  select * into v_details from public.athlete_private_details d where d.athlete_id = p_athlete_id;
  v_health := p_athlete_id = any (public.current_guardian_health_athlete_ids());
  return jsonb_build_object(
    'guardian_name', v_details.guardian_name,
    'guardian_phone', v_details.guardian_phone,
    'guardian_email', v_details.guardian_email,
    'health_visible', v_health,
    'medical_notes', case when v_health then v_details.medical_notes else null end
  );
end;
$$;

revoke all on function public.get_guardian_child_details(uuid) from public, anon;
grant execute on function public.get_guardian_child_details(uuid) to authenticated, service_role;

-- The ONE thing a guardian can change about a child: the guardian contact the club holds.
create or replace function public.update_guardian_contact(p_athlete_id uuid, p_name text, p_phone text, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := public.roster_clean_name(p_name, 120);
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_tenant uuid;
begin
  perform public.assert_caller_active();
  if p_athlete_id is null or not (p_athlete_id = any (public.current_guardian_athlete_ids())) then
    raise exception 'You can only change the contact details of an athlete you are a guardian of.'
      using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_phone is not null and not public.contact_phone_is_valid(v_phone) then
    raise exception 'Enter the phone number with digits, spaces, + or -.' using errcode = '23514';
  end if;
  if v_email is not null and not public.contact_email_is_valid(v_email) then
    raise exception 'Enter a valid email address.' using errcode = '23514';
  end if;
  select a.tenant_id into v_tenant from public.athletes a where a.id = p_athlete_id;
  insert into public.athlete_private_details (athlete_id, tenant_id, guardian_name, guardian_phone, guardian_email, updated_by_user_id)
  values (p_athlete_id, v_tenant, v_name, v_phone, v_email, auth.uid())
  on conflict (athlete_id) do update
  set guardian_name = excluded.guardian_name,
      guardian_phone = excluded.guardian_phone,
      guardian_email = excluded.guardian_email,
      updated_by_user_id = excluded.updated_by_user_id;
  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_tenant, auth.uid(), 'guardian', 'guardian_contact_updated', p_athlete_id::text,
          'a guardian updated the guardian contact details of this athlete');
end;
$$;

revoke all on function public.update_guardian_contact(uuid, text, text, text) from public, anon;
grant execute on function public.update_guardian_contact(uuid, text, text, text) to authenticated, service_role;

-- 11. What the athlete calls ----------------------------------------------------------------------

-- Who follows the calling athlete, and whether their health data is shared with them.
create or replace function public.get_my_guardian_sharing()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_athlete uuid := public.current_athlete_id();
begin
  if v_athlete is null then
    return null;
  end if;
  return jsonb_build_object(
    'health_rule', public.guardian_health_rule(v_athlete),
    'share_health', coalesce((select d.share_health_with_guardians from public.athlete_private_details d where d.athlete_id = v_athlete), false),
    'guardians', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(nullif(btrim(coalesce(p.display_name, '')), ''), 'Guardian'),
        'relationship', ag.relationship
      ) order by ag.created_at)
      from public.athlete_guardians ag
      left join public.profiles p on p.user_id = ag.guardian_user_id
      where ag.athlete_id = v_athlete and ag.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_guardian_sharing() from public, anon;
grant execute on function public.get_my_guardian_sharing() to authenticated, service_role;

-- An adult athlete switches sharing of their health data with their guardians on or off. Under
-- 18 it is always shared, so the switch does nothing until they turn 18 (it is stored anyway).
create or replace function public.set_my_guardian_health_sharing(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete public.athletes%rowtype;
begin
  perform public.assert_caller_active();
  select * into v_athlete from public.athletes a where a.id = public.current_athlete_id();
  if not found then
    raise exception 'Only an athlete can change this.' using errcode = '42501';
  end if;
  insert into public.athlete_private_details (athlete_id, tenant_id, share_health_with_guardians, updated_by_user_id)
  values (v_athlete.id, v_athlete.tenant_id, coalesce(p_enabled, false), auth.uid())
  on conflict (athlete_id) do update
  set share_health_with_guardians = excluded.share_health_with_guardians,
      updated_by_user_id = excluded.updated_by_user_id;
  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_athlete.tenant_id, auth.uid(), 'athlete', 'guardian_health_sharing_changed', v_athlete.id::text,
          case when coalesce(p_enabled, false) then 'the athlete switched sharing health data with guardians on'
               else 'the athlete switched sharing health data with guardians off' end);
  return coalesce(p_enabled, false);
end;
$$;

revoke all on function public.set_my_guardian_health_sharing(boolean) from public, anon;
grant execute on function public.set_my_guardian_health_sharing(boolean) to authenticated, service_role;

-- 12. Deleting a guardian's own account ----------------------------------------------------------
-- delete_my_account of 20261014120000, unchanged except for the guardian branch (a guardian has
-- no teams and wrote nothing of the club's, and the club admins are not told).

create or replace function public.delete_my_account(p_confirm_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_check jsonb;
  v_profile public.profiles%rowtype;
  v_has_profile boolean;
  v_email text;
  v_name text;
  v_keys text[];
  v_athlete record;
  v_coach uuid;
  v_recipient uuid;
  v_stub boolean := false;
  v_role_label text;
begin
  perform public.assert_caller_active();
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select lower(btrim(au.email)) into v_email from auth.users au where au.id = v_uid;
  if not found then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Hold the club's admin and coach rows so the checks below cannot be overtaken.
  select * into v_profile from public.profiles p where p.user_id = v_uid for update;
  v_has_profile := found;
  if v_has_profile then
    perform 1 from public.profiles p where p.tenant_id = v_profile.tenant_id and p.role = 'club-admin' order by p.user_id for update;
    perform 1 from public.team_coaches tc where tc.tenant_id = v_profile.tenant_id order by tc.id for update;
  end if;

  v_check := public.get_my_account_deletion_check();
  if v_check ->> 'reason' = 'platform_admin' then
    raise exception 'A platform admin account cannot be deleted in the app.' using errcode = 'P0001', hint = 'delete_blocked_platform_admin';
  end if;
  if v_check ->> 'reason' = 'club_owner' then
    raise exception 'You own this club. Transfer ownership to another club admin, or close the club, before deleting your account.'
      using errcode = 'P0001', hint = 'delete_blocked_club_owner';
  end if;
  if v_check ->> 'reason' = 'teams' then
    raise exception 'You still lead a team, or are the only coach of a team with athletes. A club admin must reassign those teams first.'
      using errcode = 'P0001', hint = 'delete_blocked_teams';
  end if;

  if v_email is null or v_email = '' or public.confirm_text_key(p_confirm_email) is distinct from v_email then
    raise exception 'Type your sign-in email exactly to delete your account.' using errcode = 'P0001', hint = 'confirm_mismatch';
  end if;

  -- From here on, anything that still names this account lets go of it (section 0b).
  perform set_config('sktr.deleting_users', v_uid::text, true);

  if v_has_profile then
    v_name := nullif(btrim(regexp_replace(coalesce(v_profile.display_name, ''), '\s+', ' ', 'g')), '');
    v_role_label := case v_profile.role when 'club-admin' then 'club admin' else v_profile.role end;

    if v_profile.role = 'athlete' then
      for v_athlete in
        select a.id, a.team_id, a.first_name, a.last_name, t.name as team_name
        from public.athletes a
        left join public.teams t on t.id = a.team_id
        where a.user_id = v_uid and a.tenant_id = v_profile.tenant_id
      loop
        v_name := coalesce(nullif(btrim(regexp_replace(coalesce(v_athlete.first_name, '') || ' ' || coalesce(v_athlete.last_name, ''), '\s+', ' ', 'g')), ''), v_name);
        if v_athlete.team_id is not null then
          for v_coach in select public.notification_team_coach_user_ids(v_athlete.team_id) loop
            perform public.enqueue_notification(
              v_profile.tenant_id, v_coach, 'athlete_account_deleted',
              format('%s deleted their account', coalesce(v_name, 'An athlete')),
              format('They are no longer on %s. Their sessions, results, check-ins and private details have been deleted. Your conversation with them is kept.', coalesce(v_athlete.team_name, 'your team')),
              '{}'::jsonb, array['in-app', 'email'], null, null
            );
          end loop;
        end if;
        v_stub := public.purge_athlete_personal_data(v_athlete.id) or v_stub;
      end loop;

      delete from public.athlete_invites ai
      where ai.tenant_id = v_profile.tenant_id
        and (ai.accepted_by_user_id = v_uid or lower(btrim(coalesce(ai.email, ''))) = v_email);
    elsif v_profile.role = 'guardian' then
      -- A guardian wrote nothing of the club's. Their links go with the login (cascade); the
      -- invites sent to their email are removed so the address is not kept.
      delete from public.athlete_guardians ag where ag.guardian_user_id = v_uid;
      delete from public.guardian_invites gi
      where gi.tenant_id = v_profile.tenant_id
        and (gi.accepted_by_user_id = v_uid or gi.email = v_email);
    else
      delete from public.team_coaches tc where tc.user_id = v_uid and tc.tenant_id = v_profile.tenant_id;

      update public.coach_invites ci
      set status = 'revoked', updated_at = now()
      where ci.tenant_id = v_profile.tenant_id
        and ci.status = 'pending'
        and lower(btrim(ci.email)) = v_email;

      for v_recipient in select public.notification_club_admin_user_ids(v_profile.tenant_id) loop
        perform public.enqueue_notification(
          v_profile.tenant_id, v_recipient, 'member_account_deleted',
          format('%s deleted their account', coalesce(v_name, 'A ' || v_role_label)),
          format('They were a %s in your club. The plans, notes and results they wrote stay with the club.', v_role_label),
          '{}'::jsonb, array['in-app', 'email'], null, null
        );
      end loop;
    end if;

    -- The activity log keeps what happened, not who this was.
    v_keys := array_remove(array[lower(v_name), nullif(v_email, '')], null);
    if cardinality(v_keys) > 0 then
      update public.audit_events ae
      set target = case when lower(ae.target) = any (v_keys) then 'deleted account' else ae.target end,
          detail = case when lower(ae.detail) = any (v_keys) then 'deleted account' else ae.detail end
      where ae.tenant_id = v_profile.tenant_id
        and (lower(ae.target) = any (v_keys) or lower(ae.detail) = any (v_keys));
    end if;

    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (v_profile.tenant_id, null, v_profile.role, 'account_deleted', v_role_label,
            case
              when v_profile.role = 'athlete' and v_stub then 'an athlete deleted their own account and data, their conversations are kept'
              when v_profile.role = 'athlete' then 'an athlete deleted their own account and data'
              when v_profile.role = 'guardian' then 'a guardian deleted their own account, the athletes they followed are not affected'
              else format('a %s deleted their own account, their plans and notes stay with the club', v_role_label)
            end);
  end if;

  perform public.queue_user_storage_deletion(v_uid, 'account deleted');

  -- The login. Everything still pointing at it follows through the foreign keys: the profile,
  -- photo record, notifications and notification choices are deleted (cascade); authorship of
  -- plans, notes, results and messages is set to null.
  delete from auth.users au where au.id = v_uid;

  return jsonb_build_object('deleted', true, 'conversations_kept', v_stub);
end;
$$;

revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated, service_role;

-- 13. Accounts that are deleted let go of the rows that name them (20261014120000, section 0b):
-- invited_by_user_id, revoked_by_user_id and accepted_by_user_id above are "on delete set null".
select public.install_deleted_account_triggers();

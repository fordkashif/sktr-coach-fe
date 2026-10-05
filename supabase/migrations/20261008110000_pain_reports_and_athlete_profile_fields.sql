-- SKTR Coach: pain and injury reports, private athlete details, coach contact, leaving a team
-- Created: 2026-10-08
--
-- WHAT THIS ADDS
--   1. pain_reports: an athlete says what hurts (body areas, severity 1 to 5, when it started,
--      whether it stops them training, a note) and marks it resolved later.
--   2. athlete_private_details: the details a club needs and nobody else should see: preferred
--      name, pronouns, height, weight, emergency contact, guardian contact, medical notes and
--      allergies, bib or registration number, school or club affiliation.
--      It is its OWN TABLE, not new columns on athletes, because athletes.* is selectable by
--      staff through row policies that were written for the roster (name, events, readiness) and
--      a row policy cannot hide columns.
--   3. coach_contact_settings: one switch per coach, "show my email to my athletes", OFF unless
--      the coach turns it on. get_current_athlete_team_coaches() gives an athlete the coaches of
--      their team (name, photo) and the email only when that switch is on.
--   4. leave_current_athlete_team(): an athlete takes themselves off their team.
--   5. Two notifications for coaches: athlete_pain_reported (in-app; email off unless switched on)
--      and athlete_left_team.
--
-- WHO CAN READ PAIN REPORTS AND PRIVATE DETAILS (health information, some of it about minors)
--   the athlete                         their own rows
--   a coach                             athletes currently on a team they are assigned to
--                                       (current_coach_athlete_ids, 20261006120000)
--   a club admin                        athletes of their own club
--   everyone else                       nothing: other athletes, coaches of other teams, other
--                                       clubs, platform admins, signed-out callers, deactivated
--                                       members and members of a suspended or cancelled club
--   An athlete who leaves a team is no longer on it, so that team's coaches stop reading both.
--   None of it is ever written to audit_events, and the notification text carries no body area,
--   severity or note: it says that a report exists and where to read it.
--
-- WHO CAN WRITE
--   pain_reports             the athlete, their own rows: insert, and update of the answer columns
--                            and status (column grants). No delete for anyone. Staff: read only.
--   athlete_private_details  only update_current_athlete_private_details(), the athlete's own row.
--   coach_contact_settings   only set_current_coach_contact_visibility(), the caller's own row.
--
-- LIFECYCLE (20261006180000): every security definer function that writes starts with
--   assert_caller_active(). The read function returns no rows for a paused caller. The row
--   policies go through current_tenant_id() / current_athlete_id() / current_coach_athlete_ids() /
--   is_club_admin(), which already answer nothing for a paused caller.
--
-- Idempotent and additive: create table / index if not exists, policies and triggers are dropped
-- and recreated by name, create or replace function, revoke/grant. No table, column or row that
-- existed before this file is dropped or changed.

-- 1. Pain reports ---------------------------------------------------------------------------

create table if not exists public.pain_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  body_areas text[] not null,
  severity smallint not null,
  started_on date not null,
  training_impact text not null,
  note text,
  status text not null default 'open',
  resolved_at timestamptz,
  reported_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pain_reports is
  'Health information. Readable by the athlete, the coaches of the athlete''s current team and club admins only. Never copy into audit_events or notification text.';

-- Keep in step with BODY_AREAS in src/lib/data/wellness/pain-report-types.ts.
alter table public.pain_reports drop constraint if exists pain_reports_body_areas_known;
alter table public.pain_reports
  add constraint pain_reports_body_areas_known
  check (
    cardinality(body_areas) between 1 and 12
    and body_areas <@ array[
      'head', 'neck', 'chest', 'abdomen', 'upper_back', 'lower_back', 'groin',
      'shoulder_left', 'shoulder_right', 'elbow_left', 'elbow_right',
      'wrist_hand_left', 'wrist_hand_right',
      'hip_left', 'hip_right', 'glute_left', 'glute_right',
      'quad_left', 'quad_right', 'hamstring_left', 'hamstring_right',
      'knee_left', 'knee_right', 'shin_left', 'shin_right', 'calf_left', 'calf_right',
      'achilles_left', 'achilles_right', 'ankle_left', 'ankle_right', 'foot_left', 'foot_right'
    ]::text[]
  );

alter table public.pain_reports drop constraint if exists pain_reports_severity_range;
alter table public.pain_reports
  add constraint pain_reports_severity_range check (severity between 1 and 5);

alter table public.pain_reports drop constraint if exists pain_reports_started_on_range;
alter table public.pain_reports
  add constraint pain_reports_started_on_range check (started_on >= date '2000-01-01');

alter table public.pain_reports drop constraint if exists pain_reports_training_impact_known;
alter table public.pain_reports
  add constraint pain_reports_training_impact_known
  check (training_impact in ('none', 'modified', 'cannot_train'));

alter table public.pain_reports drop constraint if exists pain_reports_note_length;
alter table public.pain_reports
  add constraint pain_reports_note_length check (note is null or length(note) <= 500);

alter table public.pain_reports drop constraint if exists pain_reports_status_known;
alter table public.pain_reports
  add constraint pain_reports_status_known
  check (status in ('open', 'resolved') and ((status = 'resolved') = (resolved_at is not null)));

create index if not exists pain_reports_athlete_status_idx
on public.pain_reports (athlete_id, status, created_at desc);

create index if not exists pain_reports_tenant_open_idx
on public.pain_reports (tenant_id, created_at desc)
where status = 'open';

-- Keeps the row honest whatever the client sends: the club, the athlete and the reporter never
-- change after insert, a start date cannot be in the future (one day of slack for athletes whose
-- local date is ahead of the database), resolved_at follows status.
create or replace function public.pain_reports_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.note := nullif(btrim(coalesce(new.note, '')), '');

  if new.started_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'The start date cannot be in the future' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    if new.status = 'resolved' then
      new.resolved_at := coalesce(new.resolved_at, now());
    else
      new.resolved_at := null;
    end if;
    return new;
  end if;

  new.tenant_id := old.tenant_id;
  new.athlete_id := old.athlete_id;
  new.reported_by_user_id := old.reported_by_user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.status = 'resolved' then
    new.resolved_at := coalesce(old.resolved_at, now());
  else
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.pain_reports_before_write() from public, anon, authenticated;

drop trigger if exists pain_reports_before_write on public.pain_reports;
create trigger pain_reports_before_write
before insert or update on public.pain_reports
for each row
execute function public.pain_reports_before_write();

alter table public.pain_reports enable row level security;

drop policy if exists pain_reports_select_own_or_team_staff on public.pain_reports;
create policy pain_reports_select_own_or_team_staff
on public.pain_reports
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    athlete_id = (select public.current_athlete_id())
    or (select public.is_club_admin())
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

drop policy if exists pain_reports_insert_own on public.pain_reports;
create policy pain_reports_insert_own
on public.pain_reports
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id = (select public.current_athlete_id())
  and reported_by_user_id = auth.uid()
);

drop policy if exists pain_reports_update_own on public.pain_reports;
create policy pain_reports_update_own
on public.pain_reports
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and athlete_id = (select public.current_athlete_id())
)
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id = (select public.current_athlete_id())
);

-- No delete policy and no delete privilege: a report is resolved, never removed.
revoke all on public.pain_reports from public, anon, authenticated;
grant select on public.pain_reports to authenticated;
grant insert (tenant_id, athlete_id, body_areas, severity, started_on, training_impact, note, reported_by_user_id)
  on public.pain_reports to authenticated;
grant update (body_areas, severity, started_on, training_impact, note, status)
  on public.pain_reports to authenticated;
grant all on public.pain_reports to service_role;

-- 2. Private athlete details ----------------------------------------------------------------

create table if not exists public.athlete_private_details (
  athlete_id uuid primary key references public.athletes(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  preferred_name text,
  pronouns text,
  height_cm numeric(5, 1),
  weight_kg numeric(5, 1),
  emergency_contact_name text,
  emergency_contact_relationship text,
  emergency_contact_phone text,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  medical_notes text,
  bib_number text,
  affiliation text,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.athlete_private_details is
  'Private and health information. Readable by the athlete, the coaches of the athlete''s current team and club admins only. Written only by update_current_athlete_private_details(). Never copy into audit_events.';

-- A phone number as people write it: digits with spaces, brackets, dots, dashes, an optional
-- leading plus. Seven to fifteen digits in total.
create or replace function public.contact_phone_is_valid(p_phone text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_phone is not null
     and length(p_phone) <= 30
     and p_phone ~ '^\+?[0-9][0-9 ().-]*$'
     and length(regexp_replace(p_phone, '[^0-9]', '', 'g')) between 7 and 15
$$;

create or replace function public.contact_email_is_valid(p_email text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_email is not null
     and length(p_email) <= 254
     and p_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
$$;

revoke all on function public.contact_phone_is_valid(text) from public, anon;
revoke all on function public.contact_email_is_valid(text) from public, anon;
grant execute on function public.contact_phone_is_valid(text) to authenticated, service_role;
grant execute on function public.contact_email_is_valid(text) to authenticated, service_role;

alter table public.athlete_private_details drop constraint if exists athlete_private_details_lengths;
alter table public.athlete_private_details
  add constraint athlete_private_details_lengths
  check (
    (preferred_name is null or length(preferred_name) <= 60)
    and (pronouns is null or length(pronouns) <= 40)
    and (emergency_contact_name is null or length(emergency_contact_name) <= 120)
    and (emergency_contact_relationship is null or length(emergency_contact_relationship) <= 60)
    and (guardian_name is null or length(guardian_name) <= 120)
    and (medical_notes is null or length(medical_notes) <= 1000)
    and (bib_number is null or length(bib_number) <= 40)
    and (affiliation is null or length(affiliation) <= 120)
  );

alter table public.athlete_private_details drop constraint if exists athlete_private_details_measurements;
alter table public.athlete_private_details
  add constraint athlete_private_details_measurements
  check (
    (height_cm is null or height_cm between 50 and 260)
    and (weight_kg is null or weight_kg between 20 and 300)
  );

alter table public.athlete_private_details drop constraint if exists athlete_private_details_contacts;
alter table public.athlete_private_details
  add constraint athlete_private_details_contacts
  check (
    (emergency_contact_phone is null or public.contact_phone_is_valid(emergency_contact_phone))
    and (guardian_phone is null or public.contact_phone_is_valid(guardian_phone))
    and (guardian_email is null or public.contact_email_is_valid(guardian_email))
  );

create index if not exists athlete_private_details_tenant_idx
on public.athlete_private_details (tenant_id);

drop trigger if exists set_updated_at_athlete_private_details on public.athlete_private_details;
create trigger set_updated_at_athlete_private_details
before update on public.athlete_private_details
for each row
execute function public.set_updated_at();

alter table public.athlete_private_details enable row level security;

drop policy if exists athlete_private_details_select_own_or_team_staff on public.athlete_private_details;
create policy athlete_private_details_select_own_or_team_staff
on public.athlete_private_details
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    athlete_id = (select public.current_athlete_id())
    or (select public.is_club_admin())
    or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[])
  )
);

-- Read only for API roles. The one writer is the function below.
revoke all on public.athlete_private_details from public, anon, authenticated;
grant select on public.athlete_private_details to authenticated;
grant all on public.athlete_private_details to service_role;

-- The athlete saves their own private details. Every value is optional; an empty value clears
-- the field. RAISES: it is a write. Companion of update_current_athlete_profile() (20261006180000),
-- which keeps handling name, date of birth and events on the athletes row.
create or replace function public.update_current_athlete_private_details(
  p_preferred_name text default null,
  p_pronouns text default null,
  p_height_cm numeric default null,
  p_weight_kg numeric default null,
  p_emergency_contact_name text default null,
  p_emergency_contact_relationship text default null,
  p_emergency_contact_phone text default null,
  p_guardian_name text default null,
  p_guardian_phone text default null,
  p_guardian_email text default null,
  p_medical_notes text default null,
  p_bib_number text default null,
  p_affiliation text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_athlete_id uuid;
  v_preferred_name text := nullif(btrim(regexp_replace(coalesce(p_preferred_name, ''), '\s+', ' ', 'g')), '');
  v_pronouns text := nullif(btrim(regexp_replace(coalesce(p_pronouns, ''), '\s+', ' ', 'g')), '');
  v_emergency_name text := nullif(btrim(regexp_replace(coalesce(p_emergency_contact_name, ''), '\s+', ' ', 'g')), '');
  v_emergency_relationship text := nullif(btrim(regexp_replace(coalesce(p_emergency_contact_relationship, ''), '\s+', ' ', 'g')), '');
  v_emergency_phone text := nullif(btrim(coalesce(p_emergency_contact_phone, '')), '');
  v_guardian_name text := nullif(btrim(regexp_replace(coalesce(p_guardian_name, ''), '\s+', ' ', 'g')), '');
  v_guardian_phone text := nullif(btrim(coalesce(p_guardian_phone, '')), '');
  v_guardian_email text := nullif(lower(btrim(coalesce(p_guardian_email, ''))), '');
  v_medical_notes text := nullif(btrim(coalesce(p_medical_notes, '')), '');
  v_bib_number text := nullif(btrim(regexp_replace(coalesce(p_bib_number, ''), '\s+', ' ', 'g')), '');
  v_affiliation text := nullif(btrim(regexp_replace(coalesce(p_affiliation, ''), '\s+', ' ', 'g')), '');
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role <> 'athlete' then
    raise exception 'Only athlete users can update an athlete profile';
  end if;

  select a.id
  into v_athlete_id
  from public.athletes a
  where a.user_id = auth.uid()
    and a.tenant_id = v_profile.tenant_id
  limit 1;

  if v_athlete_id is null then
    raise exception 'Athlete record not found';
  end if;

  if length(v_preferred_name) > 60 then
    raise exception 'Preferred name must be 60 characters or fewer' using errcode = '23514';
  end if;
  if length(v_pronouns) > 40 then
    raise exception 'Pronouns must be 40 characters or fewer' using errcode = '23514';
  end if;
  if p_height_cm is not null and (p_height_cm < 50 or p_height_cm > 260) then
    raise exception 'Height must be between 50 and 260 cm' using errcode = '23514';
  end if;
  if p_weight_kg is not null and (p_weight_kg < 20 or p_weight_kg > 300) then
    raise exception 'Weight must be between 20 and 300 kg' using errcode = '23514';
  end if;
  if length(v_emergency_name) > 120 or length(v_guardian_name) > 120 then
    raise exception 'Contact names must be 120 characters or fewer' using errcode = '23514';
  end if;
  if length(v_emergency_relationship) > 60 then
    raise exception 'Relationship must be 60 characters or fewer' using errcode = '23514';
  end if;
  if v_emergency_phone is not null and not public.contact_phone_is_valid(v_emergency_phone) then
    raise exception 'Emergency contact phone number is not valid' using errcode = '23514';
  end if;
  if v_guardian_phone is not null and not public.contact_phone_is_valid(v_guardian_phone) then
    raise exception 'Guardian phone number is not valid' using errcode = '23514';
  end if;
  if v_guardian_email is not null and not public.contact_email_is_valid(v_guardian_email) then
    raise exception 'Guardian email address is not valid' using errcode = '23514';
  end if;
  if length(v_medical_notes) > 1000 then
    raise exception 'Medical notes must be 1000 characters or fewer' using errcode = '23514';
  end if;
  if length(v_bib_number) > 40 then
    raise exception 'Bib or registration number must be 40 characters or fewer' using errcode = '23514';
  end if;
  if length(v_affiliation) > 120 then
    raise exception 'School or club must be 120 characters or fewer' using errcode = '23514';
  end if;

  insert into public.athlete_private_details (
    athlete_id, tenant_id, preferred_name, pronouns, height_cm, weight_kg,
    emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
    guardian_name, guardian_phone, guardian_email, medical_notes, bib_number, affiliation,
    updated_by_user_id
  )
  values (
    v_athlete_id, v_profile.tenant_id, v_preferred_name, v_pronouns, round(p_height_cm, 1), round(p_weight_kg, 1),
    v_emergency_name, v_emergency_relationship, v_emergency_phone,
    v_guardian_name, v_guardian_phone, v_guardian_email, v_medical_notes, v_bib_number, v_affiliation,
    auth.uid()
  )
  on conflict (athlete_id) do update
  set preferred_name = excluded.preferred_name,
      pronouns = excluded.pronouns,
      height_cm = excluded.height_cm,
      weight_kg = excluded.weight_kg,
      emergency_contact_name = excluded.emergency_contact_name,
      emergency_contact_relationship = excluded.emergency_contact_relationship,
      emergency_contact_phone = excluded.emergency_contact_phone,
      guardian_name = excluded.guardian_name,
      guardian_phone = excluded.guardian_phone,
      guardian_email = excluded.guardian_email,
      medical_notes = excluded.medical_notes,
      bib_number = excluded.bib_number,
      affiliation = excluded.affiliation,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = now();
end;
$$;

revoke all on function public.update_current_athlete_private_details(text, text, numeric, numeric, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_current_athlete_private_details(text, text, numeric, numeric, text, text, text, text, text, text, text, text, text) to authenticated, service_role;

-- 3. Coach contact --------------------------------------------------------------------------

create table if not exists public.coach_contact_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  show_email_to_athletes boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.coach_contact_settings is
  'A coach''s choice to show their email address to the athletes of their teams. No row means no.';

alter table public.coach_contact_settings enable row level security;

drop policy if exists coach_contact_settings_select_own on public.coach_contact_settings;
create policy coach_contact_settings_select_own
on public.coach_contact_settings
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.coach_contact_settings from public, anon, authenticated;
grant select on public.coach_contact_settings to authenticated;
grant all on public.coach_contact_settings to service_role;

-- A coach (or a club admin who coaches a team) switches their email on or off for their
-- athletes. Caller's own row only. RAISES: it is a write.
create or replace function public.set_current_coach_contact_visibility(p_show_email boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role not in ('coach', 'club-admin') then
    raise exception 'Only coaches can choose to show their contact details to athletes';
  end if;

  insert into public.coach_contact_settings (user_id, tenant_id, show_email_to_athletes)
  values (auth.uid(), v_profile.tenant_id, coalesce(p_show_email, false))
  on conflict (user_id) do update
  set show_email_to_athletes = excluded.show_email_to_athletes,
      tenant_id = excluded.tenant_id,
      updated_at = now();

  return coalesce(p_show_email, false);
end;
$$;

revoke all on function public.set_current_coach_contact_visibility(boolean) from public, anon;
grant execute on function public.set_current_coach_contact_visibility(boolean) to authenticated, service_role;

-- The coaches of the signed-in athlete's current team: name, lead flag, photo path and, only
-- for a coach who switched it on, their confirmed email address. Athletes cannot read
-- team_coaches, other profiles or account_avatars under RLS.
-- RETURNS NO ROWS for a caller whose access is paused, who is not an athlete or has no team.
create or replace function public.get_current_athlete_team_coaches()
returns table (
  user_id uuid,
  display_name text,
  is_primary boolean,
  avatar_path text,
  contact_email text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    tc.user_id,
    nullif(btrim(coalesce(cp.display_name, '')), '') as display_name,
    coalesce(tc.is_primary, false) as is_primary,
    aa.avatar_path,
    case
      when coalesce(ccs.show_email_to_athletes, false) and au.email_confirmed_at is not null
        then nullif(lower(btrim(au.email)), '')
      else null
    end as contact_email
  from public.team_coaches tc
  join public.profiles cp
    on cp.user_id = tc.user_id
   and cp.tenant_id = tc.tenant_id
   and cp.is_active
   and cp.role in ('coach', 'club-admin')
  left join public.account_avatars aa
    on aa.user_id = tc.user_id
  left join public.coach_contact_settings ccs
    on ccs.user_id = tc.user_id
   and ccs.tenant_id = tc.tenant_id
  left join auth.users au
    on au.id = tc.user_id
  where public.caller_is_active_member()
    and tc.team_id = public.current_athlete_team_id()
    and tc.tenant_id = public.current_tenant_id()
  order by coalesce(tc.is_primary, false) desc, nullif(btrim(coalesce(cp.display_name, '')), '') nulls last
$$;

revoke all on function public.get_current_athlete_team_coaches() from public, anon;
grant execute on function public.get_current_athlete_team_coaches() to authenticated, service_role;

-- 4. Leaving a team ---------------------------------------------------------------------------

-- The athlete takes themselves off their team. Their history (sessions, check-ins, results,
-- records, pain reports) stays theirs. With no team they stop reading the team's plans and test
-- weeks (current_athlete_plan_ids / current_athlete_test_week_ids, 20261006150000) and the
-- team's coaches stop reading their data (current_coach_athlete_ids, 20261006120000). The
-- team's coaches are told. Joining a team again with an invite or a code works as before.
-- Returns the team that was left. RAISES: it is a write.
create or replace function public.leave_current_athlete_team()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_athlete public.athletes%rowtype;
  v_team_name text;
  v_user_email text;
  v_name text;
  v_coach_user_id uuid;
begin
  perform public.assert_caller_active();

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.role <> 'athlete' then
    raise exception 'Only athlete users can leave a team';
  end if;

  select *
  into v_athlete
  from public.athletes a
  where a.user_id = auth.uid()
    and a.tenant_id = v_profile.tenant_id
  limit 1
  for update;

  if not found then
    raise exception 'Athlete record not found';
  end if;

  if v_athlete.team_id is null then
    raise exception 'You are not on a team';
  end if;

  select tm.name into v_team_name from public.teams tm where tm.id = v_athlete.team_id;

  update public.athletes
  set team_id = null,
      updated_at = now()
  where id = v_athlete.id;

  select lower(btrim(au.email)) into v_user_email from auth.users au where au.id = auth.uid();

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (
    v_profile.tenant_id,
    auth.uid(),
    'athlete',
    'athlete_leave_team',
    coalesce(nullif(v_user_email, ''), auth.uid()::text),
    'left team ' || v_athlete.team_id::text
  );

  v_name := public.notification_athlete_name(v_athlete.id);
  for v_coach_user_id in select public.notification_team_coach_user_ids(v_athlete.team_id)
  loop
    perform public.enqueue_notification(
      v_profile.tenant_id,
      v_coach_user_id,
      'athlete_left_team',
      format('%s left %s', v_name, coalesce(v_team_name, 'your team')),
      'They took themselves off the team. Their history is kept, and they can join again with a new invite.',
      jsonb_build_object('team_id', v_athlete.team_id::text, 'athlete_id', v_athlete.id::text),
      array['in-app', 'email'],
      'athlete_left_team:' || v_athlete.id::text || ':' || v_athlete.team_id::text,
      interval '10 minutes'
    );
  end loop;

  return v_athlete.team_id;
end;
$$;

revoke all on function public.leave_current_athlete_team() from public, anon;
grant execute on function public.leave_current_athlete_team() to authenticated, service_role;

-- 5. Notifications ----------------------------------------------------------------------------

-- Same list as 20261007090000 plus athlete_pain_reported (email off unless the coach switches
-- it on). Keep in step with src/lib/notification-categories.ts.
-- If a migration between 20261007090000 and this one also replaced this function, its additions
-- must be carried into this list: the newest definition wins.
create or replace function public.notification_default_enabled(p_channel text, p_event_type text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_channel = 'email' and p_event_type in (
      'training_plan_updated',
      'athlete_low_readiness',
      'athlete_session_completed',
      'athlete_test_results_submitted',
      'athlete_pain_reported'
    ) then false
    else true
  end
$$;

revoke all on function public.notification_default_enabled(text, text) from public, anon;
grant execute on function public.notification_default_enabled(text, text) to authenticated, service_role;

-- An athlete reported pain that affects training (modified, or cannot train), or an open report
-- got worse in that sense. Tells the coaches of the athlete's current team. The text says that
-- a report exists and nothing about what it says: the coach reads the detail in the app, where
-- the row policies decide who may.
create or replace function public.enqueue_pain_report_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete record;
  v_team_name text;
  v_name text;
  v_coach_user_id uuid;
begin
  if new.status <> 'open' or new.training_impact not in ('modified', 'cannot_train') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'open'
     and (old.training_impact = new.training_impact or old.training_impact = 'cannot_train') then
    return new;
  end if;

  select a.id, a.team_id
  into v_athlete
  from public.athletes a
  where a.id = new.athlete_id
    and a.tenant_id = new.tenant_id
    and a.is_active;

  if not found or v_athlete.team_id is null then
    return new;
  end if;

  select tm.name into v_team_name from public.teams tm where tm.id = v_athlete.team_id;
  v_name := public.notification_athlete_name(new.athlete_id);

  for v_coach_user_id in select public.notification_team_coach_user_ids(v_athlete.team_id)
  loop
    perform public.enqueue_notification(
      new.tenant_id,
      v_coach_user_id,
      'athlete_pain_reported',
      case
        when new.training_impact = 'cannot_train' then format('%s says they cannot train', v_name)
        else format('%s needs a modified session', v_name)
      end,
      format(
        'They sent a pain or injury report%s. Open their page to read it.',
        case when v_team_name is null then '' else format(' (%s)', v_team_name) end
      ),
      jsonb_build_object(
        'athlete_id', new.athlete_id::text,
        'team_id', v_athlete.team_id::text,
        'pain_report_id', new.id::text
      ),
      array['in-app', 'email'],
      'pain_report:' || new.id::text || ':' || new.training_impact,
      interval '1 day'
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.enqueue_pain_report_notifications() from public, anon, authenticated;

drop trigger if exists queue_pain_report_notifications on public.pain_reports;
create trigger queue_pain_report_notifications
after insert or update of training_impact, status on public.pain_reports
for each row
execute function public.enqueue_pain_report_notifications();

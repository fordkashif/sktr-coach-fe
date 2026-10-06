-- Athlete reports: a coach writes a report about one athlete for a period, saves it as a
-- snapshot, and shares it with the athlete in the app or with a parent or guardian by link.
--
--   1. athlete_reports        one saved report. The snapshot (jsonb) is what was on the sheet when
--                             it was saved; it does not change when the athlete's data changes.
--                             The coach may change the summary until the report is shared (with
--                             the athlete, or by link). After that the content is frozen.
--                             Read and written by the coaches of the athlete's current team and
--                             club admins. The athlete reads only reports shared with them.
--   2. athlete_report_links   private links for a parent or guardian. Only the SHA-256 of the
--                             token is stored (like calendar_feeds, 20261014100000). A link has an
--                             expiry (7, 30 or 90 days), can be revoked, says who it was made for
--                             and counts opens. Staff read the rows; they are written by functions.
--   3. get_shared_athlete_report(token)  callable signed out. Returns the snapshot and nothing
--                             else, or NULL. A wrong, expired or revoked link, a link of a paused
--                             or closed club and a rate limited caller all get the same NULL.
--
-- Privacy: private coach notes (coach_athlete_notes) are never part of a snapshot; a check
-- refuses a snapshot that carries a coach notes key. The health sections (wellness trend, injury
-- notes) may only be in a snapshot when the coach ticked them, which the same check enforces.
--
-- Deletion: both tables carry tenant_id and athlete_id, so the catalogue driven sweeps of
-- 20261014120000 (purge_athlete_personal_data, delete_closed_club) remove them without change.
--
-- Idempotent: create table / index if not exists, create or replace function, drop trigger and
-- drop policy if exists before create.

-- 1. Reports --------------------------------------------------------------------------------------

create table if not exists public.athlete_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  -- Who saved it. Stamped by trigger, never taken from the client.
  author_user_id uuid references auth.users(id) on delete set null,
  period_start date not null,
  period_end date not null,
  -- The sections the coach ticked: summary, attendance, training, results, tests, goals,
  -- wellness, injuries.
  sections text[] not null default '{}',
  -- The coach's own words. Kept in step with snapshot ->> 'summary' by the trigger.
  summary text not null default '' check (char_length(summary) <= 4000),
  snapshot jsonb not null,
  shared_with_athlete_at timestamptz,
  shared_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint athlete_reports_period_check check (period_start <= period_end),
  constraint athlete_reports_sections_check check (
    sections <@ array['summary', 'attendance', 'training', 'results', 'tests', 'goals', 'wellness', 'injuries']::text[]
  ),
  constraint athlete_reports_snapshot_shape_check check (
    jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 300000
  ),
  -- Private coach notes never travel in a report, and health data only when it was ticked.
  constraint athlete_reports_snapshot_privacy_check check (
    not (snapshot ?| array['coachNotes', 'coach_notes', 'notes', 'privateNotes'])
    and (not (snapshot ? 'wellness') or 'wellness' = any (sections))
    and (not (snapshot ? 'injuries') or 'injuries' = any (sections))
  )
);

comment on table public.athlete_reports is
  'A report about one athlete for a period, saved as a snapshot. Staff of the athlete''s team and club admins; the athlete only once it is shared with them. Never holds private coach notes.';

create index if not exists athlete_reports_athlete_idx
on public.athlete_reports (athlete_id, created_at desc);

create index if not exists athlete_reports_tenant_idx
on public.athlete_reports (tenant_id);

-- 2. Links for a parent or guardian ---------------------------------------------------------------

create table if not exists public.athlete_report_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  report_id uuid not null references public.athlete_reports(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  -- SHA-256 of the token, lower case hex. The token itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Who the coach made it for ("Dana Reid, mother").
  made_for text not null check (char_length(btrim(made_for)) between 1 and 120),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  open_count integer not null default 0 check (open_count >= 0),
  last_opened_at timestamptz
);

comment on table public.athlete_report_links is
  'Private read-only links to one athlete report for a parent or guardian. Holds a hash of the token only. Written through functions.';

create index if not exists athlete_report_links_report_idx
on public.athlete_report_links (report_id, created_at desc);

create index if not exists athlete_report_links_athlete_idx
on public.athlete_report_links (athlete_id);

create index if not exists athlete_report_links_tenant_idx
on public.athlete_report_links (tenant_id);

-- 3. What a write may change ----------------------------------------------------------------------

create or replace function public.athlete_reports_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_sharing boolean := coalesce(nullif(current_setting('sktr.report_share', true), ''), '') = 'on';
begin
  if tg_op = 'UPDATE' then
    -- Whose report it is, who saved it and when never change.
    new.athlete_id := old.athlete_id;
    new.tenant_id := old.tenant_id;
    new.author_user_id := old.author_user_id;
    new.created_at := old.created_at;

    -- Sharing happens through share_athlete_report() only.
    if not v_sharing then
      new.shared_with_athlete_at := old.shared_with_athlete_at;
      new.shared_by_user_id := old.shared_by_user_id;
    end if;

    -- Once it has been shared, with the athlete or by link (even a link that has since been
    -- revoked or has expired: someone may have read it), the content is frozen.
    if (
      new.summary is distinct from old.summary
      or new.snapshot is distinct from old.snapshot
      or new.sections is distinct from old.sections
      or new.period_start is distinct from old.period_start
      or new.period_end is distinct from old.period_end
    ) and (
      old.shared_with_athlete_at is not null
      or exists (select 1 from public.athlete_report_links l where l.report_id = old.id)
    ) then
      raise exception 'This report has been shared, so it can no longer be changed. Duplicate it to write a new one.'
        using errcode = 'P0001', hint = 'report_shared';
    end if;
  else
    select a.tenant_id into v_tenant_id from public.athletes a where a.id = new.athlete_id;
    if not found then
      raise exception 'This athlete does not exist.' using errcode = '23503';
    end if;
    new.tenant_id := v_tenant_id;
    if auth.uid() is not null then
      new.author_user_id := auth.uid();
    end if;
    new.created_at := now();
    -- A new report is never shared yet.
    new.shared_with_athlete_at := null;
    new.shared_by_user_id := null;
  end if;

  new.summary := btrim(coalesce(new.summary, ''));
  new.sections := coalesce(new.sections, '{}');
  -- The sheet shows the summary from the snapshot: one source of truth.
  new.snapshot := jsonb_set(coalesce(new.snapshot, '{}'::jsonb), '{summary}', to_jsonb(new.summary), true);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.athlete_reports_normalise() from public, anon, authenticated;

drop trigger if exists athlete_reports_normalise on public.athlete_reports;
create trigger athlete_reports_normalise
before insert or update on public.athlete_reports
for each row
execute function public.athlete_reports_normalise();

-- 4. Row level security ---------------------------------------------------------------------------

alter table public.athlete_reports enable row level security;
alter table public.athlete_report_links enable row level security;

-- Staff: coaches of the athlete's current team and club admins.
drop policy if exists athlete_reports_select_staff on public.athlete_reports;
create policy athlete_reports_select_staff
on public.athlete_reports
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

-- The athlete: only their own reports, and only once shared with them.
drop policy if exists athlete_reports_select_shared_athlete on public.athlete_reports;
create policy athlete_reports_select_shared_athlete
on public.athlete_reports
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and shared_with_athlete_at is not null
  and athlete_id = (select public.current_athlete_id())
);

drop policy if exists athlete_reports_insert_staff on public.athlete_reports;
create policy athlete_reports_insert_staff
on public.athlete_reports
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and author_user_id = auth.uid()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

drop policy if exists athlete_reports_update_staff on public.athlete_reports;
create policy athlete_reports_update_staff
on public.athlete_reports
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
)
with check (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

drop policy if exists athlete_reports_delete_staff on public.athlete_reports;
create policy athlete_reports_delete_staff
on public.athlete_reports
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

revoke all on table public.athlete_reports from anon, authenticated;
grant select, insert, update, delete on table public.athlete_reports to authenticated;
grant all on table public.athlete_reports to service_role;

-- Links: staff read them (who it was for, when it ends, how often it was opened). No athlete
-- policy. No insert, update or delete from a client: the functions below do that.
drop policy if exists athlete_report_links_select_staff on public.athlete_report_links;
create policy athlete_report_links_select_staff
on public.athlete_report_links
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and ((select public.is_club_admin()) or athlete_id = any ((select public.current_coach_athlete_ids())::uuid[]))
);

revoke all on table public.athlete_report_links from anon, authenticated;
-- The token hash is not readable from a client, only the facts about the link.
grant select (id, tenant_id, report_id, athlete_id, made_for, created_by_user_id, created_at, expires_at, revoked_at, open_count, last_opened_at)
on table public.athlete_report_links to authenticated;
grant all on table public.athlete_report_links to service_role;

-- 5. Functions for staff --------------------------------------------------------------------------

-- True when the caller is a club admin of the report's club or a coach of the athlete's team.
create or replace function public.can_manage_athlete_report(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.athlete_reports r
    where r.id = p_report_id
      and auth.uid() is not null
      and r.tenant_id = public.current_tenant_id()
      and (public.is_club_admin() or r.athlete_id = any (public.current_coach_athlete_ids()::uuid[]))
  )
$$;

revoke all on function public.can_manage_athlete_report(uuid) from public, anon;
grant execute on function public.can_manage_athlete_report(uuid) to authenticated, service_role;

-- Shares a report with the athlete in the app and tells them. Sharing again does nothing.
-- Returns when it was shared.
create or replace function public.share_athlete_report(p_report_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.athlete_reports%rowtype;
  v_athlete_user uuid;
begin
  perform public.assert_caller_active();
  if not public.can_manage_athlete_report(p_report_id) then
    raise exception 'You cannot share this report.' using errcode = '42501';
  end if;

  select * into v_report from public.athlete_reports r where r.id = p_report_id for update;
  if v_report.shared_with_athlete_at is not null then
    return v_report.shared_with_athlete_at;
  end if;

  perform set_config('sktr.report_share', 'on', true);
  update public.athlete_reports
  set shared_with_athlete_at = now(), shared_by_user_id = auth.uid()
  where id = p_report_id
  returning shared_with_athlete_at into v_report.shared_with_athlete_at;
  perform set_config('sktr.report_share', '', true);

  select a.user_id into v_athlete_user from public.athletes a where a.id = v_report.athlete_id and a.is_active;
  if v_athlete_user is not null then
    perform public.enqueue_notification(
      v_report.tenant_id,
      v_athlete_user,
      'athlete_report_shared',
      format('%s shared a report with you', public.message_member_name(auth.uid(), 'Your coach')),
      format(
        'It covers %s to %s. Open it to read it or print it.',
        public.notification_date_label(v_report.period_start),
        public.notification_date_label(v_report.period_end)
      ),
      jsonb_build_object('report_id', v_report.id::text, 'athlete_id', v_report.athlete_id::text),
      array['in-app', 'email'],
      'athlete_report_shared:' || v_report.id::text,
      interval '1 day'
    );
  end if;

  return v_report.shared_with_athlete_at;
end;
$$;

revoke all on function public.share_athlete_report(uuid) from public, anon;
grant execute on function public.share_athlete_report(uuid) to authenticated, service_role;

-- Makes a private link to a report for a parent or guardian. Returns the token once: 64 hex
-- characters, 244 random bits. Only its hash is kept, so the link cannot be shown again.
create or replace function public.create_athlete_report_link(p_report_id uuid, p_made_for text, p_days integer default 30)
returns table (link_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_report public.athlete_reports%rowtype;
  v_made_for text := left(btrim(regexp_replace(coalesce(p_made_for, ''), '\s+', ' ', 'g')), 120);
  v_days integer := coalesce(p_days, 30);
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  perform public.assert_caller_active();
  if not public.can_manage_athlete_report(p_report_id) then
    raise exception 'You cannot share this report.' using errcode = '42501';
  end if;
  if v_made_for = '' then
    raise exception 'Say who the link is for.' using errcode = '22023';
  end if;
  if v_days not in (7, 30, 90) then
    raise exception 'A link lasts 7, 30 or 90 days.' using errcode = '22023';
  end if;

  select * into v_report from public.athlete_reports r where r.id = p_report_id;
  if (select count(*) from public.athlete_report_links l where l.report_id = p_report_id) >= 20 then
    raise exception 'This report already has 20 links. Duplicate the report to share it again.' using errcode = 'P0001', hint = 'too_many_links';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(days => v_days);

  insert into public.athlete_report_links (tenant_id, report_id, athlete_id, token_hash, made_for, created_by_user_id, expires_at)
  values (v_report.tenant_id, v_report.id, v_report.athlete_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_made_for, auth.uid(), v_expires)
  returning id into v_id;

  return query select v_id, v_token, v_expires;
end;
$$;

revoke all on function public.create_athlete_report_link(uuid, text, integer) from public, anon;
grant execute on function public.create_athlete_report_link(uuid, text, integer) to authenticated, service_role;

-- Stops a link working at once. Returns true when a link was revoked.
create or replace function public.revoke_athlete_report_link(p_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
begin
  perform public.assert_caller_active();
  select l.report_id into v_report_id from public.athlete_report_links l where l.id = p_link_id;
  if v_report_id is null or not public.can_manage_athlete_report(v_report_id) then
    raise exception 'You cannot change this link.' using errcode = '42501';
  end if;

  update public.athlete_report_links
  set revoked_at = now()
  where id = p_link_id and revoked_at is null;
  return found;
end;
$$;

revoke all on function public.revoke_athlete_report_link(uuid) from public, anon;
grant execute on function public.revoke_athlete_report_link(uuid) to authenticated, service_role;

-- 6. The public read ------------------------------------------------------------------------------

-- What a link shows: the snapshot of its report, or NULL. Callable signed out.
-- NULL for every answer that is not "this link works right now": a string that is not a token,
-- an unknown token, an expired link, a revoked link, a paused or closed club, and a caller who
-- has guessed wrong too often (20 wrong tokens in 10 minutes from one network address, or 2,000
-- an hour in total; counted in request_form_attempts as hashes only, like the join code lookup of
-- 20261009090000). Nothing tells these apart.
create or replace function public.get_shared_athlete_report(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_ip_hash text := public.request_form_ip_hash();
  v_link public.athlete_report_links%rowtype;
  v_snapshot jsonb;
begin
  if (v_ip_hash is not null and (
        select count(*) from public.request_form_attempts a
        where a.form = 'report_link_lookup' and a.ip_hash = v_ip_hash and a.created_at > now() - interval '10 minutes'
      ) >= 20)
     or (
        select count(*) from public.request_form_attempts a
        where a.form = 'report_link_lookup' and a.created_at > now() - interval '1 hour'
      ) >= 2000 then
    return null;
  end if;

  if v_token ~ '^[0-9a-f]{64}$' then
    select * into v_link
    from public.athlete_report_links l
    where l.token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  end if;

  if v_link.id is null then
    delete from public.request_form_attempts a
    where a.form = 'report_link_lookup' and a.created_at < now() - interval '1 day';
    insert into public.request_form_attempts (form, email_hash, ip_hash)
    values ('report_link_lookup', null, v_ip_hash);
    return null;
  end if;

  if v_link.revoked_at is not null or v_link.expires_at <= now() or public.tenant_access_blocked(v_link.tenant_id) then
    return null;
  end if;

  select r.snapshot into v_snapshot from public.athlete_reports r where r.id = v_link.report_id;
  if v_snapshot is null then
    return null;
  end if;

  update public.athlete_report_links
  set open_count = open_count + 1, last_opened_at = now()
  where id = v_link.id;

  return v_snapshot;
end;
$$;

revoke all on function public.get_shared_athlete_report(text) from public;
grant execute on function public.get_shared_athlete_report(text) to anon, authenticated, service_role;

-- 7. Accounts that are deleted --------------------------------------------------------------------

-- author_user_id, shared_by_user_id and created_by_user_id are "set null" references to
-- auth.users: let go of them when the account is deleted (20261014120000, section 0b).
do $$ begin perform public.install_deleted_account_triggers(); end $$;

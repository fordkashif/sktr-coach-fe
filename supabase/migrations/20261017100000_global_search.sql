-- Global search: one function that finds what the signed-in person may already see.
--
-- What this file adds
--   1. search_fold(text): lower case with accents removed ("José" and "jose" match). Immutable, no
--      extension needed, so it can sit in an index.
--   2. search_rank(text, text): 0 exact, 1 the text starts with the query, 2 a word in it starts
--      with the query, 3 the query is somewhere inside.
--   3. search_everything(p_query, p_limit): typed rows (kind, id, title, subtitle, params) for the
--      caller's role. SECURITY INVOKER: every table is read through its row level security
--      policies, so what search can find is by construction what the person can already open.
--      On top of the policies each role only gets the kinds its screens show, and scope helpers
--      narrow further where a policy is wider than the screens (a coach only gets their own teams).
--      The only definer pieces are two that already hide rows a role cannot select directly:
--        * get_current_athlete_team_coaches() (existing): an athlete cannot read team_coaches or
--          other profiles; only the coach's name and team role are used, never the email.
--        * search_platform_admins() (new): platform_admin_contacts lets a person select their own
--          row only. Platform admins may find each other, so this checks is_platform_admin() and
--          returns active contacts. It returns nothing to anyone else.
--   4. Trigram indexes for the two tables that can be large (athletes, sessions), guarded: when
--      pg_trgm cannot be installed the file still applies and search uses the tenant indexes.
--
-- What search never returns: health data (wellness, pain, readiness), coach notes, session notes,
-- message text, exercise cues, competition notes, goal notes, dates of birth, guardian contact
-- details (guardian invites are left out of the invite search for that reason). The result columns
-- are fixed; no column of that kind is selected anywhere below.
--
-- Input handling: the query is trimmed, inner spaces collapsed, cut at 80 characters and must be
-- at least 2 characters. It is only ever used as a value (LIKE with its wildcards escaped); no SQL
-- is built from it.
--
-- Safe to apply twice.

create or replace function public.search_fold(p_text text)
returns text
language sql
immutable
parallel safe
as $fold$
  select translate(
    replace(replace(replace(lower(coalesce(p_text, '')), 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'),
    'áàâäãåāăąçćčďđéèêëēėęěğíìîïīįıłľñńňóòôöõøōőŕřśšşșťţțúùûüūůűųýÿžźż',
    'aaaaaaaaacccddeeeeeeeegiiiiiiillnnnoooooooorrsssstttuuuuuuuuyyzzz'
  )
$fold$;

create or replace function public.search_rank(p_text text, p_folded_query text)
returns integer
language sql
immutable
parallel safe
as $rank$
  select case
    when public.search_fold(btrim(p_text)) = p_folded_query then 0
    when left(public.search_fold(btrim(p_text)), char_length(p_folded_query)) = p_folded_query then 1
    when position(' ' || p_folded_query in public.search_fold(p_text)) > 0 then 2
    else 3
  end
$rank$;

-- Platform admins may find each other. A person can only select their own contact row, hence definer.
create or replace function public.search_platform_admins()
returns table (id uuid, display_name text, email text)
language sql
stable
security definer
set search_path = public
as $admins$
  select pac.id, nullif(btrim(coalesce(pac.display_name, '')), ''), lower(pac.email)
  from public.platform_admin_contacts pac
  where pac.is_active
    and auth.uid() is not null
    and public.is_platform_admin()
$admins$;

create or replace function public.search_everything(p_query text, p_limit integer default 5)
returns table (kind text, id text, title text, subtitle text, params jsonb, rank integer, sort_date date)
language plpgsql
stable
security invoker
set search_path = public
as $search$
#variable_conflict use_column
declare
  v_q text := public.search_fold(left(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')), 80));
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 25);
  v_role text;
  v_athlete_id uuid;
  v_team_ids uuid[];
begin
  if auth.uid() is null or char_length(v_q) < 2 then
    return;
  end if;
  -- The query is a value only. Its LIKE wildcards are escaped so "%" and "_" match themselves.
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Platform admins: clubs and requests (one table, platform admin policy) and each other. No club data.
  if public.is_platform_admin() then
    return query
      select x.kind, x.id, x.title, x.subtitle, x.params, x.r, x.d
      from (
        select
          case when r.provisioned_tenant_id is not null or r.status = 'approved' then 'club' else 'request' end as kind,
          r.id::text as id,
          r.organization_name as title,
          concat_ws(', ', lower(r.requestor_email), replace(coalesce(case when r.status = 'approved' then r.lifecycle_status end, r.status), '_', ' ')) as subtitle,
          jsonb_build_object('requestId', r.id, 'tenantId', r.provisioned_tenant_id) as params,
          least(public.search_rank(r.organization_name, v_q), public.search_rank(r.requestor_email, v_q)) as r,
          r.created_at::date as d,
          row_number() over (
            partition by (r.provisioned_tenant_id is not null or r.status = 'approved')
            order by least(public.search_rank(r.organization_name, v_q), public.search_rank(r.requestor_email, v_q)), r.created_at desc, r.organization_name
          ) as n
        from public.tenant_provision_requests r
        where public.search_fold(r.organization_name) like v_like
           or public.search_fold(r.requestor_email) like v_like
      ) x
      where x.n <= v_limit;

    return query
      select 'platform_admin', a.id::text, coalesce(a.display_name, a.email), case when a.display_name is null then 'Platform admin' else a.email end,
        '{}'::jsonb, least(public.search_rank(a.display_name, v_q), public.search_rank(a.email, v_q)), null::date
      from public.search_platform_admins() a
      where public.search_fold(a.display_name) like v_like or public.search_fold(a.email) like v_like
      order by 6, 3
      limit v_limit;
    return;
  end if;

  -- Null for a member whose access is off or whose club is suspended or cancelled: they find nothing.
  v_role := public.current_app_role();
  if v_role is null or public.current_tenant_id() is null then
    return;
  end if;

  if v_role = 'coach' then
    -- Lead, coach and assistant: the same teams whose roster the athletes policy shows them.
    v_team_ids := public.current_staff_team_ids();

    return query
      select 'athlete', a.id::text, btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')),
        nullif(concat_ws(', ', t.name, (
          select string_agg(s.name, ', ' order by s.name)
          from public.team_squad_members m
          join public.team_squads s on s.id = m.squad_id and s.archived_at is null
          where m.athlete_id = a.id
        )), ''),
        jsonb_build_object('athleteId', a.id, 'teamId', a.team_id),
        public.search_rank(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, ''), v_q), null::date
      from public.athletes a
      left join public.teams t on t.id = a.team_id
      where a.is_active
        and a.team_id = any (v_team_ids)
        and public.search_fold(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) like v_like
      order by 6, 3
      limit v_limit;

    -- The teams policy shows a coach every team of the club; search keeps to the ones they coach.
    return query
      select 'team', t.id::text, t.name, nullif(concat_ws(', ', t.event_group, case when t.status <> 'active' then t.status end), ''),
        jsonb_build_object('teamId', t.id), public.search_rank(t.name, v_q), null::date
      from public.teams t
      where t.id = any (v_team_ids) and public.search_fold(t.name) like v_like
      order by 6, 3
      limit v_limit;

    return query
      select 'plan', p.id::text, p.name, concat_ws(', ', t.name, p.status, to_char(p.start_date, 'FMDD Mon YYYY')),
        jsonb_build_object('planId', p.id, 'teamId', p.team_id), public.search_rank(p.name, v_q), p.start_date
      from public.training_plans p
      left join public.teams t on t.id = p.team_id
      where public.search_fold(p.name) like v_like
      order by 6, p.start_date desc nulls last, 3
      limit v_limit;

    return query
      select 'template', p.id::text, p.name, concat_ws(', ', p.weeks || case when p.weeks = 1 then ' week' else ' weeks' end, nullif(p.event_group, '')),
        jsonb_build_object('templateId', p.id), public.search_rank(p.name, v_q), p.updated_at::date
      from public.plan_templates p
      where not p.is_archived and public.search_fold(p.name) like v_like
      order by 6, p.updated_at desc, 3
      limit v_limit;

    return query
      select 'exercise', e.id::text, e.name, initcap(e.category), jsonb_build_object('exerciseId', e.id), public.search_rank(e.name, v_q), null::date
      from public.exercise_library e
      where not e.is_archived and public.search_fold(e.name) like v_like
      order by 6, 3
      limit v_limit;

    return query
      select 'test_week', w.id::text, w.name, concat_ws(', ', t.name, w.status, to_char(w.start_date, 'FMDD Mon YYYY')),
        jsonb_build_object('testWeekId', w.id, 'teamId', w.team_id), public.search_rank(w.name, v_q), w.start_date
      from public.test_weeks w
      left join public.teams t on t.id = w.team_id
      where not w.is_archived and public.search_fold(w.name) like v_like
      order by 6, w.start_date desc, 3
      limit v_limit;

    return query
      select 'competition', c.id::text, c.name, concat_ws(', ', to_char(c.start_date, 'FMDD Mon YYYY'), coalesce(nullif(c.venue, ''), nullif(c.location, ''))),
        jsonb_build_object('competitionId', c.id, 'teamId', c.team_id), public.search_rank(c.name, v_q), c.start_date
      from public.competitions c
      where public.search_fold(c.name) like v_like or public.search_fold(c.venue) like v_like
      order by 6, c.start_date desc, 3
      limit v_limit;
    return;
  end if;

  if v_role = 'club-admin' then
    return query
      select 'staff', p.user_id::text, coalesce(nullif(btrim(p.display_name), ''), 'No name yet'),
        concat_ws(', ', case p.role when 'club-admin' then 'Club admin' else 'Coach' end, case when not p.is_active then 'access off' end),
        jsonb_build_object('userId', p.user_id), public.search_rank(p.display_name, v_q), null::date
      from public.profiles p
      where p.tenant_id = public.current_tenant_id()
        and p.role in ('coach', 'club-admin')
        and public.search_fold(p.display_name) like v_like
      order by 6, 3
      limit v_limit;

    return query
      select 'athlete', a.id::text, btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')),
        concat_ws(', ', 'Athlete', t.name, case when not a.is_active then 'not active' end),
        jsonb_build_object('athleteId', a.id, 'teamId', a.team_id),
        public.search_rank(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, ''), v_q), null::date
      from public.athletes a
      left join public.teams t on t.id = a.team_id
      where public.search_fold(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) like v_like
      order by 6, 3
      limit v_limit;

    -- Guardians by name, with whose guardian they are. No email, no phone.
    return query
      select 'guardian', p.user_id::text, coalesce(nullif(btrim(p.display_name), ''), 'No name yet'),
        coalesce('Guardian of ' || (
          select string_agg(btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), ', ' order by a.first_name, a.last_name)
          from public.athlete_guardians g
          join public.athletes a on a.id = g.athlete_id
          where g.guardian_user_id = p.user_id and g.status = 'active'
        ), 'Guardian'),
        jsonb_build_object('userId', p.user_id), public.search_rank(p.display_name, v_q), null::date
      from public.profiles p
      where p.tenant_id = public.current_tenant_id()
        and p.role = 'guardian'
        and public.search_fold(p.display_name) like v_like
      order by 6, 3
      limit v_limit;

    return query
      select 'team', t.id::text, t.name, nullif(concat_ws(', ', t.event_group, case when t.status <> 'active' then t.status end), ''),
        jsonb_build_object('teamId', t.id), public.search_rank(t.name, v_q), null::date
      from public.teams t
      where public.search_fold(t.name) like v_like
      order by 6, 3
      limit v_limit;

    -- Athlete and coach invites by email (or the name typed on an athlete invite). Guardian invites
    -- are left out: their email is a guardian's contact detail.
    return query
      select 'invite', i.id::text, i.email, i.subtitle, jsonb_build_object('inviteKind', i.invite_kind), i.r, i.created_at::date
      from (
        select ai.id, lower(ai.email) as email, 'athlete' as invite_kind,
          concat_ws(', ', 'Athlete invite', nullif(btrim(ai.invitee_name), ''), ai.status) as subtitle,
          least(public.search_rank(ai.email, v_q), public.search_rank(ai.invitee_name, v_q)) as r, ai.created_at
        from public.athlete_invites ai
        where ai.email is not null
          and (public.search_fold(ai.email) like v_like or public.search_fold(ai.invitee_name) like v_like)
        union all
        select ci.id, lower(ci.email), 'coach',
          concat_ws(', ', case ci.role when 'club-admin' then 'Club admin invite' else 'Coach invite' end, ci.status),
          public.search_rank(ci.email, v_q), ci.created_at
        from public.coach_invites ci
        where public.search_fold(ci.email) like v_like
      ) i
      order by i.r, i.created_at desc, i.email
      limit v_limit;

    return query
      select 'season', s.id::text, s.name, concat_ws(', ', s.status, to_char(s.start_date, 'FMDD Mon YYYY') || ' to ' || to_char(s.end_date, 'FMDD Mon YYYY')),
        jsonb_build_object('seasonId', s.id), public.search_rank(s.name, v_q), s.start_date
      from public.club_seasons s
      where public.search_fold(s.name) like v_like
      order by 6, s.start_date desc, 3
      limit v_limit;

    return query
      select 'club_event', e.id::text, e.title, concat_ws(', ', to_char(e.starts_on, 'FMDD Mon YYYY'), nullif(e.place, '')),
        jsonb_build_object('eventId', e.id, 'date', e.starts_on), public.search_rank(e.title, v_q), e.starts_on
      from public.club_events e
      where public.search_fold(e.title) like v_like or public.search_fold(e.place) like v_like
      order by 6, e.starts_on desc, 3
      limit v_limit;
    return;
  end if;

  if v_role = 'athlete' then
    v_athlete_id := public.current_athlete_id();
    if v_athlete_id is null then
      return;
    end if;

    -- Own sessions by name or by day ("12 March", "2026-03-12"). The coach's note is not read.
    return query
      select 'session', s.id::text, s.title, concat_ws(', ', to_char(s.scheduled_for, 'Dy FMDD Mon YYYY'), s.status),
        jsonb_build_object('sessionId', s.id, 'date', s.scheduled_for),
        case when public.search_fold(s.title) like v_like then public.search_rank(s.title, v_q) else 3 end, s.scheduled_for
      from public.sessions s
      where s.athlete_id = v_athlete_id
        and (
          public.search_fold(s.title) like v_like
          or public.search_fold(to_char(s.scheduled_for, 'YYYY-MM-DD FMDD FMMonth YYYY FMDD Mon YYYY')) like v_like
        )
      order by 6, s.scheduled_for desc, 3
      limit v_limit;

    return query
      select 'record', x.event_group, x.event_label, 'Results, ' || x.n || case when x.n = 1 then ' mark' else ' marks' end,
        jsonb_build_object('eventGroup', x.event_group), public.search_rank(x.event_label, v_q), x.last_date
      from (
        select r.event_group, (array_agg(r.event_label order by r.result_date desc))[1] as event_label, count(*) as n, max(r.result_date) as last_date
        from public.athlete_results r
        where r.athlete_id = v_athlete_id and public.search_fold(r.event_label) like v_like
        group by r.event_group
      ) x
      order by 6, x.last_date desc, 3
      limit v_limit;

    return query
      select 'competition', c.id::text, c.name, concat_ws(', ', to_char(c.start_date, 'FMDD Mon YYYY'), coalesce(nullif(c.venue, ''), nullif(c.location, ''))),
        jsonb_build_object('competitionId', c.id), public.search_rank(c.name, v_q), c.start_date
      from public.competitions c
      where public.search_fold(c.name) like v_like or public.search_fold(c.venue) like v_like
      order by 6, c.start_date desc, 3
      limit v_limit;

    return query
      select 'goal', g.id::text, g.event_label,
        concat_ws(', ', case when g.achieved_on is not null then 'Goal reached' else 'Goal' end, 'by ' || to_char(g.target_date, 'FMDD Mon YYYY')),
        jsonb_build_object('goalId', g.id), public.search_rank(g.event_label, v_q), g.target_date
      from public.athlete_goals g
      where g.athlete_id = v_athlete_id and public.search_fold(g.event_label) like v_like
      order by 6, g.created_at desc, 3
      limit v_limit;

    -- The coaches of the athlete's own team, through the existing function. Name and team role only.
    return query
      select 'coach', c.user_id::text, coalesce(c.display_name, 'Coach'),
        case c.team_role when 'lead' then 'Lead coach' when 'assistant' then 'Assistant coach' else 'Coach' end,
        jsonb_build_object('coachUserId', c.user_id, 'canMessage', coalesce(c.can_message, false)), public.search_rank(c.display_name, v_q), null::date
      from public.get_current_athlete_team_coaches() c
      where public.search_fold(c.display_name) like v_like
      order by 6, 3
      limit v_limit;
    return;
  end if;

  if v_role = 'guardian' then
    -- The linked children and the competitions those children are in. Nothing else.
    return query
      select 'child', a.id::text, btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), t.name,
        jsonb_build_object('athleteId', a.id),
        public.search_rank(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, ''), v_q), null::date
      from public.athletes a
      left join public.teams t on t.id = a.team_id
      where a.id = any (public.current_guardian_athlete_ids())
        and public.search_fold(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) like v_like
      order by 6, 3
      limit v_limit;

    return query
      select 'competition', c.id::text, c.name, concat_ws(', ', to_char(c.start_date, 'FMDD Mon YYYY'), coalesce(nullif(c.venue, ''), nullif(c.location, ''))),
        jsonb_build_object('competitionId', c.id), public.search_rank(c.name, v_q), c.start_date
      from public.competitions c
      where c.id = any (public.current_guardian_competition_ids())
        and (public.search_fold(c.name) like v_like or public.search_fold(c.venue) like v_like)
      order by 6, c.start_date desc, 3
      limit v_limit;
    return;
  end if;
end
$search$;

revoke all on function public.search_platform_admins() from public, anon;
revoke all on function public.search_everything(text, integer) from public, anon;
grant execute on function public.search_fold(text) to authenticated, service_role;
grant execute on function public.search_rank(text, text) to authenticated, service_role;
grant execute on function public.search_platform_admins() to authenticated;
grant execute on function public.search_everything(text, integer) to authenticated;

-- Trigram indexes for the two tables that grow large. Guarded: without pg_trgm the file still applies.
do $$
declare
  v_schema text;
begin
  begin
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      create extension if not exists pg_trgm with schema extensions;
    else
      create extension if not exists pg_trgm;
    end if;
  exception
    when others then
      raise notice 'pg_trgm could not be installed (%). Search still works, without its two name indexes.', sqlerrm;
  end;

  select n.nspname into v_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if v_schema is null then
    return;
  end if;

  execute format(
    $i$create index if not exists athletes_search_name_trgm_idx on public.athletes using gin ((public.search_fold(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) %I.gin_trgm_ops)$i$,
    v_schema
  );
  execute format(
    $i$create index if not exists sessions_search_title_trgm_idx on public.sessions using gin ((public.search_fold(title)) %I.gin_trgm_ops)$i$,
    v_schema
  );
exception
  when others then
    raise notice 'Search indexes were not created (%). Search still works.', sqlerrm;
end
$$;

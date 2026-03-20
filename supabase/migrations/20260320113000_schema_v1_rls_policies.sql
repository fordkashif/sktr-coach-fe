-- PaceLab Schema v1 RLS Policies (W1-W3)
-- Created: 2026-03-20

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.tenant_id
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_coach_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('coach', 'club-admin'), false)
$$;

create or replace function public.is_club_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'club-admin', false)
$$;

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.athletes enable row level security;
alter table public.sessions enable row level security;
alter table public.session_blocks enable row level security;
alter table public.session_block_rows enable row level security;
alter table public.session_completions enable row level security;
alter table public.test_weeks enable row level security;
alter table public.test_definitions enable row level security;
alter table public.test_results enable row level security;

drop policy if exists tenants_select_own_tenant on public.tenants;
create policy tenants_select_own_tenant
on public.tenants
for select
to authenticated
using (id = public.current_tenant_id());

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists profiles_select_tenant_for_staff on public.profiles;
create policy profiles_select_tenant_for_staff
on public.profiles
for select
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());

drop policy if exists teams_select_tenant on public.teams;
create policy teams_select_tenant
on public.teams
for select
to authenticated
using (tenant_id = public.current_tenant_id());

drop policy if exists teams_modify_tenant_staff on public.teams;
create policy teams_modify_tenant_staff
on public.teams
for all
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id())
with check (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());

drop policy if exists athletes_select_own on public.athletes;
create policy athletes_select_own
on public.athletes
for select
to authenticated
using (user_id = auth.uid() and tenant_id = public.current_tenant_id());

drop policy if exists athletes_select_tenant_staff on public.athletes;
create policy athletes_select_tenant_staff
on public.athletes
for select
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());

drop policy if exists athletes_modify_tenant_staff on public.athletes;
create policy athletes_modify_tenant_staff
on public.athletes
for all
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id())
with check (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());

drop policy if exists sessions_select_own on public.sessions;
create policy sessions_select_own
on public.sessions
for select
to authenticated
using (
  exists (
    select 1
    from public.athletes a
    where a.id = athlete_id
      and a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists sessions_select_tenant_staff on public.sessions;
create policy sessions_select_tenant_staff
on public.sessions
for select
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());

drop policy if exists sessions_modify_tenant_staff on public.sessions;
create policy sessions_modify_tenant_staff
on public.sessions
for all
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id())
with check (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());

drop policy if exists session_blocks_select_own on public.session_blocks;
create policy session_blocks_select_own
on public.session_blocks
for select
to authenticated
using (
  exists (
    select 1
    from public.sessions s
    join public.athletes a on a.id = s.athlete_id
    where s.id = session_id
      and a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists session_blocks_staff_all on public.session_blocks;
create policy session_blocks_staff_all
on public.session_blocks
for all
to authenticated
using (
  public.is_coach_or_admin()
  and exists (
    select 1
    from public.sessions s
    where s.id = session_id
      and s.tenant_id = public.current_tenant_id()
  )
)
with check (
  public.is_coach_or_admin()
  and exists (
    select 1
    from public.sessions s
    where s.id = session_id
      and s.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists session_block_rows_select_own on public.session_block_rows;
create policy session_block_rows_select_own
on public.session_block_rows
for select
to authenticated
using (
  exists (
    select 1
    from public.session_blocks sb
    join public.sessions s on s.id = sb.session_id
    join public.athletes a on a.id = s.athlete_id
    where sb.id = session_block_id
      and a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists session_block_rows_staff_all on public.session_block_rows;
create policy session_block_rows_staff_all
on public.session_block_rows
for all
to authenticated
using (
  public.is_coach_or_admin()
  and exists (
    select 1
    from public.session_blocks sb
    join public.sessions s on s.id = sb.session_id
    where sb.id = session_block_id
      and s.tenant_id = public.current_tenant_id()
  )
)
with check (
  public.is_coach_or_admin()
  and exists (
    select 1
    from public.session_blocks sb
    join public.sessions s on s.id = sb.session_id
    where sb.id = session_block_id
      and s.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists session_completions_select_own on public.session_completions;
create policy session_completions_select_own
on public.session_completions
for select
to authenticated
using (
  athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists session_completions_insert_own on public.session_completions;
create policy session_completions_insert_own
on public.session_completions
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
  and session_id in (
    select s.id
    from public.sessions s
    where s.tenant_id = public.current_tenant_id()
      and s.athlete_id = athlete_id
  )
);

drop policy if exists session_completions_staff_all on public.session_completions;
create policy session_completions_staff_all
on public.session_completions
for all
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id())
with check (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());

drop policy if exists test_weeks_select_tenant on public.test_weeks;
create policy test_weeks_select_tenant
on public.test_weeks
for select
to authenticated
using (tenant_id = public.current_tenant_id());

drop policy if exists test_weeks_staff_all on public.test_weeks;
create policy test_weeks_staff_all
on public.test_weeks
for all
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id())
with check (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());

drop policy if exists test_definitions_select_tenant on public.test_definitions;
create policy test_definitions_select_tenant
on public.test_definitions
for select
to authenticated
using (
  exists (
    select 1
    from public.test_weeks tw
    where tw.id = test_week_id
      and tw.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists test_definitions_staff_all on public.test_definitions;
create policy test_definitions_staff_all
on public.test_definitions
for all
to authenticated
using (
  public.is_coach_or_admin()
  and exists (
    select 1
    from public.test_weeks tw
    where tw.id = test_week_id
      and tw.tenant_id = public.current_tenant_id()
  )
)
with check (
  public.is_coach_or_admin()
  and exists (
    select 1
    from public.test_weeks tw
    where tw.id = test_week_id
      and tw.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists test_results_select_own on public.test_results;
create policy test_results_select_own
on public.test_results
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists test_results_write_own on public.test_results;
create policy test_results_write_own
on public.test_results
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists test_results_update_own on public.test_results;
create policy test_results_update_own
on public.test_results
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and athlete_id in (
    select a.id
    from public.athletes a
    where a.user_id = auth.uid()
      and a.tenant_id = public.current_tenant_id()
  )
);

drop policy if exists test_results_staff_all on public.test_results;
create policy test_results_staff_all
on public.test_results
for all
to authenticated
using (public.is_coach_or_admin() and tenant_id = public.current_tenant_id())
with check (public.is_coach_or_admin() and tenant_id = public.current_tenant_id());


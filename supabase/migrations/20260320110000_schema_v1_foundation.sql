-- PaceLab Schema v1 Foundation (W1-W3)
-- Created: 2026-03-20

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  role text not null check (role in ('athlete', 'coach', 'club-admin')),
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  event_group text,
  is_archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.athletes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  event_group text,
  primary_event text,
  readiness text check (readiness in ('green', 'yellow', 'red')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists athletes_tenant_user_uniq
on public.athletes (tenant_id, user_id)
where user_id is not null;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  title text not null,
  status text not null check (status in ('scheduled', 'in-progress', 'completed')) default 'scheduled',
  scheduled_for date not null,
  estimated_duration_minutes int check (estimated_duration_minutes is null or estimated_duration_minutes > 0),
  coach_note text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.session_blocks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  sort_order int not null check (sort_order >= 0),
  block_type text not null check (block_type in ('Strength', 'Run', 'Sprint', 'Jumps', 'Throws')),
  name text not null,
  focus text,
  coach_note text,
  previous_result text,
  rest_label text,
  created_at timestamptz not null default now()
);

create table if not exists public.session_block_rows (
  id uuid primary key default gen_random_uuid(),
  session_block_id uuid not null references public.session_blocks(id) on delete cascade,
  sort_order int not null check (sort_order >= 0),
  label text not null,
  target text not null,
  helper text,
  created_at timestamptz not null default now()
);

create table if not exists public.session_completions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  session_id uuid not null references public.sessions(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  completion_date date not null,
  completed_at timestamptz not null default now(),
  completed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (session_id, athlete_id)
);

create table if not exists public.test_weeks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null check (status in ('draft', 'published', 'closed')) default 'draft',
  is_archived boolean not null default false,
  archived_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date <= end_date)
);

create table if not exists public.test_definitions (
  id uuid primary key default gen_random_uuid(),
  test_week_id uuid not null references public.test_weeks(id) on delete cascade,
  sort_order int not null check (sort_order >= 0),
  name text not null,
  unit text not null check (unit in ('time', 'distance', 'weight', 'height', 'score')),
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (test_week_id, name)
);

create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  test_week_id uuid not null references public.test_weeks(id) on delete cascade,
  test_definition_id uuid not null references public.test_definitions(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  value_text text not null,
  value_numeric numeric(10, 3),
  submitted_by_user_id uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (test_week_id, test_definition_id, athlete_id)
);

create index if not exists teams_tenant_idx on public.teams (tenant_id);
create index if not exists athletes_tenant_idx on public.athletes (tenant_id);
create index if not exists athletes_team_idx on public.athletes (team_id);
create index if not exists sessions_tenant_athlete_sched_idx on public.sessions (tenant_id, athlete_id, scheduled_for desc);
create index if not exists session_blocks_session_sort_idx on public.session_blocks (session_id, sort_order);
create index if not exists session_block_rows_block_sort_idx on public.session_block_rows (session_block_id, sort_order);
create index if not exists session_completions_tenant_athlete_date_idx on public.session_completions (tenant_id, athlete_id, completion_date desc);
create index if not exists test_weeks_tenant_start_idx on public.test_weeks (tenant_id, start_date desc);
create index if not exists test_definitions_week_sort_idx on public.test_definitions (test_week_id, sort_order);
create index if not exists test_results_tenant_athlete_submitted_idx on public.test_results (tenant_id, athlete_id, submitted_at desc);

drop trigger if exists set_updated_at_tenants on public.tenants;
create trigger set_updated_at_tenants
before update on public.tenants
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_profiles on public.profiles;
create trigger set_updated_at_profiles
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_teams on public.teams;
create trigger set_updated_at_teams
before update on public.teams
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_athletes on public.athletes;
create trigger set_updated_at_athletes
before update on public.athletes
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_sessions on public.sessions;
create trigger set_updated_at_sessions
before update on public.sessions
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_test_weeks on public.test_weeks;
create trigger set_updated_at_test_weeks
before update on public.test_weeks
for each row
execute function public.set_updated_at();


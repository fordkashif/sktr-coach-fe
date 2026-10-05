-- SKTR Coach: plan templates
-- Created: 2026-10-12
--
-- plan_templates: a club's library of training plans its coaches reuse across teams and
-- seasons. A template holds the structure of a plan (weeks, days, sessions, blocks, exercise
-- rows with their library links and percentage loads) and nothing that belongs to one squad:
-- no team, no dates, no assignment, and no changes for single athletes. A check constraint
-- refuses a structure that still carries an assignment or per athlete changes, so a template
-- can never hold athlete ids, whatever the browser sends.
--
-- Sharing: a template belongs to the club. Every active coach and club admin of the club can
-- read and use any template. Only the coach who made it, or a club admin, can change, archive
-- or delete it. Athletes and other clubs see nothing. Nothing is seeded.
--
-- "Last used" is written by mark_plan_template_used(), because the coach who uses a template
-- is often not the one who may change it.
--
-- Idempotent and additive: create table/index if not exists, create or replace function,
-- drop policy/trigger if exists before create. No existing data is changed.

create table if not exists public.plan_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  phase text check (phase is null or phase in ('general-prep', 'specific-prep', 'competition', 'taper')),
  event_group text check (event_group is null or event_group in ('Sprint', 'Mid', 'Distance', 'Jumps', 'Throws')),
  weeks integer not null check (weeks between 1 and 24),
  -- Sessions in the structure, set by trigger, so the list never has to load the structure.
  session_count integer not null default 0,
  -- 0 (Sunday) to 6: the weekday the plan it was saved from started on.
  start_weekday smallint check (start_weekday is null or start_weekday between 0 and 6),
  -- { version, weekFocus, sessions[] }: the builder's model without the squad specific parts.
  structure jsonb not null,
  is_archived boolean not null default false,
  created_by_user_id uuid references auth.users(id) on delete set null,
  -- The creator's name when it was made, so the list needs no read of other people's profiles.
  created_by_name text not null default '',
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_templates_structure_shape check (
    jsonb_typeof(structure) = 'object'
    and coalesce(jsonb_typeof(structure -> 'sessions'), '') = 'array'
    and octet_length(structure::text) <= 1500000
  ),
  constraint plan_templates_no_squad_data check (
    not (structure ? 'assign')
    and not jsonb_path_exists(structure, '$.sessions[*].blocks[*].exercises[*].overrides')
  )
);

create index if not exists plan_templates_tenant_idx
on public.plan_templates (tenant_id, is_archived, name);

create or replace function public.plan_templates_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  -- A structure without a sessions list is refused by the shape check, with its own message.
  new.session_count := case when jsonb_typeof(new.structure -> 'sessions') = 'array' then jsonb_array_length(new.structure -> 'sessions') else 0 end;
  if tg_op = 'INSERT' then
    -- Who made it comes from the caller, not from the browser.
    if auth.uid() is not null then
      new.created_by_user_id := auth.uid();
      new.created_by_name := coalesce(
        (select nullif(btrim(p.display_name), '') from public.profiles p where p.user_id = auth.uid()),
        'A coach'
      );
      new.last_used_at := null;
    end if;
  else
    -- Which club it belongs to and who made it never change.
    new.tenant_id := old.tenant_id;
    new.created_by_user_id := old.created_by_user_id;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
    -- Being used is not a change to the template.
    if (new.name, new.description, new.phase, new.event_group, new.weeks, new.start_weekday, new.is_archived)
         is distinct from (old.name, old.description, old.phase, old.event_group, old.weeks, old.start_weekday, old.is_archived)
       or new.structure is distinct from old.structure then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.plan_templates_before_write() from public, anon, authenticated;

drop trigger if exists plan_templates_before_write on public.plan_templates;
create trigger plan_templates_before_write
before insert or update on public.plan_templates
for each row
execute function public.plan_templates_before_write();

alter table public.plan_templates enable row level security;

-- Every active coach and club admin of the club reads every template of the club.
drop policy if exists plan_templates_select_staff on public.plan_templates;
create policy plan_templates_select_staff
on public.plan_templates
for select
to authenticated
using (tenant_id = public.current_tenant_id() and public.is_coach_or_admin());

-- Any of them may add one, as themselves.
drop policy if exists plan_templates_insert_staff on public.plan_templates;
create policy plan_templates_insert_staff
on public.plan_templates
for insert
to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and public.is_coach_or_admin()
  and created_by_user_id = auth.uid()
);

-- Only its creator or a club admin changes it (details, archive, restore).
drop policy if exists plan_templates_update_owner_or_admin on public.plan_templates;
create policy plan_templates_update_owner_or_admin
on public.plan_templates
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and public.is_coach_or_admin()
  and (created_by_user_id = auth.uid() or public.is_club_admin())
)
with check (
  tenant_id = public.current_tenant_id()
  and public.is_coach_or_admin()
  and (created_by_user_id = auth.uid() or public.is_club_admin())
);

-- Only its creator or a club admin deletes it.
drop policy if exists plan_templates_delete_owner_or_admin on public.plan_templates;
create policy plan_templates_delete_owner_or_admin
on public.plan_templates
for delete
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and public.is_coach_or_admin()
  and (created_by_user_id = auth.uid() or public.is_club_admin())
);

revoke all on table public.plan_templates from anon, authenticated;
grant select, insert, update, delete on table public.plan_templates to authenticated;
grant all on table public.plan_templates to service_role;

-- Records that a template was used to start a plan. Any active coach or club admin of the
-- template's club may call it; it changes last_used_at and nothing else. Returns false when
-- the template is not one the caller can see.
create or replace function public.mark_plan_template_used(p_template_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_done boolean;
begin
  perform public.assert_caller_active();
  v_tenant_id := public.current_tenant_id();
  if v_tenant_id is null or not public.is_coach_or_admin() then
    raise exception 'Only coaches and club admins can use plan templates.' using errcode = '42501';
  end if;
  update public.plan_templates t
  set last_used_at = now()
  where t.id = p_template_id
    and t.tenant_id = v_tenant_id
  returning true into v_done;
  return coalesce(v_done, false);
end;
$$;

revoke all on function public.mark_plan_template_used(uuid) from public, anon;
grant execute on function public.mark_plan_template_used(uuid) to authenticated, service_role;

-- PaceLab Training Plan Drafts
-- Created: 2026-10-04
--
-- training_plans.status already allows 'draft'. This migration makes drafts usable:
-- 1. builder_state stores the coach's full builder model (sessions, blocks, exercises,
--    intended assignment) so a draft or a published plan can be reopened and edited.
--    Drafts live only in this column: they have no week/day/block rows and no
--    training_plan_assignments rows, so the assignment notification trigger never fires for them.
-- 2. Select policies no longer expose draft plans (or any structure under them) to athletes.
--    Staff keep full access through the existing *_staff_all policies.

alter table public.training_plans
  add column if not exists builder_state jsonb;

comment on column public.training_plans.builder_state is
  'Coach plan builder model (version, sessions, weekFocus, assign). Source of truth for drafts; kept on publish so the plan can be edited later.';

drop policy if exists training_plans_select_tenant on public.training_plans;
create policy training_plans_select_tenant
on public.training_plans
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (status <> 'draft' or public.is_coach_or_admin())
);

drop policy if exists training_plan_weeks_select_tenant on public.training_plan_weeks;
create policy training_plan_weeks_select_tenant
on public.training_plan_weeks
for select
to authenticated
using (
  exists (
    select 1
    from public.training_plans tp
    where tp.id = plan_id
      and tp.tenant_id = public.current_tenant_id()
      and (tp.status <> 'draft' or public.is_coach_or_admin())
  )
);

drop policy if exists training_plan_days_select_tenant on public.training_plan_days;
create policy training_plan_days_select_tenant
on public.training_plan_days
for select
to authenticated
using (
  exists (
    select 1
    from public.training_plan_weeks tpw
    join public.training_plans tp on tp.id = tpw.plan_id
    where tpw.id = plan_week_id
      and tp.tenant_id = public.current_tenant_id()
      and (tp.status <> 'draft' or public.is_coach_or_admin())
  )
);

drop policy if exists training_plan_blocks_select_tenant on public.training_plan_blocks;
create policy training_plan_blocks_select_tenant
on public.training_plan_blocks
for select
to authenticated
using (
  exists (
    select 1
    from public.training_plan_days tpd
    join public.training_plan_weeks tpw on tpw.id = tpd.plan_week_id
    join public.training_plans tp on tp.id = tpw.plan_id
    where tpd.id = plan_day_id
      and tp.tenant_id = public.current_tenant_id()
      and (tp.status <> 'draft' or public.is_coach_or_admin())
  )
);

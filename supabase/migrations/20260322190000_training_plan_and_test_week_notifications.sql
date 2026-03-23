-- Created: 2026-03-22

create or replace function public.enqueue_training_plan_assignment_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_name text;
  v_team_name text;
  v_start_date text;
begin
  if new.visibility_start <> 'immediate' then
    return new;
  end if;

  select tp.name, to_char(tp.start_date, 'YYYY-MM-DD')
  into v_plan_name, v_start_date
  from public.training_plans tp
  where tp.id = new.plan_id;

  select tm.name
  into v_team_name
  from public.teams tm
  where tm.id = coalesce(new.team_id, (select tp.team_id from public.training_plans tp where tp.id = new.plan_id));

  if new.scope = 'athlete' and new.athlete_id is not null then
    insert into public.notification_events (
      tenant_id,
      recipient_user_id,
      recipient_email,
      channel,
      event_type,
      subject,
      body,
      status,
      metadata
    )
    select
      new.tenant_id,
      a.user_id,
      lower(coalesce(au.email, null)),
      channel.channel,
      'training_plan_published',
      'New training plan published',
      format(
        'Your training plan %s is now available%s%s.',
        coalesce(v_plan_name, 'Training plan'),
        case when v_team_name is null then '' else format(' for team %s', v_team_name) end,
        case when v_start_date is null then '' else format(' starting %s', v_start_date) end
      ),
      'pending',
      jsonb_build_object(
        'plan_id', new.plan_id,
        'assignment_id', new.id,
        'audience', 'athlete'
      )
    from public.athletes a
    left join auth.users au on au.id = a.user_id
    cross join (values ('email'::text), ('in-app'::text)) as channel(channel)
    where a.id = new.athlete_id
      and a.user_id is not null;

    return new;
  end if;

  if new.scope = 'team' and new.team_id is not null then
    insert into public.notification_events (
      tenant_id,
      recipient_user_id,
      recipient_email,
      channel,
      event_type,
      subject,
      body,
      status,
      metadata
    )
    select
      new.tenant_id,
      a.user_id,
      lower(coalesce(au.email, null)),
      channel.channel,
      'training_plan_published',
      'New training plan published',
      format(
        'Your training plan %s is now available for team %s%s.',
        coalesce(v_plan_name, 'Training plan'),
        coalesce(v_team_name, 'your team'),
        case when v_start_date is null then '' else format(' starting %s', v_start_date) end
      ),
      'pending',
      jsonb_build_object(
        'plan_id', new.plan_id,
        'assignment_id', new.id,
        'audience', 'team'
      )
    from public.athletes a
    left join auth.users au on au.id = a.user_id
    cross join (values ('email'::text), ('in-app'::text)) as channel(channel)
    where a.team_id = new.team_id
      and a.tenant_id = new.tenant_id
      and a.user_id is not null
      and a.is_active = true;
  end if;

  return new;
end;
$$;

drop trigger if exists queue_training_plan_assignment_notifications on public.training_plan_assignments;
create trigger queue_training_plan_assignment_notifications
after insert on public.training_plan_assignments
for each row
execute function public.enqueue_training_plan_assignment_notifications();

create or replace function public.enqueue_test_week_published_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_name text;
begin
  if new.status <> 'published' then
    return new;
  end if;

  select tm.name
  into v_team_name
  from public.teams tm
  where tm.id = new.team_id;

  insert into public.notification_events (
    tenant_id,
    recipient_user_id,
    recipient_email,
    channel,
    event_type,
    subject,
    body,
    status,
    metadata
  )
  select
    new.tenant_id,
    a.user_id,
    lower(coalesce(au.email, null)),
    channel.channel,
    'test_week_published',
    'New test week published',
    format(
      'Test week %s is now open%s from %s to %s.',
      new.name,
      case when v_team_name is null then '' else format(' for team %s', v_team_name) end,
      to_char(new.start_date, 'YYYY-MM-DD'),
      to_char(new.end_date, 'YYYY-MM-DD')
    ),
    'pending',
    jsonb_build_object(
      'test_week_id', new.id,
      'team_id', new.team_id
    )
  from public.athletes a
  left join auth.users au on au.id = a.user_id
  cross join (values ('email'::text), ('in-app'::text)) as channel(channel)
  where a.team_id = new.team_id
    and a.tenant_id = new.tenant_id
    and a.user_id is not null
    and a.is_active = true;

  return new;
end;
$$;

drop trigger if exists queue_test_week_published_notifications on public.test_weeks;
create trigger queue_test_week_published_notifications
after insert on public.test_weeks
for each row
execute function public.enqueue_test_week_published_notifications();

-- Edit conflicts ("two people editing the same thing") and the login hint for guardian invites.
--
-- 1. Who changed it last
--    The plan builder, a test week's setup, a team's details and the club profile now refuse to
--    overwrite a record that changed since it was opened. The check itself needs no new schema:
--    all four tables already have updated_at kept by set_updated_at(), and the app sends its
--    update with "where updated_at = <the value it loaded>" (src/lib/data/edit-conflict-data.ts).
--    What was missing is WHO changed it, for "Andre changed this plan 2 minutes ago".
--    Added: updated_by_user_id on training_plans, test_weeks, teams and club_profiles, stamped by
--    a trigger with auth.uid() on every insert and update. The browser never chooses the value.
--    A change made by the server (service role, cron) leaves it empty.
--    No policy changes: the column is read through the tables' existing select policies, and the
--    name comes from profiles.display_name under its existing policy.
--
-- 2. bootstrap_current_profile()
--    Before: status 'invite_pending' only looked at coach_invites and athlete_invites, so a
--    parent who signed in before opening their invite link was told the account is not active in
--    any club. After: a pending, unexpired guardian_invites row for the confirmed email also
--    returns 'invite_pending'. Nothing else in the function changes: it still creates a profile
--    only for the requestor of an approved club request, and never from an invite.
--
-- Idempotent: add column if not exists, create or replace function, drop trigger if exists
-- before create trigger. Applying it twice changes nothing.

-- 1. Who changed it last ---------------------------------------------------------------------------

alter table public.training_plans add column if not exists updated_by_user_id uuid references auth.users(id) on delete set null;
alter table public.test_weeks add column if not exists updated_by_user_id uuid references auth.users(id) on delete set null;
alter table public.teams add column if not exists updated_by_user_id uuid references auth.users(id) on delete set null;
alter table public.club_profiles add column if not exists updated_by_user_id uuid references auth.users(id) on delete set null;

comment on column public.training_plans.updated_by_user_id is 'Who last changed the row. Set by trigger from auth.uid(); empty for a change made by the server.';
comment on column public.test_weeks.updated_by_user_id is 'Who last changed the row. Set by trigger from auth.uid(); empty for a change made by the server.';
comment on column public.teams.updated_by_user_id is 'Who last changed the row. Set by trigger from auth.uid(); empty for a change made by the server.';
comment on column public.club_profiles.updated_by_user_id is 'Who last changed the row. Set by trigger from auth.uid(); empty for a change made by the server.';

-- Not security definer: it only writes the row being saved, with the caller's own id.
-- When an account is deleted, zz_release_deleted_account (installed at the end of this file) runs
-- after this trigger and blanks the id again, so the delete is never blocked.
create or replace function public.stamp_updated_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_by_user_id := auth.uid();
  return new;
end;
$$;

revoke all on function public.stamp_updated_by() from public, anon, authenticated;

drop trigger if exists stamp_updated_by_training_plans on public.training_plans;
create trigger stamp_updated_by_training_plans
before insert or update on public.training_plans
for each row execute function public.stamp_updated_by();

drop trigger if exists stamp_updated_by_test_weeks on public.test_weeks;
create trigger stamp_updated_by_test_weeks
before insert or update on public.test_weeks
for each row execute function public.stamp_updated_by();

drop trigger if exists stamp_updated_by_teams on public.teams;
create trigger stamp_updated_by_teams
before insert or update on public.teams
for each row execute function public.stamp_updated_by();

drop trigger if exists stamp_updated_by_club_profiles on public.club_profiles;
create trigger stamp_updated_by_club_profiles
before insert or update on public.club_profiles
for each row execute function public.stamp_updated_by();

-- 2. The login hint knows about guardian invites ----------------------------------------------------
-- Same function as 20261005200000, with one more "exists" for guardian_invites.

create or replace function public.bootstrap_current_profile()
returns table (
  user_id uuid,
  tenant_id uuid,
  role text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_profile public.profiles%rowtype;
  v_request public.tenant_provision_requests%rowtype;
  v_created int;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  if found then
    return query select v_profile.user_id, v_profile.tenant_id, v_profile.role, 'existing'::text;
    return;
  end if;

  -- An unconfirmed address proves nothing about who the caller is.
  select lower(btrim(au.email))
  into v_email
  from auth.users au
  where au.id = v_user_id
    and au.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    return query select v_user_id, null::uuid, null::text, 'none'::text;
    return;
  end if;

  select r.*
  into v_request
  from public.tenant_provision_requests r
  join public.tenants t
    on t.id = r.provisioned_tenant_id
  where lower(btrim(r.requestor_email)) = v_email
    and r.status = 'approved'
    and r.provisioned_tenant_id is not null
    and t.is_active
  order by r.reviewed_at desc nulls last, r.created_at desc
  limit 1;

  if found then
    insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
    values (
      v_user_id,
      v_request.provisioned_tenant_id,
      'club-admin',
      nullif(btrim(coalesce(v_request.requestor_name, '')), ''),
      true
    )
    on conflict (user_id) do nothing;

    get diagnostics v_created = row_count;

    if v_created > 0 then
      insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
      values (
        v_request.provisioned_tenant_id,
        v_user_id,
        'club-admin',
        'club_admin_first_access',
        v_email,
        'Club admin profile created from approved club request ' || v_request.id::text
      );
    end if;

    -- Re-read: a second tab may have created the row between the two statements.
    select *
    into v_profile
    from public.profiles p
    where p.user_id = v_user_id
    limit 1;

    return query
    select v_profile.user_id, v_profile.tenant_id, v_profile.role,
           case when v_created > 0 then 'created' else 'existing' end;
    return;
  end if;

  if exists (
       select 1
       from public.coach_invites ci
       where lower(btrim(ci.email)) = v_email
         and ci.status = 'pending'
         and (ci.expires_at is null or ci.expires_at >= now())
     )
     or exists (
       select 1
       from public.athlete_invites ai
       where lower(btrim(ai.email)) = v_email
         and ai.status = 'pending'
         and (ai.expires_at is null or ai.expires_at >= now())
     )
     -- New: a parent or guardian invite counts too (guardian_invites.email is stored lower case).
     or exists (
       select 1
       from public.guardian_invites gi
       where lower(btrim(gi.email)) = v_email
         and gi.status = 'pending'
         and (gi.expires_at is null or gi.expires_at >= now())
     ) then
    return query select v_user_id, null::uuid, null::text, 'invite_pending'::text;
    return;
  end if;

  return query select v_user_id, null::uuid, null::text, 'none'::text;
end;
$$;


revoke all on function public.bootstrap_current_profile() from public, anon;
grant execute on function public.bootstrap_current_profile() to authenticated, service_role;

-- 3. The new columns point at auth.users with "set null": let account deletion blank them.
do $$ begin perform public.install_deleted_account_triggers(); end $$;

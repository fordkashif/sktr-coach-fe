-- SKTR Coach: personal data rights and club exit
-- Created: 2026-10-14
--
-- WHY
--   The privacy page promises that a person can get a copy of their data, have their account and
--   data deleted, and that a club's data is deleted within 90 days of the club leaving. Until now
--   every one of those was an email to support and work by hand in the database.
--
-- WHAT THIS FILE ADDS
--   1. A club owner. Until now every club admin was equal. club_owners holds at most one owner
--      per club; a club with no row is owned by its longest standing active club admin, which is
--      the admin who set the club up. The owner is the admin who can transfer ownership, close
--      the club, and remove, turn off or change the role of another club admin (a trigger on
--      profiles enforces that whichever function or policy does the write).
--        get_club_ownership()                    who owns the caller's club, and the admins it
--                                                could be handed to
--        transfer_club_ownership(user, name)     owner only, typed club name
--   2. Personal data export has no table: the browser builds the file from what row level
--      security already lets the person read. record_data_export() writes the audit entry
--      (who and when, never the content) for a personal export and for a whole club export.
--   3. Deleting your own account.
--        get_my_account_deletion_check()         what blocks it, per role, with the team names
--        delete_my_account(typed email)          athlete, coach or club admin. Deletes the
--                                                login (auth.users) inside the function, never
--                                                from the browser.
--   4. Closing a club and deleting it.
--        club_closures                           one open row per closed club, with the date
--                                                after which it is deleted (90 days)
--        close_current_club(typed name)          owner only. Access is blocked at once through
--                                                the EXISTING lifecycle path (the club's latest
--                                                provisioning record becomes 'suspended', which
--                                                every helper and policy already honours); the
--                                                closure row is what makes it "closed" and not
--                                                "paused".
--        get_current_club_closure()              lets a locked out member see why
--        get_closed_clubs()                      platform admin: closed clubs and their dates
--        reopen_closed_club(club)                platform admin, before deletion
--        delete_closed_club(club, typed name)    THE dangerous one. See section 7.
--        run_club_deletions()                    the scheduled job (pg_cron, daily, guarded)
--   5. storage_deletion_queue. SQL cannot remove files: Supabase refuses a direct delete on
--      storage.objects, and deleting the row would leave the file behind anyway. Every delete
--      above writes the paths of the profile photos and club logo it orphans to this queue, and
--      the edge function purge-deleted-storage removes them with the Storage API.
--
-- Every function that a member calls starts with assert_caller_active() (20261006180000).
-- Idempotent: create table if not exists, create or replace function, drop trigger if exists +
-- create trigger, drop policy if exists + create policy, unschedule then schedule. Applying this
-- file changes no existing row.

-- 0. Small helpers -------------------------------------------------------------------------------

-- The club's name as its members see it (club profile first, then the tenant record).
create or replace function public.club_display_name(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(cp.club_name), '') from public.club_profiles cp where cp.tenant_id = p_tenant_id limit 1),
    (select nullif(btrim(t.name), '') from public.tenants t where t.id = p_tenant_id),
    'Club'
  )
$$;

revoke all on function public.club_display_name(uuid) from public, anon, authenticated;

-- What a typed confirmation is compared as: case and extra spaces are forgiven.
create or replace function public.confirm_text_key(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')))
$$;

revoke all on function public.confirm_text_key(text) from public, anon, authenticated;

-- Deletes every row whose column p_column equals p_id, in every public table that has such a
-- column, children before parents (worked out from the foreign keys in the catalogue, so a table
-- added by a later migration is handled without touching this function). Runs up to four passes
-- because a delete trigger may write a row back into a table that was already emptied, and
-- raises if anything is left. Returns the number of rows deleted per table.
-- Internal: no API role may execute it.
create or replace function public.sweep_rows_by_column(p_column text, p_id uuid, p_skip text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tables text[];
  v_remaining text[];
  v_pick text;
  v_rows bigint;
  v_left bigint;
  v_counts jsonb := '{}'::jsonb;
  v_pass int;
begin
  if p_id is null or p_column is null then
    raise exception 'sweep_rows_by_column needs a column and an id';
  end if;

  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
  into v_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.oid
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and a.attname = p_column
    and a.atttypid = 'uuid'::regtype
    and a.attnum > 0
    and not a.attisdropped
    and c.relname::text <> all (coalesce(p_skip, '{}'));

  for v_pass in 1..4 loop
    v_remaining := v_tables;
    while coalesce(cardinality(v_remaining), 0) > 0 loop
      -- A table nothing else in the remaining set points at: its rows can go now.
      select t into v_pick
      from unnest(v_remaining) t
      where not exists (
        select 1
        from pg_catalog.pg_constraint k
        where k.contype = 'f'
          and k.confrelid = format('public.%I', t)::regclass
          and k.conrelid <> k.confrelid
          and k.conrelid in (select format('public.%I', r)::regclass from unnest(v_remaining) r)
      )
      order by t
      limit 1;
      if v_pick is null then
        -- A cycle of foreign keys: take the first and let the constraints decide.
        v_pick := v_remaining[1];
      end if;

      execute format('delete from public.%I where %I = $1', v_pick, p_column) using p_id;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_counts := v_counts || jsonb_build_object(v_pick, coalesce((v_counts ->> v_pick)::bigint, 0) + v_rows);
      end if;
      v_remaining := array_remove(v_remaining, v_pick);
      v_pick := null;
    end loop;

    v_left := 0;
    foreach v_pick in array v_tables loop
      execute format('select count(*) from public.%I where %I = $1', v_pick, p_column) into v_rows using p_id;
      v_left := v_left + v_rows;
    end loop;
    v_pick := null;
    exit when v_left = 0;
  end loop;

  if v_left > 0 then
    raise exception 'Rows are still left after deleting by % (% rows). Nothing was deleted.', p_column, v_left;
  end if;

  return v_counts;
end;
$$;

revoke all on function public.sweep_rows_by_column(text, uuid, text[]) from public, anon, authenticated;

-- An in-app note to one person, written directly. enqueue_notification() never tells someone
-- about what they did themselves; the two notices here (you transferred ownership, you closed
-- the club) are records the person should keep, so they bypass that rule on purpose.
create or replace function public.notify_account_record(p_tenant_id uuid, p_user_id uuid, p_event_type text, p_subject text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_events (tenant_id, recipient_user_id, channel, event_type, subject, body, status, metadata)
  values (p_tenant_id, p_user_id, 'in-app', p_event_type, left(p_subject, 200), nullif(left(coalesce(p_body, ''), 1000), ''), 'pending', '{}'::jsonb);
exception
  when others then
    raise warning 'notify_account_record(%) failed: %', p_event_type, sqlerrm;
end;
$$;

revoke all on function public.notify_account_record(uuid, uuid, text, text, text) from public, anon, authenticated;

-- 0b. Letting go of a deleted account --------------------------------------------------------------
-- Authorship columns (created_by_user_id, author_user_id, marked_by_user_id ...) point at
-- auth.users with "on delete set null", so deleting an account should simply blank them. It did
-- not: several BEFORE UPDATE triggers pin those columns to their old value or stamp them with
-- auth.uid() (plan_templates, exercise_library, coach_athlete_notes, athlete_goals,
-- athlete_attendance, athlete_lift_maxes ...), which turned the "set null" back into the deleted
-- user's id and made the delete fail with a foreign key error. That blocked ANY deletion of a
-- coach's account, in the app or from the Supabase dashboard.
-- The fix leaves those triggers alone. One more BEFORE UPDATE trigger, named so it runs last,
-- blanks every auth.users reference that still holds an account being deleted in this
-- transaction (the delete functions list the ids in the transaction setting
-- sktr.deleting_users). Outside such a transaction it returns at once.
create or replace function public.release_deleted_account_references()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_setting text := nullif(current_setting('sktr.deleting_users', true), '');
  v_ids text[];
  v_row jsonb;
  v_col text;
  v_patch jsonb := '{}'::jsonb;
begin
  if v_setting is null then
    return new;
  end if;
  v_ids := string_to_array(v_setting, ',');
  v_row := to_jsonb(new);
  foreach v_col in array tg_argv loop
    if (v_row ->> v_col) = any (v_ids) then
      v_patch := v_patch || jsonb_build_object(v_col, null);
    end if;
  end loop;
  if v_patch = '{}'::jsonb then
    return new;
  end if;
  -- A template keeps a copy of its author's name: it goes with the account.
  if tg_table_name = 'plan_templates' and v_patch ? 'created_by_user_id' then
    v_patch := v_patch || jsonb_build_object('created_by_name', 'A former coach');
  end if;
  return jsonb_populate_record(new, v_patch);
end;
$$;

revoke all on function public.release_deleted_account_references() from public, anon, authenticated;

-- Puts that trigger on every public table that has a "set null" foreign key to auth.users,
-- worked out from the catalogue. Run again by any later migration that adds such a column:
--   select public.install_deleted_account_triggers();
create or replace function public.install_deleted_account_triggers()
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select k.conrelid::regclass as tbl, string_agg(distinct quote_literal(a.attname), ', ') as cols
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid = k.conrelid
    join pg_catalog.pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
    where k.contype = 'f'
      and k.confrelid = 'auth.users'::regclass
      and k.confdeltype = 'n'
      and c.relnamespace = 'public'::regnamespace
      and c.relkind = 'r'
    group by k.conrelid
  loop
    execute format('drop trigger if exists zz_release_deleted_account on %s', v_row.tbl);
    execute format(
      'create trigger zz_release_deleted_account before update on %s for each row execute function public.release_deleted_account_references(%s)',
      v_row.tbl, v_row.cols
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.install_deleted_account_triggers() from public, anon, authenticated;

do $$ begin perform public.install_deleted_account_triggers(); end $$;

-- 1. Files to remove from storage -----------------------------------------------------------------

create table if not exists public.storage_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  object_path text not null,
  reason text not null,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  done_at timestamptz,
  unique (bucket_id, object_path)
);

comment on table public.storage_deletion_queue is
  'Files (profile photos, club logos) left behind by a deleted account or club. SQL cannot remove storage files; the edge function purge-deleted-storage does, with the Storage API. Holds paths only, never names.';

alter table public.storage_deletion_queue enable row level security;
revoke all on public.storage_deletion_queue from public, anon, authenticated;
grant all on public.storage_deletion_queue to service_role;

drop policy if exists storage_deletion_queue_select_platform_admin on public.storage_deletion_queue;
create policy storage_deletion_queue_select_platform_admin
on public.storage_deletion_queue
for select
to authenticated
using (public.is_platform_admin());
grant select on public.storage_deletion_queue to authenticated;

create or replace function public.queue_storage_deletion(p_bucket_id text, p_object_path text, p_reason text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.storage_deletion_queue (bucket_id, object_path, reason)
  select p_bucket_id, p_object_path, coalesce(p_reason, 'deleted')
  where nullif(btrim(coalesce(p_bucket_id, '')), '') is not null
    and nullif(btrim(coalesce(p_object_path, '')), '') is not null
  on conflict (bucket_id, object_path) do update
  set done_at = null, last_error = null, queued_at = now(), reason = excluded.reason
$$;

revoke all on function public.queue_storage_deletion(text, text, text) from public, anon, authenticated;

-- Every file a user owns in the avatars bucket ("<user id>/<file>"), from the photo record and
-- from the bucket listing (reading storage.objects is allowed; deleting from it is not).
create or replace function public.queue_user_storage_deletion(p_user_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_path text;
begin
  if p_user_id is null then
    return 0;
  end if;
  for v_path in
    select aa.avatar_path from public.account_avatars aa where aa.user_id = p_user_id
    union
    select o.name from storage.objects o where o.bucket_id = 'avatars' and o.name like p_user_id::text || '/%'
  loop
    perform public.queue_storage_deletion('avatars', v_path, p_reason);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.queue_user_storage_deletion(uuid, text) from public, anon, authenticated;

-- The edge function takes a batch, removes the files and reports back. Service role only.
create or replace function public.claim_storage_deletions(p_limit integer default 100)
returns table (id uuid, bucket_id text, object_path text)
language sql
security definer
set search_path = public
as $$
  update public.storage_deletion_queue q
  set attempts = q.attempts + 1
  where q.id in (
    select q2.id
    from public.storage_deletion_queue q2
    where q2.done_at is null and q2.attempts < 10
    order by q2.queued_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  )
  returning q.id, q.bucket_id, q.object_path
$$;

revoke all on function public.claim_storage_deletions(integer) from public, anon, authenticated;
grant execute on function public.claim_storage_deletions(integer) to service_role;

create or replace function public.finish_storage_deletion(p_id uuid, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.storage_deletion_queue q
  set done_at = case when p_error is null then now() else null end,
      last_error = left(p_error, 500)
  where q.id = p_id
$$;

revoke all on function public.finish_storage_deletion(uuid, text) from public, anon, authenticated;
grant execute on function public.finish_storage_deletion(uuid, text) to service_role;

-- Asks the edge function to work through the queue. Same mechanics and the same shared secret as
-- request_notification_email_dispatch (20261007090000): the function address is the one the
-- database already knows, with the function name swapped. Never raises.
--   'idle' nothing waiting, 'no_pg_net', 'no_url', 'requested', 'error: ...'
create or replace function public.request_storage_purge(p_source text default 'manual')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config public.notification_dispatch_config%rowtype;
  v_url text;
begin
  if not exists (select 1 from public.storage_deletion_queue q where q.done_at is null and q.attempts < 10) then
    return 'idle';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return 'no_pg_net';
  end if;
  select * into v_config from public.notification_dispatch_config c where c.id;
  if not found or v_config.function_url is null or v_config.function_url !~ '/dispatch-notification-emails/?$' then
    return 'no_url';
  end if;
  v_url := regexp_replace(v_config.function_url, '/dispatch-notification-emails/?$', '/purge-deleted-storage');

  execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := $4)'
  using
    v_url,
    jsonb_build_object('source', coalesce(p_source, 'manual')),
    jsonb_build_object('Content-Type', 'application/json', 'x-sktr-scheduler-token', v_config.scheduler_token),
    30000;
  return 'requested';
exception
  when others then
    return 'error: ' || sqlerrm;
end;
$$;

revoke all on function public.request_storage_purge(text) from public, anon, authenticated;
grant execute on function public.request_storage_purge(text) to service_role;

-- 2. Club owner ----------------------------------------------------------------------------------

create table if not exists public.club_owners (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  since timestamptz not null default now(),
  set_by_user_id uuid references auth.users(id) on delete set null
);

comment on table public.club_owners is
  'The one owner of a club: the club admin who can transfer ownership, close the club and manage other club admins. A club with no row is owned by its longest standing active club admin (club_owner_user_id). Written only by transfer_club_ownership.';

alter table public.club_owners enable row level security;
revoke all on public.club_owners from public, anon, authenticated;
grant select on public.club_owners to authenticated;
grant all on public.club_owners to service_role;

drop policy if exists club_owners_select_staff on public.club_owners;
create policy club_owners_select_staff
on public.club_owners
for select
to authenticated
using (tenant_id = public.current_tenant_id() and public.is_coach_or_admin());

-- The owner of a club. The recorded owner while they are still an active club admin of that
-- club; otherwise (and for every club that never transferred ownership) the active club admin
-- who has been in the club longest. Null only for a club with no active club admin.
create or replace function public.club_owner_user_id(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select co.owner_user_id
      from public.club_owners co
      join public.profiles p
        on p.user_id = co.owner_user_id
       and p.tenant_id = co.tenant_id
       and p.role = 'club-admin'
       and p.is_active
      where co.tenant_id = p_tenant_id
    ),
    (
      select p.user_id
      from public.profiles p
      where p.tenant_id = p_tenant_id
        and p.role = 'club-admin'
        and p.is_active
      order by p.created_at, p.user_id
      limit 1
    )
  )
$$;

revoke all on function public.club_owner_user_id(uuid) from public, anon, authenticated;

-- Second lock on profiles, whoever writes them (set_tenant_member_access, remove_tenant_member,
-- accept_coach_invite, a policy): a signed-in member cannot remove, turn off or change the role
-- of the club owner, and only the owner can do that to another club admin. A person acting on
-- their own row (deleting their own account) is judged by the function they call. The service
-- role, the scheduler and platform admins are not members and pass.
create or replace function public.guard_club_owner_and_admins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null or public.is_platform_admin() then
    return coalesce(new, old);
  end if;
  if old.role <> 'club-admin' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE'
     and new.role = old.role
     and new.is_active = old.is_active
     and new.tenant_id = old.tenant_id then
    return new;
  end if;
  -- Being switched back on is not a removal.
  if tg_op = 'UPDATE' and new.role = old.role and new.tenant_id = old.tenant_id and new.is_active and not old.is_active then
    return new;
  end if;

  v_owner := public.club_owner_user_id(old.tenant_id);

  if v_owner is not null and old.user_id = v_owner then
    raise exception 'The club owner cannot be removed, turned off or given another role. Transfer ownership to another club admin first.'
      using errcode = 'P0001', hint = 'club_owner_protected';
  end if;

  if auth.uid() <> old.user_id and v_owner is not null and auth.uid() <> v_owner then
    raise exception 'Only the club owner can remove, turn off or change the role of another club admin.'
      using errcode = 'P0001', hint = 'club_owner_only';
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_club_owner_and_admins() from public, anon, authenticated;

drop trigger if exists guard_club_owner_and_admins on public.profiles;
create trigger guard_club_owner_and_admins
before update or delete on public.profiles
for each row
execute function public.guard_club_owner_and_admins();

-- Who owns the caller's club. Club admins also get the admins ownership could go to.
create or replace function public.get_club_ownership()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_owner uuid;
  v_admins jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_tenant is null or not public.is_coach_or_admin() then
    return null;
  end if;
  v_owner := public.club_owner_user_id(v_tenant);

  if public.is_club_admin() then
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', p.user_id,
             'name', coalesce(nullif(btrim(p.display_name), ''), au.email, 'Club admin'),
             'email', au.email
           ) order by coalesce(nullif(btrim(p.display_name), ''), au.email)), '[]'::jsonb)
    into v_admins
    from public.profiles p
    join auth.users au on au.id = p.user_id
    where p.tenant_id = v_tenant
      and p.role = 'club-admin'
      and p.is_active
      and p.user_id is distinct from v_owner;
  end if;

  return jsonb_build_object(
    'club_name', public.club_display_name(v_tenant),
    'owner_user_id', v_owner,
    'owner_name', (
      select coalesce(nullif(btrim(p.display_name), ''), 'Club admin')
      from public.profiles p where p.user_id = v_owner
    ),
    'is_owner', v_owner is not null and v_owner = auth.uid(),
    'other_admins', v_admins
  );
end;
$$;

revoke all on function public.get_club_ownership() from public, anon;
grant execute on function public.get_club_ownership() to authenticated, service_role;

-- Hands the club to another active club admin of the same club. Owner only. The caller types
-- the club's name. The old owner stays a club admin.
create or replace function public.transfer_club_ownership(p_new_owner_user_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_club text;
  v_new public.profiles%rowtype;
  v_old_name text;
  v_new_name text;
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  if v_tenant is null or not public.is_club_admin() then
    raise exception 'Only the club owner can transfer ownership.' using errcode = 'P0001', hint = 'club_owner_only';
  end if;

  -- Same lock as the member functions, so two changes to the club's admins cannot interleave.
  perform 1 from public.profiles p where p.tenant_id = v_tenant and p.role = 'club-admin' order by p.user_id for update;

  if public.club_owner_user_id(v_tenant) is distinct from auth.uid() then
    raise exception 'Only the club owner can transfer ownership.' using errcode = 'P0001', hint = 'club_owner_only';
  end if;
  if p_new_owner_user_id is null or p_new_owner_user_id = auth.uid() then
    raise exception 'Choose another club admin to hand the club to.' using errcode = 'P0001', hint = 'transfer_target';
  end if;

  select * into v_new
  from public.profiles p
  where p.user_id = p_new_owner_user_id and p.tenant_id = v_tenant;
  if not found or v_new.role <> 'club-admin' or not v_new.is_active then
    raise exception 'The new owner must be an active club admin of this club.' using errcode = 'P0001', hint = 'transfer_target';
  end if;

  v_club := public.club_display_name(v_tenant);
  if public.confirm_text_key(p_confirm_name) is distinct from public.confirm_text_key(v_club) then
    raise exception 'Type the club''s name exactly to transfer ownership.' using errcode = 'P0001', hint = 'confirm_mismatch';
  end if;

  insert into public.club_owners (tenant_id, owner_user_id, since, set_by_user_id)
  values (v_tenant, v_new.user_id, now(), auth.uid())
  on conflict (tenant_id) do update
  set owner_user_id = excluded.owner_user_id, since = excluded.since, set_by_user_id = excluded.set_by_user_id;

  select coalesce(nullif(btrim(p.display_name), ''), 'A club admin') into v_old_name from public.profiles p where p.user_id = auth.uid();
  v_new_name := coalesce(nullif(btrim(v_new.display_name), ''), 'a club admin');

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_tenant, auth.uid(), 'club-admin', 'club_ownership_transferred', v_new_name,
          format('%s handed the club to %s', v_old_name, v_new_name));

  perform public.enqueue_notification(
    v_tenant, v_new.user_id, 'club_ownership_transferred',
    format('You now own %s on SKTR Coach', v_club),
    format('%s made you the club owner. You can now transfer ownership, close the club and manage the other club admins.', v_old_name),
    '{}'::jsonb, array['in-app', 'email'], 'club_owner:' || v_tenant::text, interval '1 minute'
  );
  perform public.notify_account_record(
    v_tenant, auth.uid(), 'club_ownership_transferred',
    format('You handed %s to %s', v_club, v_new_name),
    'You are still a club admin. Only the owner can transfer ownership, close the club or manage club admins.'
  );
end;
$$;

revoke all on function public.transfer_club_ownership(uuid, text) from public, anon;
grant execute on function public.transfer_club_ownership(uuid, text) to authenticated, service_role;

-- 3. Export audit ---------------------------------------------------------------------------------
-- Records that an export was made. Never the content. 'personal' is anyone's own data, 'club' is
-- the whole club export and needs a club admin.
create or replace function public.record_data_export(p_kind text, p_include_health boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_role text;
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_kind not in ('personal', 'club') then
    raise exception 'Unknown export' using errcode = '22023';
  end if;

  v_tenant := public.current_tenant_id();
  v_role := public.current_app_role();

  if p_kind = 'club' then
    if v_tenant is null or not public.is_club_admin() then
      raise exception 'Only a club admin can export the club''s data.' using errcode = '42501';
    end if;
    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (v_tenant, auth.uid(), 'club-admin', 'club_data_exported', 'club',
            case when coalesce(p_include_health, false) then 'whole club export, health data included' else 'whole club export, without health data' end);
    return;
  end if;

  if v_tenant is not null then
    insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
    values (v_tenant, auth.uid(), coalesce(v_role, 'member'), 'personal_data_exported', coalesce(v_role, 'member'), 'downloaded a copy of their own data');
  elsif public.is_platform_admin() then
    perform public.insert_platform_audit_event(
      p_actor_user_id := auth.uid(),
      p_actor_email := auth.jwt() ->> 'email',
      p_actor_role := 'platform-admin',
      p_action := 'personal_data_exported',
      p_target := 'platform admin',
      p_detail := 'Downloaded a copy of their own data.',
      p_metadata := '{}'::jsonb
    );
  end if;
end;
$$;

revoke all on function public.record_data_export(text, boolean) from public, anon;
grant execute on function public.record_data_export(text, boolean) to authenticated, service_role;

-- 4. Names of people who are gone -----------------------------------------------------------------
-- Same function as 20261010090000 with one addition: a sender whose account no longer exists
-- (messages.sender_user_id and message_threads.coach_user_id are set to null when the account is
-- deleted) is shown as "Deleted account". The messages themselves stay, so the other person keeps
-- their conversation and club admins can still read a reported one.
create or replace function public.message_member_name(p_user_id uuid, p_fallback text default 'Coach')
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is null then 'Deleted account'
    else coalesce(
      (
        select nullif(left(btrim(regexp_replace(coalesce(p.display_name, ''), '\s+', ' ', 'g')), 80), '')
        from public.profiles p
        where p.user_id = p_user_id
      ),
      (
        select nullif(left(btrim(regexp_replace(coalesce(rm.display_name, ''), '\s+', ' ', 'g')), 80), '')
        from public.removed_members rm
        where rm.user_id = p_user_id
        order by rm.removed_at desc
        limit 1
      ),
      p_fallback
    )
  end
$$;

revoke all on function public.message_member_name(uuid, text) from public, anon, authenticated;

-- 5. Deleting your own account --------------------------------------------------------------------

-- What stands in the way, per role. Read by the screen and checked again by delete_my_account.
--   role             athlete | coach | club-admin | platform-admin | none
--   can_delete       boolean
--   reason           null | 'platform_admin' | 'club_owner' | 'teams'
--   blocking_teams   [{ team_id, team_name, reason: 'lead' | 'only_coach', athletes }]
--   email            what has to be typed to confirm
create or replace function public.get_my_account_deletion_check()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_email text;
  v_teams jsonb := '[]'::jsonb;
  v_reason text;
begin
  if v_uid is null then
    return null;
  end if;
  select lower(btrim(au.email)) into v_email from auth.users au where au.id = v_uid;

  if public.is_platform_admin() then
    return jsonb_build_object('role', 'platform-admin', 'can_delete', false, 'reason', 'platform_admin', 'blocking_teams', v_teams, 'email', v_email);
  end if;

  select * into v_profile from public.profiles p where p.user_id = v_uid;
  if not found then
    return jsonb_build_object('role', 'none', 'can_delete', true, 'reason', null, 'blocking_teams', v_teams, 'email', v_email);
  end if;

  if v_profile.role in ('coach', 'club-admin') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'team_id', x.team_id, 'team_name', x.team_name, 'reason', x.reason, 'athletes', x.athletes
           ) order by x.team_name), '[]'::jsonb)
    into v_teams
    from (
      select
        t.id as team_id,
        t.name as team_name,
        case when tc.is_primary then 'lead' else 'only_coach' end as reason,
        (select count(*) from public.athletes a where a.team_id = t.id and a.is_active) as athletes
      from public.team_coaches tc
      join public.teams t on t.id = tc.team_id and t.tenant_id = tc.tenant_id
      where tc.user_id = v_uid
        and tc.tenant_id = v_profile.tenant_id
        and not coalesce(t.is_archived, false)
        and (
          tc.is_primary
          or (
            exists (select 1 from public.athletes a where a.team_id = t.id and a.is_active)
            and not exists (
              select 1
              from public.team_coaches other
              join public.profiles op on op.user_id = other.user_id and op.tenant_id = other.tenant_id and op.is_active
              where other.team_id = t.id and other.user_id <> v_uid
            )
          )
        )
    ) x;
  end if;

  v_reason := case
    when v_profile.role = 'club-admin' and public.club_owner_user_id(v_profile.tenant_id) = v_uid then 'club_owner'
    when jsonb_array_length(v_teams) > 0 then 'teams'
    else null
  end;

  return jsonb_build_object(
    'role', v_profile.role,
    'can_delete', v_reason is null,
    'reason', v_reason,
    'blocking_teams', v_teams,
    'email', v_email
  );
end;
$$;

revoke all on function public.get_my_account_deletion_check() from public, anon;
grant execute on function public.get_my_account_deletion_check() to authenticated, service_role;

-- Removes everything recorded about one athlete. Internal (delete_my_account calls it); the club
-- admin's delete_athlete_and_data (20261010090000) is the model and stays as it is.
-- Every table with an athlete_id column is emptied for this athlete, found from the catalogue.
-- Conversations are the one thing the club must keep: when the athlete has message threads, the
-- threads and their messages stay (for the coach, and so club admins can still read a reported
-- conversation) on an athlete record that is stripped to a stub named "Deleted account" with no
-- login, no team, no date of birth and no events. A club admin can remove that stub and its
-- conversations for good with delete_athlete_and_data. Without threads the record goes too.
-- Returns true when a stub was kept.
create or replace function public.purge_athlete_personal_data(p_athlete_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete public.athletes%rowtype;
  v_keep boolean;
begin
  select * into v_athlete from public.athletes a where a.id = p_athlete_id for update;
  if not found then
    return false;
  end if;

  v_keep := exists (
    select 1
    from public.message_threads mt
    join public.messages m on m.thread_id = mt.id
    where mt.athlete_id = v_athlete.id
  );

  delete from public.competitions c where c.owner_athlete_id = v_athlete.id;
  delete from public.notification_events ne
  where ne.tenant_id = v_athlete.tenant_id
    and ne.metadata ->> 'athlete_id' = v_athlete.id::text;

  if v_keep then
    perform public.sweep_rows_by_column('athlete_id', v_athlete.id, array['message_threads']);
    update public.athletes
    set first_name = 'Deleted',
        last_name = 'account',
        user_id = null,
        team_id = null,
        date_of_birth = null,
        event_group = null,
        primary_event = null,
        readiness = null,
        is_active = false,
        login_linked_at = null,
        updated_at = now()
    where id = v_athlete.id;
  else
    perform public.sweep_rows_by_column('athlete_id', v_athlete.id, '{}');
    delete from public.athletes a where a.id = v_athlete.id;
  end if;

  return v_keep;
end;
$$;

revoke all on function public.purge_athlete_personal_data(uuid) from public, anon, authenticated;

-- Deletes the caller's own account: their personal data and their login. The caller types their
-- sign-in email. One transaction: if anything fails nothing is deleted.
--   Athlete     everything recorded about them (see purge_athlete_personal_data). The coaches
--               of their team are told.
--   Coach       refused while they lead a team or are the only coach of a team with athletes
--               (get_my_account_deletion_check lists the teams). Their plans, templates,
--               exercises, notes and results they entered stay with the club; the foreign keys
--               set the author to null, which the app shows as "A former coach" (section 0b
--               makes that work past the triggers that pin authorship).
--   Club admin  the same team rule, and refused for the club owner.
--   Platform admin  refused: not available in the app.
-- Messages they sent stay in the other person's conversation, shown as from "Deleted account".
-- Entries about them in the club's activity log lose their name and email. Their photo file is
-- queued for removal from storage.
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

-- 6. Closing a club -------------------------------------------------------------------------------

create table if not exists public.club_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  club_name text not null,
  closed_at timestamptz not null default now(),
  closed_by_user_id uuid references auth.users(id) on delete set null,
  delete_after timestamptz not null,
  previous_lifecycle_status text,
  reopened_at timestamptz,
  reopened_by_user_id uuid references auth.users(id) on delete set null,
  reopen_note text
);

-- A club is closed while it has a row that was not reopened. At most one.
create unique index if not exists club_closures_one_open_idx
on public.club_closures (tenant_id)
where reopened_at is null;

comment on table public.club_closures is
  'A club closed by its owner. While reopened_at is null the club is closed and is deleted for good after delete_after (90 days). Written only by close_current_club, reopen_closed_club and the lifecycle trigger.';

alter table public.club_closures enable row level security;
revoke all on public.club_closures from public, anon, authenticated;
grant select on public.club_closures to authenticated;
grant all on public.club_closures to service_role;

drop policy if exists club_closures_select_platform_admin on public.club_closures;
create policy club_closures_select_platform_admin
on public.club_closures
for select
to authenticated
using (public.is_platform_admin());

create or replace function public.club_is_closed(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_closures cc where cc.tenant_id = p_tenant_id and cc.reopened_at is null
  )
$$;

revoke all on function public.club_is_closed(uuid) from public, anon, authenticated;

-- Why a locked out member is locked out: null unless their own club is closed. Open to a member
-- of a closed club on purpose (nothing else answers them).
create or replace function public.get_current_club_closure()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'club_name', cc.club_name,
    'closed_at', cc.closed_at,
    'delete_after', cc.delete_after,
    'closed_by_you', cc.closed_by_user_id = auth.uid()
  )
  from public.profiles me
  join public.club_closures cc on cc.tenant_id = me.tenant_id and cc.reopened_at is null
  where me.user_id = auth.uid()
  limit 1
$$;

revoke all on function public.get_current_club_closure() from public, anon;
grant execute on function public.get_current_club_closure() to authenticated, service_role;

-- Same function as 20261007090000 with one change: a club that its owner closed gets the
-- "club closed" notice from close_current_club, not the "access is paused, nothing has been
-- deleted" email, which would be wrong for a club that is about to be deleted.
create or replace function public.enqueue_club_lifecycle_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_user_id uuid;
  v_club_name text;
  v_event_type text;
begin
  if new.provisioned_tenant_id is null or new.lifecycle_status is not distinct from old.lifecycle_status then
    return new;
  end if;

  if new.lifecycle_status = 'suspended' then
    if public.club_is_closed(new.provisioned_tenant_id) then
      return new;
    end if;
    v_event_type := 'club_suspended';
  elsif old.lifecycle_status = 'suspended' and new.lifecycle_status in ('active', 'active_onboarding') then
    v_event_type := 'club_reactivated';
  else
    return new;
  end if;

  -- Only the club's latest provisioning record decides its access (same rule as the row policies).
  if exists (
    select 1
    from public.tenant_provision_requests newer
    where newer.provisioned_tenant_id = new.provisioned_tenant_id
      and newer.created_at > new.created_at
  ) then
    return new;
  end if;

  select t.name into v_club_name from public.tenants t where t.id = new.provisioned_tenant_id;
  v_club_name := coalesce(nullif(left(btrim(coalesce(v_club_name, new.organization_name, '')), 80), ''), 'your club');

  for v_admin_user_id in select public.notification_club_admin_user_ids(new.provisioned_tenant_id)
  loop
    if v_event_type = 'club_suspended' then
      perform public.enqueue_notification(
        new.provisioned_tenant_id,
        v_admin_user_id,
        'club_suspended',
        format('Access to SKTR Coach is paused for %s', v_club_name),
        'Coaches and athletes cannot use the club in SKTR Coach until access is turned back on. Nothing has been deleted. Contact SKTR Coach support if you have questions.',
        jsonb_build_object('tenant_provision_request_id', new.id::text, 'lifecycle_status', new.lifecycle_status),
        array['email'],
        'club_lifecycle:' || new.provisioned_tenant_id::text || ':suspended',
        interval '10 minutes',
        true
      );
    else
      perform public.enqueue_notification(
        new.provisioned_tenant_id,
        v_admin_user_id,
        'club_reactivated',
        format('Access to SKTR Coach is back on for %s', v_club_name),
        'Coaches and athletes can sign in again. Everything is as you left it.',
        jsonb_build_object('tenant_provision_request_id', new.id::text, 'lifecycle_status', new.lifecycle_status),
        array['in-app', 'email'],
        'club_lifecycle:' || new.provisioned_tenant_id::text || ':reactivated',
        interval '10 minutes'
      );
    end if;
  end loop;

  return new;
end;
$$;

-- A closed club whose access is turned back on by ANY route (reopen_closed_club, or a platform
-- admin moving the lifecycle with the existing controls) stops being closed in the same
-- statement, so its deletion date can never outlive its closure. Fires before the notification
-- trigger above (triggers run in name order), which then sends "access is back on".
create or replace function public.club_closure_follow_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.provisioned_tenant_id is null then
    return new;
  end if;
  if old.lifecycle_status in ('suspended', 'cancelled')
     and (new.lifecycle_status is null or new.lifecycle_status not in ('suspended', 'cancelled')) then
    update public.club_closures cc
    set reopened_at = now(),
        reopened_by_user_id = auth.uid(),
        reopen_note = coalesce(cc.reopen_note, 'access was turned back on')
    where cc.tenant_id = new.provisioned_tenant_id
      and cc.reopened_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.club_closure_follow_lifecycle() from public, anon, authenticated;

drop trigger if exists club_closure_follow_lifecycle on public.tenant_provision_requests;
create trigger club_closure_follow_lifecycle
after update of lifecycle_status on public.tenant_provision_requests
for each row
execute function public.club_closure_follow_lifecycle();

-- The owner closes the club. Typed club name. Access stops for every member in this statement,
-- nothing is deleted, and the 90 day clock starts. Returns the closure.
create or replace function public.close_current_club(p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_club text;
  v_request public.tenant_provision_requests%rowtype;
  v_closure public.club_closures%rowtype;
  v_admin uuid;
  v_actor_name text;
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  v_tenant := public.current_tenant_id();
  if v_tenant is null or not public.is_club_admin() then
    raise exception 'Only the club owner can close the club.' using errcode = 'P0001', hint = 'club_owner_only';
  end if;

  perform 1 from public.tenants t where t.id = v_tenant for update;
  perform 1 from public.profiles p where p.tenant_id = v_tenant and p.role = 'club-admin' order by p.user_id for update;

  if public.club_owner_user_id(v_tenant) is distinct from auth.uid() then
    raise exception 'Only the club owner can close the club.' using errcode = 'P0001', hint = 'club_owner_only';
  end if;

  v_club := public.club_display_name(v_tenant);
  if public.confirm_text_key(p_confirm_name) is distinct from public.confirm_text_key(v_club) then
    raise exception 'Type the club''s name exactly to close it.' using errcode = 'P0001', hint = 'confirm_mismatch';
  end if;

  select * into v_request
  from public.tenant_provision_requests tpr
  where tpr.provisioned_tenant_id = v_tenant
  order by tpr.created_at desc
  limit 1
  for update;
  if not found then
    -- A club set up by hand, before clubs had a lifecycle record: there is nothing to switch off.
    raise exception 'This club cannot be closed in the app. Email SKTR support and we will close it for you.'
      using errcode = 'P0001', hint = 'close_needs_support';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), 'The club owner') into v_actor_name from public.profiles p where p.user_id = auth.uid();

  -- The closure first: the lifecycle trigger looks for it.
  insert into public.club_closures (tenant_id, club_name, closed_by_user_id, delete_after, previous_lifecycle_status)
  values (v_tenant, v_club, auth.uid(), now() + interval '90 days', v_request.lifecycle_status)
  returning * into v_closure;

  insert into public.audit_events (tenant_id, actor_user_id, actor_role, action, target, detail)
  values (v_tenant, auth.uid(), 'club-admin', 'club_closed', v_club,
          format('closed by the owner, to be deleted after %s', to_char(v_closure.delete_after at time zone 'UTC', 'YYYY-MM-DD')));

  -- Told while the club is still open (the queue takes nobody from a blocked club).
  for v_admin in select public.notification_club_admin_user_ids(v_tenant) loop
    perform public.enqueue_notification(
      v_tenant, v_admin, 'club_closed',
      format('%s has been closed on SKTR Coach', v_club),
      format('%s closed the club. Nobody in the club can sign in now. Everything is deleted for good after %s. To reopen the club before then, email SKTR Coach support.',
             v_actor_name, to_char(v_closure.delete_after at time zone 'UTC', 'FMDD Mon YYYY')),
      '{}'::jsonb, array['email'], 'club_closed:' || v_tenant::text, interval '10 minutes', true
    );
  end loop;

  update public.tenant_provision_requests
  set lifecycle_status = 'suspended',
      previous_lifecycle_status = case when lifecycle_status is distinct from 'suspended' then lifecycle_status else previous_lifecycle_status end
  where id = v_request.id;

  perform public.insert_platform_audit_event(
    p_actor_user_id := auth.uid(),
    p_actor_email := auth.jwt() ->> 'email',
    p_actor_role := 'club-admin',
    p_action := 'club_closed',
    p_target := v_club,
    p_detail := format('Closed by its owner. Deletion date %s.', to_char(v_closure.delete_after at time zone 'UTC', 'YYYY-MM-DD')),
    p_metadata := jsonb_build_object('tenant_id', v_tenant, 'request_id', v_request.id, 'delete_after', v_closure.delete_after)
  );

  return jsonb_build_object('club_name', v_club, 'closed_at', v_closure.closed_at, 'delete_after', v_closure.delete_after);
end;
$$;

revoke all on function public.close_current_club(text) from public, anon;
grant execute on function public.close_current_club(text) to authenticated, service_role;

-- Platform admin: the closed clubs, soonest deletion first.
create or replace function public.get_closed_clubs()
returns table (
  tenant_id uuid,
  club_name text,
  closed_at timestamptz,
  delete_after timestamptz,
  closed_by_name text,
  member_count integer,
  athlete_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can see closed clubs.' using errcode = '42501';
  end if;
  return query
  select
    cc.tenant_id,
    cc.club_name,
    cc.closed_at,
    cc.delete_after,
    (select coalesce(nullif(btrim(p.display_name), ''), 'Club owner') from public.profiles p where p.user_id = cc.closed_by_user_id),
    (select count(*)::int from public.profiles p where p.tenant_id = cc.tenant_id),
    (select count(*)::int from public.athletes a where a.tenant_id = cc.tenant_id)
  from public.club_closures cc
  where cc.reopened_at is null
  order by cc.delete_after;
end;
$$;

revoke all on function public.get_closed_clubs() from public, anon;
grant execute on function public.get_closed_clubs() to authenticated, service_role;

-- Platform admin: reopens a closed club. Access comes back as it was before the club was closed
-- and the deletion date is gone.
create or replace function public.reopen_closed_club(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closure public.club_closures%rowtype;
  v_request public.tenant_provision_requests%rowtype;
  v_back text;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only platform admins can reopen a closed club.' using errcode = '42501';
  end if;

  perform 1 from public.tenants t where t.id = p_tenant_id for update;

  select * into v_closure
  from public.club_closures cc
  where cc.tenant_id = p_tenant_id and cc.reopened_at is null
  for update;
  if not found then
    raise exception 'This club is not closed.' using errcode = 'P0001', hint = 'club_not_closed';
  end if;

  update public.club_closures
  set reopened_at = now(), reopened_by_user_id = auth.uid(), reopen_note = 'reopened by a platform admin'
  where id = v_closure.id;

  select * into v_request
  from public.tenant_provision_requests tpr
  where tpr.provisioned_tenant_id = p_tenant_id
  order by tpr.created_at desc
  limit 1
  for update;

  if found and v_request.lifecycle_status in ('suspended', 'cancelled') then
    v_back := case
      when v_closure.previous_lifecycle_status in ('active', 'active_onboarding', 'approved_pending_billing', 'billing_failed') then v_closure.previous_lifecycle_status
      else 'active'
    end;
    update public.tenant_provision_requests
    set lifecycle_status = v_back, previous_lifecycle_status = null
    where id = v_request.id;
  end if;

  perform public.insert_platform_audit_event(
    p_actor_user_id := auth.uid(),
    p_actor_email := auth.jwt() ->> 'email',
    p_actor_role := 'platform-admin',
    p_action := 'club_reopened',
    p_target := v_closure.club_name,
    p_detail := 'Closed club reopened before its deletion date. Nothing was deleted.',
    p_metadata := jsonb_build_object('tenant_id', p_tenant_id, 'closed_at', v_closure.closed_at, 'delete_after', v_closure.delete_after)
  );
end;
$$;

revoke all on function public.reopen_closed_club(uuid) from public, anon;
grant execute on function public.reopen_closed_club(uuid) to authenticated, service_role;

-- 7. Deleting a club for good ----------------------------------------------------------------------
-- The most dangerous function in the schema. Read this before changing it.
--
-- WHO   A signed-in caller must be an active platform admin AND pass the club's name as typed.
--       A caller with no signed-in user (the scheduler, the service role) is only accepted once
--       the club's deletion date has passed. Members of the club can never call it usefully:
--       they are not platform admins.
-- WHEN  Only for a club that IS closed right now: an open club_closures row (not reopened) AND
--       access still blocked on the club's latest lifecycle record. Both are re-read under a
--       row lock inside the function. A club that was reopened by either route fails both.
-- WHAT  One transaction (a function call is one statement; any error undoes everything):
--         * the paths of the club's logo and of every member's photo go to
--           storage_deletion_queue (SQL cannot delete storage files, see section 1);
--         * every row with this tenant_id in every public table that has a tenant_id column,
--           found from the catalogue, children first (sweep_rows_by_column). Tables without a
--           tenant_id that hang off those (session blocks and rows, plan weeks, days and blocks,
--           test definitions, in-app notification rows) go with their parents through
--           "on delete cascade";
--         * the club's provisioning records (the request it signed up with);
--         * the tenant row;
--         * the login accounts of its members. A profile belongs to exactly one club
--           (profiles.user_id is the primary key), so a member of this club belongs only to it.
--           An account that is also a platform admin is kept.
--       Platform audit entries about the club are kept (they are the platform's own security
--       record) but lose the requester's email address.
-- Returns what was removed. Written to the platform audit log by the function itself.
create or replace function public.delete_closed_club(p_tenant_id uuid, p_confirm_name text default null, p_source text default 'platform-admin')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closure public.club_closures%rowtype;
  v_club text;
  v_users uuid[];
  v_request_ids uuid[];
  v_counts jsonb;
  v_files integer := 0;
  v_user uuid;
  v_path text;
  v_deleted_users integer := 0;
  v_scheduled boolean := auth.uid() is null;
begin
  if p_tenant_id is null then
    raise exception 'A club is required.' using errcode = '22023';
  end if;

  -- 1. The caller.
  if not v_scheduled and not public.is_platform_admin() then
    raise exception 'Only platform admins can delete a club.' using errcode = '42501';
  end if;

  -- 2. The state, under lock.
  perform 1 from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'Club not found.' using errcode = 'P0001', hint = 'club_not_found';
  end if;

  select * into v_closure
  from public.club_closures cc
  where cc.tenant_id = p_tenant_id and cc.reopened_at is null
  for update;
  if not found then
    raise exception 'This club is not closed, so it cannot be deleted.' using errcode = 'P0001', hint = 'club_not_closed';
  end if;

  perform 1 from public.tenant_provision_requests tpr where tpr.provisioned_tenant_id = p_tenant_id for update;
  if not public.tenant_access_blocked(p_tenant_id) then
    raise exception 'This club''s access is on, so it cannot be deleted. Close it first.' using errcode = 'P0001', hint = 'club_not_closed';
  end if;

  v_club := public.club_display_name(p_tenant_id);

  if v_scheduled then
    if v_closure.delete_after > now() then
      raise exception 'This club''s deletion date has not passed.' using errcode = 'P0001', hint = 'club_not_due';
    end if;
  elsif public.confirm_text_key(p_confirm_name) is distinct from public.confirm_text_key(v_club)
        and public.confirm_text_key(p_confirm_name) is distinct from public.confirm_text_key(v_closure.club_name) then
    raise exception 'Type the club''s name exactly to delete it.' using errcode = 'P0001', hint = 'confirm_mismatch';
  end if;

  -- 3. Who and what belongs to it.
  select coalesce(array_agg(distinct u.user_id), '{}')
  into v_users
  from (
    select p.user_id from public.profiles p where p.tenant_id = p_tenant_id
    union
    select a.user_id from public.athletes a where a.tenant_id = p_tenant_id and a.user_id is not null
  ) u
  where not exists (
    select 1
    from public.platform_admin_contacts pac
    left join auth.users au on au.id = u.user_id
    where pac.user_id = u.user_id or lower(pac.email) = lower(au.email)
  )
  -- A login whose profile is in another club is that club's member (an athlete record here that
  -- still points at them is only a leftover link).
  and not exists (
    select 1 from public.profiles other where other.user_id = u.user_id and other.tenant_id <> p_tenant_id
  );

  select coalesce(array_agg(tpr.id), '{}') into v_request_ids
  from public.tenant_provision_requests tpr
  where tpr.provisioned_tenant_id = p_tenant_id;

  -- 4. Files, before the rows that name them are gone.
  for v_path in
    select cp.logo_path from public.club_profiles cp where cp.tenant_id = p_tenant_id and cp.logo_path is not null
    union
    select o.name from storage.objects o where o.bucket_id = 'club-logos' and o.name like p_tenant_id::text || '/%'
  loop
    perform public.queue_storage_deletion('club-logos', v_path, 'club deleted');
    v_files := v_files + 1;
  end loop;
  foreach v_user in array v_users loop
    v_files := v_files + public.queue_user_storage_deletion(v_user, 'club deleted');
  end loop;

  -- 5. Every row of the club.
  v_counts := public.sweep_rows_by_column('tenant_id', p_tenant_id, array['tenants']);

  delete from public.tenant_provision_requests tpr where tpr.provisioned_tenant_id = p_tenant_id;

  update public.platform_audit_events pae
  set metadata = pae.metadata - 'requestor_email'
  where pae.metadata ? 'requestor_email'
    and (
      pae.metadata ->> 'tenant_id' = p_tenant_id::text
      or pae.metadata ->> 'request_id' in (select r::text from unnest(v_request_ids) r)
    );

  delete from public.tenants t where t.id = p_tenant_id;

  -- 6. The logins. A member may have written rows in ANOTHER club before joining this one
  -- (removed there, invited here): those rows let go of them (section 0b).
  perform set_config('sktr.deleting_users', array_to_string(v_users, ','), true);
  delete from auth.users au where au.id = any (v_users);
  get diagnostics v_deleted_users = row_count;

  perform set_config('sktr.deleting_users', '', true);

  perform public.insert_platform_audit_event(
    p_actor_user_id := auth.uid(),
    p_actor_email := auth.jwt() ->> 'email',
    p_actor_role := case when v_scheduled then 'system' else 'platform-admin' end,
    p_action := 'club_deleted',
    p_target := v_club,
    p_detail := case
      when v_scheduled then 'Closed club deleted for good, 90 days after it was closed.'
      else 'Closed club deleted for good by a platform admin.'
    end,
    p_metadata := jsonb_build_object(
      'tenant_id', p_tenant_id,
      'source', coalesce(p_source, 'platform-admin'),
      'closed_at', v_closure.closed_at,
      'delete_after', v_closure.delete_after,
      'accounts_deleted', v_deleted_users,
      'files_queued', v_files,
      'rows_deleted', v_counts
    )
  );

  return jsonb_build_object('club_name', v_club, 'accounts_deleted', v_deleted_users, 'files_queued', v_files, 'rows_deleted', v_counts);
end;
$$;

revoke all on function public.delete_closed_club(uuid, text, text) from public, anon;
grant execute on function public.delete_closed_club(uuid, text, text) to authenticated, service_role;

-- The scheduled job. Deletes every closed club whose date has passed, one at a time, each in its
-- own sub-transaction so one failure does not hold up the rest. It only ever hands
-- delete_closed_club a club that has an open closure and a passed date, and that function checks
-- both again under lock, so a club that is open, was never closed or was reopened cannot be
-- deleted from here. Safe to run as often as you like.
create or replace function public.run_club_deletions(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_deleted integer := 0;
  v_failed integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'The club deletion job is not run by a signed-in user.' using errcode = '42501';
  end if;

  for v_row in
    select cc.tenant_id, cc.club_name
    from public.club_closures cc
    where cc.reopened_at is null
      and cc.delete_after <= least(coalesce(p_now, now()), now())
    order by cc.delete_after
  loop
    begin
      perform public.delete_closed_club(v_row.tenant_id, null, 'schedule');
      v_deleted := v_deleted + 1;
    exception
      when others then
        v_failed := v_failed + 1;
        perform public.insert_platform_audit_event(
          p_actor_user_id := null,
          p_actor_email := null,
          p_actor_role := 'system',
          p_action := 'club_delete_failed',
          p_target := v_row.club_name,
          p_detail := left('The scheduled deletion of this closed club failed and nothing was deleted: ' || sqlerrm, 500),
          p_metadata := jsonb_build_object('tenant_id', v_row.tenant_id)
        );
    end;
  end loop;

  perform public.request_storage_purge('club-deletions');
  return jsonb_build_object('deleted', v_deleted, 'failed', v_failed);
end;
$$;

revoke all on function public.run_club_deletions(timestamptz) from public, anon, authenticated;
grant execute on function public.run_club_deletions(timestamptz) to service_role;

-- 8. Schedule ---------------------------------------------------------------------------------------
-- Once a day. Guarded like 20261011120000: without pg_cron nothing is scheduled and the file
-- still applies (a platform admin can still delete a closed club by hand).
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron is not installed: no club deletion schedule created.';
    return;
  end if;

  begin
    execute 'select cron.unschedule(jobname) from cron.job where jobname = ''sktr-delete-closed-clubs''';
  exception
    when others then
      raise notice 'Could not remove the earlier club deletion schedule (%).', sqlerrm;
  end;

  execute 'select cron.schedule(''sktr-delete-closed-clubs'', ''23 4 * * *'', ''select public.run_club_deletions()'')';
exception
  when others then
    raise notice 'Could not create the club deletion schedule (%). Closed clubs will not be deleted automatically until it exists.', sqlerrm;
end
$$;

-- 9. The tables created above have authorship columns too (section 0b).
do $$ begin perform public.install_deleted_account_triggers(); end $$;

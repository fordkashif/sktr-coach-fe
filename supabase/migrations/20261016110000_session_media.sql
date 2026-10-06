-- Photos and short videos on a session log.
--
-- An athlete attaches a photo or a short video to a session (or to one exercise of it) to show
-- the coach a rep. The coach watches it and can leave one short comment per item.
--
--   1. public.session_media          one row per file: who, which session, which exercise, the
--                                    storage path, size, duration, dimensions, the athlete's
--                                    caption and the coach's comment.
--   2. Storage bucket session-media  PRIVATE. Paths are <tenant>/<athlete>/<session>/<file>.
--                                    Files are only ever viewed through short lived signed
--                                    links; there is no public address.
--   3. Who can do what
--        the athlete            reads, adds, captions and removes their own
--        lead coach, coach      read; comment (set_session_media_comment)
--        assistant coach        reads, because an assistant sees the training of athletes on
--                               their teams (is_staff_of_athlete, 20261015090000); no comment
--        any of those staff     may add an item while logging a session FOR an athlete (the same
--                               people who may write session_row_logs for them), and remove
--                               what they added themselves
--        club admin             reads, comments and may remove (to take down something that
--                               should not be there)
--        everyone else          nothing: other athletes, coaches of other teams, other clubs.
--        Guardians are NOT given access here. That is a separate decision.
--   4. Limits, enforced in the database as well as in the app: 6 items per session, 200 per
--      athlete, 50 MB per file, videos at most 30 seconds.
--   5. Removing files. SQL cannot remove a storage file, so every deleted session_media row
--      writes its path to storage_deletion_queue (20261014120000) and asks the edge function
--      purge-deleted-storage to work through it. That one trigger covers every way a row goes:
--      the athlete removes an item, a session is deleted, an athlete's data or account is
--      deleted (purge_athlete_personal_data sweeps by athlete_id), a club is deleted
--      (delete_closed_club sweeps by tenant_id). A daily job also queues files in the bucket
--      that no row names (an upload whose record never got saved).
--   6. The coach's comment tells the athlete through the EXISTING session note notification
--      (event type session_note_added), so it follows the athlete's existing choices.
--
-- Idempotent: create table if not exists, create or replace function, drop policy / trigger if
-- exists before create. Applying it twice changes nothing.

-- 1. Table ------------------------------------------------------------------------------------------

create table if not exists public.session_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  -- The exercise it belongs to. Null: it is about the whole session.
  session_block_row_id uuid references public.session_block_rows(id) on delete set null,
  kind text not null,
  storage_path text not null,
  content_type text not null,
  bytes bigint not null,
  duration_seconds numeric(6, 2),
  width integer,
  height integer,
  caption text,
  coach_comment text,
  coach_comment_by_user_id uuid references auth.users(id) on delete set null,
  coach_comment_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_media_kind_check check (kind in ('photo', 'video')),
  constraint session_media_bytes_check check (bytes > 0 and bytes <= 52428800),
  constraint session_media_type_check check (
    (kind = 'photo' and content_type in ('image/jpeg', 'image/webp'))
    or (kind = 'video' and content_type in ('video/mp4', 'video/quicktime', 'video/webm'))
  ),
  -- Half a second of slack: a phone rounds a "30 second" clip either way.
  constraint session_media_duration_check check (
    (kind = 'photo' and duration_seconds is null)
    or (kind = 'video' and duration_seconds is not null and duration_seconds > 0 and duration_seconds <= 30.5)
  ),
  constraint session_media_size_check check ((width is null or (width > 0 and width <= 8192)) and (height is null or (height > 0 and height <= 8192))),
  constraint session_media_caption_check check (caption is null or char_length(caption) <= 200),
  constraint session_media_comment_check check (coach_comment is null or char_length(coach_comment) <= 500)
);

create unique index if not exists session_media_storage_path_key on public.session_media (storage_path);
create index if not exists session_media_session_idx on public.session_media (session_id, created_at);
create index if not exists session_media_athlete_idx on public.session_media (athlete_id, created_at desc);
create index if not exists session_media_tenant_idx on public.session_media (tenant_id);

comment on table public.session_media is
  'Photos and short videos an athlete attached to a session log. Training content, treated as personal: the files sit in the private bucket session-media and are viewed through short lived signed links only.';

-- 2. Paths ------------------------------------------------------------------------------------------

-- "<tenant>/<athlete>/<session>/<file id>.<ext>". Anything else gives no row, so a policy that
-- uses this never has to cast text it has not checked.
create or replace function public.session_media_path_parts(p_name text)
returns table (tenant_id uuid, athlete_id uuid, session_id uuid)
language sql
immutable
set search_path = public
as $$
  select m[1]::uuid, m[2]::uuid, m[3]::uuid
  from regexp_match(
    coalesce(p_name, ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp|mp4|mov|webm)$'
  ) m
$$;

-- May the caller see media of this athlete? The one rule, used by the table and by the bucket.
create or replace function public.can_view_session_media_of(p_tenant_id uuid, p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_tenant_id is not null
    and p_athlete_id is not null
    and p_tenant_id = public.current_tenant_id()
    and exists (select 1 from public.athletes a where a.id = p_athlete_id and a.tenant_id = p_tenant_id)
    and (
      p_athlete_id = public.current_athlete_id()
      or public.is_club_admin()
      or public.is_staff_of_athlete(p_athlete_id)
    )
$$;

create or replace function public.can_read_session_media_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_view_session_media_of(p.tenant_id, p.athlete_id)
    from public.session_media_path_parts(p_name) p
  ), false)
$$;

-- Upload: the athlete into their own folder, or staff logging a session for the athlete. The
-- session in the path must be that athlete's.
create or replace function public.can_add_session_media_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_view_session_media_of(p.tenant_id, p.athlete_id)
      and exists (
        select 1 from public.sessions s
        where s.id = p.session_id and s.athlete_id = p.athlete_id and s.tenant_id = p.tenant_id
      )
    from public.session_media_path_parts(p_name) p
  ), false)
$$;

-- Remove a file: the athlete, a club admin, or the staff member who uploaded it.
create or replace function public.can_remove_session_media_object(p_name text, p_owner text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_view_session_media_of(p.tenant_id, p.athlete_id)
      and (
        p.athlete_id = public.current_athlete_id()
        or public.is_club_admin()
        or (p_owner is not null and p_owner = auth.uid()::text)
        or exists (select 1 from public.session_media m where m.storage_path = p_name and m.created_by_user_id = auth.uid())
      )
    from public.session_media_path_parts(p_name) p
  ), false)
$$;

revoke all on function public.session_media_path_parts(text) from public, anon;
revoke all on function public.can_view_session_media_of(uuid, uuid) from public, anon;
revoke all on function public.can_read_session_media_object(text) from public, anon;
revoke all on function public.can_add_session_media_object(text) from public, anon;
revoke all on function public.can_remove_session_media_object(text, text) from public, anon;
grant execute on function public.session_media_path_parts(text) to authenticated, service_role;
grant execute on function public.can_view_session_media_of(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_read_session_media_object(text) to authenticated, service_role;
grant execute on function public.can_add_session_media_object(text) to authenticated, service_role;
grant execute on function public.can_remove_session_media_object(text, text) to authenticated, service_role;

-- 3. Row rules --------------------------------------------------------------------------------------

-- A new row: stamped with who added it, checked against its path, its session and the limits.
create or replace function public.session_media_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parts record;
  v_count integer;
begin
  if auth.uid() is not null then
    new.created_by_user_id := auth.uid();
    new.coach_comment := null;
    new.coach_comment_by_user_id := null;
    new.coach_comment_at := null;
  end if;
  new.caption := nullif(btrim(coalesce(new.caption, '')), '');

  select * into v_parts from public.session_media_path_parts(new.storage_path);
  if not found
     or v_parts.tenant_id is distinct from new.tenant_id
     or v_parts.athlete_id is distinct from new.athlete_id
     or v_parts.session_id is distinct from new.session_id then
    raise exception 'The file path does not match this session.' using errcode = '23514', hint = 'session_media_bad_path';
  end if;

  if not exists (
    select 1 from public.sessions s
    where s.id = new.session_id and s.athlete_id = new.athlete_id and s.tenant_id = new.tenant_id
  ) then
    raise exception 'That session was not found.' using errcode = '23514', hint = 'session_media_bad_session';
  end if;

  if new.session_block_row_id is not null and not exists (
    select 1
    from public.session_block_rows r
    join public.session_blocks b on b.id = r.session_block_id
    where r.id = new.session_block_row_id and b.session_id = new.session_id
  ) then
    raise exception 'That exercise is not part of this session.' using errcode = '23514', hint = 'session_media_bad_row';
  end if;

  -- One athlete at a time, so two uploads finishing together cannot both squeeze under a limit.
  perform pg_advisory_xact_lock(hashtextextended('session_media:' || new.athlete_id::text, 0));

  select count(*) into v_count from public.session_media m where m.session_id = new.session_id;
  if v_count >= 6 then
    raise exception 'A session can have up to 6 photos and videos. Remove one to add another.'
      using errcode = 'P0001', hint = 'session_media_session_full';
  end if;

  select count(*) into v_count from public.session_media m where m.athlete_id = new.athlete_id;
  if v_count >= 200 then
    raise exception 'You have reached the limit of 200 photos and videos. Remove some older ones to add more.'
      using errcode = 'P0001', hint = 'session_media_athlete_full';
  end if;

  return new;
end;
$$;

revoke all on function public.session_media_before_insert() from public, anon, authenticated;

drop trigger if exists session_media_before_insert on public.session_media;
create trigger session_media_before_insert
before insert on public.session_media
for each row execute function public.session_media_before_insert();

-- After that, only the caption changes freely. The coach's comment is written by
-- set_session_media_comment alone. The two "who" columns may only ever be emptied (which is what
-- deleting that person's account does).
create or replace function public.session_media_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.athlete_id is distinct from old.athlete_id
     or new.session_id is distinct from old.session_id
     or new.kind is distinct from old.kind
     or new.storage_path is distinct from old.storage_path
     or new.content_type is distinct from old.content_type
     or new.bytes is distinct from old.bytes
     or new.duration_seconds is distinct from old.duration_seconds
     or new.width is distinct from old.width
     or new.height is distinct from old.height
     or new.created_at is distinct from old.created_at
     or (new.session_block_row_id is distinct from old.session_block_row_id and new.session_block_row_id is not null)
     or (new.created_by_user_id is distinct from old.created_by_user_id and new.created_by_user_id is not null) then
    raise exception 'Only the caption of a photo or video can be changed.' using errcode = '42501';
  end if;

  if coalesce(current_setting('sktr.session_media_comment', true), '') <> 'on' then
    if new.coach_comment is distinct from old.coach_comment
       or new.coach_comment_at is distinct from old.coach_comment_at
       or (new.coach_comment_by_user_id is distinct from old.coach_comment_by_user_id and new.coach_comment_by_user_id is not null) then
      raise exception 'A coach comment is saved with set_session_media_comment.' using errcode = '42501';
    end if;
  end if;

  new.caption := nullif(btrim(coalesce(new.caption, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.session_media_before_update() from public, anon, authenticated;

drop trigger if exists session_media_before_update on public.session_media;
create trigger session_media_before_update
before update on public.session_media
for each row execute function public.session_media_before_update();

-- A deleted row leaves a file behind: queue it. Runs for every delete, whoever caused it.
create or replace function public.session_media_queue_file()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.queue_storage_deletion('session-media', old.storage_path, 'session photo or video removed');
  return old;
end;
$$;

revoke all on function public.session_media_queue_file() from public, anon, authenticated;

drop trigger if exists session_media_queue_file on public.session_media;
create trigger session_media_queue_file
after delete on public.session_media
for each row execute function public.session_media_queue_file();

-- Once per delete statement: ask the edge function to remove what was queued. Never raises, and
-- does nothing when pg_net or the function address is missing (the daily job below catches up).
create or replace function public.session_media_request_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.request_storage_purge('session-media');
  exception
    when others then
      null;
  end;
  return null;
end;
$$;

revoke all on function public.session_media_request_purge() from public, anon, authenticated;

drop trigger if exists session_media_request_purge on public.session_media;
create trigger session_media_request_purge
after delete on public.session_media
for each statement execute function public.session_media_request_purge();

-- 4. Row level security -----------------------------------------------------------------------------

alter table public.session_media enable row level security;
revoke all on public.session_media from public, anon;
grant select, insert, update, delete on public.session_media to authenticated;
grant all on public.session_media to service_role;

drop policy if exists session_media_select on public.session_media;
create policy session_media_select
on public.session_media
for select
to authenticated
using ((select public.can_view_session_media_of(session_media.tenant_id, session_media.athlete_id)));

-- The athlete, or staff logging the session for them (the trigger checks the session and limits).
drop policy if exists session_media_insert on public.session_media;
create policy session_media_insert
on public.session_media
for insert
to authenticated
with check ((select public.can_view_session_media_of(session_media.tenant_id, session_media.athlete_id)));

-- The caption: the athlete's own items, or an item the caller added for the athlete.
drop policy if exists session_media_update on public.session_media;
create policy session_media_update
on public.session_media
for update
to authenticated
using (
  (select public.can_view_session_media_of(session_media.tenant_id, session_media.athlete_id))
  and (athlete_id = (select public.current_athlete_id()) or created_by_user_id = (select auth.uid()))
)
with check (
  (select public.can_view_session_media_of(session_media.tenant_id, session_media.athlete_id))
  and (athlete_id = (select public.current_athlete_id()) or created_by_user_id = (select auth.uid()))
);

drop policy if exists session_media_delete on public.session_media;
create policy session_media_delete
on public.session_media
for delete
to authenticated
using (
  (select public.can_view_session_media_of(session_media.tenant_id, session_media.athlete_id))
  and (
    athlete_id = (select public.current_athlete_id())
    or (select public.is_club_admin())
    or created_by_user_id = (select auth.uid())
  )
);

-- 5. The coach's comment ----------------------------------------------------------------------------

-- A lead coach or coach of the athlete's team, or a club admin. An empty comment removes it.
-- The athlete is told through the existing session note notification.
create or replace function public.set_session_media_comment(p_media_id uuid, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media public.session_media%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_session record;
  v_athlete_user_id uuid;
  v_coach_name text;
begin
  perform public.assert_caller_active();
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_media from public.session_media m where m.id = p_media_id for update;
  if not found
     or v_media.tenant_id is distinct from public.current_tenant_id()
     or not (public.is_club_admin() or public.is_coach_of_athlete(v_media.athlete_id)) then
    raise exception 'You do not have access to comment on this.' using errcode = '42501';
  end if;

  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'Keep the comment to 500 characters or fewer.' using errcode = 'P0001', hint = 'session_media_comment_too_long';
  end if;

  perform set_config('sktr.session_media_comment', 'on', true);
  update public.session_media m
  set coach_comment = v_comment,
      coach_comment_by_user_id = case when v_comment is null then null else auth.uid() end,
      coach_comment_at = case when v_comment is null then null else now() end
  where m.id = v_media.id;
  perform set_config('sktr.session_media_comment', '', true);

  if v_comment is not null and v_comment is distinct from v_media.coach_comment then
    select s.title, s.scheduled_for into v_session from public.sessions s where s.id = v_media.session_id;
    select a.user_id into v_athlete_user_id
    from public.athletes a
    where a.id = v_media.athlete_id and a.tenant_id = v_media.tenant_id and a.is_active;
    select nullif(left(btrim(coalesce(p.display_name, '')), 80), '') into v_coach_name
    from public.profiles p
    where p.user_id = auth.uid() and p.tenant_id = v_media.tenant_id;

    perform public.enqueue_notification(
      v_media.tenant_id,
      v_athlete_user_id,
      'session_note_added',
      format('%s commented on your %s', coalesce(v_coach_name, 'Your coach'), v_media.kind),
      format('%s, %s. Open the session to read it.', coalesce(nullif(btrim(v_session.title), ''), 'Session'), public.notification_date_label(v_session.scheduled_for)),
      jsonb_build_object(
        'session_id', v_media.session_id::text,
        'athlete_id', v_media.athlete_id::text,
        'session_date', to_char(v_session.scheduled_for, 'YYYY-MM-DD'),
        'media_id', v_media.id::text
      ),
      array['in-app', 'email'],
      'session_media_comment:' || v_media.id::text,
      interval '10 minutes'
    );
  end if;

  return jsonb_build_object(
    'coach_comment', v_comment,
    'coach_comment_at', case when v_comment is null then null else now() end
  );
end;
$$;

revoke all on function public.set_session_media_comment(uuid, text) from public, anon;
grant execute on function public.set_session_media_comment(uuid, text) to authenticated;

-- 6. Storage bucket and its policies ----------------------------------------------------------------
-- Guarded like the avatars bucket (20261007100000): a database without the storage schema skips it.
do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not found: session-media bucket and policies skipped';
    return;
  end if;

  -- Private. 50 MB per file; photos are resized in the browser first (about 200 to 500 KB).
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('session-media', 'session-media', false, 52428800, array['image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  exception when undefined_column then
    insert into storage.buckets (id, name, public)
    values ('session-media', 'session-media', false)
    on conflict (id) do update set public = false;
  end;

  -- Select is what a signed link is made with. There is no update policy: a file is never
  -- overwritten, only added and removed.
  drop policy if exists session_media_objects_select on storage.objects;
  create policy session_media_objects_select on storage.objects
    for select to authenticated
    using (bucket_id = 'session-media' and public.can_read_session_media_object(name));

  drop policy if exists session_media_objects_insert on storage.objects;
  create policy session_media_objects_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'session-media' and public.can_add_session_media_object(name));

  drop policy if exists session_media_objects_delete on storage.objects;
  create policy session_media_objects_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'session-media' and public.can_remove_session_media_object(name, owner_id::text));
end;
$storage$;

-- 7. Files nobody names, and the daily tidy up ------------------------------------------------------

-- A file in the bucket with no session_media row, older than a day: an upload whose record was
-- never saved (the phone lost signal between the two). Queued for removal like any other.
create or replace function public.queue_orphan_session_media(p_older_than interval default interval '1 day')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
  v_count integer := 0;
begin
  if to_regclass('storage.objects') is null then
    return 0;
  end if;
  for v_path in
    execute 'select o.name from storage.objects o
             where o.bucket_id = ''session-media''
               and o.created_at < now() - $1
               and not exists (select 1 from public.session_media m where m.storage_path = o.name)'
    using coalesce(p_older_than, interval '1 day')
  loop
    perform public.queue_storage_deletion('session-media', v_path, 'session photo or video with no record');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.queue_orphan_session_media(interval) from public, anon, authenticated;
grant execute on function public.queue_orphan_session_media(interval) to service_role;

create or replace function public.run_session_media_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orphans integer;
  v_purge text;
begin
  v_orphans := public.queue_orphan_session_media();
  v_purge := public.request_storage_purge('session-media');
  return jsonb_build_object('orphans_queued', v_orphans, 'purge', v_purge);
end;
$$;

revoke all on function public.run_session_media_cleanup() from public, anon, authenticated;
grant execute on function public.run_session_media_cleanup() to service_role;

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron is not installed: no session media clean up schedule created.';
    return;
  end if;

  begin
    execute 'select cron.unschedule(jobname) from cron.job where jobname = ''sktr-session-media-cleanup''';
  exception
    when others then
      raise notice 'Could not remove the earlier session media schedule (%).', sqlerrm;
  end;

  execute 'select cron.schedule(''sktr-session-media-cleanup'', ''47 4 * * *'', ''select public.run_session_media_cleanup()'')';
exception
  when others then
    raise notice 'Could not create the session media schedule (%).', sqlerrm;
end
$$;

-- 8. How much each club stores (platform admins only) -----------------------------------------------

create or replace function public.get_session_media_usage()
returns table (tenant_id uuid, club_name text, items bigint, total_bytes bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can see storage use.' using errcode = '42501';
  end if;
  return query
  select m.tenant_id, public.club_display_name(m.tenant_id), count(*)::bigint, coalesce(sum(m.bytes), 0)::bigint
  from public.session_media m
  group by m.tenant_id
  order by 4 desc;
end;
$$;

revoke all on function public.get_session_media_usage() from public, anon;
grant execute on function public.get_session_media_usage() to authenticated;

-- 9. The two "who" columns point at accounts (20261014120000, section 0b).
do $$ begin perform public.install_deleted_account_triggers(); end $$;

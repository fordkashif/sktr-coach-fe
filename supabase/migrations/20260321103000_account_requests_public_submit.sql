-- PaceLab Public Account Request RPC
-- Created: 2026-03-21

create or replace function public.submit_account_request(
  p_full_name text,
  p_email text,
  p_organization text,
  p_notes text default null,
  p_desired_role text default 'club-admin'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_request_id uuid;
begin
  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'Full name is required';
  end if;

  if p_email is null or btrim(p_email) = '' then
    raise exception 'Email is required';
  end if;

  if p_organization is null or btrim(p_organization) = '' then
    raise exception 'Organization is required';
  end if;

  if p_desired_role not in ('coach', 'club-admin', 'athlete') then
    raise exception 'Invalid desired role';
  end if;

  select t.id
  into v_tenant_id
  from public.tenants t
  where lower(t.name) = lower(btrim(p_organization))
     or t.slug = lower(regexp_replace(btrim(p_organization), '[^a-z0-9]+', '-', 'g'))
  order by t.created_at asc
  limit 1;

  if v_tenant_id is null then
    raise exception 'Organization not found. Use the exact club name.';
  end if;

  insert into public.account_requests (
    tenant_id,
    full_name,
    email,
    organization,
    desired_role,
    notes,
    status,
    requested_by_user_id
  )
  values (
    v_tenant_id,
    btrim(p_full_name),
    lower(btrim(p_email)),
    btrim(p_organization),
    p_desired_role,
    nullif(btrim(coalesce(p_notes, '')), ''),
    'pending',
    auth.uid()
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

grant execute on function public.submit_account_request(text, text, text, text, text) to anon, authenticated;

-- Club admin self-serve tenant provisioning
-- Created: 2026-03-21

create or replace function public.provision_club_admin_tenant(
  p_organization_name text,
  p_short_name text,
  p_primary_color text,
  p_season_year text,
  p_season_start date,
  p_season_end date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_display_name text;
  v_base_slug text;
  v_slug text;
  v_tenant_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_organization_name is null or btrim(p_organization_name) = '' then
    raise exception 'Organization name is required';
  end if;

  if p_short_name is null or btrim(p_short_name) = '' then
    raise exception 'Short name is required';
  end if;

  if p_season_year is null or btrim(p_season_year) = '' then
    raise exception 'Season year is required';
  end if;

  if p_season_start is null or p_season_end is null or p_season_start > p_season_end then
    raise exception 'Season start/end are invalid';
  end if;

  if exists (select 1 from public.profiles where user_id = v_user_id) then
    raise exception 'This user already has a tenant profile';
  end if;

  select
    lower(coalesce(au.email, '')),
    nullif(coalesce(au.raw_user_meta_data ->> 'display_name', au.raw_user_meta_data ->> 'full_name', ''), '')
  into v_email, v_display_name
  from auth.users au
  where au.id = v_user_id;

  v_base_slug := lower(regexp_replace(btrim(p_organization_name), '[^a-z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then
    v_base_slug := 'club';
  end if;

  v_slug := v_base_slug;
  if exists (select 1 from public.tenants t where t.slug = v_slug) then
    v_slug := v_base_slug || '-' || substring(replace(v_user_id::text, '-', ''), 1, 6);
  end if;

  insert into public.tenants (slug, name, is_active)
  values (v_slug, btrim(p_organization_name), true)
  returning id into v_tenant_id;

  insert into public.profiles (user_id, tenant_id, role, display_name, is_active)
  values (v_user_id, v_tenant_id, 'club-admin', v_display_name, true);

  insert into public.club_profiles (
    tenant_id,
    club_name,
    short_name,
    primary_color,
    season_year,
    season_start,
    season_end
  )
  values (
    v_tenant_id,
    btrim(p_organization_name),
    btrim(p_short_name),
    coalesce(nullif(btrim(p_primary_color), ''), '#16a34a'),
    btrim(p_season_year),
    p_season_start,
    p_season_end
  );

  insert into public.billing_profiles (
    tenant_id,
    plan,
    seats,
    renewal_date,
    payment_method_last4
  )
  values (
    v_tenant_id,
    'starter',
    25,
    (now() + interval '30 days')::date,
    '0000'
  );

  insert into public.audit_events (
    tenant_id,
    actor_user_id,
    actor_role,
    action,
    target,
    detail
  )
  values (
    v_tenant_id,
    v_user_id,
    'club-admin',
    'tenant_provisioned',
    coalesce(v_email, v_user_id::text),
    'Self-serve club admin signup'
  );

  return v_tenant_id;
end;
$$;

grant execute on function public.provision_club_admin_tenant(text, text, text, text, date, date) to authenticated;

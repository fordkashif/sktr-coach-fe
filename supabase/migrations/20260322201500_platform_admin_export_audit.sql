-- Created: 2026-03-22

create or replace function public.log_platform_admin_export(
  p_target text,
  p_format text,
  p_record_count int default 0,
  p_filters jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform-admin users can log platform exports';
  end if;

  perform public.insert_platform_audit_event(
    auth.uid(),
    auth.jwt() ->> 'email',
    'platform-admin',
    case
      when lower(coalesce(p_format, '')) = 'pdf' then 'platform_audit_export_pdf'
      else 'platform_audit_export_csv'
    end,
    coalesce(nullif(btrim(coalesce(p_target, '')), ''), 'platform-audit'),
    format(
      'Exported %s as %s (%s row(s))',
      coalesce(nullif(btrim(coalesce(p_target, '')), ''), 'platform-audit'),
      lower(coalesce(p_format, 'csv')),
      greatest(coalesce(p_record_count, 0), 0)
    ),
    jsonb_build_object(
      'target', coalesce(nullif(btrim(coalesce(p_target, '')), ''), 'platform-audit'),
      'format', lower(coalesce(p_format, 'csv')),
      'record_count', greatest(coalesce(p_record_count, 0), 0),
      'filters', coalesce(p_filters, '{}'::jsonb)
    )
  );
end;
$$;

grant execute on function public.log_platform_admin_export(text, text, int, jsonb) to authenticated;

-- Several reads in one request.
--
-- Each screen asks the database 8 to 16 small questions at once. On a phone the server answered
-- them almost one at a time, so a tab took 1 to 2 seconds. The app now sends the plain reads a
-- screen makes at the same moment in one request (src/lib/supabase/batch-reads.ts), and this
-- function answers each of them as the database's own API would.
--
-- Safety:
-- - It runs with the caller's own rights (security invoker): every read goes through the same
--   access rules and table permissions as when sent on its own.
-- - Only tables and views in the public schema, only plain column names, a fixed list of
--   comparisons, and values passed as quoted text. Nothing else is accepted.
-- - At most 1000 rows per read, like the API's own limit.
-- - A read that fails comes back as {"ok": false} and the app sends it again on its own, so the
--   person sees exactly the error the API would give.
--
-- p_reads: [{ "t": table, "c": ["col", ...] or "*", "f": [[col, op, value], ...],
--             "o": [[col, "asc"|"desc", "nullsfirst"|"nullslast"|null], ...], "l": limit or null,
--             "x": rows to skip or null }
--            or { "r": function, "a": { "p_name": value, ... } } for a read-only database function:
--            only functions in the public schema declared stable (so Postgres lets them change
--            nothing) that return rows, with plain values as arguments.
-- Returns: [{ "ok": true, "rows": [...] } or { "ok": false }, ...] in the same order.

create or replace function public.batch_reads(p_reads jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_read jsonb;
  v_table text;
  v_cols text;
  v_where text;
  v_order text;
  v_limit int;
  v_filter jsonb;
  v_col text;
  v_op text;
  v_val text;
  v_list text;
  v_part text;
  v_sort jsonb;
  v_rows jsonb;
  v_ok boolean;
  v_fn text;
  v_args text;
begin
  if jsonb_typeof(p_reads) <> 'array' or jsonb_array_length(p_reads) > 40 then
    raise exception 'batch_reads: expected an array of at most 40 reads';
  end if;

  for v_read in select value from jsonb_array_elements(p_reads)
  loop
    v_ok := true;
    v_rows := null;
    begin
      if v_read ? 'r' then
        v_fn := v_read->>'r';
        if v_fn !~ '^[a-z_][a-z0-9_]*$' then
          raise exception 'bad function';
        end if;
        -- Only read-only functions that return rows: their answer is a list, as the API sends it.
        -- Rows with named columns only (two or more output columns, or a table type): a single
        -- column comes back in another shape here than from the API, so those go on their own.
        perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
        where n.nspname = 'public' and p.proname = v_fn and p.provolatile in ('s', 'i') and p.proretset and p.prokind = 'f'
          and (t.typtype = 'c' or (select count(*) from unnest(coalesce(p.proargmodes, '{}'::"char"[])) m where m in ('o', 't')) >= 2);
        if not found then
          raise exception 'not a read-only function';
        end if;
        if jsonb_typeof(coalesce(v_read->'a', '{}'::jsonb)) <> 'object' then
          raise exception 'bad arguments';
        end if;
        select string_agg(
          format('%I => %s', key, case when jsonb_typeof(value) = 'null' then 'null' else quote_literal(value #>> '{}') end),
          ', ' order by key)
        into v_args
        from jsonb_each(coalesce(v_read->'a', '{}'::jsonb))
        where key ~ '^[a-z_][a-z0-9_]*$' and jsonb_typeof(value) in ('string', 'number', 'boolean', 'null');
        if (select count(*) from jsonb_object_keys(coalesce(v_read->'a', '{}'::jsonb))) <> (select count(*) from jsonb_each(coalesce(v_read->'a', '{}'::jsonb)) where key ~ '^[a-z_][a-z0-9_]*$' and jsonb_typeof(value) in ('string', 'number', 'boolean', 'null')) then
          raise exception 'bad arguments';
        end if;
        execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I(%s) x', v_fn, coalesce(v_args, '')) into v_rows;
        v_out := v_out || jsonb_build_array(jsonb_build_object('ok', true, 'rows', v_rows));
        continue;
      end if;

      v_table := v_read->>'t';
      if v_table is null or v_table !~ '^[a-z_][a-z0-9_]*$' then
        raise exception 'bad table';
      end if;
      perform 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table and c.relkind in ('r', 'v', 'm', 'p');
      if not found then
        raise exception 'unknown table';
      end if;

      -- Columns
      if v_read->'c' = '"*"'::jsonb then
        v_cols := '*';
      else
        select string_agg(format('%I', col), ', ' order by ord)
        into v_cols
        from jsonb_array_elements_text(v_read->'c') with ordinality as x(col, ord);
        if v_cols is null or exists (select 1 from jsonb_array_elements_text(v_read->'c') col where col !~ '^[a-z_][a-z0-9_]*$') then
          raise exception 'bad columns';
        end if;
      end if;

      -- Filters
      v_where := 'true';
      for v_filter in select value from jsonb_array_elements(coalesce(v_read->'f', '[]'::jsonb))
      loop
        v_col := v_filter->>0;
        v_op := v_filter->>1;
        if v_col !~ '^[a-z_][a-z0-9_]*$' then
          raise exception 'bad filter column';
        end if;
        if v_op = 'in' then
          select string_agg(quote_literal(item), ', ') into v_list from jsonb_array_elements_text(v_filter->2) item;
          -- An empty list matches nothing, as in the API.
          v_part := case when v_list is null then 'false' else format('%I in (%s)', v_col, v_list) end;
        else
          v_val := v_filter->>2;
          v_part := case v_op
            when 'eq' then format('%I = %L', v_col, v_val)
            when 'neq' then format('%I <> %L', v_col, v_val)
            when 'gt' then format('%I > %L', v_col, v_val)
            when 'gte' then format('%I >= %L', v_col, v_val)
            when 'lt' then format('%I < %L', v_col, v_val)
            when 'lte' then format('%I <= %L', v_col, v_val)
            when 'is' then case v_val
              when 'null' then format('%I is null', v_col)
              when 'true' then format('%I is true', v_col)
              when 'false' then format('%I is false', v_col)
              else null end
            when 'not.is' then case v_val
              when 'null' then format('%I is not null', v_col)
              when 'true' then format('%I is not true', v_col)
              when 'false' then format('%I is not false', v_col)
              else null end
            else null
          end;
        end if;
        if v_part is null then
          raise exception 'bad filter';
        end if;
        v_where := v_where || ' and ' || v_part;
      end loop;

      -- Order
      v_order := '';
      for v_sort in select value from jsonb_array_elements(coalesce(v_read->'o', '[]'::jsonb))
      loop
        if (v_sort->>0) !~ '^[a-z_][a-z0-9_]*$' or (v_sort->>1) not in ('asc', 'desc') or coalesce(v_sort->>2, 'none') not in ('none', 'nullsfirst', 'nullslast') then
          raise exception 'bad order';
        end if;
        v_order := v_order || case when v_order = '' then ' order by ' else ', ' end
          || format('%I %s', v_sort->>0, v_sort->>1)
          || case v_sort->>2 when 'nullsfirst' then ' nulls first' when 'nullslast' then ' nulls last' else '' end;
      end loop;

      v_limit := least(coalesce((v_read->>'l')::int, 1000), 1000);

      execute format(
        'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select %s from public.%I where %s%s limit %s offset %s) x',
        v_cols, v_table, v_where, v_order, v_limit, greatest(coalesce((v_read->>'x')::int, 0), 0)
      ) into v_rows;
    exception when others then
      v_ok := false;
    end;

    v_out := v_out || jsonb_build_array(case when v_ok then jsonb_build_object('ok', true, 'rows', v_rows) else jsonb_build_object('ok', false) end);
  end loop;

  return v_out;
end;
$$;

revoke all on function public.batch_reads(jsonb) from public, anon;
grant execute on function public.batch_reads(jsonb) to authenticated, service_role;

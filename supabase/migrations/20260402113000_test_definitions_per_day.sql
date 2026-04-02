alter table public.test_definitions
  add column if not exists scheduled_date date,
  add column if not exists day_index int;

update public.test_definitions td
set
  scheduled_date = tw.start_date,
  day_index = 0
from public.test_weeks tw
where td.test_week_id = tw.id
  and (td.scheduled_date is null or td.day_index is null);

alter table public.test_definitions
  alter column scheduled_date set not null,
  alter column day_index set not null;

alter table public.test_definitions
  drop constraint if exists test_definitions_day_index_check;

alter table public.test_definitions
  add constraint test_definitions_day_index_check check (day_index >= 0 and day_index <= 30);

alter table public.test_definitions
  drop constraint if exists test_definitions_test_week_id_name_key;

alter table public.test_definitions
  add constraint test_definitions_test_week_id_day_index_name_key unique (test_week_id, day_index, name);

create index if not exists test_definitions_week_day_sort_idx
  on public.test_definitions (test_week_id, day_index, sort_order);

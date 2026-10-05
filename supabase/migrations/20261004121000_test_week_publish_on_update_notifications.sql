-- Notify athletes when a test week that was saved as a draft is published later.
-- The existing trigger only fires on insert, so draft -> published sent nothing.
-- The trigger function already returns early unless new.status = 'published'.

drop trigger if exists queue_test_week_published_notifications_on_update on public.test_weeks;
create trigger queue_test_week_published_notifications_on_update
after update of status on public.test_weeks
for each row
when (old.status is distinct from new.status and new.status = 'published')
execute function public.enqueue_test_week_published_notifications();

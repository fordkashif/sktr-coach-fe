-- The "own rows" policies on the notification tables matched a row by email with both sides
-- defaulting to an empty string. A session token that carries no email claim (an anonymous or
-- phone sign-in, if either were ever switched on) would then match every row whose email is null.
-- Match by email only when the token really has one.

alter policy user_notifications_select_self on public.user_notifications
  using (
    recipient_user_id = auth.uid()
    or (nullif(auth.jwt() ->> 'email', '') is not null and lower(recipient_email) = lower(auth.jwt() ->> 'email'))
  );

alter policy user_notifications_update_self on public.user_notifications
  using (
    recipient_user_id = auth.uid()
    or (nullif(auth.jwt() ->> 'email', '') is not null and lower(recipient_email) = lower(auth.jwt() ->> 'email'))
  )
  with check (
    recipient_user_id = auth.uid()
    or (nullif(auth.jwt() ->> 'email', '') is not null and lower(recipient_email) = lower(auth.jwt() ->> 'email'))
  );

alter policy notification_events_select_self on public.notification_events
  using (
    recipient_user_id = auth.uid()
    or (nullif(auth.jwt() ->> 'email', '') is not null and lower(recipient_email) = lower(auth.jwt() ->> 'email'))
  );

alter policy notification_events_update_self on public.notification_events
  using (
    recipient_user_id = auth.uid()
    or (nullif(auth.jwt() ->> 'email', '') is not null and lower(recipient_email) = lower(auth.jwt() ->> 'email'))
  )
  with check (
    recipient_user_id = auth.uid()
    or (nullif(auth.jwt() ->> 'email', '') is not null and lower(recipient_email) = lower(auth.jwt() ->> 'email'))
  );

alter policy notification_preferences_select_self on public.notification_preferences
  using (
    user_id = auth.uid()
    or (nullif(auth.jwt() ->> 'email', '') is not null and lower(email) = lower(auth.jwt() ->> 'email'))
  );

alter policy notification_preferences_modify_self on public.notification_preferences
  using (
    user_id = auth.uid()
    or (nullif(auth.jwt() ->> 'email', '') is not null and lower(email) = lower(auth.jwt() ->> 'email'))
  )
  with check (
    user_id = auth.uid()
    or (nullif(auth.jwt() ->> 'email', '') is not null and lower(email) = lower(auth.jwt() ->> 'email'))
  );

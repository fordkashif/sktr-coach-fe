import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { handleDispatchNotificationEmails } from "./handler.ts"

// Sends the notification emails waiting in public.notification_events. Three callers:
//   the database scheduler   every minute, and straight after an email is queued (pg_cron + pg_net,
//                            migration 20261007090000). Proves itself with x-sktr-scheduler-token.
//   a signed-in member       the app calls it after an action that notifies people. Sends only the
//                            queue of that member's own club. This is what keeps email flowing if the
//                            scheduler is not available.
//   a platform admin         the "Send queued emails" button: everything, including rows still
//                            waiting for a retry.
//
// Secrets it reads (set as Supabase edge function secrets, see SUPABASE_ENV_AND_SECRETS_SETUP.md):
//   RESEND_API_KEY, NOTIFICATION_FROM_EMAIL   the email provider
//   PUBLIC_APP_URL                            where the app lives; every link in an email is built
//                                             from this and from nothing a caller sends
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,      push notifications (made with scripts/generate-vapid-keys.mjs).
//   VAPID_SUBJECT                             With any of them missing push is off and email is unaffected.
//
// The same run also sends the push notifications waiting in public.push_deliveries (push-dispatch.ts).
// Machine-readable error codes are listed in notification-email.ts (DispatchErrorCode).

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

Deno.serve((request) =>
  handleDispatchNotificationEmails(request, {
    getEnv: (name) => Deno.env.get(name),
    createUserClient: (url, anonKey, authorization) =>
      createClient(url, anonKey, { ...clientOptions, global: { headers: { Authorization: authorization } } }),
    createServiceClient: (url, serviceRoleKey) => createClient(url, serviceRoleKey, clientOptions),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }),
)

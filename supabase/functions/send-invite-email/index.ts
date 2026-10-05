import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { handleSendInviteEmail } from "./handler.ts"

// Emails a coach or athlete invite to the invited person. Called by the inviter's browser right after
// the invite row is created, and again for "Resend email". Input: { kind: "coach" | "athlete", inviteId }.
//
// Secrets it reads (set as Supabase edge function secrets, see SUPABASE_ENV_AND_SECRETS_SETUP.md):
//   RESEND_API_KEY, NOTIFICATION_FROM_EMAIL   the email provider
//   PUBLIC_APP_URL                            where the app lives; the invite link is built from this and
//                                             from nothing the caller sends
// Machine-readable error codes are listed in invite-email.ts (InviteEmailErrorCode).

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

Deno.serve((request) =>
  handleSendInviteEmail(request, {
    getEnv: (name) => Deno.env.get(name),
    createUserClient: (url, anonKey, authorization) =>
      createClient(url, anonKey, { ...clientOptions, global: { headers: { Authorization: authorization } } }),
    createServiceClient: (url, serviceRoleKey) => createClient(url, serviceRoleKey, clientOptions),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
  }),
)

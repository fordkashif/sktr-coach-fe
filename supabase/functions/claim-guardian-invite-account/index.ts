import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { handleClaimGuardianInvite } from "./handler.ts"

// Creates the sign-in for a parent or guardian who opened their invite link (/guardian/claim/<id>).
// Input: { inviteId, email, password, displayName }. See handler.ts for what it checks.
// Secrets it reads: none beyond the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY every function has.

Deno.serve((request) =>
  handleClaimGuardianInvite(request, {
    getEnv: (name) => Deno.env.get(name),
    createServiceClient: (url, serviceRoleKey) => createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    now: () => new Date(),
  }),
)

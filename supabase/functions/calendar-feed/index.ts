import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { handleCalendarFeed } from "../_shared/calendar-feed.ts"

// The private calendar feed: GET /functions/v1/calendar-feed/<token>.ics (or ?t=<token>).
// Calendar apps (Apple, Google, Outlook) fetch it without signing in, so verify_jwt is off for this
// function (supabase/config.toml) and the long random token in the address is the only key.
//
// All the rules live in ../_shared/calendar-feed.ts (handleCalendarFeed), which is unit tested in
// tests/calendar-ics.test.ts. This file only wires in the database: the token is hashed, and the
// database function calendar_feed_payload(hash) returns what that person's calendar shows, or null
// for an unknown token, a deactivated member or a paused club. It is callable by the service role only.
//
// Secrets it reads: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both set by Supabase).

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

Deno.serve((request) =>
  handleCalendarFeed(request, {
    now: () => new Date(),
    loadPayload: async (tokenHash) => {
      const url = Deno.env.get("SUPABASE_URL")
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      if (!url || !key) return null
      const client = createClient(url, key, clientOptions)
      const { data, error } = await client.rpc("calendar_feed_payload", { p_token_hash: tokenHash })
      return error ? null : data
    },
  }),
)

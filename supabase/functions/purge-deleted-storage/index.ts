import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { handlePurgeDeletedStorage } from "./handler.ts"

// Removes the profile photos and club logos left behind by a deleted account or a deleted club.
// The database queues the paths (public.storage_deletion_queue, migration 20261014120000); this
// function removes the files with the Storage API, which is the only supported way to delete them.
// Callers:
//   the database scheduler   after the daily club deletion job (pg_cron + pg_net), with
//                            x-sktr-scheduler-token
//   a platform admin         the app calls it right after "Delete permanently now"
// It reads no secrets beyond the Supabase ones every function gets.

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

Deno.serve((request) =>
  handlePurgeDeletedStorage(request, {
    getEnv: (name) => Deno.env.get(name),
    createUserClient: (url, anonKey, authorization) =>
      createClient(url, anonKey, { ...clientOptions, global: { headers: { Authorization: authorization } } }),
    createServiceClient: (url, serviceRoleKey) => createClient(url, serviceRoleKey, clientOptions),
  }),
)

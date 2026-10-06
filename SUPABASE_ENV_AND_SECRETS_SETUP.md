# PaceLab Supabase Environment + Secrets Setup

Last updated: October 7, 2026

## Purpose

Define project/environment setup for Supabase across local, dev, and prod, including secret handling rules.

Companion files:
- `.env.supabase.example`
- `SUPABASE_POSTGRES_STATUS_BOARD.md`
- `TEST_MAILBOX_WORKFLOW.md`

## Environment Topology

- Local:
  - Supabase local stack (CLI + Docker), or dedicated local project
  - Used for schema iteration and migration testing
- Dev:
  - Shared team environment for integration testing
  - Mirrors production config patterns with safe data
- Prod:
  - Production tenant data and operational workloads
  - Locked-down access and audited changes only

## Required Variables

Frontend-safe (`VITE_*`):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BACKEND_MODE` (`mock` or `supabase`)

Server/CI only (never in browser bundle):
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_ACCESS_TOKEN` (if CI uses CLI auth)
- `SUPABASE_PROJECT_REF`
- `SUPABASE_URL` (for Edge Functions / CI secret sync)
- `SUPABASE_ANON_KEY` (for Edge Functions using authenticated user context)
- `RESEND_API_KEY` (email delivery provider)
- `NOTIFICATION_FROM_EMAIL` (sender identity for notification emails and invite emails)
- `PUBLIC_APP_URL` (where the app is hosted for that environment, for example `https://app.example.com`; the links in invite emails and notification emails are built from it)

## Variable Rules

- Only `VITE_*` keys are allowed in client code.
- `SUPABASE_SERVICE_ROLE_KEY` must never be committed, logged, or exposed to browser.
- Local `.env*` files are gitignored; repo keeps templates only.
- Use separate keys per environment; never reuse prod keys in dev.

## Setup Steps

1. Copy template:
   - `Copy-Item .env.supabase.example .env.local`
2. Fill local values:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_BACKEND_MODE=supabase` (or `mock` during staged migration)
3. For CLI/migrations, set non-`VITE` vars in shell or CI secret manager.
4. Validate frontend loads without hardcoded credentials.

## CI/CD Secret Handling

- Store all non-`VITE` secrets in CI secret manager.
- Limit secret access to migration/deploy jobs only.
- Block secret echo in logs.
- Rotate keys on environment compromise or team-role changes.

### Edge Function Deployment

- App deployment does not deploy Supabase Edge Functions by default.
- `.github/workflows/supabase-migrations.yml` now also:
  - syncs Edge Function secrets
  - deploys:
    - `platform-admin-send-club-admin-invite`
    - `dispatch-notification-emails`
    - `platform-admin-preview-club-admin-invite`
    - `local-preview-password-reset`
    - `claim-coach-invite-account`
    - `claim-athlete-invite-account`
    - `send-invite-email`
    - `purge-deleted-storage` (removes the photos and logos of deleted accounts and clubs; needs no secret of its own)
  - A new function has to be added to both the dev and the prod deploy list in that workflow, and to `supabase/config.toml`.
- Required GitHub environment secrets for this workflow:
  - `SUPABASE_ACCESS_TOKEN`
  - `SUPABASE_PROJECT_REF`
  - `SUPABASE_DB_PASSWORD`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RESEND_API_KEY`
  - `NOTIFICATION_FROM_EMAIL`
- Required GitHub environment variable (or secret, the workflow reads either), one value per environment:
  - `PUBLIC_APP_URL`

### Invite Emails (`send-invite-email`)

When a club admin invites a coach, or a coach or club admin invites an athlete, the app calls `send-invite-email` and the invited person gets an email with a button to accept. "Resend email" in the invite lists calls it again.

What has to be set, per environment (dev and prod separately):

| Name | Where | Value |
|---|---|---|
| `RESEND_API_KEY` | GitHub environment secret (the workflow copies it into the Supabase edge function secrets) | API key from Resend |
| `NOTIFICATION_FROM_EMAIL` | GitHub environment secret (copied the same way) | an address on a domain verified in Resend, for example `invites@yourdomain.com`, or `SKTR Coach <invites@yourdomain.com>`. A bare address is shown to recipients as "SKTR Coach" |
| `PUBLIC_APP_URL` | GitHub environment variable or secret (copied the same way), or set by hand in Supabase: Edge Functions, Secrets | the address people open the app at for that environment, with no path, for example `https://app.yourdomain.com` |

Rules worth knowing:

- The link in the email is built only from `PUBLIC_APP_URL`. The function ignores any address the browser sends, so a signed-in user cannot make the email point at another site. If `PUBLIC_APP_URL` is wrong, every invite email links to the wrong place.
- If any of the three is missing, the invite is still created and the inviter is told the email could not be sent, with "Copy link" to hand. Nothing breaks.
- Until the sending domain is verified in Resend, Resend only delivers to the account owner's own address. Other recipients fail, and the inviter sees "The email service did not accept it".
- Limits: one email per invite per 60 seconds, 5 per invite in total. After that, cancel the invite and create a new one.
- Local stack only: with `PUBLIC_APP_URL` set to a `localhost` address and no Resend key, the function records the send, returns the link and sends nothing.
- Every send is written to the club's activity log (`audit_events`), and the invite row keeps `last_email_sent_at`, `email_send_count` and `last_email_error`.
- Tests for the function: `deno test supabase/functions/send-invite-email/` (no network needed).

### Notification Emails (`dispatch-notification-emails`): nothing new to set up

Notification emails ("your coach published a plan", "you now coach Sprints") are queued in the database and sent by the `dispatch-notification-emails` edge function. Since migration `20261007090000_notifications_delivery.sql` nobody has to press anything.

**What the owner has to do by hand: nothing new.** It uses the same three values invite emails already need (`RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `PUBLIC_APP_URL`, see the table above). No new secret, no dashboard setting, no extension to switch on.

How an email leaves, in order:

1. **Straight after it is queued.** A database trigger calls the edge function through the `pg_net` extension as soon as the write that queued the email commits.
2. **Every minute.** A `pg_cron` job (`sktr-dispatch-notification-emails`) asks again, which picks up retries and anything the first call missed. It makes no HTTP call when nothing is waiting.
3. **When the app asks (the fallback).** After publishing a plan or a test week, leaving a session note, or changing a team's coaches, the app calls the edge function, which sends only that club's queue. This works with no extension at all.
4. **By hand, still.** "Send queued emails" on the platform admin Requests screen sends everything, including emails waiting for a retry.

The migration switches `pg_net` and `pg_cron` on itself. Both ship with hosted Supabase projects. If either cannot be created the migration still applies (it prints a notice) and steps 3 and 4 keep email flowing.

How the database proves it is the database: the migration generates a random token once into the private one-row table `public.notification_dispatch_config`. The database sends it in a header; the edge function asks the database whether it matches. It is not a secret you manage: it is different on dev and prod, no API role can read it, and the service role key is never stored in SQL. To rotate it: `update public.notification_dispatch_config set scheduler_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');`.

How the database knows where the function lives: it is not configured. The address is stored the first time either of these happens, whichever comes first: the deploy workflow calls the function once after deploying it; a signed-in person does something that queues an email (the address is derived from the issuer of their sign-in token, `https://<project>.supabase.co`); the function is called by anyone allowed to. Until then the scheduler reports `no_url` and does nothing.

Safety rules the queue applies on every run: an email is claimed by one run only (`for update skip locked`), is never sent twice (the provider also gets an idempotency key per email), is retried after 2, 4, 8 and 16 minutes and given up after five attempts, and is not sent at all when the recipient switched it off, was deactivated, belongs to a suspended or cancelled club, or the email is more than 72 hours old. Those are marked `suppressed` with the reason in `last_error`.

Worth knowing for the first release: emails already sitting in the queue from the last 72 hours go out when the function first runs. Anything older is marked `suppressed`, not sent.

Checking it worked on a project (SQL editor):

```sql
-- 1. Are the extensions there, and is the job scheduled?
select extname from pg_extension where extname in ('pg_net', 'pg_cron');
select jobname, schedule, active from cron.job where jobname like 'sktr-%';

-- 2. Does the database know the function's address, and when did delivery last run?
select function_url, last_requested_at, last_request_source, last_run_at, last_run_mode, last_run_summary
from public.notification_dispatch_config;

-- 3. What would the scheduler do right now? 'idle' (nothing waiting), 'requested', 'no_url' or 'no_pg_net'.
select public.request_notification_email_dispatch('manual');

-- 4. The queue itself.
select status, count(*), max(last_error) from public.notification_events where channel = 'email' group by 1;

-- 5. What the function answered (pg_net keeps recent responses).
select id, status_code, left(content, 200), created from net._http_response order by created desc limit 5;
```

A healthy project shows both extensions, one active `sktr-dispatch-notification-emails` job, a `function_url`, and `last_run_at` moving whenever an email is queued. The platform admin dashboard shows the same in words ("Notification email in the last 24 hours: 14 sent...").

If `function_url` is empty and step 3 says `no_url`: sign in to the app and publish something, or run the workflow again. If step 5 shows `503` with `email_not_configured`: one of the three values in the table above is missing; the response names which. If it shows `401`: the function is an older version, deploy it again.

Tests for the function: `deno test supabase/functions/dispatch-notification-emails/` (no network needed).

### Public Club Request Form (no secret, nothing to set up)

The "Request access for your club" form is protected inside the database by migration `20261006181000_request_form_protection.sql`. It needs no secret, no environment variable, no dashboard setting and no outside service.

- The limits (3 requests per email per 24 hours, 5 per network address per 24 hours, 30 per hour and 150 per day from everyone together) and the minimum fill time are columns of the one row in `public.request_form_settings`. To change one, run a single statement in the Supabase SQL editor, for example `update public.request_form_settings set per_ip_max = 10;`. It takes effect at once.
- That row also holds `ip_salt`, a random value the migration generates once, the first time it runs. It is mixed into the hashes stored in `public.request_form_attempts`, so the table never holds a visitor's IP address or email in readable form. It is not a secret you manage: it never leaves the database, no API role can read it, and it is different on dev and prod because each database generates its own. If it is ever changed, the only effect is that the counters start again from zero.
- Nobody outside the platform admins is emailed when a request comes in. `dispatch-notification-emails` escapes the request's text before putting it in the email.
- Testing by hand or with the Supabase e2e suite from one machine counts towards the per-address limit. When "Too many requests right now" shows up on a test project, run `delete from public.request_form_attempts;` in the SQL editor.
- A captcha is not used. One can be added later in front of the same function without changing these limits.
- Shared edge function code lives in `supabase/functions/_shared/` (`club-access.ts`, and `notification-target.ts`, which the app imports too so emails and the app open the same screens). It is bundled into the functions that import it by `supabase functions deploy`; it is not a function itself and is not listed in the workflow or in `supabase/config.toml`. Tests: `deno test supabase/functions/_shared/`.

### Push Notifications (web push, optional)

Push needs one key pair per environment (VAPID). Without it everything else works: admins see "Push is not set up for this app yet" in notification settings, nobody else sees anything about push, and the dispatch function skips push.

1. Make a pair: `node scripts/generate-vapid-keys.mjs` (run it once for dev and once for prod; nothing is saved).
2. GitHub, repository Settings, Environments, `dev` (then `prod`), Environment secrets:
   - `VAPID_PUBLIC_KEY`: the public key
   - `VAPID_PRIVATE_KEY`: the private key (secret)
   - `VAPID_SUBJECT`: `mailto:` and an address someone reads, for example `mailto:owner@example.com`
   The "Sync Edge Function Secrets" step of `.github/workflows/supabase-migrations.yml` copies all three to the Supabase function secrets on its next run (all three or none). They can also be set by hand: `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...`.
3. Vercel, Project, Settings, Environment Variables, for the matching environment: `VITE_VAPID_PUBLIC_KEY` = the same public key. Redeploy the web app (the value is built in).
4. Check: sign in on a phone or in Chrome, open Notification settings, "Turn on push", then "Send a test".

The private key never goes in a `VITE_*` variable. Replacing the pair later ends every device's subscription: each person turns push on again. Delivery uses the same `dispatch-notification-emails` function and the same database scheduler as email (jobs `sktr-dispatch-push`, every minute, and `sktr-trim-push-history`, daily).

## Rotation Policy

- Rotate anon and service-role keys on:
  - team member offboarding
  - accidental exposure
  - scheduled quarterly security maintenance
- After rotation:
  - update environment stores
  - verify app auth/read/write flows
  - invalidate old credentials

## Least-Privilege Guidance

- Frontend should use anon key + RLS-protected tables only.
- Privileged operations use service role only in controlled server context:
  - migrations
  - profile creation outside invite acceptance and club admin first access (those run as database functions, see `SUPABASE_RLS_POLICY_MATRIX.md`)
  - admin batch jobs
- Do not embed service-role actions directly in client routes/components.
- `ALLOW_LOCAL_PASSWORD_RESET_PREVIEW` (edge function secret): leave unset on every hosted project. When it is `true`, `local-preview-password-reset` hands a password reset link for any email to any caller. Only for a local Supabase stack.
- Auth settings: keep "Confirm email" on (or public sign-ups off). Platform admin access and club admin first access are granted by account email.

## Developer Checklist

- [x] Environment tiers defined (local/dev/prod)
- [x] Frontend and server variables documented
- [x] Secret handling and rotation guidance documented
- [x] Bootstrap steps documented with `.env` template

# PaceLab Supabase Environment + Secrets Setup

Last updated: October 6, 2026

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
- `NOTIFICATION_FROM_EMAIL` (sender identity for queued emails and invite emails)
- `PUBLIC_APP_URL` (where the app is hosted for that environment, for example `https://app.example.com`; invite email links are built from it)

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

### Public Club Request Form (no secret, nothing to set up)

The "Request access for your club" form is protected inside the database by migration `20261006181000_request_form_protection.sql`. It needs no secret, no environment variable, no dashboard setting and no outside service.

- The limits (3 requests per email per 24 hours, 5 per network address per 24 hours, 30 per hour and 150 per day from everyone together) and the minimum fill time are columns of the one row in `public.request_form_settings`. To change one, run a single statement in the Supabase SQL editor, for example `update public.request_form_settings set per_ip_max = 10;`. It takes effect at once.
- That row also holds `ip_salt`, a random value the migration generates once, the first time it runs. It is mixed into the hashes stored in `public.request_form_attempts`, so the table never holds a visitor's IP address or email in readable form. It is not a secret you manage: it never leaves the database, no API role can read it, and it is different on dev and prod because each database generates its own. If it is ever changed, the only effect is that the counters start again from zero.
- Nobody outside the platform admins is emailed when a request comes in. `dispatch-notification-emails` escapes the request's text before putting it in the email.
- Testing by hand or with the Supabase e2e suite from one machine counts towards the per-address limit. When "Too many requests right now" shows up on a test project, run `delete from public.request_form_attempts;` in the SQL editor.
- A captcha is not used. One can be added later in front of the same function without changing these limits.
- Shared edge function code lives in `supabase/functions/_shared/` (currently `club-access.ts`). It is bundled into the functions that import it by `supabase functions deploy`; it is not a function itself and is not listed in the workflow or in `supabase/config.toml`. Tests: `deno test supabase/functions/_shared/`.

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

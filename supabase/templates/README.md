# Supabase account emails

Supabase Auth sends these emails itself (not our edge functions): confirming a new sign-up,
resetting a password and changing an email address. Without these files it sends its plain default
email from Supabase's own address. They match our invite emails (`supabase/functions/send-invite-email/invite-email.ts`).

The hosted project does not read this folder. Paste each file into the dashboard:
**Authentication > Emails > Templates**, pick the template, set the subject, paste the HTML into the
body (Source), save.

| Dashboard template | File | Subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Confirm your email for SKTR Coach |
| Reset password | `reset-password.html` | Reset your SKTR Coach password |
| Change email address | `change-email.html` | Confirm your new email for SKTR Coach |
| Magic link | `magic-link.html` | Your SKTR Coach sign-in link |
| Invite user | `invite.html` | You are invited to SKTR Coach |

Where the app triggers them: confirm signup when an athlete creates an account from a join code
(`src/app/(auth)/join/[code]/page.tsx`), reset password from the sign-in page, change email from the
account page. Magic link and invite are not used by the app today; they are here so a dashboard invite
or a future sign-in link is not the plain default either.

The `{{ .ConfirmationURL }}`, `{{ .Email }}` and `{{ .NewEmail }}` placeholders are filled in by Supabase.
Keep them exactly as written.

## Send them from our own address (custom SMTP)

Supabase's built-in mail server is for testing: it is heavily rate limited and is not meant for real
users. Point Supabase at Resend, which already sends our invites and notifications:

**Authentication > Emails > SMTP Settings** (Project Settings > Authentication on older dashboards)

- Enable custom SMTP: on
- Sender email: the same address as the `NOTIFICATION_FROM_EMAIL` secret (on our verified Resend domain)
- Sender name: SKTR Coach
- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: a Resend API key (the `RESEND_API_KEY` secret, or a new key made for this)

Then check **Authentication > Rate Limits**: the emails-per-hour limit can be raised once custom SMTP is on.

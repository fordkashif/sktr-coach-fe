// The one email a new club owner gets when their request is approved. Pure: no network, no Deno APIs.
// Same look as the invite and notification emails, with a real plain-text part, so mail filters see
// one consistent sender.

const APP_NAME = "SKTR Coach"
const BRAND_BLUE = "#2152ff"
const FONT_STACK = "Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function e(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

function clean(value: string | null | undefined, maxLength = 80): string {
  return (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
}

/**
 * Where links in the email point. The address set on the server (PUBLIC_APP_URL) wins, so the link
 * always carries the app's own domain whatever address the platform admin happened to be browsing.
 * The browser's address is used only for local development, or when the server has none set.
 */
export function chooseAppBaseUrl(serverUrl: string | null, browserUrl: string | null, isLocal: (origin: string | null) => boolean): string | null {
  if (browserUrl && isLocal(browserUrl)) return browserUrl
  return serverUrl ?? browserUrl
}

export function renderClubApprovalEmail(input: { clubName: string | null; recipientName: string | null; recipientEmail: string; link: string }) {
  const club = clean(input.clubName) || "Your club"
  const firstName = clean(input.recipientName).split(" ")[0] ?? ""
  const subject = `${club} is approved on ${APP_NAME}`
  const headline = `${club} is approved`
  const intro = `${firstName ? `Hi ${firstName}. ` : ""}Your request to bring ${club} onto ${APP_NAME} has been approved.`
  const whatNext = "Open your account to finish setting up: you will choose how you sign in, then add your teams and invite your coaches."
  const buttonLabel = "Set up my account"
  const validity = `This link is just for ${input.recipientEmail} and works one time.`
  const help = "Questions? Reply to this email or write to support@thesktr.com."

  const text = [headline, "", intro, "", whatNext, "", `${buttonLabel}:`, input.link, "", validity, "", help, "", `Sent by ${APP_NAME}.`].join("\n")

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;color:#0b1020;font-family:${FONT_STACK};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;">${e(intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr>
<td style="padding:0 4px 20px;font-family:${FONT_STACK};font-size:18px;line-height:24px;font-weight:800;letter-spacing:-0.01em;color:${BRAND_BLUE};">${e(APP_NAME)}</td>
</tr>
<tr>
<td style="border:2px solid #e6e9f2;border-radius:20px;padding:32px 28px;background-color:#ffffff;">
<h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:28px;line-height:34px;font-weight:800;letter-spacing:-0.02em;color:#0b1020;">${e(headline)}</h1>
<p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:17px;line-height:26px;color:#0b1020;">${e(intro)}</p>
<p style="margin:0 0 28px;font-family:${FONT_STACK};font-size:16px;line-height:25px;color:#4a5169;">${e(whatNext)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr>
<td align="center" bgcolor="${BRAND_BLUE}" style="border-radius:14px;background-color:${BRAND_BLUE};">
<a href="${e(input.link)}" style="display:block;padding:17px 24px;font-family:${FONT_STACK};font-size:18px;line-height:22px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;">${e(buttonLabel)}</a>
</td>
</tr>
</table>
<p style="margin:24px 0 6px;font-family:${FONT_STACK};font-size:14px;line-height:21px;color:#4a5169;">Button not working? Copy this link into your browser:</p>
<p style="margin:0 0 24px;font-family:${FONT_STACK};font-size:14px;line-height:21px;word-break:break-all;"><a href="${e(input.link)}" style="color:${BRAND_BLUE};text-decoration:underline;">${e(input.link)}</a></p>
<p style="margin:0;padding:14px 16px;border-radius:12px;background-color:#eef2ff;font-family:${FONT_STACK};font-size:14px;line-height:21px;color:#0b1020;">${e(validity)}</p>
</td>
</tr>
<tr>
<td style="padding:20px 4px 0;font-family:${FONT_STACK};font-size:13px;line-height:20px;color:#6b7289;">
<p style="margin:0 0 6px;">${e(help)}</p>
<p style="margin:0;">Sent by ${e(APP_NAME)}.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`

  return { subject, text, html }
}

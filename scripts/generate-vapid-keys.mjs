#!/usr/bin/env node
// Makes the key pair for push notifications (VAPID, RFC 8292). Node built-in crypto only.
//
//   node scripts/generate-vapid-keys.mjs            prints the values and where each one goes
//   node scripts/generate-vapid-keys.mjs --json     prints {"publicKey":"...","privateKey":"..."}
//
// Run it ONCE per environment (dev and prod get their own pair) and keep the private key secret.
// Making a new pair later signs every device out of push: each person has to turn it on again.
import { generateKeyPairSync } from "node:crypto"

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
const jwk = privateKey.export({ format: "jwk" })

const fromBase64Url = (value) => Buffer.from(value, "base64url")
// The public key the browser wants: the uncompressed point, 0x04 then x then y (65 bytes).
const publicKey = Buffer.concat([Buffer.from([4]), fromBase64Url(jwk.x), fromBase64Url(jwk.y)]).toString("base64url")
// The private key: the 32 byte scalar.
const privateScalar = fromBase64Url(jwk.d).toString("base64url")

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ publicKey, privateKey: privateScalar }))
} else {
  console.log(`Push notification keys (VAPID). Made just now; nothing was saved anywhere.

Public key (not a secret):
  ${publicKey}

Private key (SECRET, never commit it, never put it in the web app):
  ${privateScalar}

Where each value goes, once for dev and once for prod (use a different pair for each):

  1. GitHub, repository Settings > Environments > dev (or prod) > Environment secrets:
       VAPID_PUBLIC_KEY    the public key above
       VAPID_PRIVATE_KEY   the private key above
       VAPID_SUBJECT       mailto: and an address you read, for example mailto:you@example.com
     The "Supabase Migrations" workflow copies them to the Supabase function secrets on its next run.

  2. Vercel, Project > Settings > Environment Variables, for the matching environment:
       VITE_VAPID_PUBLIC_KEY   the public key above (the same value as VAPID_PUBLIC_KEY)
     Then redeploy the web app, because the value is built into it.

Until both are done the app says "Push is not set up for this app yet" to admins and shows nothing
about push to anyone else.`)
}

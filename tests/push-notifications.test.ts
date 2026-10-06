import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NOTIFICATION_PREFERENCE_CATEGORIES } from "../src/lib/notification-categories"
import { PUSH_DEFAULT_ON_EVENT_TYPES, pushDefaultEnabled, pushDefaultForEventTypes } from "../src/lib/notifications/push-defaults"
import {
  deviceLabelFromUserAgent,
  enableFailureMessage,
  isIosUserAgent,
  lastUsedLabel,
  pushSectionCopy,
  pushSectionKind,
  vapidKeyBytes,
  type PushEnvironment,
} from "../src/lib/push/push-state"
import { isAllowedPushEndpoint, messageSenderName, pushPayloadJson, pushTag, renderPushMessage, safePushPath } from "../supabase/functions/_shared/push-message"
import {
  base64UrlDecode,
  base64UrlEncode,
  buildPushRequest,
  createVapidAuthorization,
  createVapidToken,
  decryptPushPayload,
  encryptPushPayload,
  loadVapidKeys,
  MAX_PUSH_PLAINTEXT_BYTES,
  normalizeVapidSubject,
  pushEndpointOrigin,
  pushTopic,
  readPushResponse,
  VAPID_TOKEN_SECONDS,
} from "../supabase/functions/_shared/web-push"

const ROOT = process.cwd()
const text = (value: string) => new TextEncoder().encode(value)

// RFC 8291, appendix A. Every value below is copied from the RFC.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  senderPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  receiverPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  receiverPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
}
const receiver = { publicKey: base64UrlDecode(RFC.receiverPublic), privateKey: base64UrlDecode(RFC.receiverPrivate) }

function freshVapid(): { publicKey: string; privateKey: string } {
  return JSON.parse(execFileSync(process.execPath, [join(ROOT, "scripts/generate-vapid-keys.mjs"), "--json"], { encoding: "utf8" }))
}

test("payload encryption reproduces the RFC 8291 example byte for byte", async () => {
  const body = await encryptPushPayload({
    plaintext: text(RFC.plaintext),
    p256dh: RFC.receiverPublic,
    auth: RFC.auth,
    salt: base64UrlDecode(RFC.salt),
    senderKeys: { publicKey: base64UrlDecode(RFC.senderPublic), privateKey: base64UrlDecode(RFC.senderPrivate) },
  })
  assert.equal(base64UrlEncode(body), RFC.body)
  // The header: salt, record size 4096, key length 65, then the sender's public key.
  assert.equal(base64UrlEncode(body.slice(0, 16)), RFC.salt)
  assert.deepEqual([...body.slice(16, 21)], [0, 0, 16, 0, 65])
  assert.equal(base64UrlEncode(body.slice(21, 86)), RFC.senderPublic)
})

test("the browser side opens the RFC example and anything we encrypt", async () => {
  assert.equal(new TextDecoder().decode(await decryptPushPayload(base64UrlDecode(RFC.body), receiver, RFC.auth)), RFC.plaintext)

  const message = JSON.stringify({ title: "New message", body: "You have a new message from Zoë.", url: "/athlete/messages", tag: "t" })
  const first = await encryptPushPayload({ plaintext: text(message), p256dh: RFC.receiverPublic, auth: RFC.auth })
  const second = await encryptPushPayload({ plaintext: text(message), p256dh: RFC.receiverPublic, auth: RFC.auth })
  assert.equal(new TextDecoder().decode(await decryptPushPayload(first, receiver, RFC.auth)), message)
  // A fresh salt and a fresh sender key every time: the same message never looks the same twice.
  assert.notEqual(base64UrlEncode(first), base64UrlEncode(second))
  assert.notEqual(base64UrlEncode(first.slice(21, 86)), base64UrlEncode(second.slice(21, 86)))
  assert.equal(first.length, 86 + text(message).length + 1 + 16)
  // The wrong auth secret or a changed byte does not open.
  await assert.rejects(decryptPushPayload(first, receiver, "AAAAAAAAAAAAAAAAAAAAAA"))
  const tampered = first.slice()
  tampered[tampered.length - 1] ^= 1
  await assert.rejects(decryptPushPayload(tampered, receiver, RFC.auth))
})

test("payload encryption refuses a subscription it cannot use", async () => {
  await assert.rejects(encryptPushPayload({ plaintext: text("x"), p256dh: "AAAA", auth: RFC.auth }), /P-256/)
  await assert.rejects(encryptPushPayload({ plaintext: text("x"), p256dh: RFC.receiverPublic, auth: "AAAA" }), /16 bytes/)
  await assert.rejects(encryptPushPayload({ plaintext: text("x"), p256dh: "not base64!", auth: RFC.auth }))
  await assert.rejects(encryptPushPayload({ plaintext: new Uint8Array(MAX_PUSH_PLAINTEXT_BYTES + 1), p256dh: RFC.receiverPublic, auth: RFC.auth }), /too long/)
  const largest = await encryptPushPayload({ plaintext: new Uint8Array(MAX_PUSH_PLAINTEXT_BYTES), p256dh: RFC.receiverPublic, auth: RFC.auth })
  assert.ok(largest.length <= 4096)
})

test("base64url helpers", () => {
  assert.equal(base64UrlEncode(new Uint8Array([251, 255, 254])), "-__-")
  assert.deepEqual([...base64UrlDecode("-__-")], [251, 255, 254])
  assert.deepEqual([...base64UrlDecode("+//+")], [251, 255, 254])
  assert.deepEqual([...base64UrlDecode("AA==")], [0])
  assert.throws(() => base64UrlDecode("a b"))
})

test("the key script makes a pair the server accepts, and a VAPID token of the right shape", async () => {
  const made = freshVapid()
  assert.match(made.publicKey, /^B[\w-]{86}$/)
  assert.match(made.privateKey, /^[\w-]{43}$/)
  assert.ok(vapidKeyBytes(made.publicKey), "the app accepts the public key")

  const loaded = await loadVapidKeys(made.publicKey, made.privateKey, "owner@example.com")
  assert.ok(loaded.ok)
  if (!loaded.ok) return
  assert.equal(loaded.keys.subject, "mailto:owner@example.com")

  const now = 1_792_000_000
  const token = await createVapidToken(loaded.keys, "https://fcm.googleapis.com", now)
  const [header, claims, signature] = token.split(".")
  assert.equal(token.split(".").length, 3)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(base64UrlDecode(header))), { typ: "JWT", alg: "ES256" })
  assert.deepEqual(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims))), { aud: "https://fcm.googleapis.com", exp: now + VAPID_TOKEN_SECONDS, sub: "mailto:owner@example.com" })
  assert.ok(VAPID_TOKEN_SECONDS <= 24 * 60 * 60, "a push service refuses a token good for more than a day")
  // ES256 as a JWT wants it: r and s side by side, 64 bytes, and it verifies with the public key.
  assert.equal(base64UrlDecode(signature).length, 64)
  const verifyKey = await crypto.subtle.importKey("raw", base64UrlDecode(made.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, base64UrlDecode(signature), text(`${header}.${claims}`)), true)
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, base64UrlDecode(signature), text(`${header}.${claims}x`)), false)

  const authorization = await createVapidAuthorization(loaded.keys, "https://updates.push.services.mozilla.com/wpush/v2/abc", now)
  assert.match(authorization ?? "", /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=B[\w-]{86}$/)
  assert.ok(authorization?.endsWith(`k=${made.publicKey}`))
  assert.equal(JSON.parse(new TextDecoder().decode(base64UrlDecode((authorization ?? "").split(".")[1]))).aud, "https://updates.push.services.mozilla.com")
  assert.equal(await createVapidAuthorization(loaded.keys, "not a url", now), null)
  assert.equal(await createVapidAuthorization(loaded.keys, "http://fcm.googleapis.com/x", now), null)
})

test("wrong push settings are named, not guessed at", async () => {
  const a = freshVapid()
  const b = freshVapid()
  const problem = async (...args: Parameters<typeof loadVapidKeys>) => {
    const result = await loadVapidKeys(...args)
    return result.ok ? "ok" : result.problem
  }
  assert.equal(await problem(undefined, undefined, undefined), "missing")
  assert.equal(await problem(a.publicKey, "", "mailto:a@b.co"), "missing")
  assert.equal(await problem(a.publicKey, a.privateKey, "  "), "missing")
  assert.equal(await problem(a.publicKey, a.privateKey, "just a name"), "bad_subject")
  assert.equal(await problem("AAAA", a.privateKey, "mailto:a@b.co"), "bad_public_key")
  assert.equal(await problem("???", a.privateKey, "mailto:a@b.co"), "bad_public_key")
  assert.equal(await problem(a.publicKey, "AAAA", "mailto:a@b.co"), "bad_private_key")
  assert.equal(await problem(a.publicKey, b.privateKey, "mailto:a@b.co"), "keys_do_not_match")
  assert.equal(await problem(a.privateKey, a.publicKey, "mailto:a@b.co"), "bad_public_key")
  assert.equal(await problem(` ${a.publicKey} `, ` ${a.privateKey}\n`, "https://sktr.example/contact"), "ok")

  assert.equal(normalizeVapidSubject("mailto:a@b.co"), "mailto:a@b.co")
  assert.equal(normalizeVapidSubject("a@b.co"), "mailto:a@b.co")
  assert.equal(normalizeVapidSubject("http://b.co"), null)
  assert.equal(pushEndpointOrigin("https://fcm.googleapis.com/fcm/send/abc"), "https://fcm.googleapis.com")
})

test("the push request: headers, topic and how the answer is read", async () => {
  const made = freshVapid()
  const loaded = await loadVapidKeys(made.publicKey, made.privateKey, "mailto:a@b.co")
  assert.ok(loaded.ok)
  if (!loaded.ok) return
  const request = await buildPushRequest({
    keys: loaded.keys, endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: RFC.receiverPublic, auth: RFC.auth,
    payload: '{"title":"T"}', ttlSeconds: 3600.9, urgency: "high", tag: "direct_message_received:1", nowSeconds: 1_792_000_000,
  })
  assert.ok(request)
  assert.equal(request?.url, "https://fcm.googleapis.com/fcm/send/abc")
  assert.deepEqual(Object.keys(request?.headers ?? {}).sort(), ["Authorization", "Content-Encoding", "Content-Type", "TTL", "Topic", "Urgency"])
  assert.equal(request?.headers.TTL, "3600")
  assert.equal(request?.headers.Urgency, "high")
  assert.equal(request?.headers["Content-Encoding"], "aes128gcm")
  assert.equal(new TextDecoder().decode(await decryptPushPayload(request!.body, receiver, RFC.auth)), '{"title":"T"}')

  // A topic is at most 32 URL-safe characters, the same for the same tag, and does not show the tag.
  const topic = await pushTopic("direct_message_received:1")
  assert.match(topic, /^[\w-]{32}$/)
  assert.equal(topic, await pushTopic("direct_message_received:1"))
  assert.notEqual(topic, await pushTopic("direct_message_received:2"))
  assert.ok(!topic.includes("message"))

  assert.deepEqual(readPushResponse(201), { result: "sent" })
  assert.deepEqual(readPushResponse(200), { result: "sent" })
  assert.equal(readPushResponse(404).result, "gone")
  assert.equal(readPushResponse(410).result, "gone")
  assert.deepEqual([readPushResponse(429).result, (readPushResponse(429) as { stop: boolean }).stop], ["retry", true])
  assert.deepEqual([readPushResponse(503).result, (readPushResponse(503) as { stop: boolean }).stop], ["retry", false])
  for (const status of [400, 401, 403, 413, 301]) assert.equal(readPushResponse(status).result, "failed")
})

test("what a push says: fixed sentences, the sender's name for a message, nothing else from data", () => {
  const A = "0f8fad5b-d9cb-469f-a165-70867728950e"
  assert.deepEqual(renderPushMessage({ event_type: "direct_message_received", subject: "New message from Coach Rivera", metadata: { thread_id: A } }), {
    title: "New message", body: "You have a new message from Coach Rivera.", tag: `direct_message_received:${A}`, ttlSeconds: 86400, urgency: "high",
  })
  assert.equal(renderPushMessage({ event_type: "direct_message_received", subject: "Something else entirely", metadata: null }).body, "You have a new message.")
  assert.equal(messageSenderName("New message from  Coach\n Rivera\u0007 "), "Coach Rivera")
  assert.equal(messageSenderName(`New message from ${"x".repeat(200)}`).length, 60)

  const secret = "hamstring tear, 8 of 10, do not tell anyone"
  const all = [
    "direct_message_received", "announcement_posted", "training_plan_published", "training_plan_updated", "test_week_published", "test_week_reopened",
    "session_note_added", "athlete_report_shared", "competition_entry_added", "athlete_pain_reported", "athlete_low_readiness", "athlete_unavailable",
    "athlete_available_again", "athlete_session_completed", "athlete_test_results_submitted", "reminder_session_today", "reminder_checkin",
    "reminder_test_week_closing", "reminder_test_week_closing_coach", "reminder_athletes_not_logged", "push_test", "a_type_added_next_year",
  ]
  for (const eventType of all) {
    const message = renderPushMessage({ event_type: eventType, subject: secret, metadata: { note: secret, athlete_name: "Maya Chen", athlete_id: A } })
    const sent = pushPayloadJson(message, "/notifications")
    assert.ok(!sent.includes("hamstring") && !sent.includes("Maya") && !sent.includes("8 of 10"), `${eventType} leaked: ${sent}`)
    assert.ok(!sent.includes(String.fromCharCode(8212)), "no em dash")
    assert.ok(message.title.length <= 40 && message.body.length <= 120 && message.ttlSeconds > 0)
  }
  // Health reports to coaches: no name, no detail, and not even the tag says "pain".
  const pain = renderPushMessage({ event_type: "athlete_pain_reported", subject: "Maya Chen reported pain", metadata: { athlete_id: A } })
  assert.equal(pain.title, "An athlete needs a look")
  assert.equal(pain.tag, `athlete_update:${A}`)
  assert.ok(!/pain|injur|readiness/i.test(JSON.stringify(pain)))
  // Reminders do not arrive the next day; a test does not arrive an hour late.
  assert.equal(renderPushMessage({ event_type: "reminder_session_today", subject: null, metadata: null }).ttlSeconds, 8 * 3600)
  assert.equal(renderPushMessage({ event_type: "push_test", subject: null, metadata: null }).ttlSeconds, 600)
  assert.deepEqual(renderPushMessage({ event_type: "a_type_added_next_year", subject: "x", metadata: null }), {
    title: "SKTR Coach", body: "You have a new notification.", tag: "a_type_added_next_year", ttlSeconds: 86400, urgency: "normal",
  })
  assert.equal(pushTag("weird type!<>", { thread_id: "not-a-uuid" }), "weirdtype")
  assert.equal(pushTag("", null), "notification")
})

test("a push only opens a path inside the app", () => {
  assert.equal(safePushPath("/athlete/log?date=2026-10-16"), "/athlete/log?date=2026-10-16")
  for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "", null, "athlete/log", "/a\\b", `/${"x".repeat(400)}`, "/a\nb"]) {
    assert.equal(safePushPath(bad), "/notifications", String(bad))
  }
  assert.deepEqual(JSON.parse(pushPayloadJson({ title: "T", body: "B", tag: "g", ttlSeconds: 1, urgency: "normal" }, "//evil.example")), { title: "T", body: "B", url: "/notifications", tag: "g" })
})

test("the server only posts to known push services", () => {
  for (const good of [
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGfx",
    "https://wns2-by3p.notify.windows.com/w/?token=BQYAAAD",
    "https://jmt17.google.com/fcm/send/abc",
  ]) assert.equal(isAllowedPushEndpoint(good), true, good)
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/abc", "https://fcm.googleapis.com.evil.example/x", "https://evilfcm.googleapis.com.example/x", "https://localhost/x",
    "https://169.254.169.254/latest", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://notfcm-googleapis.com/x",
    "https://xpush.apple.com/x", "", null, "nonsense", `https://fcm.googleapis.com/${"x".repeat(2100)}`,
  ]) assert.equal(isAllowedPushEndpoint(bad), false, String(bad))
})

test("which updates are pushed by default", () => {
  for (const on of [
    "direct_message_received", "announcement_posted", "training_plan_published", "test_week_published", "athlete_pain_reported", "athlete_report_shared",
    "reminder_session_today", "reminder_checkin", "reminder_test_week_closing", "reminder_test_week_closing_coach",
  ]) assert.equal(pushDefaultEnabled(on), true, on)
  for (const off of ["reminder_athletes_not_logged", "athlete_session_completed", "athlete_test_results_submitted", "training_plan_updated", "coach_team_assigned", "anything_new"]) {
    assert.equal(pushDefaultEnabled(off), false, off)
  }
  assert.equal(pushDefaultForEventTypes(["test_week_published", "test_week_reopened"]), true)
  assert.equal(pushDefaultForEventTypes([]), false)

  // As the settings screen shows them, per row.
  const onByDefault = NOTIFICATION_PREFERENCE_CATEGORIES.filter((category) => pushDefaultForEventTypes(category.eventTypes)).map((category) => category.key)
  for (const key of [
    "training-plans", "test-weeks", "coach-reports", "announcements", "direct-messages", "pain-reports",
    "reminder-session-today", "reminder-checkin", "reminder-test-week-closing", "reminder-test-week-closing-coach",
  ]) assert.ok(onByDefault.includes(key), `${key} should be pushed by default`)
  for (const key of ["reminder-athletes-not-logged", "session-activity", "test-results", "training-plan-updates", "club-account", "tenant-provisioning"]) {
    assert.ok(!onByDefault.includes(key), `${key} should not be pushed by default`)
  }
  // Every default-on type is one the settings screen can switch off.
  const known = new Set(NOTIFICATION_PREFERENCE_CATEGORIES.flatMap((category) => category.eventTypes))
  for (const type of PUSH_DEFAULT_ON_EVENT_TYPES) assert.ok(known.has(type), `${type} has no settings row`)
  // A row never mixes pushed and not pushed types: its one switch would lie about one of them.
  for (const category of NOTIFICATION_PREFERENCE_CATEGORIES) {
    const states = new Set(category.eventTypes.map(pushDefaultEnabled))
    assert.equal(states.size, 1, `${category.key} mixes push defaults`)
  }
})

test("the database and the settings screen agree on the push defaults", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/20261016120000_push_notifications.sql"), "utf8")
  const body = /create or replace function public\.push_default_enabled[\s\S]*?p_event_type in \(([\s\S]*?)\), false\)/.exec(sql)
  assert.ok(body, "push_default_enabled not found in the migration")
  const inSql = [...(body?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).filter((type) => type !== "push_test")
  assert.deepEqual([...inSql].sort(), [...PUSH_DEFAULT_ON_EVENT_TYPES].sort())
})

const READY: PushEnvironment = {
  configured: true, isAdmin: false, hasServiceWorker: true, hasPushManager: true, hasNotification: true, isIos: false, isStandalone: false, permission: "default", subscribed: false,
}

test("the settings section: every state", () => {
  assert.equal(pushSectionKind(READY), "off")
  assert.equal(pushSectionKind({ ...READY, permission: "granted" }), "off") // allowed, but this device is not registered
  assert.equal(pushSectionKind({ ...READY, permission: "granted", subscribed: true }), "on")
  assert.equal(pushSectionKind({ ...READY, permission: "default", subscribed: true }), "off") // permission was reset
  assert.equal(pushSectionKind({ ...READY, permission: "denied" }), "blocked")
  assert.equal(pushSectionKind({ ...READY, permission: "denied", subscribed: true }), "blocked")
  assert.equal(pushSectionKind({ ...READY, hasPushManager: false }), "unsupported")
  assert.equal(pushSectionKind({ ...READY, hasServiceWorker: false }), "unsupported")
  assert.equal(pushSectionKind({ ...READY, hasNotification: false }), "unsupported")
  // iPhone: Safari in a tab first needs the Home Screen, whatever else is true.
  assert.equal(pushSectionKind({ ...READY, isIos: true, hasPushManager: false, hasNotification: false }), "ios-install")
  assert.equal(pushSectionKind({ ...READY, isIos: true }), "ios-install")
  assert.equal(pushSectionKind({ ...READY, isIos: true, isStandalone: true }), "off")
  assert.equal(pushSectionKind({ ...READY, isIos: true, isStandalone: true, permission: "granted", subscribed: true }), "on")
  // An old iPhone (before 16.4) opened from the Home Screen has no push at all.
  assert.equal(pushSectionKind({ ...READY, isIos: true, isStandalone: true, hasPushManager: false }), "unsupported")
  // Not set up: admins are told, nobody else sees anything, whatever the browser can do.
  assert.equal(pushSectionKind({ ...READY, configured: false }), "hidden")
  assert.equal(pushSectionKind({ ...READY, configured: false, isAdmin: true }), "not-set-up")
  assert.equal(pushSectionKind({ ...READY, configured: false, isAdmin: true, permission: "granted", subscribed: true }), "not-set-up")
  assert.equal(pushSectionKind({ ...READY, configured: false, isIos: true }), "hidden")
})

test("the settings section: what each state offers and says", () => {
  const offers = (env: PushEnvironment) => {
    const copy = pushSectionCopy(env)
    return [copy.kind, copy.canTurnOn, copy.canTest, copy.canTurnOff, copy.showSwitches].join(",")
  }
  assert.equal(offers(READY), "off,true,false,false,true")
  assert.equal(offers({ ...READY, permission: "granted", subscribed: true }), "on,false,true,true,true")
  assert.equal(offers({ ...READY, permission: "denied" }), "blocked,false,false,false,true")
  assert.equal(offers({ ...READY, hasPushManager: false }), "unsupported,false,false,false,true")
  assert.equal(offers({ ...READY, isIos: true }), "ios-install,false,false,false,true")
  assert.equal(offers({ ...READY, configured: false }), "hidden,false,false,false,false")
  assert.equal(offers({ ...READY, configured: false, isAdmin: true }), "not-set-up,false,false,false,false")

  assert.equal(pushSectionCopy({ ...READY, permission: "granted", subscribed: true }).status, "On for this device")
  assert.equal(pushSectionCopy(READY).status, "Off on this device")
  assert.match(pushSectionCopy(READY).detail ?? "", /will ask/)
  assert.equal(pushSectionCopy({ ...READY, permission: "granted" }).detail, null) // no question will appear
  const blocked = pushSectionCopy({ ...READY, permission: "denied" })
  assert.equal(blocked.status, "Blocked in your browser settings")
  assert.equal(blocked.tone, "coral")
  assert.match(blocked.detail ?? "", /To unblock/)
  assert.equal(pushSectionCopy({ ...READY, hasPushManager: false }).status, "Not supported on this browser")
  const ios = pushSectionCopy({ ...READY, isIos: true })
  assert.equal(ios.status, "Add SKTR Coach to your Home Screen first")
  assert.equal(ios.steps.length, 2)
  assert.match(ios.steps[0], /Share/)
  assert.match(ios.steps[1], /Add to Home Screen/)
  assert.equal(pushSectionCopy({ ...READY, configured: false, isAdmin: true }).detail, "Push is not set up for this app yet.")
  assert.equal(pushSectionCopy({ ...READY, configured: false }).detail, null)

  for (const reason of ["denied", "dismissed", "unsupported", "browser-not-supported", "not-installed", "error"] as const) {
    assert.ok(enableFailureMessage(reason).length > 20)
  }
  const every = [READY, { ...READY, permission: "denied" as const }, { ...READY, isIos: true }, { ...READY, hasPushManager: false }].map((env) => JSON.stringify(pushSectionCopy(env))).join("")
  assert.ok(!every.includes(String.fromCharCode(8212)), "no em dash in the words")
})

test("device names, iPhone detection and 'last used'", () => {
  const ua = {
    androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
    macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  }
  assert.equal(deviceLabelFromUserAgent(ua.androidChrome), "Chrome on Android")
  assert.equal(deviceLabelFromUserAgent(ua.iphoneSafari), "Safari on iPhone")
  assert.equal(deviceLabelFromUserAgent(ua.iphoneSafari, { standalone: true }), "SKTR Coach app on iPhone")
  assert.equal(deviceLabelFromUserAgent(ua.macSafari), "Safari on Mac")
  assert.equal(deviceLabelFromUserAgent(ua.macSafari, { touchPoints: 5 }), "Safari on iPad")
  assert.equal(deviceLabelFromUserAgent(ua.winEdge), "Edge on Windows")
  assert.equal(deviceLabelFromUserAgent(ua.winFirefox), "Firefox on Windows")
  assert.equal(deviceLabelFromUserAgent(ua.macChrome), "Chrome on Mac")
  assert.equal(deviceLabelFromUserAgent(ua.samsung), "Samsung Internet on Android")
  assert.equal(deviceLabelFromUserAgent(""), "This device")
  assert.equal(isIosUserAgent(ua.iphoneSafari), true)
  assert.equal(isIosUserAgent(ua.macSafari, 5), true)
  assert.equal(isIosUserAgent(ua.macSafari, 0), false)
  assert.equal(isIosUserAgent(ua.androidChrome, 5), false)

  const now = new Date("2026-10-16T12:00:00Z")
  assert.equal(lastUsedLabel("2026-10-16T11:59:30Z", now), "Just now")
  assert.equal(lastUsedLabel("2026-10-16T11:40:00Z", now), "20 minutes ago")
  assert.equal(lastUsedLabel("2026-10-16T10:59:00Z", now), "1 hour ago")
  assert.equal(lastUsedLabel("2026-10-16T05:00:00Z", now), "7 hours ago")
  assert.equal(lastUsedLabel("2026-10-15T11:00:00Z", now), "Yesterday")
  assert.equal(lastUsedLabel("2026-10-13T11:00:00Z", now), "3 days ago")
  assert.equal(lastUsedLabel("2026-08-01T11:00:00Z", now), "1 Aug 2026")
  assert.equal(lastUsedLabel(null, now), "Never")
  assert.equal(lastUsedLabel("nonsense", now), "Never")

  assert.equal(vapidKeyBytes(RFC.senderPublic)?.length, 65)
  assert.equal(vapidKeyBytes(RFC.senderPrivate), null)
  assert.equal(vapidKeyBytes(""), null)
  assert.equal(vapidKeyBytes(undefined), null)
  assert.equal(vapidKeyBytes("not a key"), null)
})

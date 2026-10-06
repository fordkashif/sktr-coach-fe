// Web Push, the protocol part. Pure: Web Crypto only, no network, no Deno APIs, no imports.
// Runs the same in Deno (the edge function) and in Node (the tests).
//
//   RFC 8291  Message Encryption for Web Push      encryptPushPayload()
//   RFC 8188  the aes128gcm content coding it uses (one record)
//   RFC 8292  VAPID, how the app server proves who it is   createVapidAuthorization()
//
// The tests (tests/web-push.test.ts) check encryptPushPayload against the worked example in
// RFC 8291 appendix A, byte for byte, and check that a VAPID token verifies with the public key.

const encoder = new TextEncoder()

/** One aes128gcm record. Every push service accepts 4096. */
const RECORD_SIZE = 4096
/** Plaintext limit for one record: record size, minus the 16 byte tag, minus the 1 byte delimiter. */
export const MAX_PUSH_PLAINTEXT_BYTES = RECORD_SIZE - 16 - 1 - 86

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Accepts base64url and plain base64, with or without padding. Throws on anything else. */
export function base64UrlDecode(value: string): Uint8Array {
  const cleaned = value.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")
  if (!/^[A-Za-z0-9+/]*$/.test(cleaned) || cleaned.length % 4 === 1) throw new Error("Not base64url.")
  const binary = atob(cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** A copy in a plain ArrayBuffer, which is what Web Crypto wants in every runtime. */
function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.length)
  new Uint8Array(copy).set(bytes)
  return copy
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buffer(ikm), "HKDF", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buffer(salt), info: buffer(info) }, key, length * 8)
  return new Uint8Array(bits)
}

/** An uncompressed P-256 point: 0x04, then x and y, 65 bytes. */
function isUncompressedPoint(bytes: Uint8Array): boolean {
  return bytes.length === 65 && bytes[0] === 4
}

function privateJwk(publicPoint: Uint8Array, privateScalar: Uint8Array): JsonWebKey {
  return {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(publicPoint.slice(1, 33)),
    y: base64UrlEncode(publicPoint.slice(33, 65)),
    d: base64UrlEncode(privateScalar),
    ext: true,
  }
}

export type PushKeyPair = {
  /** Uncompressed public point, 65 bytes. */
  publicKey: Uint8Array
  /** The private scalar, 32 bytes. */
  privateKey: Uint8Array
}

export type EncryptPushInput = {
  plaintext: Uint8Array
  /** The subscription's public key ("p256dh"), base64url. */
  p256dh: string
  /** The subscription's auth secret, base64url. */
  auth: string
  /** Tests only: a fixed salt (16 bytes). A random one is made otherwise. */
  salt?: Uint8Array
  /** Tests only: a fixed sender key pair. A fresh one is made for every message otherwise. */
  senderKeys?: PushKeyPair
}

/**
 * Encrypts one push message for one subscription. Returns the request body: the aes128gcm header
 * (salt, record size, sender public key) followed by the single encrypted record.
 */
export async function encryptPushPayload(input: EncryptPushInput): Promise<Uint8Array> {
  const receiverPublic = base64UrlDecode(input.p256dh)
  const authSecret = base64UrlDecode(input.auth)
  if (!isUncompressedPoint(receiverPublic)) throw new Error("The subscription key is not a P-256 public key.")
  if (authSecret.length !== 16) throw new Error("The subscription auth secret is not 16 bytes.")
  if (input.plaintext.length > MAX_PUSH_PLAINTEXT_BYTES) throw new Error("The push message is too long.")

  const salt = input.salt ?? crypto.getRandomValues(new Uint8Array(16))
  if (salt.length !== 16) throw new Error("The salt must be 16 bytes.")

  let senderPublic: Uint8Array
  let senderPrivateKey: CryptoKey
  if (input.senderKeys) {
    senderPublic = input.senderKeys.publicKey
    senderPrivateKey = await crypto.subtle.importKey(
      "jwk",
      privateJwk(input.senderKeys.publicKey, input.senderKeys.privateKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    )
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair
    senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
    senderPrivateKey = pair.privateKey
  }

  const receiverKey = await crypto.subtle.importKey("raw", buffer(receiverPublic), { name: "ECDH", namedCurve: "P-256" }, false, [])
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, senderPrivateKey, 256))

  // RFC 8291 section 3.4: mix in the auth secret and both public keys.
  const keyInfo = concat(encoder.encode("WebPush: info\0"), receiverPublic, senderPublic)
  const inputKey = await hkdf(authSecret, sharedSecret, keyInfo, 32)

  // RFC 8188 section 2.2: the content key and the nonce for the first (only) record.
  const contentKey = await hkdf(salt, inputKey, encoder.encode("Content-Encoding: aes128gcm\0"), 16)
  const nonce = await hkdf(salt, inputKey, encoder.encode("Content-Encoding: nonce\0"), 12)

  // 0x02 marks the last record. No extra padding.
  const record = concat(input.plaintext, new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey("raw", buffer(contentKey), "AES-GCM", false, ["encrypt"])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buffer(nonce), tagLength: 128 }, aesKey, buffer(record)))

  const header = new Uint8Array(16 + 4 + 1 + senderPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false)
  header[20] = senderPublic.length
  header.set(senderPublic, 21)

  return concat(header, ciphertext)
}

/**
 * The other direction, for tests: what the browser does with the body. Returns the plaintext.
 */
export async function decryptPushPayload(body: Uint8Array, receiver: PushKeyPair, auth: string): Promise<Uint8Array> {
  const salt = body.slice(0, 16)
  const keyLength = body[20]
  const senderPublic = body.slice(21, 21 + keyLength)
  const ciphertext = body.slice(21 + keyLength)
  const authSecret = base64UrlDecode(auth)

  const receiverPrivate = await crypto.subtle.importKey("jwk", privateJwk(receiver.publicKey, receiver.privateKey), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"])
  const senderKey = await crypto.subtle.importKey("raw", buffer(senderPublic), { name: "ECDH", namedCurve: "P-256" }, false, [])
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, receiverPrivate, 256))
  const inputKey = await hkdf(authSecret, sharedSecret, concat(encoder.encode("WebPush: info\0"), receiver.publicKey, senderPublic), 32)
  const contentKey = await hkdf(salt, inputKey, encoder.encode("Content-Encoding: aes128gcm\0"), 16)
  const nonce = await hkdf(salt, inputKey, encoder.encode("Content-Encoding: nonce\0"), 12)
  const aesKey = await crypto.subtle.importKey("raw", buffer(contentKey), "AES-GCM", false, ["decrypt"])
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(nonce), tagLength: 128 }, aesKey, buffer(ciphertext)))
  let end = record.length - 1
  while (end >= 0 && record[end] === 0) end -= 1
  if (end < 0 || record[end] !== 2) throw new Error("The record has no end marker.")
  return record.slice(0, end)
}

// VAPID -------------------------------------------------------------------------------------------

export type VapidKeys = {
  /** base64url of the 65 byte public point. The same value the browser subscribes with. */
  publicKey: string
  signingKey: CryptoKey
  /** "mailto:someone@example.com" or an https address: who a push service can contact. */
  subject: string
}

export type VapidConfigProblem = "missing" | "bad_public_key" | "bad_private_key" | "keys_do_not_match" | "bad_subject"

/** "mailto:" or "https:" contact, tidied. A bare email address is accepted and given "mailto:". */
export function normalizeVapidSubject(value: string | null | undefined): string | null {
  const subject = (value ?? "").trim()
  if (!subject) return null
  if (/^mailto:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/i.test(subject)) return subject
  if (/^https:\/\/[^\s]+$/i.test(subject)) return subject
  if (/^[^\s@<>:]+@[^\s@<>]+\.[^\s@<>]+$/.test(subject)) return `mailto:${subject}`
  return null
}

/**
 * Reads the three settings and proves the pair belongs together (signs and verifies once), so a
 * wrong key is found here and not as a refusal from every push service.
 */
export async function loadVapidKeys(
  publicKey: string | null | undefined,
  privateKey: string | null | undefined,
  subject: string | null | undefined,
): Promise<{ ok: true; keys: VapidKeys } | { ok: false; problem: VapidConfigProblem }> {
  if (!publicKey?.trim() || !privateKey?.trim() || !subject?.trim()) return { ok: false, problem: "missing" }

  const cleanSubject = normalizeVapidSubject(subject)
  if (!cleanSubject) return { ok: false, problem: "bad_subject" }

  let publicPoint: Uint8Array
  try {
    publicPoint = base64UrlDecode(publicKey)
  } catch {
    return { ok: false, problem: "bad_public_key" }
  }
  if (!isUncompressedPoint(publicPoint)) return { ok: false, problem: "bad_public_key" }

  let scalar: Uint8Array
  try {
    scalar = base64UrlDecode(privateKey)
  } catch {
    return { ok: false, problem: "bad_private_key" }
  }
  if (scalar.length !== 32) return { ok: false, problem: "bad_private_key" }

  let signingKey: CryptoKey
  try {
    signingKey = await crypto.subtle.importKey("jwk", privateJwk(publicPoint, scalar), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
  } catch {
    return { ok: false, problem: "keys_do_not_match" }
  }

  try {
    const verifyKey = await crypto.subtle.importKey("raw", buffer(publicPoint), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    const probe = encoder.encode("sktr-vapid-check")
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, buffer(probe))
    const matches = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, signature, buffer(probe))
    if (!matches) return { ok: false, problem: "keys_do_not_match" }
  } catch {
    return { ok: false, problem: "keys_do_not_match" }
  }

  return { ok: true, keys: { publicKey: base64UrlEncode(publicPoint), signingKey, subject: cleanSubject } }
}

/** How long a VAPID token is good for. The RFC allows at most 24 hours. */
export const VAPID_TOKEN_SECONDS = 12 * 60 * 60

/** The origin of a push endpoint (the token's audience), or null when it is not an https address. */
export function pushEndpointOrigin(endpoint: string): string | null {
  try {
    const url = new URL(endpoint)
    return url.protocol === "https:" ? url.origin : null
  } catch {
    return null
  }
}

/** The signed token for one push service: header.claims.signature, ES256. */
export async function createVapidToken(keys: VapidKeys, audience: string, nowSeconds: number): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })))
  const claims = base64UrlEncode(encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(nowSeconds) + VAPID_TOKEN_SECONDS, sub: keys.subject })))
  const unsigned = `${header}.${claims}`
  // Web Crypto answers with r and s side by side (64 bytes), which is what a JWT wants.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.signingKey, buffer(encoder.encode(unsigned))))
  return `${unsigned}.${base64UrlEncode(signature)}`
}

/** The Authorization header value of a push request (RFC 8292 section 3). */
export async function createVapidAuthorization(keys: VapidKeys, endpoint: string, nowSeconds: number): Promise<string | null> {
  const audience = pushEndpointOrigin(endpoint)
  if (!audience) return null
  return `vapid t=${await createVapidToken(keys, audience, nowSeconds)}, k=${keys.publicKey}`
}

/** A Topic header value: at most 32 characters of the base64url alphabet, the same for the same tag. */
export async function pushTopic(tag: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer(encoder.encode(tag))))
  return base64UrlEncode(digest.slice(0, 24))
}

export type PushRequest = {
  url: string
  headers: Record<string, string>
  body: Uint8Array
}

/** Everything a push service needs for one message. Null when the endpoint is not usable. */
export async function buildPushRequest(params: {
  keys: VapidKeys
  endpoint: string
  p256dh: string
  auth: string
  payload: string
  /** Seconds the push service may hold the message for a device that is offline. */
  ttlSeconds: number
  urgency?: "very-low" | "low" | "normal" | "high"
  tag?: string | null
  nowSeconds: number
}): Promise<PushRequest | null> {
  const authorization = await createVapidAuthorization(params.keys, params.endpoint, params.nowSeconds)
  if (!authorization) return null
  const body = await encryptPushPayload({ plaintext: encoder.encode(params.payload), p256dh: params.p256dh, auth: params.auth })
  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(Math.max(0, Math.floor(params.ttlSeconds))),
    Urgency: params.urgency ?? "normal",
  }
  if (params.tag) headers.Topic = await pushTopic(params.tag)
  return { url: params.endpoint, headers, body }
}

export type PushOutcome =
  | { result: "sent" }
  /** The subscription no longer exists: stop using it. */
  | { result: "gone"; error: string }
  /** Try this one again later. stop: do not send anything else in this run. */
  | { result: "retry"; error: string; stop: boolean }
  /** This message will never be accepted. */
  | { result: "failed"; error: string }

/**
 * Reads a push service's answer.
 *   2xx          accepted
 *   404, 410     the subscription is gone (uninstalled, permission taken away, expired)
 *   429, 5xx     busy: retry later (429 also stops this run)
 *   401, 403     the service does not accept our key for this subscription: not retried
 *   400, 413     the message itself is wrong: not retried
 */
export function readPushResponse(status: number): PushOutcome {
  if (status >= 200 && status < 300) return { result: "sent" }
  if (status === 404 || status === 410) return { result: "gone", error: `The push service answered ${status}: the subscription no longer exists.` }
  if (status === 429) return { result: "retry", error: "The push service asked us to slow down (429).", stop: true }
  if (status >= 500) return { result: "retry", error: `The push service answered ${status}.`, stop: false }
  return { result: "failed", error: `The push service refused the message (${status}).` }
}

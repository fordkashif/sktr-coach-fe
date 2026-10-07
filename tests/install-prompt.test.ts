import test from "node:test"
import assert from "node:assert/strict"
import {
  detectInstallPlatform,
  dismissInstall,
  EMPTY_INSTALL_STATE,
  markInstalled,
  parseInstallState,
  platformCanInstall,
  shouldOfferInstall,
  snoozeDays,
  type InstallState,
} from "../src/lib/install-prompt"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 6, 12)

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1"
const IPHONE_FIREFOX = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15"
const IPHONE_INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 336.0.0.26.90 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 612345678)"
const IPHONE_FACEBOOK = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/470.0.0.40.108;FBBV/612345678;FBDV/iPhone15,2]"
const IPHONE_WEBVIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

test("platform: Safari on iPhone can install through Share", () => {
  assert.equal(detectInstallPlatform(IPHONE_SAFARI, 5), "ios-safari")
})

test("platform: other browsers and in-app windows on iPhone must open Safari first", () => {
  for (const ua of [IPHONE_CHROME, IPHONE_FIREFOX, IPHONE_INSTAGRAM, IPHONE_FACEBOOK, IPHONE_WEBVIEW]) {
    assert.equal(detectInstallPlatform(ua, 5), "ios-other", ua)
  }
})

test("platform: an iPad that says it is a Mac is told apart by its touch screen", () => {
  assert.equal(detectInstallPlatform(IPAD_AS_MAC, 5), "ios-safari")
  assert.equal(detectInstallPlatform(IPAD_AS_MAC, 0), "desktop")
})

test("platform: Android, desktop and unknown", () => {
  assert.equal(detectInstallPlatform(ANDROID_CHROME, 5), "android")
  assert.equal(detectInstallPlatform(WINDOWS_CHROME, 0), "desktop")
  assert.equal(detectInstallPlatform("", 0), "unknown")
})

test("a computer is only offered the app when the browser gives one tap", () => {
  assert.equal(platformCanInstall("desktop", false), false)
  assert.equal(platformCanInstall("desktop", true), true)
  assert.equal(platformCanInstall("unknown", false), false)
  assert.equal(platformCanInstall("unknown", true), true)
  assert.equal(platformCanInstall("android", false), true)
  assert.equal(platformCanInstall("ios-safari", false), true)
  assert.equal(platformCanInstall("ios-other", false), true)
})

test("never asked: offer", () => {
  assert.equal(shouldOfferInstall(EMPTY_INSTALL_STATE, NOW), true)
})

test("Not now hides the offer for 14 days", () => {
  const state = dismissInstall(EMPTY_INSTALL_STATE, NOW)
  assert.deepEqual(state, { dismissals: 1, lastDismissedAt: NOW, installed: false })
  assert.equal(shouldOfferInstall(state, NOW), false)
  assert.equal(shouldOfferInstall(state, NOW + 14 * DAY - 1), false)
  assert.equal(shouldOfferInstall(state, NOW + 14 * DAY), true)
})

test("after three dismissals it stays hidden for 90 days", () => {
  let state: InstallState = EMPTY_INSTALL_STATE
  state = dismissInstall(state, NOW)
  state = dismissInstall(state, NOW + 15 * DAY)
  assert.equal(snoozeDays(state.dismissals), 14)
  assert.equal(shouldOfferInstall(state, NOW + 30 * DAY), true)
  state = dismissInstall(state, NOW + 30 * DAY)
  assert.equal(state.dismissals, 3)
  assert.equal(snoozeDays(state.dismissals), 90)
  assert.equal(shouldOfferInstall(state, NOW + 30 * DAY + 14 * DAY), false)
  assert.equal(shouldOfferInstall(state, NOW + 30 * DAY + 90 * DAY - 1), false)
  assert.equal(shouldOfferInstall(state, NOW + 30 * DAY + 90 * DAY), true)
})

test("installing hides it for good", () => {
  const state = markInstalled(EMPTY_INSTALL_STATE)
  assert.equal(shouldOfferInstall(state, NOW), false)
  assert.equal(shouldOfferInstall(state, NOW + 1000 * DAY), false)
})

test("a clock that went backwards does not hide the offer for ever", () => {
  assert.equal(shouldOfferInstall({ dismissals: 1, lastDismissedAt: NOW + 400 * DAY, installed: false }, NOW), true)
})

test("stored state: bad or missing values count as never asked", () => {
  assert.deepEqual(parseInstallState(null), EMPTY_INSTALL_STATE)
  assert.deepEqual(parseInstallState("not json"), EMPTY_INSTALL_STATE)
  assert.deepEqual(parseInstallState("null"), EMPTY_INSTALL_STATE)
  assert.deepEqual(parseInstallState('{"dismissals":"many","lastDismissedAt":"soon","installed":"yes"}'), EMPTY_INSTALL_STATE)
  assert.deepEqual(parseInstallState(JSON.stringify({ dismissals: 2, lastDismissedAt: NOW, installed: false })), { dismissals: 2, lastDismissedAt: NOW, installed: false })
  assert.deepEqual(parseInstallState('{"installed":true}'), { dismissals: 0, lastDismissedAt: null, installed: true })
})

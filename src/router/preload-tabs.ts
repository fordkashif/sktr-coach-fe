/**
 * Each screen's code is downloaded the first time it is opened. On a phone that is a wait the
 * person notices on every new tab (the Progress tab brings the chart library, about 120 KB).
 * Once the app is open and the phone is idle, fetch the code of the screens in the athlete's
 * tab bar, so the first tap on a tab only waits for its data. Same imports as the router
 * (src/router/index.tsx), so the browser fetches the same files and keeps them.
 */
const ATHLETE_TAB_PAGES = [
  () => import("@/app/(authenticated)/athlete/home/page"),
  () => import("@/app/(authenticated)/athlete/training-plan/page"),
  () => import("@/app/(authenticated)/athlete/log/page"),
  () => import("@/app/(authenticated)/athlete/trends/page"),
  () => import("@/app/(authenticated)/athlete/profile/page"),
  () => import("@/app/(authenticated)/athlete/messages/page"),
]

let started = false

function whenIdle(run: () => void) {
  if (typeof window === "undefined") return
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(run, { timeout: 4000 })
  else window.setTimeout(run, 2000)
}

/** Fetches the athlete tab screens' code in the background, one after another, once per visit. */
export function preloadAthleteTabs() {
  if (started) return
  started = true
  // Respect "Data saver" on phones that report it.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (connection?.saveData) return
  whenIdle(() => {
    void ATHLETE_TAB_PAGES.reduce<Promise<unknown>>((previous, load) => previous.then(() => load().catch(() => undefined)), Promise.resolve())
  })
}

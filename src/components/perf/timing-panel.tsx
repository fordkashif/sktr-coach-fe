import { useState, useSyncExternalStore } from "react"
import { Copy, Timer, X } from "@phosphor-icons/react"
import { subscribeTiming, timingEnabled, timingScreens, timingText, turnTimingOff, watchCodeDownloads, type TimingScreen } from "@/lib/perf/timing-log"

/*
 * The on-phone timing view (switched on with ?timing=1). A small button above the tab bar opens a
 * sheet listing, for the last few screens, every database call and code file the screen waited
 * for, with how long each took. "Copy" puts it all in the clipboard to paste into a message.
 */

let version = 0
const subscribe = (listener: () => void) =>
  subscribeTiming(() => {
    version += 1
    listener()
  })

function summary(screen: TimingScreen) {
  const end = screen.calls.reduce((max, call) => Math.max(max, call.start + call.duration), 0)
  const server = screen.calls.filter((call) => call.source === "server")
  // Calls that had to wait for an earlier one: started after another server call ended.
  let rounds = 0
  let roundEnd = -1
  for (const call of [...server].sort((a, b) => a.start - b.start)) {
    if (call.start >= roundEnd) {
      rounds += 1
      roundEnd = call.start + call.duration
    } else roundEnd = Math.max(roundEnd, call.start + call.duration)
  }
  return { end, server: server.length, code: screen.calls.filter((call) => call.source === "code").length, rounds }
}

export function TimingPanel() {
  useSyncExternalStore(subscribe, () => version, () => version)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!timingEnabled()) return null
  watchCodeDownloads()
  const screens = [...timingScreens()].reverse()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+88px)] left-3 z-50 flex items-center gap-1.5 rounded-full border border-sk-line bg-white px-3 py-2 text-sm font-bold text-sk-ink shadow-md lg:bottom-4"
        aria-label="Open timing"
      >
        <Timer className="size-4" weight="bold" aria-hidden />
        {screens[0] ? `${summary(screens[0]).end} ms` : "Timing"}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[60] flex flex-col bg-white" role="dialog" aria-label="Timing">
          <div className="flex items-center justify-between gap-2 border-b border-sk-line px-4 py-3">
            <h2 className="text-lg font-extrabold text-sk-ink">Timing</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="sk-btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(timingText()).then(() => setCopied(true))
                }}
              >
                <Copy className="size-4" weight="bold" aria-hidden />
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" className="sk-icon-btn" aria-label="Close timing" onClick={() => setOpen(false)}>
                <X className="size-5" weight="bold" aria-hidden />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <p className="mb-3 text-sm text-sk-ink-2">Newest screen first. "server" went to the database, "kept" was answered on the phone, "code" is a file the screen needed.</p>
            {screens.map((screen, index) => {
              const s = summary(screen)
              return (
                <section key={`${screen.path}-${index}`} className="mb-5">
                  <h3 className="font-bold text-sk-ink">{screen.path}</h3>
                  <p className="mb-1 text-sm text-sk-ink-2">
                    Last answer after {s.end} ms. {s.server} server calls in {s.rounds} {s.rounds === 1 ? "round" : "rounds"}, {s.code} code files.
                  </p>
                  <ul className="space-y-0.5 font-mono text-[11px] leading-4 text-sk-ink">
                    {screen.calls.map((call, i) => (
                      <li key={i} className={call.source === "kept" ? "text-sk-mute" : undefined}>
                        +{call.start} {call.duration}ms {call.source}
                        {call.status && call.status >= 400 ? ` ${call.status}` : ""} {call.label}
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
            <button type="button" className="sk-btn mt-2" onClick={() => turnTimingOff()}>
              Turn timing off
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

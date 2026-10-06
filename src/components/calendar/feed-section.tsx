import { useEffect, useState } from "react"
import { Button, Field, InlineConfirm, Input, Notice, Section, Skeleton, StatusText, notify, notifyError } from "@/components/sk"
import { dateKeyLocal } from "@/lib/athlete-session"
import { getCalendarFeedStatus, makeCalendarFeedLink, turnOffCalendarFeed, type CalendarFeedLink, type CalendarFeedStatus } from "@/lib/data/calendar/feed-data"
import { shortDayLabel } from "@/lib/data/calendar/model"
import { toWebcalUrl } from "../../../supabase/functions/_shared/calendar-feed"

const CONTENTS: Record<"athlete" | "coach" | "club-admin", string> = {
  athlete: "It carries the titles of your sessions, your test weeks, the competitions you are in and club events. Nothing about injuries, wellness or days you cannot train is ever in it.",
  coach: "It carries your teams' session titles, test weeks, competitions and club events. It has no athlete names and nothing about who is injured, sick or away.",
  "club-admin": "It carries the club's test weeks, competitions and club events. It has no athlete names and nothing about who is injured, sick or away.",
}

/**
 * The private subscription link: turn it on, copy it once, make a new one, turn it off.
 * The link is only shown right after it is made, because only a scrambled copy of it is kept.
 */
export function CalendarFeedSection({ role }: { role: "athlete" | "coach" | "club-admin" }) {
  const [status, setStatus] = useState<CalendarFeedStatus | null>(null)
  const [link, setLink] = useState<CalendarFeedLink | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | "new" | "off">(null)

  useEffect(() => {
    let cancelled = false
    void getCalendarFeedStatus().then((result) => {
      if (cancelled) return
      if (result.ok) setStatus(result.data)
      else {
        setStatus({ on: false, linkMadeAt: null })
        setProblem(result.error.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const make = async () => {
    setBusy(true)
    const result = await makeCalendarFeedLink()
    setBusy(false)
    setConfirm(null)
    if (!result.ok) return setProblem(result.error.message)
    setProblem(null)
    setLink(result.data)
    setStatus({ on: true, linkMadeAt: result.data.linkMadeAt })
  }

  const turnOff = async () => {
    setBusy(true)
    const result = await turnOffCalendarFeed()
    setBusy(false)
    setConfirm(null)
    if (!result.ok) return setProblem(result.error.message)
    setProblem(null)
    setLink(null)
    setStatus({ on: false, linkMadeAt: null })
    notify("Calendar link turned off", "Calendars that used it stop updating.")
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      notify("Link copied")
    } catch {
      notifyError("Could not copy", "Select the link and copy it by hand.")
    }
  }

  return (
    <Section
      id="calendar-link"
      title="Keep your phone's calendar up to date"
      hint="A private link you add once to Apple, Google or Outlook calendar. Your calendar app then follows this one by itself."
    >
      <div className="flex max-w-2xl flex-col gap-4">
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        <p className="text-[0.9375rem] text-sk-mute">{CONTENTS[role]}</p>

        {status === null ? (
          <Skeleton className="h-11 w-56" />
        ) : !status.on ? (
          <div>
            <Button onClick={() => void make()} disabled={busy}>
              {busy ? "Making your link..." : "Turn on my calendar link"}
            </Button>
          </div>
        ) : (
          <>
            <StatusText tone="green">Your calendar link is on{status.linkMadeAt ? `, made ${shortDayLabel(dateKeyLocal(new Date(status.linkMadeAt)))}` : ""}</StatusText>

            {link ? (
              <>
                {link.sample ? (
                  <Notice tone="info">This is a sample link. The demo has no server behind it, so nothing can subscribe to it. In the live app this is a real link.</Notice>
                ) : (
                  <Notice tone="warning">Copy the link now. To keep it safe we do not store it, so it is shown only this once. Anyone who has it can see these dates, so do not pass it on.</Notice>
                )}
                <Field label="Your private link" hint="In your calendar app choose to add a calendar from a link (also called subscribing by URL) and paste it.">
                  <Input readOnly value={link.url} onFocus={(event) => event.target.select()} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void copy()}>Copy link</Button>
                  {link.sample ? null : (
                    <Button
                      onClick={() => {
                        window.location.href = toWebcalUrl(link.url)
                      }}
                    >
                      Open in my calendar app
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[0.9375rem] text-sk-mute">The link itself is not shown again. If you lost it, make a new one and add that to your calendar app.</p>
            )}

            {confirm === "new" ? (
              <InlineConfirm question="Make a new link? The old link stops working, so calendars using it stop updating until you add the new one." confirmLabel="Make a new link" cancelLabel="Keep the old link" onConfirm={() => void make()} onCancel={() => setConfirm(null)} busy={busy} />
            ) : confirm === "off" ? (
              <InlineConfirm question="Turn the link off? Calendars using it stop updating. Dates already copied to a calendar stay there." confirmLabel="Turn off" cancelLabel="Keep it on" onConfirm={() => void turnOff()} onCancel={() => setConfirm(null)} busy={busy} />
            ) : (
              <div className="-ml-2.5 flex flex-wrap gap-1">
                <Button variant="quiet" size="sm" onClick={() => setConfirm("new")}>
                  Make a new link
                </Button>
                <Button variant="quiet" size="sm" onClick={() => setConfirm("off")}>
                  Turn off
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  )
}

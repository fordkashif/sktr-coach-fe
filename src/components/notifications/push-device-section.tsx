import { useCallback, useEffect, useState } from "react"
import { ActionRow, Button, InlineConfirm, List, ListRow, Notice, Section, SkeletonRows, StatusText, SubSection } from "@/components/sk"
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  PUSH_CHANGED_EVENT,
  readPushSnapshot,
  removePushDevice,
  sendTestPush,
  testPushMessage,
  type PushDevice,
  type PushSnapshot,
} from "@/lib/push/push-client"
import { enableFailureMessage, lastUsedLabel, PUSH_SECTION_HINT, pushSectionCopy, type PushSectionCopy } from "@/lib/push/push-state"

/**
 * What notification settings needs to know about push on this device. Reads the browser and the
 * person's list of devices; it never asks for permission (only the "Turn on push" button does).
 */
export function usePushSnapshot(isAdmin: boolean) {
  const [snapshot, setSnapshot] = useState<PushSnapshot | null>(null)

  const reload = useCallback(async () => {
    setSnapshot(await readPushSnapshot(isAdmin))
  }, [isAdmin])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      void readPushSnapshot(isAdmin).then((next) => {
        if (!cancelled) setSnapshot(next)
      })
    }
    load()
    // Another tab, the sync on app start, or coming back from the browser's settings.
    window.addEventListener(PUSH_CHANGED_EVENT, load)
    const onVisible = () => {
      if (document.visibilityState === "visible") load()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      window.removeEventListener(PUSH_CHANGED_EVENT, load)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [isAdmin])

  const copy: PushSectionCopy | null = snapshot ? pushSectionCopy(snapshot.environment) : null
  return { snapshot, copy, reload }
}

type Message = { tone: "success" | "info" | "error"; text: string }

function addedLabel(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/**
 * "Push on this device" in notification settings: the state of this device, turning it on (the
 * browser's permission question appears only after that tap), a test, turning it off, and the
 * person's other devices. Renders nothing when push is not set up and the person is not an admin.
 */
export function PushDeviceSection({ snapshot, copy, reload }: { snapshot: PushSnapshot | null; copy: PushSectionCopy | null; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<"on" | "off" | "test" | "remove" | "check" | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  if (!snapshot || !copy) {
    return (
      <Section title="Push on this device" hint={PUSH_SECTION_HINT}>
        <SkeletonRows rows={1} label="Checking this device" />
      </Section>
    )
  }
  if (copy.kind === "hidden") return null
  if (copy.kind === "not-set-up") {
    return (
      <Section title="Push on this device" hint={PUSH_SECTION_HINT}>
        <Notice>Push is not set up for this app yet. People cannot turn it on until it is.</Notice>
      </Section>
    )
  }

  const thisDevice = snapshot.devices.find((device) => device.isThisDevice) ?? null

  const turnOn = async () => {
    setBusy("on")
    setMessage(null)
    const result = await enablePushOnThisDevice()
    await reload()
    setBusy(null)
    setMessage(result.ok ? { tone: "success", text: "Push is on for this device." } : { tone: "error", text: enableFailureMessage(result.reason) })
  }

  const turnOff = async () => {
    setBusy("off")
    setMessage(null)
    const result = await disablePushOnThisDevice()
    await reload()
    setBusy(null)
    setConfirming(null)
    setMessage(
      result.ok
        ? { tone: "success", text: "Push is off for this device." }
        : { tone: "info", text: "Push is off on this device. We could not reach the server, so it may stay in your list for a little while." },
    )
  }

  const test = async (device: PushDevice) => {
    setBusy("test")
    setMessage(null)
    const result = await sendTestPush(device)
    if (result.outcome === "gone") await reload()
    setBusy(null)
    setMessage(testPushMessage(result.outcome, result.message))
  }

  const remove = async (device: PushDevice) => {
    if (device.isThisDevice) return turnOff()
    setBusy("remove")
    setMessage(null)
    const result = await removePushDevice(device)
    await reload()
    setBusy(null)
    setConfirming(null)
    setMessage(result.ok ? { tone: "success", text: `${device.label} was removed. It will not get notifications any more.` } : { tone: "error", text: "That device could not be removed. Check your connection and try again." })
  }

  const checkAgain = async () => {
    setBusy("check")
    setMessage(null)
    await reload()
    setBusy(null)
  }

  return (
    <Section title="Push on this device" hint={PUSH_SECTION_HINT}>
      {message ? (
        <Notice tone={message.tone} className="mb-2">
          {message.text}
        </Notice>
      ) : null}

      <div data-testid="push-state" data-push-state={copy.kind} className="flex flex-col gap-3 border-y border-sk-line py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          {copy.status ? <StatusText tone={copy.tone}>{copy.status}</StatusText> : null}
          {copy.detail ? <p className="mt-1 text-sm leading-snug text-sk-mute">{copy.detail}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {copy.canTurnOn ? (
            <Button variant="primary" onClick={() => void turnOn()} disabled={busy !== null}>
              {busy === "on" ? "Turning on" : "Turn on push"}
            </Button>
          ) : null}
          {copy.canTest && thisDevice ? (
            <Button onClick={() => void test(thisDevice)} disabled={busy !== null}>
              {busy === "test" ? "Sending" : "Send a test"}
            </Button>
          ) : null}
          {copy.canTurnOff ? (
            <Button variant="quiet" onClick={() => void turnOff()} disabled={busy !== null}>
              {busy === "off" ? "Turning off" : "Turn off"}
            </Button>
          ) : null}
          {copy.kind === "blocked" ? (
            <Button onClick={() => void checkAgain()} disabled={busy !== null}>
              Check again
            </Button>
          ) : null}
        </div>
      </div>

      {copy.steps.length > 0 ? (
        <List aria-label="How to add SKTR Coach to your Home Screen">
          {copy.steps.map((step, index) => (
            <ListRow
              key={step}
              leading={
                <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-sk-soft text-sm font-bold text-sk-ink tabular-nums">
                  {index + 1}
                </span>
              }
              title={step}
            />
          ))}
        </List>
      ) : null}

      {snapshot.devicesError ? (
        <Notice tone="warning" className="mt-4">
          Your list of devices could not be loaded. Check your connection and reload the page.
        </Notice>
      ) : snapshot.devices.length > 0 ? (
        <SubSection title="Your devices" hint="Every phone, tablet or computer where you turned push on." className="mt-6">
          <List>
            {snapshot.devices.map((device) => (
              <ActionRow
                key={device.id}
                data-testid="push-device"
                title={device.isThisDevice ? `${device.label} (this device)` : device.label}
                subtitle={`Last used: ${lastUsedLabel(device.lastUsedAt).toLowerCase()}. Added ${addedLabel(device.createdAt)}.`}
                actions={
                  confirming === device.id ? null : (
                    <Button variant="quiet" size="sm" aria-label={`Remove ${device.label}`} onClick={() => setConfirming(device.id)} disabled={busy !== null}>
                      Remove
                    </Button>
                  )
                }
                below={
                  confirming === device.id ? (
                    <InlineConfirm
                      question={device.isThisDevice ? "Turn push off for this device?" : `Stop notifications on ${device.label}?`}
                      confirmLabel={device.isThisDevice ? "Turn off" : "Remove"}
                      onConfirm={() => void remove(device)}
                      onCancel={() => setConfirming(null)}
                      busy={busy === "remove" || busy === "off"}
                    />
                  ) : null
                }
              />
            ))}
          </List>
        </SubSection>
      ) : null}
    </Section>
  )
}

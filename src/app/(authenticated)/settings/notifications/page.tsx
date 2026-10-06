"use client"

import { useEffect, useState } from "react"
import { PushDeviceSection, usePushSnapshot } from "@/components/notifications/push-device-section"
import { List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { cn } from "@/lib/utils"
import { useRole } from "@/lib/role-context"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import {
  notificationCategoriesForRole,
  type NotificationCategoryRole,
  type NotificationPreferenceCategory,
} from "@/lib/notification-categories"
import {
  defaultNotificationCategoryPreferences,
  getCurrentNotificationPreferenceMatrix,
  upsertCurrentNotificationCategoryPreference,
  upsertCurrentNotificationPreference,
  type NotificationPreferenceMatrix,
  type NotificationChannel,
} from "@/lib/data/notification-preferences-data"

/** Nothing chosen yet: every channel on, and each kind of update at its own default. */
const defaultState: NotificationPreferenceMatrix = {
  global: {
    email: true,
    "in-app": true,
    push: true,
  },
  categories: defaultNotificationCategoryPreferences(),
}

const MOCK_STORAGE_KEY = "pacelab:notification-preferences"

/** Demo mode has no backend, so choices are kept on this device. */
function loadMockPreferences(): NotificationPreferenceMatrix {
  try {
    const stored = window.localStorage.getItem(tenantStorageKey(MOCK_STORAGE_KEY))
    if (!stored) return defaultState
    const parsed = JSON.parse(stored) as Partial<NotificationPreferenceMatrix> | null
    // Merged per kind of update, so choices saved before a channel existed keep its default.
    const categories = { ...defaultState.categories }
    for (const [key, value] of Object.entries(parsed?.categories ?? {})) {
      categories[key] = { ...(defaultState.categories[key] ?? {}), ...value }
    }
    return {
      global: { ...defaultState.global, ...(parsed?.global ?? {}) },
      categories,
    }
  } catch {
    return defaultState
  }
}

function saveMockPreferences(next: NotificationPreferenceMatrix) {
  try {
    window.localStorage.setItem(tenantStorageKey(MOCK_STORAGE_KEY), JSON.stringify(next))
  } catch {
    // Storage can be blocked. The toggle still reflects the choice for this visit.
  }
}

const SAVE_ERROR = "That change could not be saved. Check your connection and try again."
const LOAD_ERROR = "Your notification settings could not be loaded. Check your connection and reload the page."

const CHANNELS: Array<{ channel: NotificationChannel; label: string; title: string; body: string }> = [
  { channel: "in-app", label: "In app", title: "In the app", body: "Shows under the bell when you open SKTR Coach." },
  { channel: "email", label: "Email", title: "By email", body: "Sent to the email address you sign in with." },
  { channel: "push", label: "Push", title: "By push", body: "A notification on the phones and computers you turn push on for, below." },
]

const CHANNEL_NAME: Record<NotificationChannel, { sentence: string; word: string }> = {
  "in-app": { sentence: "In-app", word: "in-app" },
  email: { sentence: "Email", word: "email" },
  push: { sentence: "Push", word: "push" },
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-11 w-[52px] shrink-0 cursor-pointer items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue disabled:cursor-default disabled:opacity-50",
      )}
    >
      <span className={cn("h-7 w-[52px] rounded-full transition-colors", checked ? "bg-sk-blue" : "bg-[#c9cedb]")} />
      <span
        aria-hidden
        className={cn(
          "absolute left-[3px] size-[22px] rounded-full bg-white transition-transform",
          checked ? "translate-x-6" : "translate-x-0",
        )}
      />
    </button>
  )
}

export default function NotificationSettingsPage() {
  const [preferences, setPreferences] = useState<NotificationPreferenceMatrix>(defaultState)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const { role } = useRole()
  const isMockMode = getBackendMode() !== "supabase"
  // Club admins and platform admins are told when push is not set up; for everyone else it is just not there.
  const push = usePushSnapshot(role === "club-admin" || role === "platform-admin")
  const channels = CHANNELS.filter((row) => row.channel !== "push" || push.copy?.showSwitches === true)

  useEffect(() => {
    let cancelled = false

    const loadPreferences = async () => {
      setLoading(true)
      if (isMockMode) {
        setPreferences(loadMockPreferences())
        setError(null)
        setLoading(false)
        return
      }
      const result = await getCurrentNotificationPreferenceMatrix()
      if (cancelled) return

      if (!result.ok) {
        setError(LOAD_ERROR)
        setLoading(false)
        return
      }

      setPreferences(result.data)
      setError(null)
      setLoading(false)
    }

    void loadPreferences()
    return () => {
      cancelled = true
    }
  }, [isMockMode])

  const handleToggle = async (channel: NotificationChannel, enabled: boolean) => {
    setSavingKey(`global:${channel}`)
    const savedMessage = `${CHANNEL_NAME[channel].sentence} notifications turned ${enabled ? "on" : "off"}.`
    const next = { ...preferences, global: { ...preferences.global, [channel]: enabled } }
    if (isMockMode) {
      saveMockPreferences(next)
    } else {
      const result = await upsertCurrentNotificationPreference({ channel, enabled, eventType: "*" })
      if (!result.ok) {
        setError(SAVE_ERROR)
        setInfo(null)
        setSavingKey(null)
        return
      }
    }
    setPreferences(next)
    setError(null)
    setInfo(savedMessage)
    setSavingKey(null)
  }

  const handleCategoryToggle = async (categoryKey: string, categoryTitle: string, channel: NotificationChannel, enabled: boolean) => {
    setSavingKey(`${categoryKey}:${channel}`)
    const savedMessage = `${categoryTitle}: ${CHANNEL_NAME[channel].word} turned ${enabled ? "on" : "off"}.`
    const next = {
      ...preferences,
      categories: {
        ...preferences.categories,
        [categoryKey]: { ...preferences.categories[categoryKey], [channel]: enabled },
      },
    }
    if (isMockMode) {
      saveMockPreferences(next)
    } else {
      const result = await upsertCurrentNotificationCategoryPreference({ categoryKey, channel, enabled })
      if (!result.ok) {
        setError(SAVE_ERROR)
        setInfo(null)
        setSavingKey(null)
        return
      }
    }
    setPreferences(next)
    setError(null)
    setInfo(savedMessage)
    setSavingKey(null)
  }

  const categories = notificationCategoriesForRole(role as NotificationCategoryRole)
  // Reminders are made on a schedule, not by something a person did: they get their own heading.
  const everyday = categories.filter((category) => category.group !== "reminders")
  const reminders = categories.filter((category) => category.group === "reminders")

  const categoryRows = (list: NotificationPreferenceCategory[]) => (
    <List>
      {list.map((category) => (
        <ListRow key={category.key}>
          <span role="group" aria-label={category.title} className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-6">
            <span className="min-w-0">
              <span className="sk-list-title">{category.title}</span>
              <span className="sk-list-sub">{category.description}</span>
            </span>
            <span className="flex shrink-0 items-center gap-3 sm:gap-5">
              {channels.map(({ channel, label }) => {
                if (channel === "email" && !category.emailAvailable) {
                  return (
                    <span key={channel} className="w-[100px] text-sm font-semibold text-sk-mute">
                      No email
                    </span>
                  )
                }
                const inAppOn = preferences.global["in-app"] && (preferences.categories[category.key]?.["in-app"] ?? category.defaults["in-app"])
                // A push is made from the notification under the bell, so it needs that one on.
                const needsBell = channel === "push" && !inAppOn
                const channelOn = preferences.global[channel] && !needsBell
                const chosen = preferences.categories[category.key]?.[channel] ?? defaultState.categories[category.key]?.[channel] ?? false
                return (
                  <span key={channel} className="flex w-[100px] items-center gap-2">
                    <Toggle
                      label={`${category.title}, ${label.toLowerCase()}${channelOn ? "" : needsBell ? " (needs in app on)" : " (the whole channel is off)"}`}
                      // With the whole channel off nothing is sent, whatever was chosen here.
                      checked={channelOn && chosen}
                      disabled={!channelOn || savingKey === `${category.key}:${channel}`}
                      onChange={(checked) => {
                        void handleCategoryToggle(category.key, category.title, channel, checked)
                      }}
                    />
                    <span aria-hidden className="text-sm font-semibold text-sk-ink-2">
                      {label}
                    </span>
                  </span>
                )
              })}
            </span>
          </span>
        </ListRow>
      ))}
    </List>
  )

  return (
    <Screen width="narrow">
      <ScreenHeader
        title="Notification settings"
        lede="Choose what SKTR Coach tells you about and where it reaches you."
        back={role === "athlete" ? { to: "/athlete/profile", label: "Profile" } : { to: "/notifications", label: "Notifications" }}
      />

      {error ? <Notice tone="error">{error}</Notice> : info ? <Notice tone="success">{info}</Notice> : null}

      <Section title="How we reach you" hint="Turn a whole channel off here and nothing is sent that way.">
        {loading ? (
          <SkeletonRows rows={2} label="Loading your settings" />
        ) : (
          <List>
            {channels.map((row) => (
              <ListRow
                key={row.channel}
                title={row.title}
                subtitle={row.body}
                trailing={
                  <Toggle
                    label={row.title}
                    checked={preferences.global[row.channel]}
                    disabled={savingKey === `global:${row.channel}`}
                    onChange={(checked) => {
                      void handleToggle(row.channel, checked)
                    }}
                  />
                }
              />
            ))}
          </List>
        )}
      </Section>

      <PushDeviceSection snapshot={push.snapshot} copy={push.copy} reload={push.reload} />

      <Section
        title="What you hear about"
        hint={
          push.copy?.showSwitches
            ? "Fine tune each kind of update. A push is sent for what also shows under the bell, so it needs In app on."
            : "Fine tune each kind of update."
        }
      >
        {loading ? (
          <SkeletonRows rows={Math.max(2, everyday.length)} label="Loading your settings" />
        ) : (
          categoryRows(everyday)
        )}
      </Section>

      {reminders.length > 0 ? (
        <Section title="Reminders" hint="Sent at the times below, in your club's time zone. Each one is sent at most once a day.">
          {loading ? <SkeletonRows rows={reminders.length} label="Loading your settings" /> : categoryRows(reminders)}
        </Section>
      ) : null}
    </Screen>
  )
}

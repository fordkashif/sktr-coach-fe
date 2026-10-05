"use client"

import { useEffect, useState } from "react"
import { List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { cn } from "@/lib/utils"
import { useRole } from "@/lib/role-context"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import {
  NOTIFICATION_PREFERENCE_CATEGORIES,
  notificationCategoriesForRole,
  type NotificationCategoryRole,
} from "@/lib/notification-categories"
import {
  getCurrentNotificationPreferenceMatrix,
  upsertCurrentNotificationCategoryPreference,
  upsertCurrentNotificationPreference,
  type NotificationPreferenceMatrix,
  type NotificationChannel,
} from "@/lib/data/notification-preferences-data"

/** Nothing chosen yet: both channels on, and each kind of update at its own default. */
const defaultState: NotificationPreferenceMatrix = {
  global: {
    email: true,
    "in-app": true,
  },
  categories: NOTIFICATION_PREFERENCE_CATEGORIES.reduce<Record<string, Record<NotificationChannel, boolean>>>((acc, category) => {
    acc[category.key] = { ...category.defaults }
    return acc
  }, {}),
}

const MOCK_STORAGE_KEY = "pacelab:notification-preferences"

/** Demo mode has no backend, so choices are kept on this device. */
function loadMockPreferences(): NotificationPreferenceMatrix {
  try {
    const stored = window.localStorage.getItem(tenantStorageKey(MOCK_STORAGE_KEY))
    if (!stored) return defaultState
    const parsed = JSON.parse(stored) as Partial<NotificationPreferenceMatrix> | null
    return {
      global: { ...defaultState.global, ...(parsed?.global ?? {}) },
      categories: { ...defaultState.categories, ...(parsed?.categories ?? {}) },
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
]

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
    const savedMessage = `${channel === "email" ? "Email" : "In-app"} notifications turned ${enabled ? "on" : "off"}.`
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
    const savedMessage = `${categoryTitle}: ${channel === "email" ? "email" : "in-app"} turned ${enabled ? "on" : "off"}.`
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
            {CHANNELS.map((row) => (
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

      <Section title="What you hear about" hint="Fine tune each kind of update.">
        {loading ? (
          <SkeletonRows rows={Math.max(2, categories.length)} label="Loading your settings" />
        ) : (
          <List>
            {categories.map((category) => (
              <ListRow key={category.key}>
                <span role="group" aria-label={category.title} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <span className="min-w-0">
                    <span className="sk-list-title">{category.title}</span>
                    <span className="sk-list-sub">{category.description}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-6">
                    {CHANNELS.map(({ channel, label }) => {
                      if (channel === "email" && !category.emailAvailable) {
                        return (
                          <span key={channel} className="w-[104px] text-sm font-semibold text-sk-mute">
                            In app only
                          </span>
                        )
                      }
                      const channelOn = preferences.global[channel]
                      const chosen = preferences.categories[category.key]?.[channel] ?? category.defaults[channel]
                      return (
                        <span key={channel} className="flex w-[104px] items-center gap-2.5">
                          <Toggle
                            label={`${category.title}, ${label.toLowerCase()}${channelOn ? "" : " (the whole channel is off)"}`}
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
        )}
      </Section>
    </Screen>
  )
}

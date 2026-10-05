"use client"

import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, CheckCircle, WarningCircle } from "@phosphor-icons/react"
import { PageHeader, Panel } from "@/components/sk"
import { cn } from "@/lib/utils"
import { useRole } from "@/lib/role-context"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { NOTIFICATION_PREFERENCE_CATEGORIES } from "@/lib/notification-categories"
import {
  getCurrentNotificationPreferenceMatrix,
  upsertCurrentNotificationCategoryPreference,
  upsertCurrentNotificationPreference,
  type NotificationPreferenceMatrix,
  type NotificationChannel,
} from "@/lib/data/notification-preferences-data"

const defaultState: NotificationPreferenceMatrix = {
  global: {
    email: true,
    "in-app": true,
  },
  categories: NOTIFICATION_PREFERENCE_CATEGORIES.reduce<Record<string, Record<NotificationChannel, boolean>>>((acc, category) => {
    acc[category.key] = {
      email: true,
      "in-app": true,
    }
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

type AppRole = "athlete" | "coach" | "club-admin" | "platform-admin"

/** Plain-language wording per category. Athletes and coaches only see the ones that can reach them. */
const CATEGORY_COPY: Record<string, { title: string; body: (role: AppRole) => string; roles: AppRole[] }> = {
  "tenant-provisioning": {
    title: "New club requests",
    body: () => "When a club asks to join, is reviewed or is set up.",
    roles: ["club-admin", "platform-admin"],
  },
  "coach-invites": {
    title: "Coach invites",
    body: () => "When a coach is invited or accepts an invite.",
    roles: ["coach", "club-admin", "platform-admin"],
  },
  "athlete-invites": {
    title: "Team invites",
    body: (role) =>
      role === "athlete" ? "When a coach invites you to a team." : "When an athlete is invited or joins a team.",
    roles: ["athlete", "coach", "club-admin", "platform-admin"],
  },
  "training-plans": {
    title: "Training plans",
    body: (role) =>
      role === "athlete" ? "When your coach publishes a plan for you." : "When a published plan goes live for an athlete.",
    roles: ["athlete", "coach", "club-admin", "platform-admin"],
  },
  "test-weeks": {
    title: "Test weeks",
    body: (role) => (role === "athlete" ? "When a test week opens for your team." : "When a published test week opens for a team."),
    roles: ["athlete", "coach", "club-admin", "platform-admin"],
  },
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
        "relative inline-flex h-11 w-[52px] shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue disabled:opacity-50",
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
        setError(result.error.message)
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

  const rows = useMemo(
    () => [
      {
        channel: "in-app" as const,
        title: "In the app",
        body: "Shows under the bell when you open SKTR Coach.",
      },
      {
        channel: "email" as const,
        title: "By email",
        body: "Sent to the email address you sign in with.",
      },
    ],
    [],
  )

  const handleToggle = async (channel: NotificationChannel, enabled: boolean) => {
    setSavingKey(`global:${channel}`)
    if (isMockMode) {
      const next = { ...preferences, global: { ...preferences.global, [channel]: enabled } }
      saveMockPreferences(next)
      setPreferences(next)
      setError(null)
      setInfo(`${channel === "email" ? "Email" : "In-app"} notifications turned ${enabled ? "on" : "off"}.`)
      setSavingKey(null)
      return
    }
    const result = await upsertCurrentNotificationPreference({ channel, enabled, eventType: "*" })

    if (!result.ok) {
      setError(result.error.message)
      setInfo(null)
      setSavingKey(null)
      return
    }

    setPreferences((current) => ({
      ...current,
      global: { ...current.global, [channel]: enabled },
    }))
    setError(null)
    setInfo(`${channel === "email" ? "Email" : "In-app"} notifications turned ${enabled ? "on" : "off"}.`)
    setSavingKey(null)
  }

  const handleCategoryToggle = async (categoryKey: string, channel: NotificationChannel, enabled: boolean) => {
    setSavingKey(`${categoryKey}:${channel}`)
    const categoryTitle = CATEGORY_COPY[categoryKey]?.title ?? "Category"
    const savedMessage = `${categoryTitle}: ${channel === "email" ? "email" : "in-app"} turned ${enabled ? "on" : "off"}.`
    if (isMockMode) {
      const next = {
        ...preferences,
        categories: {
          ...preferences.categories,
          [categoryKey]: { ...preferences.categories[categoryKey], [channel]: enabled },
        },
      }
      saveMockPreferences(next)
      setPreferences(next)
      setError(null)
      setInfo(savedMessage)
      setSavingKey(null)
      return
    }
    const result = await upsertCurrentNotificationCategoryPreference({
      categoryKey,
      channel,
      enabled,
    })

    if (!result.ok) {
      setError(result.error.message)
      setInfo(null)
      setSavingKey(null)
      return
    }

    setPreferences((current) => ({
      ...current,
      categories: {
        ...current.categories,
        [categoryKey]: {
          ...current.categories[categoryKey],
          [channel]: enabled,
        },
      },
    }))
    setError(null)
    setInfo(savedMessage)
    setSavingKey(null)
  }

  const appRole = role as AppRole
  const categories = NOTIFICATION_PREFERENCE_CATEGORIES.filter((category) => {
    const copy = CATEGORY_COPY[category.key]
    return copy ? copy.roles.includes(appRole) : true
  })
  const channels = [
    { channel: "in-app" as const, label: "In app" },
    { channel: "email" as const, label: "Email" },
  ]

  return (
    <div className="sk-page">
      {role === "athlete" ? (
        <Link to="/athlete/profile" className="sk-btn sk-btn-ghost sk-btn-sm -ml-2">
          <ArrowLeft className="size-4" weight="bold" />
          Profile
        </Link>
      ) : null}
      <PageHeader title="Notifications" lede="Choose what SKTR Coach tells you about and where it reaches you." />

      <div aria-live="polite" className="max-w-[860px] empty:hidden">
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
            <WarningCircle className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
            {error}
          </p>
        ) : info ? (
          <p className="flex items-start gap-2 rounded-2xl bg-sk-green-tint px-4 py-3 text-sm font-bold text-[#07673f]">
            <CheckCircle className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
            {info}
          </p>
        ) : null}
      </div>

      <div className="max-w-[860px] space-y-6 lg:space-y-8">
        <Panel title="How we reach you" hint="Turn a whole channel off here and nothing is sent that way.">
          {loading ? (
            <p className="py-3 text-sm text-sk-mute">Loading your settings...</p>
          ) : (
            <div>
              {rows.map((row) => (
                <div key={row.channel} className="sk-row">
                  <div className="min-w-0">
                    <p className="font-bold text-sk-ink">{row.title}</p>
                    <p className="text-sm text-sk-mute">{row.body}</p>
                  </div>
                  <Toggle
                    label={row.title}
                    checked={preferences.global[row.channel]}
                    disabled={savingKey === `global:${row.channel}`}
                    onChange={(checked) => {
                      void handleToggle(row.channel, checked)
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="What you hear about" hint="Fine tune each kind of update.">
          <div>
            {categories.map((category) => {
              const copy = CATEGORY_COPY[category.key]
              const title = copy?.title ?? category.title
              return (
                <div
                  key={category.key}
                  role="group"
                  aria-label={title}
                  className="flex flex-col gap-2 border-b border-sk-line py-4 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sk-ink">{title}</p>
                    <p className="text-sm text-sk-mute">{copy ? copy.body(appRole) : category.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-6">
                    {channels.map(({ channel, label }) => (
                      <div key={channel} className="flex items-center gap-2.5">
                        <Toggle
                          label={`${title}, ${label.toLowerCase()}`}
                          checked={preferences.categories[category.key]?.[channel] ?? preferences.global[channel]}
                          disabled={loading || savingKey === `${category.key}:${channel}`}
                          onChange={(checked) => {
                            void handleCategoryToggle(category.key, channel, checked)
                          }}
                        />
                        <span aria-hidden className="text-sm font-semibold text-sk-ink-2">
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>
    </div>
  )
}

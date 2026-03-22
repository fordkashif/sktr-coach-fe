"use client"

import { useEffect, useMemo, useState } from "react"
import { Switch } from "@/components/ui/switch"
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

export default function NotificationSettingsPage() {
  const [preferences, setPreferences] = useState<NotificationPreferenceMatrix>(defaultState)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadPreferences = async () => {
      setLoading(true)
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
  }, [])

  const rows = useMemo(
    () => [
      {
        channel: "in-app" as const,
        title: "In-app notifications",
        body: "Unread items in the PaceLab notification drawer.",
      },
      {
        channel: "email" as const,
        title: "Email notifications",
        body: "External delivery for approval updates, invites, and operational alerts.",
      },
    ],
    [],
  )

  const handleToggle = async (channel: NotificationChannel, enabled: boolean) => {
    setSavingKey(`global:${channel}`)
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
    setInfo(`${channel === "email" ? "Email" : "In-app"} notifications ${enabled ? "enabled" : "disabled"}.`)
    setSavingKey(null)
  }

  const handleCategoryToggle = async (categoryKey: string, channel: NotificationChannel, enabled: boolean) => {
    setSavingKey(`${categoryKey}:${channel}`)
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

    const category = NOTIFICATION_PREFERENCE_CATEGORIES.find((item) => item.key === categoryKey)
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
    setInfo(`${category?.title ?? "Category"} ${channel} notifications ${enabled ? "enabled" : "disabled"}.`)
    setSavingKey(null)
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(7,17,34,0.96)_0%,rgba(10,24,44,0.9)_55%,rgba(20,67,160,0.72)_100%)] px-5 py-6 text-white shadow-[0_24px_80px_rgba(5,12,24,0.28)] sm:px-6 lg:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6fb6ff]">Settings</p>
        <h1 className="mt-3 text-[clamp(2.1rem,5vw,4rem)] font-semibold leading-[0.94] tracking-[-0.05em]">
          Notification controls that actually govern delivery.
        </h1>
        <p className="mt-3 max-w-[56ch] text-sm leading-7 text-white/72 sm:text-base">
          These toggles control whether PaceLab should project in-app notifications for you and whether queued email notifications should be dispatched to your inbox.
        </p>
      </section>

      {error ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      ) : null}
      {info ? (
        <section className="rounded-[22px] border border-[#cfe2ff] bg-[#f6faff] px-4 py-3 text-sm text-[#1553b7]">
          {info}
        </section>
      ) : null}

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
        <div className="space-y-4">
          {loading ? (
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Loading notification preferences...
            </div>
          ) : null}

          {!loading
            ? rows.map((row) => (
                <div
                  key={row.channel}
                  className="flex items-center justify-between gap-4 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4"
                >
                  <div className="space-y-1">
                    <p className="text-base font-semibold tracking-[-0.03em] text-slate-950">{row.title}</p>
                    <p className="text-sm text-slate-500">{row.body}</p>
                  </div>
                  <Switch
                    checked={preferences.global[row.channel]}
                    disabled={savingKey === `global:${row.channel}`}
                    onCheckedChange={(checked) => {
                      void handleToggle(row.channel, checked)
                    }}
                  />
                </div>
              ))
            : null}
        </div>
      </section>

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Category overrides</h2>
            <p className="text-sm text-slate-500">
              Keep core channels on, but suppress specific notification classes when they are not useful.
            </p>
          </div>

          {NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => (
            <div
              key={category.key}
              className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4"
            >
              <div className="space-y-1">
                <p className="text-base font-semibold tracking-[-0.03em] text-slate-950">{category.title}</p>
                <p className="text-sm text-slate-500">{category.description}</p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {(["in-app", "email"] as const).map((channel) => (
                  <div
                    key={`${category.key}-${channel}`}
                    className="flex items-center justify-between rounded-[20px] border border-slate-200 bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-950">{channel === "email" ? "Email" : "In-app"}</p>
                      <p className="text-xs text-slate-500">
                        {channel === "email" ? "Dispatch queued emails for this category." : "Project in-app items for this category."}
                      </p>
                    </div>
                    <Switch
                      checked={preferences.categories[category.key]?.[channel] ?? preferences.global[channel]}
                      disabled={savingKey === `${category.key}:${channel}`}
                      onCheckedChange={(checked) => {
                        void handleCategoryToggle(category.key, channel, checked)
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

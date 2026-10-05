"use client"

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Choices, Field, Input, LinkButton, Notice, Screen, ScreenHeader, Section } from "@/components/sk"
import { createExtraSession } from "@/lib/data/session/session-log-data"
import type { SessionBlockType } from "@/lib/data/session/types"
import { addDaysIso, todayIso } from "@/lib/data/training-plan/plan-builder-model"

const SESSION_TYPES: Array<{ value: SessionBlockType; label: string; detail: string }> = [
  { value: "Strength", label: "Strength", detail: "Gym, weights" },
  { value: "Run", label: "Run", detail: "Tempo, easy, long" },
  { value: "Sprint", label: "Sprint", detail: "Speed, starts" },
  { value: "Jumps", label: "Jumps", detail: "Jumps, plyos" },
  { value: "Throws", label: "Throws", detail: "Throws, med ball" },
]

/** Add a session that was not planned: a name, a type and a day, then the normal log screen. */
export default function AthleteAddSessionPage() {
  const navigate = useNavigate()
  const today = todayIso()
  const [title, setTitle] = useState("")
  const [blockType, setBlockType] = useState<SessionBlockType | null>(null)
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [typeError, setTypeError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    const name = title.trim()
    setTitleError(name ? null : "Give the session a name.")
    setTypeError(blockType ? null : "Choose the type of session.")
    if (!name || !blockType) return
    if (!date || date > today) {
      setError("Choose today or a day in the past.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await createExtraSession({ title: name, blockType, date })
    setSaving(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    const params = new URLSearchParams()
    if (date !== today) params.set("date", date)
    params.set("session", result.data.sessionId)
    navigate(`/athlete/log?${params.toString()}`, { replace: true })
  }

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: "/athlete/log", label: "Log" }}
        title="Add a session"
        lede="Log something that was not in your plan. Your coach sees it marked as added by you. It does not change your plan adherence."
      />

      <Section aria-label="Session details" className="gap-5">
        <Field label="What was it" error={titleError ?? undefined}>
          <Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Pool run, extra gym, club race" />
        </Field>
        <Choices label="Type" columns={2} options={SESSION_TYPES} value={blockType} onChange={setBlockType} error={typeError ?? undefined} />
        <Field label="Day" hint="Today or up to 12 weeks back.">
          <Input type="date" value={date} max={today} min={addDaysIso(today, -84)} onChange={(event) => setDate(event.target.value)} />
        </Field>
        {error ? <Notice tone="error">Could not add the session. {error}</Notice> : null}
      </Section>

      <Section aria-label="Actions" className="gap-2">
        <Button variant="primary" size="lg" block disabled={saving} onClick={() => void start()}>
          {saving ? "Adding..." : "Start logging"}
        </Button>
        <LinkButton variant="quiet" block to="/athlete/log">
          Cancel
        </LinkButton>
      </Section>
    </Screen>
  )
}

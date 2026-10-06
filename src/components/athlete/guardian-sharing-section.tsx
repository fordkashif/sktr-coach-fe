"use client"

import { useEffect, useState } from "react"
import { CheckRow, List, ListRow, Notice, Section, notify } from "@/components/sk"
import { getMyGuardianSharing, setMyGuardianHealthSharing } from "@/lib/data/guardian/guardian-admin-data"
import type { MyGuardianSharing } from "@/lib/data/guardian/types"
import { healthRuleText } from "@/lib/guardian/health-visibility"

/**
 * On the athlete's profile: who follows them as a parent or guardian, and (from the age of 18)
 * the athlete's own switch for sharing health information with them. Shown only when the club
 * has given a guardian access. Guardians are added and removed by the club, not here.
 */
export function GuardianSharingSection() {
  const [sharing, setSharing] = useState<MyGuardianSharing | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getMyGuardianSharing().then((result) => {
      if (!cancelled && result.ok) setSharing(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!sharing || sharing.guardians.length === 0) return null

  const adult = sharing.healthRule === "adult_opted_in" || sharing.healthRule === "adult_not_opted_in"

  const change = async (next: boolean) => {
    if (saving) return
    setSaving(true)
    setError(null)
    const result = await setMyGuardianHealthSharing(next)
    setSaving(false)
    if (!result.ok) return setError(result.error.message)
    setSharing({ ...sharing, shareHealth: result.data, healthRule: result.data ? "adult_opted_in" : "adult_not_opted_in" })
    notify(result.data ? "Health information is now shared with your guardians" : "Health information is no longer shared")
  }

  return (
    <Section
      title="Who follows your training"
      hint="Your club gave these people a sign-in to read your plan, results and team news. They cannot change anything or message you. To remove someone, ask your coach."
      data-guardian-sharing={sharing.healthRule}
    >
      <List aria-label="Parents and guardians who follow you">
        {sharing.guardians.map((guardian, index) => (
          <ListRow key={`${guardian.name}-${index}`} title={guardian.name} subtitle={guardian.relationship} />
        ))}
        {adult ? (
          <CheckRow
            checked={sharing.shareHealth}
            onChange={(next) => void change(next)}
            disabled={saving}
            title="Share my health information with them"
            subtitle="Check-ins, pain and injury reports, medical notes and why you were off. You can switch this off again at any time."
          />
        ) : null}
      </List>
      {!adult ? <p className="pt-2 text-sm text-sk-mute">{healthRuleText(sharing.healthRule, "", "athlete")}</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Section>
  )
}

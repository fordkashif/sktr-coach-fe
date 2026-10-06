"use client"

import { useEffect, useState } from "react"
import { GuardianChildScreen, dayRange, shortDay } from "@/components/guardian/guardian-frame"
import { EmptyState, Fact, FactList, List, ListRow, Notice, ReadinessText, Screen, ScreenHeader, Section, SkeletonRows, Split, StatusText } from "@/components/sk"
import { getGuardianHealth } from "@/lib/data/guardian/guardian-data"
import type { GuardianChild, GuardianHealth } from "@/lib/data/guardian/types"
import { PAIN_SEVERITY_WORDS, painImpactLabel } from "@/lib/data/wellness/pain-report-types"
import { healthRuleText } from "@/lib/guardian/health-visibility"

const KIND_WORD = { injured: "Injured", sick: "Sick", away: "Away" } as const

function ChildHealth({ child }: { child: GuardianChild }) {
  const [health, setHealth] = useState<GuardianHealth | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setHealth(null)
    setError(null)
    void getGuardianHealth(child).then((result) => {
      if (cancelled) return
      if (result.ok) setHealth(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [child])

  const header = <ScreenHeader fact={child.teamName ?? undefined} title={`${child.firstName}'s health`} lede={healthRuleText(health?.rule ?? child.healthRule, child.firstName, "guardian")} />

  if (error) {
    return (
      <Screen>
        {header}
        <Notice tone="error">{`Health information could not be loaded. ${error}`}</Notice>
      </Screen>
    )
  }

  if (health && !health.visible) {
    return (
      <Screen width="narrow">
        {header}
        <Section aria-label="Health information" data-health="hidden">
          <EmptyState
            title="Health information is not shared with you"
            body={
              child.healthRule === "unknown_age"
                ? `The club has no date of birth for ${child.firstName}. Until the coach adds it, check-ins, pain reports, medical notes and the reasons for time off stay hidden.`
                : `${child.firstName} is an adult, so check-ins, pain reports, medical notes and the reasons for time off are theirs to share. They can switch this on in their profile.`
            }
          />
        </Section>
      </Screen>
    )
  }

  const current = health?.availability.find((period) => period.current) ?? null

  return (
    <Screen>
      {header}
      {current ? <Notice tone="warning">{`${child.firstName} is marked ${KIND_WORD[current.kind].toLowerCase()} ${current.endsOn ? `until ${shortDay(current.endsOn)}` : "until further notice"}.`}</Notice> : null}
      <Split
        main={
          <>
            <Section title="Check-ins" hint="How they said they felt before training.">
              {!health ? (
                <SkeletonRows rows={4} />
              ) : health.checkIns.length === 0 ? (
                <EmptyState title="No check-ins yet" body={`When ${child.firstName} does a daily check-in, it shows here.`} />
              ) : (
                <List aria-label="Check-ins">
                  {health.checkIns.map((entry) => (
                    <ListRow
                      key={entry.date}
                      title={shortDay(entry.date)}
                      subtitle={[entry.sleepHours !== null ? `Slept ${entry.sleepHours} h` : null, entry.note].filter(Boolean).join(". ") || undefined}
                      trailing={<ReadinessText status={entry.readiness} />}
                    />
                  ))}
                </List>
              )}
            </Section>

            <Section title="Pain and injury reports">
              {!health ? (
                <SkeletonRows rows={2} />
              ) : health.painReports.length === 0 ? (
                <EmptyState title="No pain or injury reported" />
              ) : (
                <List aria-label="Pain and injury reports">
                  {health.painReports.map((report) => (
                    <ListRow
                      key={report.id}
                      title={report.areas.join(", ") || "Pain report"}
                      subtitle={[`${PAIN_SEVERITY_WORDS[report.severity - 1] ?? "Pain"}, since ${shortDay(report.startedOn)}`, painImpactLabel(report.impact), report.note].filter(Boolean).join(". ")}
                      trailing={report.open ? <StatusText tone={report.impact === "cannot_train" ? "coral" : "amber"}>Open</StatusText> : <StatusText tone="green">Resolved</StatusText>}
                    />
                  ))}
                </List>
              )}
            </Section>
          </>
        }
        side={
          <>
            <Section title="Medical notes" hint="What the club holds, so the coach knows in an emergency.">
              {!health ? (
                <SkeletonRows rows={1} />
              ) : (
                <FactList>
                  <Fact label="Notes" stack empty="Nothing on file">
                    {health.medicalNotes}
                  </Fact>
                </FactList>
              )}
            </Section>

            <Section title="Time off" hint="When they were marked injured, sick or away.">
              {!health ? (
                <SkeletonRows rows={1} />
              ) : health.availability.length === 0 ? (
                <EmptyState title="No time off recorded" />
              ) : (
                <List aria-label="Time off">
                  {health.availability.map((period) => (
                    <ListRow
                      key={period.id}
                      title={KIND_WORD[period.kind]}
                      subtitle={[period.endsOn ? dayRange(period.startsOn, period.endsOn) : `From ${shortDay(period.startsOn)}`, period.note].filter(Boolean).join(". ")}
                      trailing={period.current ? <StatusText tone="amber">Now</StatusText> : undefined}
                    />
                  ))}
                </List>
              )}
            </Section>
          </>
        }
      />
    </Screen>
  )
}

/** Health information of the athlete a guardian follows: only for a minor, or an adult who chose to share it. */
export default function GuardianHealthPage() {
  return <GuardianChildScreen title="Health">{(child) => <ChildHealth child={child} />}</GuardianChildScreen>
}

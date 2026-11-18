"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { GuardianChildScreen, dayRange, shortDay } from "@/components/guardian/guardian-frame"
import { Bars, EmptyState, Fact, FactList, List, ListRow, Notice, ReadinessBar, ReadinessText, Screen, ScreenHeader, Section, SkeletonRows, Split, StatusText } from "@/components/sk"
import { getGuardianHealth } from "@/lib/data/guardian/guardian-data"
import type { GuardianChild, GuardianHealth } from "@/lib/data/guardian/types"
import { PAIN_SEVERITY_WORDS, painImpactLabel } from "@/lib/data/wellness/pain-report-types"
import { healthRuleText } from "@/lib/guardian/health-visibility"

const KIND_WORD = { injured: "Injured", sick: "Sick", away: "Away" } as const

const READY_WORD = { green: "Ready", yellow: "Watch", red: "Review" } as const

/** The latest check-in as one big word, how the recent ones split, and sleep as bars. */
function CheckInSummary({ checkIns }: { checkIns: GuardianHealth["checkIns"] }) {
  const latest = checkIns[0]
  const count = (tone: "green" | "yellow" | "red") => checkIns.filter((entry) => entry.readiness === tone).length
  const sleep = checkIns.filter((entry) => entry.sleepHours !== null).slice(0, 5).reverse()
  return (
    <div className="grid gap-2.5 sm:grid-cols-2" data-check-in-summary>
      <div className="sk-tile flex flex-col gap-3 p-4">
        <p className="text-sm font-bold text-sk-mute">Latest check-in, {shortDay(latest.date)}</p>
        <p className={cn("font-display text-[3rem] font-black uppercase leading-[0.85]", latest.readiness === "green" ? "text-sk-green-ink" : latest.readiness === "yellow" ? "text-sk-amber-ink" : "text-sk-coral-ink")}>{READY_WORD[latest.readiness]}</p>
        <ReadinessBar className="mt-auto" ready={count("green")} watch={count("yellow")} review={count("red")} />
      </div>
      {sleep.length > 1 ? (
        <div className="sk-tile p-4">
          <p className="mb-3 text-sm font-bold text-sk-mute">Sleep</p>
          <Bars label="Hours slept, oldest first" bestWord="" items={sleep.map((entry) => ({ key: entry.date, label: shortDay(entry.date).replace(/^\w+, /, ""), value: entry.sleepHours ?? 0, display: `${entry.sleepHours}h` }))} />
        </div>
      ) : null}
    </div>
  )
}

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
            <Section title="Check-ins">
              {!health ? (
                <SkeletonRows rows={4} />
              ) : health.checkIns.length === 0 ? (
                <EmptyState title="No check-ins yet" />
              ) : (
                <>
                <CheckInSummary checkIns={health.checkIns} />
                <List aria-label="Check-ins" className="mt-3">
                  {health.checkIns.map((entry) => (
                    <ListRow
                      key={entry.date}
                      title={shortDay(entry.date)}
                      subtitle={[entry.sleepHours !== null ? `Slept ${entry.sleepHours} h` : null, entry.note].filter(Boolean).join(". ") || undefined}
                      trailing={<ReadinessText status={entry.readiness} />}
                    />
                  ))}
                </List>
                </>
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
            <Section title="Medical notes">
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

            <Section title="Time off">
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

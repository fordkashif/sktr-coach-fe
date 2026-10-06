"use client"

import { clubToday } from "@/lib/club-day"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { GuardianChildScreen, dayRange, shortDay } from "@/components/guardian/guardian-frame"
import { Avatar, EmptyState, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, Split, StatusText } from "@/components/sk"
import { weekStartOf } from "@/lib/data/guardian/mock-guardian-content"
import { getGuardianAnnouncements, getGuardianCoaches, getGuardianResults, getGuardianWeek } from "@/lib/data/guardian/guardian-data"
import type { GuardianAnnouncement, GuardianChild, GuardianCoach, GuardianCompetition, GuardianWeek } from "@/lib/data/guardian/types"
import { teamCoachRoleLabel } from "@/lib/coach-permissions"
import { useGuardianChildren } from "@/lib/guardian/children-store"
import { guardianSeesHealth, healthRuleText } from "@/lib/guardian/health-visibility"

/** Today as the club has it, the day the child's plan is written for. */
function todayIso() {
  return clubToday()
}

type HomeData = { week: GuardianWeek | null; coaches: GuardianCoach[]; next: GuardianCompetition | null; news: GuardianAnnouncement[]; error: string | null }

function ChildHome({ child }: { child: GuardianChild }) {
  const { children, select } = useGuardianChildren()
  const [data, setData] = useState<HomeData | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    void Promise.all([getGuardianWeek(child.athleteId, weekStartOf(todayIso())), getGuardianCoaches(child.athleteId), getGuardianResults(child), getGuardianAnnouncements([child])]).then(([week, coaches, results, news]) => {
      if (cancelled) return
      const failed = [week, coaches, results, news].find((part) => !part.ok)
      setData({
        week: week.ok ? week.data : null,
        coaches: coaches.ok ? coaches.data : [],
        next: results.ok ? (results.data.upcoming[0] ?? null) : null,
        news: news.ok ? news.data.slice(0, 3) : [],
        error: failed && !failed.ok ? failed.error.message : null,
      })
    })
    return () => {
      cancelled = true
    }
  }, [child])

  const today = data?.week?.days.find((day) => day.state === "today") ?? null
  const others = children.filter((item) => item.athleteId !== child.athleteId)

  return (
    <Screen>
      <ScreenHeader
        fact={[child.teamName, child.clubName].filter(Boolean).join(", ") || undefined}
        title={child.name}
        lede={`You follow ${child.firstName} as their ${child.relationship.toLowerCase()}. You can read, not change, what is here.`}
      />

      {data?.error ? <Notice tone="error">{`Some of this could not be loaded. ${data.error}`}</Notice> : null}

      <Split
        main={
          <>
            <Section title="This week" action={<ListLink to="/guardian/plan" label="Open the plan" />}>
              {!data ? (
                <SkeletonRows rows={2} />
              ) : !data.week || data.week.planned === 0 ? (
                <EmptyState title="Nothing planned this week" body={`When the coach publishes a plan for ${child.firstName}, the week shows here.`} />
              ) : (
                <List>
                  <ListRow
                    to="/guardian/plan"
                    title={today?.title ?? (today ? "Session today" : "No session today")}
                    subtitle={today ? (today.focus ?? "Planned for today") : "Today is a rest day in the plan."}
                    trailing={today ? <StatusText tone="blue">Today</StatusText> : undefined}
                  />
                  <ListRow
                    to="/guardian/plan"
                    title={`${data.week.done} of ${data.week.planned} sessions done`}
                    subtitle={data.week.skipped > 0 ? `${data.week.skipped} skipped. ${data.week.planName ?? "Training plan"}.` : (data.week.planName ?? "Training plan")}
                  />
                </List>
              )}
            </Section>

            <Section title="Next competition" action={<ListLink to="/guardian/results" label="Results" />}>
              {!data ? (
                <SkeletonRows rows={1} />
              ) : data.next ? (
                <List>
                  <ListRow
                    to="/guardian/results"
                    title={data.next.name}
                    subtitle={[dayRange(data.next.startDate, data.next.endDate), data.next.place].filter(Boolean).join(", ")}
                    trailing={data.next.events.length > 0 ? data.next.events.join(", ") : undefined}
                  />
                </List>
              ) : (
                <EmptyState title="No competition coming up" body="Meets the coach adds for the team show here." />
              )}
            </Section>

            <Section title="Announcements" action={<ListLink to="/guardian/news" label="See all" />}>
              {!data ? (
                <SkeletonRows rows={2} />
              ) : data.news.length === 0 ? (
                <EmptyState title="No announcements yet" body="What the coach or the club posts to the team shows here." />
              ) : (
                <List>
                  {data.news.map((item) => (
                    <ListRow key={item.id} to="/guardian/news" title={<span className="line-clamp-2">{item.body}</span>} subtitle={`${item.from}, ${shortDay(item.createdAt)}`} />
                  ))}
                </List>
              )}
            </Section>
          </>
        }
        side={
          <>
            <Section title={data && data.coaches.length > 1 ? "Coaches" : "Coach"} hint="To reach the coach, use the contact shown here.">
              {!data ? (
                <SkeletonRows rows={1} leading />
              ) : data.coaches.length === 0 ? (
                <EmptyState title="No coach on this team yet" body="Contact the club if you need to reach someone." />
              ) : (
                <List>
                  {data.coaches.map((coach) => (
                    <ListRow
                      key={`${coach.name}-${coach.role}`}
                      leading={<Avatar name={coach.name} size="md" />}
                      title={coach.name}
                      subtitle={coach.email ? <span className="break-all">{coach.email}</span> : `${teamCoachRoleLabel(coach.role)}. No contact shared here, ask the club.`}
                      href={coach.email ? `mailto:${coach.email}` : undefined}
                      data-coach-contact={coach.email ?? "none"}
                    />
                  ))}
                </List>
              )}
            </Section>

            <Section title="More about them">
              <List>
                <ListRow
                  to="/guardian/health"
                  title="Health"
                  subtitle={guardianSeesHealth(child.healthRule) ? "Check-ins, pain reports and medical notes." : healthRuleText(child.healthRule, child.firstName, "guardian")}
                />
                <ListRow to="/guardian/calendar" title="Calendar" subtitle="Team events, competitions and test weeks." />
                <ListRow to="/guardian/contact" title="Your contact details" subtitle="What the club holds to reach you about them." />
              </List>
            </Section>

            {others.length > 0 ? (
              <Section title="Your other athletes">
                <List>
                  {others.map((other) => (
                    <ListRow key={other.athleteId} leading={<Avatar name={other.name} size="md" />} title={other.name} subtitle={other.teamName ?? "No team yet"} onClick={() => select(other.athleteId)} data-child-row={other.athleteId} />
                  ))}
                </List>
              </Section>
            ) : null}
          </>
        }
      />
    </Screen>
  )
}

function ListLink({ to, label }: { to: string; label: string }) {
  return (
    <Link className="sk-link" to={to}>
      {label}
    </Link>
  )
}

/** A parent or guardian's home: the athlete they follow, this week, what is next, who the coach is. */
export default function GuardianHomePage() {
  return <GuardianChildScreen title="Home" width="default">{(child) => <ChildHome child={child} />}</GuardianChildScreen>
}

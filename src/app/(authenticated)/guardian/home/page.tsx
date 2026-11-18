"use client"

import { clubToday } from "@/lib/club-day"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { GuardianChildScreen, dayRange, shortDay } from "@/components/guardian/guardian-frame"
import { Avatar, Countdown, EmptyState, HeroAction, List, ListRow, Notice, Ring, Screen, ScreenHeader, Section, SkeletonRows, Split, WeekRail } from "@/components/sk"
import { weekStartOf } from "@/lib/data/guardian/mock-guardian-content"
import { getGuardianAnnouncements, getGuardianCoaches, getGuardianResults, getGuardianWeek } from "@/lib/data/guardian/guardian-data"
import type { GuardianAnnouncement, GuardianChild, GuardianCoach, GuardianCompetition, GuardianDayState, GuardianWeek } from "@/lib/data/guardian/types"
import { teamCoachRoleLabel } from "@/lib/coach-permissions"
import { useGuardianChildren } from "@/lib/guardian/children-store"
import { guardianSeesHealth, healthRuleText } from "@/lib/guardian/health-visibility"

/** Today as the club has it, the day the child's plan is written for. */
function todayIso() {
  return clubToday()
}

/** The photo behind today's card (public/images/athlete, from Unsplash). */
const WEEK_PHOTO = "/images/athlete/stride.webp"

const DAY_WORD: Record<GuardianDayState, string> = { done: "Done", skipped: "Skipped", missed: "Missed", today: "Today", planned: "Planned", rest: "" }

/** "Mon" for a YYYY-MM-DD day. */
function weekday(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" })
}

/** Whole days from the club's today to a YYYY-MM-DD day. */
function daysUntil(day: string) {
  const from = new Date(`${todayIso()}T12:00:00`).getTime()
  const to = new Date(`${day}T12:00:00`).getTime()
  return Math.round((to - from) / 86_400_000)
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
            <section aria-labelledby="guardian-week-heading" data-guardian-week className="sk-hero-wrap">
              <img src={WEEK_PHOTO} alt="" aria-hidden className="sk-hero-photo" loading="eager" decoding="async" />
              <div className="sk-hero sk-hero-over">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id="guardian-week-heading" className="sk-hero-label">
                    Today
                  </h2>
                  {data?.week?.planName ? <p className="sk-hero-label min-w-0 truncate">{data.week.planName}</p> : null}
                </div>
                {!data ? (
                  <SkeletonRows rows={2} label="Loading this week" />
                ) : !data.week || data.week.planned === 0 ? (
                  <>
                    <p className="sk-hero-title">Nothing planned</p>
                    <p className="sk-hero-body">{`When the coach publishes a plan for ${child.firstName}, the week shows here.`}</p>
                  </>
                ) : (
                  <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between 2xl:gap-8">
                    <div className="min-w-0">
                      <p className="sk-hero-title">{today ? (today.title ?? "Session today") : "Rest day"}</p>
                      <p className="sk-hero-body">{today ? (today.focus ?? "Planned for today") : "Today is a rest day in the plan."}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="shrink-0 rounded-full bg-white p-1.5" role="img" aria-label={`${data.week.done} of ${data.week.planned} sessions done this week`}>
                        <Ring progress={data.week.planned > 0 ? data.week.done / data.week.planned : 0} size={80}>
                          <span className="font-display text-[1.75rem] font-black leading-none text-sk-ink">
                            {data.week.done}
                            <span className="text-[1rem]">/{data.week.planned}</span>
                          </span>
                        </Ring>
                      </span>
                      <span className="min-w-0 flex-1 2xl:flex-none">
                        <HeroAction to="/guardian/plan">Open the plan</HeroAction>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {data?.week && data.week.planned > 0 ? (
              <Section title="This week">
                <WeekRail
                  label={`${child.firstName}'s week`}
                  days={data.week.days.map((day) => ({
                    key: day.date,
                    day: weekday(day.date),
                    title: day.state === "rest" ? "Rest" : (day.title ?? "Session"),
                    detail: DAY_WORD[day.state],
                    today: day.state === "today",
                    rest: day.state === "rest",
                    to: "/guardian/plan",
                  }))}
                />
              </Section>
            ) : null}

            <Section title="Next competition" action={<ListLink to="/guardian/results" label="Results" />}>
              {!data ? (
                <SkeletonRows rows={1} />
              ) : data.next ? (
                <Link to="/guardian/results" className="sk-tile flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between" data-guardian-next={data.next.name}>
                  <span className="min-w-0">
                    <span className="block font-display text-[1.75rem] font-black uppercase leading-none text-sk-ink">{data.next.name}</span>
                    <span className="mt-1.5 block text-sm text-sk-mute">{[dayRange(data.next.startDate, data.next.endDate), data.next.place].filter(Boolean).join(", ")}</span>
                    {data.next.events.length > 0 ? (
                      <span className="mt-3 flex flex-wrap gap-1.5">
                        {data.next.events.map((event) => (
                          <span key={event} className="rounded-full bg-white px-3 py-1 text-sm font-bold text-sk-ink">
                            {event}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <Countdown days={daysUntil(data.next.startDate)} />
                </Link>
              ) : (
                <EmptyState title="No competition coming up" />
              )}
            </Section>

            <Section title="Announcements" action={<ListLink to="/guardian/news" label="See all" />}>
              {!data ? (
                <SkeletonRows rows={2} />
              ) : data.news.length === 0 ? (
                <EmptyState title="No announcements yet" />
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
            <Section title={data && data.coaches.length > 1 ? "Coaches" : "Coach"}>
              {!data ? (
                <SkeletonRows rows={1} leading />
              ) : data.coaches.length === 0 ? (
                <EmptyState title="No coach on this team yet" />
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

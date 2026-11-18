import { Avatar, Section } from "@/components/sk"
import { PersonAvatar } from "@/components/account/person-avatar"
import { dayHeading, formatDateTime, timeOfDay } from "@/lib/format/ops-format"

export type ActivityItem = {
  id: string
  /** ISO timestamp. */
  at: string
  /** Local calendar day (YYYY-MM-DD) the event happened on. */
  day: string
  /** Who did it, as shown: a name, an email or "System". */
  who: string
  /** Their role in words, when the name alone does not say it. */
  role: string | null
  /** What happened, as one plain sentence without a full stop. */
  title: string
  /** One supporting line: the reason, the count, the note. */
  detail: string | null
  /** One short fact shown beside the time: the club an event is about. */
  about?: string | null
  /** For the photo: the actor's user id or email, when the viewer may see it. */
  userId?: string | null
  email?: string | null
}

/**
 * An activity log as list rows grouped by local day, newest first: who (photo or initials), what
 * happened in one sentence, a supporting line, then who and when. Shared by the club's Activity
 * screen and the platform's. Read only.
 */
export function ActivityDays({ items, people = false }: { items: ActivityItem[]; /** Look up photos of club members. */ people?: boolean }) {
  const days: Array<{ day: string; items: ActivityItem[] }> = []
  for (const item of items) {
    const last = days[days.length - 1]
    if (last && last.day === item.day) last.items.push(item)
    else days.push({ day: item.day, items: [item] })
  }

  return (
    <>
      {days.map((group) => {
        const heading = dayHeading(group.day)
        return (
          <Section key={group.day || "undated"} title={heading}>
            <ol aria-label={`Activity, ${heading}`} className="sk-timeline relative ml-[1.375rem] border-l-2 border-sk-sw-grey pl-0">
              {group.items.map((item, index) => (
                <li key={item.id} className="sk-timeline-item relative pb-3 pl-7 last:pb-0" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
                  <span className="absolute -left-[1.375rem] top-2 rounded-full bg-white p-[3px]">
                    {people ? <PersonAvatar name={item.who} userId={item.userId} email={item.email} size="sm" /> : <Avatar name={item.who} size="sm" />}
                  </span>
                  <div className="sk-tile flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                    <time dateTime={item.at} title={formatDateTime(item.at)} className="shrink-0 font-display text-[1.375rem] font-black leading-none tabular-nums text-sk-ink sm:w-[4.5rem] sm:pt-0.5">
                      {timeOfDay(item.at)}
                    </time>
                    <div className="min-w-0">
                      <p className="sk-list-title break-words">{item.title}</p>
                      {item.detail ? <p className="sk-list-sub mt-0.5 break-words">{item.detail}</p> : null}
                      <p className="sk-list-sub mt-1 break-words">
                        {item.who}
                        {item.role ? `, ${item.role}` : ""}
                        {item.about ? ` · ${item.about}` : ""}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )
      })}
    </>
  )
}

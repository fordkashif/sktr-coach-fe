import { Avatar, List, ListRow, Section } from "@/components/sk"
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
            <List aria-label={`Activity, ${heading}`}>
              {group.items.map((item) => (
                <ListRow
                  key={item.id}
                  className="items-start"
                  leading={
                    people ? (
                      <PersonAvatar name={item.who} userId={item.userId} email={item.email} size="sm" className="mt-0.5" />
                    ) : (
                      <Avatar name={item.who} size="sm" className="mt-0.5" />
                    )
                  }
                >
                  <span className="sk-list-title break-words">{item.title}</span>
                  {item.detail ? <span className="sk-list-sub mt-0.5 break-words">{item.detail}</span> : null}
                  <span className="sk-list-sub mt-1 break-words">
                    {item.who}
                    {item.role ? `, ${item.role}` : ""}
                    {item.about ? ` · ${item.about}` : ""}
                    {" · "}
                    <time dateTime={item.at} title={formatDateTime(item.at)}>
                      {timeOfDay(item.at)}
                    </time>
                  </span>
                </ListRow>
              ))}
            </List>
          </Section>
        )
      })}
    </>
  )
}

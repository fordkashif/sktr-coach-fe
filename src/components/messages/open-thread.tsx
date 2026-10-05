"use client"

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ConversationScreen, EmptyState, LinkButton, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { messagesHomeHref, threadHref } from "@/lib/data/messages/links"
import { openMessageThread } from "@/lib/data/messages/messages-data"

/**
 * The step between "Message Maya" and the conversation: finds the thread with that person, or
 * starts it, and goes there. When the database refuses (not on a team you coach, no login) it
 * says why instead.
 */
export function OpenThread({ role, target }: { role: "coach" | "athlete"; target: { athleteId: string } | { coachUserId: string } }) {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const targetKey = "athleteId" in target ? `a:${target.athleteId}` : `c:${target.coachUserId}`

  useEffect(() => {
    let cancelled = false
    const [kind, id] = [targetKey.slice(0, 1), targetKey.slice(2)]
    void openMessageThread(kind === "a" ? { athleteId: id } : { coachUserId: id }).then((result) => {
      if (cancelled) return
      if (result.ok) navigate(threadHref(role, result.data), { replace: true })
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [navigate, role, targetKey])

  const backTo = messagesHomeHref(role, "direct")
  return (
    <ConversationScreen>
      <ScreenHeader back={{ to: backTo, label: "Messages" }} title="Conversation" />
      {error ? (
        <Section title="This conversation cannot be opened">
          <EmptyState
            title={error}
            body={role === "coach" ? "You can message athletes who are on a team you coach and have their own login." : "You can message the coaches of the team you are on."}
            action={
              <LinkButton to={backTo} size="sm">
                Back to messages
              </LinkButton>
            }
          />
        </Section>
      ) : (
        <Section aria-label="Opening">
          <SkeletonRows rows={4} label="Opening the conversation" />
        </Section>
      )}
    </ConversationScreen>
  )
}

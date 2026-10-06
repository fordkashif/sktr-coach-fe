import { useCallback, useEffect, useMemo, useState } from "react"
import { MediaThumb, MediaViewer } from "@/components/athlete/log/session-media"
import { ActionRow, List } from "@/components/sk"
import { mediaCountLabel, mediaLabel, type SessionMediaItem } from "@/lib/data/session/session-media"
import { listAthleteSessionMedia, removeSessionMedia, saveMediaComment } from "@/lib/data/session/session-media-data"

/**
 * The photos and videos an athlete attached to their sessions, for the coach's list of logged
 * sessions. One read for all the sessions on screen. A coach watches and comments here; adding
 * one for the athlete happens only while logging a session for them.
 */
export function useAthleteSessionMedia(athleteId: string, sessionIds: string[]) {
  const [items, setItems] = useState<SessionMediaItem[]>([])
  const key = sessionIds.join("|")

  useEffect(() => {
    let cancelled = false
    setItems([])
    if (!athleteId || !key) return
    // A hint beside the log: when it cannot be read the sessions still show without it.
    void listAthleteSessionMedia(athleteId, key.split("|")).then((result) => {
      if (!cancelled && result.ok) setItems(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [athleteId, key])

  const bySession = useMemo(() => {
    const map = new Map<string, SessionMediaItem[]>()
    for (const item of items) map.set(item.sessionId, [...(map.get(item.sessionId) ?? []), item])
    return map
  }, [items])

  const saveComment = useCallback(async (item: SessionMediaItem, text: string) => {
    const result = await saveMediaComment(item.id, text)
    if (result.ok) setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, ...result.data } : entry)))
    return result
  }, [])

  const remove = useCallback(async (item: SessionMediaItem) => {
    const result = await removeSessionMedia(item)
    if (result.ok) setItems((current) => current.filter((entry) => entry.id !== item.id))
    return result
  }, [])

  return { bySession, saveComment, remove }
}

export type AthleteSessionMedia = ReturnType<typeof useAthleteSessionMedia>

/** The media of one logged session, as rows under it. Each opens the player with the comment box. */
export function SessionMediaForCoach({
  media,
  sessionId,
  athleteFirstName,
  labels = {},
  canComment,
  canRemove = false,
}: {
  media: AthleteSessionMedia
  sessionId: string
  athleteFirstName: string
  /** Exercise names by row id. */
  labels?: Record<string, string>
  /** Lead coaches, coaches and club admins. An assistant coach watches without commenting. */
  canComment: boolean
  /** Club admins, to take down something that should not be there. */
  canRemove?: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const items = media.bySession.get(sessionId) ?? []
  const open = items.find((item) => item.id === openId) ?? null
  if (items.length === 0) return null
  return (
    <div data-session-media-coach={sessionId} className="pl-[26px]">
      <p className="text-sm font-semibold text-sk-ink-2">{mediaCountLabel(items)} from {athleteFirstName}</p>
      <List aria-label={`Photos and videos from ${athleteFirstName}`}>
        {items.map((item) => (
          <ActionRow
            key={item.id}
            data-media-item={item.kind}
            leading={<MediaThumb kind={item.kind} url={item.url} />}
            title={mediaLabel(item, item.rowId ? labels[item.rowId] : null)}
            subtitle={
              <>
                {item.caption ? `"${item.caption}"` : null}
                <span className="mt-0.5 block text-sk-ink-2" data-coach-comment>
                  {item.coachComment ? `Comment: ${item.coachComment}` : canComment ? "Open to watch and comment" : "Open to watch"}
                </span>
              </>
            }
            onClick={() => setOpenId(item.id)}
          />
        ))}
      </List>
      <MediaViewer
        item={open}
        exercise={open?.rowId ? labels[open.rowId] : null}
        onClose={() => setOpenId(null)}
        comment={canComment && open ? { onSave: (text) => media.saveComment(open, text), hint: `Short and specific. ${athleteFirstName} sees it under the ${open.kind} and is told.` } : undefined}
        commentLabel="Coach comment"
        onRemove={canRemove && open ? () => media.remove(open) : undefined}
        removeQuestion={open ? `Remove this ${open.kind} from ${athleteFirstName}'s log? It is deleted for good.` : undefined}
      />
    </div>
  )
}

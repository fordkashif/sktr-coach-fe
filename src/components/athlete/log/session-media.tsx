import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Camera, Image as ImageIcon, Play, VideoCamera } from "@phosphor-icons/react"
import { ActionRow, Button, Dialog, Field, InlineConfirm, Input, List, Meter, Notice, Section, StatusText, Textarea, notify } from "@/components/sk"
import {
  CAPTION_MAX_LENGTH,
  COMMENT_MAX_LENGTH,
  MAX_MEDIA_PER_SESSION,
  VIDEO_MAX_SECONDS,
  checkRoom,
  formatBytes,
  mediaLabel,
  uploadStatusText,
  type PendingUpload,
  type SessionMediaItem,
} from "@/lib/data/session/session-media"
import { countAthleteMedia, listSessionMedia, removeSessionMedia, saveMediaCaption } from "@/lib/data/session/session-media-data"
import { prepareMediaFile } from "@/lib/data/session/session-media-prepare"
import {
  addUpload,
  cancelUpload,
  getUploads,
  onUploadDone,
  resumeUploads,
  retryUpload,
  subscribeUploads,
  uploadPreview,
  uploadsOnline,
} from "@/lib/data/session/session-media-uploads"

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  // Older browsers: the same shape, from random numbers.
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
}

/**
 * The photos and videos of one session: what is saved, what is still uploading or waiting, and
 * the moves (add, cancel, try again, caption, remove). `athleteId` is set when a coach is logging
 * the session for that athlete; without it the signed-in athlete's own session is meant.
 */
export function useSessionMedia(sessionId: string | null, options: { athleteId?: string | null } = {}) {
  const athleteId = options.athleteId ?? null
  const [items, setItems] = useState<SessionMediaItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [problem, setProblem] = useState<{ rowId: string | null; message: string } | null>(null)
  const [preparing, setPreparing] = useState<string | null>(null)
  const allUploads = useSyncExternalStore(subscribeUploads, getUploads, getUploads)
  const uploads = useMemo(
    () => allUploads.filter((entry) => entry.sessionId === sessionId && entry.athleteId === athleteId),
    [allUploads, athleteId, sessionId],
  )

  useEffect(() => {
    resumeUploads()
  }, [])

  useEffect(() => {
    setItems([])
    setLoaded(false)
    setProblem(null)
    if (!sessionId) return
    let cancelled = false
    void listSessionMedia(sessionId, athleteId).then((result) => {
      if (cancelled) return
      // Offline or refused: nothing saved shows, what is waiting on the phone still does.
      if (result.ok) setItems((current) => [...result.data, ...current.filter((item) => !result.data.some((saved) => saved.id === item.id))])
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [athleteId, sessionId])

  useEffect(() => {
    if (!sessionId) return
    return onUploadDone((item) => {
      if (item.sessionId !== sessionId) return
      setItems((current) => (current.some((entry) => entry.id === item.id) ? current : [...current, item]))
    })
  }, [sessionId])

  const total = items.length + uploads.length
  const full = total >= MAX_MEDIA_PER_SESSION

  const add = useCallback(
    async (file: File, rowId: string | null) => {
      if (!sessionId) return
      setProblem(null)
      const slot = rowId ?? "session"
      setPreparing(slot)
      try {
        const room = checkRoom({ sessionCount: total, athleteCount: await countAthleteMedia(athleteId) })
        if (!room.ok) {
          setProblem({ rowId, message: room.message })
          return
        }
        const prepared = await prepareMediaFile(file)
        if (!prepared.ok) {
          setProblem({ rowId, message: prepared.message })
          return
        }
        const queued = await addUpload({ id: newId(), sessionId, athleteId, rowId, caption: null, ...prepared.data })
        if (!queued.ok) setProblem({ rowId, message: queued.message })
      } finally {
        setPreparing(null)
      }
    },
    [athleteId, sessionId, total],
  )

  const remove = useCallback(async (item: SessionMediaItem) => {
    const result = await removeSessionMedia(item)
    if (result.ok) setItems((current) => current.filter((entry) => entry.id !== item.id))
    return result
  }, [])

  const saveCaption = useCallback(async (item: SessionMediaItem, text: string) => {
    const result = await saveMediaCaption(item.id, text)
    if (result.ok) setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, caption: result.data.caption } : entry)))
    return result
  }, [])

  return {
    sessionId,
    items,
    uploads,
    loaded,
    total,
    full,
    problem,
    clearProblem: () => setProblem(null),
    preparing,
    add,
    remove,
    saveCaption,
    cancel: (id: string) => void cancelUpload(id),
    retry: retryUpload,
  }
}

export type SessionMediaController = ReturnType<typeof useSessionMedia>

/** The small square picture of an item in a list. A video shows its first frame with a play mark. */
export function MediaThumb({ kind, url }: { kind: "photo" | "video"; url: string | null }) {
  return (
    <span className="relative block size-14 shrink-0 overflow-hidden rounded-xl bg-sk-soft">
      {url && kind === "photo" ? <img src={url} alt="" className="size-full object-cover" loading="lazy" /> : null}
      {url && kind === "video" ? <video src={`${url}#t=0.1`} className="size-full object-cover" preload="metadata" muted playsInline tabIndex={-1} aria-hidden /> : null}
      {!url ? (
        <span className="flex size-full items-center justify-center text-sk-faint">
          {kind === "video" ? <VideoCamera className="size-6" weight="bold" aria-hidden /> : <ImageIcon className="size-6" weight="bold" aria-hidden />}
        </span>
      ) : null}
      {url && kind === "video" ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-6 items-center justify-center rounded-full bg-white text-sk-ink">
            <Play className="size-3" weight="fill" aria-hidden />
          </span>
        </span>
      ) : null}
    </span>
  )
}

/** "Add photo or video": opens the phone's own chooser (camera or library). */
export function AddMediaButton({
  media,
  rowId,
  name,
  variant = "quiet",
}: {
  media: SessionMediaController
  rowId: string | null
  /** What it is for, said to screen readers: the exercise, or "this session". */
  name: string
  variant?: "quiet" | "secondary"
}) {
  const input = useRef<HTMLInputElement>(null)
  const slot = rowId ?? "session"
  const busy = media.preparing === slot
  if (!media.sessionId) return null
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={`Photo or video for ${name}`}
        data-media-input={slot}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // The same file can be picked again after a refusal.
          event.target.value = ""
          if (file) void media.add(file, rowId)
        }}
      />
      <Button variant={variant} size="sm" disabled={busy || media.full} onClick={() => input.current?.click()}>
        <Camera className="size-4" weight="bold" aria-hidden />
        {busy ? "Getting it ready..." : "Add photo or video"}
      </Button>
    </>
  )
}

function UploadRow({ upload, label, media }: { upload: PendingUpload; label: string; media: SessionMediaController }) {
  const online = uploadsOnline()
  const tone = upload.status === "failed" ? "coral" : upload.status === "uploading" ? "blue" : "amber"
  return (
    <ActionRow
      data-media-upload={upload.status}
      leading={<MediaThumb kind={upload.kind} url={uploadPreview(upload.id)} />}
      title={label}
      subtitle={
        <>
          <span role="status" className="block">
            <StatusText tone={tone}>{uploadStatusText(upload, online)}</StatusText>
          </span>
          {upload.status === "uploading" ? <Meter value={upload.progress * 100} className="mt-1.5 max-w-48" label={`${label}, upload progress`} /> : null}
          {upload.status === "failed" && upload.message ? <span className="mt-0.5 block text-sk-ink-2">{upload.message}</span> : null}
          {upload.status === "waiting" && !upload.kept ? <span className="mt-0.5 block">Keep this page open until it is sent.</span> : null}
        </>
      }
      actions={
        <>
          {upload.status === "failed" ? (
            <Button variant="quiet" size="sm" onClick={() => media.retry(upload.id)}>
              Try again
            </Button>
          ) : null}
          <Button variant="quiet" size="sm" aria-label={`${upload.status === "failed" ? "Remove" : "Cancel"} ${label}`} onClick={() => media.cancel(upload.id)}>
            {upload.status === "failed" ? "Remove" : "Cancel"}
          </Button>
        </>
      }
    />
  )
}

/**
 * The rows of photos and videos for one exercise, or for the whole session. Each row opens the
 * item. Nothing is drawn when there is nothing to show.
 */
export function MediaRows({
  media,
  show,
  labels = {},
  staff = false,
  "aria-label": ariaLabel = "Photos and videos",
}: {
  media: SessionMediaController
  /** Which items belong here, by the exercise they were added to (null: the whole session). */
  show: (rowId: string | null) => boolean
  /** Exercise names by row id, to say what an item is of when the list mixes exercises. */
  labels?: Record<string, string>
  /**
   * True when a coach is logging for the athlete. The athlete's own items are theirs to caption
   * and remove; a coach changes only what was added for the athlete.
   */
  staff?: boolean
  "aria-label"?: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const canEdit = (item: SessionMediaItem) => !staff || item.addedByStaff
  const items = media.items.filter((item) => show(item.rowId))
  const uploads = media.uploads.filter((upload) => show(upload.rowId))
  const open = media.items.find((item) => item.id === openId) ?? null
  if (items.length === 0 && uploads.length === 0) return null
  return (
    <>
      <List aria-label={ariaLabel} data-media-list>
        {items.map((item) => {
          const label = mediaLabel(item, item.rowId ? labels[item.rowId] : null)
          return (
            <ActionRow
              key={item.id}
              data-media-item={item.kind}
              leading={<MediaThumb kind={item.kind} url={item.url} />}
              title={label}
              subtitle={
                <>
                  {item.caption ?? (canEdit(item) ? "Tap to add a caption" : null)}
                  {item.coachComment ? (
                    <span className="mt-0.5 block text-sk-ink-2" data-coach-comment>
                      {staff ? "Coach comment" : "Your coach"}: {item.coachComment}
                    </span>
                  ) : null}
                </>
              }
              onClick={() => setOpenId(item.id)}
            />
          )
        })}
        {uploads.map((upload) => (
          <UploadRow key={upload.id} upload={upload} label={mediaLabel(upload, upload.rowId ? labels[upload.rowId] : null)} media={media} />
        ))}
      </List>
      <MediaViewer
        item={open}
        exercise={open?.rowId ? labels[open.rowId] : null}
        onClose={() => setOpenId(null)}
        caption={open && canEdit(open) ? { onSave: (text) => media.saveCaption(open, text) } : undefined}
        onRemove={open && canEdit(open) ? () => media.remove(open) : undefined}
        removeQuestion={staff && open ? `Remove this ${open.kind}? It is deleted from the athlete's log.` : undefined}
        commentLabel={staff ? "Coach comment" : "From your coach"}
      />
    </>
  )
}

type Saved = { ok: true } | { ok: false; error: { message: string } }

/**
 * One photo or video, large. The video has the browser's own controls, plays in place and never
 * starts by itself. Under it: the caption (editable by whoever added it), the coach's comment
 * (editable by the coach), and remove.
 */
export function MediaViewer({
  item,
  exercise,
  onClose,
  caption,
  comment,
  commentLabel,
  onRemove,
  removeQuestion,
}: {
  item: SessionMediaItem | null
  exercise?: string | null
  onClose: () => void
  /** Given when the viewer may change the caption. */
  caption?: { onSave: (text: string) => Promise<Saved> }
  /** Given when the viewer may write the coach comment. */
  comment?: { onSave: (text: string) => Promise<Saved>; hint: string }
  /** The heading of the coach comment when it is only shown. */
  commentLabel: string
  onRemove?: () => Promise<Saved>
  removeQuestion?: string
}) {
  const [captionDraft, setCaptionDraft] = useState("")
  const [commentDraft, setCommentDraft] = useState("")
  const [saving, setSaving] = useState<"caption" | "comment" | "remove" | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const captionId = useId()
  const itemId = item?.id ?? null

  useEffect(() => {
    setCaptionDraft(item?.caption ?? "")
    setCommentDraft(item?.coachComment ?? "")
    setConfirming(false)
    setError(null)
    // Only when another item opens: saving must not wipe what is being typed in the other field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  if (!item) return null
  const noun = item.kind === "video" ? "video" : "photo"
  const captionChanged = captionDraft.trim() !== (item.caption ?? "")
  const commentChanged = commentDraft.trim() !== (item.coachComment ?? "")

  const run = async (what: "caption" | "comment" | "remove", action: () => Promise<Saved>, done: string) => {
    setSaving(what)
    setError(null)
    const result = await action()
    setSaving(null)
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    notify(done)
    return true
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={mediaLabel(item, exercise)}
      description={`${formatBytes(item.bytes)}. Added ${new Date(item.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })}${item.addedByStaff ? " by a coach" : ""}.`}
      className="sm:max-w-xl"
    >
      <div className="flex flex-col gap-4" data-media-viewer={item.kind}>
        {item.url ? (
          item.kind === "video" ? (
            <video src={`${item.url}#t=0.1`} controls playsInline preload="metadata" className="max-h-[60dvh] w-full rounded-2xl bg-sk-soft" aria-describedby={item.caption ? captionId : undefined} />
          ) : (
            <img src={item.url} alt={item.caption ?? `Photo${exercise ? ` of ${exercise}` : ""}`} className="max-h-[60dvh] w-full rounded-2xl bg-sk-soft object-contain" />
          )
        ) : (
          <Notice tone="warning">This {noun} could not be opened just now. Close this and open it again.</Notice>
        )}

        {caption ? (
          <Field label="Caption" optional hint="A few words for your coach: which rep, what to look at.">
            <Input value={captionDraft} maxLength={CAPTION_MAX_LENGTH} enterKeyHint="done" onChange={(event) => setCaptionDraft(event.target.value)} placeholder="Third rep, from the side" />
          </Field>
        ) : item.caption ? (
          <p id={captionId} className="text-base leading-relaxed text-sk-ink">
            <span className="font-semibold">Caption:</span> {item.caption}
          </p>
        ) : null}
        {caption && captionChanged ? (
          <div>
            <Button size="sm" disabled={saving !== null} onClick={() => void run("caption", () => caption.onSave(captionDraft), captionDraft.trim() ? "Caption saved" : "Caption removed")}>
              {saving === "caption" ? "Saving..." : "Save caption"}
            </Button>
          </div>
        ) : null}

        {comment ? (
          <>
            <Field label="Your comment" optional hint={comment.hint}>
              <Textarea rows={2} value={commentDraft} maxLength={COMMENT_MAX_LENGTH} onChange={(event) => setCommentDraft(event.target.value)} placeholder="What you see, and one thing to try" />
            </Field>
            {commentChanged ? (
              <div>
                <Button size="sm" disabled={saving !== null} onClick={() => void run("comment", () => comment.onSave(commentDraft), commentDraft.trim() ? "Comment saved" : "Comment removed")}>
                  {saving === "comment" ? "Saving..." : "Save comment"}
                </Button>
              </div>
            ) : null}
          </>
        ) : item.coachComment ? (
          <p className="text-base leading-relaxed text-sk-ink" data-coach-comment>
            <span className="font-semibold">{commentLabel}:</span> {item.coachComment}
          </p>
        ) : null}

        {error ? <Notice tone="error">{error}</Notice> : null}

        {onRemove ? (
          confirming ? (
            <InlineConfirm
              question={removeQuestion ?? `Remove this ${noun}? It is deleted for you and for your coach.`}
              confirmLabel={`Remove ${noun}`}
              busy={saving === "remove"}
              onCancel={() => setConfirming(false)}
              onConfirm={() =>
                void run("remove", onRemove, `${item.kind === "video" ? "Video" : "Photo"} removed`).then((done) => {
                  if (done) onClose()
                })
              }
            />
          ) : (
            <div>
              <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
                Remove {noun}
              </Button>
            </div>
          )
        ) : null}
      </div>
    </Dialog>
  )
}

/** A refusal in plain words (too long, too large, no room), where the person just tapped. */
export function MediaProblem({ media, rowId }: { media: SessionMediaController; rowId: string | null }) {
  if (!media.problem || media.problem.rowId !== rowId) return null
  return (
    <Notice
      tone="error"
      className="mt-2"
      action={
        <Button size="sm" variant="quiet" onClick={media.clearProblem}>
          OK
        </Button>
      }
    >
      {media.problem.message}
    </Notice>
  )
}

/** What goes into one exercise of the log: the add button for its action line, and its rows. */
export function exerciseMedia(media: SessionMediaController, row: { id: string; label: string }, staff = false): { action: ReactNode; list: ReactNode } {
  return {
    action: <AddMediaButton media={media} rowId={row.id} name={row.label} />,
    list: (
      <>
        <MediaProblem media={media} rowId={row.id} />
        <MediaRows media={media} show={(rowId) => rowId === row.id} staff={staff} aria-label={`${row.label}, photos and videos`} />
      </>
    ),
  }
}

/**
 * "Photos and videos" as a section of the session.
 *   log   while logging: the items added to the session as a whole (those of an exercise sit
 *         under that exercise), and the add button.
 *   read  on a finished session: every item, with the exercise it belongs to.
 */
export function SessionMediaSection({
  media,
  mode,
  labels,
  hint = "Show your coach a rep.",
  staff = false,
}: {
  media: SessionMediaController
  mode: "log" | "read"
  /** Exercise names by row id. */
  labels: Record<string, string>
  hint?: string
  staff?: boolean
}) {
  if (!media.sessionId) return null
  // An item whose exercise is no longer in the session is still shown, with the session's own.
  const show = (rowId: string | null) => mode === "read" || rowId === null || !(rowId in labels)
  return (
    <Section
      title="Photos and videos"
      hint={`${hint} Up to ${MAX_MEDIA_PER_SESSION} in a session, videos up to ${VIDEO_MAX_SECONDS} seconds.`}
      meta={media.total > 0 ? `${media.total} of ${MAX_MEDIA_PER_SESSION}` : undefined}
      data-session-media={mode}
    >
      <MediaRows media={media} show={show} labels={labels} staff={staff} />
      <MediaProblem media={media} rowId={null} />
      <div className="mt-2">
        {media.full ? (
          <p className="text-[0.9375rem] text-sk-mute">That is the most for one session. Remove one to add another.</p>
        ) : (
          <AddMediaButton media={media} rowId={null} name="this session" variant="secondary" />
        )}
      </div>
    </Section>
  )
}

/** Exercise names by row id, for the lists that mix exercises. */
export function rowLabels(blocks: Array<{ rows: Array<{ id: string; label: string }> }>): Record<string, string> {
  return Object.fromEntries(blocks.flatMap((block) => block.rows.map((row) => [row.id, row.label])))
}

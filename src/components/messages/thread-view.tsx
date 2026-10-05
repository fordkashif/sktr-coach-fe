"use client"

import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { clockTime, dayHeading, dayKey, exactTime } from "@/components/messages/format"
import {
  ComposerBar,
  ConversationScreen,
  EmptyState,
  InlineConfirm,
  LinkButton,
  MessageAction,
  MessageDay,
  MessageItem,
  MessageList,
  Notice,
  ScreenHeader,
  Section,
  SkeletonRows,
  StatusText,
  notify,
} from "@/components/sk"
import { messagesHomeHref } from "@/lib/data/messages/links"
import {
  dismissMessageReports,
  getMessageThread,
  hideMessage,
  markMessageThreadRead,
  reportMessage,
  sendDirectMessage,
  subscribeToMessageThread,
} from "@/lib/data/messages/messages-data"
import { HIDDEN_MESSAGE_STUB, MESSAGE_MAX_LENGTH, readOnlyText, SAFEGUARDING_LINE, type MessagesRole, type ThreadMessage, type ThreadWithMessages } from "@/lib/data/messages/types"
import { getBackendMode } from "@/lib/supabase/config"

/** Gentle fallback where Realtime is not available: while the thread is open and the tab is visible. */
const POLL_INTERVAL_MS = 20_000

function scrollToEnd() {
  const scroller = document.getElementById("main-content")
  if (scroller) scroller.scrollTo({ top: scroller.scrollHeight })
}

/**
 * One conversation between a coach and an athlete: the two people write in it, a club admin reads
 * it in oversight (`role` "club-admin") and can hide a message. Used by all three roles' thread screens.
 */
export function ThreadView({ role, threadId }: { role: MessagesRole; threadId: string }) {
  const [data, setData] = useState<ThreadWithMessages | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ messageId: string; action: "report" | "hide" } | null>(null)
  const [busy, setBusy] = useState(false)
  const seenCount = useRef(0)
  const markedCount = useRef(0)

  const load = useCallback(async () => {
    const result = await getMessageThread(threadId)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setError(null)
    setData(result.data)
    const fresh = result.data
    if (!fresh) return
    // Reading it: move this person's marker, unless they are a club admin looking in. Once per new
    // message from the other person, not on every refresh (the marker moving is itself a change
    // the thread listens for).
    const fromOther = fresh.messages.filter((message) => message.senderUserId !== fresh.viewerUserId).length
    if (fresh.thread.viewerSide !== "oversight" && fromOther > markedCount.current) {
      markedCount.current = fromOther
      void markMessageThreadRead(threadId)
    }
  }, [threadId])

  useEffect(() => {
    void load()
    const unsubscribe = subscribeToMessageThread(threadId, () => void load())
    const refresh = () => {
      if (document.visibilityState === "visible") void load()
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    const timer = getBackendMode() === "supabase" ? window.setInterval(refresh, POLL_INTERVAL_MS) : null
    return () => {
      unsubscribe()
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
      if (timer !== null) window.clearInterval(timer)
    }
  }, [load, threadId])

  // Keep the newest message in view: on first load and whenever one arrives.
  const messageCount = data?.messages.length ?? 0
  useEffect(() => {
    if (messageCount !== seenCount.current) {
      seenCount.current = messageCount
      scrollToEnd()
    }
  }, [messageCount])

  const backTo = messagesHomeHref(role, role === "club-admin" ? "oversight" : "direct")
  const backLabel = role === "club-admin" ? "Message oversight" : "Messages"

  if (data === undefined && !error) {
    return (
      <ConversationScreen>
        <ScreenHeader back={{ to: backTo, label: backLabel }} title="Conversation" />
        <Section aria-label="Loading">
          <SkeletonRows rows={4} label="Loading the conversation" />
        </Section>
      </ConversationScreen>
    )
  }

  if (!data) {
    return (
      <ConversationScreen>
        <ScreenHeader back={{ to: backTo, label: backLabel }} title="Conversation" />
        {error ? (
          <Notice tone="error">This conversation could not be loaded. {error}</Notice>
        ) : (
          <Section title="This conversation is not available">
            <EmptyState
              title="You can no longer open it"
              body="It may belong to a team you are no longer on. Your messages list shows every conversation you can read."
              action={
                <LinkButton to={backTo} size="sm">
                  Back to messages
                </LinkButton>
              }
            />
          </Section>
        )}
      </ConversationScreen>
    )
  }

  const { thread, messages, viewerUserId } = data
  const oversight = thread.viewerSide === "oversight"
  const otherName = thread.viewerSide === "coach" ? thread.athleteName : thread.coachName
  const title = oversight ? `${thread.coachName} and ${thread.athleteName}` : otherName
  const lede = [thread.teamName, oversight ? "Read only" : thread.viewerSide === "athlete" ? "Your coach" : null].filter(Boolean).join(", ")
  // "Seen" goes on the sender's last message only, once the other person has read up to it.
  const myLast = oversight ? null : ([...messages].reverse().find((message) => message.senderUserId === viewerUserId) ?? null)
  const seenId = myLast && thread.otherLastReadAt && thread.otherLastReadAt >= myLast.createdAt ? myLast.id : null

  const send = async () => {
    setSendError(null)
    setSending(true)
    const result = await sendDirectMessage(thread.id, draft)
    setSending(false)
    if (!result.ok) {
      setSendError(result.error.message)
      return
    }
    setDraft("")
    await load()
  }

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>, done: string) => {
    setBusy(true)
    const result = await action()
    setBusy(false)
    setConfirm(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    notify(done)
    await load()
  }

  const nameOf = (message: ThreadMessage) => {
    if (!oversight && message.senderUserId === viewerUserId) return "You"
    return message.senderRole === "coach" ? thread.coachName : thread.athleteName
  }

  const actionsFor = (message: ThreadMessage) => {
    if (confirm?.messageId === message.id) {
      return confirm.action === "report" ? (
        <InlineConfirm
          className="mx-2 mt-1 w-full"
          question="Report this message to your club's admins?"
          confirmLabel="Report message"
          cancelLabel="Cancel"
          busy={busy}
          onConfirm={() => void run(() => reportMessage(message.id), "Reported to your club's admins")}
          onCancel={() => setConfirm(null)}
        />
      ) : (
        <InlineConfirm
          className="mx-2 mt-1 w-full"
          question="Hide this message from both people? This cannot be undone."
          confirmLabel="Hide message"
          cancelLabel="Cancel"
          busy={busy}
          onConfirm={() => void run(() => hideMessage(message.id), "Message hidden")}
          onCancel={() => setConfirm(null)}
        />
      )
    }
    if (message.hiddenAt) return null
    if (oversight) {
      const open = message.reports.some((report) => !report.resolution)
      return (
        <>
          <MessageAction tone={open ? "danger" : "neutral"} onClick={() => setConfirm({ messageId: message.id, action: "hide" })}>
            Hide message
          </MessageAction>
          {open ? (
            <MessageAction disabled={busy} onClick={() => void run(() => dismissMessageReports(message.id), "Report closed, message kept")}>
              Keep message and close report
            </MessageAction>
          ) : null}
        </>
      )
    }
    return null
  }

  /** "Report" sits quietly at the end of the name line of the other person's messages. */
  const reportFor = (message: ThreadMessage) => {
    if (oversight || message.hiddenAt || message.reportedByMe || message.senderUserId === viewerUserId || confirm?.messageId === message.id) return null
    return <MessageAction onClick={() => setConfirm({ messageId: message.id, action: "report" })}>Report</MessageAction>
  }

  const flagFor = (message: ThreadMessage) => {
    if (oversight) {
      const open = message.reports.filter((report) => !report.resolution)
      if (open.length > 0) {
        const reason = open.find((report) => report.reason)?.reason
        return <StatusText tone="coral">{reason ? `Reported: ${reason}` : "Reported"}</StatusText>
      }
      if (message.hiddenAt && message.hiddenReason) return <StatusText tone="neutral">Hidden: {message.hiddenReason}</StatusText>
      return null
    }
    return message.reportedByMe && !message.hiddenAt ? <StatusText tone="neutral">You reported this</StatusText> : null
  }

  let lastDay = ""

  return (
    <ConversationScreen>
      <ScreenHeader back={{ to: backTo, label: backLabel }} title={title} lede={lede || undefined} />

      <Notice tone="info">{oversight ? "You are reading this as a club admin. Both people are told that club admins can read their messages." : SAFEGUARDING_LINE}</Notice>
      {error ? <Notice tone="error">{error}</Notice> : null}

      {messages.length === 0 ? (
        <EmptyState
          className="flex-1"
          title="No messages yet"
          body={thread.canSend ? `Write the first message to ${otherName} below. Keep it to training.` : "Nothing was sent in this conversation."}
        />
      ) : (
        <MessageList label={oversight ? `Messages between ${thread.coachName} and ${thread.athleteName}` : `Messages with ${otherName}`}>
          {messages.map((message) => {
            const day = dayKey(message.createdAt)
            const newDay = day !== lastDay
            lastDay = day
            const mine = oversight ? message.senderRole === "athlete" : message.senderUserId === viewerUserId
            return (
              <Fragment key={message.id}>
                {newDay ? <MessageDay>{dayHeading(message.createdAt)}</MessageDay> : null}
                <MessageItem
                  data-message-id={message.id}
                  mine={mine}
                  name={nameOf(message)}
                  time={clockTime(message.createdAt)}
                  timeTitle={exactTime(message.createdAt)}
                  dateTime={message.createdAt}
                  hidden={message.hiddenAt ? HIDDEN_MESSAGE_STUB : undefined}
                  status={message.id === seenId ? "Seen" : undefined}
                  flag={flagFor(message)}
                  headerAction={reportFor(message)}
                  actions={actionsFor(message)}
                >
                  {message.hiddenAt ? (oversight && message.originalBody ? `It said: ${message.originalBody}` : null) : message.body}
                </MessageItem>
              </Fragment>
            )
          })}
        </MessageList>
      )}

      <ComposerBar
        value={draft}
        onChange={(next) => {
          setDraft(next)
          if (sendError) setSendError(null)
        }}
        onSend={() => void send()}
        maxLength={MESSAGE_MAX_LENGTH}
        label={`Message to ${otherName}`}
        placeholder={`Message ${otherName}`}
        sending={sending}
        error={sendError}
        note={
          thread.viewerSide === "coach" && thread.guardianContactOnFile
            ? `${thread.athleteName} is under 18 and a guardian contact is on file. Guardians are not copied in on messages.`
            : undefined
        }
        readOnly={thread.canSend ? undefined : readOnlyText(thread.readOnlyReason, thread.viewerSide)}
      />
    </ConversationScreen>
  )
}

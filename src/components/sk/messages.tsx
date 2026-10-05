import { PaperPlaneRight } from "@phosphor-icons/react"
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * ConversationScreen: the Screen for one conversation. Narrow like a form, and at least as tall as
 * the space between the app's bars, so the ComposerBar (its last child) rests at the bottom even
 * when the thread is short. Use it instead of Screen for a message thread and nowhere else.
 */
export function ConversationScreen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-sk-conversation
      className={cn(
        "sk-page sk-page-narrow min-h-[calc(100dvh-7.75rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] lg:min-h-[calc(100dvh-69px)]",
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * MessageList: the messages of a two-person thread, oldest first. Children are MessageDay and
 * MessageItem. It is a log for screen readers, so a new message is announced. It grows to fill a
 * ConversationScreen, which keeps the composer at the bottom.
 */
export function MessageList({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <ol role="log" aria-label={label} aria-live="polite" className={cn("flex flex-1 flex-col gap-5", className)}>
      {children}
    </ol>
  )
}

/** MessageDay: the date that starts a day of messages, on a hairline. */
export function MessageDay({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 pt-1" role="separator">
      <span aria-hidden className="h-px flex-1 bg-sk-line" />
      <span className="text-sm font-semibold text-sk-mute">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-sk-line" />
    </li>
  )
}

/**
 * MessageItem: one message. Not a chat bubble: the sender's name and the time on one line, the text
 * under it, and a thin rule down the side that says whose it is (blue on the right for `mine`, grey
 * on the left for the other person). `status` is one quiet word under the sender's last message
 * ("Seen"). `hidden` replaces the text with a stub ("Message hidden by a club admin"). `flag` is a
 * line of state above the text (a StatusText: "Reported"). `headerAction` is one MessageAction at
 * the end of the name line ("Report"); `actions` is what goes under the text (an InlineConfirm, or
 * a club admin's MessageActions).
 */
export function MessageItem({
  mine = false,
  name,
  time,
  timeTitle,
  dateTime,
  children,
  hidden,
  status,
  flag,
  headerAction,
  actions,
  className,
  ...rest
}: {
  mine?: boolean
  name: string
  /** Short clock time: "9:14 AM". */
  time: string
  /** The full date and time, shown on hover. */
  timeTitle?: string
  dateTime?: string
  children?: ReactNode
  /** The words shown instead of the text of a hidden message. */
  hidden?: string
  status?: ReactNode
  flag?: ReactNode
  headerAction?: ReactNode
  actions?: ReactNode
  className?: string
  "data-message-id"?: string
}) {
  return (
    <li className={cn("flex max-w-full flex-col", mine ? "items-end" : "items-start", className)} data-mine={mine ? "true" : "false"} {...rest}>
      <div className={cn("min-w-0 max-w-[min(34rem,88%)]", mine ? "border-r-2 border-sk-blue pr-3.5" : "border-l-2 border-sk-line-strong pl-3.5")}>
        <p className={cn("flex flex-wrap items-baseline gap-x-2 text-sm leading-snug", mine && "justify-end")}>
          <span className="font-bold text-sk-ink">{name}</span>
          <time dateTime={dateTime} title={timeTitle} className="text-sk-mute tabular-nums">
            {time}
          </time>
          {headerAction ? <span className="-my-3 inline-flex">{headerAction}</span> : null}
        </p>
        {flag ? <p className={cn("mt-1 flex", mine && "justify-end")}>{flag}</p> : null}
        {hidden ? (
          <p className="mt-1 text-[0.9375rem] italic leading-normal text-sk-mute">{hidden}</p>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words text-base leading-normal text-sk-ink [overflow-wrap:anywhere]">{children}</p>
        )}
        {hidden && children ? (
          <p className="mt-1 whitespace-pre-wrap break-words text-[0.9375rem] leading-normal text-sk-ink-2 [overflow-wrap:anywhere]">{children}</p>
        ) : null}
        {actions ? <div className={cn("-mx-2 mt-0.5 flex flex-wrap gap-x-1", mine && "justify-end")}>{actions}</div> : null}
      </div>
      {status ? <p className="mt-1 text-sm font-semibold text-sk-mute">{status}</p> : null}
    </li>
  )
}

/** MessageAction: a quiet text action under a message ("Report", "Hide message"). 44px tall on phone. */
export function MessageAction({ children, onClick, disabled, tone = "neutral" }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: "neutral" | "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center rounded-[10px] px-2 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-sk-blue disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-9",
        tone === "danger" ? "text-sk-coral-ink" : "text-sk-mute hover:text-sk-ink",
      )}
    >
      {children}
    </button>
  )
}

/**
 * ComposerBar: where a message is typed. It stays at the bottom of the screen while the thread
 * scrolls, above the phone tab bar (and so above the keyboard), like ActionBar. A text box that
 * grows to five lines, one Send button, and a character count that appears near the limit.
 * Enter sends on a computer (Shift+Enter for a new line); on a phone Enter is a new line.
 * `note` is one line of plain text above the box (who else can read, a guardian on file).
 * With `readOnly` the bar shows that sentence instead of the box. Last child of ConversationScreen.
 */
export function ComposerBar({
  value,
  onChange,
  onSend,
  maxLength,
  label,
  placeholder,
  sending = false,
  note,
  error,
  readOnly,
  className,
}: {
  value: string
  onChange: (next: string) => void
  onSend: () => void
  maxLength: number
  /** Names the text box for screen readers: "Message to Maya Chen". */
  label: string
  placeholder?: string
  sending?: boolean
  note?: ReactNode
  error?: ReactNode
  /** Why nothing can be sent. Replaces the text box. */
  readOnly?: ReactNode
  className?: string
}) {
  const id = useId()
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const length = value.length
  const left = maxLength - length
  const nearLimit = left <= Math.max(50, Math.round(maxLength * 0.1))
  const canSend = !sending && value.trim().length > 0 && left >= 0

  // Grow with the text, up to five lines.
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    box.style.height = "auto"
    box.style.height = `${Math.min(box.scrollHeight, 136)}px`
  }, [value])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    // A phone keyboard has no Shift+Enter, so there Enter stays a new line and Send is the button.
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) return
    event.preventDefault()
    if (canSend) onSend()
  }

  return (
    <div
      data-sk-composer
      className={cn("sticky bottom-0 z-20 -mx-5 -mb-12 mt-auto border-t border-sk-line bg-white px-5 pb-3 pt-2.5 sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mb-16 lg:px-10 lg:pb-4", className)}
    >
      {readOnly ? (
        <p className="flex min-h-11 items-center text-[0.9375rem] font-semibold text-sk-mute">{readOnly}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (canSend) onSend()
          }}
        >
          {note ? <p className="pb-2 text-sm leading-snug text-sk-mute">{note}</p> : null}
          <div className="flex items-end gap-2">
            <label htmlFor={id} className="sr-only">
              {label}
            </label>
            <textarea
              id={id}
              ref={boxRef}
              rows={1}
              value={value}
              placeholder={placeholder}
              aria-invalid={left < 0 || Boolean(error) || undefined}
              aria-describedby={nearLimit || error ? `${id}-help` : undefined}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              className="sk-field min-h-11 flex-1 resize-none py-2.5 leading-normal"
              style={{ minHeight: "2.75rem" }}
            />
            <button type="submit" disabled={!canSend} className="sk-btn sk-btn-primary">
              <PaperPlaneRight className="size-[18px]" weight="bold" aria-hidden />
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
          {nearLimit || error ? (
            <p id={`${id}-help`} className="flex justify-between gap-3 pt-1.5 text-sm">
              <span role={error ? "alert" : undefined} className="font-semibold text-sk-coral-ink">
                {error}
              </span>
              {nearLimit ? (
                <span className={cn("shrink-0 tabular-nums", left < 0 ? "font-bold text-sk-coral-ink" : "text-sk-mute")}>
                  {left < 0 ? `${-left} over the limit` : `${left} left`}
                </span>
              ) : null}
            </p>
          ) : null}
        </form>
      )}
    </div>
  )
}

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * SubSection: a titled group one level below a Section, for the parts of a Sheet or a Dialog
 * (the facts of a request: "About the requester", "The club", "History") or of a long Section.
 * An h3, an optional hint, then the content. No border, no background. Stack several in a
 * `SubSections` so they keep the same gap.
 */
export function SubSection({
  title,
  hint,
  action,
  children,
  className,
  ...rest
}: {
  title: ReactNode
  hint?: ReactNode
  /** A quiet button or link on the right of the title ("Edit"). */
  action?: ReactNode
  children: ReactNode
  className?: string
  "aria-label"?: string
}) {
  return (
    <section className={cn("flex min-w-0 flex-col", className)} {...rest}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold leading-snug tracking-[-0.01em] text-sk-ink">{title}</h3>
          {hint ? <p className="mt-0.5 text-sm text-sk-mute">{hint}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** SubSections: the column a Sheet's SubSection groups sit in, with the gap between them. */
export function SubSections({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-col gap-6", className)}>{children}</div>
}

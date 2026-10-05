import type { ReactNode } from "react"
import { ScreenHeader, Section } from "./layout"

/**
 * Deprecated v1 parts, kept so screens that have not been converted yet still compile and already
 * pick up the v2 look. Do not use them in new or converted screens.
 */

/** @deprecated Use ScreenHeader. */
export function PageHeader({
  title,
  lede,
  actions,
  children,
  className,
}: {
  title: ReactNode
  lede?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <ScreenHeader title={title} lede={lede} actions={actions} />
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}

/** @deprecated Use Section (with List, DataTable or plain content inside). Panel no longer draws a box. */
export function Panel({
  title,
  hint,
  action,
  children,
  className,
  flush = false,
}: {
  title?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  /** @deprecated Older content padded itself inside the box. The body now bleeds out by that padding so it lines up with the page. */
  flush?: boolean
}) {
  return (
    <Section title={title} hint={hint} action={action} className={className}>
      {flush ? <div className="sk-flush-body">{children}</div> : children}
    </Section>
  )
}

import { CaretRight, DotsThree } from "@phosphor-icons/react"
import type { HTMLAttributes, ReactNode } from "react"
import { Link } from "react-router-dom"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/**
 * ActionRow: a list row that opens something AND carries its own actions. The row itself is the
 * link or button (title, subtitle, a trailing value); `actions` sit to its right, outside the click
 * target (a RowMenu, or one small Button). `below` shows under the row, for an InlineConfirm.
 * Goes inside a List like ListRow. Extra props (data attributes) land on the list item.
 */
export function ActionRow({
  leading,
  title,
  subtitle,
  trailing,
  to,
  onClick,
  disabled,
  actions,
  below,
  className,
  ...rest
}: {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** A value or StatusText on the right of the row, inside the click target. */
  trailing?: ReactNode
  to?: string
  onClick?: () => void
  disabled?: boolean
  actions?: ReactNode
  below?: ReactNode
  className?: string
} & Omit<HTMLAttributes<HTMLLIElement>, "title" | "onClick">) {
  const body = (
    <>
      {leading !== undefined && leading !== null ? <span className="flex shrink-0 items-center justify-center">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="sk-list-title">{title}</span>
        {subtitle ? <span className="sk-list-sub">{subtitle}</span> : null}
      </span>
      {trailing !== undefined && trailing !== null ? <span className="shrink-0 text-right text-[0.9375rem] font-semibold text-sk-ink">{trailing}</span> : null}
      {to ? <CaretRight className="size-[18px] shrink-0 text-sk-mute" weight="bold" aria-hidden /> : null}
    </>
  )
  const rowClass = "sk-list-row min-w-0 flex-1 cursor-pointer disabled:cursor-default disabled:opacity-60"
  return (
    <li className={className} {...rest}>
      <div className="flex items-center gap-1.5">
        {to ? (
          <Link to={to} className={rowClass}>
            {body}
          </Link>
        ) : onClick ? (
          <button type="button" className={rowClass} onClick={onClick} disabled={disabled}>
            {body}
          </button>
        ) : (
          <div className="sk-list-row min-w-0 flex-1">{body}</div>
        )}
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {below ? <div className="pb-3">{below}</div> : null}
    </li>
  )
}

export type RowMenuItem = {
  label: string
  onSelect: () => void
  /** Coral text, for remove and delete. */
  danger?: boolean
  disabled?: boolean
}

/**
 * RowMenu: the "more" button of a row or a header, for the actions that are used now and then
 * (duplicate, archive, delete, export). The one or two actions people use all the time stay as
 * buttons; the rest go in here so a list is not a wall of buttons. `label` says what the menu is
 * for ("More for General preparation block").
 */
export function RowMenu({ label, items, className }: { label: string; items: RowMenuItem[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} className={cn("sk-icon-btn", className)}>
          <DotsThree className="size-6" weight="bold" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-48 rounded-2xl border-sk-line-strong bg-white p-1.5">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            disabled={item.disabled}
            onSelect={item.onSelect}
            className={cn(
              "min-h-11 cursor-pointer rounded-[10px] px-3 text-[0.9375rem] font-semibold focus:bg-sk-soft",
              item.danger ? "text-sk-coral-ink focus:text-sk-coral-ink" : "text-sk-ink",
            )}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * CheckRow: a list row you tick. The whole row is the label of its checkbox. Same slots as ListRow
 * (leading for an Avatar, title, subtitle, trailing for a StatusText). Goes inside a List.
 */
export function CheckRow({
  checked,
  onChange,
  leading,
  title,
  subtitle,
  trailing,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  disabled?: boolean
}) {
  return (
    <li>
      <label className={cn("sk-list-row cursor-pointer", disabled && "cursor-default opacity-60")}>
        <input type="checkbox" className="size-5 shrink-0 accent-sk-blue" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        {leading !== undefined && leading !== null ? <span className="flex shrink-0 items-center justify-center">{leading}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="sk-list-title">{title}</span>
          {subtitle ? <span className="sk-list-sub">{subtitle}</span> : null}
        </span>
        {trailing !== undefined && trailing !== null ? <span className="shrink-0 text-right text-sm">{trailing}</span> : null}
      </label>
    </li>
  )
}

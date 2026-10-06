import { X } from "@phosphor-icons/react"
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react"
import { Dialog as UiDialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Sheet as UiSheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { ToastAction } from "@/components/ui/toast"
import { toast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"

// Radix (SheetClose / DialogClose with asChild) hands the click handler and ref to this button as
// props, so they must be passed on, or the button does nothing.
function CloseButton({ label, ...props }: { label: string } & ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <button type="button" aria-label={label} className="sk-icon-btn" {...props}>
      <X className="size-5" weight="bold" aria-hidden />
    </button>
  )
}

function OverlayHeader({ title, description, close, kind }: { title: string; description?: ReactNode; close: ReactNode; kind: "sheet" | "dialog" }) {
  const Title = kind === "sheet" ? SheetTitle : DialogTitle
  const Description = kind === "sheet" ? SheetDescription : DialogDescription
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 pt-1">
        <Title className="text-[1.375rem] font-extrabold leading-tight tracking-[-0.03em] text-sk-ink">{title}</Title>
        {description ? <Description className="mt-1 text-[0.9375rem] leading-snug text-sk-mute">{description}</Description> : null}
      </div>
      {close}
    </div>
  )
}

/**
 * Sheet: a panel that slides over the screen. side "right" for lists you glance at (notifications),
 * side "bottom" for a short choice on phone (switch team, more destinations).
 * Always has a title and a close button. `footer` holds the actions.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  side = "right",
  footer,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  side?: "right" | "bottom"
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <UiSheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        showCloseButton={false}
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "gap-0 bg-white p-0",
          side === "right" ? "w-full sm:max-w-md" : "mx-auto max-h-[85dvh] w-full max-w-xl rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))]",
          className,
        )}
      >
        <div className="px-5 pb-3 pt-5">
          <OverlayHeader
            kind="sheet"
            title={title}
            description={description}
            close={
              <SheetClose asChild>
                <CloseButton label={`Close ${title.toLowerCase()}`} />
              </SheetClose>
            }
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-sk-line px-5 py-4">{footer}</div> : null}
      </SheetContent>
    </UiSheet>
  )
}

/** Dialog: a centred box for one focused task (a short form, a decision). Title, close button, content, actions in `footer`. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <UiDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} {...(description ? {} : { "aria-describedby": undefined })} className={cn("max-h-[90dvh] gap-5 overflow-y-auto rounded-3xl bg-white p-5 sm:p-6", className)}>
        <OverlayHeader
          kind="dialog"
          title={title}
          description={description}
          close={
            <DialogClose asChild>
              <CloseButton label="Close" />
            </DialogClose>
          }
        />
        <div className="min-w-0">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </DialogContent>
    </UiDialog>
  )
}

/**
 * notify: a short message that appears for a moment after an action ("Plan saved").
 * For anything the person must read or act on, use Notice on the screen instead.
 */
export function notify(message: string, detail?: string, options?: { action?: { label: string; onSelect: () => void }; durationMs?: number }) {
  const action = options?.action
  return toast({
    title: message,
    description: detail,
    ...(options?.durationMs ? { duration: options.durationMs } : {}),
    // One short action beside the message ("Undo"). The toast closes when it is used.
    ...(action
      ? {
          action: (
            <ToastAction altText={action.label} onClick={action.onSelect} className="h-9 rounded-[12px] border-sk-line-strong bg-white px-3.5 text-sm font-bold text-sk-blue-ink hover:bg-sk-soft">
              {action.label}
            </ToastAction>
          ),
        }
      : {}),
  })
}

export function notifyError(message: string, detail?: string) {
  toast({ title: message, description: detail, variant: "destructive" })
}

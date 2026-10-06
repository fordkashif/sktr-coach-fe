"use client"

import { CaretDown, Check } from "@phosphor-icons/react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { useState } from "react"
import { Sheet } from "@/components/sk"
import type { GuardianChild } from "@/lib/data/guardian/types"
import { useGuardianChildren } from "@/lib/guardian/children-store"
import { cn } from "@/lib/utils"

/**
 * Lets a parent or guardian of two or more athletes choose whose screens they are looking at.
 * Built like the coach's team switcher. Renders nothing with one athlete, with none, and for
 * every other role.
 *
 * variant "topbar": the desktop control beside the brand, opening a menu.
 * variant "bar": the phone control in the app bar, opening a bottom sheet.
 */
export function GuardianChildSwitcher({ variant, className }: { variant: "topbar" | "bar"; className?: string }) {
  const { isGuardian, children, selected, select } = useGuardianChildren()
  const [open, setOpen] = useState(false)

  if (!isGuardian || children.length < 2) return null

  const currentName = selected?.name ?? "Choose an athlete"
  const label = selected ? `Switch athlete. Showing ${selected.name}` : "Switch athlete"
  const detail = (child: GuardianChild) => child.teamName ?? "No team yet"

  const choose = (child: GuardianChild) => {
    setOpen(false)
    select(child.athleteId)
  }

  const triggerClass = cn(
    "flex min-w-0 cursor-pointer items-center gap-2 rounded-[12px] border border-sk-line-strong bg-white px-3.5 text-left text-[0.9375rem] font-semibold text-sk-ink transition-colors hover:border-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue data-[state=open]:border-sk-ink",
    variant === "topbar" ? "h-10 max-w-[220px]" : "h-11 max-w-full",
    className,
  )

  const trigger = (
    <>
      <span className="min-w-0 flex-1 truncate" data-testid="child-switcher-current">
        {currentName}
      </span>
      <CaretDown className={cn("size-3.5 shrink-0 transition-transform", open && variant === "topbar" && "rotate-180")} weight="bold" aria-hidden />
    </>
  )

  if (variant === "topbar") {
    return (
      <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}>
        <DropdownMenuPrimitive.Trigger asChild>
          <button type="button" aria-label={label} data-testid="child-switcher" className={triggerClass}>
            {trigger}
          </button>
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            align="start"
            sideOffset={8}
            aria-label="The athletes you follow"
            className="z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[260px] overflow-y-auto rounded-2xl border border-sk-line-strong bg-white p-1.5 text-sk-ink"
          >
            <DropdownMenuPrimitive.RadioGroup value={selected?.athleteId ?? ""}>
              {children.map((child) => (
                <DropdownMenuPrimitive.RadioItem
                  key={child.athleteId}
                  value={child.athleteId}
                  data-child-id={child.athleteId}
                  onSelect={() => choose(child)}
                  className="flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-[10px] px-3 py-2 outline-none data-[highlighted]:bg-sk-soft data-[state=checked]:bg-sk-blue-tint"
                >
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-bold text-sk-ink">{child.name}</span>
                    <span className="block truncate text-sm text-sk-mute">{detail(child)}</span>
                  </span>
                  <DropdownMenuPrimitive.ItemIndicator>
                    <Check className="size-5 text-sk-blue" weight="bold" aria-hidden />
                  </DropdownMenuPrimitive.ItemIndicator>
                </DropdownMenuPrimitive.RadioItem>
              ))}
            </DropdownMenuPrimitive.RadioGroup>
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>
    )
  }

  return (
    <>
      <button type="button" aria-label={label} aria-haspopup="dialog" data-testid="child-switcher" className={triggerClass} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      <Sheet open={open} onOpenChange={setOpen} side="bottom" title="Switch athlete" description="Every screen follows the athlete you pick.">
        <ul className="sk-list">
          {children.map((child) => {
            const isCurrent = child.athleteId === selected?.athleteId
            return (
              <li key={child.athleteId}>
                <button type="button" data-child-id={child.athleteId} aria-current={isCurrent ? "true" : undefined} onClick={() => choose(child)} className="sk-list-row cursor-pointer">
                  <span className="min-w-0 flex-1">
                    <span className={cn("sk-list-title", isCurrent && "font-bold text-sk-blue-ink")}>{child.name}</span>
                    <span className="sk-list-sub">{detail(child)}</span>
                  </span>
                  {isCurrent ? <Check className="size-5 shrink-0 text-sk-blue" weight="bold" aria-label="Showing now" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </Sheet>
    </>
  )
}

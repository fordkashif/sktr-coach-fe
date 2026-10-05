"use client"

import { CaretDown, Check, X } from "@phosphor-icons/react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { useState } from "react"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useCoachTeams, type CoachTeam } from "@/lib/coach-teams"
import { cn } from "@/lib/utils"

/**
 * Lets a coach who is on two or more teams choose which team the coach screens show.
 * Renders nothing for a coach with one team, a coach with none, and every other role.
 *
 * variant "sidebar": the desktop control under the brand block, opening a menu.
 * variant "bar": the compact phone control in the top bar, opening a bottom sheet.
 */
export function CoachTeamSwitcher({
  variant,
  onSwitched,
  className,
}: {
  variant: "sidebar" | "bar"
  /** Called after the team really changed (not when the coach cancelled or picked the current team). */
  onSwitched?: (team: CoachTeam) => void
  className?: string
}) {
  const { isCoach, teams, selectedTeam, selectTeam } = useCoachTeams()
  const [open, setOpen] = useState(false)

  if (!isCoach || teams.length < 2) return null

  const currentName = selectedTeam?.name ?? "Choose a team"
  const label = selectedTeam ? `Switch team. Current team: ${selectedTeam.name}` : "Switch team"

  const choose = (team: CoachTeam) => {
    setOpen(false)
    if (team.id === selectedTeam?.id) return
    // Wait for the menu to close, so a confirm prompt for unsaved work is not fighting the menu for focus.
    window.setTimeout(() => {
      if (selectTeam(team.id)) onSwitched?.(team)
    }, 0)
  }

  if (variant === "sidebar") {
    return (
      <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}>
        <DropdownMenuPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            data-testid="team-switcher"
            className={cn(
              "flex min-h-14 w-full items-center gap-3 rounded-[14px] border border-sk-line bg-white px-3.5 py-2 text-left transition-colors hover:border-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue data-[state=open]:border-sk-ink",
              className,
            )}
          >
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-bold text-sk-ink" data-testid="team-switcher-current">
                {currentName}
              </span>
              {selectedTeam ? <span className="block truncate text-sm text-sk-mute">{selectedTeam.eventGroup}</span> : null}
            </span>
            <CaretDown className={cn("size-4 shrink-0 text-sk-ink-2 transition-transform", open && "rotate-180")} weight="bold" aria-hidden />
          </button>
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            align="start"
            sideOffset={6}
            aria-label="Your teams"
            className="z-50 max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-[240px] overflow-y-auto rounded-[16px] border border-sk-line bg-white p-1.5 text-sk-ink"
          >
            <DropdownMenuPrimitive.RadioGroup value={selectedTeam?.id ?? ""}>
              {teams.map((team) => (
                <DropdownMenuPrimitive.RadioItem
                  key={team.id}
                  value={team.id}
                  data-team-id={team.id}
                  onSelect={() => choose(team)}
                  className="flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-[10px] px-3 py-2 outline-none data-[highlighted]:bg-sk-canvas data-[state=checked]:bg-sk-blue-tint"
                >
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-bold text-sk-ink">{team.name}</span>
                    <span className="block truncate text-sm text-sk-mute">{team.eventGroup}</span>
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
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid="team-switcher"
          className={cn(
            "flex h-11 min-w-0 items-center gap-2 rounded-[14px] border border-sk-line bg-white px-3.5 text-left transition-colors hover:border-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate font-bold text-sk-ink" data-testid="team-switcher-current">
            {currentName}
          </span>
          <CaretDown className="size-4 shrink-0 text-sk-ink-2" weight="bold" aria-hidden />
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-[24px] border-t-sk-line bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-none"
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 px-5 pb-2 pt-5">
          <div className="min-w-0">
            <SheetTitle className="text-xl font-extrabold tracking-[-0.02em] text-sk-ink">Switch team</SheetTitle>
            <SheetDescription className="text-sm text-sk-mute">Every screen follows the team you pick.</SheetDescription>
          </div>
          <SheetClose asChild>
            <button
              type="button"
              aria-label="Close"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-[14px] border border-sk-line bg-white text-sk-ink hover:border-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
            >
              <X className="size-5" weight="bold" />
            </button>
          </SheetClose>
        </SheetHeader>
        <ul className="max-h-[60dvh] overflow-y-auto px-3 pb-2">
          {teams.map((team) => {
            const isCurrent = team.id === selectedTeam?.id
            return (
              <li key={team.id}>
                <button
                  type="button"
                  data-team-id={team.id}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => choose(team)}
                  className={cn(
                    "flex min-h-16 w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-sk-blue",
                    isCurrent ? "bg-sk-blue-tint" : "hover:bg-sk-canvas",
                  )}
                >
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-lg font-bold text-sk-ink">{team.name}</span>
                    <span className="block truncate text-sm text-sk-mute">{team.eventGroup}</span>
                  </span>
                  {isCurrent ? <Check className="size-6 shrink-0 text-sk-blue" weight="bold" aria-label="Current team" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </SheetContent>
    </Sheet>
  )
}

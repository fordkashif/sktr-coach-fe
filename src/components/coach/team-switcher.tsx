"use client"

import { CaretDown, Check } from "@phosphor-icons/react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { useState } from "react"
import { Sheet } from "@/components/sk"
import { useCoachTeams, type CoachTeam } from "@/lib/coach-teams"
import { cn } from "@/lib/utils"

/**
 * Lets a coach who is on two or more teams choose which team the coach screens show.
 * Renders nothing for a coach with one team, a coach with none, and every other role.
 *
 * variant "topbar": the desktop control beside the brand in the top bar, opening a menu.
 * variant "bar": the phone control in the app bar, opening a bottom sheet.
 */
export function CoachTeamSwitcher({
  variant,
  onSwitched,
  className,
}: {
  variant: "topbar" | "bar"
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

  const triggerClass = cn(
    "flex min-w-0 cursor-pointer items-center gap-2 rounded-[12px] border border-sk-line-strong bg-white px-3.5 text-left text-[0.9375rem] font-semibold text-sk-ink transition-colors hover:border-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue data-[state=open]:border-sk-ink",
    variant === "topbar" ? "h-10 max-w-[220px]" : "h-11 max-w-full",
    className,
  )

  const trigger = (
    <>
      <span className="min-w-0 flex-1 truncate" data-testid="team-switcher-current">
        {currentName}
      </span>
      <CaretDown className={cn("size-3.5 shrink-0 transition-transform", open && variant === "topbar" && "rotate-180")} weight="bold" aria-hidden />
    </>
  )

  if (variant === "topbar") {
    return (
      <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}>
        <DropdownMenuPrimitive.Trigger asChild>
          <button type="button" aria-label={label} data-testid="team-switcher" className={triggerClass}>
            {trigger}
          </button>
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            align="start"
            sideOffset={8}
            aria-label="Your teams"
            className="z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[260px] overflow-y-auto rounded-2xl border border-sk-line-strong bg-white p-1.5 text-sk-ink"
          >
            <DropdownMenuPrimitive.RadioGroup value={selectedTeam?.id ?? ""}>
              {teams.map((team) => (
                <DropdownMenuPrimitive.RadioItem
                  key={team.id}
                  value={team.id}
                  data-team-id={team.id}
                  onSelect={() => choose(team)}
                  className="flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-[10px] px-3 py-2 outline-none data-[highlighted]:bg-sk-soft data-[state=checked]:bg-sk-blue-tint"
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
    <>
      <button type="button" aria-label={label} aria-haspopup="dialog" data-testid="team-switcher" className={triggerClass} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      <Sheet open={open} onOpenChange={setOpen} side="bottom" title="Switch team" description="Every screen follows the team you pick.">
        <ul className="sk-list">
          {teams.map((team) => {
            const isCurrent = team.id === selectedTeam?.id
            return (
              <li key={team.id}>
                <button type="button" data-team-id={team.id} aria-current={isCurrent ? "true" : undefined} onClick={() => choose(team)} className="sk-list-row cursor-pointer">
                  <span className="min-w-0 flex-1">
                    <span className={cn("sk-list-title", isCurrent && "font-bold text-sk-blue-ink")}>{team.name}</span>
                    <span className="sk-list-sub">{team.eventGroup}</span>
                  </span>
                  {isCurrent ? <Check className="size-5 shrink-0 text-sk-blue" weight="bold" aria-label="Current team" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </Sheet>
    </>
  )
}

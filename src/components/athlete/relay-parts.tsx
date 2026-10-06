"use client"

import { useState, type ReactNode } from "react"
import { dayText, ordinal } from "@/components/athlete/results-parts"
import { ActionRow, CompactTable, List, Mark } from "@/components/sk"
import { relayLegOf, relayRoundText } from "@/lib/data/competition/relay-logic"
import type { RelayEntry, RelayLeg } from "@/lib/data/competition/types"
import { formatMark, markUnitLabel } from "@/lib/data/pr/marks"

/** "Final, lane 5, 2nd place". Empty when nothing was recorded. */
export function relayRoundLine(relay: RelayEntry): string {
  const text = [relayRoundText({ round: relay.round, heat: relay.heat, lane: relay.lane, qualifier: null }), relay.place ? `${ordinal(relay.place)} place` : "", relay.qualifier ? (relay.qualifier === "Q" ? "qualified on place (Q)" : "qualified on time (q)") : ""]
    .filter(Boolean)
    .join(", ")
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
}

/** The relay's time the way a mark is written, or plain words while it has none. */
export function RelayMark({ relay, size = "md" }: { relay: RelayEntry; size?: "sm" | "md" | "lg" }) {
  if (relay.display === null) return <span className="font-normal text-sk-mute">No time yet</span>
  return <Mark value={relay.display} unit={markUnitLabel(relay.display, "s")} size={size} />
}

/** The four legs in running order, with their splits when someone took them. `ownAthleteId` is shown in bold as "you". */
export function RelayLegsTable({ relay, ownAthleteId }: { relay: RelayEntry; ownAthleteId?: string | null }) {
  const withSplits = relay.legs.some((leg) => leg.split !== null)
  return (
    <CompactTable
      caption={`Legs of the ${relay.eventLabel}, ${relay.teamLabel}`}
      columns={[
        { key: "leg", header: "Leg", cell: (leg: RelayLeg) => leg.leg },
        { key: "athlete", header: "Athlete", cell: (leg) => (ownAthleteId && leg.athleteId === ownAthleteId ? `${leg.name} (you)` : leg.name) },
        ...(withSplits ? [{ key: "split", header: "Split", align: "right" as const, cell: (leg: RelayLeg) => (leg.split !== null ? `${formatMark(leg.split, "s")}s` : "") }] : []),
      ]}
      rows={relay.legs}
      rowKey={(leg) => String(leg.leg)}
      rowMark={(leg) => Boolean(ownAthleteId) && leg.athleteId === ownAthleteId}
      className="max-w-xl"
    />
  )
}

/**
 * Relays as rows that open to show the legs. For the athlete (`ownAthleteId` says which leg is
 * theirs: "Leg 2 for Sprint Group A") and, with `actions`, for a coach's list.
 */
export function RelayList({
  relays,
  ownAthleteId,
  showMeet = false,
  actions,
  ...rest
}: {
  relays: RelayEntry[]
  ownAthleteId?: string | null
  /** Say where and when it was run (a list that spans competitions). */
  showMeet?: boolean
  actions?: (relay: RelayEntry) => ReactNode
  "aria-label"?: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <List {...rest}>
      {relays.map((relay) => {
        const own = relayLegOf(relay, ownAthleteId)
        const round = relayRoundLine(relay)
        const meet = showMeet ? [dayText(relay.date), relay.competitionName ?? relay.location].filter(Boolean).join(", ") : ""
        const open = openId === relay.id
        return (
          <ActionRow
            key={relay.id}
            data-relay={relay.id}
            title={own ? relay.eventLabel : `${relay.eventLabel}, ${relay.teamLabel}`}
            subtitle={
              <>
                {own ? `Relay, leg ${own.leg} for ${relay.teamLabel}` : relay.legs.map((leg) => leg.name).join(", ")}
                {round ? <span className="block">{round}</span> : null}
                {meet ? <span className="block">{meet}</span> : null}
                <span className="block font-semibold text-sk-blue-link">{open ? "Hide the legs" : "Show the legs"}</span>
              </>
            }
            trailing={<RelayMark relay={relay} />}
            onClick={() => setOpenId(open ? null : relay.id)}
            actions={actions?.(relay)}
            below={open ? <RelayLegsTable relay={relay} ownAthleteId={ownAthleteId} /> : undefined}
          />
        )
      })}
    </List>
  )
}

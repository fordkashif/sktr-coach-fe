"use client"

import { useEffect, useState } from "react"
import { squadNamesText } from "@/lib/data/coach/squads"
import { listMySquadNames } from "@/lib/data/coach/squads-data"

/**
 * One read-only line for the athlete's "Your team" section: the squads of their team they are in.
 * Nothing at all when they are in none (or the names cannot be read).
 */
export function MySquadsLine() {
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void listMySquadNames().then((result) => {
      if (!cancelled && result.ok) setNames(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (names.length === 0) return null
  return (
    <p className="pt-3 text-[0.9375rem] text-sk-ink" data-my-squads>
      <span className="text-sk-mute">{names.length === 1 ? "Your squad: " : "Your squads: "}</span>
      {squadNamesText(names)}
    </p>
  )
}

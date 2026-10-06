import { useEffect, useMemo, useState } from "react"
import { listLiftMaxes } from "@/lib/data/exercises/exercise-data"
import { liftKey } from "@/lib/data/exercises/loads"
import type { LoggableBlock } from "@/lib/data/session/types"
import { MOCK_ATHLETE_ID } from "@/lib/data/athlete/profile-data"
import { getBackendMode } from "@/lib/supabase/config"
import { rowLoadForViewer } from "@/lib/units"
import { useUnits } from "@/lib/units-store"

/**
 * The blocks of a session as the person looking at them reads them: targets in their own unit.
 * On kilograms this returns the blocks untouched. On pounds every kilogram target is rewritten,
 * and a percentage load is worked out again from the athlete's best lift to the nearest 5 lb
 * (when the best lift cannot be read, the kilogram load is converted instead).
 *
 * `athleteId` is whose session it is; leave it out for the signed-in athlete's own.
 * Nothing stored changes: logged sets stay in kilograms.
 */
export function useViewerBlocks<T extends LoggableBlock>(blocks: T[] | null | undefined, athleteId?: string | null): T[] {
  const units = useUnits()
  const needsMaxes = units.weight === "lb" && Boolean(blocks?.some((block) => block.rows.some((row) => row.percent !== null && row.percent !== undefined)))
  const [maxes, setMaxes] = useState<{ athleteId: string | null; byLift: Map<string, number> } | null>(null)
  const who = athleteId ?? null

  useEffect(() => {
    if (!needsMaxes) return
    let cancelled = false
    // The signed-in athlete's own: row policies return only theirs; the mock athlete is asked for by id.
    const ids = who ? [who] : getBackendMode() !== "supabase" ? [MOCK_ATHLETE_ID] : undefined
    void listLiftMaxes(ids).then((result) => {
      if (cancelled) return
      const rows = result.ok ? result.data : []
      // More than one athlete came back without asking for one: not safe to pick, so convert instead.
      const usable = new Set(rows.map((max) => max.athleteId)).size <= 1 ? rows : []
      setMaxes({ athleteId: who, byLift: new Map(usable.map((max) => [max.liftKey, max.valueKg])) })
    })
    return () => {
      cancelled = true
    }
  }, [needsMaxes, who])

  return useMemo(() => {
    if (!blocks) return []
    if (units.weight !== "lb") return blocks
    const byLift = maxes && maxes.athleteId === who ? maxes.byLift : null
    return blocks.map((block) => ({
      ...block,
      rows: block.rows.map((row) => ({ ...row, ...rowLoadForViewer(row, "lb", row.liftName ? (byLift?.get(liftKey(row.liftName)) ?? null) : null) })),
    }))
  }, [blocks, maxes, units.weight, who])
}

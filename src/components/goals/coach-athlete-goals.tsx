"use client"

import { useCallback, useState } from "react"
import { GoalDialog, GoalList, useGoals } from "@/components/goals/goals-parts"
import { Button, EmptyState, Notice, Section, SkeletonRows } from "@/components/sk"
import { getAthleteGoals } from "@/lib/data/goals/goals-data"

/**
 * The goals of one athlete on the coach's athlete screen: what the athlete is aiming for, with the
 * same progress line the athlete sees. A coach of the athlete's team or a club admin can set,
 * change, mark and remove a goal.
 */
export function CoachAthleteGoals({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const first = athleteName.split(" ")[0] || athleteName
  const load = useCallback(() => getAthleteGoals(athleteId), [athleteId])
  const { view, error, reload } = useGoals(load)
  const [adding, setAdding] = useState(false)
  const [addKey, setAddKey] = useState(0)
  const openAdd = () => {
    setAddKey((value) => value + 1)
    setAdding(true)
  }

  return (
    <Section
      title="Goals"
      hint={`Marks ${first} is aiming for. ${first} sees these under Progress, Goals.`}
      action={
        view ? (
          <Button variant="quiet" size="sm" onClick={openAdd}>
            Set a goal
          </Button>
        ) : undefined
      }
    >
      {error ? <Notice tone="error">Could not load goals: {error}</Notice> : null}
      {view === null && !error ? <SkeletonRows rows={2} label="Loading goals" /> : null}
      {view && view.goals.length === 0 ? (
        <EmptyState title="No goals yet" body={`Set a mark for ${first} to aim for, or wait for ${first} to set one. It is ticked off by itself when a result reaches it.`} />
      ) : null}
      {view && view.goals.length > 0 ? <GoalList aria-label={`Goals of ${athleteName}`} view={view} goals={view.goals} audience="staff" athleteName={first} onChanged={reload} /> : null}
      {view && adding ? <GoalDialog key={addKey} open onOpenChange={setAdding} view={view} goal={null} audience="staff" athleteName={first} onSaved={reload} /> : null}
    </Section>
  )
}

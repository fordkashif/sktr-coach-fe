"use client"

import { useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { ProgressTabs } from "@/components/athlete/results-parts"
import { GoalDialog, GoalList, useGoals } from "@/components/goals/goals-parts"
import { Button, EmptyState, Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { getCurrentAthleteGoals } from "@/lib/data/goals/goals-data"

/** The athlete's goals: a target mark per event, with progress from where they started. */
export default function AthleteGoalsPage() {
  const { view, error, reload } = useGoals(getCurrentAthleteGoals)
  const [adding, setAdding] = useState(false)
  const [addKey, setAddKey] = useState(0)

  const open = view?.goals.filter((goal) => !goal.achievedOn) ?? []
  const achieved = view?.goals.filter((goal) => goal.achievedOn) ?? []
  const openAdd = () => {
    setAddKey((value) => value + 1)
    setAdding(true)
  }

  return (
    <Screen>
      <ScreenHeader
        title="Goals"
        actions={
          <Button variant="primary" onClick={openAdd} disabled={!view}>
            <Plus className="size-[18px]" weight="bold" aria-hidden />
            Set a goal
          </Button>
        }
      />
      <ProgressTabs />

      {error ? <Notice tone="error">Your goals could not be loaded. {error}</Notice> : null}

      {view === null && !error ? (
        <Section title="Working towards">
          <SkeletonRows rows={3} label="Loading your goals" />
        </Section>
      ) : null}

      {view && view.goals.length === 0 ? (
        <Section title="No goals yet">
          <EmptyState
            title="Pick an event and the mark you want"
            action={
              <Button size="sm" onClick={openAdd}>
                Set a goal
              </Button>
            }
          />
        </Section>
      ) : null}

      {view && open.length > 0 ? (
        <Section title="Working towards" meta={`${open.length} ${open.length === 1 ? "goal" : "goals"}`}>
          <GoalList aria-label="Goals you are working towards" view={view} goals={open} audience="athlete" onChanged={reload} />
        </Section>
      ) : null}

      {view && achieved.length > 0 ? (
        <Section title="Achieved" meta={`${achieved.length} ${achieved.length === 1 ? "goal" : "goals"}`}>
          <GoalList aria-label="Goals you have achieved" view={view} goals={achieved} audience="athlete" onChanged={reload} />
        </Section>
      ) : null}

      {view && adding ? <GoalDialog key={addKey} open onOpenChange={setAdding} view={view} goal={null} audience="athlete" onSaved={reload} /> : null}
    </Screen>
  )
}

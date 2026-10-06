"use client"

import { useEffect, useMemo, useState } from "react"
import { Button, Dialog, Field, FormActions, Notice, Select } from "@/components/sk"
import {
  canStayWithRemainingCoaches,
  defaultHandoverChoice,
  HANDOVER_KEEP,
  HANDOVER_STAY,
  remainingCoachNames,
  teamCoachRoleLabel,
  validateHandover,
  type HandoverChoice,
  type HandoverTeam,
  type HandoverThen,
} from "@/lib/coach-permissions"
import type { HandoverOutcome } from "@/lib/data/club-admin/handover-data"
import type { Result } from "@/lib/data/result"

export type HandoverCandidate = { userId: string; name: string }

const COPY: Record<HandoverThen, { title: (name: string) => string; lede: (name: string) => string; confirm: string; busy: string }> = {
  none: {
    title: (name) => `Hand over ${name}'s teams`,
    lede: (name) => `Choose who takes over each team. ${name} stays in the club and keeps any team you leave with them.`,
    confirm: "Hand over teams",
    busy: "Handing over...",
  },
  deactivate: {
    title: (name) => `Hand over teams, then deactivate ${name}`,
    lede: (name) => `${name} still coaches teams. Choose who takes over each one, so no team is left without a coach. Then their access is switched off until you reactivate them.`,
    confirm: "Hand over and deactivate",
    busy: "Handing over...",
  },
  remove: {
    title: (name) => `Hand over teams, then remove ${name}`,
    lede: (name) => `${name} still coaches teams. Choose who takes over each one, so no team is left without a coach. Then they are removed from the club for good.`,
    confirm: "Hand over and remove",
    busy: "Handing over...",
  },
}

function listNames(names: string[]) {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/**
 * The handover step: for every team a coach is on, who takes over as lead. Used when a club admin
 * removes or deactivates a coach who still coaches, and on its own ("Hand over teams").
 * Everything is saved in one step by `onSubmit`; nothing changes until then.
 */
export function CoachHandoverDialog({
  open,
  coach,
  then,
  teams,
  candidates,
  onClose,
  onInviteCoach,
  onSubmit,
  onDone,
}: {
  open: boolean
  coach: { userId: string; name: string } | null
  then: HandoverThen
  /** The teams the coach is on. */
  teams: HandoverTeam[]
  /** Active coaches and club admins of the club, without the coach who is handing over. */
  candidates: HandoverCandidate[]
  onClose: () => void
  /** "Invite a new coach first": closes this step and opens the invite. */
  onInviteCoach: () => void
  onSubmit: (choices: Record<string, HandoverChoice | "">) => Promise<Result<HandoverOutcome>>
  onDone: (outcome: HandoverOutcome) => void
}) {
  const [choices, setChoices] = useState<Record<string, HandoverChoice | "">>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showProblems, setShowProblems] = useState(false)

  const coachId = coach?.userId ?? ""
  const teamKey = teams.map((team) => team.id).join(",")
  // A fresh start each time the step opens for a coach.
  useEffect(() => {
    if (!open || !coachId) return
    setChoices(Object.fromEntries(teams.map((team) => [team.id, defaultHandoverChoice(team, coachId)])))
    setError(null)
    setShowProblems(false)
    setBusy(false)
    // teams is rebuilt by the parent on every render; its ids are what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, coachId, teamKey, then])

  const problems = useMemo(
    () => (coachId ? validateHandover({ leavingUserId: coachId, teams, choices, then, candidateIds: candidates.map((item) => item.userId) }) : []),
    [candidates, choices, coachId, teams, then],
  )

  if (!coach) return null
  const copy = COPY[then]

  const submit = async () => {
    if (problems.length > 0) {
      setShowProblems(true)
      return
    }
    setBusy(true)
    setError(null)
    const result = await onSubmit(choices)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onDone(result.data)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      title={copy.title(coach.name)}
      description={copy.lede(coach.name)}
      className="sm:max-w-xl"
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {teams.map((team) => {
          const mine = team.coaches.find((item) => item.userId === coach.userId)
          const stayNames = remainingCoachNames(team, coach.userId)
          const problem = showProblems ? problems.find((item) => item.teamId === team.id) : undefined
          const onTeam = new Set(team.coaches.map((item) => item.userId))
          return (
            <Field
              key={team.id}
              label={team.name}
              hint={`${coach.name} is ${mine ? teamCoachRoleLabel(mine.role).toLowerCase() : "a coach"} here.${stayNames.length > 0 ? ` Also coaching: ${listNames(stayNames)}.` : " Nobody else coaches it."}`}
              error={problem?.message}
            >
              <Select data-handover-team={team.name} value={choices[team.id] ?? ""} onChange={(event) => setChoices((current) => ({ ...current, [team.id]: event.target.value }))}>
                <option value="">Choose what happens</option>
                {candidates.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId}>
                    {candidate.name} takes over as lead{onTeam.has(candidate.userId) ? "" : " (joins the team)"}
                  </option>
                ))}
                {canStayWithRemainingCoaches(team, coach.userId) ? <option value={HANDOVER_STAY}>No new lead, stays with {listNames(stayNames)}</option> : null}
                {then === "none" ? <option value={HANDOVER_KEEP}>{coach.name} keeps this team</option> : null}
              </Select>
            </Field>
          )
        })}

        <p className="text-sm text-sk-ink-2" data-handover-effects>
          {coach.name}&apos;s open conversations with athletes of a team they hand over are closed, with a line saying they no longer coach the team. Athletes and club admins can still read them. The
          new coach does not see them. Plans, test weeks, templates, exercises and coach notes stay with the club and its teams. Athletes on those teams and the new lead get a notification.
        </p>

        <p className="text-sm text-sk-mute">
          Nobody suitable yet?{" "}
          <button type="button" className="sk-link cursor-pointer" onClick={onInviteCoach}>
            Invite a new coach first
          </button>
          , then come back once they have joined.
        </p>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <FormActions>
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={then === "remove" ? "danger" : "primary"} disabled={busy}>
            {busy ? copy.busy : copy.confirm}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  )
}

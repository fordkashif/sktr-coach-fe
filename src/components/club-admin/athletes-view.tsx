"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { PersonAvatar } from "@/components/account/person-avatar"
import { AddAthletesDialog } from "@/components/coach/add-athletes-dialog"
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  FilterBar,
  FilterChips,
  FormActions,
  InlineConfirm,
  Input,
  Notice,
  RowMenu,
  SearchInput,
  Section,
  Select,
  SkeletonRows,
  StatusText,
  TableSub,
  notify,
  notifyError,
  type DataTableColumn,
  type RowMenuItem,
  type StateTone,
} from "@/components/sk"
import {
  assignAthleteToTeam,
  deleteAthleteAndData,
  isAthleteNameConfirmed,
  removeAthleteFromClub,
  restoreAthleteToClub,
  type ClubAthlete,
  type ClubAthleteStatus,
} from "@/lib/data/club-admin/people-data"

type TeamOption = { id: string; name: string }

const STATUS: Record<ClubAthleteStatus, { label: string; tone: StateTone }> = {
  active: { label: "Active", tone: "green" },
  deactivated: { label: "Deactivated", tone: "neutral" },
  left: { label: "Left the club", tone: "neutral" },
}

/* ---------- Put an athlete on a team ---------------------------------------------------------------- */

export function AssignTeamDialog({
  athlete,
  teams,
  teamName,
  onClose,
  onMoved,
}: {
  /** The athlete being moved. Null closes the dialog. */
  athlete: ClubAthlete | null
  teams: TeamOption[]
  teamName: (teamId: string | null) => string | null
  onClose: () => void
  onMoved: (athlete: ClubAthlete, team: TeamOption) => void
}) {
  const [teamId, setTeamId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = teams.filter((team) => team.id !== athlete?.teamId)
  const current = athlete ? teamName(athlete.teamId) : null

  useEffect(() => {
    setTeamId("")
    setError(null)
  }, [athlete?.id])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const team = options.find((item) => item.id === teamId)
    if (!athlete || !team) return
    setBusy(true)
    setError(null)
    const result = await assignAthleteToTeam(athlete.id, team.id)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onMoved(athlete, team)
    if (result.data.warning) notifyError(`${athlete.name} is on ${team.name}`, result.data.warning)
    else notify(`${athlete.name} is on ${team.name}`, current ? "Their history came with them." : undefined)
    onClose()
  }

  return (
    <Dialog
      open={athlete !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={current ? "Move to another team" : "Assign to a team"}
      description={
        athlete
          ? current
            ? `${athlete.name} is on ${current}. Their sessions, results and history move with them. Upcoming sessions they have not started swap to the new team's plan.`
            : `${athlete.name} is not on a team, so no coach sees them and they get no plan. Pick the team they train with.`
          : undefined
      }
      className="sm:max-w-md"
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        {options.length === 0 ? (
          <Notice tone="warning">There is no other active team to put them on. Create a team first.</Notice>
        ) : (
          <Field label="Team">
            <Select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              <option value="">Choose a team</option>
              {options.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <FormActions>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !teamId}>
            {busy ? "Saving..." : current ? "Move athlete" : "Assign to team"}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  )
}

/* ---------- Delete an athlete and all their data ------------------------------------------------------ */

function DeleteAthleteDialog({ athlete, onClose, onDeleted }: { athlete: ClubAthlete | null; onClose: () => void; onDeleted: (athlete: ClubAthlete) => void }) {
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTyped("")
    setError(null)
  }, [athlete?.id])

  const confirmed = athlete ? isAthleteNameConfirmed(athlete.name, typed) : false

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!athlete || !confirmed) return
    setBusy(true)
    setError(null)
    const result = await deleteAthleteAndData(athlete.id, typed)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onDeleted(athlete)
    notify("Athlete and their data deleted")
    onClose()
  }

  return (
    <Dialog
      open={athlete !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Delete athlete and all their data"
      description="For a privacy request. This cannot be undone."
      className="sm:max-w-lg"
    >
      {athlete ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <p className="text-[0.9375rem] leading-relaxed text-sk-ink-2">
            Everything recorded about <span className="font-bold text-sk-ink">{athlete.name}</span> is deleted for good: their athlete record, sessions and logs, results and records,
            check-ins, availability, pain reports, guardian contact, competition entries, messages and invites
            {athlete.hasLogin ? ", and their profile in this club" : ""}. Plans and test weeks their coaches wrote stay.
          </p>
          <p className="text-[0.9375rem] leading-relaxed text-sk-ink-2">
            If they are only leaving, use Remove from club instead: that keeps their history.
            {athlete.hasLogin ? " Their sign-in account itself is not deleted here. Email SKTR support to have that removed as well." : ""}
          </p>
          <Field label={`Type ${athlete.name} to confirm`}>
            <Input autoComplete="off" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <FormActions>
            <Button variant="quiet" onClick={onClose}>
              Keep athlete
            </Button>
            <Button type="submit" variant="danger" disabled={busy || !confirmed}>
              {busy ? "Deleting..." : "Delete athlete and data"}
            </Button>
          </FormActions>
        </form>
      ) : null}
    </Dialog>
  )
}

/* ---------- Add athletes: which team? ------------------------------------------------------------------ */

/**
 * "Add athletes" from a screen that is not about one team: asks which team first, then opens the
 * same Add athletes dialog coaches use (email, list, QR code, no login).
 */
export function AddAthletesToTeam({
  open,
  onOpenChange,
  teams,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teams: TeamOption[]
  onChanged: () => void
}) {
  const [teamId, setTeamId] = useState("")
  const [chosen, setChosen] = useState<TeamOption | null>(null)

  useEffect(() => {
    if (!open) return
    setChosen(teams.length === 1 ? teams[0] : null)
    setTeamId("")
    // Only when it opens: the team list reloading must not reset a choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (chosen) {
    return (
      <AddAthletesDialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next)
          if (!next) onChanged()
        }}
        teamId={chosen.id}
        teamName={chosen.name}
        onAthleteAdded={onChanged}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add athletes" description="Athletes join a team. Pick the team, then invite them by email, from a list, with a QR code, or add an athlete with no login." className="sm:max-w-md">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          setChosen(teams.find((team) => team.id === teamId) ?? null)
        }}
      >
        {teams.length === 0 ? (
          <Notice tone="warning">Create a team first. Athletes are added to a team.</Notice>
        ) : (
          <Field label="Team">
            <Select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              <option value="">Choose a team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <FormActions>
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!teamId}>
            Continue
          </Button>
        </FormActions>
      </form>
    </Dialog>
  )
}

/* ---------- The list ------------------------------------------------------------------------------------ */

type Confirm = { kind: "remove" | "deactivate"; athleteId: string }

/**
 * Every athlete of the club for the club admin: on a team or not, with a login or not, and the ones
 * who left. From here an athlete is put on a team, moved, deactivated, removed from the club,
 * brought back, or deleted with all their data.
 */
export function ClubAthletesView({
  athletes,
  loadError,
  teams,
  teamName,
  onChanged,
  onSetLogin,
  onAudit,
  onAddAthletes,
}: {
  /** Null while loading. */
  athletes: ClubAthlete[] | null
  loadError: string | null
  /** Active teams an athlete can be put on. */
  teams: TeamOption[]
  teamName: (teamId: string | null) => string | null
  /** Reload the list after a change. */
  onChanged: () => void
  /** Switch an athlete's login for the club on or off. Resolves to an error message, or null when it worked. */
  onSetLogin: (athlete: ClubAthlete, active: boolean) => Promise<string | null>
  /** Demo mode only: the database writes its own audit entries. */
  onAudit: (action: string, target: string, detail?: string) => void
  onAddAthletes: () => void
}) {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [team, setTeam] = useState("all")
  const [login, setLogin] = useState<"all" | "login" | "none">("all")
  const [scope, setScope] = useState<"current" | "left">("current")
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<ClubAthlete | null>(null)
  const [deleting, setDeleting] = useState<ClubAthlete | null>(null)

  const all = useMemo(() => [...(athletes ?? [])].sort((left, right) => left.name.localeCompare(right.name)), [athletes])
  const current = useMemo(() => all.filter((athlete) => athlete.status !== "left"), [all])
  const left = useMemo(() => all.filter((athlete) => athlete.status === "left"), [all])
  const unassignedCount = current.filter((athlete) => !athlete.teamId).length
  const teamsInUse = useMemo(() => teams.filter((item) => current.some((athlete) => athlete.teamId === item.id)), [current, teams])

  // Nobody is left in "Left the club" after the last one is brought back or deleted.
  useEffect(() => {
    if (scope === "left" && athletes !== null && left.length === 0) setScope("current")
  }, [athletes, left.length, scope])

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (scope === "left" ? left : current).filter((athlete) => {
      if (term && !`${athlete.name} ${athlete.email ?? ""} ${athlete.primaryEvent ?? ""} ${teamName(athlete.teamId) ?? ""}`.toLowerCase().includes(term)) return false
      if (scope === "current") {
        if (team === "none" && athlete.teamId) return false
        if (team !== "all" && team !== "none" && athlete.teamId !== team) return false
      }
      if (login === "login" && !athlete.hasLogin) return false
      if (login === "none" && athlete.hasLogin) return false
      return true
    })
  }, [current, left, login, scope, search, team, teamName])

  const activeFilters = (team !== "all" && scope === "current" ? 1 : 0) + (login !== "all" ? 1 : 0) + (scope !== "current" ? 1 : 0)
  const clearFilters = () => {
    setTeam("all")
    setLogin("all")
    setScope("current")
  }

  const removeFromClub = async (athlete: ClubAthlete) => {
    setBusyId(athlete.id)
    const result = await removeAthleteFromClub(athlete.id)
    setBusyId(null)
    setConfirm(null)
    if (!result.ok) {
      notifyError(`Could not remove ${athlete.name}`, result.error.message)
      return
    }
    onAudit("athlete_removed_from_club", athlete.name, "history kept")
    notify(`${athlete.name} removed from the club`, "Their history is kept. Find them under Left the club.")
    onChanged()
  }

  const restore = async (athlete: ClubAthlete) => {
    setBusyId(athlete.id)
    const result = await restoreAthleteToClub(athlete.id)
    setBusyId(null)
    if (!result.ok) {
      notifyError(`Could not bring ${athlete.name} back`, result.error.message)
      return
    }
    onAudit("athlete_restored_to_club", athlete.name)
    notify(`${athlete.name} is back in the club`, "They are not on a team yet. Assign them to one next.")
    onChanged()
  }

  const setLoginState = async (athlete: ClubAthlete, active: boolean) => {
    setBusyId(athlete.id)
    const problem = await onSetLogin(athlete, active)
    setBusyId(null)
    setConfirm(null)
    if (problem) {
      notifyError(`Could not ${active ? "reactivate" : "deactivate"} ${athlete.name}`, problem)
      return
    }
    notify(active ? `${athlete.name} can sign in again` : `${athlete.name} can no longer sign in`)
    onChanged()
  }

  const menuFor = (athlete: ClubAthlete): RowMenuItem[] => {
    if (athlete.status === "left") {
      return [
        { label: "Bring back to club", onSelect: () => void restore(athlete), disabled: busyId === athlete.id },
        { label: "Delete athlete and data", onSelect: () => setDeleting(athlete), danger: true },
      ]
    }
    return [
      { label: "Open profile", onSelect: () => navigate(`/coach/athletes/${athlete.id}`) },
      { label: athlete.teamId ? "Move to another team" : "Assign to a team", onSelect: () => setAssigning(athlete) },
      ...(athlete.hasLogin
        ? [
            athlete.status === "deactivated"
              ? { label: "Reactivate", onSelect: () => void setLoginState(athlete, true), disabled: busyId === athlete.id }
              : { label: "Deactivate", onSelect: () => setConfirm({ kind: "deactivate", athleteId: athlete.id }) },
          ]
        : []),
      { label: "Remove from club", onSelect: () => setConfirm({ kind: "remove", athleteId: athlete.id }), danger: true },
      { label: "Delete athlete and data", onSelect: () => setDeleting(athlete), danger: true },
    ]
  }

  const columns: Array<DataTableColumn<ClubAthlete>> = [
    {
      key: "athlete",
      header: "Athlete",
      cell: (athlete) => {
        const body = (
          <>
            <PersonAvatar name={athlete.name} athleteId={athlete.id} userId={athlete.userId} size="sm" />
            <span className="min-w-0">
              {athlete.name}
              <TableSub>
                <span className="block max-sm:truncate sm:break-all">{athlete.hasLogin ? (athlete.email ?? "Has a login") : "No login"}</span>
              </TableSub>
            </span>
          </>
        )
        return athlete.status === "left" ? (
          <span className="flex items-center gap-3">{body}</span>
        ) : (
          <Link to={`/coach/athletes/${athlete.id}`} className="flex items-center gap-3 hover:text-sk-blue-link">
            {body}
          </Link>
        )
      },
    },
    {
      key: "team",
      header: "Team",
      cell: (athlete) =>
        athlete.status === "left" ? <span className="text-sk-mute">None</span> : athlete.teamId ? (teamName(athlete.teamId) ?? "Archived team") : <StatusText tone="amber">Unassigned</StatusText>,
    },
    { key: "event", header: "Main event", phone: "hide", cell: (athlete) => athlete.primaryEvent || <span className="text-sk-mute">Not set</span> },
    {
      key: "status",
      header: "Status",
      phone: "trailing",
      cell: (athlete) => (
        <span className="flex items-center justify-between gap-2">
          <StatusText tone={STATUS[athlete.status].tone}>{STATUS[athlete.status].label}</StatusText>
          <RowMenu label={`More for ${athlete.name}`} items={menuFor(athlete)} />
        </span>
      ),
    },
  ]

  return (
    <Section aria-label="Athletes">
      {loadError ? <Notice tone="error">Could not load athletes: {loadError}</Notice> : null}
      {athletes === null ? (
        loadError ? null : (
          <SkeletonRows rows={6} leading label="Loading athletes" />
        )
      ) : all.length === 0 ? (
        <EmptyState
          title="No athletes yet"
          body="Every athlete of the club shows up here: on a team or not, with their own login or added by a coach. Add them to a team to get started."
          action={
            <Button size="sm" onClick={onAddAthletes}>
              Add athletes
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <FilterBar
            search={<SearchInput aria-label="Search athletes" placeholder="Search by name, email, event or team" value={search} onChange={(event) => setSearch(event.target.value)} />}
            activeCount={activeFilters}
            onClear={clearFilters}
          >
            {scope === "current" ? (
              <FilterChips
                label="Team"
                value={team}
                onChange={setTeam}
                options={[
                  { value: "all", label: "All" },
                  { value: "none", label: "Unassigned", count: unassignedCount },
                  ...teamsInUse.map((item) => ({ value: item.id, label: item.name })),
                ]}
              />
            ) : null}
            <FilterChips
              label="Login"
              value={login}
              onChange={setLogin}
              options={[
                { value: "all", label: "All" },
                { value: "login", label: "Has login" },
                { value: "none", label: "No login" },
              ]}
            />
            {left.length > 0 ? (
              <FilterChips
                label="Show"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "current", label: "In the club", count: current.length },
                  { value: "left", label: "Left the club", count: left.length },
                ]}
              />
            ) : null}
          </FilterBar>

          {shown.length > 0 ? (
            <DataTable
              caption={scope === "left" ? "Athletes who left the club" : "Athletes in the club"}
              columns={columns}
              rows={shown}
              rowKey={(athlete) => athlete.id}
              rowProps={(athlete) => ({ "data-athlete": athlete.name, "data-athlete-team": athlete.teamId ?? "none" })}
              rowBelow={(athlete) =>
                confirm?.athleteId !== athlete.id ? null : confirm.kind === "remove" ? (
                  <InlineConfirm
                    question={`Remove ${athlete.name} from the club? They come off their team${athlete.hasLogin ? " and can no longer sign in to this club" : ""}. Their history is kept and you can bring them back.`}
                    confirmLabel="Remove from club"
                    cancelLabel="Keep in club"
                    busy={busyId === athlete.id}
                    onConfirm={() => void removeFromClub(athlete)}
                    onCancel={() => setConfirm(null)}
                  />
                ) : (
                  <InlineConfirm
                    question={`Deactivate ${athlete.name}? They can no longer sign in until you reactivate them. They stay on their team and their history is kept.`}
                    confirmLabel="Deactivate"
                    cancelLabel="Keep active"
                    busy={busyId === athlete.id}
                    onConfirm={() => void setLoginState(athlete, false)}
                    onCancel={() => setConfirm(null)}
                  />
                )
              }
            />
          ) : (
            <EmptyState
              title="No athletes match"
              body="Nobody fits that search and those filters."
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setSearch("")
                    clearFilters()
                  }}
                >
                  Show everyone
                </Button>
              }
            />
          )}
          {shown.length > 0 && shown.length < (scope === "left" ? left.length : current.length) ? (
            <p className="text-sm text-sk-mute" aria-live="polite">
              Showing {shown.length} of {scope === "left" ? left.length : current.length}.
            </p>
          ) : null}
        </div>
      )}

      <AssignTeamDialog
        athlete={assigning}
        teams={teams}
        teamName={teamName}
        onClose={() => setAssigning(null)}
        onMoved={(athlete, target) => {
          onAudit(athlete.teamId ? "athlete_moved_team" : "athlete_team_assign", athlete.name, `team ${target.name}`)
          onChanged()
        }}
      />
      <DeleteAthleteDialog
        athlete={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          // The entry names nobody, as on the real backend.
          onAudit("athlete_data_deleted", "athlete", "record and history deleted on request")
          onChanged()
        }}
      />
    </Section>
  )
}

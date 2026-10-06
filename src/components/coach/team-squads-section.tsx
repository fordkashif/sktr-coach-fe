"use client"

import { Plus } from "@phosphor-icons/react"
import { useState, type FormEvent } from "react"
import {
  ActionRow,
  Button,
  Dialog,
  EmptyState,
  Field,
  GroupDot,
  InlineConfirm,
  Input,
  List,
  Notice,
  PersonPicker,
  RowMenu,
  Section,
  Select,
  SkeletonRows,
  Textarea,
  notify,
  notifyError,
} from "@/components/sk"
import type { RosterAthlete } from "@/lib/data/coach/roster-data"
import { SQUAD_COLORS, SQUAD_COLOR_LABELS, SQUAD_NAME_MAX, SQUAD_NOTE_MAX, isSquadColor, squadNamesText, squadsByAthlete, type Squad, type SquadColor } from "@/lib/data/coach/squads"
import { archiveSquad, createSquad, setSquadMembers, updateSquad } from "@/lib/data/coach/squads-data"

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

type Editing = { squad: Squad | null; name: string; color: SquadColor | ""; note: string }

/**
 * The squads of one team: small named groups a coach sends work to. Add, rename and archive a
 * squad, and choose who is in it from the roster. An athlete can be in several squads or in none.
 */
export function TeamSquadsSection({
  teamId,
  teamName,
  squads,
  athletes,
  loadError,
  onChanged,
}: {
  teamId: string
  teamName: string
  /** Null while loading. */
  squads: Squad[] | null
  athletes: RosterAthlete[]
  loadError: string | null
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [members, setMembers] = useState<{ squad: Squad; chosen: string[] } | null>(null)
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const names = new Map(athletes.map((athlete) => [athlete.id, athlete.name]))
  const otherSquads = squadsByAthlete(squads ?? [])

  const openNew = () => {
    setFormError(null)
    setEditing({ squad: null, name: "", color: "", note: "" })
  }
  const openEdit = (squad: Squad) => {
    setFormError(null)
    setEditing({ squad, name: squad.name, color: squad.color ?? "", note: squad.note ?? "" })
  }

  const saveSquad = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing || busy) return
    const input = { name: editing.name, color: editing.color || null, note: editing.note }
    setBusy(true)
    const result = editing.squad ? await updateSquad(editing.squad, input) : await createSquad(teamId, input)
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    const created = editing.squad ? null : (result.data as Squad)
    setEditing(null)
    onChanged()
    if (created) {
      notify(`${created.name} created`, athletes.length > 0 ? "Now choose who is in it." : undefined)
      if (athletes.length > 0) setMembers({ squad: created, chosen: [] })
    } else {
      notify("Squad saved")
    }
  }

  const saveMembers = async () => {
    if (!members || busy) return
    setBusy(true)
    const result = await setSquadMembers(members.squad, members.chosen)
    setBusy(false)
    if (!result.ok) {
      notifyError("Could not save the squad", result.error.message)
      onChanged()
      return
    }
    const { added, removed, warning } = result.data
    setMembers(null)
    onChanged()
    if (warning) notifyError("Squad saved, sessions not created", warning)
    else if (added === 0 && removed === 0) notify("Nothing changed")
    else notify(`${members.squad.name} saved`, [added > 0 ? `${plural(added, "athlete")} added` : null, removed > 0 ? `${removed} removed` : null].filter(Boolean).join(", "))
  }

  const archive = async (squad: Squad) => {
    setBusy(true)
    const result = await archiveSquad(squad.id)
    setBusy(false)
    setConfirmArchiveId(null)
    if (!result.ok) {
      notifyError("Could not archive the squad", result.error.message)
      return
    }
    onChanged()
    notify(`${squad.name} archived`)
  }

  return (
    <Section
      aria-label="Squads"
      title="Squads"
      hint={`Groups inside ${teamName}, for sending a plan or a test week to part of the team.`}
      action={
        squads && squads.length > 0 ? (
          <Button size="sm" onClick={openNew}>
            <Plus className="size-4" weight="bold" aria-hidden />
            New squad
          </Button>
        ) : undefined
      }
    >
      {loadError ? <Notice tone="error">Could not load the squads: {loadError}</Notice> : null}
      {squads === null ? (
        loadError ? null : (
          <SkeletonRows rows={3} label="Loading squads" />
        )
      ) : squads.length === 0 ? (
        <EmptyState
          title="No squads yet"
          body="Make one for each group you coach differently, such as Short sprints, 400m or Juniors. Then a plan or a test week can go to just that group."
          action={
            <Button size="sm" onClick={openNew}>
              New squad
            </Button>
          }
        />
      ) : (
        <List aria-label={`Squads of ${teamName}`}>
          {squads.map((squad) => {
            const memberNames = squad.athleteIds.map((id) => names.get(id)).filter((name): name is string => Boolean(name))
            const preview = memberNames.length <= 3 ? squadNamesText(memberNames) : `${memberNames.slice(0, 2).join(", ")} and ${memberNames.length - 2} more`
            return (
              <ActionRow
                key={squad.id}
                data-squad={squad.name}
                leading={<GroupDot color={squad.color} />}
                title={squad.name}
                subtitle={
                  <>
                    <span data-squad-count>{plural(squad.athleteIds.length, "athlete")}</span>
                    {memberNames.length > 0 ? `: ${preview}` : ""}
                    {squad.note ? <span className="block">{squad.note}</span> : null}
                  </>
                }
                onClick={() => setMembers({ squad, chosen: squad.athleteIds })}
                actions={
                  <RowMenu
                    label={`More for ${squad.name}`}
                    items={[
                      { label: "Choose athletes", onSelect: () => setMembers({ squad, chosen: squad.athleteIds }) },
                      { label: "Rename or edit", onSelect: () => openEdit(squad) },
                      { label: "Archive squad", onSelect: () => setConfirmArchiveId(squad.id), danger: true },
                    ]}
                  />
                }
                below={
                  confirmArchiveId === squad.id ? (
                    <InlineConfirm
                      question={`Archive ${squad.name}? ${
                        squad.athleteIds.length === 1 ? "Its 1 athlete leaves the squad and stops" : squad.athleteIds.length > 1 ? `Its ${squad.athleteIds.length} athletes leave the squad and stop` : "It stops"
                      } getting new sessions from plans sent to it. Sessions already done stay.`}
                      confirmLabel="Archive squad"
                      cancelLabel="Keep it"
                      busy={busy}
                      onConfirm={() => void archive(squad)}
                      onCancel={() => setConfirmArchiveId(null)}
                    />
                  ) : undefined
                }
              />
            )
          })}
        </List>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        title={editing?.squad ? "Edit squad" : "New squad"}
        description={editing?.squad ? undefined : `A group inside ${teamName}. You choose its athletes next.`}
        footer={
          <>
            <Button variant="quiet" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="squad-form" disabled={busy}>
              {busy ? "Saving..." : editing?.squad ? "Save squad" : "Create squad"}
            </Button>
          </>
        }
      >
        {editing ? (
          <form id="squad-form" className="flex flex-col gap-4" onSubmit={(event) => void saveSquad(event)}>
            {formError ? <Notice tone="error">{formError}</Notice> : null}
            <Field label="Name" hint="For example Short sprints, 400m or Juniors.">
              <Input value={editing.name} maxLength={SQUAD_NAME_MAX} autoFocus required onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
            </Field>
            <Field label="Colour dot" optional hint="Only to tell squads apart in a list.">
              <Select value={editing.color} onChange={(event) => setEditing({ ...editing, color: isSquadColor(event.target.value) ? event.target.value : "" })}>
                <option value="">No colour</option>
                {SQUAD_COLORS.map((color) => (
                  <option key={color} value={color}>
                    {SQUAD_COLOR_LABELS[color]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note" optional hint="Only coaches see this.">
              <Textarea value={editing.note} rows={2} maxLength={SQUAD_NOTE_MAX} onChange={(event) => setEditing({ ...editing, note: event.target.value })} />
            </Field>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={members !== null}
        onOpenChange={(open) => {
          if (!open) setMembers(null)
        }}
        title={members ? `Athletes in ${members.squad.name}` : "Athletes"}
        description="Tick everyone in this squad. Athletes you add get the upcoming sessions of plans sent to it. Athletes you take out stop getting new ones."
        footer={
          <>
            <Button variant="quiet" onClick={() => setMembers(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void saveMembers()}>
              {busy ? "Saving..." : `Save ${members ? plural(members.chosen.length, "athlete") : ""}`}
            </Button>
          </>
        }
      >
        {members ? (
          <PersonPicker
            multiple
            label={`Athletes in ${members.squad.name}`}
            value={members.chosen}
            onChange={(chosen) => setMembers({ ...members, chosen })}
            empty="Nobody on this team yet. Add athletes to the roster first."
            people={athletes.map((athlete) => {
              const also = (otherSquads.get(athlete.id) ?? []).filter((squad) => squad.id !== members.squad.id).map((squad) => squad.name)
              return {
                id: athlete.id,
                name: athlete.name,
                detail: also.length > 0 ? `${athlete.primaryEvent}. Also in ${squadNamesText(also)}` : athlete.primaryEvent,
              }
            })}
          />
        ) : null}
      </Dialog>
    </Section>
  )
}

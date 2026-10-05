"use client"

import { UserPlus } from "@phosphor-icons/react"
import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactElement } from "react"
import { Link } from "react-router-dom"
import { PersonAvatar } from "@/components/account/person-avatar"
import { AddAthletesDialog, type AddAthletesView } from "@/components/coach/add-athletes-dialog"
import { inviteEmailSummary, resendInviteEmailLabel, canResendInviteEmail } from "@/components/invites/invite-email-ui"
import {
  ActionRow,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  FilterChips,
  InlineConfirm,
  List,
  Notice,
  ReadinessText,
  RowMenu,
  Screen,
  ScreenHeader,
  SearchInput,
  Section,
  SkeletonRows,
  StatusText,
  TableSub,
  Tabs,
  notify,
  notifyError,
  type DataTableColumn,
  type RowMenuItem,
  type StateTone,
} from "@/components/sk"
import { describeAvailability, AVAILABILITY_CHANGED_EVENT } from "@/lib/data/athlete/availability-data"
import {
  getAthleteInvitesForTeam,
  recordMockInviteEmail,
  revokeAthleteInviteForCurrentCoach,
  type AthleteInviteStatus,
  type TeamAthleteInvite,
} from "@/lib/data/athlete/invite-data"
import { getTeamRoster, type RosterAthlete, type TeamRoster } from "@/lib/data/coach/roster-data"
import { ROSTER_CHANGED_EVENT } from "@/lib/data/coach/roster-mock"
import { sendInviteEmail } from "@/lib/data/invites/invite-email-data"
import { adherenceText } from "@/lib/data/session/adherence"
import type { EventGroup } from "@/lib/mock-data"

function absoluteLink(path: string) {
  return typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path
}

function shortDate(value: string | null | undefined) {
  if (!value) return null
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const INVITE_STATUS: Record<AthleteInviteStatus, { label: string; tone: StateTone }> = {
  pending: { label: "Waiting", tone: "amber" },
  accepted: { label: "Joined", tone: "green" },
  expired: { label: "Expired", tone: "coral" },
  revoked: { label: "Cancelled", tone: "neutral" },
}

type ReadinessFilter = "all" | "green" | "yellow" | "red"
type AvailabilityFilter = "all" | "available" | "unavailable"
type InviteFilter = "all" | AthleteInviteStatus

/**
 * "Invite athlete" for screens that list several teams (the club admin's Teams screen): wraps any
 * button so pressing it opens Add athletes for that team.
 */
export function InviteAthleteDialog({
  teamId,
  teamName,
  trigger,
  onCreated,
}: {
  teamId: string
  teamName: string
  trigger: ReactElement<{ onClick?: (event: MouseEvent) => void }>
  onCreated?: (invite: TeamAthleteInvite) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {isValidElement(trigger) ? cloneElement(trigger, { onClick: () => setOpen(true) }) : null}
      <AddAthletesDialog open={open} onOpenChange={setOpen} teamId={teamId} teamName={teamName} onInvitesCreated={(invites) => invites.forEach((invite) => onCreated?.(invite))} />
    </>
  )
}

/**
 * The coach's roster of one team: who is on it and how they are doing, and the invites that are
 * still out. `teamName` is shown while the roster loads.
 */
export function CoachTeamDetailContent({ teamId, teamName }: { teamId: string; teamName?: string | null }) {
  const [roster, setRoster] = useState<TeamRoster | null>(null)
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null)
  const [invites, setInvites] = useState<TeamAthleteInvite[] | null>(null)
  const [invitesError, setInvitesError] = useState<string | null>(null)
  const [view, setView] = useState<"athletes" | "invites">("athletes")
  const [addOpen, setAddOpen] = useState(false)
  const [addView, setAddView] = useState<AddAthletesView>("email")
  const [search, setSearch] = useState("")
  const [readiness, setReadiness] = useState<ReadinessFilter>("all")
  const [availability, setAvailability] = useState<AvailabilityFilter>("all")
  const [eventGroup, setEventGroup] = useState<EventGroup | "all">("all")
  const [inviteFilter, setInviteFilter] = useState<InviteFilter>("all")
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)

  const loadRoster = useCallback(async () => {
    const result = await getTeamRoster(teamId)
    if (!result.ok) {
      setLoadError({ notFound: result.error.code === "NOT_FOUND", message: result.error.message })
      return
    }
    setLoadError(null)
    setRoster(result.data)
  }, [teamId])

  const loadInvites = useCallback(async () => {
    const result = await getAthleteInvitesForTeam(teamId)
    if (!result.ok) {
      setInvitesError(result.error.message)
      setInvites((current) => current ?? [])
      return
    }
    setInvitesError(null)
    setInvites(result.data)
  }, [teamId])

  useEffect(() => {
    void loadRoster()
    void loadInvites()
    const refresh = () => {
      void loadRoster()
      void loadInvites()
    }
    window.addEventListener(ROSTER_CHANGED_EVENT, refresh)
    window.addEventListener(AVAILABILITY_CHANGED_EVENT, refresh)
    return () => {
      window.removeEventListener(ROSTER_CHANGED_EVENT, refresh)
      window.removeEventListener(AVAILABILITY_CHANGED_EVENT, refresh)
    }
  }, [loadInvites, loadRoster])

  const athletes = useMemo(() => [...(roster?.athletes ?? [])].sort((left, right) => left.name.localeCompare(right.name)), [roster])
  const groupsOnTeam = useMemo(() => [...new Set(athletes.map((athlete) => athlete.eventGroup))], [athletes])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return athletes.filter((athlete) => {
      if (term && !`${athlete.name} ${athlete.primaryEvent} ${athlete.eventGroup}`.toLowerCase().includes(term)) return false
      if (readiness !== "all" && athlete.readiness !== readiness) return false
      if (availability === "available" && athlete.availability) return false
      if (availability === "unavailable" && !athlete.availability) return false
      if (eventGroup !== "all" && athlete.eventGroup !== eventGroup) return false
      return true
    })
  }, [athletes, availability, eventGroup, readiness, search])

  const activeFilters = (readiness !== "all" ? 1 : 0) + (availability !== "all" ? 1 : 0) + (eventGroup !== "all" ? 1 : 0)
  const clearFilters = () => {
    setReadiness("all")
    setAvailability("all")
    setEventGroup("all")
  }

  const openAdd = (which: AddAthletesView) => {
    setAddView(which)
    setAddOpen(true)
  }

  const name = roster?.team.name ?? teamName ?? "Team"

  if (loadError && !roster) {
    return (
      <Screen>
        <ScreenHeader
          title={loadError.notFound ? "Team not found" : name}
          lede={loadError.notFound ? "This team does not exist in your SKTR Coach workspace, or you are not assigned to it." : undefined}
        />
        {loadError.notFound ? null : <Notice tone="error">Could not load the roster: {loadError.message}</Notice>}
      </Screen>
    )
  }

  const needLook = athletes.filter((athlete) => athlete.readiness !== "green" || (athlete.adherence !== null && athlete.adherence < 75)).length
  const unavailable = athletes.filter((athlete) => athlete.availability).length
  const lede = !roster
    ? "Getting your roster..."
    : athletes.length === 0
      ? "Nobody on the roster yet. Add your athletes to start seeing readiness and adherence here."
      : `${athletes.length} ${athletes.length === 1 ? "athlete" : "athletes"}. ${
          needLook === 0 ? "Everyone is on track" : `${needLook} ${needLook === 1 ? "needs" : "need"} a look`
        }${unavailable > 0 ? `, ${unavailable} unavailable` : ""}.`

  const pendingInvites = (invites ?? []).filter((invite) => invite.status === "pending")
  const shownInvites = (invites ?? []).filter((invite) => inviteFilter === "all" || invite.status === inviteFilter)

  const columns: Array<DataTableColumn<RosterAthlete>> = [
    {
      key: "athlete",
      header: "Athlete",
      cell: (athlete) => (
        <Link to={`/coach/athletes/${athlete.id}`} className="flex items-center gap-3 hover:text-sk-blue-link" data-athlete-row={athlete.id}>
          <PersonAvatar name={athlete.name} athleteId={athlete.id} size="sm" />
          <span className="min-w-0">
            {athlete.name}
            <TableSub>{athlete.hasLogin ? athlete.primaryEvent : `${athlete.primaryEvent}, no login`}</TableSub>
          </span>
        </Link>
      ),
    },
    {
      key: "readiness",
      header: "Readiness",
      phone: "plain",
      cell: (athlete) => (athlete.hasLogin || athlete.lastWellness !== "-" ? <ReadinessText status={athlete.readiness} /> : <span className="text-sk-mute">No check-ins</span>),
    },
    {
      key: "availability",
      header: "Availability",
      // On phone only an unavailable athlete gets this line: "Available" is the normal case.
      phone: "plain",
      cell: (athlete) =>
        athlete.availability ? (
          <StatusText tone="amber">{sentenceCase(describeAvailability(athlete.availability))}</StatusText>
        ) : (
          <span className="max-sm:hidden">Available</span>
        ),
    },
    { key: "adherence", header: "Adherence", align: "right", strong: true, phone: "trailing", cell: (athlete) => adherenceText(athlete.adherence) },
    { key: "last", header: "Last session", align: "right", phone: "hide", cell: (athlete) => shortDate(athlete.lastSessionOn) ?? "None in 4 weeks" },
  ]

  /** Emails a waiting invite again. The link stays the same. */
  const resendInvite = async (invite: TeamAthleteInvite) => {
    setBusyInviteId(invite.id)
    const result = await sendInviteEmail({ kind: "athlete", inviteId: invite.id })
    setBusyInviteId(null)
    recordMockInviteEmail(invite.id, result.ok ? { sentAt: result.data.sentAt } : { error: typeof result.error.cause === "string" ? result.error.cause : "provider_failure" })
    setInvites((current) =>
      (current ?? []).map((item) =>
        item.id !== invite.id
          ? item
          : result.ok
            ? { ...item, emailSentAt: result.data.sentAt, emailSendCount: Math.max(result.data.sendCount, (item.emailSendCount ?? 0) + 1), emailError: null }
            : { ...item, emailError: typeof result.error.cause === "string" ? result.error.cause : "provider_failure" },
      ),
    )
    if (result.ok) notify(`Invite emailed to ${invite.email}`)
    else notifyError("The invite email was not sent", `${result.error.message} You can still copy the link and send it yourself.`)
  }

  const copyInvite = async (invite: TeamAthleteInvite) => {
    try {
      await navigator.clipboard.writeText(absoluteLink(invite.invitePath))
      notify("Invite link copied")
    } catch {
      notifyError("Could not copy the link", "Your browser blocked it. Open the invite again and copy it by hand.")
    }
  }

  const cancelInvite = async (invite: TeamAthleteInvite) => {
    setBusyInviteId(invite.id)
    const result = await revokeAthleteInviteForCurrentCoach(invite.id)
    setBusyInviteId(null)
    setConfirmCancelId(null)
    if (!result.ok) {
      notifyError("Could not cancel the invite", result.error.message)
      void loadInvites()
      return
    }
    setInvites((current) => (current ?? []).map((item) => (item.id === invite.id ? { ...item, status: "revoked" } : item)))
    notify("Invite cancelled")
  }

  const inviteCount = (status: InviteFilter) => (status === "all" ? (invites ?? []).length : (invites ?? []).filter((invite) => invite.status === status).length)

  return (
    <Screen>
      <ScreenHeader
        title={name}
        lede={lede}
        actions={
          <Button variant="primary" onClick={() => openAdd("email")}>
            <UserPlus className="size-5" weight="bold" aria-hidden />
            Add athletes
          </Button>
        }
      />

      {loadError ? <Notice tone="error">Could not load the latest roster: {loadError.message}</Notice> : null}

      <Tabs
        label="Roster views"
        value={view}
        onChange={setView}
        options={[
          { value: "athletes", label: "Athletes", count: roster ? athletes.length : undefined },
          { value: "invites", label: "Invites", count: pendingInvites.length > 0 ? pendingInvites.length : undefined },
        ]}
      />

      {view === "athletes" ? (
        <Section aria-label="Athletes">
          {!roster ? (
            <SkeletonRows rows={6} leading label="Loading athletes" />
          ) : athletes.length === 0 ? (
            <EmptyState
              title="No athletes yet"
              body="Athletes show up here with their readiness, availability and adherence as soon as they join. Invite them by email, show the squad a QR code, or add an athlete who has no login."
              action={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => openAdd("list")}>
                    Invite a list
                  </Button>
                  <Button size="sm" onClick={() => openAdd("code")}>
                    Show a QR code
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              <FilterBar
                search={<SearchInput aria-label="Search athletes" placeholder="Search athletes" value={search} onChange={(event) => setSearch(event.target.value)} />}
                activeCount={activeFilters}
                onClear={clearFilters}
              >
                <FilterChips
                  label="Readiness"
                  value={readiness}
                  onChange={setReadiness}
                  options={[
                    { value: "all", label: "All" },
                    { value: "green", label: "Ready" },
                    { value: "yellow", label: "Watch" },
                    { value: "red", label: "Review" },
                  ]}
                />
                <FilterChips
                  label="Availability"
                  value={availability}
                  onChange={setAvailability}
                  options={[
                    { value: "all", label: "All" },
                    { value: "available", label: "Available" },
                    { value: "unavailable", label: "Unavailable" },
                  ]}
                />
                {groupsOnTeam.length > 1 ? (
                  <FilterChips
                    label="Event group"
                    value={eventGroup}
                    onChange={setEventGroup}
                    options={[{ value: "all" as const, label: "All" }, ...groupsOnTeam.map((group) => ({ value: group, label: group }))]}
                  />
                ) : null}
              </FilterBar>

              {filtered.length > 0 ? (
                <DataTable caption={`Athletes on ${name}`} columns={columns} rows={filtered} rowKey={(athlete) => athlete.id} />
              ) : (
                <EmptyState
                  title="No athletes match"
                  body="Nobody on this roster fits that search and those filters."
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
              {filtered.length > 0 && filtered.length < athletes.length ? (
                <p className="text-sm text-sk-mute" aria-live="polite">
                  Showing {filtered.length} of {athletes.length}.
                </p>
              ) : null}
            </div>
          )}
        </Section>
      ) : (
        <Section aria-label="Invites" title="Invites" hint="Every invite for this team, newest first. Open the menu on a waiting invite to email it again, copy its link or cancel it.">
          {invitesError ? <Notice tone="error">Could not load invites: {invitesError}</Notice> : null}
          {invites === null ? (
            <SkeletonRows rows={3} label="Loading invites" />
          ) : invites.length === 0 ? (
            <EmptyState
              title="No invites sent yet"
              body="Invite athletes and we email each one a link to join. The invites appear here, so you can see who has joined and who is still waiting."
              action={
                <Button size="sm" onClick={() => openAdd("list")}>
                  Invite athletes
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              <FilterChips
                label="Show"
                value={inviteFilter}
                onChange={setInviteFilter}
                options={[
                  { value: "all", label: "All", count: inviteCount("all") },
                  { value: "pending", label: "Waiting", count: inviteCount("pending") },
                  { value: "accepted", label: "Joined", count: inviteCount("accepted") },
                  { value: "expired", label: "Expired", count: inviteCount("expired") },
                ]}
              />
              {shownInvites.length === 0 ? (
                <EmptyState title="None like that" body="No invite for this team is in that state right now." />
              ) : (
                <List aria-label="Invites">
                  {shownInvites.map((invite) => {
                    const status = INVITE_STATUS[invite.status]
                    const isPending = invite.status === "pending"
                    const sent = shortDate(invite.createdAt)
                    const expires = shortDate(invite.expiresAt)
                    const emailInfo = inviteEmailSummary(invite)
                    const busy = busyInviteId === invite.id
                    const items: RowMenuItem[] = isPending
                      ? [
                          ...(invite.email
                            ? [{ label: resendInviteEmailLabel(invite, busy), onSelect: () => void resendInvite(invite), disabled: busy || !canResendInviteEmail(invite) }]
                            : []),
                          { label: "Copy link", onSelect: () => void copyInvite(invite) },
                          { label: "Cancel invite", onSelect: () => setConfirmCancelId(invite.id), danger: true },
                        ]
                      : []
                    return (
                      <ActionRow
                        key={invite.id}
                        data-invite={invite.email}
                        data-invite-status={invite.status}
                        title={<span className="break-all">{invite.name ? `${invite.name}, ${invite.email}` : invite.email || "No email on this invite"}</span>}
                        subtitle={
                          <>
                            {invite.forAthleteId ? "A login for an athlete already on the roster. " : ""}
                            {sent ? `Invited ${sent}` : "Invited"}
                            {isPending && expires ? `, link works until ${expires}` : ""}
                            {isPending ? (
                              <span data-invite-email-status className={emailInfo.problem ? "block font-semibold text-sk-coral-ink" : "block"}>
                                {emailInfo.text}
                              </span>
                            ) : null}
                          </>
                        }
                        trailing={<StatusText tone={status.tone}>{status.label}</StatusText>}
                        actions={items.length > 0 ? <RowMenu label={`More for the invite to ${invite.email}`} items={items} /> : undefined}
                        below={
                          confirmCancelId === invite.id ? (
                            <InlineConfirm
                              question={`Cancel the invite to ${invite.email}? Its link stops working.`}
                              confirmLabel="Cancel invite"
                              cancelLabel="Keep it"
                              busy={busy}
                              onConfirm={() => void cancelInvite(invite)}
                              onCancel={() => setConfirmCancelId(null)}
                            />
                          ) : undefined
                        }
                      />
                    )
                  })}
                </List>
              )}
            </div>
          )}
        </Section>
      )}

      <AddAthletesDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        teamId={teamId}
        teamName={name}
        initialView={addView}
        onInvitesCreated={(created) => {
          setInvites((current) => [...created, ...(current ?? []).filter((item) => !created.some((invite) => invite.id === item.id))])
        }}
        onAthleteAdded={() => void loadRoster()}
      />
    </Screen>
  )
}

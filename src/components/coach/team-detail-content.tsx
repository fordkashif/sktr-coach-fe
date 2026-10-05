"use client"

import { CaretRight, Check, Copy, EnvelopeSimple, LinkSimple, Trash, UserPlus, UsersThree, X } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { EmptyState, Initials, Meter, PageHeader, Panel, ReadinessTag, Segmented, Stat, Tag, scoreTone, type TagTone } from "@/components/sk"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import {
  createAthleteInviteForCurrentCoach,
  getAthleteInvitesForTeam,
  revokeAthleteInviteForCurrentCoach,
  type AthleteInviteStatus,
  type TeamAthleteInvite,
} from "@/lib/data/athlete/invite-data"
import { removeAthleteFromTeamForCurrentCoach } from "@/lib/data/coach/teams-data"
import { getBackendMode } from "@/lib/supabase/config"
import type { Athlete, PR, Team } from "@/lib/mock-data"

function getTeamDisciplineLabel(team: Pick<Team, "disciplines" | "eventGroup"> | null | undefined) {
  if (!team) return ""
  if (team.disciplines?.length) return team.disciplines.join(", ")
  return team.eventGroup
}

function toAbsoluteLink(path: string) {
  return typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function shortDate(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

const INVITE_STATUS: Record<AthleteInviteStatus, { label: string; tone: TagTone }> = {
  pending: { label: "Waiting", tone: "yellow" },
  accepted: { label: "Joined", tone: "green" },
  expired: { label: "Expired", tone: "coral" },
  revoked: { label: "Cancelled", tone: "plain" },
}

/**
 * Athletes removed in this browser session. The coach dashboard snapshot is cached for a short
 * while, so this keeps a removed athlete from flashing back onto the roster before it refreshes.
 */
const removedAthleteIds = new Set<string>()

export function InviteAthleteDialog({
  teamId,
  teamName,
  trigger,
  onCreated,
}: {
  teamId: string
  teamName: string
  trigger: ReactNode
  onCreated?: (invite: TeamAthleteInvite) => void
}) {
  const isSupabaseMode = getBackendMode() === "supabase"
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [expiryDays, setExpiryDays] = useState("7")
  const [created, setCreated] = useState<{ email: string; link: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const reset = () => {
    setEmail("")
    setCreated(null)
    setError(null)
    setCopied(false)
  }

  const createInvite = async () => {
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) return
    setError(null)
    setBusy(true)
    const days = Number.parseInt(expiryDays, 10)
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

    let inviteId: string
    let invitePath: string
    if (isSupabaseMode) {
      const result = await createAthleteInviteForCurrentCoach({ teamId, email: cleanEmail, expiresInDays: days })
      if (!result.ok) {
        setBusy(false)
        setError(result.error.message)
        return
      }
      inviteId = result.data.inviteId
      invitePath = result.data.invitePath
    } else {
      inviteId = Date.now().toString(36)
      invitePath = `/athlete/claim/${teamId}?token=${inviteId}`
    }

    setBusy(false)
    setCopied(false)
    setCreated({ email: cleanEmail, link: toAbsoluteLink(invitePath) })
    onCreated?.({ id: inviteId, email: cleanEmail, status: "pending", createdAt, expiresAt, invitePath })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-5 rounded-[20px] border-sk-line bg-white p-5 shadow-none sm:max-w-md sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <DialogTitle className="sk-h2">Invite an athlete</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-sk-mute">
              They get a personal link to join {teamName}. It works once, for the email you enter.
            </DialogDescription>
          </div>
          <DialogClose className="sk-btn sk-btn-ghost size-11 shrink-0 px-0" aria-label="Close">
            <X className="size-5" weight="bold" />
          </DialogClose>
        </div>

        {created ? (
          <div className="space-y-4">
            <div className="sk-well space-y-3">
              <p className="text-sm text-sk-ink-2">
                Invite ready for <span className="font-bold text-sk-ink">{created.email}</span>. Send them this link.
              </p>
              <input
                readOnly
                aria-label="Invite link"
                value={created.link}
                className="sk-field text-sm"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="sk-btn sk-btn-quiet" onClick={reset}>
                Invite another
              </button>
              <button
                type="button"
                className="sk-btn sk-btn-primary"
                onClick={async () => setCopied(await copyText(created.link))}
              >
                {copied ? <Check className="size-5" weight="bold" /> : <Copy className="size-5" weight="bold" />}
                {copied ? "Link copied" : "Copy link"}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void createInvite()
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor={`invite-email-${teamId}`} className="sk-label">
                Athlete email
              </label>
              <input
                id={`invite-email-${teamId}`}
                type="email"
                required
                autoComplete="off"
                placeholder="athlete@email.com"
                className="sk-field"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`invite-expiry-${teamId}`} className="sk-label">
                Link works for
              </label>
              <select
                id={`invite-expiry-${teamId}`}
                className="sk-field"
                value={expiryDays}
                onChange={(event) => setExpiryDays(event.target.value)}
              >
                <option value="1">24 hours</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
              </select>
            </div>
            {error ? (
              <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end">
              <button type="submit" className="sk-btn sk-btn-primary w-full sm:w-auto" disabled={busy || !email.trim()}>
                <LinkSimple className="size-5" weight="bold" />
                {busy ? "Creating..." : "Create invite link"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export type TeamDetailData = {
  teams: Team[]
  athletes: Athlete[]
  prs: PR[]
}

type CoachTeamDetailContentProps = {
  teamId: string
  data?: TeamDetailData
}

export function CoachTeamDetailContent({ teamId, data }: CoachTeamDetailContentProps) {
  const isSupabaseMode = getBackendMode() === "supabase"
  const [mockData, setMockData] = useState<TeamDetailData>({ teams: [], athletes: [], prs: [] })
  const teamsSource = data?.teams ?? mockData.teams
  const athletesSource = data?.athletes ?? mockData.athletes
  const prsSource = data?.prs ?? mockData.prs
  const [rosterIds, setRosterIds] = useState<string[]>(() =>
    athletesSource
      .filter((athlete) => athlete.teamId === teamId && !removedAthleteIds.has(athlete.id))
      .map((athlete) => athlete.id),
  )
  const [activeTab, setActiveTab] = useState<"roster" | "invites">("roster")
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [invites, setInvites] = useState<TeamAthleteInvite[]>([])
  const [invitesLoading, setInvitesLoading] = useState(isSupabaseMode)
  const [invitesError, setInvitesError] = useState<string | null>(null)
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null)
  const team = teamsSource.find((item) => item.id === teamId)

  useEffect(() => {
    if (isSupabaseMode || data) return
    let cancelled = false

    void import("@/lib/mock-data").then((module) => {
      if (!cancelled) {
        setMockData({
          teams: module.mockTeams,
          athletes: module.mockAthletes,
          prs: module.mockPRs,
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [data, isSupabaseMode])

  useEffect(() => {
    setRosterIds(
      athletesSource
        .filter((athlete) => athlete.teamId === teamId && !removedAthleteIds.has(athlete.id))
        .map((athlete) => athlete.id),
    )
  }, [athletesSource, teamId])

  const loadInvites = useCallback(async () => {
    if (!isSupabaseMode) return
    const result = await getAthleteInvitesForTeam(teamId)
    setInvitesLoading(false)
    if (!result.ok) {
      setInvitesError(result.error.message)
      return
    }
    setInvitesError(null)
    setInvites(result.data)
  }, [isSupabaseMode, teamId])

  useEffect(() => {
    void loadInvites()
  }, [loadInvites])

  if (!team) {
    return null
  }

  const teamAthletes = athletesSource.filter((athlete) => rosterIds.includes(athlete.id))
  const disciplineLabel = getTeamDisciplineLabel(team)
  const athleteIds = new Set(teamAthletes.map((athlete) => athlete.id))
  const readyCount = teamAthletes.filter((athlete) => athlete.readiness === "green").length
  const readinessAlerts = teamAthletes.length - readyCount
  const adherenceRiskCount = teamAthletes.filter((athlete) => athlete.adherence < 75).length
  const averageAdherence =
    teamAthletes.length > 0
      ? Math.round(teamAthletes.reduce((sum, athlete) => sum + athlete.adherence, 0) / teamAthletes.length)
      : null
  const latestPrByAthlete = new Map<string, (typeof prsSource)[number]>()
  for (const pr of prsSource) {
    if (!athleteIds.has(pr.athleteId)) continue
    if (!latestPrByAthlete.has(pr.athleteId)) {
      latestPrByAthlete.set(pr.athleteId, pr)
    }
  }
  const pendingInvites = invites.filter((invite) => invite.status === "pending")

  const removeAthlete = async (athlete: Athlete) => {
    setRosterError(null)
    if (isSupabaseMode) {
      setRemovingId(athlete.id)
      const result = await removeAthleteFromTeamForCurrentCoach({ athleteId: athlete.id, teamId })
      setRemovingId(null)
      if (!result.ok) {
        setRosterError(`Could not remove ${athlete.name}: ${result.error.message}`)
        return
      }
      removedAthleteIds.add(athlete.id)
    }
    setConfirmRemoveId(null)
    setRosterIds((current) => current.filter((id) => id !== athlete.id))
  }

  const revokeInvite = async (invite: TeamAthleteInvite) => {
    setInvitesError(null)
    if (isSupabaseMode) {
      setRevokingInviteId(invite.id)
      const result = await revokeAthleteInviteForCurrentCoach(invite.id)
      setRevokingInviteId(null)
      if (!result.ok) {
        setInvitesError(result.error.message)
        void loadInvites()
        return
      }
    }
    setInvites((current) => current.map((item) => (item.id === invite.id ? { ...item, status: "revoked" } : item)))
  }

  const copyInvite = async (invite: TeamAthleteInvite) => {
    if (await copyText(toAbsoluteLink(invite.invitePath))) {
      setCopiedInviteId(invite.id)
      window.setTimeout(() => setCopiedInviteId((current) => (current === invite.id ? null : current)), 2000)
    }
  }

  const onInviteCreated = (invite: TeamAthleteInvite) => {
    setInvites((current) => [invite, ...current.filter((item) => item.id !== invite.id)])
    setActiveTab("invites")
  }

  const rosterCount = teamAthletes.length
  const lede =
    rosterCount === 0
      ? `${disciplineLabel}. Nobody on the roster yet, so invite your first athlete.`
      : `${disciplineLabel}. ${rosterCount} ${rosterCount === 1 ? "athlete" : "athletes"}, ${
          readinessAlerts === 0 ? "all ready to train" : `${readinessAlerts} to check on`
        }.`

  const inviteButton = (label: string, className: string) => (
    <InviteAthleteDialog
      teamId={teamId}
      teamName={team.name}
      onCreated={onInviteCreated}
      trigger={
        <button type="button" className={className}>
          <UserPlus className="size-5" weight="bold" />
          {label}
        </button>
      }
    />
  )

  return (
    <div className="sk-page">
      <PageHeader title={team.name} lede={lede} actions={inviteButton("Invite athlete", "sk-btn sk-btn-primary")} />

      <section aria-label="Team at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Athletes" value={rosterCount} hint="On the roster" />
        <Stat
          tone="blue"
          label="Plan adherence"
          value={averageAdherence ?? "0"}
          unit="%"
          hint={
            averageAdherence === null
              ? "No athletes yet"
              : adherenceRiskCount > 0
                ? `${adherenceRiskCount} under 75%`
                : "Everyone above 75%"
          }
        />
        <Stat tone="green" label="Ready to train" value={readyCount} hint={`of ${rosterCount}`} />
        <Stat
          tone={readinessAlerts > 0 ? "coral" : "plain"}
          label="Need a look"
          value={readinessAlerts}
          hint={readinessAlerts > 0 ? "Watch or review" : "Nobody flagged"}
        />
      </section>

      <Segmented
        label="Team sections"
        value={activeTab}
        onChange={setActiveTab}
        options={[
          { value: "roster", label: "Roster" },
          {
            value: "invites",
            label: pendingInvites.length > 0 ? `Invites (${pendingInvites.length})` : "Invites",
          },
        ]}
      />

      {activeTab === "roster" ? (
        <Panel title="Roster" hint={rosterCount > 0 ? "Tap an athlete to open their profile." : undefined}>
          {rosterError ? (
            <p role="alert" className="mb-3 rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
              {rosterError}
            </p>
          ) : null}
          {rosterCount === 0 ? (
            <EmptyState
              icon={<UsersThree className="size-6" weight="fill" />}
              title="No athletes yet"
              body="Athletes show up here with their readiness and adherence as soon as they accept an invite."
              action={inviteButton("Invite athlete", "sk-btn sk-btn-ink sk-btn-sm")}
              className="border-0 bg-sk-canvas"
            />
          ) : (
            <ul>
              {teamAthletes.map((athlete) => {
                const pr = latestPrByAthlete.get(athlete.id)
                const confirming = confirmRemoveId === athlete.id
                return (
                  <li key={athlete.id} className="border-b border-sk-line last:border-b-0">
                    <div className="flex items-center gap-1 sm:gap-3">
                      <Link
                        to={`/coach/athletes/${athlete.id}`}
                        className="group grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 rounded-xl py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue md:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_minmax(140px,200px)_84px_auto]"
                      >
                        <Initials name={athlete.name} />
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-sk-ink group-hover:text-sk-blue">{athlete.name}</span>
                          <span className="block truncate text-sm text-sk-mute">{athlete.primaryEvent}</span>
                        </span>
                        <span className="col-span-3 row-start-3 min-w-0 text-sm md:col-span-1 md:row-start-auto">
                          <span className="text-sk-mute">Latest PR </span>
                          {pr ? (
                            <span className="font-semibold text-sk-ink">
                              {pr.event} {pr.bestValue}
                            </span>
                          ) : (
                            <span className="text-sk-mute">not logged yet</span>
                          )}
                        </span>
                        <span className="col-span-3 row-start-2 md:col-span-1 md:row-start-auto">
                          <span className="mb-1.5 flex items-baseline justify-between text-sm">
                            <span className="text-sk-mute">Adherence</span>
                            <span className="font-bold tabular-nums text-sk-ink">{athlete.adherence}%</span>
                          </span>
                          <Meter value={athlete.adherence} tone={scoreTone(athlete.adherence)} />
                        </span>
                        <span className="col-start-3 row-start-1 justify-self-end md:col-start-auto md:row-start-auto md:justify-self-start">
                          <ReadinessTag status={athlete.readiness} />
                        </span>
                        <CaretRight className="hidden size-4 text-sk-mute group-hover:text-sk-blue md:block" weight="bold" />
                      </Link>
                      <button
                        type="button"
                        className="sk-btn sk-btn-ghost size-11 shrink-0 self-start px-0 hover:bg-sk-coral-tint hover:text-[#c7300f] max-md:mt-3.5 md:self-center"
                        aria-label={`Remove ${athlete.name} from ${team.name}`}
                        aria-expanded={confirming}
                        onClick={() => setConfirmRemoveId(confirming ? null : athlete.id)}
                      >
                        <Trash className="size-5" weight="bold" />
                      </button>
                    </div>
                    {confirming ? (
                      <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-sk-coral-tint p-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-sk-ink">
                          <span className="font-bold">Remove {athlete.name} from {team.name}?</span> They keep their account and training history.
                        </p>
                        <div className="flex shrink-0 gap-2">
                          <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm" onClick={() => setConfirmRemoveId(null)}>
                            Keep
                          </button>
                          <button
                            type="button"
                            className="sk-btn sk-btn-danger sk-btn-sm"
                            disabled={removingId === athlete.id}
                            onClick={() => void removeAthlete(athlete)}
                          >
                            {removingId === athlete.id ? "Removing..." : "Remove from roster"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      ) : (
        <Panel
          title="Invites"
          hint="Every invite link you have created for this team, newest first."
        >
          {invitesError ? (
            <p role="alert" className="mb-3 rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
              Could not update invites: {invitesError}
            </p>
          ) : null}
          {invitesLoading ? (
            <p className="py-6 text-sm text-sk-mute">Loading invites...</p>
          ) : invites.length === 0 ? (
            <EmptyState
              icon={<EnvelopeSimple className="size-6" weight="fill" />}
              title="No invites sent yet"
              body="Create an invite link for an athlete and it appears here, so you can see who has joined and who is still waiting."
              action={inviteButton("Invite athlete", "sk-btn sk-btn-ink sk-btn-sm")}
              className="border-0 bg-sk-canvas"
            />
          ) : (
            <ul>
              {invites.map((invite) => {
                const status = INVITE_STATUS[invite.status]
                const sent = shortDate(invite.createdAt)
                const expires = shortDate(invite.expiresAt)
                const isPending = invite.status === "pending"
                return (
                  <li
                    key={invite.id}
                    className="flex flex-col gap-3 border-b border-sk-line py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3 sm:flex-1">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-sk-ink">{invite.email || "No email on this invite"}</p>
                        <p className="truncate text-sm text-sk-mute">
                          {sent ? `Sent ${sent}` : "Sent"}
                          {isPending && expires ? `, link works until ${expires}` : ""}
                        </p>
                      </div>
                      <Tag tone={status.tone} className="shrink-0">{status.label}</Tag>
                    </div>
                    {isPending ? (
                      <div className="flex shrink-0 gap-2">
                        <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm max-sm:h-11 max-sm:flex-1" onClick={() => void copyInvite(invite)}>
                          {copiedInviteId === invite.id ? <Check className="size-4" weight="bold" /> : <Copy className="size-4" weight="bold" />}
                          {copiedInviteId === invite.id ? "Copied" : "Copy link"}
                        </button>
                        <button
                          type="button"
                          className="sk-btn sk-btn-ghost sk-btn-sm max-sm:h-11 max-sm:flex-1"
                          disabled={revokingInviteId === invite.id}
                          onClick={() => void revokeInvite(invite)}
                        >
                          {revokingInviteId === invite.id ? "Cancelling..." : "Cancel invite"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  )
}

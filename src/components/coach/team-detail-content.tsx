"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, FilePasteIcon, Link01Icon, QrCodeIcon } from "@hugeicons/core-free-icons"
import { Link } from "react-router-dom"
import { useState } from "react"
import { ReadinessBadge } from "@/components/badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { createAthleteInviteForCurrentCoach } from "@/lib/data/athlete/invite-data"
import { getBackendMode } from "@/lib/supabase/config"
import {
  getTeamDisciplineLabel,
  mockAthletes,
  mockPRs,
  mockTeams,
  onGenerateInvite,
  type Athlete,
  type PR,
  type Team,
} from "@/lib/mock-data"
import { cn } from "@/lib/utils"

function AthleteReadinessPill({ readiness }: { readiness: "green" | "yellow" | "red" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold",
        readiness === "green" && "bg-[#eef5ff] text-[#1f5fd1] ring-1 ring-[#cfe2ff]",
        readiness === "yellow" && "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
        readiness === "red" && "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          readiness === "green" && "bg-[#1f8cff]",
          readiness === "yellow" && "bg-amber-500",
          readiness === "red" && "bg-rose-500",
        )}
      />
      {readiness === "green" ? "Ready" : readiness === "yellow" ? "Watch" : "Review"}
    </span>
  )
}

function AthleteStatusPill() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
      <span className="size-2 rounded-full bg-cyan-300" />
      On roster
    </span>
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
  const teamsSource = data?.teams ?? mockTeams
  const athletesSource = data?.athletes ?? mockAthletes
  const prsSource = data?.prs ?? mockPRs
  const [rosterIds, setRosterIds] = useState<string[]>(() =>
    athletesSource.filter((athlete) => athlete.teamId === teamId).map((athlete) => athlete.id),
  )
  const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("roster")
  const team = teamsSource.find((item) => item.id === teamId)
  const inviteLink = generatedInviteLink ?? `/athlete/join/${teamId}`

  if (!team) {
    return null
  }

  const teamAthletes = athletesSource.filter((athlete) => rosterIds.includes(athlete.id))
  const disciplineLabel = getTeamDisciplineLabel(team)
  const athleteIds = new Set(teamAthletes.map((athlete) => athlete.id))
  const readinessAlerts = teamAthletes.filter((athlete) => athlete.readiness !== "green").length
  const adherenceRiskCount = teamAthletes.filter((athlete) => athlete.adherence < 75).length
  const averageAdherence =
    teamAthletes.length > 0
      ? Math.round(teamAthletes.reduce((sum, athlete) => sum + athlete.adherence, 0) / teamAthletes.length)
      : 0
  const heroImage = team.eventGroup === "Throws" ? "/rotational.png" : null
  const latestPrByAthlete = new Map<string, (typeof prsSource)[number]>()
  for (const pr of prsSource) {
    if (!athleteIds.has(pr.athleteId)) continue
    if (!latestPrByAthlete.has(pr.athleteId)) {
      latestPrByAthlete.set(pr.athleteId, pr)
    }
  }

  return (
    <div className="space-y-6 px-4 pb-8 pt-4 sm:px-6 sm:pb-10 sm:pt-6 lg:px-8">
      <section className="relative pt-2 lg:pt-6">
        <div className="relative overflow-visible">
          <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,#0a1730_0%,#102647_45%,#2f5fb6_100%)] text-white shadow-[0_24px_80px_rgba(5,12,24,0.28)]">
            {heroImage ? (
              <>
                <div className="absolute right-[-6%] top-1/2 h-[82%] w-[50%] -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.08)_42%,transparent_72%)] blur-2xl" />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,23,48,0.98)_0%,rgba(10,23,48,0.93)_46%,rgba(10,23,48,0.58)_68%,rgba(10,23,48,0.18)_100%)]" />
                <div className="absolute inset-y-0 right-0 hidden w-[34%] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.05)_100%)] lg:block" />
              </>
            ) : null}
            <div className="relative grid gap-6 px-5 py-5 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,420px)] lg:px-8 lg:py-9 xl:px-10">
              <div className="space-y-3 lg:space-y-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6fb6ff]">{disciplineLabel}</p>
                <h1 className="max-w-[10ch] text-[clamp(2rem,8vw,4.7rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-white">
                  {team.name}
                </h1>
                <p className="hidden max-w-[58ch] text-sm leading-7 text-white/72 sm:text-base lg:block">
                  Operational roster and invite management for this group. Review athlete status, remove roster members,
                  and generate invite access without leaving the team workspace.
                </p>
              </div>

              <div className="hidden rounded-[28px] border border-white/12 bg-white/[0.08] p-5 backdrop-blur-sm lg:block lg:self-end">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6fb6ff]">Current state</p>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3 text-sm text-white/72">
                    <span>Roster size</span>
                    <span className="font-semibold text-white">{teamAthletes.length}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3 text-sm text-white/72">
                    <span>Readiness alerts</span>
                    <span className="font-semibold text-white">{readinessAlerts}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm text-white/72">
                    <span>Adherence avg.</span>
                    <span className="font-semibold text-white">{averageAdherence}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {heroImage ? (
            <div className="pointer-events-none absolute bottom-[-24%] right-[-8%] z-20 h-[138%] w-[64%] sm:bottom-[-24%] sm:right-[-5%] sm:h-[146%] sm:w-[52%] lg:bottom-[-34%] lg:right-[0%] lg:h-[182%] lg:w-[38%]">
              <img
                src={heroImage}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-contain object-bottom drop-shadow-[0_34px_48px_rgba(6,16,29,0.42)]"
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="hidden lg:block">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.05)]">
            <div className="space-y-1 border-b border-slate-200 pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Roster State</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Group Snapshot</h2>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                { label: "Roster", value: teamAthletes.length, body: "athletes in scope" },
                { label: "Alerts", value: readinessAlerts, body: "need review" },
                { label: "Plan Adherence", value: `${averageAdherence}%`, body: `${adherenceRiskCount} under 75% adherence` },
              ].map((item) => (
                <div key={item.label} className="rounded-[20px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{item.value}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[28px] border border-[#d7e5f8] bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="space-y-1 border-b border-slate-200 pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Coaching Focus</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Attention Areas</h2>
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-[20px] border border-[#d7e5f8] bg-white px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Readiness</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">
                  {readinessAlerts > 0 ? `${readinessAlerts} athlete${readinessAlerts === 1 ? "" : "s"} flagged` : "No active readiness flags"}
                </p>
              </div>
              <div className="rounded-[20px] border border-[#d7e5f8] bg-white px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Invites</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">Generate access without leaving the group</p>
                <p className="mt-1 text-sm text-slate-500">Use the invite tab to issue links for new athletes.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto rounded-[22px] border border-slate-200 bg-white p-2 shadow-[0_12px_28px_rgba(15,23,42,0.04)] sm:w-auto">
          <TabsTrigger value="roster" className="rounded-full px-4 py-2.5 data-[state=active]:bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_22px_rgba(31,140,255,0.22)]">
            Roster
          </TabsTrigger>
          <TabsTrigger value="invites" className="rounded-full px-4 py-2.5 data-[state=active]:bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_22px_rgba(31,140,255,0.22)]">
            Invites
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="mt-0">
          <section className="space-y-4 px-2 py-1">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">Roster</h2>
                <p className="mt-1 text-sm text-slate-500">Manage athletes, check status, and open athlete detail.</p>
              </div>
            </div>

            <div className="space-y-3 md:hidden">
              {teamAthletes.map((athlete) => (
                <div
                  key={athlete.id}
                  className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_14px_36px_rgba(15,23,42,0.05)]"
                >
                  <Link
                    to={`/coach/athletes/${athlete.id}`}
                    className="block p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0d172b_0%,#315fb9_100%)] text-sm font-semibold text-white shadow-[0_10px_24px_rgba(19,104,255,0.16)]">
                          {athlete.name
                            .split(" ")
                            .map((part) => part[0])
                            .slice(0, 2)
                            .join("")}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-950">{athlete.name}</p>
                          <p className="text-sm text-slate-500">Age {athlete.age} | {athlete.eventGroup}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <AthleteReadinessPill readiness={athlete.readiness} />
                        <div className="flex size-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-colors group-hover:bg-slate-200">
                          <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 rounded-[22px] bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Primary event</p>
                          <p className="mt-1 text-base font-medium text-slate-800">{athlete.primaryEvent}</p>
                        </div>
                        <AthleteStatusPill />
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Latest PR</p>
                          <p className="mt-1 text-sm text-slate-600">
                          PR:{" "}
                          {latestPrByAthlete.get(athlete.id)
                            ? `${latestPrByAthlete.get(athlete.id)?.event} ${latestPrByAthlete.get(athlete.id)?.bestValue}`
                            : "No PR yet"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Plan Adherence</p>
                          <p className="mt-1 text-sm font-medium text-slate-700">{athlete.adherence}%</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>

            <div className="hidden overflow-hidden rounded-[24px] border border-slate-200 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Athlete</TableHead>
                    <TableHead>Events</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Readiness</TableHead>
                    <TableHead>Plan Adherence</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamAthletes.map((athlete) => (
                    <TableRow key={athlete.id}>
                      <TableCell className="font-medium">{athlete.name}</TableCell>
                      <TableCell>{athlete.primaryEvent}</TableCell>
                      <TableCell>
                        <Badge variant={athlete.readiness === "red" ? "destructive" : "secondary"}>
                          {athlete.readiness === "red" ? "Needs Review" : "Active"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ReadinessBadge status={athlete.readiness} />
                      </TableCell>
                      <TableCell>{athlete.adherence}%</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button asChild variant="outline" size="sm" className="rounded-full border-slate-200 px-4 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950">
                            <Link to={`/coach/athletes/${athlete.id}`}>Open</Link>
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="rounded-full px-4"
                            onClick={() => setRosterIds((current) => current.filter((id) => id !== athlete.id))}
                          >
                            Remove
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="invites" className="mt-0">
          <section className="space-y-5 px-0 py-1">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">Invites</h2>
                <p className="mt-1 text-sm text-slate-500">Generate and share temporary invite access for new roster additions.</p>
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <Button type="button" className="h-12 rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#2f80ff_100%)] px-5 text-white shadow-[0_12px_32px_rgba(28,101,255,0.22)] hover:opacity-95">
                    <HugeiconsIcon icon={Link01Icon} className="size-4" />
                    Generate invite
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invite athletes to {team.name}</DialogTitle>
                    <DialogDescription>Copy link or share the QR code placeholder.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="detail-invite-link">Invite link</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="detail-invite-link"
                          value={generatedInviteLink ?? inviteLink}
                          readOnly
                          className="text-slate-950 selection:bg-[#dbeafe] selection:text-slate-950"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => navigator.clipboard.writeText(generatedInviteLink ?? inviteLink)}
                          aria-label="Copy invite link"
                        >
                          <HugeiconsIcon icon={FilePasteIcon} className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                      <HugeiconsIcon icon={QrCodeIcon} className="mx-auto mb-2 size-6" />
                      QR Code
                    </div>

                    <div className="space-y-2">
                      <Label>Invite expiration</Label>
                      <Select defaultValue="7d">
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="24h">24h</SelectItem>
                          <SelectItem value="7d">7d</SelectItem>
                          <SelectItem value="30d">30d</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
                      onClick={async () => {
                        setInviteError(null)
                        if (isSupabaseMode) {
                          const result = await createAthleteInviteForCurrentCoach({ teamId, expiresInDays: 7 })
                          if (!result.ok) {
                            setInviteError(result.error.message)
                            return
                          }
                          setGeneratedInviteLink(result.data.invitePath)
                          return
                        }
                        onGenerateInvite()
                        setGeneratedInviteLink(`/invite/${teamId}?token=${Date.now().toString(36)}`)
                      }}
                    >
                      Generate Invite
                    </Button>
                  </DialogFooter>
                  {inviteError ? <p className="text-sm text-rose-600">{inviteError}</p> : null}
                </DialogContent>
              </Dialog>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Status</p>
              <p className="mt-3 text-sm text-slate-600">
                {generatedInviteLink ? "Latest invite generated and ready to share." : "No active invites yet."}
              </p>
              {generatedInviteLink ? (
                <div className="mt-4 rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                  {generatedInviteLink}
                </div>
              ) : null}
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}

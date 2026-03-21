"use client"

import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, CheckmarkCircle02Icon, QrCodeIcon, SearchAddIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { acceptAthleteInviteForCurrentUser, getAthleteInvitePreviewForCurrentUser } from "@/lib/data/athlete/invite-data"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { getTeamDisciplineLabel, mockTeams } from "@/lib/mock-data"

const JOIN_TEAM_STORAGE_KEY = "pacelab:join-team-state"

function normalizeInviteCode(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ""

  try {
    const parsedUrl = new URL(trimmed)
    const codeFromPath = parsedUrl.pathname.split("/").filter(Boolean).at(-1)
    const codeFromQuery = parsedUrl.searchParams.get("code")
    return (codeFromQuery ?? codeFromPath ?? "").trim().toLowerCase()
  } catch {
    if (trimmed.includes("/")) {
      return trimmed.split("/").filter(Boolean).at(-1)?.trim().toLowerCase() ?? ""
    }
    return trimmed.toLowerCase()
  }
}

type JoinState = {
  joinedTeamId: string | null
  joinedTeamName: string | null
  joinedGroup: string | null
  joinedAt: string | null
}

function loadStoredJoinState(): JoinState {
  if (typeof window === "undefined") {
    return { joinedTeamId: null, joinedTeamName: null, joinedGroup: null, joinedAt: null }
  }

  try {
    const stored = window.localStorage.getItem(tenantStorageKey(JOIN_TEAM_STORAGE_KEY))
    if (!stored) return { joinedTeamId: null, joinedTeamName: null, joinedGroup: null, joinedAt: null }
    return {
      joinedTeamId: null,
      joinedTeamName: null,
      joinedGroup: null,
      joinedAt: null,
      ...(JSON.parse(stored) as Partial<JoinState>),
    }
  } catch {
    return { joinedTeamId: null, joinedTeamName: null, joinedGroup: null, joinedAt: null }
  }
}

export function JoinTeamForm({ initialCode = "" }: { initialCode?: string }) {
  const isSupabaseMode = getBackendMode() === "supabase"
  const [inviteInput, setInviteInput] = useState(initialCode)
  const [joinState, setJoinState] = useState<JoinState>(() => loadStoredJoinState())
  const [joinError, setJoinError] = useState<string | null>(null)
  const [resolvingInvite, setResolvingInvite] = useState(false)
  const [supabaseInvite, setSupabaseInvite] = useState<{
    inviteId: string
    teamId: string
    teamName: string
    eventGroup: string | null
    status: "pending" | "accepted" | "expired" | "revoked"
  } | null>(null)

  useEffect(() => {
    if (!initialCode) return
    setInviteInput(initialCode)
  }, [initialCode])

  const normalizedCode = useMemo(() => normalizeInviteCode(inviteInput), [inviteInput])
  const hasTypedInvite = inviteInput.trim().length > 0

  useEffect(() => {
    if (!isSupabaseMode) return
    if (!normalizedCode) {
      setSupabaseInvite(null)
      setJoinError(null)
      return
    }

    let cancelled = false

    const loadInvite = async () => {
      setResolvingInvite(true)
      const result = await getAthleteInvitePreviewForCurrentUser(normalizedCode)
      if (cancelled) return

      if (!result.ok) {
        setSupabaseInvite(null)
        setJoinError(result.error.message)
        setResolvingInvite(false)
        return
      }

      setSupabaseInvite(result.data)
      setJoinError(null)
      setResolvingInvite(false)
    }

    void loadInvite()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode, normalizedCode])

  const mockMatch = useMemo(
    () => mockTeams.find((team) => team.id.toLowerCase() === normalizedCode) ?? null,
    [normalizedCode],
  )

  const resolvedInvite = useMemo(() => {
    if (isSupabaseMode) {
      if (!supabaseInvite) return null
      return {
        inviteId: supabaseInvite.inviteId,
        teamId: supabaseInvite.teamId,
        name: supabaseInvite.teamName,
        group: supabaseInvite.eventGroup ?? "Sprint",
        athleteCount: null as number | null,
      }
    }

    if (!mockMatch) return null
    return {
      inviteId: mockMatch.id,
      teamId: mockMatch.id,
      name: mockMatch.name,
      group: getTeamDisciplineLabel(mockMatch),
      athleteCount: mockMatch.athleteCount,
    }
  }, [isSupabaseMode, mockMatch, supabaseInvite])

  const joinedMockTeam = mockTeams.find((team) => team.id === joinState.joinedTeamId) ?? null

  const handleJoin = async () => {
    if (!resolvedInvite) return

    if (isSupabaseMode) {
      const acceptResult = await acceptAthleteInviteForCurrentUser(resolvedInvite.inviteId)
      if (!acceptResult.ok) {
        setJoinError(acceptResult.error.message)
        return
      }
    }

    const nextState: JoinState = {
      joinedTeamId: resolvedInvite.teamId,
      joinedTeamName: resolvedInvite.name,
      joinedGroup: resolvedInvite.group,
      joinedAt: new Date().toLocaleString(),
    }

    window.localStorage.setItem(tenantStorageKey(JOIN_TEAM_STORAGE_KEY), JSON.stringify(nextState))
    setJoinState(nextState)
    setJoinError(null)
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="mobile-hero-surface">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mobile-pill-accent">Team Invite</span>
            <span className="mobile-pill-muted">Code, link, or deep link</span>
          </div>
          <h1 className="mobile-hero-title">Join Team</h1>
          <p className="mobile-hero-copy">
            Open an invite link, paste a code, or route in from a mobile deep link and confirm the team before joining.
          </p>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <Card className="mobile-card-primary">
          <CardContent className="space-y-5 p-4 sm:p-5">
            <div className="mobile-surface-heading">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Invite Entry</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">Paste Link or Code</h2>
              <p className="mt-1 text-sm text-slate-500">Links with <code>/athlete/join/{"{inviteId}"}</code> resolve to this same confirmation flow.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-code" className="text-sm font-medium text-slate-950">
                Invite link or code
              </Label>
              <Input
                id="invite-code"
                placeholder="https://pacelab.app/athlete/join/<invite-id>"
                value={inviteInput}
                onChange={(event) => setInviteInput(event.target.value)}
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50 text-slate-950"
              />
            </div>

            {joinError ? <div className="rounded-[16px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{joinError}</div> : null}

            <div className="mobile-card-utility">
              {resolvedInvite ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#1f5fd1]">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
                    Invite recognized
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Team</p>
                      <p className="mt-1 text-base font-semibold text-slate-950">{resolvedInvite.name}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Group</p>
                      <p className="mt-1 text-base font-semibold text-slate-950">{resolvedInvite.group}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Athletes</p>
                      <p className="mt-1 text-base font-semibold text-slate-950">{resolvedInvite.athleteCount ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Invite Code</p>
                      <p className="mt-1 text-base font-semibold uppercase text-slate-950">{resolvedInvite.inviteId}</p>
                    </div>
                  </div>
                </div>
              ) : hasTypedInvite ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-rose-600">
                    <HugeiconsIcon icon={SearchAddIcon} className="size-4" />
                    {resolvingInvite ? "Checking invite..." : "Invite not recognized"}
                  </div>
                  <p className="text-sm text-slate-500">Check the code or open the full invite link again.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <HugeiconsIcon icon={QrCodeIcon} className="size-4" />
                    Waiting for invite
                  </div>
                  <p className="text-sm text-slate-500">Paste the invite or open the deep link to confirm team access.</p>
                </div>
              )}
            </div>

            <Button type="button" className="mobile-action-primary h-12 w-full" disabled={!resolvedInvite} onClick={handleJoin}>
              Confirm and join team
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="mobile-card-primary">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="mobile-surface-heading">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Deep Link Path</p>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">Mobile Flow</h2>
              </div>
              <div className="mobile-card-utility text-sm text-slate-600">
                Invite links should follow the <code>/athlete/join/{"{inviteId}"}</code> pattern and resolve directly in this view.
              </div>
            </CardContent>
          </Card>

          <Card className="mobile-card-primary">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="mobile-surface-heading">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Confirmation</p>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">Join State</h2>
              </div>

              {joinState.joinedAt ? (
                <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
                    Joined {isSupabaseMode ? joinState.joinedTeamName : joinedMockTeam?.name}
                  </div>
                  <p className="mt-2 text-sm text-emerald-700/80">
                    Confirmed {joinState.joinedAt}. Your athlete view can now use this team for plan, progress, and testing context.
                  </p>
                </div>
              ) : (
                <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                  <p className="text-sm text-slate-500">No team joined yet. Recognize the invite first, then confirm.</p>
                </div>
              )}

              <div className="grid gap-3">
                <Button asChild variant="outline" className="mobile-action-secondary justify-between">
                  <Link to="/athlete/home">
                    Open today
                    <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="mobile-action-secondary justify-between">
                  <Link to="/athlete/training-plan">
                    Open plan
                    <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}

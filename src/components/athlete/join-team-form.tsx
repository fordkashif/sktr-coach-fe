"use client"

import { useEffect, useId, useMemo, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, CheckCircle, UsersThree, WarningCircle } from "@phosphor-icons/react"
import { Initials, PageHeader, Panel } from "@/components/sk"
import { acceptAthleteInviteForCurrentUser, getAthleteInvitePreviewForCurrentUser } from "@/lib/data/athlete/invite-data"
import {
  MOCK_ATHLETE_ID,
  eventGroupLabel,
  getCurrentAthleteTeam,
} from "@/lib/data/athlete/profile-data"
import type { Team } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

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

const emptyJoinState: JoinState = { joinedTeamId: null, joinedTeamName: null, joinedGroup: null, joinedAt: null }

function loadStoredJoinState(): JoinState {
  if (typeof window === "undefined") return emptyJoinState

  try {
    const stored = window.localStorage.getItem(tenantStorageKey(JOIN_TEAM_STORAGE_KEY))
    if (!stored) return emptyJoinState
    return { ...emptyJoinState, ...(JSON.parse(stored) as Partial<JoinState>) }
  } catch {
    return emptyJoinState
  }
}

type InviteStatus = "pending" | "accepted" | "expired" | "revoked"

type ResolvedInvite = {
  inviteId: string
  teamId: string
  name: string
  group: string | null
  athleteCount: number | null
  status: InviteStatus
  /** The invite was sent to a different email address than the one signed in. */
  addressedToSomeoneElse?: boolean
}

type Problem = { title: string; body: string }

const PROBLEMS = {
  invalid: {
    title: "We could not find that invite",
    body: "Check the code for typos, or open the invite link your coach sent you again.",
  },
  expired: {
    title: "This invite has expired",
    body: "Invites only last a few days. Ask your coach to send you a new one.",
  },
  used: {
    title: "This invite has already been used",
    body: "Each invite works once. If that was not you, ask your coach for a new one.",
  },
  revoked: {
    title: "Your coach cancelled this invite",
    body: "Ask your coach to send you a new one.",
  },
  wrongEmail: {
    title: "This invite is for a different email",
    body: "Sign in with the email address the invite was sent to, or ask your coach to invite this one.",
  },
  wrongClub: {
    title: "This invite is for a different club",
    body: "Your account belongs to another club, so it cannot join this team.",
  },
} satisfies Record<string, Problem>

function problemForStatus(status: InviteStatus): Problem | null {
  if (status === "expired") return PROBLEMS.expired
  if (status === "accepted") return PROBLEMS.used
  if (status === "revoked") return PROBLEMS.revoked
  return null
}

/** Turns the accept_athlete_invite database errors into something an athlete can act on. */
function problemForAcceptError(message: string): Problem {
  const text = message.toLowerCase()
  if (text.includes("expired")) return PROBLEMS.expired
  if (text.includes("not pending")) return PROBLEMS.used
  if (text.includes("different email")) return PROBLEMS.wrongEmail
  if (text.includes("tenant")) return PROBLEMS.wrongClub
  if (text.includes("not found")) return PROBLEMS.invalid
  return { title: "We could not add you to this team", body: message }
}

export function JoinTeamForm({ initialCode = "" }: { initialCode?: string }) {
  const isSupabaseMode = getBackendMode() === "supabase"
  const formId = useId()
  const [inviteInput, setInviteInput] = useState(initialCode)
  const [joinState, setJoinState] = useState<JoinState>(() => loadStoredJoinState())
  const [joinedNow, setJoinedNow] = useState<{ name: string } | null>(null)
  const [lookupProblem, setLookupProblem] = useState<Problem | null>(null)
  const [joinProblem, setJoinProblem] = useState<Problem | null>(null)
  const [resolvingInvite, setResolvingInvite] = useState(false)
  const [joining, setJoining] = useState(false)
  const [supabaseInvite, setSupabaseInvite] = useState<ResolvedInvite | null>(null)
  const [supabaseTeam, setSupabaseTeam] = useState<{ teamId: string | null; teamName: string | null } | null>(null)
  const [mockTeams, setMockTeams] = useState<Team[] | null>(null)
  const [mockAthleteTeamId, setMockAthleteTeamId] = useState<string | null>(null)

  useEffect(() => {
    if (!initialCode) return
    setInviteInput(initialCode)
  }, [initialCode])

  const normalizedCode = useMemo(() => normalizeInviteCode(inviteInput), [inviteInput])
  const hasTypedInvite = inviteInput.trim().length > 0

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false
    void getCurrentAthleteTeam().then((result) => {
      if (!cancelled && result.ok) setSupabaseTeam(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  useEffect(() => {
    if (!isSupabaseMode) return
    setJoinProblem(null)
    if (!normalizedCode) {
      setSupabaseInvite(null)
      setLookupProblem(null)
      setResolvingInvite(false)
      return
    }

    let cancelled = false
    setResolvingInvite(true)

    const loadInvite = async () => {
      const result = await getAthleteInvitePreviewForCurrentUser(normalizedCode)
      if (cancelled) return

      if (!result.ok) {
        setSupabaseInvite(null)
        setLookupProblem(
          result.error.code === "NOT_FOUND" || result.error.code === "VALIDATION"
            ? PROBLEMS.invalid
            : { title: "We could not check that invite", body: result.error.message },
        )
        setResolvingInvite(false)
        return
      }

      setSupabaseInvite({
        inviteId: result.data.inviteId,
        teamId: result.data.teamId,
        name: result.data.teamName,
        group: result.data.eventGroup,
        athleteCount: null,
        status: result.data.status,
        addressedToSomeoneElse: result.data.addressedToSomeoneElse,
      })
      setLookupProblem(null)
      setResolvingInvite(false)
    }

    // Wait for typing to settle before asking the server.
    const timer = window.setTimeout(() => void loadInvite(), 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [isSupabaseMode, normalizedCode])

  useEffect(() => {
    if (isSupabaseMode) return
    let cancelled = false

    void import("@/lib/mock-data").then((module) => {
      if (cancelled) return
      setMockTeams(module.mockTeams)
      setMockAthleteTeamId(module.mockAthletes.find((athlete) => athlete.id === MOCK_ATHLETE_ID)?.teamId ?? null)
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  useEffect(() => {
    if (!isSupabaseMode) setJoinProblem(null)
  }, [isSupabaseMode, normalizedCode])

  const resolvedInvite = useMemo<ResolvedInvite | null>(() => {
    if (isSupabaseMode) return supabaseInvite

    const mockMatch = mockTeams?.find((team) => team.id.toLowerCase() === normalizedCode) ?? null
    if (!mockMatch) return null
    return {
      inviteId: mockMatch.id,
      teamId: mockMatch.id,
      name: mockMatch.name,
      group: mockMatch.eventGroup,
      athleteCount: mockMatch.athleteCount,
      status: "pending",
    }
  }, [isSupabaseMode, mockTeams, normalizedCode, supabaseInvite])

  const currentTeam = useMemo(() => {
    if (isSupabaseMode) {
      return supabaseTeam?.teamId ? { id: supabaseTeam.teamId, name: supabaseTeam.teamName ?? "Your team" } : null
    }
    const teamId = joinState.joinedTeamId ?? mockAthleteTeamId
    const team = mockTeams?.find((item) => item.id === teamId) ?? null
    return team ? { id: team.id, name: team.name } : null
  }, [isSupabaseMode, joinState.joinedTeamId, mockAthleteTeamId, mockTeams, supabaseTeam])

  const isChecking = hasTypedInvite && (isSupabaseMode ? resolvingInvite : mockTeams === null)
  const alreadyOnTeam = Boolean(resolvedInvite && currentTeam && resolvedInvite.teamId === currentTeam.id)
  const statusProblem =
    resolvedInvite && !alreadyOnTeam
      ? problemForStatus(resolvedInvite.status) ?? (resolvedInvite.addressedToSomeoneElse ? PROBLEMS.wrongEmail : null)
      : null
  const notFoundProblem =
    hasTypedInvite && !isChecking && !resolvedInvite ? (isSupabaseMode ? lookupProblem ?? PROBLEMS.invalid : PROBLEMS.invalid) : null
  const problem = joinProblem ?? statusProblem ?? notFoundProblem
  const canJoin = Boolean(resolvedInvite) && !alreadyOnTeam && !statusProblem && !isChecking

  const handleJoin = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!resolvedInvite || !canJoin || joining) return

    if (isSupabaseMode) {
      setJoining(true)
      const acceptResult = await acceptAthleteInviteForCurrentUser(resolvedInvite.inviteId)
      setJoining(false)
      if (!acceptResult.ok) {
        setJoinProblem(problemForAcceptError(acceptResult.error.message))
        return
      }
      setSupabaseTeam({ teamId: resolvedInvite.teamId, teamName: resolvedInvite.name })
    }

    const nextState: JoinState = {
      joinedTeamId: resolvedInvite.teamId,
      joinedTeamName: resolvedInvite.name,
      joinedGroup: resolvedInvite.group,
      joinedAt: new Date().toLocaleString(),
    }

    window.localStorage.setItem(tenantStorageKey(JOIN_TEAM_STORAGE_KEY), JSON.stringify(nextState))
    setJoinState(nextState)
    setJoinProblem(null)
    setJoinedNow({ name: resolvedInvite.name })
  }

  if (joinedNow) {
    return (
      <div className="sk-page">
        <PageHeader title={`You are on ${joinedNow.name}`} lede="Your plan, test weeks and coach notes for this team show up from now on." />
        <div className="max-w-[640px]">
          <Panel>
            <p className="flex items-center gap-2 font-bold text-[#07673f]" role="status">
              <CheckCircle className="size-6 shrink-0" weight="fill" aria-hidden />
              Joined {joinedNow.name}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/athlete/home" className="sk-btn sk-btn-primary">
                Open today
                <ArrowRight className="size-5" weight="bold" />
              </Link>
              <Link to="/athlete/training-plan" className="sk-btn sk-btn-quiet">
                Open plan
              </Link>
              <button
                type="button"
                className="sk-btn sk-btn-ghost"
                onClick={() => {
                  setJoinedNow(null)
                  setInviteInput("")
                }}
              >
                Use another code
              </button>
            </div>
          </Panel>
        </div>
      </div>
    )
  }

  return (
    <div className="sk-page">
      <PageHeader
        title="Join a team"
        lede="Paste the invite link or code from your coach. You will see the team before anything changes."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)] lg:gap-8">
        <Panel>
          <form className="grid gap-5" onSubmit={(event) => void handleJoin(event)} noValidate>
            <div>
              <label htmlFor={`${formId}-code`} className="sk-label mb-1.5 block">
                Invite link or code
              </label>
              <input
                id={`${formId}-code`}
                className="sk-field"
                placeholder="Paste it here"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={`${formId}-status`}
                value={inviteInput}
                onChange={(event) => setInviteInput(event.target.value)}
              />
            </div>

            <div id={`${formId}-status`} aria-live="polite" className="grid gap-5">
              {!hasTypedInvite ? (
                <p className="text-sm leading-relaxed text-sk-mute">
                  Opened a link from your coach? The code fills in by itself. Otherwise paste it above.
                </p>
              ) : null}

              {isChecking ? <p className="text-sm font-semibold text-sk-mute">Checking invite...</p> : null}

              {resolvedInvite && !isChecking ? (
                <div className="sk-well">
                  <p className="sk-label">{alreadyOnTeam ? "Your team" : "You are about to join"}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <Initials name={resolvedInvite.name} size="lg" className="rounded-2xl" />
                    <div className="min-w-0">
                      <p className="break-words text-xl font-extrabold tracking-[-0.02em] text-sk-ink">{resolvedInvite.name}</p>
                    </div>
                  </div>
                  {resolvedInvite.group || resolvedInvite.athleteCount !== null ? (
                    <p className="mt-3 text-sm text-sk-mute">
                      {[
                        eventGroupLabel(resolvedInvite.group),
                        resolvedInvite.athleteCount !== null ? `${resolvedInvite.athleteCount} athletes` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {alreadyOnTeam && !isChecking ? (
                <p className="flex items-start gap-2 text-sm font-bold text-[#07673f]">
                  <CheckCircle className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
                  You are already on this team. There is nothing to do.
                </p>
              ) : null}

              {problem && !isChecking ? (
                <div className="flex items-start gap-3 rounded-2xl bg-sk-coral-tint p-4" role="alert">
                  <WarningCircle className="mt-0.5 size-5 shrink-0 text-[#b32a0c]" weight="fill" aria-hidden />
                  <div className="space-y-1 text-sm">
                    <p className="font-bold text-[#b32a0c]">{problem.title}</p>
                    <p className="text-sk-ink-2">{problem.body}</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {alreadyOnTeam ? (
                <Link to="/athlete/home" className="sk-btn sk-btn-primary w-full sm:w-auto">
                  Open today
                  <ArrowRight className="size-5" weight="bold" />
                </Link>
              ) : (
                <button type="submit" className="sk-btn sk-btn-primary w-full sm:w-auto" disabled={!canJoin || joining}>
                  {joining ? "Joining..." : resolvedInvite && canJoin ? `Join ${resolvedInvite.name}` : "Join team"}
                </button>
              )}
            </div>
            {canJoin && currentTeam ? (
              <p className="-mt-2 text-sm text-sk-mute">
                Joining moves you off {currentTeam.name}. You can only be on one team at a time.
              </p>
            ) : null}
          </form>
        </Panel>

        <section aria-labelledby={`${formId}-current`} className="px-1 lg:pt-2">
          <h2 id={`${formId}-current`} className="sk-h3">
            Your team right now
          </h2>
          {currentTeam ? (
            <p className="mt-2 flex items-center gap-2 font-bold text-sk-ink">
              <UsersThree className="size-5 shrink-0 text-sk-blue" weight="fill" aria-hidden />
              {currentTeam.name}
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-sk-mute">
              You are not on a team yet. Once you join one, your plan and test weeks appear here in the app.
            </p>
          )}
          <p className="mt-4 max-w-[46ch] text-sm leading-relaxed text-sk-mute">
            No code? Ask your coach to invite you from their team page. The invite goes to your email.
          </p>
        </section>
      </div>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  NoteIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  mockAthletes,
  mockCurrentSession,
  mockTestWeekResults,
  onSaveLog,
  type CurrentSession,
  type SessionBlock,
} from "@/lib/mock-data"
import {
  blockStatus,
  dateKeyLocal,
  defaultSessionProgress,
  parseSessionCompletions,
  progressForCurrentSession,
  SESSION_COMPLETIONS_STORAGE_KEY,
  SESSION_PROGRESS_STORAGE_KEY,
  sessionRowKey,
  type SessionProgress,
} from "@/lib/athlete-session"
import {
  completeLatestSessionForCurrentAthlete,
  getLatestSessionDetailForCurrentAthlete,
  type CurrentAthleteLatestSessionDetail,
} from "@/lib/data/session/session-data"
import { getLatestBenchmarkSnapshotForCurrentAthlete } from "@/lib/data/test-week/test-week-data"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { cn } from "@/lib/utils"

const blockToneMap: Record<SessionBlock["type"], string> = {
  Sprint: "bg-[#dbeafe] text-[#1d4ed8]",
  Run: "bg-[#fef3c7] text-[#b45309]",
  Strength: "bg-[#ede9fe] text-[#6d28d9]",
  Jumps: "bg-[#dcfce7] text-[#15803d]",
  Throws: "bg-[#fee2e2] text-[#be123c]",
}

export default function AthleteLogPage() {
  const navigate = useNavigate()
  const athlete = mockAthletes[0]
  const backendMode = getBackendMode()
  const [backendSessionDetail, setBackendSessionDetail] = useState<CurrentAthleteLatestSessionDetail | null>(null)
  const [backendSessionError, setBackendSessionError] = useState<string | null>(null)
  const [hasBackendTestWeekResult, setHasBackendTestWeekResult] = useState<boolean | null>(null)
  const hasTestWeekResult =
    backendMode === "supabase"
      ? (hasBackendTestWeekResult ?? true)
      : mockTestWeekResults.some((row) => row.athleteId === athlete.id)
  const requiresGymLoadInput = !hasTestWeekResult
  const [progress, setProgress] = useState<SessionProgress>(() => {
    if (typeof window === "undefined") return defaultSessionProgress()
    return progressForCurrentSession(window.localStorage.getItem(tenantStorageKey(SESSION_PROGRESS_STORAGE_KEY)))
  })

  const currentSession: CurrentSession = useMemo(() => {
    if (!(backendMode === "supabase" && backendSessionDetail)) return mockCurrentSession

    return {
      id: backendSessionDetail.session.id,
      title: backendSessionDetail.session.title,
      status:
        backendSessionDetail.session.status === "completed"
          ? "completed"
          : backendSessionDetail.session.status === "in-progress"
            ? "in-progress"
            : "not-started",
      scheduledFor: backendSessionDetail.session.scheduledFor,
      estimatedDuration: backendSessionDetail.session.estimatedDurationMinutes
        ? `${backendSessionDetail.session.estimatedDurationMinutes} min`
        : "N/A",
      coachNote: backendSessionDetail.session.coachNote ?? "",
      blocks: backendSessionDetail.blocks
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((block) => ({
          id: block.id,
          type: block.blockType,
          name: block.name,
          focus: block.focus ?? "",
          coachNote: block.coachNote ?? "",
          previousResult: block.previousResult ?? undefined,
          rest: block.restLabel ?? undefined,
          rows: block.rows
            .slice()
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((row) => ({
              label: row.label,
              target: row.target,
              helper: row.helper ?? undefined,
            })),
        })),
    }
  }, [backendMode, backendSessionDetail])

  const currentAthleteFirstName = useMemo(() => {
    if (backendMode === "supabase") return backendSessionDetail?.athleteFirstName ?? "Athlete"
    return athlete.name.split(" ")[0]
  }, [athlete.name, backendMode, backendSessionDetail?.athleteFirstName])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(tenantStorageKey(SESSION_PROGRESS_STORAGE_KEY), JSON.stringify(progress))
  }, [progress])

  useEffect(() => {
    if (typeof window === "undefined") return
    ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = true
    window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: true } }))
    const handleBack = () => window.history.back()
    window.addEventListener("pacelab:mobile-detail-back", handleBack)

    return () => {
      ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = false
      window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: false } }))
      window.removeEventListener("pacelab:mobile-detail-back", handleBack)
    }
  }, [])

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadSessionDetail = async () => {
      const result = await getLatestSessionDetailForCurrentAthlete()
      if (cancelled) return
      if (!result.ok) {
        setBackendSessionError(result.error.message)
        return
      }

      setBackendSessionError(null)
      setBackendSessionDetail(result.data)
    }

    void loadSessionDetail()
    return () => {
      cancelled = true
    }
  }, [backendMode])

  useEffect(() => {
    if (typeof window === "undefined") return
    setProgress(
      progressForCurrentSession(window.localStorage.getItem(tenantStorageKey(SESSION_PROGRESS_STORAGE_KEY)), {
        sessionId: currentSession.id,
        blockCount: currentSession.blocks.length,
      }),
    )
  }, [currentSession.id, currentSession.blocks.length])

  useEffect(() => {
    if (backendMode !== "supabase") return

    let cancelled = false
    const loadBaseline = async () => {
      const snapshot = await getLatestBenchmarkSnapshotForCurrentAthlete()
      if (!snapshot.ok) {
        console.warn("[test-week] failed to resolve backend baseline", snapshot.error)
        if (!cancelled) setHasBackendTestWeekResult(false)
        return
      }

      if (!cancelled) {
        setHasBackendTestWeekResult(Boolean(snapshot.data && snapshot.data.results.length > 0))
      }
    }

    void loadBaseline()
    return () => {
      cancelled = true
    }
  }, [backendMode])

  const currentBlock = currentSession.blocks[progress.currentBlockIndex] ?? currentSession.blocks[0]
  const completedCount = progress.completedBlockIds.length
  const totalBlocks = currentSession.blocks.length
  const progressPercent = totalBlocks > 0 ? Math.round((completedCount / totalBlocks) * 100) : 0
  const allComplete = completedCount === totalBlocks

  const sessionState = useMemo(() => {
    if (allComplete) return { label: "Completed", tone: "bg-emerald-100 text-emerald-700" }
    if (completedCount > 0 || currentSession.status === "in-progress") {
      return { label: "In Progress", tone: "bg-amber-100 text-amber-700" }
    }
    return { label: "Not Started", tone: "bg-slate-200 text-slate-700" }
  }, [allComplete, completedCount, currentSession.status])

  if (!currentBlock) return null

  const handleValueChange = (key: string, value: string) => {
    setProgress((current) => ({
      ...current,
      values: {
        ...current.values,
        [key]: value,
      },
    }))
  }

  const handleCompleteBlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSaveLog()
    const isFinalBlock = progress.currentBlockIndex === totalBlocks - 1

    setProgress((current) => {
      const completedBlockIds = current.completedBlockIds.includes(currentBlock.id)
        ? current.completedBlockIds
        : [...current.completedBlockIds, currentBlock.id]

      return {
        ...current,
        completedBlockIds,
        currentBlockIndex: Math.min(current.currentBlockIndex + 1, totalBlocks - 1),
      }
    })

    if (isFinalBlock && typeof window !== "undefined") {
      const completionDate = dateKeyLocal(new Date())

      if (getBackendMode() === "supabase") {
        const result = await completeLatestSessionForCurrentAthlete(completionDate)
        if (!result.ok) {
          console.warn("[session] failed to persist completion in supabase mode", result.error)
        }
      } else {
        const completionStorageKey = tenantStorageKey(SESSION_COMPLETIONS_STORAGE_KEY)
        const completionDates = parseSessionCompletions(window.localStorage.getItem(completionStorageKey))
        const updated = completionDates.includes(completionDate) ? completionDates : [...completionDates, completionDate]
        window.localStorage.setItem(completionStorageKey, JSON.stringify(updated))
      }

      navigate("/athlete/home")
    }
  }

  const jumpToBlock = (blockIndex: number) => {
    setProgress((current) => ({
      ...current,
      currentBlockIndex: blockIndex,
    }))
  }

  const resetSession = () => {
    setProgress(defaultSessionProgress({ sessionId: currentSession.id }))
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 pb-6 pt-4 sm:px-6 sm:pt-6">
      <section className="space-y-4">
        {backendSessionError ? (
          <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Backend sync issue: {backendSessionError}
          </div>
        ) : null}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-full bg-[#eef5ff] px-3 py-1 text-xs font-medium text-slate-700">
              {currentSession.estimatedDuration}
            </span>
            <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-medium", sessionState.tone)}>
              {sessionState.label}
            </span>
          </div>
          <h1 className="text-[2.15rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.5rem]">
            {currentSession.title}
          </h1>
          <p className="text-base leading-7 text-slate-600">
            {currentSession.scheduledFor}. Programmed for {currentAthleteFirstName} and ready to log live.
          </p>
        </div>

        <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-950">Session progress</span>
            <span className="text-slate-500">{progressPercent}%</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-200">
            <div className="h-2 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)]" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            {[
              { label: "Block", value: `${progress.currentBlockIndex + 1}/${totalBlocks}` },
              { label: "Done", value: `${completedCount}` },
              { label: "Date", value: "Today" },
            ].map((item) => (
              <div key={item.label} className="rounded-[18px] bg-[#f8fafc] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                <p className="mt-1 text-lg font-semibold tracking-[-0.04em] text-slate-950">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Workout Order</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Session Blocks</h2>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-full border-slate-200 px-4 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950"
            onClick={resetSession}
          >
            Reset
          </Button>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-1">
          {currentSession.blocks.map((block, index) => {
            const status = blockStatus(progress, block)
            const isActive = index === progress.currentBlockIndex
            return (
              <button
                key={block.id}
                type="button"
                onClick={() => jumpToBlock(index)}
                className={cn(
                  "min-w-[220px] rounded-[22px] border px-4 py-4 text-left transition",
                  isActive ? "border-[#1f8cff] bg-[#eef5ff]" : "border-slate-200 bg-white",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {index + 1}. {block.name}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">{block.focus}</p>
                  </div>
                  <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", blockToneMap[block.type])}>
                    {block.type}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-slate-500">{block.rest ? `Rest ${block.rest}` : "No rest target"}</span>
                  <span
                    className={cn(
                      "font-semibold",
                      status === "completed" ? "text-emerald-700" : status === "in-progress" ? "text-[#1368ff]" : "text-slate-400",
                    )}
                  >
                    {status === "completed" ? "Done" : status === "in-progress" ? "Active" : "Up next"}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <form onSubmit={handleCompleteBlock} className="space-y-4">
        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", blockToneMap[currentBlock.type])}>
                  {currentBlock.type}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <HugeiconsIcon icon={Clock01Icon} className="size-4" />
                  {currentBlock.rest ? `Rest ${currentBlock.rest}` : "No rest target"}
                </span>
              </div>
              <h2 className="text-[1.8rem] leading-[1] font-semibold tracking-[-0.05em] text-slate-950">{currentBlock.name}</h2>
              <p className="text-sm leading-6 text-slate-600">{currentBlock.focus}</p>
            </div>
            <Button
              asChild
              variant="outline"
              className="h-11 rounded-full border-slate-200 px-4 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950"
            >
              <Link to="/athlete/training-plan">Open plan</Link>
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-[20px] bg-[#031733] px-4 py-4 text-white">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8db8ff]">
                <HugeiconsIcon icon={NoteIcon} className="size-4" />
                Coach note
              </div>
              <p className="mt-2 text-sm text-white/80">{currentBlock.coachNote}</p>
            </div>

            {currentBlock.previousResult ? (
              <div className="rounded-[20px] border border-slate-200 bg-[#f8fafc] px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Last result</p>
                <p className="mt-1.5 text-sm font-medium text-slate-950">{currentBlock.previousResult}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          {currentBlock.rows.map((row, rowIndex) => (
            <div key={`${currentBlock.id}-${row.label}`} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-950">{row.label}</p>
                  <p className="mt-1 text-sm text-slate-600">{row.target}</p>
                  {row.helper ? <p className="mt-1 text-xs text-slate-400">{row.helper}</p> : null}
                </div>
                <span className="inline-flex rounded-full bg-[#eef5ff] px-2.5 py-1 text-xs font-semibold text-slate-700">Programmed</span>
              </div>

              {requiresGymLoadInput && currentBlock.type === "Strength" ? (
                <div className="mt-4 max-w-sm space-y-2">
                  <Label htmlFor={sessionRowKey(currentBlock.id, rowIndex, "load")} className="text-sm font-medium text-slate-950">
                    Load Used
                  </Label>
                  <Input
                    id={sessionRowKey(currentBlock.id, rowIndex, "load")}
                    value={progress.values[sessionRowKey(currentBlock.id, rowIndex, "load")] ?? ""}
                    placeholder="e.g. 100kg"
                    onChange={(event) => handleValueChange(sessionRowKey(currentBlock.id, rowIndex, "load"), event.target.value)}
                    className="h-12 rounded-[16px] border-slate-200 bg-[#f8fafc] text-slate-950"
                  />
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">No athlete input required for this block.</p>
              )}
            </div>
          ))}
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            className="h-12 rounded-full border-slate-200 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950"
            disabled={progress.currentBlockIndex === 0}
            onClick={() => jumpToBlock(progress.currentBlockIndex - 1)}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
            Previous
          </Button>
          <Button
            type="submit"
            className="h-12 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
            {progress.currentBlockIndex === totalBlocks - 1 ? "Complete Session" : "Complete Block"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12 rounded-full border-slate-200 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950"
            disabled={progress.currentBlockIndex === totalBlocks - 1}
            onClick={() => jumpToBlock(progress.currentBlockIndex + 1)}
          >
            Next
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
          </Button>
        </section>

        {allComplete ? (
          <section className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-4">
            <p className="text-sm font-semibold text-emerald-700">Session complete</p>
            <p className="mt-1 text-sm text-emerald-700/80">All programmed blocks are logged. You can review the session or return home.</p>
          </section>
        ) : null}
      </form>
    </div>
  )
}

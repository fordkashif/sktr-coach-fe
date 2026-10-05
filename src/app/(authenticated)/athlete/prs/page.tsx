"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, TrendUp, Trophy, Wind } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { EmptyState, PageHeader, Panel, Segmented } from "@/components/sk"
import { mockPrRecords } from "@/lib/data/pr/mock-pr-records"
import {
  applyMockPrOverrides,
  categoryLabel,
  compareCategories,
  compareMarks,
  formatFullDay,
  parseMark,
  prSourceLabel,
  sortPrsNewestFirst,
} from "@/lib/data/pr/pr-display"
import { getCurrentAthletePrRecords } from "@/lib/data/pr/pr-data"
import type { PrRecord } from "@/lib/data/pr/types"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { getBackendMode } from "@/lib/supabase/config"
import { cn } from "@/lib/utils"

const ALL = "All"
const PR_OVERRIDE_STORAGE_KEY = "pacelab:pr-overrides"

function MarkValue({ text, className }: { text: string; className?: string }) {
  const mark = parseMark(text)
  return (
    <span className={cn("sk-num whitespace-nowrap", className)}>
      {mark.numeral}
      {mark.unit ? <span className="ml-0.5 text-[0.5em] font-bold tracking-normal text-sk-ink-2">{mark.unit}</span> : null}
    </span>
  )
}

export default function AthletePrsPage() {
  const backendMode = getBackendMode()
  const [category, setCategory] = useState<string>(ALL)
  const [backendPrs, setBackendPrs] = useState<PrRecord[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)
  const [backendLoaded, setBackendLoaded] = useState(false)
  const [overrides] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined" || backendMode === "supabase") return {}
    const raw = window.localStorage.getItem(tenantStorageKey(PR_OVERRIDE_STORAGE_KEY))
    if (!raw) return {}
    try {
      return JSON.parse(raw) as Record<string, string>
    } catch {
      return {}
    }
  })

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadPrs = async () => {
      const result = await getCurrentAthletePrRecords()
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        setBackendPrs([])
        setBackendLoaded(true)
        return
      }
      setBackendError(null)
      setBackendPrs(result.data)
      setBackendLoaded(true)
    }

    void loadPrs()
    return () => {
      cancelled = true
    }
  }, [backendMode])

  const loading = backendMode === "supabase" && !backendLoaded

  const allPrs = useMemo(
    () => sortPrsNewestFirst(backendMode === "supabase" ? backendPrs : applyMockPrOverrides(mockPrRecords, overrides)),
    [backendMode, backendPrs, overrides],
  )

  const categories = useMemo(
    () => Array.from(new Set(allPrs.map((pr) => pr.category))).sort(compareCategories),
    [allPrs],
  )
  const activeCategory = category === ALL || categories.includes(category) ? category : ALL
  const groups = useMemo(
    () =>
      categories
        .filter((item) => activeCategory === ALL || item === activeCategory)
        .map((item) => ({ category: item, prs: allPrs.filter((pr) => pr.category === item) })),
    [activeCategory, allPrs, categories],
  )

  const newest = allPrs[0]
  const newestGain = newest ? compareMarks(newest.bestValue, newest.previousValue, newest.category) : null

  return (
    <div className="sk-page">
      <PageHeader
        title="Personal records"
        lede={
          allPrs.length > 0
            ? `Your best mark in ${allPrs.length} ${allPrs.length === 1 ? "event" : "events"}. Beat one in a test week and it updates here.`
            : "Your best mark in every event you are tested on."
        }
        actions={
          <Link to="/athlete/trends" className="sk-btn sk-btn-quiet">
            <ArrowLeft className="size-5" weight="bold" aria-hidden />
            Back to progress
          </Link>
        }
      >
        {backendError ? (
          <p role="alert" className="text-sm font-semibold text-[#b32a0c]">
            Your records could not be loaded: {backendError}
          </p>
        ) : null}
      </PageHeader>

      {loading ? (
        <p className="text-base font-semibold text-sk-mute" role="status">
          Loading your records
        </p>
      ) : allPrs.length === 0 ? (
        backendError ? null : (
          <EmptyState
            icon={<Trophy className="size-6" weight="fill" />}
            title="No records yet"
            body="The first mark you submit for each test becomes your record. Every time you beat it, the new one replaces it here."
            action={
              <Link to="/athlete/test-week" className="sk-btn sk-btn-primary">
                Go to test week
              </Link>
            }
          />
        )
      ) : (
        <>
          {newest ? (
            <section className="flex flex-col gap-4 rounded-[20px] bg-sk-yellow p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6" aria-label="Newest record">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-sk-ink">
                  <Trophy className="size-5" weight="fill" aria-hidden />
                  Your newest record
                </p>
                <p className="mt-2 text-2xl font-extrabold tracking-[-0.02em] text-sk-ink sm:text-3xl">{newest.event}</p>
                <p className="mt-1 text-sm font-medium text-sk-ink">
                  {formatFullDay(newest.measuredOn)}
                  {newestGain?.improved ? `, ${newestGain.text} than before` : ""}
                </p>
              </div>
              <MarkValue text={newest.bestValue} className="text-[4rem] sm:text-[5rem] [&>span]:text-sk-ink" />
            </section>
          ) : null}

          {categories.length > 1 ? (
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <Segmented
                value={activeCategory}
                onChange={setCategory}
                label="Filter records by category"
                options={[{ value: ALL, label: "All" }, ...categories.map((item) => ({ value: item, label: categoryLabel(item) }))]}
                className="whitespace-nowrap"
              />
            </div>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-2">
            {groups.map((group) => (
              <Panel
                key={group.category}
                title={categoryLabel(group.category)}
                hint={`${group.prs.length} ${group.prs.length === 1 ? "record" : "records"}`}
                className="min-w-0"
              >
                <ul>
                  {group.prs.map((pr) => {
                    const gain = compareMarks(pr.bestValue, pr.previousValue, pr.category)
                    return (
                      <li key={pr.id} className="sk-row items-start">
                        <div className="min-w-0 space-y-1">
                          <p className="text-lg font-bold leading-tight text-sk-ink">{pr.event}</p>
                          <p className="text-sm text-sk-mute">{formatFullDay(pr.measuredOn)}</p>
                          <p className="text-sm text-sk-mute">{prSourceLabel(pr)}</p>
                          {pr.wind || !pr.isLegal ? (
                            <p className={cn("flex items-center gap-1 text-sm font-semibold", pr.isLegal ? "text-sk-ink-2" : "text-[#7a5600]")}>
                              <Wind className="size-4 shrink-0" weight="bold" aria-hidden />
                              {pr.wind ? `Wind ${pr.wind}` : "Wind assisted"}
                              {pr.wind && !pr.isLegal ? ", over the legal limit" : ""}
                            </p>
                          ) : null}
                          {pr.note ? <p className="text-sm text-sk-ink-2">{pr.note}</p> : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <MarkValue text={pr.bestValue} className="text-[2.25rem] sm:text-[2.5rem]" />
                          {gain?.improved ? (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#07673f]">
                              <TrendUp className="size-4 shrink-0" weight="bold" aria-hidden />
                              {gain.text}
                            </span>
                          ) : null}
                          {pr.previousValue ? <span className="text-sm text-sk-mute">Before: {pr.previousValue}</span> : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

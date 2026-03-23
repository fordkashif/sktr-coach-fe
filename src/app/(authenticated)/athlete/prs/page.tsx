"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCurrentAthletePrRecords } from "@/lib/data/pr/pr-data"
import type { PrRecord } from "@/lib/data/pr/types"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { getBackendMode } from "@/lib/supabase/config"

const categories = ["All", "Sprint", "Mid", "Distance", "Jumps", "Throws", "Strength"] as const
type Category = (typeof categories)[number]
const PR_OVERRIDE_STORAGE_KEY = "pacelab:pr-overrides"
const fallbackPrs: Array<{
  id: string
  athleteId: string
  athleteName: string
  event: string
  category: Exclude<Category, "All">
  bestValue: string
  previousValue?: string
  date: string
  legal: boolean
  wind?: string
  type: "Training" | "Competition"
}> = [
  {
    id: "fallback-pr-1",
    athleteId: "fallback-athlete",
    athleteName: "Athlete",
    event: "30m",
    category: "Sprint",
    bestValue: "4.05s",
    previousValue: "4.10s",
    date: "Mar 2, 2026",
    legal: true,
    wind: undefined,
    type: "Training",
  },
  {
    id: "fallback-pr-2",
    athleteId: "fallback-athlete",
    athleteName: "Athlete",
    event: "Squat 1RM",
    category: "Strength",
    bestValue: "185kg",
    previousValue: "180kg",
    date: "Mar 2, 2026",
    legal: true,
    wind: undefined,
    type: "Training",
  },
]

export default function AthletePrsPage() {
  const backendMode = getBackendMode()
  const [category, setCategory] = useState<Category>("All")
  const [backendPrs, setBackendPrs] = useState<PrRecord[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)
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
        return
      }
      setBackendError(null)
      setBackendPrs(result.data)
    }

    void loadPrs()
    return () => {
      cancelled = true
    }
  }, [backendMode])

  const prs = useMemo(() => {
    if (backendMode === "supabase") {
      return (category === "All" ? backendPrs : backendPrs.filter((pr) => pr.category === category)).map((pr) => ({
        id: pr.id,
        athleteId: pr.athleteId,
        athleteName: "Athlete",
        event: pr.event,
        category: pr.category,
        bestValue: pr.bestValue,
        previousValue: pr.previousValue ?? undefined,
        date: new Date(`${pr.measuredOn}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        legal: pr.isLegal,
        wind: pr.wind ?? undefined,
        type: pr.sourceType === "test-week" ? "Competition" : "Training",
      }))
    }

    const source = category === "All" ? fallbackPrs : fallbackPrs.filter((pr) => pr.category === category)
    return source.map((pr) => {
      const overrideValue = overrides[pr.event]
      if (!overrideValue || overrideValue === pr.bestValue) return pr
      return {
        ...pr,
        previousValue: pr.bestValue,
        bestValue: overrideValue,
      }
    })
  }, [backendMode, backendPrs, category, overrides])

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>My PRs</CardTitle>
            <CardDescription>Track your best marks across categories.</CardDescription>
          </div>
          <Select value={category} onValueChange={(value) => setCategory(value as Category)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {backendError ? <p className="sm:col-span-2 text-sm text-rose-700">Failed to load PRs: {backendError}</p> : null}
          {prs.map((pr) => (
            <div key={pr.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{pr.event}</p>
                <Badge variant="secondary">{pr.category}</Badge>
              </div>
              <p className="text-lg font-semibold">{pr.bestValue}</p>
              {pr.previousValue ? (
                <p className="text-xs text-muted-foreground">Auto-updated from {pr.previousValue}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{pr.date}</p>
              <Badge variant={pr.legal ? "secondary" : "destructive"}>
                {pr.wind ? `Legal (${pr.wind})` : pr.legal ? "Legal" : "Wind assisted"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

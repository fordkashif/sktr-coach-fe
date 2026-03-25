"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import {
  getClubAdminBillingRecord,
  getClubAdminOpsSnapshot,
  getClubAdminProfileRecord,
  getClubAdminReportSnapshot,
  type ClubAdminBillingRecord,
  type ClubAdminOpsSnapshot,
  type ClubAdminProfileRecord,
  type ClubAdminReportSnapshot,
} from "@/lib/data/club-admin/ops-data"
import { useRole } from "@/lib/role-context"
import { getBackendMode } from "@/lib/supabase/config"

const CLUB_ADMIN_PROFILE_CACHE_KEY = "club-admin-profile-cache"
const CLUB_ADMIN_OPS_CACHE_KEY = "club-admin-ops-cache"
const CLUB_ADMIN_REPORT_CACHE_KEY = "club-admin-report-cache"
const CLUB_ADMIN_BILLING_CACHE_KEY = "club-admin-billing-cache"

export const DEFAULT_CLUB_ADMIN_PROFILE: ClubAdminProfileRecord = {
  clubName: "",
  shortName: "",
  primaryColor: "#16a34a",
  seasonYear: "2026",
  seasonStart: "2026-01-10",
  seasonEnd: "2026-10-30",
  passwordSetAt: null,
  onboardingCompletedAt: null,
  setupGuideDismissedAt: null,
}

function loadCachedClubAdminProfile() {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(CLUB_ADMIN_PROFILE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ClubAdminProfileRecord>
    if (!parsed || typeof parsed !== "object") return null

    return {
      ...DEFAULT_CLUB_ADMIN_PROFILE,
      ...parsed,
      clubName: parsed.clubName ?? "",
      shortName: parsed.shortName ?? "",
      primaryColor: parsed.primaryColor ?? DEFAULT_CLUB_ADMIN_PROFILE.primaryColor,
      seasonYear: parsed.seasonYear ?? DEFAULT_CLUB_ADMIN_PROFILE.seasonYear,
      seasonStart: parsed.seasonStart ?? DEFAULT_CLUB_ADMIN_PROFILE.seasonStart,
      seasonEnd: parsed.seasonEnd ?? DEFAULT_CLUB_ADMIN_PROFILE.seasonEnd,
    } satisfies ClubAdminProfileRecord
  } catch {
    return null
  }
}

export function persistCachedClubAdminProfile(profile: ClubAdminProfileRecord) {
  if (typeof window === "undefined") return

  window.localStorage.setItem(
    CLUB_ADMIN_PROFILE_CACHE_KEY,
    JSON.stringify({
      clubName: profile.clubName,
      shortName: profile.shortName,
      primaryColor: profile.primaryColor,
      seasonYear: profile.seasonYear,
      seasonStart: profile.seasonStart,
      seasonEnd: profile.seasonEnd,
      passwordSetAt: profile.passwordSetAt ?? null,
      onboardingCompletedAt: profile.onboardingCompletedAt ?? null,
      setupGuideDismissedAt: profile.setupGuideDismissedAt ?? null,
    }),
  )
}

function loadCachedJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function persistCachedJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(key, JSON.stringify(value))
}

type ClubAdminContextValue = {
  profile: ClubAdminProfileRecord | null
  opsSnapshot: ClubAdminOpsSnapshot | null
  reportSnapshot: ClubAdminReportSnapshot | null
  billingRecord: ClubAdminBillingRecord | null
  profileLoading: boolean
  opsLoading: boolean
  reportLoading: boolean
  billingLoading: boolean
  profileError: string | null
  opsError: string | null
  reportError: string | null
  billingError: string | null
  refreshProfile: () => Promise<void>
  refreshOpsSnapshot: () => Promise<void>
  refreshReportSnapshot: () => Promise<void>
  refreshBillingRecord: () => Promise<void>
  updateCachedProfile: (profile: ClubAdminProfileRecord) => void
  updateCachedBillingRecord: (billing: ClubAdminBillingRecord) => void
}

const ClubAdminContext = createContext<ClubAdminContextValue>({
  profile: null,
  opsSnapshot: null,
  reportSnapshot: null,
  billingRecord: null,
  profileLoading: false,
  opsLoading: false,
  reportLoading: false,
  billingLoading: false,
  profileError: null,
  opsError: null,
  reportError: null,
  billingError: null,
  refreshProfile: async () => {},
  refreshOpsSnapshot: async () => {},
  refreshReportSnapshot: async () => {},
  refreshBillingRecord: async () => {},
  updateCachedProfile: () => {},
  updateCachedBillingRecord: () => {},
})

export function ClubAdminProvider({ children }: { children: ReactNode }) {
  const { role } = useRole()
  const location = useLocation()
  const isSupabaseMode = getBackendMode() === "supabase"
  const isClubAdminRoute = location.pathname.startsWith("/club-admin")
  const cachedProfile = isSupabaseMode ? loadCachedClubAdminProfile() : null
  const cachedOpsSnapshot = isSupabaseMode ? loadCachedJson<ClubAdminOpsSnapshot>(CLUB_ADMIN_OPS_CACHE_KEY) : null
  const cachedReportSnapshot = isSupabaseMode ? loadCachedJson<ClubAdminReportSnapshot>(CLUB_ADMIN_REPORT_CACHE_KEY) : null
  const cachedBillingRecord = isSupabaseMode ? loadCachedJson<ClubAdminBillingRecord>(CLUB_ADMIN_BILLING_CACHE_KEY) : null

  const [profile, setProfile] = useState<ClubAdminProfileRecord | null>(cachedProfile)
  const [opsSnapshot, setOpsSnapshot] = useState<ClubAdminOpsSnapshot | null>(cachedOpsSnapshot)
  const [reportSnapshot, setReportSnapshot] = useState<ClubAdminReportSnapshot | null>(cachedReportSnapshot)
  const [billingRecord, setBillingRecord] = useState<ClubAdminBillingRecord | null>(cachedBillingRecord)
  const [profileLoading, setProfileLoading] = useState(isSupabaseMode && role === "club-admin" && isClubAdminRoute && !cachedProfile)
  const [opsLoading, setOpsLoading] = useState(isSupabaseMode && role === "club-admin" && isClubAdminRoute && !cachedOpsSnapshot)
  const [reportLoading, setReportLoading] = useState(isSupabaseMode && role === "club-admin" && isClubAdminRoute && !cachedReportSnapshot)
  const [billingLoading, setBillingLoading] = useState(isSupabaseMode && role === "club-admin" && isClubAdminRoute && !cachedBillingRecord)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [opsError, setOpsError] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)

  const refreshProfile = useCallback(async () => {
    if (!isSupabaseMode || role !== "club-admin") return

    setProfileLoading(true)
    const result = await getClubAdminProfileRecord()
    if (!result.ok) {
      setProfileError(result.error.message)
      setProfileLoading(false)
      return
    }

    setProfile(result.data)
    persistCachedClubAdminProfile(result.data)
    setProfileError(null)
    setProfileLoading(false)
  }, [isSupabaseMode, role])

  const refreshOpsSnapshot = useCallback(async () => {
    if (!isSupabaseMode || role !== "club-admin") return
    setOpsLoading(true)
    const result = await getClubAdminOpsSnapshot()
    if (!result.ok) {
      setOpsError(result.error.message)
      setOpsLoading(false)
      return
    }
    setOpsSnapshot(result.data)
    persistCachedJson(CLUB_ADMIN_OPS_CACHE_KEY, result.data)
    setOpsError(null)
    setOpsLoading(false)
  }, [isSupabaseMode, role])

  const refreshReportSnapshot = useCallback(async () => {
    if (!isSupabaseMode || role !== "club-admin") return
    setReportLoading(true)
    const result = await getClubAdminReportSnapshot()
    if (!result.ok) {
      setReportError(result.error.message)
      setReportLoading(false)
      return
    }
    setReportSnapshot(result.data)
    persistCachedJson(CLUB_ADMIN_REPORT_CACHE_KEY, result.data)
    setReportError(null)
    setReportLoading(false)
  }, [isSupabaseMode, role])

  const refreshBillingRecord = useCallback(async () => {
    if (!isSupabaseMode || role !== "club-admin") return
    setBillingLoading(true)
    const result = await getClubAdminBillingRecord()
    if (!result.ok) {
      setBillingError(result.error.message)
      setBillingLoading(false)
      return
    }
    setBillingRecord(result.data)
    persistCachedJson(CLUB_ADMIN_BILLING_CACHE_KEY, result.data)
    setBillingError(null)
    setBillingLoading(false)
  }, [isSupabaseMode, role])

  useEffect(() => {
    if (!isSupabaseMode || role !== "club-admin" || !isClubAdminRoute) return
    void refreshProfile()
    void refreshOpsSnapshot()
    void refreshReportSnapshot()
    void refreshBillingRecord()
  }, [isClubAdminRoute, isSupabaseMode, refreshBillingRecord, refreshOpsSnapshot, refreshProfile, refreshReportSnapshot, role])

  const value = useMemo<ClubAdminContextValue>(
    () => ({
      profile,
      opsSnapshot,
      reportSnapshot,
      billingRecord,
      profileLoading,
      opsLoading,
      reportLoading,
      billingLoading,
      profileError,
      opsError,
      reportError,
      billingError,
      refreshProfile,
      refreshOpsSnapshot,
      refreshReportSnapshot,
      refreshBillingRecord,
      updateCachedProfile: (nextProfile) => {
        setProfile(nextProfile)
        persistCachedClubAdminProfile(nextProfile)
      },
      updateCachedBillingRecord: (nextBilling) => {
        setBillingRecord(nextBilling)
        persistCachedJson(CLUB_ADMIN_BILLING_CACHE_KEY, nextBilling)
      },
    }),
    [
      billingError,
      billingLoading,
      billingRecord,
      opsError,
      opsLoading,
      opsSnapshot,
      profile,
      profileError,
      profileLoading,
      refreshBillingRecord,
      refreshOpsSnapshot,
      refreshProfile,
      refreshReportSnapshot,
      reportError,
      reportLoading,
      reportSnapshot,
    ],
  )

  return <ClubAdminContext.Provider value={value}>{children}</ClubAdminContext.Provider>
}

export function useClubAdmin() {
  return useContext(ClubAdminContext)
}

import type { EventGroup, Readiness } from "@/lib/mock-data"
import { tenantStorageKey } from "@/lib/tenant-storage"

export type UserRole = "club-admin" | "coach" | "athlete"
export type UserStatus = "active" | "disabled"
export type TeamStatus = "active" | "archived"

export interface ClubProfile {
  clubName: string
  shortName: string
  primaryColor: string
  seasonYear: string
  seasonStart: string
  seasonEnd: string
}

export interface ClubUser {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  teamId?: string
}

export interface ClubTeam {
  id: string
  name: string
  eventGroup: EventGroup
  status: TeamStatus
  coachEmail?: string
}

export interface CoachInvite {
  id: string
  email: string
  teamId?: string
  status: "pending" | "accepted" | "expired"
  createdAt: string
  inviteUrl?: string
}

export interface AccountRequest {
  id: string
  fullName: string
  email: string
  organization: string
  role: UserRole
  notes?: string
  status: "pending" | "approved" | "declined"
  createdAt: string
  reviewedAt?: string
}

export interface AdminKpi {
  totalUsers: number
  activeAthletes: number
  activeCoaches: number
  readiness: Record<Readiness, number>
  adherenceAverage: number
}

export const CLUB_PROFILE_KEY = "pacelab:club-profile"
export const CLUB_USERS_KEY = "pacelab:club-users"
export const CLUB_TEAMS_KEY = "pacelab:club-teams"
export const COACH_INVITES_KEY = "pacelab:coach-invites"
export const ACCOUNT_REQUESTS_KEY = "pacelab:account-requests"

export const defaultClubProfile: ClubProfile = {
  clubName: "Elite Track Club",
  shortName: "ETC",
  primaryColor: "#16a34a",
  seasonYear: "2026",
  seasonStart: "2026-01-10",
  seasonEnd: "2026-10-30",
}

export const defaultClubUsers: ClubUser[] = [
  { id: "u-admin-1", name: "Club Admin", email: "clubadmin@pacelab.local", role: "club-admin", status: "active" },
  { id: "u-coach-1", name: "Coach Rivera", email: "coach.rivera@pacelab.local", role: "coach", status: "active", teamId: "t1" },
  { id: "u-coach-2", name: "Coach Smith", email: "coach.smith@pacelab.local", role: "coach", status: "active", teamId: "t2" },
  { id: "u-athlete-1", name: "Athlete One", email: "athlete@pacelab.local", role: "athlete", status: "active", teamId: "t1" },
]

export const defaultClubTeams: ClubTeam[] = [
  { id: "t1", name: "Sprint Group", eventGroup: "Sprint", status: "active", coachEmail: "coach.rivera@pacelab.local" },
  { id: "t2", name: "Distance Group", eventGroup: "Distance", status: "active", coachEmail: "coach.smith@pacelab.local" },
  { id: "t3", name: "Jumps Group", eventGroup: "Jumps", status: "active" },
  { id: "t4", name: "Throws Group", eventGroup: "Throws", status: "active" },
]

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function loadClubProfile() {
  if (typeof window === "undefined") return defaultClubProfile
  return safeParse(window.localStorage.getItem(tenantStorageKey(CLUB_PROFILE_KEY)), defaultClubProfile)
}

export function saveClubProfile(profile: ClubProfile) {
  window.localStorage.setItem(tenantStorageKey(CLUB_PROFILE_KEY), JSON.stringify(profile))
}

export function loadClubUsers() {
  if (typeof window === "undefined") return defaultClubUsers
  return safeParse(window.localStorage.getItem(tenantStorageKey(CLUB_USERS_KEY)), defaultClubUsers)
}

export function saveClubUsers(users: ClubUser[]) {
  window.localStorage.setItem(tenantStorageKey(CLUB_USERS_KEY), JSON.stringify(users))
}

export function loadClubTeams() {
  if (typeof window === "undefined") return defaultClubTeams
  return safeParse(window.localStorage.getItem(tenantStorageKey(CLUB_TEAMS_KEY)), defaultClubTeams)
}

export function saveClubTeams(teams: ClubTeam[]) {
  window.localStorage.setItem(tenantStorageKey(CLUB_TEAMS_KEY), JSON.stringify(teams))
}

export function loadCoachInvites() {
  if (typeof window === "undefined") return [] as CoachInvite[]
  return safeParse(window.localStorage.getItem(tenantStorageKey(COACH_INVITES_KEY)), [] as CoachInvite[])
}

export function saveCoachInvites(invites: CoachInvite[]) {
  window.localStorage.setItem(tenantStorageKey(COACH_INVITES_KEY), JSON.stringify(invites))
}

export function loadAccountRequests() {
  if (typeof window === "undefined") return [] as AccountRequest[]
  return safeParse(window.localStorage.getItem(tenantStorageKey(ACCOUNT_REQUESTS_KEY)), [] as AccountRequest[])
}

export function saveAccountRequests(requests: AccountRequest[]) {
  window.localStorage.setItem(tenantStorageKey(ACCOUNT_REQUESTS_KEY), JSON.stringify(requests))
}

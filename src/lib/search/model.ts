/**
 * Global search: the pure part. Text folding, ranking, grouping, where a result goes and the index
 * of screens per role. Nothing here touches the browser or the database, so it runs in unit tests.
 *
 * The same rules are written in SQL in supabase/migrations/20261017100000_global_search.sql
 * (search_fold, search_rank, search_everything). Keep the two in step.
 */

export type SearchRole = "athlete" | "coach" | "club-admin" | "guardian" | "platform-admin"

export type SearchKind =
  | "screen"
  | "athlete"
  | "team"
  | "plan"
  | "template"
  | "exercise"
  | "test_week"
  | "competition"
  | "staff"
  | "guardian"
  | "invite"
  | "season"
  | "club_event"
  | "session"
  | "record"
  | "goal"
  | "coach"
  | "child"
  | "club"
  | "request"
  | "platform_admin"

export type SearchParams = Record<string, string | boolean | null | undefined>

export type SearchHit = {
  kind: SearchKind
  id: string
  title: string
  subtitle: string | null
  /** Where the row goes. */
  href: string
  /** 0 exact, 1 starts with, 2 a word starts with, 3 inside. */
  rank: number
  /** ISO day used to put recent things first inside one rank. */
  sortDate: string | null
  /** Guardian only: the child to switch to before going there. */
  childId?: string
}

/** A thing that can be searched, before ranking. Used for the demo data and the screen index. */
export type SearchCandidate = {
  kind: SearchKind
  id: string
  title: string
  subtitle?: string | null
  /** More text to match on (a venue, an email, a day written out). Never shown. */
  extra?: string[]
  params?: SearchParams
  sortDate?: string | null
  href?: string
}

export const MIN_QUERY_LENGTH = 2
export const MAX_QUERY_LENGTH = 80
export const GROUP_PREVIEW = 5
/** Asked of the server per kind, so "Show all" has something to show. */
export const GROUP_LIMIT = 20

const FOLD_SPECIAL: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", đ: "d", ø: "o", ł: "l", ı: "i" }

/** Lower case, accents removed: "José" and "jose" are the same text. */
export function foldText(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[ßæœđøłı]/g, (char) => FOLD_SPECIAL[char] ?? char)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

/** What is actually searched for: trimmed, inner spaces collapsed, cut at 80 characters. Not folded. */
export function cleanQuery(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH).trim()
}

export function isSearchable(raw: string | null | undefined): boolean {
  return cleanQuery(raw).length >= MIN_QUERY_LENGTH
}

/** 0 exact, 1 the text starts with the query, 2 a word starts with it, 3 it is inside, null no match. */
export function rankText(text: string | null | undefined, foldedQuery: string): number | null {
  const folded = foldText(text)
  if (!foldedQuery || !folded.includes(foldedQuery)) return null
  const trimmed = folded.trim()
  if (trimmed === foldedQuery) return 0
  if (trimmed.startsWith(foldedQuery)) return 1
  if (folded.includes(` ${foldedQuery}`)) return 2
  return 3
}

/** Best rank first, then the most recent, then by name. */
export function compareHits(left: Pick<SearchHit, "rank" | "sortDate" | "title">, right: Pick<SearchHit, "rank" | "sortDate" | "title">): number {
  if (left.rank !== right.rank) return left.rank - right.rank
  if (left.sortDate !== right.sortDate) {
    if (!left.sortDate) return 1
    if (!right.sortDate) return -1
    return left.sortDate < right.sortDate ? 1 : -1
  }
  return left.title.localeCompare(right.title)
}

/* ---------- Where a result goes ---------------------------------------------------------------- */

function text(params: SearchParams | undefined, key: string): string | null {
  const value = params?.[key]
  return typeof value === "string" && value ? value : null
}

/**
 * The screen a result opens, for the role looking at it. Null when that role has no screen for
 * the kind: such a result is dropped, so search never leads somewhere the person cannot open.
 */
export function hrefForHit(role: SearchRole, kind: SearchKind, id: string, params?: SearchParams): string | null {
  const safeId = encodeURIComponent(id)
  if (role === "coach") {
    if (kind === "athlete") return `/coach/athletes/${safeId}`
    if (kind === "team") return `/coach/teams/${safeId}`
    if (kind === "plan") return "/coach/training-plan"
    if (kind === "template") return "/coach/training-plan/templates"
    if (kind === "exercise") return "/coach/training-plan/exercises"
    if (kind === "test_week") return "/coach/test-week"
    if (kind === "competition") return `/coach/competitions/${safeId}`
    return null
  }
  if (role === "club-admin") {
    if (kind === "staff") return "/club-admin/users"
    if (kind === "athlete") return "/club-admin/users?view=athletes"
    if (kind === "guardian") return "/club-admin/users?view=guardians"
    if (kind === "invite") return "/club-admin/users?view=invites"
    if (kind === "team") return `/club-admin/teams?team=${safeId}`
    if (kind === "season") return "/club-admin/profile/seasons"
    if (kind === "club_event") return "/club-admin/calendar"
    return null
  }
  if (role === "athlete") {
    if (kind === "session") {
      const date = text(params, "date")
      return date ? `/athlete/log?date=${encodeURIComponent(date)}&session=${safeId}` : "/athlete/history"
    }
    if (kind === "record") return `/athlete/prs/event/${encodeURIComponent(text(params, "eventGroup") ?? id)}`
    if (kind === "competition") return `/athlete/competitions/${safeId}`
    if (kind === "goal") return "/athlete/goals"
    if (kind === "coach") {
      const coachUserId = text(params, "coachUserId")
      return coachUserId && params?.canMessage === true ? `/athlete/messages/coach/${encodeURIComponent(coachUserId)}` : "/athlete/profile"
    }
    return null
  }
  if (role === "guardian") {
    if (kind === "child") return "/guardian/home"
    if (kind === "competition") return "/guardian/results"
    return null
  }
  if (kind === "club") return "/platform-admin/tenants"
  if (kind === "request") return "/platform-admin/requests"
  if (kind === "platform_admin") return "/platform-admin/admins"
  return null
}

/* ---------- Groups ----------------------------------------------------------------------------- */

export type SearchGroupDef = { id: string; label: string; kinds: SearchKind[] }

const SCREENS_GROUP: SearchGroupDef = { id: "screens", label: "Screens", kinds: ["screen"] }

/** The groups a role sees, in the order they are shown. A kind not listed for a role is never shown to it. */
export const SEARCH_GROUPS: Record<SearchRole, SearchGroupDef[]> = {
  coach: [
    { id: "athletes", label: "Athletes", kinds: ["athlete"] },
    { id: "teams", label: "Teams", kinds: ["team"] },
    { id: "plans", label: "Plans and templates", kinds: ["plan", "template"] },
    { id: "exercises", label: "Exercises", kinds: ["exercise"] },
    { id: "tests", label: "Test weeks", kinds: ["test_week"] },
    { id: "competitions", label: "Competitions", kinds: ["competition"] },
    SCREENS_GROUP,
  ],
  "club-admin": [
    { id: "people", label: "People", kinds: ["staff", "athlete", "guardian"] },
    { id: "teams", label: "Teams", kinds: ["team"] },
    { id: "invites", label: "Invites", kinds: ["invite"] },
    { id: "seasons", label: "Seasons", kinds: ["season"] },
    { id: "events", label: "Club events", kinds: ["club_event"] },
    SCREENS_GROUP,
  ],
  athlete: [
    { id: "sessions", label: "Sessions", kinds: ["session"] },
    { id: "records", label: "Records", kinds: ["record"] },
    { id: "competitions", label: "Competitions", kinds: ["competition"] },
    { id: "goals", label: "Goals", kinds: ["goal"] },
    { id: "coaches", label: "Coaches", kinds: ["coach"] },
    SCREENS_GROUP,
  ],
  guardian: [
    { id: "children", label: "Children", kinds: ["child"] },
    { id: "competitions", label: "Competitions", kinds: ["competition"] },
    SCREENS_GROUP,
  ],
  "platform-admin": [
    { id: "clubs", label: "Clubs", kinds: ["club"] },
    { id: "requests", label: "Requests", kinds: ["request"] },
    { id: "admins", label: "Platform admins", kinds: ["platform_admin"] },
    SCREENS_GROUP,
  ],
}

/** Kinds an assistant coach has no screen for: plans, templates, the library and competitions are with the lead coach. */
export const ASSISTANT_HIDDEN_KINDS: SearchKind[] = ["plan", "template", "exercise", "competition"]

export function kindAllowed(role: SearchRole, kind: SearchKind, options?: { assistant?: boolean }): boolean {
  if (role === "coach" && options?.assistant && ASSISTANT_HIDDEN_KINDS.includes(kind)) return false
  return SEARCH_GROUPS[role].some((group) => group.kinds.includes(kind))
}

export type SearchGroup = { id: string; label: string; hits: SearchHit[] }

/** Sorts the hits into the role's groups. Empty groups are left out. Hits of a kind the role does not have are dropped. */
export function groupHits(role: SearchRole, hits: SearchHit[], options?: { assistant?: boolean }): SearchGroup[] {
  return SEARCH_GROUPS[role]
    .map((group) => ({
      id: group.id,
      label: group.label,
      hits: hits.filter((hit) => group.kinds.includes(hit.kind) && kindAllowed(role, hit.kind, options)).sort(compareHits),
    }))
    .filter((group) => group.hits.length > 0)
}

/** The rows on screen, top to bottom: five per group unless the group was opened with "Show all". */
export function visibleHits(groups: SearchGroup[], expanded: ReadonlySet<string>): SearchHit[] {
  return groups.flatMap((group) => (expanded.has(group.id) ? group.hits : group.hits.slice(0, GROUP_PREVIEW)))
}

/** Ranks candidates against a query: the demo data and the screen index go through this. */
export function rankCandidates(role: SearchRole, candidates: SearchCandidate[], rawQuery: string, limitPerKind = GROUP_LIMIT): SearchHit[] {
  const query = foldText(cleanQuery(rawQuery))
  if (query.length < MIN_QUERY_LENGTH) return []
  const hits: SearchHit[] = []
  for (const candidate of candidates) {
    const titleRank = rankText(candidate.title, query)
    // Matching on the hidden text (a venue, an email) counts as "inside": the title did not match.
    // A screen's other words ("maxes" for Best lifts) only count from the start of a word, or two letters would offer half the app.
    const extraMatch = (candidate.extra ?? []).some((value) => {
      const extraRank = rankText(value, query)
      return extraRank !== null && (candidate.kind !== "screen" || extraRank <= 2)
    })
    const rank = titleRank ?? (extraMatch ? 3 : null)
    if (rank === null) continue
    const href = candidate.href ?? hrefForHit(role, candidate.kind, candidate.id, candidate.params)
    if (!href) continue
    const hit: SearchHit = { kind: candidate.kind, id: candidate.id, title: candidate.title, subtitle: candidate.subtitle ?? null, href, rank, sortDate: candidate.sortDate ?? null }
    if (role === "guardian" && candidate.kind === "child") hit.childId = candidate.id
    hits.push(hit)
  }
  hits.sort(compareHits)
  const perKind = new Map<SearchKind, number>()
  return hits.filter((hit) => {
    const count = perKind.get(hit.kind) ?? 0
    perKind.set(hit.kind, count + 1)
    return count < limitPerKind
  })
}

/* ---------- Screens ---------------------------------------------------------------------------- */

/** One destination of the shell's navigation, as the shell built it for the signed-in person. */
export type ShellDestination = { id: string; label: string; href: string }

type ExtraScreen = {
  id: string
  label: string
  /** Built from the shell link it sits under, so a team screen follows the selected team. */
  href: string | ((under: ShellDestination) => string | null)
  /** The shell destination this screen belongs to. The screen is only offered when the shell shows that destination. */
  under: string
  keywords?: string[]
  /** Coach only: an assistant coach is shown a "this is with the lead coach" page there, so it is not offered. */
  notForAssistants?: boolean
}

/** Screens that are one step past a shell destination. Each names the destination it sits under. */
export const EXTRA_SCREENS: Record<SearchRole, ExtraScreen[]> = {
  coach: [
    {
      id: "attendance",
      label: "Attendance",
      under: "teams",
      keywords: ["register", "present", "absent", "late"],
      href: (teams) => (/^\/coach\/teams\/[^/]+$/.test(teams.href) ? `${teams.href}/attendance` : null),
    },
    { id: "best-lifts", label: "Best lifts", under: "plans", href: "/coach/training-plan/maxes", keywords: ["maxes", "1rm", "lift maxes", "percent loads"] },
    { id: "exercise-library", label: "Exercise library", under: "plans", href: "/coach/training-plan/exercises", keywords: ["exercises", "drills"] },
    { id: "plan-templates", label: "Plan templates", under: "plans", href: "/coach/training-plan/templates", keywords: ["templates"] },
    { id: "team-calendar", label: "Calendar", under: "plans", href: "/coach/training-plan/calendar", keywords: ["team calendar", "schedule"] },
    { id: "load", label: "Training load", under: "reports", href: "/coach/reports/load", keywords: ["load", "workload"] },
    { id: "new-competition", label: "Add a competition", under: "competitions", href: "/coach/competitions/new", keywords: ["new competition", "meet"] },
    { id: "new-announcement", label: "New announcement", under: "messages", href: "/coach/messages/a/new", keywords: ["announce", "post"], notForAssistants: true },
  ],
  athlete: [
    { id: "records", label: "Records", under: "progress", href: "/athlete/prs", keywords: ["personal bests", "prs", "results", "pb"] },
    { id: "add-result", label: "Add a result", under: "progress", href: "/athlete/prs/add", keywords: ["new result", "mark"] },
    { id: "competitions", label: "Competitions", under: "progress", href: "/athlete/competitions", keywords: ["meets", "races"] },
    { id: "test-week", label: "Test week", under: "progress", href: "/athlete/test-week", keywords: ["tests", "testing"] },
    { id: "goals", label: "Goals", under: "progress", href: "/athlete/goals", keywords: ["targets"] },
    { id: "history", label: "Session history", under: "progress", href: "/athlete/history", keywords: ["past sessions", "log history"] },
    { id: "wellness", label: "Wellness check", under: "home", href: "/athlete/wellness", keywords: ["readiness", "sleep", "check in"] },
    { id: "pain", label: "Report pain or an injury", under: "home", href: "/athlete/wellness/pain", keywords: ["injured", "hurt", "sore"] },
    { id: "add-session", label: "Add a session", under: "log", href: "/athlete/log/new", keywords: ["new session", "extra session"] },
    { id: "join-team", label: "Join a team", under: "profile", href: "/athlete/join", keywords: ["join code", "team code"] },
  ],
  "club-admin": [
    { id: "seasons", label: "Seasons", under: "club", href: "/club-admin/profile/seasons", keywords: ["season", "rollover", "new season"] },
    { id: "calendar", label: "Club calendar", under: "dashboard", href: "/club-admin/calendar", keywords: ["events", "schedule"] },
    { id: "invite", label: "Invite people", under: "people", href: "/club-admin/users?invite=1", keywords: ["invite coach", "add coach", "add admin"] },
    { id: "guardians", label: "Guardians", under: "people", href: "/club-admin/users?view=guardians", keywords: ["parents"] },
    { id: "invites", label: "Invites", under: "people", href: "/club-admin/users?view=invites", keywords: ["pending invites"] },
    { id: "new-announcement", label: "New announcement", under: "messages", href: "/club-admin/messages/a/new", keywords: ["announce", "post"] },
  ],
  guardian: [{ id: "contact", label: "Your contact details", under: "home", href: "/guardian/contact", keywords: ["phone", "email", "contact"] }],
  "platform-admin": [{ id: "emails", label: "Email activity", under: "activity", href: "/platform-admin/audit?view=emails", keywords: ["emails", "failed emails"] }],
}

/** Screens every signed-in role has. */
const ANY_ROLE_SCREENS: Array<{ id: string; label: string; href: string; keywords: string[] }> = [
  { id: "account", label: "Your account", href: "/account", keywords: ["password", "name", "photo", "delete my data", "download my data"] },
  { id: "notification-settings", label: "Notification settings", href: "/settings/notifications", keywords: ["reminders", "emails", "push"] },
  { id: "notifications", label: "Notifications", href: "/notifications", keywords: ["alerts"] },
]

/**
 * The screens a person can be offered. It starts from the destinations the shell itself shows them
 * (already cut down for an assistant coach), adds the screens one step past each, and nothing else:
 * a screen whose destination the shell does not show is not in the index.
 */
export function buildScreenIndex(role: SearchRole, destinations: ShellDestination[], options?: { assistant?: boolean }): SearchCandidate[] {
  const prefix = `/${role}/`
  const screens: SearchCandidate[] = []
  const seen = new Set<string>()
  const add = (id: string, label: string, href: string, keywords: string[] = []) => {
    if (seen.has(href)) return
    seen.add(href)
    screens.push({ kind: "screen", id: `screen:${id}`, title: label, extra: keywords, href })
  }
  for (const destination of destinations) {
    if (!destination.href.startsWith(prefix)) continue
    add(destination.id, destination.label, destination.href)
  }
  for (const extra of EXTRA_SCREENS[role]) {
    const under = destinations.find((destination) => destination.id === extra.under && destination.href.startsWith(prefix))
    if (!under) continue
    if (extra.notForAssistants && options?.assistant) continue
    const href = typeof extra.href === "string" ? extra.href : extra.href(under)
    if (!href || !href.startsWith(prefix)) continue
    add(extra.id, extra.label, href, extra.keywords)
  }
  for (const screen of ANY_ROLE_SCREENS) {
    // An athlete's account is their profile, which is already a destination.
    if (role === "athlete" && screen.id === "account") continue
    add(screen.id, screen.label, screen.href, screen.keywords)
  }
  return screens
}

export function searchScreens(role: SearchRole, index: SearchCandidate[], rawQuery: string): SearchHit[] {
  return rankCandidates(role, index, rawQuery)
}

/* ---------- Recent searches (the list itself; storage is in recent.ts) ------------------------- */

export const RECENT_LIMIT = 6

/** Puts a search at the front of the recent list, without repeats (case and accents ignored). */
export function addRecent(list: string[], raw: string): string[] {
  const query = cleanQuery(raw)
  if (query.length < MIN_QUERY_LENGTH) return list
  const key = foldText(query)
  return [query, ...list.filter((item) => foldText(item) !== key)].slice(0, RECENT_LIMIT)
}

/** Reads a stored list back safely: anything that is not a list of short strings becomes an empty list. */
export function parseRecent(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => cleanQuery(item))
      .filter((item) => item.length >= MIN_QUERY_LENGTH)
      .slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

/* ---------- Server rows ------------------------------------------------------------------------ */

const KNOWN_KINDS = new Set<string>([
  "athlete", "team", "plan", "template", "exercise", "test_week", "competition", "staff", "guardian", "invite", "season",
  "club_event", "session", "record", "goal", "coach", "child", "club", "request", "platform_admin",
])

/** Turns the rows of search_everything into hits for a role. Unknown kinds and kinds the role has no screen for are dropped. */
export function hitsFromRows(role: SearchRole, rows: unknown, options?: { assistant?: boolean }): SearchHit[] {
  if (!Array.isArray(rows)) return []
  const hits: SearchHit[] = []
  for (const row of rows as Array<Record<string, unknown>>) {
    if (!row || typeof row.kind !== "string" || !KNOWN_KINDS.has(row.kind) || typeof row.title !== "string" || row.id === null || row.id === undefined) continue
    const kind = row.kind as SearchKind
    if (!kindAllowed(role, kind, options)) continue
    const id = String(row.id)
    const params = row.params && typeof row.params === "object" ? (row.params as SearchParams) : undefined
    const href = hrefForHit(role, kind, id, params)
    if (!href) continue
    const hit: SearchHit = {
      kind,
      id,
      title: row.title.trim() || "No name",
      subtitle: typeof row.subtitle === "string" && row.subtitle.trim() ? row.subtitle.trim() : null,
      href,
      rank: typeof row.rank === "number" ? row.rank : 3,
      sortDate: typeof row.sort_date === "string" ? row.sort_date : null,
    }
    if (role === "guardian" && kind === "child") hit.childId = id
    hits.push(hit)
  }
  return hits
}

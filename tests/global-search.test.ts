import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { evaluateAccess } from "../src/lib/access-control"
import {
  addRecent,
  buildScreenIndex,
  cleanQuery,
  compareHits,
  EXTRA_SCREENS,
  foldText,
  groupHits,
  hitsFromRows,
  hrefForHit,
  isSearchable,
  kindAllowed,
  parseRecent,
  rankCandidates,
  rankText,
  SEARCH_GROUPS,
  searchScreens,
  visibleHits,
  type SearchCandidate,
  type SearchHit,
  type SearchRole,
  type ShellDestination,
} from "../src/lib/search/model"

const ROLES: SearchRole[] = ["athlete", "coach", "club-admin", "guardian", "platform-admin"]

// The shell's own link lists and the router's own routes, read from source: the index is checked
// against what the app really has, not against a copy kept in this file.
const root = process.cwd()
const shellSource = readFileSync(join(root, "src/components/app-shell.tsx"), "utf8")
const routerSource = readFileSync(join(root, "src/router/index.tsx"), "utf8")

function shellLinks(constName: string): ShellDestination[] {
  const block = new RegExp(`const ${constName}: ShellLink\\[\\] = \\[([\\s\\S]*?)\\n\\]`).exec(shellSource)
  assert.ok(block, `${constName} not found in app-shell.tsx`)
  const links = [...block[1].matchAll(/\{ id: (?:"([^"]+)"|([A-Z_]+)), href: "([^"]+)", label: "([^"]+)"/g)].map((match) => ({
    id: match[1] ?? (match[2] === "MESSAGES_ID" ? "messages" : match[2] === "ATHLETE_LOG_ID" ? "log" : match[2]),
    href: match[3],
    label: match[4],
  }))
  assert.ok(links.length >= 5, `${constName} parsed`)
  return links
}

const SHELL: Record<SearchRole, ShellDestination[]> = {
  coach: shellLinks("coachLinks"),
  athlete: shellLinks("athleteLinks"),
  "club-admin": shellLinks("clubAdminLinks"),
  guardian: shellLinks("guardianLinks"),
  "platform-admin": shellLinks("platformAdminLinks"),
}

const routePatterns = [...routerSource.matchAll(/<Route path="(\/[^"]+)"/g)].map((match) => new RegExp(`^${match[1].replace(/:[A-Za-z]+/g, "[^/]+")}$`))
const routeExists = (href: string) => routePatterns.some((pattern) => pattern.test(href.split("?")[0]))

/** As the shell does for a coach with a selected team, and for an assistant coach. */
function coachDestinations(assistant: boolean): ShellDestination[] {
  return SHELL.coach
    .filter((link) => !assistant || !["plans", "reports", "competitions"].includes(link.id))
    .map((link) => (link.href === "/coach/teams" ? { ...link, href: "/coach/teams/t1" } : link))
}

const destinationsFor = (role: SearchRole) => (role === "coach" ? coachDestinations(false) : SHELL[role])

test("text is folded: case and accents do not matter", () => {
  assert.equal(foldText("José NÚÑEZ"), "jose nunez")
  assert.equal(foldText("Straße Łódź Øre"), "strasse lodz ore")
  assert.equal(foldText(null), "")
})

test("the query is trimmed, collapsed and capped, and needs two characters", () => {
  assert.equal(cleanQuery("   maya    chen  "), "maya chen")
  assert.equal(cleanQuery("x".repeat(500)).length, 80)
  assert.equal(isSearchable(" m "), false)
  assert.equal(isSearchable("ma"), true)
  assert.equal(isSearchable(null), false)
})

test("rank: exact, starts with, a word starts with, inside, no match", () => {
  assert.equal(rankText("Block", "block"), 0)
  assert.equal(rankText("Blockade", "block"), 1)
  assert.equal(rankText("Sprint block", "block"), 2)
  assert.equal(rankText("Roadblocks", "block"), 3)
  assert.equal(rankText("Tempo", "block"), null)
  assert.equal(rankText("José Núñez", "nun"), 2)
})

test("order: best rank, then most recent, then by name", () => {
  const hit = (title: string, rank: number, sortDate: string | null) => ({ title, rank, sortDate })
  const sorted = [hit("Sprint block", 2, "2026-03-01"), hit("Blockade old", 1, "2024-01-01"), hit("Block", 0, "2025-01-01"), hit("Blockade new", 1, "2026-06-01"), hit("Blockade undated", 1, null)].sort(compareHits)
  assert.deepEqual(sorted.map((item) => item.title), ["Block", "Blockade new", "Blockade old", "Blockade undated", "Sprint block"])
})

test("candidates are ranked, matched on hidden text as 'inside', and capped per kind", () => {
  const candidates: SearchCandidate[] = [
    { kind: "competition", id: "c1", title: "Spring Open", extra: ["National Stadium"], sortDate: "2026-05-01" },
    { kind: "competition", id: "c2", title: "National Trials", sortDate: "2026-06-01" },
    { kind: "athlete", id: "a1", title: "Nat Jones" },
    { kind: "session", id: "s1", title: "Not for a coach" },
  ]
  const hits = rankCandidates("coach", candidates, "  NAT ")
  assert.deepEqual(hits.map((hit) => `${hit.kind}:${hit.title}:${hit.rank}`), ["competition:National Trials:1", "athlete:Nat Jones:1", "competition:Spring Open:3"])
  assert.equal(hits.find((hit) => hit.id === "a1")?.href, "/coach/athletes/a1")
  assert.deepEqual(rankCandidates("coach", candidates, "n"), [])
  const many: SearchCandidate[] = Array.from({ length: 30 }, (_, index) => ({ kind: "athlete", id: `a${index}`, title: `Maya ${index}` }))
  assert.equal(rankCandidates("coach", many, "maya", 20).length, 20)
})

test("hits are grouped per role in a fixed order, five shown until a group is opened", () => {
  const make = (kind: SearchHit["kind"], title: string): SearchHit => ({ kind, id: title, title, subtitle: null, href: "/x", rank: 1, sortDate: null })
  const hits = [make("screen", "Plans"), make("template", "Base"), ...Array.from({ length: 7 }, (_, index) => make("athlete", `Maya ${index}`)), make("plan", "Build"), make("club", "Not for a coach")]
  const groups = groupHits("coach", hits)
  assert.deepEqual(groups.map((group) => `${group.label}:${group.hits.length}`), ["Athletes:7", "Plans and templates:2", "Screens:1"])
  assert.equal(visibleHits(groups, new Set()).length, 5 + 2 + 1)
  assert.equal(visibleHits(groups, new Set(["athletes"])).length, 7 + 2 + 1)
  // An assistant coach has no plans screens.
  assert.deepEqual(groupHits("coach", hits, { assistant: true }).map((group) => group.label), ["Athletes", "Screens"])
})

test("each role only has the kinds listed for it", () => {
  assert.equal(kindAllowed("athlete", "athlete"), false)
  assert.equal(kindAllowed("guardian", "session"), false)
  assert.equal(kindAllowed("guardian", "coach"), false)
  assert.equal(kindAllowed("platform-admin", "athlete"), false)
  assert.equal(kindAllowed("coach", "staff"), false)
  assert.equal(kindAllowed("club-admin", "exercise"), false)
  assert.deepEqual(SEARCH_GROUPS.guardian.flatMap((group) => group.kinds), ["child", "competition", "screen"])
})

test("every kind of every role leads to a screen that exists and that the role may open", () => {
  for (const role of ROLES) {
    for (const group of SEARCH_GROUPS[role]) {
      for (const kind of group.kinds) {
        if (kind === "screen") continue
        const href = hrefForHit(role, kind, "id-1", { date: "2026-03-12", eventGroup: "k:100m", coachUserId: "u1", canMessage: true })
        assert.ok(href, `${role} ${kind} has a destination`)
        assert.ok(routeExists(href), `${role} ${kind} goes to a real route: ${href}`)
        assert.equal(evaluateAccess({ pathname: href.split("?")[0], isAuthenticated: true, role, tenantId: role === "platform-admin" ? null : "t" }).allowed, true, `${role} may open ${href}`)
      }
    }
  }
  // A kind the role does not have goes nowhere.
  assert.equal(hrefForHit("athlete", "athlete", "a1"), null)
  assert.equal(hrefForHit("guardian", "session", "s1"), null)
  assert.equal(hrefForHit("platform-admin", "athlete", "a1"), null)
  // A coach who cannot be messaged is opened on the profile instead.
  assert.equal(hrefForHit("athlete", "coach", "u1", { coachUserId: "u1", canMessage: false }), "/athlete/profile")
})

test("screen index per role: built from the shell's links, every screen exists and is open to that role only", () => {
  for (const role of ROLES) {
    const index = buildScreenIndex(role, destinationsFor(role))
    assert.ok(index.length >= SHELL[role].length, `${role} has its shell destinations`)
    for (const link of destinationsFor(role)) assert.ok(index.some((screen) => screen.href === link.href), `${role} index has ${link.label}`)
    for (const screen of index) {
      assert.ok(screen.href, "screen has a destination")
      const path = screen.href.split("?")[0]
      assert.ok(routeExists(path), `${role}: ${screen.title} is a real route (${path})`)
      assert.equal(evaluateAccess({ pathname: path, isAuthenticated: true, role, tenantId: role === "platform-admin" ? null : "t" }).allowed, true, `${role} may open ${path}`)
      for (const other of ROLES) {
        if (other === role || path === "/account" || path.startsWith("/settings/") || path === "/notifications") continue
        // A club admin can also coach a team, so the coach screens are open to them by design.
        if (other === "club-admin" && role === "coach") continue
        assert.equal(evaluateAccess({ pathname: path, isAuthenticated: true, role: other, tenantId: other === "platform-admin" ? null : "t" }).allowed, false, `${other} may not open ${role}'s ${path}`)
      }
    }
    assert.equal(new Set(index.map((screen) => screen.href)).size, index.length, `${role}: no screen twice`)
    // Every extra screen hangs off a destination the shell really has.
    for (const extra of EXTRA_SCREENS[role]) assert.ok(SHELL[role].some((link) => link.id === extra.under), `${role}: ${extra.label} sits under a real destination`)
  }
})

test("screen index: typing a screen's name or another word for it offers the screen", () => {
  const coach = buildScreenIndex("coach", destinationsFor("coach"))
  assert.deepEqual(searchScreens("coach", coach, "attendance").map((hit) => hit.href), ["/coach/teams/t1/attendance"])
  assert.deepEqual(searchScreens("coach", coach, "best lifts").map((hit) => hit.href), ["/coach/training-plan/maxes"])
  assert.deepEqual(searchScreens("coach", coach, "maxes").map((hit) => hit.title), ["Best lifts"])
  const athlete = buildScreenIndex("athlete", SHELL.athlete)
  assert.deepEqual(searchScreens("athlete", athlete, "personal bests").map((hit) => hit.href), ["/athlete/prs"])
  assert.equal(searchScreens("athlete", athlete, "attendance").length, 0)
  assert.equal(searchScreens("guardian", buildScreenIndex("guardian", SHELL.guardian), "best lifts").length, 0)
})

test("screen index: a screen is not offered when the shell does not show its destination", () => {
  const assistant = buildScreenIndex("coach", coachDestinations(true), { assistant: true })
  const titles = assistant.map((screen) => screen.title)
  for (const hidden of ["Plans", "Best lifts", "Exercise library", "Plan templates", "Training load", "Reports", "Competitions", "Add a competition", "New announcement"]) {
    assert.equal(titles.includes(hidden), false, `assistant is not offered ${hidden}`)
  }
  assert.ok(titles.includes("Attendance"))
  assert.ok(titles.includes("Test weeks"))
  // A coach with no team selected has no attendance screen to go to.
  assert.equal(buildScreenIndex("coach", SHELL.coach).some((screen) => screen.title === "Attendance"), false)
  // Destinations that belong to another role are ignored.
  assert.deepEqual(buildScreenIndex("guardian", SHELL.coach).map((screen) => screen.href), ["/account", "/settings/notifications", "/notifications"])
})

test("server rows become hits; unknown kinds, kinds of another role and bad rows are dropped", () => {
  const rows = [
    { kind: "athlete", id: "a1", title: "Maya Chen", subtitle: "Sprints", params: { athleteId: "a1" }, rank: 1, sort_date: null },
    { kind: "staff", id: "u1", title: "Coach Rivera", subtitle: null, params: {}, rank: 1, sort_date: null },
    { kind: "wellness", id: "w1", title: "Sleep 4h", subtitle: null, params: {}, rank: 1, sort_date: null },
    { kind: "plan", id: "p1", title: "Sprint block", subtitle: " ", params: {}, rank: 2, sort_date: "2026-03-01" },
    { kind: "athlete", id: null, title: "No id" },
    null,
  ]
  assert.deepEqual(hitsFromRows("coach", rows).map((hit) => `${hit.kind}:${hit.href}:${hit.subtitle}`), ["athlete:/coach/athletes/a1:Sprints", "plan:/coach/training-plan:null"])
  assert.deepEqual(hitsFromRows("coach", rows, { assistant: true }).map((hit) => hit.kind), ["athlete"])
  assert.deepEqual(hitsFromRows("athlete", rows), [])
  assert.deepEqual(hitsFromRows("coach", "nonsense"), [])
  assert.equal(hitsFromRows("guardian", [{ kind: "child", id: "a2", title: "Young Kid" }])[0].childId, "a2")
})

test("recent searches: newest first, no repeats, six at most, bad storage reads as empty", () => {
  let list: string[] = []
  for (const query of ["maya", "tempo", "Maya", "  block ", "m"]) list = addRecent(list, query)
  assert.deepEqual(list, ["block", "Maya", "tempo"])
  for (let index = 0; index < 10; index += 1) list = addRecent(list, `query ${index}`)
  assert.equal(list.length, 6)
  assert.deepEqual(parseRecent("{not json"), [])
  assert.deepEqual(parseRecent(JSON.stringify({ a: 1 })), [])
  assert.deepEqual(parseRecent(JSON.stringify(["ok", 5, "x", "  two words "])), ["ok", "two words"])
  assert.deepEqual(parseRecent(null), [])
})

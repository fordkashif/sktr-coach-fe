import test from "node:test"
import assert from "node:assert/strict"
import {
  addDays,
  applyRolloverToSeasons,
  findOverlap,
  pickableSeasons,
  rangesOverlap,
  seasonBestWindow,
  seasonForDate,
  summarizeRollover,
  validateRolloverDraft,
  validateSeasonDraft,
  type ClubSeason,
  type RolloverPlan,
} from "../src/lib/data/club-admin/season-logic"
import { selectBests, type AthleteResult } from "../src/lib/data/pr/marks"

const seasons: ClubSeason[] = [
  { id: "s25", name: "2025", start: "2025-01-10", end: "2025-10-30", status: "past" },
  { id: "s26", name: "2026", start: "2026-01-10", end: "2026-10-30", status: "current" },
  { id: "s27", name: "2026/27 outdoor", start: "2026-11-01", end: "2027-10-31", status: "upcoming" },
]

test("date ranges overlap when they share a day, and only then", () => {
  assert.equal(rangesOverlap({ start: "2026-01-01", end: "2026-06-30" }, { start: "2026-06-30", end: "2026-12-31" }), true)
  assert.equal(rangesOverlap({ start: "2026-01-01", end: "2026-06-30" }, { start: "2026-07-01", end: "2026-12-31" }), false)
  assert.equal(rangesOverlap({ start: "2026-03-01", end: "2026-03-01" }, { start: "2026-01-01", end: "2026-12-31" }), true)
})

test("findOverlap names the season that clashes and can ignore the season being edited", () => {
  assert.equal(findOverlap(seasons, { start: "2026-10-30", end: "2026-10-31" })?.id, "s26")
  assert.equal(findOverlap(seasons, { start: "2026-10-31", end: "2026-10-31" }), null)
  assert.equal(findOverlap(seasons, { start: "2026-01-10", end: "2026-10-30" }, "s26"), null)
  assert.equal(findOverlap(seasons, { start: "2025-01-01", end: "2027-12-31" })?.id, "s25")
})

test("seasonForDate finds the season a day falls in, or none between seasons", () => {
  assert.equal(seasonForDate(seasons, "2026-01-10")?.id, "s26")
  assert.equal(seasonForDate(seasons, "2026-10-30T12:00:00Z")?.id, "s26")
  assert.equal(seasonForDate(seasons, "2026-10-31"), null)
  assert.equal(seasonForDate(seasons, "2025-06-01")?.id, "s25")
  assert.equal(seasonForDate(seasons, "2026-12-01")?.id, "s27")
})

test("season best window is the current season until its last day has passed, then the calendar year", () => {
  assert.deepEqual(seasonBestWindow(seasons, "2026-06-01"), { start: "2026-01-10", end: "2026-10-30" })
  assert.deepEqual(seasonBestWindow(seasons, "2026-10-30"), { start: "2026-01-10", end: "2026-10-30" })
  assert.deepEqual(seasonBestWindow(seasons, "2026-11-15"), { start: "2026-01-01", end: "2026-12-31" })
  assert.deepEqual(seasonBestWindow([], "2026-06-01"), { start: "2026-01-01", end: "2026-12-31" })
  // An upcoming season never sets the window.
  assert.deepEqual(seasonBestWindow([seasons[2]], "2026-12-01"), { start: "2026-01-01", end: "2026-12-31" })
})

test("after a rollover the window is the new season, even before its first day", () => {
  const plan: RolloverPlan = { seasonId: "s27", draft: { name: "2026/27 outdoor", start: "2026-11-01", end: "2027-10-31" }, teamChoices: {}, endPlans: false }
  const after = applyRolloverToSeasons(seasons, plan)
  assert.deepEqual(seasonBestWindow(after, "2026-10-20"), { start: "2026-11-01", end: "2027-10-31" })
  assert.deepEqual(seasonBestWindow(after, "2026-11-20"), { start: "2026-11-01", end: "2027-10-31" })
})

function result(id: string, date: string, value: number): AthleteResult {
  return {
    id, athleteId: "a", eventKey: "100m", eventLabel: "100m", eventGroup: "100m", category: "Sprints", unit: "s", lowerIsBetter: true, value, compareValue: value,
    display: value.toFixed(2), timing: "electronic", date, source: "manual", competitionId: null, competitionEntryId: null, testWeekId: null, wind: 0.5, windLegal: true,
    environment: "outdoor", altitude: false, location: null, notes: null, recordedByUserId: null, createdAt: `${date}T10:00:00Z`,
  } as unknown as AthleteResult
}

test("season best counts from the new season's start; the all time best is untouched", () => {
  const results = [result("old", "2026-05-01", 10.9), result("new", "2026-11-05", 11.2)]
  const before = selectBests(results, seasonBestWindow(seasons, "2026-06-01"))
  assert.equal(before.seasonBest?.id, "old")
  const after = applyRolloverToSeasons(seasons, { seasonId: "s27", draft: { name: "2026/27 outdoor", start: "2026-11-01", end: "2027-10-31" }, teamChoices: {}, endPlans: false })
  const bests = selectBests(results, seasonBestWindow(after, "2026-11-10"))
  assert.equal(bests.seasonBest?.id, "new")
  assert.equal(bests.personalBest?.id, "old")
  // History can still be filtered by the past season.
  const past = after.find((season) => season.id === "s26")!
  assert.equal(selectBests(results, { start: past.start, end: past.end }).seasonBest?.id, "old")
})

test("validateSeasonDraft checks the name, the dates and overlap", () => {
  assert.equal(validateSeasonDraft({ name: " ", start: "2028-01-01", end: "2028-10-31" }, seasons).ok, false)
  assert.equal(validateSeasonDraft({ name: "2026", start: "2028-01-01", end: "2028-10-31" }, seasons).ok, false)
  assert.equal(validateSeasonDraft({ name: "2028", start: "2028-10-31", end: "2028-01-01" }, seasons).ok, false)
  assert.equal(validateSeasonDraft({ name: "2028", start: "2028-02-30", end: "2028-10-01" }, seasons).ok, false)
  const clash = validateSeasonDraft({ name: "2028", start: "2027-10-31", end: "2028-10-01" }, seasons)
  assert.equal(clash.ok, false)
  if (!clash.ok) assert.match(clash.errors.start ?? "", /overlap 2026\/27 outdoor/)
  const fine = validateSeasonDraft({ name: " 2028 ", start: "2028-01-01", end: "2028-10-31" }, seasons)
  assert.deepEqual(fine, { ok: true, data: { name: "2028", start: "2028-01-01", end: "2028-10-31" } })
  // Editing a season does not clash with itself.
  assert.equal(validateSeasonDraft({ name: "2026", start: "2026-01-05", end: "2026-10-30" }, seasons, "s26").ok, true)
})

test("the rollover may cut the ending season short but not start before it", () => {
  assert.equal(validateRolloverDraft({ name: "2026/27 outdoor", start: "2026-10-05", end: "2027-10-31" }, seasons, "s27").ok, true)
  assert.equal(validateRolloverDraft({ name: "2026/27 outdoor", start: "2026-01-10", end: "2027-10-31" }, seasons, "s27").ok, false)
  assert.equal(validateRolloverDraft({ name: "2026/27 outdoor", start: "2025-10-30", end: "2027-10-31" }, seasons, "s27").ok, false)
  assert.equal(validateRolloverDraft({ name: "2026", start: "2026-11-01", end: "2027-10-31" }, seasons, "s27").ok, false)
})

test("the summary says exactly what the rollover changes", () => {
  const teams = [
    { id: "t1", name: "Sprint Group", athleteCount: 12 },
    { id: "t2", name: "Distance Group", athleteCount: 10 },
    { id: "t3", name: "Jumps Group", athleteCount: 0 },
  ]
  const plan: RolloverPlan = { seasonId: "s27", draft: { name: "2026/27 outdoor", start: "2026-10-05", end: "2027-10-31" }, teamChoices: { t2: "archive", t3: "archive", t1: "carry" }, endPlans: true }
  const summary = summarizeRollover(plan, seasons, teams, 3)
  assert.deepEqual(summary.archivedTeams.map((team) => team.id), ["t2", "t3"])
  assert.deepEqual(summary.carriedTeams.map((team) => team.id), ["t1"])
  assert.equal(summary.athletesUnassigned, 10)
  assert.equal(summary.plansEnded, 3)
  assert.equal(summary.plansCarried, 0)
  assert.deepEqual(summary.oldSeason, { name: "2026", start: "2026-01-10", end: "2026-10-04", endsEarly: true })
  const keep = summarizeRollover({ ...plan, draft: { ...plan.draft, start: "2026-11-01" }, teamChoices: {}, endPlans: false }, seasons, teams, 3)
  assert.equal(keep.archivedTeams.length, 0)
  assert.equal(keep.plansEnded, 0)
  assert.equal(keep.plansCarried, 3)
  assert.equal(keep.oldSeason?.end, "2026-10-30")
  assert.equal(keep.oldSeason?.endsEarly, false)
})

test("applying the rollover keeps every season, with one current", () => {
  const after = applyRolloverToSeasons(seasons, { seasonId: "s27", draft: { name: "2026/27", start: "2026-10-05", end: "2027-10-31" }, teamChoices: {}, endPlans: false })
  assert.equal(after.length, seasons.length)
  assert.deepEqual(after.filter((season) => season.status === "current").map((season) => season.id), ["s27"])
  assert.deepEqual(after.find((season) => season.id === "s26"), { id: "s26", name: "2026", start: "2026-01-10", end: "2026-10-04", status: "past" })
  assert.equal(findOverlap(after, after.find((season) => season.id === "s27")!, "s27"), null)
  assert.deepEqual(pickableSeasons(after).map((season) => season.id), ["s27", "s26", "s25"])
})

test("addDays crosses months and years", () => {
  assert.equal(addDays("2026-11-01", -1), "2026-10-31")
  assert.equal(addDays("2026-12-31", 1), "2027-01-01")
  assert.equal(addDays("2028-02-28", 1), "2028-02-29")
})

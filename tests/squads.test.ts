import test from "node:test"
import assert from "node:assert/strict"
import {
  cleanSquadName,
  dayClashText,
  findDayClashes,
  liveSquadIds,
  memberChanges,
  membersOnTeam,
  reachedAthleteIds,
  squadNamesText,
  squadsByAthlete,
  validateSquadInput,
  withoutAthlete,
  type Squad,
} from "../src/lib/data/coach/squads"

const athletes = [
  { id: "a1", teamId: "t1", eventGroup: "Sprint" },
  { id: "a2", teamId: "t1", eventGroup: "Sprint" },
  { id: "a3", teamId: "t1", eventGroup: "Mid" },
  { id: "a4", teamId: "t1", eventGroup: "Mid" },
  { id: "b1", teamId: "t2", eventGroup: "Jumps" },
]

const squad = (id: string, teamId: string, athleteIds: string[], name = id): Squad => ({ id, teamId, name, color: null, note: null, athleteIds })
const squads = [squad("short", "t1", ["a1", "a2"]), squad("400", "t1", ["a2", "a3"]), squad("juniors", "t1", []), squad("jumps", "t2", ["b1"])]

test("a whole team plan reaches every athlete of that team and nobody else", () => {
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "team" }, athletes, squads), ["a1", "a2", "a3", "a4"])
})

test("a squad plan reaches the squad's members", () => {
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "squads", squadIds: ["short"] }, athletes, squads), ["a1", "a2"])
})

test("an athlete in two chosen squads is reached once", () => {
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "squads", squadIds: ["short", "400"] }, athletes, squads), ["a1", "a2", "a3"])
})

test("an empty squad, no squads and unknown squads reach nobody", () => {
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "squads", squadIds: ["juniors"] }, athletes, squads), [])
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "squads", squadIds: [] }, athletes, squads), [])
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "squads" }, athletes, squads), [])
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "squads", squadIds: ["gone"] }, athletes, squads), [])
})

test("a squad of another team is ignored, so a plan never leaves its team", () => {
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "squads", squadIds: ["jumps"] }, athletes, squads), [])
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "squads", squadIds: ["jumps", "short"] }, athletes, squads), ["a1", "a2"])
})

test("a member who is no longer on the team is not reached", () => {
  const stale = [squad("short", "t1", ["a1", "b1", "left-the-club"])]
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "squads", squadIds: ["short"] }, athletes, stale), ["a1"])
})

test("an athlete added to a squad later is reached, and one taken out is not", () => {
  const before = reachedAthleteIds({ teamId: "t1", target: "squads", squadIds: ["short"] }, athletes, squads)
  const changed = squads.map((item) => (item.id === "short" ? { ...item, athleteIds: ["a2", "a4"] } : item))
  const after = reachedAthleteIds({ teamId: "t1", target: "squads", squadIds: ["short"] }, athletes, changed)
  assert.deepEqual(before, ["a1", "a2"])
  assert.deepEqual(after, ["a2", "a4"])
})

test("athletes picked by name and an event group keep working", () => {
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "selected", athleteIds: ["a3", "b1", "a1"] }, athletes, squads), ["a1", "a3"])
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "subgroup", subgroup: "Mid" }, athletes, squads), ["a3", "a4"])
  assert.deepEqual(reachedAthleteIds({ teamId: "t1", target: "selected" }, athletes, squads), [])
})

test("only live squads of the plan's team stay chosen", () => {
  assert.deepEqual(liveSquadIds(["400", "archived", "jumps", "short"], squads, "t1"), ["short", "400"])
  assert.deepEqual(liveSquadIds([], squads, "t1"), [])
})

test("two plans on the same day: the athletes on both are found", () => {
  const squadPlan = { id: "p2", name: "Speed block", dates: ["2026-10-12", "2026-10-13", "2026-10-15"], athleteIds: ["a1", "a2"] }
  const teamPlan = { id: "p1", name: "Team base", dates: ["2026-10-12", "2026-10-14", "2026-10-15"], athleteIds: ["a1", "a2", "a3", "a4"] }
  const clash = findDayClashes(squadPlan, [teamPlan], "2026-10-01")
  assert.deepEqual(clash, { athleteIds: ["a1", "a2"], dates: ["2026-10-12", "2026-10-15"], planNames: ["Team base"] })
  assert.equal(dayClashText(clash!), "2 athletes also have a session from Team base on 2 of these days. They will see both sessions.")
})

test("no clash when the days differ, when nobody is on both plans, or when the days are over", () => {
  const plan = { id: "p2", name: "Speed block", dates: ["2026-10-12", "2026-10-13"], athleteIds: ["a1", "a2"] }
  assert.equal(findDayClashes(plan, [{ id: "p1", name: "Team base", dates: ["2026-10-14"], athleteIds: ["a1", "a2"] }], "2026-10-01"), null)
  assert.equal(findDayClashes(plan, [{ id: "p1", name: "Team base", dates: ["2026-10-12"], athleteIds: ["a3"] }], "2026-10-01"), null)
  assert.equal(findDayClashes(plan, [{ id: "p1", name: "Team base", dates: ["2026-10-12"], athleteIds: ["a1"] }], "2026-10-20"), null)
  assert.equal(findDayClashes(plan, [], "2026-10-01"), null)
  assert.equal(findDayClashes({ ...plan, athleteIds: [] }, [{ id: "p1", name: "Team base", dates: ["2026-10-12"], athleteIds: ["a1"] }], "2026-10-01"), null)
})

test("a plan never clashes with its own published copy, but a new plan is checked against everything", () => {
  const plan = { id: "p1", name: "Team base", dates: ["2026-10-12"], athleteIds: ["a1"] }
  assert.equal(findDayClashes(plan, [plan], "2026-10-01"), null)
  assert.deepEqual(findDayClashes({ ...plan, id: null }, [plan], "2026-10-01")?.athleteIds, ["a1"])
})

test("only days from the given date on count towards a clash", () => {
  const plan = { id: "p2", name: "Speed block", dates: ["2026-10-05", "2026-10-12"], athleteIds: ["a1"] }
  const other = { id: "p1", name: "Team base", dates: ["2026-10-05", "2026-10-12"], athleteIds: ["a1"] }
  assert.deepEqual(findDayClashes(plan, [other], "2026-10-10")?.dates, ["2026-10-12"])
})

test("several other plans are named once each, and one athlete on one day reads in the singular", () => {
  const plan = { id: "p3", name: "400 block", dates: ["2026-10-12", "2026-10-13"], athleteIds: ["a2", "a3"] }
  const clash = findDayClashes(
    plan,
    [
      { id: "p1", name: "Team base", dates: ["2026-10-12"], athleteIds: ["a2"] },
      { id: "p2", name: "Speed block", dates: ["2026-10-13"], athleteIds: ["a2"] },
      { id: "p4", name: "Team base", dates: ["2026-10-13"], athleteIds: ["a3"] },
    ],
    "2026-10-01",
  )
  assert.deepEqual(clash?.planNames, ["Team base", "Speed block"])
  assert.deepEqual(clash?.athleteIds, ["a2", "a3"])
  assert.equal(dayClashText(clash!), "2 athletes also have sessions from Team base and Speed block on 2 of these days. They will see both sessions.")
  assert.equal(
    dayClashText({ athleteIds: ["a1"], dates: ["2026-10-12"], planNames: ["Team base"] }),
    "1 athlete also has a session from Team base on 1 of these days. They will see both sessions.",
  )
})

test("squad names are tidied and checked against the team's other squads", () => {
  assert.equal(cleanSquadName("  Short   sprints "), "Short sprints")
  assert.deepEqual(validateSquadInput({ name: "  Short   sprints ", color: "blue", note: "  " }, []), { ok: true, data: { name: "Short sprints", color: "blue", note: null } })
  assert.deepEqual(validateSquadInput({ name: "   ", color: null, note: null }, []), { ok: false, message: "Give the squad a name." })
  assert.deepEqual(validateSquadInput({ name: "short SPRINTS", color: null, note: null }, [{ name: "Short sprints" }]), {
    ok: false,
    message: "This team already has a squad called short SPRINTS.",
  })
  const odd = validateSquadInput({ name: "Juniors", color: "pink" as never, note: "Under 18" }, [{ name: "400m" }])
  assert.deepEqual(odd, { ok: true, data: { name: "Juniors", color: null, note: "Under 18" } })
  assert.equal(cleanSquadName("x".repeat(80)).length, 60)
})

test("a squad only holds athletes of its team, each once", () => {
  assert.deepEqual(membersOnTeam(["a1", "b1", "a1", "a3"], ["a1", "a2", "a3"]), ["a1", "a3"])
  assert.deepEqual(memberChanges(["a1", "a2"], ["a2", "a3"]), { added: ["a3"], removed: ["a1"] })
  assert.deepEqual(memberChanges(["a1"], ["a1"]), { added: [], removed: [] })
})

test("leaving a team ends the squad memberships on that team only", () => {
  const moved = withoutAthlete(squads, "a2", "t2")
  assert.deepEqual(
    moved.map((item) => item.athleteIds),
    [["a1"], ["a3"], [], ["b1"]],
  )
  // Still on t1: nothing changes.
  assert.deepEqual(withoutAthlete(squads, "a2", "t1"), squads)
  // Off every team.
  assert.deepEqual(withoutAthlete(squads, "b1", null)[3].athleteIds, [])
})

test("squads by athlete, and how their names read", () => {
  const map = squadsByAthlete(squads)
  assert.deepEqual(map.get("a2")?.map((item) => item.id), ["short", "400"])
  assert.equal(map.get("a4"), undefined)
  assert.equal(squadNamesText([]), "")
  assert.equal(squadNamesText(["400m"]), "400m")
  assert.equal(squadNamesText(["400m", "Juniors"]), "400m and Juniors")
  assert.equal(squadNamesText(["400m", "Juniors", "Relay"]), "400m, Juniors and Relay")
})

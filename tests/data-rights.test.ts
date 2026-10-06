import test from "node:test"
import assert from "node:assert/strict"
import { inflateRawSync } from "node:zlib"
import {
  CLUB_EXPORT_HEALTH_REMINDER,
  COACH_NOTES_AREA_KEY,
  blockingTeamLine,
  buildClubExportFiles,
  buildPersonalExport,
  buildZip,
  columnsOf,
  crc32,
  csvCell,
  daysUntilDeletion,
  deletionCountdownText,
  deletionDateAfter,
  evaluateDeletion,
  fileSlug,
  isTypedConfirmation,
  personalExportFileName,
  rowsToCsv,
  safeZipName,
} from "../src/lib/data-rights"
import { evaluateAccess } from "../src/lib/access-control"
import { SCHEDULER_TOKEN_HEADER, handlePurgeDeletedStorage, isSafeObjectPath, type HandlerDeps } from "../supabase/functions/purge-deleted-storage/handler"

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** A small reader for the archive, written from the zip format, to check the writer against. */
function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = zip.length - 22
  assert.equal(view.getUint32(end, true), 0x06054b50, "end of central directory signature")
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const files: Array<{ name: string; data: Uint8Array; crc: number }> = []
  for (let i = 0; i < count; i += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, "central directory signature")
    const method = view.getUint16(offset + 10, true)
    const crc = view.getUint32(offset + 16, true)
    const size = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const local = view.getUint32(offset + 42, true)
    const name = text(zip.subarray(offset + 46, offset + 46 + nameLength))
    assert.equal(view.getUint32(local, true), 0x04034b50, "local header signature")
    const localNameLength = view.getUint16(local + 26, true)
    const start = local + 30 + localNameLength + view.getUint16(local + 28, true)
    const raw = zip.subarray(start, start + size)
    files.push({ name, data: method === 0 ? raw : inflateRawSync(raw), crc })
    offset += 46 + nameLength
  }
  return files
}

test("crc32 matches the published check values", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926)
  assert.equal(crc32(new Uint8Array()), 0)
  assert.equal(crc32(new TextEncoder().encode("The quick brown fox jumps over the lazy dog")), 0x414fa339)
})

test("zip writer stores every file with its name, bytes and checksum", () => {
  const zip = buildZip(
    [
      { name: "README.txt", data: "hello\r\n" },
      { name: "athletes.csv", data: "name\r\nZoë Åström\r\n" },
      { name: "empty.csv", data: new Uint8Array() },
    ],
    new Date(2026, 9, 14, 12, 30, 10),
  )
  const files = readZip(zip)
  assert.deepEqual(
    files.map((file) => file.name),
    ["README.txt", "athletes.csv", "empty.csv"],
  )
  assert.equal(text(files[0].data), "hello\r\n")
  assert.equal(text(files[1].data), "name\r\nZoë Åström\r\n")
  assert.equal(files[2].data.length, 0)
  for (const file of files) assert.equal(file.crc, crc32(file.data))
  // "PK" at the start, as every unzip tool expects.
  assert.equal(zip[0], 0x50)
  assert.equal(zip[1], 0x4b)
})

test("zip writer keeps names inside the archive and apart from each other", () => {
  assert.equal(safeZipName("../../etc/passwd"), "etc/passwd")
  assert.equal(safeZipName("/abs\\win.csv"), "abs/win.csv")
  assert.equal(safeZipName(" "), "file")
  const files = readZip(buildZip([{ name: "a.csv", data: "1" }, { name: "A.csv", data: "2" }, { name: "a.csv", data: "3" }]))
  assert.deepEqual(
    files.map((file) => file.name),
    ["a.csv", "A-2.csv", "a-3.csv"],
  )
})

test("an empty archive is still a valid zip", () => {
  const zip = buildZip([])
  assert.equal(zip.length, 22)
  assert.deepEqual(readZip(zip), [])
})

test("csv cells are quoted, escaped and safe to open in a spreadsheet", () => {
  assert.equal(csvCell("plain"), '"plain"')
  assert.equal(csvCell('He said "go"'), '"He said ""go"""')
  assert.equal(csvCell("line one\nline two, with a comma"), '"line one\nline two, with a comma"')
  assert.equal(csvCell(null), '""')
  assert.equal(csvCell(undefined), '""')
  assert.equal(csvCell(12.5), '"12.5"')
  assert.equal(csvCell(false), '"false"')
  assert.equal(csvCell(["knee", "ankle"]), '"[""knee"",""ankle""]"')
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"')
  // Formula injection: text that a spreadsheet would run gets an apostrophe. Numbers do not.
  assert.equal(csvCell("=SUM(A1:A9)"), "\"'=SUM(A1:A9)\"")
  assert.equal(csvCell("@cmd"), "\"'@cmd\"")
  assert.equal(csvCell("+1 876 555 0100"), "\"'+1 876 555 0100\"")
  assert.equal(csvCell("-0.4"), '"-0.4"')
  assert.equal(csvCell("+1.2"), '"+1.2"')
  assert.equal(csvCell(-3), '"-3"')
})

test("csv files have a header from every key seen and a byte order mark", () => {
  const rows = [{ id: 1, name: "Maya" }, { id: 2, team: "Sprints" }]
  assert.deepEqual(columnsOf(rows), ["id", "name", "team"])
  assert.equal(rowsToCsv(rows), '\uFEFF"id","name","team"\r\n"1","Maya",""\r\n"2","","Sprints"\r\n')
  assert.equal(rowsToCsv([]), "\uFEFF\r\n")
  assert.equal(rowsToCsv([], ["id", "name"]), '\uFEFF"id","name"\r\n')
})

test("file names are lower case words joined by dashes", () => {
  assert.equal(fileSlug("Elite Track Club", "data-export", "2026-10-14"), "elite-track-club-data-export-2026-10-14")
  assert.equal(fileSlug("  ", null), "export")
  assert.equal(personalExportFileName("Marcus Johnson", "2026-10-14T09:00:00.000Z"), "sktr-coach-my-data-marcus-johnson-2026-10-14.json")
})

test("personal export puts a summary with counts first and the records under data", () => {
  const file = buildPersonalExport({
    generatedAt: "2026-10-14T09:00:00.000Z",
    role: "athlete",
    account: { name: "Marcus Johnson", email: "marcus@example.com", club: "Elite Track Club" },
    areas: [
      { key: "account", label: "Account and profile", rows: [{ email: "marcus@example.com" }] },
      { key: "wellness_check_ins", label: "Wellness check-ins", rows: [{ sleep: 8 }, { sleep: 6 }] },
      { key: "messages", label: "Messages", rows: [], error: "permission denied" },
    ],
  })
  assert.deepEqual(Object.keys(file), ["summary", "data"])
  assert.equal(file.summary.total_records, 3)
  assert.deepEqual(file.summary.counts, [
    { area: "Account and profile", key: "account", records: 1 },
    { area: "Wellness check-ins", key: "wellness_check_ins", records: 2 },
    { area: "Messages", key: "messages", records: 0 },
  ])
  assert.deepEqual(file.summary.could_not_read, [{ area: "Messages", reason: "permission denied" }])
  assert.equal(file.summary.account.role, "athlete")
  assert.deepEqual(file.data.wellness_check_ins, [{ sleep: 8 }, { sleep: 6 }])
  // The summary is the first thing in the text of the file.
  assert.ok(JSON.stringify(file, null, 2).indexOf('"summary"') < JSON.stringify(file, null, 2).indexOf('"data"'))
})

test("coach notes about an athlete never reach the athlete's export", () => {
  const areas = [
    { key: "account", label: "Account", rows: [{ id: 1 }] },
    { key: COACH_NOTES_AREA_KEY, label: "Notes you wrote about athletes", rows: [{ body: "Private: struggling with confidence" }] },
    { key: "coach_athlete_notes", label: "Coach notes", rows: [{ body: "another" }] },
  ]
  const athlete = buildPersonalExport({ generatedAt: "2026-10-14T09:00:00.000Z", role: "athlete", account: { name: "A", email: "a@x.com", club: null }, areas })
  assert.deepEqual(Object.keys(athlete.data), ["account"])
  assert.equal(athlete.summary.total_records, 1)
  assert.ok(!JSON.stringify(athlete).includes("struggling"))
  assert.ok(athlete.summary.not_included.some((line) => line.includes("notes your coaches wrote")))

  // The coach who wrote them does get them.
  const coach = buildPersonalExport({ generatedAt: "2026-10-14T09:00:00.000Z", role: "coach", account: { name: "C", email: "c@x.com", club: null }, areas })
  assert.equal(coach.data[COACH_NOTES_AREA_KEY].length, 1)
  assert.ok(coach.summary.not_included.some((line) => line.includes("Your athletes")))
})

test("a sample export says it is a sample", () => {
  const file = buildPersonalExport({ generatedAt: "2026-10-14T09:00:00.000Z", role: "coach", account: { name: null, email: null, club: null }, areas: [], sample: true })
  assert.match(file.summary.about, /SAMPLE/)
  assert.equal(file.summary.total_records, 0)
})

const clubTables = () => [
  { file: "teams", label: "Teams", rows: [{ id: "t1", name: "Sprints" }] },
  { file: "athletes", label: "Athletes with private details", rows: [{ id: "a1", name: "Maya", medical_notes: "Asthma", guardian_name: "Pat" }], healthColumns: ["medical_notes"] },
  { file: "wellness", label: "Wellness check-ins", rows: [{ athlete_id: "a1", sleep_hours: 7 }], health: true },
  { file: "pain-reports", label: "Pain reports", rows: [{ athlete_id: "a1", severity: 3 }], health: true },
]

test("club export leaves health data out unless the box is ticked", () => {
  const result = buildClubExportFiles({ clubName: "Elite Track Club", generatedAt: "2026-10-14T09:00:00.000Z", generatedBy: "Ada Admin", includeHealth: false, tables: clubTables() })
  assert.deepEqual(
    result.files.map((file) => file.name),
    ["README.txt", "teams.csv", "athletes.csv"],
  )
  const athletes = result.files[2].data as string
  assert.ok(!athletes.includes("Asthma"))
  assert.ok(!athletes.includes("medical_notes"))
  assert.ok(athletes.includes("guardian_name"))
  const readme = result.files[0].data as string
  assert.match(readme, /Health data: not included/)
  assert.match(readme, /teams\.csv {2}1/)
  assert.match(readme, /Wellness check-ins/)
  assert.ok(!readme.includes(CLUB_EXPORT_HEALTH_REMINDER))
  assert.equal(result.zipName, "elite-track-club-data-export-2026-10-14.zip")
})

test("club export includes health data, with the reminder, when asked", () => {
  const result = buildClubExportFiles({ clubName: "Elite Track Club", generatedAt: "2026-10-14T09:00:00.000Z", generatedBy: null, includeHealth: true, tables: clubTables() })
  assert.deepEqual(
    result.files.map((file) => file.name),
    ["README.txt", "teams.csv", "athletes.csv", "wellness.csv", "pain-reports.csv"],
  )
  assert.ok((result.files[2].data as string).includes("Asthma"))
  const readme = result.files[0].data as string
  assert.ok(readme.includes(CLUB_EXPORT_HEALTH_REMINDER))
  assert.deepEqual(
    result.counts.map((item) => `${item.file}:${item.rows}`),
    ["teams.csv:1", "athletes.csv:1", "wellness.csv:1", "pain-reports.csv:1"],
  )
  // The whole thing zips and reads back.
  const files = readZip(buildZip(result.files))
  assert.equal(files.length, 5)
  assert.ok(text(files[3].data).includes("sleep_hours"))
})

test("club export says which table could not be read", () => {
  const result = buildClubExportFiles({
    clubName: "Club",
    generatedAt: "2026-10-14T09:00:00.000Z",
    generatedBy: null,
    includeHealth: false,
    tables: [{ file: "logs", label: "Session logs", rows: [], error: "timed out" }],
  })
  assert.match(result.files[0].data as string, /Could not be read in full:\r\n {2}Session logs: timed out/)
})

const team = (over: Partial<{ id: string; name: string; isLead: boolean; otherCoaches: number; athletes: number; archived: boolean }>) => ({
  id: "t1",
  name: "Sprints",
  isLead: false,
  otherCoaches: 1,
  athletes: 5,
  ...over,
})

test("an athlete can always delete their account", () => {
  const check = evaluateDeletion({ role: "athlete", email: " Marcus@Example.com " })
  assert.deepEqual(check, { role: "athlete", canDelete: true, reason: null, blockingTeams: [], email: "marcus@example.com" })
})

test("a coach is blocked by a team they lead or coach alone, and told which", () => {
  const check = evaluateDeletion({
    role: "coach",
    email: "c@x.com",
    teams: [
      team({ id: "t1", name: "Sprints", isLead: true }),
      team({ id: "t2", name: "Jumps", otherCoaches: 0, athletes: 1 }),
      team({ id: "t3", name: "Throws", otherCoaches: 2 }),
      team({ id: "t4", name: "Empty", otherCoaches: 0, athletes: 0 }),
      team({ id: "t5", name: "Old squad", isLead: true, archived: true }),
    ],
  })
  assert.equal(check.canDelete, false)
  assert.equal(check.reason, "teams")
  assert.deepEqual(
    check.blockingTeams.map((item) => `${item.teamName}:${item.reason}`),
    ["Jumps:only_coach", "Sprints:lead"],
  )
  assert.equal(blockingTeamLine(check.blockingTeams[0]), "You are the only coach of Jumps, which has 1 athlete.")
  assert.equal(blockingTeamLine(check.blockingTeams[1]), "You are the lead coach of Sprints.")
})

test("a coach who shares every team, or has none, can delete", () => {
  assert.equal(evaluateDeletion({ role: "coach", email: "c@x.com", teams: [team({ otherCoaches: 1 })] }).canDelete, true)
  assert.equal(evaluateDeletion({ role: "coach", email: "c@x.com", teams: [] }).canDelete, true)
  assert.equal(evaluateDeletion({ role: "coach", email: "c@x.com" }).canDelete, true)
})

test("the club owner must transfer or close first, other club admins can delete", () => {
  const owner = evaluateDeletion({ role: "club-admin", email: "o@x.com", isClubOwner: true })
  assert.equal(owner.canDelete, false)
  assert.equal(owner.reason, "club_owner")
  assert.equal(evaluateDeletion({ role: "club-admin", email: "a@x.com", isClubOwner: false }).canDelete, true)
  // An admin who also leads a team is blocked by the team.
  assert.equal(evaluateDeletion({ role: "club-admin", email: "a@x.com", isClubOwner: false, teams: [team({ isLead: true })] }).reason, "teams")
  // Owner first: that is the thing to fix first.
  assert.equal(evaluateDeletion({ role: "club-admin", email: "a@x.com", isClubOwner: true, teams: [team({ isLead: true })] }).reason, "club_owner")
})

test("a platform admin cannot delete their account in the app", () => {
  const check = evaluateDeletion({ role: "platform-admin", email: "p@x.com" })
  assert.equal(check.canDelete, false)
  assert.equal(check.reason, "platform_admin")
})

test("typed confirmations forgive case and spaces and nothing else", () => {
  assert.equal(isTypedConfirmation("Elite Track Club", "  elite   track club "), true)
  assert.equal(isTypedConfirmation("Elite Track Club", "Elite Track"), false)
  assert.equal(isTypedConfirmation("", ""), false)
  assert.equal(isTypedConfirmation(null, ""), false)
  assert.equal(isTypedConfirmation("a@x.com", "A@X.COM"), true)
})

test("a closed club is deleted 90 days after it was closed", () => {
  const closedAt = "2026-10-14T12:00:00.000Z"
  const deleteAfter = deletionDateAfter(closedAt)
  assert.equal(deleteAfter, "2027-01-12T12:00:00.000Z")
  assert.equal(daysUntilDeletion(deleteAfter, new Date(closedAt)), 90)
  assert.equal(daysUntilDeletion(deleteAfter, new Date("2027-01-11T13:00:00.000Z")), 1)
  assert.equal(daysUntilDeletion(deleteAfter, new Date("2027-01-12T12:00:00.000Z")), 0)
  assert.equal(daysUntilDeletion(deleteAfter, new Date("2027-03-01T00:00:00.000Z")), 0)
  assert.equal(deletionCountdownText(deleteAfter, new Date(closedAt)), "90 days left")
  assert.equal(deletionCountdownText(deleteAfter, new Date("2027-01-11T13:00:00.000Z")), "1 day left")
  assert.equal(deletionCountdownText(deleteAfter, new Date("2027-02-01T00:00:00.000Z")), "Due for deletion now")
})

/* ---------- The storage clean-up function (supabase/functions/purge-deleted-storage) ---------- */

type FakeQueueRow = { id: string; bucket_id: string; object_path: string }

function fakeWorld(queue: FakeQueueRow[], options: { platformAdmin?: boolean; signedIn?: boolean; tokenOk?: boolean; removeFails?: string[] } = {}) {
  const removed: Array<{ bucket: string; paths: string[] }> = []
  const finished: Array<{ id: string; error: string | null }> = []
  let claimed = false
  const service = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "verify_notification_scheduler_token") return { data: options.tokenOk === true, error: null }
      if (name === "claim_storage_deletions") {
        if (claimed) return { data: [], error: null }
        claimed = true
        return { data: queue, error: null }
      }
      if (name === "finish_storage_deletion") {
        finished.push({ id: String(args.p_id), error: (args.p_error as string | null) ?? null })
        return { data: null, error: null }
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } }
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          if (options.removeFails?.includes(bucket)) return { data: null, error: { message: "bucket unavailable" } }
          removed.push({ bucket, paths })
          return { data: [], error: null }
        },
      }),
    },
  }
  const user = {
    auth: { getUser: async () => (options.signedIn === false ? { data: { user: null }, error: { message: "bad jwt" } } : { data: { user: { id: "u1" } }, error: null }) },
    rpc: async () => ({ data: options.platformAdmin === true, error: null }),
  }
  const deps: HandlerDeps = {
    getEnv: (name) => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" })[name],
    createUserClient: () => user,
    createServiceClient: () => service,
  }
  return { deps, removed, finished }
}

const purgeRequest = (headers: Record<string, string>) => new Request("https://x.supabase.co/functions/v1/purge-deleted-storage", { method: "POST", headers, body: "{}" })

test("storage clean-up: refuses a caller who is not a platform admin, and removes nothing", async () => {
  const queue = [{ id: "1", bucket_id: "avatars", object_path: "user/a.jpg" }]
  const anonymous = fakeWorld(queue)
  assert.equal((await handlePurgeDeletedStorage(purgeRequest({}), anonymous.deps)).status, 401)
  const member = fakeWorld(queue, { platformAdmin: false })
  assert.equal((await handlePurgeDeletedStorage(purgeRequest({ Authorization: "Bearer member-jwt" }), member.deps)).status, 403)
  const badJwt = fakeWorld(queue, { signedIn: false })
  assert.equal((await handlePurgeDeletedStorage(purgeRequest({ Authorization: "Bearer nonsense" }), badJwt.deps)).status, 401)
  const badToken = fakeWorld(queue, { tokenOk: false })
  assert.equal((await handlePurgeDeletedStorage(purgeRequest({ [SCHEDULER_TOKEN_HEADER]: "wrong" }), badToken.deps)).status, 401)
  for (const world of [anonymous, member, badJwt, badToken]) assert.deepEqual(world.removed, [])
})

test("storage clean-up: a platform admin or the scheduler removes the queued files, bucket by bucket", async () => {
  const queue = [
    { id: "1", bucket_id: "avatars", object_path: "user-1/a.jpg" },
    { id: "2", bucket_id: "club-logos", object_path: "club-1/logo.png" },
    { id: "3", bucket_id: "avatars", object_path: "user-2/b.jpg" },
  ]
  const callers: Array<Record<string, string>> = [{ Authorization: "Bearer admin-jwt" }, { [SCHEDULER_TOKEN_HEADER]: "right" }, { Authorization: "Bearer service-role-key" }]
  for (const headers of callers) {
    const world = fakeWorld(queue, { platformAdmin: true, tokenOk: true })
    const response = await handlePurgeDeletedStorage(purgeRequest(headers), world.deps)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, removed: 3, failed: 0 })
    assert.deepEqual(world.removed, [
      { bucket: "avatars", paths: ["user-1/a.jpg", "user-2/b.jpg"] },
      { bucket: "club-logos", paths: ["club-1/logo.png"] },
    ])
    assert.deepEqual(world.finished.map((item) => item.error), [null, null, null])
  }
})

test("storage clean-up: never touches another bucket or a path that climbs out, and reports failures", async () => {
  const world = fakeWorld(
    [
      { id: "1", bucket_id: "private-documents", object_path: "x/y.pdf" },
      { id: "2", bucket_id: "avatars", object_path: "../club-logos/z.png" },
      { id: "3", bucket_id: "club-logos", object_path: "club-1/logo.png" },
      { id: "4", bucket_id: "avatars", object_path: "user-1/a.jpg" },
    ],
    { platformAdmin: true, removeFails: ["club-logos"] },
  )
  const response = await handlePurgeDeletedStorage(purgeRequest({ Authorization: "Bearer admin-jwt" }), world.deps)
  assert.deepEqual(await response.json(), { ok: true, removed: 1, failed: 3 })
  assert.deepEqual(world.removed, [{ bucket: "avatars", paths: ["user-1/a.jpg"] }])
  assert.equal(world.finished.find((item) => item.id === "3")?.error, "bucket unavailable")
  assert.equal(world.finished.find((item) => item.id === "4")?.error, null)
  assert.equal(isSafeObjectPath("a/b.jpg"), true)
  assert.equal(isSafeObjectPath("/a/b.jpg"), false)
  assert.equal(isSafeObjectPath("a//b.jpg"), false)
  assert.equal(isSafeObjectPath(""), false)
})

test("a member of a closed club gets the closed notice on every tenant route", () => {
  for (const role of ["athlete", "coach", "club-admin"] as const) {
    const pathname = role === "athlete" ? "/athlete/home" : role === "coach" ? "/coach/dashboard" : "/club-admin/dashboard"
    const result = evaluateAccess({ pathname, isAuthenticated: true, role, tenantId: "club-1", tenantLifecycleStatus: "closed" })
    assert.equal(result.allowed, false)
    assert.equal(result.blocked, "club-closed")
    assert.equal(result.redirectTo, undefined)
  }
  assert.equal(evaluateAccess({ pathname: "/account", isAuthenticated: true, role: "coach", tenantId: "club-1", tenantLifecycleStatus: "closed" }).blocked, "club-closed")
  // The platform admin is not a member of any club.
  assert.equal(evaluateAccess({ pathname: "/platform-admin/tenants", isAuthenticated: true, role: "platform-admin", tenantId: "platform", tenantLifecycleStatus: "closed" }).allowed, true)
})

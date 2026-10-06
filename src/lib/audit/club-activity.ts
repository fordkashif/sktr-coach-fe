import { getPackageById } from "@/lib/billing/package-catalog"

/**
 * Turns one row of a club's audit log (audit_events, or the mock audit log) into a plain sentence.
 *
 * EVERY action code the app writes to audit_events is listed in SENTENCES below: the ones the
 * browser writes (insertAuditEvent / the mock logger), the ones the database functions write
 * (supabase/migrations 202610*) and the ones the send-invite-email edge function writes.
 * When you add a new action code anywhere, add it here. A code that is not listed still shows,
 * as its own words ("coach_invite_send" becomes "Coach invite send"), so nothing is ever hidden.
 */

export type ActivityGroup = "people" | "invites" | "teams" | "athletes" | "tests" | "messages" | "club" | "exports" | "other"

export const ACTIVITY_GROUPS: Array<{ key: ActivityGroup; label: string }> = [
  { key: "people", label: "People and access" },
  { key: "invites", label: "Invites and join codes" },
  { key: "teams", label: "Teams" },
  { key: "athletes", label: "Athletes" },
  { key: "tests", label: "Test weeks" },
  { key: "messages", label: "Messages" },
  { key: "club", label: "Club and billing" },
  { key: "exports", label: "Downloads" },
  { key: "other", label: "Other" },
]

export type ClubAuditRow = { action: string; target: string; detail: string | null }
export type ClubActivity = { group: ActivityGroup; title: string; detail: string | null }

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const EXPORT_LABEL: Record<string, string> = {
  teams: "team summary",
  adherence: "plan adherence report",
  wellness: "wellness check-ins report",
  prs: "records report",
  records: "records report",
  competitions: "competition results report",
  users: "people list",
  people: "people list",
  performance: "performance report",
  audit: "activity log",
  reports: "reports",
}

const ROLE_WORD: Record<string, string> = { "club-admin": "club admin", coach: "coach", athlete: "athlete" }

function packageName(id: string) {
  return getPackageById(id)?.label ?? `${id.charAt(0).toUpperCase()}${id.slice(1)}`
}

/** The target as something a person can read: never a bare database id. */
function named(target: string, fallback: string) {
  const value = target.trim()
  return value && !UUID.test(value) ? value : fallback
}

/** Detail text is shown only when it reads as words. Anything carrying a database id is dropped. */
function words(detail: string | null) {
  const value = detail?.trim()
  if (!value || UUID.test(value)) return null
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** "team Sprint Group" or "lead Coach Rivera" style details: the part after the first word. */
function after(detail: string | null, prefix: string) {
  const value = detail?.trim() ?? ""
  if (!value.toLowerCase().startsWith(`${prefix} `)) return null
  const rest = value.slice(prefix.length + 1).trim()
  return rest && !UUID.test(rest) ? rest : null
}

type Describe = (row: ClubAuditRow) => { title: string; detail?: string | null }

const SENTENCES: Record<string, { group: ActivityGroup; describe: Describe }> = {
  // People and access
  role_assign: {
    group: "people",
    describe: (row) => {
      const role = after(row.detail, "role")
      return { title: `Changed the role of ${named(row.target, "a member")}${role ? ` to ${ROLE_WORD[role] ?? role}` : ""}` }
    },
  },
  user_disable: { group: "people", describe: (row) => ({ title: `Turned off access for ${named(row.target, "a member")}` }) },
  user_enable: { group: "people", describe: (row) => ({ title: `Turned access back on for ${named(row.target, "a member")}` }) },
  member_access_disabled: { group: "people", describe: (row) => ({ title: `Turned off access for ${named(row.target, "a member")}`, detail: words(row.detail) }) },
  member_access_enabled: { group: "people", describe: (row) => ({ title: `Turned access back on for ${named(row.target, "a member")}`, detail: words(row.detail) }) },
  member_role_changed: { group: "people", describe: (row) => ({ title: `Changed the role of ${named(row.target, "a member")}`, detail: words(row.detail) }) },
  account_request_approve: { group: "people", describe: (row) => ({ title: `Approved the account request from ${named(row.target, "a person")}` }) },
  account_request_decline: { group: "people", describe: (row) => ({ title: `Declined the account request from ${named(row.target, "a person")}` }) },
  coach_invite_accept: { group: "people", describe: (row) => ({ title: `${named(row.target, "A coach")} accepted their invite and joined the club` }) },
  athlete_invite_accept: { group: "people", describe: (row) => ({ title: `${named(row.target, "An athlete")} accepted their invite and joined a team` }) },
  member_removed: { group: "people", describe: (row) => ({ title: `Removed ${named(row.target, "a member")} from the club`, detail: "Their plans, notes and messages are kept" }) },
  club_admin_invite_created: { group: "invites", describe: (row) => ({ title: `Invited ${named(row.target, "someone")} as a club admin` }) },
  coach_invite_bulk_send: { group: "invites", describe: (row) => ({ title: "Invited several coaches at once", detail: words(row.detail) }) },
  managed_athlete_login_linked: { group: "people", describe: () => ({ title: "An athlete who was added without a login now has their own login" }) },
  club_admin_first_access: { group: "people", describe: (row) => ({ title: `${named(row.target, "The club admin")} signed in as club admin for the first time` }) },

  // Invites and join codes
  coach_invite_send: {
    group: "invites",
    describe: (row) => {
      const team = after(row.detail, "team")
      return { title: `Invited ${named(row.target, "a coach")} as a coach`, detail: team ? `For ${team}` : null }
    },
  },
  coach_invite_resend: { group: "invites", describe: (row) => ({ title: `Sent the coach invite for ${named(row.target, "a coach")} again` }) },
  coach_invite_revoke: { group: "invites", describe: (row) => ({ title: `Cancelled the coach invite for ${named(row.target, "a coach")}` }) },
  coach_invites_bulk_created: { group: "invites", describe: (row) => ({ title: "Invited several coaches at once", detail: words(row.detail) }) },
  coach_invite_email_sent: { group: "invites", describe: (row) => ({ title: `Emailed a coach invite to ${named(row.target, "a coach")}` }) },
  coach_invite_email_resent: { group: "invites", describe: (row) => ({ title: `Emailed the coach invite to ${named(row.target, "a coach")} again` }) },
  coach_invite_email_failed: { group: "invites", describe: (row) => ({ title: `The coach invite email to ${named(row.target, "a coach")} could not be sent` }) },
  athlete_invite_send: {
    group: "invites",
    describe: (row) => {
      const team = after(row.detail, "team")
      return { title: `Invited ${named(row.target, "an athlete")} as an athlete`, detail: team ? `To ${team}` : null }
    },
  },
  athlete_invite_resend: { group: "invites", describe: (row) => ({ title: `Sent the athlete invite for ${named(row.target, "an athlete")} again` }) },
  athlete_invite_revoke: { group: "invites", describe: (row) => ({ title: `Cancelled the athlete invite for ${named(row.target, "an athlete")}` }) },
  // Parents and guardians (20261016090000_guardian_access.sql)
  guardian_invite_created: { group: "invites", describe: (row) => ({ title: `Invited ${named(row.target, "a guardian")} as a parent or guardian` }) },
  guardian_invite_cancelled: { group: "invites", describe: (row) => ({ title: `Cancelled the guardian invite to ${named(row.target, "a guardian")}` }) },
  guardian_invite_accepted: { group: "invites", describe: (row) => ({ title: `${named(row.target, "A guardian")} accepted a guardian invite` }) },
  guardian_invite_email_sent: { group: "invites", describe: (row) => ({ title: `Emailed a guardian invite to ${named(row.target, "a guardian")}` }) },
  guardian_invite_email_resent: { group: "invites", describe: (row) => ({ title: `Emailed the guardian invite to ${named(row.target, "a guardian")} again` }) },
  guardian_invite_email_failed: { group: "invites", describe: (row) => ({ title: `The guardian invite email to ${named(row.target, "a guardian")} could not be sent` }) },
  guardian_linked: { group: "people", describe: (row) => ({ title: `Gave ${named(row.target, "a guardian")} access to another athlete` }) },
  guardian_access_removed: { group: "people", describe: () => ({ title: "Removed a guardian's access to an athlete" }) },
  guardian_contact_updated: { group: "athletes", describe: () => ({ title: "A guardian updated their contact details for an athlete" }) },
  guardian_health_sharing_changed: { group: "athletes", describe: (row) => ({ title: "An athlete changed whether guardians see their health information", detail: words(row.detail) }) },
  athlete_invite_email_sent: { group: "invites", describe: (row) => ({ title: `Emailed an athlete invite to ${named(row.target, "an athlete")}` }) },
  athlete_invite_email_resent: { group: "invites", describe: (row) => ({ title: `Emailed the athlete invite to ${named(row.target, "an athlete")} again` }) },
  athlete_invite_email_failed: { group: "invites", describe: (row) => ({ title: `The athlete invite email to ${named(row.target, "an athlete")} could not be sent` }) },
  athlete_invites_bulk_created: {
    group: "invites",
    describe: (row) => {
      const count = /^(\d+) athlete invites created/.exec(row.detail ?? "")?.[1]
      const days = /valid for (\d+) days/.exec(row.detail ?? "")?.[1]
      return {
        title: `Created ${count ? `${count} athlete invites` : "athlete invites"} for ${named(row.target, "a team")}`,
        detail: days ? `Valid for ${days} days` : null,
      }
    },
  },
  managed_athlete_login_invited: { group: "invites", describe: () => ({ title: "Invited an athlete who had no login to set one up" }) },
  team_join_code_created: {
    group: "invites",
    describe: (row) => {
      const days = /valid (\d+) days/.exec(row.detail ?? "")?.[1]
      const uses = /up to (\d+) uses/.exec(row.detail ?? "")?.[1]
      return {
        title: `Created a join code for ${named(row.target, "a team")}`,
        detail: days && uses ? `Valid for ${days} days, up to ${uses} uses` : null,
      }
    },
  },
  team_join_code_disabled: {
    group: "invites",
    describe: (row) => {
      const used = /after (\d+) of (\d+) uses/.exec(row.detail ?? "")
      return { title: `Turned off the join code for ${named(row.target, "a team")}`, detail: used ? `It had been used ${used[1]} of ${used[2]} times` : null }
    },
  },
  team_join_code_used: { group: "invites", describe: (row) => ({ title: `${named(row.target, "An athlete")} joined a team with a join code` }) },

  // Teams
  team_create: { group: "teams", describe: (row) => ({ title: `Created the team ${named(row.target, "")}`.trim(), detail: leadDetail(row.detail) }) },
  team_update: { group: "teams", describe: (row) => ({ title: `Updated the team ${named(row.target, "")}`.trim(), detail: leadDetail(row.detail) }) },
  team_archive: { group: "teams", describe: (row) => ({ title: `Archived the team ${named(row.target, "")}`.trim() }) },
  team_restore: { group: "teams", describe: (row) => ({ title: `Restored the team ${named(row.target, "")}`.trim() }) },
  team_lead_coach_set: {
    group: "teams",
    describe: (row) => ({ title: `Made ${words(row.detail) ?? "a coach"} the lead coach of ${named(row.target, "a team")}` }),
  },
  team_coaches_set: { group: "teams", describe: (row) => ({ title: `Changed the coaches of ${named(row.target, "a team")}`, detail: words(row.detail) }) },
  team_coach_add: { group: "teams", describe: (row) => ({ title: `Added ${words(row.detail) ?? "a coach"} to ${named(row.target, "a team")}` }) },
  team_coach_remove: { group: "teams", describe: (row) => ({ title: `Removed ${words(row.detail) ?? "a coach"} from ${named(row.target, "a team")}` }) },
  team_athlete_remove: { group: "teams", describe: (row) => ({ title: `Removed ${words(row.detail) ?? "an athlete"} from ${named(row.target, "a team")}` }) },

  // Athletes
  athlete_availability_set: { group: "athletes", describe: (row) => ({ title: `${named(row.target, "An athlete")} was marked unavailable`, detail: words(row.detail) }) },
  athlete_availability_ended: {
    group: "athletes",
    describe: (row) => ({ title: `${named(row.target, "An athlete")} is available again`, detail: /by the athlete/.test(row.detail ?? "") ? "Changed by the athlete" : null }),
  },
  athlete_unavailable: { group: "athletes", describe: (row) => ({ title: `${named(row.target, "An athlete")} was marked unavailable`, detail: words(row.detail) }) },
  athlete_available_again: { group: "athletes", describe: (row) => ({ title: `${named(row.target, "An athlete")} is available again` }) },
  athlete_leave_team: { group: "athletes", describe: (row) => ({ title: `${named(row.target, "An athlete")} left their team` }) },
  athlete_left_team: { group: "athletes", describe: (row) => ({ title: `${named(row.target, "An athlete")} left their team` }) },
  athlete_joined_team: { group: "athletes", describe: (row) => ({ title: `${named(row.target, "An athlete")} joined a team` }) },
  athlete_moved_team: {
    group: "athletes",
    describe: (row) => {
      const removed = /(\d+) untouched upcoming sessions removed/.exec(row.detail ?? "")?.[1]
      return {
        title: `Moved ${named(row.target, "an athlete")} to another team`,
        detail: removed && removed !== "0" ? `${removed} upcoming sessions from the old team were removed` : null,
      }
    },
  },
  managed_athlete_added: { group: "athletes", describe: (row) => ({ title: `Added ${named(row.target, "an athlete")} without a login`, detail: words(row.detail) }) },
  athlete_removed_from_club: { group: "athletes", describe: () => ({ title: "Removed an athlete from the club", detail: "Their history was kept" }) },
  athlete_restored_to_club: { group: "athletes", describe: () => ({ title: "Brought an athlete back into the club" }) },
  athlete_data_deleted: { group: "athletes", describe: () => ({ title: "Deleted an athlete's data for good" }) },
  account_deleted: { group: "people", describe: (row) => ({ title: `${row.target === "athlete" ? "An athlete" : row.target === "club admin" ? "A club admin" : row.target === "guardian" ? "A parent or guardian" : "A coach"} deleted their own account`, detail: words(row.detail) }) },
  club_ownership_transferred: { group: "club", describe: (row) => ({ title: `Handed the club to ${named(row.target, "another club admin")}`, detail: "The new owner can transfer ownership, close the club and manage club admins" }) },
  club_closed: { group: "club", describe: () => ({ title: "Closed the club", detail: "Everything is deleted 90 days after closing unless the club is reopened" }) },
  club_data_exported: { group: "exports", describe: (row) => ({ title: "Exported the whole club's data", detail: words(row.detail) }) },
  personal_data_exported: { group: "exports", describe: () => ({ title: "Downloaded a copy of their own data" }) },
  managed_athlete_created: { group: "athletes", describe: () => ({ title: "Added an athlete without a login to a team" }) },
  managed_athlete_updated: { group: "athletes", describe: () => ({ title: "Changed the details of an athlete without a login" }) },
  managed_athlete_removed: { group: "athletes", describe: () => ({ title: "Removed an athlete without a login from the club", detail: "Their history was kept" }) },

  // Test weeks
  test_week_closed: { group: "tests", describe: (row) => ({ title: `Closed the test week ${named(row.target, "")}`.trim(), detail: "Athletes can no longer enter or change results" }) },
  test_week_reopened: { group: "tests", describe: (row) => ({ title: `Reopened the test week ${named(row.target, "")}`.trim(), detail: "Athletes can enter and change results again" }) },

  // Messages
  message_reported: { group: "messages", describe: (row) => ({ title: "Reported a message", detail: messageDetail(row.detail) }) },
  message_hidden: { group: "messages", describe: (row) => ({ title: "Hid a message", detail: messageDetail(row.detail) }) },
  message_report_dismissed: { group: "messages", describe: () => ({ title: "Reviewed a reported message and left it in place" }) },

  // Club and billing
  profile_update: { group: "club", describe: (row) => ({ title: "Updated the club's details", detail: words(row.detail) }) },
  club_logo_update: { group: "club", describe: () => ({ title: "Changed the club logo" }) },
  club_logo_remove: { group: "club", describe: () => ({ title: "Removed the club logo" }) },
  billing_update: {
    group: "club",
    // Kept as "Updated billing details": the words people search the log for.
    describe: (row) => ({ title: "Updated billing details", detail: row.target === "billing-contact" && row.detail ? `Billing contact is now ${row.detail}` : words(row.detail) }),
  },
  package_upgrade_requested: { group: "club", describe: (row) => ({ title: `Asked to move to the ${packageName(row.target)} package` }) },
  package_changed: {
    group: "club",
    describe: (row) => {
      const reason = /Reason: (.+)$/.exec(row.detail ?? "")?.[1]
      return { title: `The SKTR team moved the club to the ${packageName(row.target)} package`, detail: reason ? `Reason: ${reason}` : null }
    },
  },
  first_access_setup_complete: { group: "club", describe: () => ({ title: "Finished first-time setup" }) },
  tenant_provisioned: { group: "club", describe: () => ({ title: "The club workspace was created" }) },
  tenant_provision_request_provisioned: { group: "club", describe: () => ({ title: "The club workspace was created" }) },

  // Downloads
  export_csv: {
    group: "exports",
    describe: (row) => {
      const rows = /(\d+) rows?/.exec(row.detail ?? "")?.[1]
      return { title: `Downloaded the ${EXPORT_LABEL[row.target] ?? named(row.target, "list")} as a CSV file`, detail: rows ? `${Number(rows).toLocaleString()} ${rows === "1" ? "row" : "rows"}` : null }
    },
  },
  export_pdf: { group: "exports", describe: (row) => ({ title: `Printed the ${EXPORT_LABEL[row.target] ?? named(row.target, "report")}` }) },
}

function leadDetail(detail: string | null) {
  const lead = after(detail, "lead")
  return lead ? `Lead coach: ${lead}` : detail?.trim() === "no lead coach" ? "No lead coach yet" : null
}

/** "Reported a message in the conversation between A and B." keeps the people and drops the lead-in. */
function messageDetail(detail: string | null) {
  const match = /in the conversation between (.+?) and (.+?)\.(?: Reason: (.+))?$/.exec(detail ?? "")
  if (!match) return words(detail)
  return `Conversation between ${match[1]} and ${match[2]}${match[3] ? `. Reason: ${match[3]}` : ""}`
}

/** Every action code with a sentence of its own. Exported for the unit test that guards the list. */
export const KNOWN_CLUB_ACTIONS = Object.keys(SENTENCES)

/** "coach_invite_send" becomes "Coach invite send": the fallback for a code with no sentence yet. */
export function humaniseActionCode(action: string) {
  const text = action.replaceAll("_", " ").replaceAll("-", " ").trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Activity"
}

export function describeClubActivity(row: ClubAuditRow): ClubActivity {
  const known = SENTENCES[row.action]
  if (!known) {
    const about = named(row.target, "")
    return { group: "other", title: about ? `${humaniseActionCode(row.action)}: ${about}` : humaniseActionCode(row.action), detail: words(row.detail) }
  }
  const described = known.describe(row)
  return { group: known.group, title: described.title, detail: described.detail ?? null }
}

const ROLE_LABEL: Record<string, string> = {
  "club-admin": "Club admin",
  coach: "Coach",
  athlete: "Athlete",
  guardian: "Guardian",
  "platform-admin": "SKTR team",
  system: "System",
  unknown: "Someone in the club",
}

export function clubActorRoleLabel(role: string | null | undefined) {
  if (!role) return null
  return ROLE_LABEL[role] ?? role
}

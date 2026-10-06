import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { EmptyState, Fact, FactList, LinkButton, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, Split, Stat, StatStrip, StatusDot } from "@/components/sk"
import {
  getPlatformAdminPackageUpgradeRequests,
  getPlatformAdminRequestQueue,
  getPlatformAuditEvents,
  getPlatformNotificationEmailStats,
  getPlatformTenantSizes,
  type PlatformAdminPackageUpgradeRequestRecord,
  type PlatformAdminRequestRecord,
  type PlatformAuditEventRecord,
  type PlatformNotificationEmailStats,
  type PlatformTenantSize,
} from "@/lib/data/platform-admin/ops-data"
import { auditSentence, formatLocalDateTime, isClubRecord, lifecycleOf } from "@/lib/data/platform-admin/tenants-data"
import { plural } from "@/lib/format/ops-format"
import { PlatformHomeTabs } from "@/components/ops/platform-tabs"

const EMAIL_MODE: Record<PlatformNotificationEmailStats["deliveryMode"], string> = {
  scheduled: "On their own, within a minute",
  on_queue: "On their own, as soon as they are queued",
  waiting_for_address: "Automatic sending starts with the first notification after this release. Until then use Send queued emails on the Requests screen.",
  on_request: "When someone in a club acts, or when you press Send queued emails on the Requests screen. Automatic sending is not available on this database.",
}

/** "Kingston Striders, Bolt Academy and 2 more" */
function nameList(names: string[]) {
  if (names.length <= 2) return names.join(" and ")
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
}

/** The owner's front page: how big the platform is, what is waiting on them, and what just happened. */
export default function PlatformAdminDashboardPage() {
  const [requests, setRequests] = useState<PlatformAdminRequestRecord[]>([])
  const [auditEvents, setAuditEvents] = useState<PlatformAuditEventRecord[]>([])
  const [upgradeRequests, setUpgradeRequests] = useState<PlatformAdminPackageUpgradeRequestRecord[]>([])
  /** Live club sizes by tenant id. Null when they cannot be read. */
  const [sizes, setSizes] = useState<Map<string, PlatformTenantSize> | null>(null)
  /** Notification email counts. Null when they cannot be read. */
  const [emailStats, setEmailStats] = useState<PlatformNotificationEmailStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      const [requestsResult, auditResult, upgradesResult, sizesResult, emailStatsResult] = await Promise.all([
        getPlatformAdminRequestQueue(),
        getPlatformAuditEvents(12),
        getPlatformAdminPackageUpgradeRequests(),
        getPlatformTenantSizes(),
        getPlatformNotificationEmailStats(),
      ])

      if (cancelled) return
      setSizes(sizesResult)
      setEmailStats(emailStatsResult)

      // Each list is independent: show what loaded and name what did not.
      if (requestsResult.ok) setRequests(requestsResult.data)
      if (auditResult.ok) setAuditEvents(auditResult.data)
      if (upgradesResult.ok) setUpgradeRequests(upgradesResult.data)

      const failed = [requestsResult, auditResult, upgradesResult].find((result) => !result.ok)
      setError(failed && !failed.ok ? failed.error.message : null)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const clubs = useMemo(() => requests.filter(isClubRecord), [requests])

  /** Tenant id to club name. Platform admins cannot read the tenants table, so names come from here. */
  const clubNames = useMemo(() => {
    const map = new Map<string, string>()
    clubs.forEach((club) => {
      if (club.provisionedTenantId) map.set(club.provisionedTenantId, club.organizationName)
    })
    return map
  }, [clubs])

  /** Totals over the clubs listed here (a tenant that is not one of these clubs is not counted). */
  const people = useMemo(() => {
    if (!sizes) return null
    const total = { teams: 0, coaches: 0, athletes: 0 }
    const seen = new Set<string>()
    for (const club of clubs) {
      const tenantId = club.provisionedTenantId
      if (!tenantId || seen.has(tenantId)) continue
      seen.add(tenantId)
      const row = sizes.get(tenantId)
      if (!row) continue
      total.teams += row.teams
      total.coaches += row.coaches
      total.athletes += row.athletes
    }
    return total
  }, [clubs, sizes])

  const size = useMemo(() => {
    const count = (...states: string[]) => clubs.filter((club) => states.includes(lifecycleOf(club))).length
    return {
      total: clubs.length,
      active: count("active"),
      onboarding: count("active_onboarding"),
      billing: count("approved_pending_billing", "billing_failed"),
      billingFailed: count("billing_failed"),
      suspended: count("suspended"),
      cancelled: count("cancelled"),
    }
  }, [clubs])

  const needsYou = useMemo(() => {
    const pending = requests.filter((item) => item.status === "pending")
    const billing = clubs.filter((club) => ["approved_pending_billing", "billing_failed"].includes(lifecycleOf(club)))
    const onboarding = clubs.filter((club) => lifecycleOf(club) === "active_onboarding")
    const upgrades = upgradeRequests.filter((item) => item.status === "pending")
    const failedInvites = clubs.filter((club) => Boolean(club.accessInviteLastError) && lifecycleOf(club) !== "cancelled")
    const failedEmails = emailStats?.failed24h ?? 0

    return [
      {
        key: "requests",
        count: pending.length,
        title: `${plural(pending.length, "new club request")} waiting`,
        body: nameList(pending.map((item) => item.organizationName)),
        to: "/platform-admin/requests",
      },
      {
        key: "billing",
        count: billing.length,
        title: billing.length === 1 ? "1 approved club has not finished billing setup" : `${billing.length} approved clubs have not finished billing setup`,
        body: nameList(billing.map((club) => club.organizationName)),
        to: "/platform-admin/tenants",
      },
      {
        key: "onboarding",
        count: onboarding.length,
        title: onboarding.length === 1 ? "1 club still marked as onboarding" : `${onboarding.length} clubs still marked as onboarding`,
        body: "A club stays in onboarding until its admin finishes setup, or you mark it active on the Clubs screen.",
        to: "/platform-admin/tenants",
      },
      {
        key: "upgrades",
        count: upgrades.length,
        title: `${plural(upgrades.length, "package change request")} waiting`,
        body: nameList(upgrades.map((item) => clubNames.get(item.tenantId) ?? item.organizationName)),
        to: "/platform-admin/commercial",
      },
      {
        key: "invites",
        count: failedInvites.length,
        title: failedInvites.length === 1 ? "1 club admin invite failed to send" : `${failedInvites.length} club admin invites failed to send`,
        body: nameList(failedInvites.map((club) => club.organizationName)),
        to: "/platform-admin/requests",
      },
      {
        key: "emails",
        count: failedEmails,
        title: failedEmails === 1 ? "1 notification email failed to send" : `${failedEmails} notification emails failed to send`,
        body: "In the last 24 hours, after five tries each. Open the list to see why and send them again.",
        to: "/platform-admin/audit?view=emails",
      },
    ].filter((item) => item.count > 0)
  }, [clubNames, clubs, emailStats, requests, upgradeRequests])

  const recentAudit = useMemo(() => auditEvents.slice(0, 8), [auditEvents])

  const lede = loading
    ? "Loading the platform..."
    : size.total === 0
      ? "No clubs yet. New club requests show up here as soon as someone asks to join."
      : `${plural(size.total, "club")}, ${size.active} active. ${needsYou.length === 0 ? "Nothing is waiting on you." : `${plural(needsYou.length, "thing")} ${needsYou.length === 1 ? "needs" : "need"} you.`}`

  const otherStates = [size.suspended > 0 ? `${size.suspended} suspended` : null, size.cancelled > 0 ? `${size.cancelled} cancelled` : null].filter(Boolean).join(", ")

  return (
    <Screen>
      <ScreenHeader
        title="Platform"
        lede={lede}
        actions={
          <>
            <LinkButton to="/platform-admin/tenants">All clubs</LinkButton>
            <LinkButton to="/platform-admin/requests" variant="primary">
              Review requests
            </LinkButton>
          </>
        }
      />

      <PlatformHomeTabs />

      {error ? <Notice tone="error">Could not load everything: {error}</Notice> : null}

      <StatStrip aria-label="Platform size">
        <Stat label="Clubs" value={loading ? "-" : size.total} hint={otherStates || "Approved so far"} />
        <Stat label="Active" value={loading ? "-" : size.active} hint="Setup finished" />
        <Stat label="Onboarding" value={loading ? "-" : size.onboarding} hint="Billing done, setup not finished" />
        <Stat label="Waiting on billing" value={loading ? "-" : size.billing} hint={size.billingFailed > 0 ? `${size.billingFailed} with failed billing` : "Approved, billing not set up"} />
      </StatStrip>

      <Split
        main={
          <>
            <Section title="Needs you" hint="New requests, unfinished setup, package changes, and invites or emails that failed." meta={loading || needsYou.length === 0 ? undefined : `${needsYou.length} open`}>
              {loading ? (
                <SkeletonRows rows={3} label="Loading what needs you" />
              ) : needsYou.length > 0 ? (
                <List aria-label="Needs you">
                  {needsYou.map((item) => (
                    <ListRow key={item.key} to={item.to} leading={<StatusDot tone="coral" />} title={item.title} subtitle={item.body} />
                  ))}
                </List>
              ) : (
                <EmptyState
                  title="Nothing is waiting on you"
                  body="New club requests, clubs that have not finished setup, package change requests and failed invites or emails show up here."
                />
              )}
            </Section>

            <Section title="Across all clubs" hint={people ? "Counted now: teams that are not archived, active coaches and every athlete on a roster." : undefined}>
              {loading ? (
                <SkeletonRows rows={3} label="Loading totals" />
              ) : people ? (
                <FactList aria-label="Totals across all clubs">
                  <Fact label="Teams">{people.teams.toLocaleString()}</Fact>
                  <Fact label="Active coaches">{people.coaches.toLocaleString()}</Fact>
                  <Fact label="Athletes">{people.athletes.toLocaleString()}</Fact>
                </FactList>
              ) : (
                <EmptyState
                  title="Live totals are not available"
                  body="Team, coach and athlete counts could not be loaded. Each club's sign-up numbers are on the Clubs screen."
                  action={
                    <LinkButton to="/platform-admin/tenants" size="sm">
                      Open clubs
                    </LinkButton>
                  }
                />
              )}
            </Section>
          </>
        }
        side={
          <>
            <Section
              title="Recent activity"
              action={
                <Link className="sk-link" to="/platform-admin/audit">
                  All activity
                </Link>
              }
            >
              {loading ? (
                <SkeletonRows rows={4} label="Loading recent activity" />
              ) : recentAudit.length > 0 ? (
                <List aria-label="Recent activity">
                  {recentAudit.map((event) => (
                    <ListRow key={event.id} className="items-start">
                      <span className="sk-list-title break-words">{auditSentence(event, clubNames)}</span>
                      <span className="sk-list-sub mt-0.5 break-words">
                        <time dateTime={event.occurredAt}>{formatLocalDateTime(event.occurredAt)}</time>
                        {event.actorEmail ? `, by ${event.actorEmail}` : ""}
                      </span>
                    </ListRow>
                  ))}
                </List>
              ) : (
                <EmptyState title="No activity yet" body="Requests, approvals, status changes and exports are listed here as they happen." />
              )}
            </Section>

            {emailStats ? (
              <Section
                title="Notification email"
                hint="The last 24 hours."
                action={
                  <Link className="sk-link" to="/platform-admin/audit?view=emails">
                    Failed emails
                  </Link>
                }
              >
                <FactList aria-label="Notification email in the last 24 hours">
                  <Fact label="Sent">{emailStats.sent24h.toLocaleString()}</Fact>
                  <Fact label="Failed">{emailStats.failed24h.toLocaleString()}</Fact>
                  <Fact label="Being retried">{emailStats.retrying.toLocaleString()}</Fact>
                  <Fact label="Waiting">{emailStats.waiting.toLocaleString()}</Fact>
                  <Fact label="Held back">{emailStats.notSent24h.toLocaleString()}</Fact>
                  <Fact label="How emails go out" stack>
                    {EMAIL_MODE[emailStats.deliveryMode]}
                  </Fact>
                </FactList>
              </Section>
            ) : null}
          </>
        }
      />
    </Screen>
  )
}

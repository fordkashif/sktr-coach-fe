import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Buildings, CheckCircle, ClockCounterClockwise, Tray } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { EmptyState, PageHeader, Panel, Stat } from "@/components/sk"
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

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** One plain sentence about notification email: what went out in the last 24 hours and how it is sent. */
function emailSentence(stats: PlatformNotificationEmailStats) {
  const counts = [
    `${stats.sent24h} sent`,
    stats.failed24h > 0 ? `${stats.failed24h} failed` : null,
    stats.retrying > 0 ? `${stats.retrying} being retried` : null,
    stats.waiting > 0 ? `${stats.waiting} waiting` : null,
    stats.notSent24h > 0 ? `${stats.notSent24h} held back (switched off, deactivated or paused)` : null,
  ]
    .filter(Boolean)
    .join(", ")
  const how =
    stats.deliveryMode === "scheduled"
      ? "Emails go out on their own within a minute."
      : stats.deliveryMode === "on_queue"
        ? "Emails go out on their own as soon as they are queued."
        : stats.deliveryMode === "waiting_for_address"
          ? "Automatic sending starts with the first notification after this release. Until then use Send queued emails on the Requests screen."
          : "Automatic sending is not available on this database, so emails go out when someone in the club acts, or when you press Send queued emails on the Requests screen."
  return `Notification email in the last 24 hours: ${counts}. ${how}`
}

/** "Kingston Striders, Bolt Academy and 2 more" */
function nameList(names: string[]) {
  if (names.length <= 2) return names.join(" and ")
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
}

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

    return [
      {
        key: "requests",
        count: pending.length,
        title: pending.length === 1 ? "New club request waiting" : "New club requests waiting",
        body: nameList(pending.map((item) => item.organizationName)),
        to: "/platform-admin/requests",
        cta: "Review",
      },
      {
        key: "billing",
        count: billing.length,
        title: billing.length === 1 ? "Approved club has not finished billing setup" : "Approved clubs have not finished billing setup",
        body: nameList(billing.map((club) => club.organizationName)),
        to: "/platform-admin/tenants",
        cta: "Open clubs",
      },
      {
        key: "onboarding",
        count: onboarding.length,
        title: onboarding.length === 1 ? "Club still marked as onboarding" : "Clubs still marked as onboarding",
        body: "A club stays in onboarding until you mark it active on the Clubs screen.",
        to: "/platform-admin/tenants",
        cta: "Open clubs",
      },
      {
        key: "upgrades",
        count: upgrades.length,
        title: upgrades.length === 1 ? "Package change request waiting" : "Package change requests waiting",
        body: nameList(upgrades.map((item) => clubNames.get(item.tenantId) ?? item.organizationName)),
        to: "/platform-admin/commercial",
        cta: "Review",
      },
      {
        key: "invites",
        count: failedInvites.length,
        title: failedInvites.length === 1 ? "Club admin invite failed to send" : "Club admin invites failed to send",
        body: nameList(failedInvites.map((club) => club.organizationName)),
        to: "/platform-admin/requests",
        cta: "Send again",
      },
      {
        key: "emails",
        count: emailStats?.failed24h ?? 0,
        title: emailStats?.failed24h === 1 ? "Notification email failed to send" : "Notification emails failed to send",
        body: "In the last 24 hours, after five tries each. Check the email provider, then send the queue again.",
        to: "/platform-admin/requests",
        cta: "Open requests",
      },
    ].filter((item) => item.count > 0)
  }, [clubNames, clubs, emailStats, requests, upgradeRequests])

  const recentAudit = useMemo(() => auditEvents.slice(0, 8), [auditEvents])

  const lede = loading
    ? "Loading the platform..."
    : size.total === 0
      ? "No clubs yet. New club requests show up here as soon as someone asks to join."
      : `${plural(size.total, "club")}, ${size.active} active. ${
          needsYou.length === 0 ? "Nothing is waiting on you." : `${plural(needsYou.length, "thing")} ${needsYou.length === 1 ? "needs" : "need"} you.`
        }`

  const otherStates = [size.suspended > 0 ? `${size.suspended} suspended` : null, size.cancelled > 0 ? `${size.cancelled} cancelled` : null]
    .filter(Boolean)
    .join(", ")

  return (
    <div className="sk-page">
      {error ? (
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          Could not load everything: {error}
        </p>
      ) : null}

      <PageHeader
        title="Platform"
        lede={lede}
        actions={
          <>
            <Link to="/platform-admin/tenants" className="sk-btn sk-btn-quiet">
              <Buildings className="size-5" weight="bold" />
              All clubs
            </Link>
            <Link to="/platform-admin/requests" className="sk-btn sk-btn-primary">
              <Tray className="size-5" weight="bold" />
              Review requests
            </Link>
          </>
        }
      />

      {loading ? (
        <p role="status" className="sk-card text-sm font-semibold text-sk-mute">
          Loading...
        </p>
      ) : (
        <>
          <section aria-label="Platform size" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat tone="blue" label="Clubs" value={size.total} hint={otherStates || "Approved so far"} />
              <Stat tone={size.active > 0 ? "green" : "plain"} label="Active" value={size.active} hint="Setup finished" />
              <Stat label="Onboarding" value={size.onboarding} hint="Billing done, setup not finished" />
              <Stat
                label="Waiting on billing"
                value={size.billing}
                hint={size.billingFailed > 0 ? `${size.billingFailed} with failed billing` : "Approved, billing not set up"}
              />
            </div>
            <p className="text-sm text-sk-mute">
              {people
                ? `Across these clubs right now: ${plural(people.teams, "team")}, ${plural(people.coaches, "active coach", "active coaches")} and ${plural(people.athletes, "athlete")}.`
                : "Team, coach and athlete totals are not shown because live counts could not be loaded. Each club's sign-up numbers are on the Clubs screen."}
            </p>
            {emailStats ? <p className="text-sm text-sk-mute">{emailSentence(emailStats)}</p> : null}
          </section>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Panel title="Needs you today" hint="Requests, unfinished setup, package changes, club admin invites that failed and notification emails that failed.">
              {needsYou.length > 0 ? (
                <ul>
                  {needsYou.map((item) => (
                    <li key={item.key} className="border-b border-sk-line last:border-b-0">
                      <Link to={item.to} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 py-4">
                        <span className="sk-num w-9 text-center text-[2rem] text-sk-coral">{item.count}</span>
                        <span className="min-w-0">
                          <span className="block font-bold text-sk-ink group-hover:text-sk-blue">{item.title}</span>
                          <span className="block text-sm text-sk-mute">{item.body}</span>
                        </span>
                        <span className="hidden items-center gap-1.5 text-sm font-bold text-sk-ink-2 group-hover:text-sk-blue sm:inline-flex">
                          {item.cta}
                          <ArrowRight className="size-4" weight="bold" />
                        </span>
                        <ArrowRight className="size-5 text-sk-mute sm:hidden" weight="bold" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<CheckCircle className="size-6" weight="fill" />}
                  title="Nothing is waiting on you"
                  body="New club requests, clubs that have not finished setup, package change requests and failed club admin invites show up here."
                  className="border-0 bg-sk-canvas"
                />
              )}
            </Panel>

            <Panel
              title="Recent activity"
              action={
                <Link to="/platform-admin/audit" className="sk-btn sk-btn-ghost sk-btn-sm">
                  Open audit
                  <ArrowRight className="size-4" weight="bold" />
                </Link>
              }
            >
              {recentAudit.length > 0 ? (
                <ul>
                  {recentAudit.map((event) => (
                    <li key={event.id} className="border-b border-sk-line py-3.5 first:pt-0 last:border-b-0 last:pb-0">
                      <p className="font-semibold text-sk-ink">{auditSentence(event, clubNames)}</p>
                      <p className="mt-0.5 break-words text-sm text-sk-mute">
                        <time dateTime={event.occurredAt}>{formatLocalDateTime(event.occurredAt)}</time>
                        {event.actorEmail ? `, by ${event.actorEmail}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<ClockCounterClockwise className="size-6" weight="fill" />}
                  title="No activity yet"
                  body="Requests, approvals, status changes and exports are listed here as they happen."
                  className="border-0 bg-sk-canvas"
                />
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

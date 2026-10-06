import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { DataTable, EmptyState, Fact, FactList, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, Split, Stat, StatStrip, StatusText, Tag, type DataTableColumn } from "@/components/sk"
import { getPackageById } from "@/lib/billing/package-catalog"
import { BILLING_STATUS_LABEL, formatLocalDate, formatLocalDateTime, LIFECYCLE_META, packageLabel } from "@/lib/data/platform-admin/tenants-data"
import { getPlatformClubOverview, type ClubOverview } from "@/lib/data/platform-admin/tools-data"
import { formatBytes } from "@/lib/data/platform-admin/tools-logic"
import { formatDay, plural } from "@/lib/format/ops-format"
import type { TenantBillingStatus, TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

const ROLE_ROWS: Array<{ role: string; label: string }> = [
  { role: "club-admin", label: "Club admins" },
  { role: "coach", label: "Coaches" },
  { role: "athlete", label: "Athletes" },
  { role: "guardian", label: "Guardians" },
]

const ROLE_WORD: Record<string, string> = { "club-admin": "A club admin", coach: "A coach", athlete: "An athlete", guardian: "A guardian", system: "The system" }

/** "Season started" for season_started. The club's own log says who and what; the platform only sees the kind of event. */
function actionWords(action: string) {
  const words = action.replaceAll("_", " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Activity"
}

/** "12 now, limit 40", in coral when the club is over its package. */
function Against({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const finite = limit !== null && Number.isFinite(limit)
  const words = `${used.toLocaleString()} now${limit === null ? "" : finite ? `, limit ${limit}` : ", no limit"}`
  return <Fact label={label}>{finite && used > (limit as number) ? <StatusText tone="coral">{words}</StatusText> : words}</Fact>
}

type TeamRow = ClubOverview["teams"][number]

/**
 * One club, for support. Read only: facts and counts, the owner's and club admins' contact, and
 * nothing about any athlete. Opening it is written to the platform activity.
 */
export default function PlatformAdminClubOverviewPage() {
  const { tenantId = "" } = useParams()
  const [overview, setOverview] = useState<ClubOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void getPlatformClubOverview(tenantId).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setOverview(result.data)
        setError(null)
      } else {
        setOverview(null)
        setError(result.error.message)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [tenantId])

  const back = { to: "/platform-admin/tenants", label: "Clubs" }

  if (loading || !overview) {
    return (
      <Screen>
        <ScreenHeader back={back} title="Club overview" lede={loading ? "Loading the club..." : undefined} />
        {error ? <Notice tone="error">Could not open this club: {error}</Notice> : null}
        {loading ? (
          <Section title="Contact">
            <SkeletonRows rows={5} label="Loading the club overview" />
          </Section>
        ) : null}
      </Screen>
    )
  }

  const pack = getPackageById(overview.packageId)
  const lifecycle = overview.lifecycleStatus ? LIFECYCLE_META[overview.lifecycleStatus as TenantLifecycleStatus] : null
  const season = overview.season
  const liveTeams = overview.teams.filter((team) => !team.archived)

  const teamColumns: Array<DataTableColumn<TeamRow>> = [
    {
      key: "team",
      header: "Team",
      cell: (team) => (
        <>
          <span className="break-words font-bold text-sk-ink">{team.name}</span>
          {team.eventGroup ? <span className="block text-sm text-sk-mute">{team.eventGroup}</span> : null}
        </>
      ),
    },
    { key: "athletes", header: "Athletes", align: "right", cell: (team) => team.athletes.toLocaleString() },
    { key: "coaches", header: "Coaches", align: "right", cell: (team) => team.coaches.toLocaleString() },
    { key: "squads", header: "Squads", align: "right", cell: (team) => team.squads.toLocaleString() },
    { key: "state", header: "State", phone: "trailing", cell: (team) => <Tag tone={team.archived ? "plain" : "green"}>{team.archived ? "Archived" : "Active"}</Tag> },
  ]

  return (
    <Screen>
      <ScreenHeader
        back={back}
        title={overview.clubName}
        lede="For support. You see facts and counts, never an athlete's health, results, notes or messages, and you cannot act as anyone in the club."
      />

      <Notice>Opening this screen is written to the platform activity with your email and the time.</Notice>

      <StatStrip aria-label="The last 28 days and totals">
        <Stat label="Sessions logged" value={overview.counts.sessionsLogged28d.toLocaleString()} hint="Last 28 days" />
        <Stat label="Plans" value={overview.counts.plans.toLocaleString()} hint={`${overview.counts.plansPublished.toLocaleString()} published`} />
        <Stat label="Test weeks" value={overview.counts.testWeeks.toLocaleString()} />
        <Stat label="Messages" value={overview.counts.messages.toLocaleString()} hint="A count. Nobody here can read them" />
      </StatStrip>

      <Split
        main={
          <>
            <Section title="Owner and club admins">
              {overview.admins.length === 0 ? (
                <EmptyState title="No club admin yet" body="The club admin has not signed in for the first time." />
              ) : (
                <List aria-label="Owner and club admins">
                  {overview.admins.map((admin) => (
                    <ListRow
                      key={`${admin.email ?? admin.name}`}
                      title={admin.name}
                      subtitle={
                        admin.email ? (
                          <a href={`mailto:${admin.email}`} className="sk-link break-all">
                            {admin.email}
                          </a>
                        ) : (
                          "No email on file"
                        )
                      }
                      trailing={<span className="text-sm text-sk-mute">{[admin.isOwner ? "Owner" : "Club admin", admin.isActive ? null : "switched off"].filter(Boolean).join(", ")}</span>}
                    />
                  ))}
                </List>
              )}
            </Section>

            <Section title="Teams" meta={`${liveTeams.length} active of ${overview.teams.length}`}>
              {overview.teams.length === 0 ? (
                <EmptyState title="No teams yet" body="The club has not created a team." />
              ) : (
                <DataTable caption="Teams with their size" columns={teamColumns} rows={overview.teams} rowKey={(team) => `${team.name}:${team.archived}`} />
              )}
            </Section>

            <Section title="Recent activity" hint="From the club's own log: the kind of event, the role that did it and when. Events about messages or health are left out, and so are names.">
              {overview.activity.length === 0 ? (
                <EmptyState title="Nothing in the club's log yet" body="Things like a season starting, people being invited or a package request show up here." />
              ) : (
                <List aria-label="Recent club activity">
                  {overview.activity.map((item, index) => (
                    <ListRow
                      key={`${item.occurredAt}:${index}`}
                      title={actionWords(item.action)}
                      subtitle={`${ROLE_WORD[item.actorRole ?? "system"] ?? "Someone"}, ${formatLocalDateTime(item.occurredAt)}`}
                    />
                  ))}
                </List>
              )}
            </Section>
          </>
        }
        side={
          <>
            <Section title="Club">
              <FactList>
                <Fact label="State">
                  {overview.closure ? (
                    <StatusText tone="coral">Closing, deleted {formatLocalDate(overview.closure.deleteAfter)}</StatusText>
                  ) : lifecycle ? (
                    <StatusText tone={lifecycle.state}>{lifecycle.label}</StatusText>
                  ) : (
                    "Not recorded"
                  )}
                </Fact>
                <Fact label="Billing">{overview.billingStatus ? (BILLING_STATUS_LABEL[overview.billingStatus as TenantBillingStatus] ?? overview.billingStatus) : "Not set up"}</Fact>
                <Fact label="Created">{formatLocalDate(overview.createdAt)}</Fact>
                <Fact label="Season" empty="Not set">
                  {season ? [season.name, season.startDate && season.endDate ? `${formatDay(season.startDate)} to ${formatDay(season.endDate)}` : null].filter(Boolean).join(", ") : null}
                </Fact>
              </FactList>
            </Section>

            <Section title="Package and use" hint={`${packageLabel(overview.packageId)} package.`}>
              <FactList>
                <Against label="Teams" used={overview.usage.teams} limit={pack?.limits.teams ?? null} />
                <Against label="Coaches" used={overview.usage.coaches} limit={pack?.limits.coaches ?? null} />
                <Against label="Athletes" used={overview.usage.athletes} limit={pack?.limits.athletes ?? null} />
                <Fact label="Athletes with a login">{overview.usage.athletesWithLogin.toLocaleString()}</Fact>
                <Fact label="Guardians">{overview.usage.guardians.toLocaleString()}</Fact>
                <Fact label="Photos and videos">{`${formatBytes(overview.usage.mediaBytes)} in ${plural(overview.usage.mediaItems, "file")}`}</Fact>
              </FactList>
            </Section>

            <Section title="Last sign-in by role" hint="The newest sign-in of anyone with that role.">
              <FactList>
                {ROLE_ROWS.map((row) => (
                  <Fact key={row.role} label={row.label} empty="Never">
                    {overview.lastActive[row.role] ? formatLocalDateTime(overview.lastActive[row.role]) : null}
                  </Fact>
                ))}
              </FactList>
            </Section>

            <Section title="Communication">
              <FactList>
                <Fact label="Announcements">{overview.counts.announcements.toLocaleString()}</Fact>
                <Fact label="Failed emails, last 28 days">
                  {overview.counts.failedEmails28d > 0 ? <StatusText tone="coral">{overview.counts.failedEmails28d.toLocaleString()}</StatusText> : "0"}
                </Fact>
              </FactList>
            </Section>
          </>
        }
      />
    </Screen>
  )
}

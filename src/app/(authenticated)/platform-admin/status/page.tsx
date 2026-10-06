import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Button, EmptyState, Fact, FactList, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, Split, StatusText, type StateTone } from "@/components/sk"
import { PlatformHomeTabs } from "@/components/ops/platform-tabs"
import { formatLocalDate, formatLocalDateTime } from "@/lib/data/platform-admin/tenants-data"
import { getPlatformSystemStatus, type PlatformSystemStatus } from "@/lib/data/platform-admin/tools-data"
import { emailHealth, HEALTH_LABEL, pushHealth, reminderHealth, storageHealth, type Health, type HealthState } from "@/lib/data/platform-admin/tools-logic"
import { plural } from "@/lib/format/ops-format"

const TONE: Record<HealthState, StateTone> = { working: "green", attention: "coral", not_set_up: "amber" }

/** One part of the system: its state as a dot and words, one line on what is going on, one on what to do, then its numbers. */
function Part({ title, health, children }: { title: string; health: Health; children: React.ReactNode }) {
  return (
    <Section title={title} aria-label={title}>
      <StatusText tone={TONE[health.state]}>{HEALTH_LABEL[health.state]}</StatusText>
      <p className="sk-list-sub mt-1">{health.summary}</p>
      {health.todo ? <p className="mt-1 text-[0.9375rem] font-semibold text-sk-ink">What to do: {health.todo}</p> : null}
      <FactList className="mt-2">{children}</FactList>
    </Section>
  )
}

/** Is everything that sends, schedules and cleans up actually running. For the owner. */
export default function PlatformAdminStatusPage() {
  const [status, setStatus] = useState<PlatformSystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await getPlatformSystemStatus()
    if (result.ok) {
      setStatus(result.data)
      setError(null)
    } else {
      setError(result.error.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const parts = status ? [emailHealth(status.email), reminderHealth(status.reminders), pushHealth(status.push), storageHealth(status.storage)] : []
  const open = parts.filter((part) => part.state !== "working").length
  const lede = !status
    ? "Email, reminders, push and clean-up."
    : open === 0
      ? "Everything is working."
      : `${plural(open, "part")} ${open === 1 ? "needs" : "need"} a look. Checked ${formatLocalDateTime(status.checkedAt)}.`

  return (
    <Screen>
      <ScreenHeader
        title="Status"
        lede={lede}
        actions={
          <Button disabled={loading} onClick={() => void load()}>
            {loading && status ? "Checking..." : "Check again"}
          </Button>
        }
      />
      <PlatformHomeTabs />

      {error ? <Notice tone="error">Could not load the status: {error}</Notice> : null}

      {!status ? (
        loading ? (
          <Section title="Email">
            <SkeletonRows rows={6} label="Loading the system status" />
          </Section>
        ) : null
      ) : (
        <>
          <Split
            main={
              <>
                <Part title="Email" health={emailHealth(status.email)}>
                  <Fact label="Last run" empty="Not yet">
                    {status.email.lastRunAt ? formatLocalDateTime(status.email.lastRunAt) : null}
                  </Fact>
                  <Fact label="Queued">{status.email.queued.toLocaleString()}</Fact>
                  <Fact label="Being retried">{status.email.retrying.toLocaleString()}</Fact>
                  <Fact label="Failed, last 24 hours">
                    {status.email.failed24h > 0 ? (
                      <Link className="sk-link" to="/platform-admin/audit?view=emails">
                        {status.email.failed24h.toLocaleString()}, open the list
                      </Link>
                    ) : (
                      "0"
                    )}
                  </Fact>
                  <Fact label="Sent, last 24 hours">{status.email.sent24h.toLocaleString()}</Fact>
                </Part>

                <Part title="Reminders" health={reminderHealth(status.reminders)}>
                  <Fact label="Last run" empty="Not recorded on this database">
                    {status.reminders.lastRunAt ? formatLocalDateTime(status.reminders.lastRunAt) : null}
                  </Fact>
                  <Fact label="Last reminder made" empty="None yet">
                    {status.reminders.lastReminderAt ? formatLocalDateTime(status.reminders.lastReminderAt) : null}
                  </Fact>
                  <Fact label="Reminders, last 24 hours">{status.reminders.sent24h.toLocaleString()}</Fact>
                </Part>

                <Part title="Push" health={pushHealth(status.push)}>
                  <Fact label="Devices with push on">{status.push.devices.toLocaleString()}</Fact>
                  <Fact label="Queued">{status.push.queued.toLocaleString()}</Fact>
                  <Fact label="Failed, last 24 hours">{status.push.failed24h.toLocaleString()}</Fact>
                  <Fact label="Sent, last 24 hours">{status.push.sent24h.toLocaleString()}</Fact>
                </Part>

                <Part title="Storage clean-up" health={storageHealth(status.storage)}>
                  <Fact label="Files waiting to be removed">{status.storage.queued.toLocaleString()}</Fact>
                  <Fact label="Waiting since" empty="Nothing waiting">
                    {status.storage.oldestQueuedAt ? formatLocalDateTime(status.storage.oldestQueuedAt) : null}
                  </Fact>
                  <Fact label="Last file removed" empty="None yet">
                    {status.storage.lastDoneAt ? formatLocalDateTime(status.storage.lastDoneAt) : null}
                  </Fact>
                </Part>
              </>
            }
            side={
              <>
                <Section title="Paused clubs" meta={status.pausedClubs.length > 0 ? String(status.pausedClubs.length) : undefined}>
                  {status.pausedClubs.length === 0 ? (
                    <EmptyState title="No club is paused" body="A club you suspend on the Clubs screen is listed here." />
                  ) : (
                    <List aria-label="Paused clubs">
                      {status.pausedClubs.map((club) => (
                        <ListRow key={club.tenantId} to={`/platform-admin/tenants/${encodeURIComponent(club.tenantId)}`} title={club.clubName} subtitle="Suspended. Its people cannot read or change anything." />
                      ))}
                    </List>
                  )}
                </Section>

                <Section title="Closing clubs" hint="Closed by their owner. Deleted for good on the date shown." meta={status.closingClubs.length > 0 ? String(status.closingClubs.length) : undefined}>
                  {status.closingClubs.length === 0 ? (
                    <EmptyState title="No club is closing" body="A club its owner closes is listed here with its deletion date." />
                  ) : (
                    <List aria-label="Closing clubs">
                      {status.closingClubs.map((club) => (
                        <ListRow key={club.tenantId} title={club.clubName} subtitle={`Closed ${formatLocalDate(club.closedAt)}`} trailing={<span className="text-sm font-semibold text-sk-ink">Deleted {formatLocalDate(club.deleteAfter)}</span>} />
                      ))}
                    </List>
                  )}
                </Section>

                <Section title="Database">
                  <FactList>
                    <Fact label="Jobs can run by themselves">{status.schedulerAvailable ? "Yes" : "No, pg_cron is not installed"}</Fact>
                    {status.latestMigration ? (
                      <Fact label="Latest migration" stack>
                        <span className="break-all">{status.latestMigration}</span>
                      </Fact>
                    ) : null}
                  </FactList>
                </Section>
              </>
            }
          />
        </>
      )}
    </Screen>
  )
}

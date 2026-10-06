import { useCallback, useEffect, useState } from "react"
import { Button, CheckRow, DataTable, EmptyState, Field, FormActions, FormGrid, InlineConfirm, Input, List, Notice, Screen, ScreenHeader, Section, Select, SkeletonRows, StatusText, TableSub, Textarea, notify, type DataTableColumn, type StateTone } from "@/components/sk"
import { PlatformHomeTabs } from "@/components/ops/platform-tabs"
import { formatLocalDateTime } from "@/lib/data/platform-admin/tenants-data"
import { listPlatformNotices, sendPlatformNotice, withdrawPlatformNotice, type PlatformNotice } from "@/lib/data/platform-admin/tools-data"
import {
  NOTICE_AUDIENCE_HINT,
  NOTICE_AUDIENCE_LABEL,
  NOTICE_BODY_MAX,
  NOTICE_LINK_MAX,
  NOTICE_TITLE_MAX,
  validateNoticeDraft,
  type NoticeAudience,
  type NoticeDraft,
  type NoticeDraftErrors,
  type NoticeState,
} from "@/lib/data/platform-admin/tools-logic"
import { plural } from "@/lib/format/ops-format"

const EMPTY: NoticeDraft = { title: "", body: "", link: "", audience: "everyone", expiresAt: "", emailClubAdmins: false }
const STATE: Record<NoticeState, { label: string; tone: StateTone }> = {
  live: { label: "Showing", tone: "green" },
  expired: { label: "Ended", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
}

/** A short notice from the SKTR team to every club: a notification and a banner in the app, and an email to club admins when asked. */
export default function PlatformAdminNoticesPage() {
  const [notices, setNotices] = useState<PlatformNotice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<NoticeDraft>(EMPTY)
  const [errors, setErrors] = useState<NoticeDraftErrors>({})
  const [sendError, setSendError] = useState<string | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [withdrawId, setWithdrawId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await listPlatformNotices()
    if (result.ok) {
      setNotices(result.data)
      setError(null)
    } else {
      setError(result.error.message)
      setNotices((current) => current ?? [])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const change = (patch: Partial<NoticeDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setConfirmSend(false)
    setSendError(null)
  }

  const handleReview = (event: React.FormEvent) => {
    event.preventDefault()
    const found = validateNoticeDraft(draft)
    setErrors(found)
    setConfirmSend(Object.keys(found).length === 0)
  }

  const handleSend = async () => {
    setBusy(true)
    const result = await sendPlatformNotice(draft)
    setBusy(false)
    setConfirmSend(false)
    if (!result.ok) {
      setSendError(result.error.message)
      return
    }
    notify(`Notice sent to ${plural(result.data.reachInApp, "person", "people")}`)
    setDraft(EMPTY)
    setErrors({})
    await load()
  }

  const handleWithdraw = async (notice: PlatformNotice) => {
    setBusy(true)
    const result = await withdrawPlatformNotice(notice.id)
    setBusy(false)
    setWithdrawId(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    notify("Notice withdrawn")
    await load()
  }

  const list = notices ?? []
  const live = list.filter((notice) => notice.state === "live").length

  const columns: Array<DataTableColumn<PlatformNotice>> = [
    {
      key: "notice",
      header: "Notice",
      cell: (notice) => (
        <>
          <span className="break-words font-bold text-sk-ink">{notice.title}</span>
          <TableSub>
            <span className="whitespace-pre-line break-words">{notice.body}</span>
            {notice.linkUrl ? <span className="block break-all">Link: {notice.linkUrl}</span> : null}
          </TableSub>
        </>
      ),
    },
    { key: "audience", header: "For", cell: (notice) => NOTICE_AUDIENCE_LABEL[notice.audience] ?? notice.audience },
    {
      key: "reach",
      header: "Reached",
      cell: (notice) => (
        <span className="block">
          {plural(notice.reachInApp, "person", "people")} in the app
          <span className="block text-sm text-sk-mute">
            {notice.emailClubAdmins ? `${plural(notice.reachEmail, "email")} to club admins` : "No email"}, {notice.dismissedCount.toLocaleString()} dismissed
          </span>
        </span>
      ),
    },
    {
      key: "sent",
      header: "Sent",
      phone: "hide",
      cell: (notice) => (
        <>
          {formatLocalDateTime(notice.createdAt)}
          <span className="block text-sm text-sk-mute">{notice.expiresAt ? `${notice.state === "expired" ? "Ended" : "Ends"} ${formatLocalDateTime(notice.expiresAt)}` : "No end date"}</span>
        </>
      ),
    },
    {
      key: "state",
      header: "State",
      phone: "plain",
      cell: (notice) => <StatusText tone={STATE[notice.state].tone}>{STATE[notice.state].label}</StatusText>,
    },
    {
      key: "action",
      header: "Change",
      align: "right",
      phone: "plain",
      cell: (notice) =>
        notice.state === "live" ? (
          <Button size="sm" variant="danger" disabled={busy} aria-expanded={withdrawId === notice.id} aria-label={`Withdraw ${notice.title}`} onClick={() => setWithdrawId((current) => (current === notice.id ? null : notice.id))}>
            Withdraw
          </Button>
        ) : null,
    },
  ]

  const bodyLeft = NOTICE_BODY_MAX - draft.body.trim().length

  return (
    <Screen>
      <ScreenHeader
        title="Notices"
        lede={notices === null ? "A short notice to every club." : live === 0 ? "No notice is showing in the app right now." : `${plural(live, "notice")} showing in the app right now.`}
      />
      <PlatformHomeTabs />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Section title="Sent notices" hint="Reach is counted when the notice is sent: active people in clubs that are open." meta={notices && list.length > 0 ? plural(list.length, "notice") : undefined}>
        {notices === null ? (
          <SkeletonRows rows={3} label="Loading notices" />
        ) : list.length === 0 ? (
          <EmptyState title="No notices sent yet" body="Write one on this screen. It shows as a banner at the top of the app and in each person's notifications." />
        ) : (
          <DataTable
            caption="Sent notices"
            columns={columns}
            rows={list}
            rowKey={(notice) => notice.id}
            rowProps={(notice) => ({ "data-notice": notice.title })}
            rowBelow={(notice) =>
              withdrawId === notice.id ? (
                <InlineConfirm
                  question={`Withdraw "${notice.title}"? The banner disappears for everyone and the notice leaves their notifications. Emails already sent stay sent.`}
                  confirmLabel="Withdraw notice"
                  cancelLabel="Keep showing"
                  busy={busy}
                  onConfirm={() => void handleWithdraw(notice)}
                  onCancel={() => setWithdrawId(null)}
                />
              ) : null
            }
          />
        )}
      </Section>

      <Section title="Write a notice" hint="Keep it short. It cannot be edited after it is sent, only withdrawn.">
        <form noValidate onSubmit={handleReview} className="mt-3 flex max-w-[720px] flex-col gap-4">
          <Field label="Title" error={errors.title}>
            <Input value={draft.title} maxLength={NOTICE_TITLE_MAX} disabled={busy} onChange={(event) => change({ title: event.target.value })} />
          </Field>
          <Field label="Notice" error={errors.body} hint={`${bodyLeft.toLocaleString()} characters left`}>
            <Textarea rows={4} value={draft.body} maxLength={NOTICE_BODY_MAX} disabled={busy} onChange={(event) => change({ body: event.target.value })} />
          </Field>
          <Field label="Link" optional error={errors.link} hint="A web address that starts with https://, or a page in the app such as /settings/notifications.">
            <Input value={draft.link} maxLength={NOTICE_LINK_MAX} inputMode="url" disabled={busy} onChange={(event) => change({ link: event.target.value })} />
          </Field>
          <FormGrid>
            <Field label="Who is it for" hint={NOTICE_AUDIENCE_HINT[draft.audience]}>
              <Select value={draft.audience} disabled={busy} onChange={(event) => change({ audience: event.target.value as NoticeAudience })}>
                {(Object.keys(NOTICE_AUDIENCE_LABEL) as NoticeAudience[]).map((audience) => (
                  <option key={audience} value={audience}>
                    {NOTICE_AUDIENCE_LABEL[audience]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Stop showing on" optional error={errors.expiresAt} hint="Left empty, it shows until each person dismisses it.">
              <Input type="datetime-local" value={draft.expiresAt} disabled={busy} onChange={(event) => change({ expiresAt: event.target.value })} />
            </Field>
          </FormGrid>
          <List aria-label="Email">
            <CheckRow
              checked={draft.emailClubAdmins}
              disabled={busy}
              onChange={(next) => change({ emailClubAdmins: next })}
              title="Also email club admins"
              subtitle="Only club admins are emailed, whoever the notice is for."
            />
          </List>

          {sendError ? <Notice tone="error">{sendError}</Notice> : null}

          {confirmSend ? (
            <div role="group" aria-label="Confirm" className="flex flex-col gap-3">
              <p className="sk-list-title">
                Send this to {NOTICE_AUDIENCE_LABEL[draft.audience].toLowerCase()} in every open club{draft.emailClubAdmins ? ", and email club admins" : ""}?
              </p>
              <FormActions>
                <Button variant="quiet" disabled={busy} onClick={() => setConfirmSend(false)}>
                  Not yet
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => void handleSend()}>
                  {busy ? "Sending..." : "Send notice"}
                </Button>
              </FormActions>
            </div>
          ) : (
            <FormActions>
              <Button type="submit" variant="primary" disabled={busy}>
                Review and send
              </Button>
            </FormActions>
          )}
        </form>
      </Section>
    </Screen>
  )
}

import { Archive, ArrowRight, ClipboardText, CopySimple, PencilSimple, Plus, Trash } from "@phosphor-icons/react"
import { useState } from "react"
import { EmptyState, PageHeader, Panel, Segmented, Tag, type TagTone } from "@/components/sk"
import { addDaysIso, formatDateRange, type PlanStatus } from "@/lib/data/training-plan/plan-builder-model"
import type { PlanListItem, TeamOption } from "./storage"
import { ErrorNote, plural } from "./ui"

type Filter = "all" | PlanStatus

const STATUS_TAG: Record<PlanStatus, { label: string; tone: TagTone }> = {
  draft: { label: "Draft", tone: "yellow" },
  published: { label: "Published", tone: "green" },
  archived: { label: "Archived", tone: "plain" },
}

export function PlanStatusTag({ status }: { status: PlanStatus }) {
  return <Tag tone={STATUS_TAG[status].tone}>{STATUS_TAG[status].label}</Tag>
}

export function PlanList({
  plans,
  teams,
  loading,
  error,
  busyPlanId,
  unsaved,
  onNew,
  onOpen,
  onDuplicate,
  onArchive,
  onDelete,
  onResumeUnsaved,
  onDiscardUnsaved,
}: {
  plans: PlanListItem[]
  teams: TeamOption[]
  loading: boolean
  error: string | null
  busyPlanId: string | null
  unsaved: { name: string } | null
  onNew: () => void
  onOpen: (plan: PlanListItem) => void
  onDuplicate: (plan: PlanListItem) => void
  onArchive: (plan: PlanListItem) => void
  onDelete: (plan: PlanListItem) => void
  onResumeUnsaved: () => void
  onDiscardUnsaved: () => void
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const counts = {
    draft: plans.filter((plan) => plan.status === "draft").length,
    published: plans.filter((plan) => plan.status === "published").length,
    archived: plans.filter((plan) => plan.status === "archived").length,
  }
  const visible = filter === "all" ? plans.filter((plan) => plan.status !== "archived") : plans.filter((plan) => plan.status === filter)

  const lede = loading
    ? "Loading..."
    : plans.length === 0
      ? "Build a multi-week plan, then send it to a team or to the athletes you pick."
      : [
          plural(counts.published, "published plan"),
          counts.draft > 0 ? `${plural(counts.draft, "draft")} waiting to be published` : null,
        ]
          .filter(Boolean)
          .join(", ") + "."

  return (
    <div className="sk-page">
      <PageHeader
        title="Training plans"
        lede={lede}
        actions={
          <button type="button" className="sk-btn sk-btn-primary" onClick={onNew}>
            <Plus className="size-5" weight="bold" />
            New plan
          </button>
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {unsaved ? (
        <section className="flex flex-col gap-3 rounded-[20px] bg-sk-yellow-tint p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="sk-h3">You have unsaved work</h2>
            <p className="mt-0.5 text-sm text-sk-ink-2">
              Changes to {unsaved.name ? `"${unsaved.name}"` : "a new plan"} were kept in this browser but not saved.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="sk-btn sk-btn-ink sk-btn-sm" onClick={onResumeUnsaved}>
              Resume editing
            </button>
            <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" onClick={onDiscardUnsaved}>
              Discard
            </button>
          </div>
        </section>
      ) : null}

      {!loading && plans.length === 0 ? (
        <EmptyState
          icon={<ClipboardText className="size-6" weight="fill" />}
          title="No plans yet"
          body="Your drafts and published plans will be listed here with who they are assigned to."
          action={
            <button type="button" className="sk-btn sk-btn-ink sk-btn-sm" onClick={onNew}>
              Build your first plan
            </button>
          }
        />
      ) : null}

      {plans.length > 0 ? (
        <Panel
          flush
          title="Your plans"
          action={
            <Segmented<Filter>
              label="Filter plans"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "Active" },
                { value: "draft", label: `Drafts ${counts.draft}` },
                { value: "archived", label: `Archived ${counts.archived}` },
              ]}
            />
          }
          className="[&>div:first-child]:flex-col sm:[&>div:first-child]:flex-row"
        >
          {visible.length === 0 ? (
            <p className="px-5 py-8 text-sm text-sk-mute sm:px-6">
              {filter === "draft" ? "No drafts. Start a new plan and save it to come back later." : "Nothing here."}
            </p>
          ) : (
            <ul className="mt-3" aria-label="Training plans">
              {visible.map((plan) => {
                const team = teams.find((candidate) => candidate.id === plan.teamId)
                const busy = busyPlanId === plan.id
                const editable = plan.status !== "archived"
                const range = formatDateRange(plan.startDate, addDaysIso(plan.startDate, plan.weeks * 7 - 1))
                const open = () => (editable ? onOpen(plan) : onDuplicate(plan))
                return (
                  <li
                    key={plan.id}
                    data-plan-status={plan.status}
                    className="grid gap-x-4 gap-y-3 border-t border-sk-line px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_9rem_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <button
                          type="button"
                          className="min-w-0 truncate text-left text-lg font-bold tracking-[-0.01em] text-sk-ink hover:text-sk-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
                          onClick={open}
                          disabled={busy}
                        >
                          {plan.name || "Untitled plan"}
                        </button>
                        <PlanStatusTag status={plan.status} />
                      </div>
                      <p className="mt-0.5 text-sm text-sk-mute">
                        {[team?.name ?? "No team", range, plural(plan.weeks, "week")].join(" · ")}
                      </p>
                    </div>

                    <p className="text-sm text-sk-mute">
                      {plan.athleteCount === null ? (
                        "Not sent to athletes"
                      ) : (
                        <>
                          <span className="text-base font-bold tabular-nums text-sk-ink">{plan.athleteCount}</span>{" "}
                          {plan.athleteCount === 1 ? "athlete" : "athletes"}
                        </>
                      )}
                    </p>

                    {confirmDeleteId === plan.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-sk-ink">Delete this plan for good?</span>
                        <button
                          type="button"
                          className="sk-btn sk-btn-danger sk-btn-sm"
                          disabled={busy}
                          onClick={() => {
                            setConfirmDeleteId(null)
                            onDelete(plan)
                          }}
                        >
                          Yes, delete
                        </button>
                        <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" onClick={() => setConfirmDeleteId(null)}>
                          Keep it
                        </button>
                      </div>
                    ) : (
                      <div className="-ml-3 flex flex-wrap items-center gap-1 lg:ml-0 lg:justify-end">
                        {editable ? (
                          <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" disabled={busy} onClick={open}>
                            {plan.status === "draft" ? <ArrowRight className="size-4" weight="bold" /> : <PencilSimple className="size-4" weight="bold" />}
                            {plan.status === "draft" ? "Continue" : "Edit"}
                          </button>
                        ) : null}
                        <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" disabled={busy} onClick={() => onDuplicate(plan)}>
                          <CopySimple className="size-4" weight="bold" />
                          Duplicate
                        </button>
                        {plan.status === "published" ? (
                          <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" disabled={busy} onClick={() => onArchive(plan)}>
                            <Archive className="size-4" weight="bold" />
                            Archive
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="sk-btn sk-btn-ghost sk-btn-sm"
                          disabled={busy}
                          aria-label={`Delete ${plan.name || "plan"}`}
                          onClick={() => setConfirmDeleteId(plan.id)}
                        >
                          <Trash className="size-4" weight="bold" />
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  )
}

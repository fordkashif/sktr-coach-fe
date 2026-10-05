import { Plus } from "@phosphor-icons/react"
import { useState } from "react"
import { ActionRow, Button, EmptyState, InlineConfirm, List, Notice, RowMenu, Screen, ScreenHeader, Section, Segmented, SkeletonRows } from "@/components/sk"
import { addDaysIso, formatDateRange, type PlanStatus } from "@/lib/data/training-plan/plan-builder-model"
import type { PlanListItem, TeamOption } from "./storage"
import { PlansNav } from "./plans-nav"
import { PlanStatusText, plural } from "./ui"

type Filter = "all" | PlanStatus

export function PlanList({
  plans,
  teams,
  showTeam,
  loading,
  error,
  busyPlanId,
  unsaved,
  onNew,
  onOpen,
  onDuplicate,
  onArchive,
  onDelete,
  onPrint,
  onResumeUnsaved,
  onDiscardUnsaved,
}: {
  plans: PlanListItem[]
  teams: TeamOption[]
  /** Name the team on each row (a club admin sees every team's plans). */
  showTeam: boolean
  loading: boolean
  error: string | null
  busyPlanId: string | null
  unsaved: { name: string } | null
  onNew: () => void
  onOpen: (plan: PlanListItem) => void
  onDuplicate: (plan: PlanListItem) => void
  onArchive: (plan: PlanListItem) => void
  onDelete: (plan: PlanListItem) => void
  onPrint: (plan: PlanListItem) => void
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
    ? "Getting your plans..."
    : plans.length === 0
      ? "Build a plan week by week, then send it to a team, an event group or the athletes you pick."
      : [plural(counts.published, "published plan"), counts.draft > 0 ? `${plural(counts.draft, "draft")} not sent yet` : null].filter(Boolean).join(", ") + "."

  return (
    <Screen>
      <ScreenHeader
        title="Training plans"
        lede={lede}
        actions={
          <Button variant="primary" onClick={onNew}>
            <Plus className="size-5" weight="bold" aria-hidden />
            New plan
          </Button>
        }
      />

      <PlansNav />

      {error ? <Notice tone="error">{error}</Notice> : null}

      {unsaved ? (
        <Notice
          tone="warning"
          action={
            <span className="flex gap-1">
              <Button size="sm" onClick={onResumeUnsaved}>
                Resume editing
              </Button>
              <Button size="sm" variant="quiet" onClick={onDiscardUnsaved}>
                Discard
              </Button>
            </span>
          }
        >
          Unsaved changes to {unsaved.name ? `"${unsaved.name}"` : "a new plan"} are kept on this device.
        </Notice>
      ) : null}

      <Section
        title="Plans"
        action={
          plans.length > 0 ? (
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
          ) : null
        }
      >
        {loading ? (
          <SkeletonRows rows={3} label="Loading plans" />
        ) : plans.length === 0 ? (
          <EmptyState
            title="No plans yet"
            body="Your drafts and published plans are listed here with who they go to."
            action={
              <Button size="sm" onClick={onNew}>
                Build your first plan
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={filter === "draft" ? "No drafts" : filter === "archived" ? "Nothing archived" : "No active plans"}
            body={filter === "draft" ? "Start a new plan and save it to come back to it later." : "Plans you archive are kept here. Duplicate one to use it again."}
          />
        ) : (
          <List aria-label="Training plans">
            {visible.map((plan) => {
              const team = teams.find((candidate) => candidate.id === plan.teamId)
              const busy = busyPlanId === plan.id
              const editable = plan.status !== "archived"
              const name = plan.name || "Untitled plan"
              const range = formatDateRange(plan.startDate, addDaysIso(plan.startDate, plan.weeks * 7 - 1))
              const audience =
                plan.athleteCount === null ? "Not sent to athletes" : plural(plan.athleteCount, "athlete")
              return (
                <ActionRow
                  key={plan.id}
                  data-plan-status={plan.status}
                  title={name}
                  subtitle={[showTeam ? (team?.name ?? "No team") : null, range, plural(plan.weeks, "week"), audience].filter(Boolean).join(", ")}
                  trailing={<PlanStatusText status={plan.status} />}
                  disabled={busy}
                  onClick={() => (editable ? onOpen(plan) : onDuplicate(plan))}
                  actions={
                    <RowMenu
                      label={`More for ${name}`}
                      items={[
                        ...(editable ? [{ label: plan.status === "draft" ? "Continue building" : "Edit plan", onSelect: () => onOpen(plan), disabled: busy }] : []),
                        { label: "Duplicate", onSelect: () => onDuplicate(plan), disabled: busy },
                        { label: "Print or save as PDF", onSelect: () => onPrint(plan), disabled: busy },
                        ...(plan.status === "published" ? [{ label: "Archive", onSelect: () => onArchive(plan), disabled: busy }] : []),
                        { label: "Delete", danger: true, onSelect: () => setConfirmDeleteId(plan.id), disabled: busy },
                      ]}
                    />
                  }
                  below={
                    confirmDeleteId === plan.id ? (
                      <InlineConfirm
                        question={`Delete "${name}" for good?${plan.status === "published" ? " Athletes lose it too." : ""}`}
                        confirmLabel="Yes, delete"
                        busy={busy}
                        onCancel={() => setConfirmDeleteId(null)}
                        onConfirm={() => {
                          setConfirmDeleteId(null)
                          onDelete(plan)
                        }}
                      />
                    ) : null
                  }
                />
              )
            })}
          </List>
        )}
      </Section>
    </Screen>
  )
}

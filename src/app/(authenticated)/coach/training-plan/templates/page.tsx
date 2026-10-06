import { useUndoableDelete } from "@/lib/use-undoable-delete"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { PlansNav } from "@/components/coach/training-plan/plans-nav"
import { TemplateDetailsDialog } from "@/components/coach/training-plan/template-details-dialog"
import { TemplatePreview } from "@/components/coach/training-plan/template-preview"
import { templateFacts } from "@/components/coach/training-plan/ui"
import {
  ActionRow,
  EmptyState,
  FilterBar,
  FilterChips,
  InlineConfirm,
  LinkButton,
  List,
  Notice,
  RowMenu,
  Screen,
  ScreenHeader,
  SearchInput,
  Section,
  Segmented,
  SkeletonRows,
} from "@/components/sk"
import { EVENT_GROUPS } from "@/lib/data/training-plan/plan-builder-model"
import {
  deletePlanTemplate,
  duplicatePlanTemplate,
  listPlanTemplates,
  setPlanTemplateArchived,
  updatePlanTemplateDetails,
} from "@/lib/data/training-plan/plan-template-data"
import { TEMPLATE_PHASES, filterTemplates, type PlanTemplateSummary, type TemplatePhase } from "@/lib/data/training-plan/plan-templates"
import type { EventGroup } from "@/lib/mock-data"

type View = "active" | "archived"

/** The club's plan templates: find one, look inside, start a plan from it, and look after the list. */
export default function CoachPlanTemplatesPage() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<PlanTemplateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>("active")
  const [search, setSearch] = useState("")
  const [phase, setPhase] = useState<TemplatePhase | "all">("all")
  const [eventGroup, setEventGroup] = useState<EventGroup | "all">("all")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const undoableDelete = useUndoableDelete()
  const [editing, setEditing] = useState<PlanTemplateSummary | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  // The last change, said in a line above the list (and read out).
  const [changed, setChanged] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await listPlanTemplates()
    setLoading(false)
    if (!result.ok) return setError(`Could not load the templates: ${result.error.message}`)
    setError(null)
    setTemplates(result.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => ({ active: templates.filter((template) => !template.archived).length, archived: templates.filter((template) => template.archived).length }), [templates])
  const inView = useMemo(() => templates.filter((template) => template.archived === (view === "archived")), [templates, view])
  const visible = useMemo(() => filterTemplates(templates, { query: search, phase, eventGroup, archived: view === "archived" }), [templates, search, phase, eventGroup, view])
  const previewing = templates.find((template) => template.id === previewId) ?? null

  const startPlan = (template: PlanTemplateSummary) => navigate(`/coach/training-plan?template=${encodeURIComponent(template.id)}`)

  const run = async (template: PlanTemplateSummary, action: "archive" | "restore" | "duplicate" | "delete") => {
    setBusyId(template.id)
    const result =
      action === "duplicate"
        ? await duplicatePlanTemplate(template.id)
        : action === "delete"
          ? await deletePlanTemplate(template.id)
          : await setPlanTemplateArchived(template.id, action === "archive")
    setBusyId(null)
    if (!result.ok) {
      setChanged(null)
      return setError(`"${template.name}" was not ${action === "duplicate" ? "copied" : action === "delete" ? "deleted" : action === "archive" ? "archived" : "restored"}. ${result.error.message}`)
    }
    setError(null)
    setChanged(
      action === "duplicate"
        ? `Copied. "${result.data?.name ?? template.name}" is yours to change.`
        : action === "delete"
          ? `"${template.name}" is deleted. Plans started from it are not changed.`
          : action === "archive"
            ? `"${template.name}" is archived. It is no longer offered when starting a plan.`
            : `"${template.name}" is back in the list.`,
    )
    await load()
  }

  // The template leaves the list at once. The delete is sent when "Undo" runs out.
  const removeWithUndo = (template: PlanTemplateSummary) => {
    setError(null)
    setChanged(null)
    undoableDelete({
      message: "Template deleted",
      detail: "Plans started from it are not changed.",
      failed: `"${template.name}" was not deleted`,
      hide: () => setTemplates((current) => current.filter((item) => item.id !== template.id)),
      restore: () => void load(),
      commit: () => deletePlanTemplate(template.id),
    })
  }

  const lede = loading
    ? "Getting the templates..."
    : counts.active === 0
      ? "Save a plan you want to use again as a template, then start next season's plan from it."
      : `${counts.active} ${counts.active === 1 ? "template" : "templates"}, shared by every coach in the club.`

  const filtersInUse = (phase === "all" ? 0 : 1) + (eventGroup === "all" ? 0 : 1)

  return (
    <Screen>
      <ScreenHeader title="Templates" lede={lede} />

      <PlansNav />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {changed ? (
        <p role="status" className="text-[0.9375rem] font-semibold text-sk-green-ink">
          {changed}
        </p>
      ) : null}

      <Section
        title="Plan templates"
        action={
          templates.length > 0 ? (
            <Segmented<View>
              label="Show"
              value={view}
              onChange={(next) => {
                setView(next)
                setConfirmDeleteId(null)
              }}
              options={[
                { value: "active", label: `In use ${counts.active}` },
                { value: "archived", label: `Archived ${counts.archived}` },
              ]}
            />
          ) : null
        }
      >
        {loading ? (
          <SkeletonRows rows={3} label="Loading templates" />
        ) : templates.length === 0 ? (
          <EmptyState
            title="No templates yet"
            body="Open a plan, choose Save as template, and it is listed here for every coach in the club."
            action={
              <LinkButton size="sm" to="/coach/training-plan">
                Go to plans
              </LinkButton>
            }
          />
        ) : (
          <>
            <FilterBar
              className="mt-3"
              search={<SearchInput aria-label="Search templates" placeholder="Search templates" value={search} onChange={(event) => setSearch(event.target.value)} />}
              activeCount={filtersInUse}
              onClear={() => {
                setPhase("all")
                setEventGroup("all")
              }}
            >
              <FilterChips<TemplatePhase | "all">
                label="Phase"
                value={phase}
                onChange={setPhase}
                options={[{ value: "all", label: "All" }, ...TEMPLATE_PHASES.filter((entry) => phase === entry.value || inView.some((template) => template.phase === entry.value))]}
              />
              <FilterChips<EventGroup | "all">
                label="Event group"
                value={eventGroup}
                onChange={setEventGroup}
                options={[{ value: "all", label: "All" }, ...EVENT_GROUPS.filter((entry) => eventGroup === entry.value || inView.some((template) => template.eventGroup === entry.value))]}
              />
            </FilterBar>

            {visible.length === 0 ? (
              <EmptyState
                title={inView.length === 0 ? (view === "archived" ? "Nothing archived" : "No templates in use") : "No template matches"}
                body={
                  inView.length === 0
                    ? view === "archived"
                      ? "Templates you archive are kept here and can be restored."
                      : "Every template is archived. Restore one, or save a plan as a new template."
                    : "Try another word, or clear the filters."
                }
              />
            ) : (
              <List aria-label={view === "archived" ? "Archived templates" : "Templates"} className="mt-2">
                {visible.map((template) => {
                  const busy = busyId === template.id
                  return (
                    <ActionRow
                      key={template.id}
                      data-template-id={template.id}
                      title={template.name}
                      subtitle={templateFacts(template)}
                      disabled={busy}
                      onClick={() => setPreviewId(template.id)}
                      actions={
                        <RowMenu
                          label={`More for ${template.name}`}
                          items={[
                            ...(template.archived ? [] : [{ label: "Start a plan from it", onSelect: () => startPlan(template), disabled: busy }]),
                            { label: "Preview", onSelect: () => setPreviewId(template.id), disabled: busy },
                            ...(template.canManage ? [{ label: "Rename and edit details", onSelect: () => setEditing(template), disabled: busy }] : []),
                            { label: "Duplicate", onSelect: () => void run(template, "duplicate"), disabled: busy },
                            ...(template.canManage
                              ? [
                                  template.archived
                                    ? { label: "Restore", onSelect: () => void run(template, "restore"), disabled: busy }
                                    : { label: "Archive", onSelect: () => void run(template, "archive"), disabled: busy },
                                  { label: "Delete", danger: true, onSelect: () => setConfirmDeleteId(template.id), disabled: busy },
                                ]
                              : []),
                          ]}
                        />
                      }
                      below={
                        confirmDeleteId === template.id ? (
                          <InlineConfirm
                            question={`Delete "${template.name}" for good? Plans started from it stay as they are.`}
                            confirmLabel="Yes, delete"
                            busy={busy}
                            onCancel={() => setConfirmDeleteId(null)}
                            onConfirm={() => {
                              setConfirmDeleteId(null)
                              removeWithUndo(template)
                            }}
                          />
                        ) : null
                      }
                    />
                  )
                })}
              </List>
            )}
          </>
        )}
      </Section>

      {previewing ? <TemplatePreview template={previewing} onClose={() => setPreviewId(null)} onUse={previewing.archived ? undefined : () => startPlan(previewing)} /> : null}

      {editing ? (
        <TemplateDetailsDialog
          mode="edit"
          initial={{ name: editing.name, description: editing.description, phase: editing.phase, eventGroup: editing.eventGroup }}
          onClose={() => setEditing(null)}
          onSave={async (details) => {
            const result = await updatePlanTemplateDetails(editing.id, details)
            if (!result.ok) return result.error.message
            setEditing(null)
            setError(null)
            setChanged(`"${result.data.name}" saved.`)
            await load()
            return null
          }}
        />
      ) : null}
    </Screen>
  )
}

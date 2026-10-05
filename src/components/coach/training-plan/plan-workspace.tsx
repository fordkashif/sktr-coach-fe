import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  createEmptyPlan,
  duplicateAsDraft,
  planFromBuilderState,
  toBuilderState,
  validateBasics,
  type PlanDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import { useCoachTeams, useTeamSwitchGuard } from "@/lib/coach-teams"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { PlanBuilder } from "./plan-builder"
import { PlanList } from "./plan-list"
import { PlanPrintDialog } from "./plan-print"
import { PlanPublish, PlanPublished } from "./plan-publish"
import { PlanSetup } from "./plan-setup"
import type { PlanDirectory, PlanListItem, PlanStorageAdapter } from "./storage"

type View = "list" | "setup" | "build" | "publish" | "done"
type Busy = null | "opening" | "saving" | "publishing"

const UNSAVED_KEY = "pacelab:coach-plan-unsaved:v1"

/** Safety net: in-progress work is mirrored to this browser so a refresh never loses it. */
function readUnsaved(): PlanDraft | null {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(UNSAVED_KEY))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { plan?: Partial<PlanDraft> }
    const plan = parsed.plan
    if (!plan || typeof plan !== "object") return null
    return planFromBuilderState(
      {
        id: typeof plan.id === "string" ? plan.id : null,
        status: plan.status === "published" ? "published" : "draft",
        name: typeof plan.name === "string" ? plan.name : "",
        teamId: typeof plan.teamId === "string" ? plan.teamId : "",
        startDate: typeof plan.startDate === "string" ? plan.startDate : "",
        weeks: typeof plan.weeks === "number" && Number.isInteger(plan.weeks) && plan.weeks > 0 ? plan.weeks : 1,
        notes: typeof plan.notes === "string" ? plan.notes : "",
      },
      plan,
    )
  } catch {
    return null
  }
}

function writeUnsaved(plan: PlanDraft | null) {
  try {
    const key = tenantStorageKey(UNSAVED_KEY)
    if (plan) window.localStorage.setItem(key, JSON.stringify({ plan: { ...plan, ...toBuilderState(plan) }, savedAt: new Date().toISOString() }))
    else window.localStorage.removeItem(key)
  } catch {
    // Storage can be full or blocked. The explicit Save draft still works.
  }
}

/**
 * The whole coach "Training plans" screen: plan list, setup, week planner, publish.
 * Storage is injected, so mock mode and the real backend share every pixel and feature.
 */
export function PlanWorkspace({
  adapter,
  selectedTeamId,
  teamLocked,
}: {
  adapter: PlanStorageAdapter
  /** The coach's selected team: the list shows it and new plans start on it. Null for club admins. */
  selectedTeamId: string | null
  /** True when the team on a plan cannot be changed (a coach with one team). */
  teamLocked: boolean
}) {
  const { syncSelectedTeam } = useCoachTeams()
  const [directory, setDirectory] = useState<PlanDirectory>({ teams: [], athletes: [] })
  const [plans, setPlans] = useState<PlanListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)

  const [view, setView] = useState<View>("list")
  const [plan, setPlan] = useState<PlanDraft | null>(null)
  const [isNewSetup, setIsNewSetup] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [savedLabel, setSavedLabel] = useState<string | null>(null)
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false)
  const [published, setPublished] = useState<{ count: number; wasUpdate: boolean } | null>(null)
  const [unsaved, setUnsaved] = useState<PlanDraft | null>(() => readUnsaved())
  const [builderKey, setBuilderKey] = useState(0)
  // The plan the print dialog is open for, and the week it starts on.
  const [printing, setPrinting] = useState<{ plan: PlanDraft; week: number } | null>(null)
  const opening = useRef(false)

  // Only the newest load may land, so a slow answer for the last team never overwrites the new one.
  const refreshRun = useRef(0)
  const refresh = useCallback(async () => {
    const run = ++refreshRun.current
    const [directoryResult, plansResult] = await Promise.all([adapter.loadDirectory(), adapter.listPlans()])
    if (run !== refreshRun.current) return
    setLoading(false)
    if (!directoryResult.ok) return setListError(`Could not load your teams: ${directoryResult.error.message}`)
    setDirectory(directoryResult.data)
    if (!plansResult.ok) return setListError(`Could not load your plans: ${plansResult.error.message}`)
    setPlans(plansResult.data)
    setListError(null)
  }, [adapter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Switching team: drop the last team's list before it can be seen, and leave a plan that belongs to
  // another team. Unsaved edits are kept on this device (the list offers to pick them up again).
  const latest = useRef({ view, plan, dirty })
  useEffect(() => {
    latest.current = { view, plan, dirty }
  })
  const shownTeamId = useRef(selectedTeamId)
  useLayoutEffect(() => {
    if (shownTeamId.current === selectedTeamId) return
    shownTeamId.current = selectedTeamId
    setPlans([])
    setLoading(true)
    setListError(null)
    const open = latest.current
    if (open.view === "list" || !open.plan || open.plan.teamId === selectedTeamId) return
    if (open.dirty) {
      writeUnsaved(open.plan)
      setUnsaved(open.plan)
    }
    setView("list")
    setPlan(null)
    setDirty(false)
    setActionError(null)
    setMobileEditorOpen(false)
  }, [selectedTeamId])

  useTeamSwitchGuard(
    plan && dirty && view !== "list"
      ? "You have unsaved changes to this plan. Switch team anyway? Your work stays on this device so you can pick it up later."
      : null,
  )

  // Mirror unsaved edits to this browser.
  useEffect(() => {
    if (!plan || !dirty) return
    const timer = window.setTimeout(() => writeUnsaved(plan), 250)
    return () => window.clearTimeout(timer)
  }, [dirty, plan])

  // Each step starts at the top of the page.
  useEffect(() => {
    document.getElementById("main-content")?.scrollTo({ top: 0 })
  }, [view])

  const backToList = useCallback(() => {
    if (plan && dirty) {
      writeUnsaved(plan)
      setUnsaved(plan)
    }
    setView("list")
    setPlan(null)
    setDirty(false)
    setActionError(null)
    setMobileEditorOpen(false)
    void refresh()
  }, [dirty, plan, refresh])

  const goBack = useCallback(() => {
    if (view === "publish") return setView("build")
    if (view === "setup" && !isNewSetup) return setView("build")
    if (view === "setup" && isNewSetup) {
      setView("list")
      setPlan(null)
      return
    }
    backToList()
  }, [backToList, isNewSetup, view])

  const enterBuilder = (next: PlanDraft, options: { dirty: boolean; savedLabel?: string | null }) => {
    setPlan(next)
    setDirty(options.dirty)
    setSavedLabel(options.savedLabel ?? null)
    setActionError(null)
    setMobileEditorOpen(false)
    setPublished(null)
    setBuilderKey((key) => key + 1)
    setView("build")
  }

  const startNew = () => {
    setPlan(createEmptyPlan(selectedTeamId ?? directory.teams[0]?.id ?? ""))
    setIsNewSetup(true)
    setDirty(false)
    setActionError(null)
    setView("setup")
  }

  const loadForEdit = async (item: PlanListItem, asCopy: boolean) => {
    if (opening.current) return
    opening.current = true
    setBusyPlanId(item.id)
    const result = await adapter.loadPlan(item.id)
    opening.current = false
    setBusyPlanId(null)
    if (!result.ok) return setListError(`Could not open "${item.name}": ${result.error.message}`)
    setListError(null)
    if (asCopy) enterBuilder(duplicateAsDraft(result.data), { dirty: true })
    else enterBuilder(result.data, { dirty: false, savedLabel: result.data.status === "draft" ? "Draft saved." : "Published. Changes go live when you update." })
  }

  const runListAction = async (item: PlanListItem, action: "archive" | "remove") => {
    setBusyPlanId(item.id)
    const result = action === "archive" ? await adapter.archive(item.id) : await adapter.remove(item.id)
    setBusyPlanId(null)
    if (!result.ok) {
      return setListError(`Could not ${action === "archive" ? "archive" : "delete"} "${item.name}": ${result.error.message}`)
    }
    if (unsaved?.id === item.id) {
      writeUnsaved(null)
      setUnsaved(null)
    }
    setListError(null)
    await refresh()
  }

  const changePlan = useCallback((updater: (current: PlanDraft) => PlanDraft) => {
    setPlan((current) => (current ? updater(current) : current))
    setDirty(true)
  }, [])

  const clearUnsaved = () => {
    writeUnsaved(null)
    setUnsaved(null)
  }

  const saveDraft = async () => {
    if (!plan || busy) return
    const invalid = validateBasics(plan)
    if (invalid) return setActionError(`${invalid} Open plan details to fix it.`)
    setBusy("saving")
    const result = await adapter.saveDraft(plan)
    setBusy(null)
    if (!result.ok) return setActionError(`Draft not saved: ${result.error.message}`)
    setPlan((current) => (current ? { ...current, id: result.data.planId, status: "draft" } : current))
    setDirty(false)
    setActionError(null)
    setSavedLabel(`Draft saved at ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`)
    clearUnsaved()
    // A plan saved for another of the coach's teams: show that team, so the plan is in the list.
    if (selectedTeamId) syncSelectedTeam(plan.teamId)
  }

  const publish = async () => {
    if (!plan || busy) return
    setBusy("publishing")
    const wasUpdate = plan.status === "published"
    let target = plan

    // A brand new plan is stored as a draft first, so a failed publish can be retried without creating duplicates.
    if (!target.id) {
      const draftResult = await adapter.saveDraft(target)
      if (!draftResult.ok) {
        setBusy(null)
        return setActionError(`Not published: ${draftResult.error.message}`)
      }
      target = { ...target, id: draftResult.data.planId, status: "draft" }
      setPlan(target)
    }

    const result = await adapter.publish(target)
    setBusy(null)
    if (!result.ok) {
      return setActionError(
        `Not published: ${result.error.message} Nothing was lost, your work is still here so you can try again.`,
      )
    }
    setPlan({ ...target, id: result.data.planId, status: "published" })
    setDirty(false)
    setActionError(null)
    setSavedLabel("Published. Changes go live when you update.")
    clearUnsaved()
    setPublished({ count: result.data.assignedCount, wasUpdate })
    setView("done")
    if (selectedTeamId) syncSelectedTeam(target.teamId)
    void refresh()
  }

  const team = useMemo(() => directory.teams.find((candidate) => candidate.id === plan?.teamId) ?? null, [directory.teams, plan?.teamId])

  const printFromList = async (item: PlanListItem) => {
    setBusyPlanId(item.id)
    const result = await adapter.loadPlan(item.id)
    setBusyPlanId(null)
    if (!result.ok) return setListError(`Could not open "${item.name}" to print it: ${result.error.message}`)
    setListError(null)
    setPrinting({ plan: result.data, week: 1 })
  }

  const printDialog = printing ? (
    <PlanPrintDialog
      plan={printing.plan}
      team={directory.teams.find((candidate) => candidate.id === printing.plan.teamId) ?? null}
      athletes={directory.athletes}
      initialWeek={printing.week}
      onClose={() => setPrinting(null)}
    />
  ) : null

  if (view === "setup" && plan) {
    return (
      <PlanSetup
        plan={plan}
        teams={directory.teams}
        isNew={isNewSetup}
        teamLocked={teamLocked}
        onCancel={goBack}
        onDone={(next) => {
          if (isNewSetup) {
            setIsNewSetup(false)
            enterBuilder(next, { dirty: true })
          } else {
            setPlan(next)
            setDirty(true)
            setView("build")
          }
        }}
      />
    )
  }

  if (view === "build" && plan) {
    return (
      <>
      {printDialog}
      <PlanBuilder
        key={builderKey}
        plan={plan}
        team={team}
        dirty={dirty}
        busy={busy !== null}
        error={actionError}
        savedLabel={savedLabel}
        mobileEditorOpen={mobileEditorOpen}
        onMobileEditorChange={setMobileEditorOpen}
        onChange={changePlan}
        onBack={backToList}
        onEditDetails={() => {
          setIsNewSetup(false)
          setView("setup")
        }}
        onSaveDraft={() => void saveDraft()}
        onReview={() => {
          setActionError(null)
          setMobileEditorOpen(false)
          setView("publish")
        }}
        onPrint={(week) => setPrinting({ plan, week })}
      />
      </>
    )
  }

  if (view === "publish" && plan) {
    return (
      <PlanPublish
        plan={plan}
        teams={directory.teams}
        athletes={directory.athletes}
        busy={busy !== null}
        error={actionError}
        onChange={changePlan}
        onBack={() => setView("build")}
        onPublish={() => void publish()}
      />
    )
  }

  if (view === "done" && plan && published) {
    return (
      <>
      {printDialog}
      <PlanPublished
        plan={plan}
        count={published.count}
        wasUpdate={published.wasUpdate}
        onBackToList={backToList}
        onKeepEditing={() => setView("build")}
        onPrint={() => setPrinting({ plan, week: 1 })}
      />
      </>
    )
  }

  return (
    <>
    {printDialog}
    <PlanList
      plans={plans}
      teams={directory.teams}
      showTeam={selectedTeamId === null}
      onPrint={(item) => void printFromList(item)}
      loading={loading}
      error={listError}
      busyPlanId={busyPlanId}
      unsaved={unsaved ? { name: unsaved.name } : null}
      onNew={startNew}
      onOpen={(item) => void loadForEdit(item, false)}
      onDuplicate={(item) => void loadForEdit(item, true)}
      onArchive={(item) => void runListAction(item, "archive")}
      onDelete={(item) => void runListAction(item, "remove")}
      onResumeUnsaved={() => {
        if (!unsaved) return
        setUnsaved(null)
        enterBuilder(unsaved, { dirty: true })
      }}
      onDiscardUnsaved={clearUnsaved}
    />
    </>
  )
}

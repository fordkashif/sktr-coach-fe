import { useState } from "react"
import { Button, Dialog, Field, FormGrid, Input, Notice, Select, Textarea } from "@/components/sk"
import { EVENT_GROUPS } from "@/lib/data/training-plan/plan-builder-model"
import {
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_NAME_MAX,
  TEMPLATE_PHASES,
  asEventGroup,
  asTemplatePhase,
  validateTemplateDetails,
  type PlanTemplateDetails,
} from "@/lib/data/training-plan/plan-templates"

/**
 * Name, description and tags of a plan template. Used to save a plan as a template and to edit a
 * template's details. `onSave` returns a message when it failed, or null when it is done.
 */
export function TemplateDetailsDialog({
  mode,
  initial,
  onClose,
  onSave,
}: {
  mode: "save" | "edit"
  initial: PlanTemplateDetails
  onClose: () => void
  onSave: (details: PlanTemplateDetails) => Promise<string | null>
}) {
  const [details, setDetails] = useState<PlanTemplateDetails>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (saving) return
    const invalid = validateTemplateDetails(details)
    if (invalid) return setError(invalid)
    setSaving(true)
    const failed = await onSave(details)
    setSaving(false)
    if (failed) setError(failed)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={mode === "save" ? "Save as template" : "Template details"}
      description={
        mode === "save"
          ? "Every coach in your club can start a plan from it. The team, dates, who it is sent to and changes for single athletes are left out."
          : "The name and tags coaches see when they look for a template."
      }
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving..." : mode === "save" ? "Save template" : "Save details"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label="Template name">
          <Input value={details.name} maxLength={TEMPLATE_NAME_MAX} autoFocus onChange={(event) => setDetails({ ...details, name: event.target.value })} placeholder="Sprint general prep, 4 weeks" />
        </Field>
        <Field label="Description" optional hint="What it is for and when to use it.">
          <Textarea value={details.description} maxLength={TEMPLATE_DESCRIPTION_MAX} rows={3} onChange={(event) => setDetails({ ...details, description: event.target.value })} />
        </Field>
        <FormGrid>
          <Field label="Phase" optional>
            <Select value={details.phase ?? ""} onChange={(event) => setDetails({ ...details, phase: asTemplatePhase(event.target.value) })}>
              <option value="">No phase</option>
              {TEMPLATE_PHASES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Event group" optional>
            <Select value={details.eventGroup ?? ""} onChange={(event) => setDetails({ ...details, eventGroup: asEventGroup(event.target.value) })}>
              <option value="">Any group</option>
              {EVENT_GROUPS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

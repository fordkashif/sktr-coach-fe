import { useEffect, useState } from "react"
import { Button, List, ListRow, Notice, Sheet, SkeletonRows, SubSection, SubSections } from "@/components/sk"
import { getPlanTemplate } from "@/lib/data/training-plan/plan-template-data"
import { templateOutline, type PlanTemplate, type PlanTemplateSummary } from "@/lib/data/training-plan/plan-templates"
import { templateFacts } from "./ui"

/** A template's week by week outline, read only. */
export function TemplatePreview({ template, onClose, onUse }: { template: PlanTemplateSummary; onClose: () => void; onUse?: () => void }) {
  const [full, setFull] = useState<PlanTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void getPlanTemplate(template.id).then((result) => {
      if (!current) return
      if (result.ok) setFull(result.data)
      else setError(result.error.message)
    })
    return () => {
      current = false
    }
  }, [template.id])

  const weeks = full ? templateOutline(full.structure, full.weeks, full.startWeekday) : []

  return (
    <Sheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={template.name}
      description={templateFacts(template)}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
          {onUse ? (
            <Button variant="primary" onClick={onUse}>
              Start a plan from it
            </Button>
          ) : null}
        </>
      }
    >
      {template.description ? <p className="mb-5 text-[0.9375rem] text-sk-ink-2">{template.description}</p> : null}
      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : !full ? (
        <SkeletonRows rows={5} label="Loading the outline" />
      ) : (
        <SubSections>
          {weeks.map((week) => (
            <SubSection key={week.week} title={`Week ${week.week}`} hint={week.focus ?? undefined}>
              {week.sessions.length === 0 ? (
                <p className="sk-list-sub">No sessions this week.</p>
              ) : (
                <List aria-label={`Week ${week.week} sessions`}>
                  {week.sessions.map((session) => (
                    <ListRow
                      key={session.id}
                      className="items-start"
                      leading={<span className="w-10 text-sm font-bold text-sk-mute">{session.dayLabel}</span>}
                      title={session.title}
                      subtitle={session.lines.length > 0 ? session.lines.join(". ") : session.sessionType}
                    />
                  ))}
                </List>
              )}
            </SubSection>
          ))}
        </SubSections>
      )}
    </Sheet>
  )
}

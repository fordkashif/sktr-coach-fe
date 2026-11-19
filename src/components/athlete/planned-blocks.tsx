import { cn } from "@/lib/utils"

export type PlannedRow = { key: string; name: string; volume: string; load: string; note: string }
export type PlannedBlockData = { key: string; name: string; hint?: string; rows: PlannedRow[]; volume?: string; load?: string }

/** "4 x 4 at 80%, 147.5 kg" as sets x reps and the rest. */
export function splitTarget(target: string): { volume: string; load: string } {
  const text = target.trim()
  const match = /^(\d+\s*x\s*[^\s,]+)(?:\s*(?:at|@)\s*(.+))?$/i.exec(text)
  if (match) return { volume: match[1].replace(/\s*x\s*/i, " x "), load: match[2]?.trim() ?? "" }
  return { volume: "", load: text }
}

/**
 * A block summary as the plan stores it ("Strength: Back squat 1 x 6 @ 50% | Bench press 3 x 5")
 * read back into its name and rows.
 */
export function blockFromPreview(preview: string, index: number): PlannedBlockData {
  const split = preview.indexOf(": ")
  const name = split > 0 ? preview.slice(0, split).trim() : ""
  const body = split > 0 ? preview.slice(split + 2) : preview
  const parts = body.split(/\s+\|\s+/).map((part) => part.trim()).filter(Boolean)
  const rows = parts.map((part, rowIndex) => {
    const match = /^(.*?)\s+(\d+\s*x\s*[^\s@]+)(?:\s*@\s*(.+))?$/i.exec(part)
    if (match) return { key: `${index}-${rowIndex}`, name: match[1], volume: match[2].replace(/\s*x\s*/i, " x "), load: match[3]?.trim() ?? "", note: "" }
    return { key: `${index}-${rowIndex}`, name: part, volume: "", load: "", note: "" }
  })
  // "Back squat 4x4" on its own is a one line block: its sets x reps go beside its name.
  if (!name && rows.length === 1) return { key: `${index}-${rows[0].name}`, name: rows[0].name, rows: [], volume: rows[0].volume, load: rows[0].load }
  return { key: `${index}-${name}`, name: name || `Part ${index + 1}`, rows }
}

/** The blocks of a planned session as tiles: a numbered name, then each exercise with its sets x reps and load. */
export function PlannedBlocks({ blocks, className }: { blocks: PlannedBlockData[]; className?: string }) {
  return (
    <ol className={cn("sk-planned", className)} aria-label="What is planned">
      {blocks.map((block, index) => (
        <li key={block.key} className="sk-planned-block">
          <div className="flex items-center gap-3">
            <span className="sk-planned-num" aria-hidden>
              {index + 1}
            </span>
            <h2 className="sk-planned-name">{block.name}</h2>
            {block.volume || block.load ? (
              <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                {block.volume ? <span className="sk-planned-vol">{block.volume}</span> : null}
                {block.load ? <span className="sk-planned-load">{block.load}</span> : null}
              </span>
            ) : null}
          </div>
          {block.hint ? <p className="mt-2 text-[0.9375rem] text-sk-ink-2">{block.hint}</p> : null}
          {block.rows.length > 0 ? (
            <ul className="sk-planned-rows">
              {block.rows.map((row) => (
                <li key={row.key} className="sk-planned-row">
                  <span className="sk-planned-ex">{row.name}</span>
                  {row.volume ? <span className="sk-planned-vol">{row.volume}</span> : null}
                  {row.load ? <span className="sk-planned-load">{row.load}</span> : null}
                  {row.note ? <span className="sk-planned-note">{row.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

import { UploadSimple } from "@phosphor-icons/react"
import { useId, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * PasteList: bring in a list of people (or anything with one item per line) by typing, pasting
 * from a spreadsheet or email, or choosing a file. It only collects the text; the screen decides
 * what each line means and shows a preview table under it before anything is saved.
 * `accept` is the file types offered (".csv,.txt"). A file replaces what is in the box.
 */
export function PasteList({
  label,
  value,
  onChange,
  hint,
  placeholder,
  accept = ".csv,.txt,text/csv,text/plain",
  fileLabel = "Choose a file",
  rows = 6,
  maxBytes = 200_000,
  className,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  hint?: ReactNode
  placeholder?: string
  accept?: string
  fileLabel?: string
  rows?: number
  /** Files larger than this are refused with a message. */
  maxBytes?: number
  className?: string
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileNote, setFileNote] = useState<{ text: string; problem: boolean } | null>(null)

  const readFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > maxBytes) {
      setFileNote({ text: `${file.name} is too large. Paste the lines in instead.`, problem: true })
      return
    }
    try {
      const text = await file.text()
      onChange(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
      setFileNote({ text: `Loaded ${file.name}.`, problem: false })
    } catch {
      setFileNote({ text: `Could not read ${file.name}.`, problem: true })
    }
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="sk-field-label">
          {label}
        </label>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="sk-link inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[0.9375rem] lg:min-h-9"
        >
          <UploadSimple className="size-4" weight="bold" aria-hidden />
          {fileLabel}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          className="sr-only"
          tabIndex={-1}
          aria-label={fileLabel}
          onChange={(event) => {
            void readFile(event.target.files?.[0])
            event.target.value = ""
          }}
        />
      </div>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-describedby={hint || fileNote ? hintId : undefined}
        onChange={(event) => {
          onChange(event.target.value)
          if (fileNote) setFileNote(null)
        }}
        className="sk-field h-auto min-h-[9.5rem] resize-y py-3 leading-relaxed"
      />
      {fileNote || hint ? (
        <p id={hintId} className={fileNote?.problem ? "sk-field-error" : "sk-field-hint"} role={fileNote ? "status" : undefined}>
          {fileNote ? fileNote.text : hint}
        </p>
      ) : null}
    </div>
  )
}

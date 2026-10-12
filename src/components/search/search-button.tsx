import { useEffect } from "react"
import { MagnifyingGlass } from "@phosphor-icons/react"

/*
 * The search button and its keyboard shortcut. Kept apart from the search dialog
 * (global-search.tsx) so the app frame can show the button without loading the dialog's code
 * until someone opens it.
 */

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

/** "/" (when not typing somewhere) and Ctrl or Cmd with K open search. */
export function useSearchShortcut(onOpen: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const withK = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k"
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target)
      if (!withK && !slash) return
      // Another dialog or sheet is open: leave it alone.
      if (slash && document.querySelector("[role='dialog']")) return
      event.preventDefault()
      onOpen()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, onOpen])
}

export function SearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="sk-icon-btn" aria-label="Search" aria-haspopup="dialog" aria-keyshortcuts="/ Control+K Meta+K" onClick={onOpen}>
      <MagnifyingGlass className="size-5" weight="bold" aria-hidden />
    </button>
  )
}

"use client"

import {
  AppWindow,
  Barbell,
  Buildings,
  CalendarBlank,
  ClipboardText,
  ClockCounterClockwise,
  EnvelopeSimple,
  Flag,
  type Icon,
  MagnifyingGlass,
  Medal,
  Target,
  Timer,
  Tray,
  User,
  UsersThree,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Dialog, List, ListRow, Notice, SearchInput, Sheet, SkeletonRows } from "@/components/sk"
import { selectGuardianChild } from "@/lib/guardian/children-store"
import {
  buildScreenIndex,
  cleanQuery,
  GROUP_PREVIEW,
  groupHits,
  isSearchable,
  MAX_QUERY_LENGTH,
  searchScreens,
  visibleHits,
  type SearchHit,
  type SearchKind,
  type SearchRole,
  type ShellDestination,
} from "@/lib/search/model"
import { clearRecentSearches, readRecentSearches, rememberSearch } from "@/lib/search/recent"
import { searchEverything } from "@/lib/search/search-data"
import { cn } from "@/lib/utils"

/**
 * Global search. One box that finds what the signed-in person may see and takes them there.
 * Desktop: a dialog, opened from the top bar, with "/" or with Ctrl or Cmd and K.
 * Phone: a full screen sheet, opened from the app bar.
 * Screens come from the shell's own destinations (so a screen the person cannot open is never
 * offered) and answer at once; everything else is asked of the server after a short pause.
 */

const KIND_ICON: Record<SearchKind, Icon> = {
  screen: AppWindow,
  athlete: User,
  team: UsersThree,
  plan: ClipboardText,
  template: ClipboardText,
  exercise: Barbell,
  test_week: Timer,
  competition: Medal,
  staff: User,
  guardian: User,
  invite: EnvelopeSimple,
  season: Flag,
  club_event: CalendarBlank,
  session: CalendarBlank,
  record: Medal,
  goal: Target,
  coach: User,
  child: User,
  club: Buildings,
  request: Tray,
  platform_admin: User,
}

const HINT: Record<SearchRole, string> = {
  coach: "Find an athlete, a team, a plan or template, an exercise, a test week, a competition or a screen.",
  "club-admin": "Find a person, a team, an invite by email, a season, a club event or a screen.",
  athlete: "Find a session by name or day, a record, a competition, a goal, a coach or a screen.",
  guardian: "Find a child you follow, one of their competitions or a screen.",
  "platform-admin": "Find a club, a request by club or email, a platform admin or a screen.",
}

const DEBOUNCE_MS = 200

/** True at 1024px and up, where the shell shows its top bar. */
function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1024px)").matches : true))
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(min-width: 1024px)")
    const sync = () => setDesktop(query.matches)
    sync()
    query.addEventListener("change", sync)
    return () => query.removeEventListener("change", sync)
  }, [])
  return desktop
}

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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: SearchRole
  /** The destinations the shell shows this person. The screen index is built from these. */
  destinations: ShellDestination[]
  assistant?: boolean
  coachTeamIds?: string[]
  /** Whose recent searches to keep on this device (the account email). */
  owner?: string | null
}

export function GlobalSearch({ open, onOpenChange, ...rest }: Props) {
  const desktop = useIsDesktop()
  // Each opening is a fresh dialog. Reopening one that is still fading out (Enter on a result, then
  // Ctrl and K straight away) can leave its backdrop on top of its content, so nothing can be pressed.
  const [opening, setOpening] = useState({ open, count: 0 })
  if (opening.open !== open) setOpening({ open, count: opening.count + (open ? 1 : 0) })
  // The body is only mounted while open, so each opening starts clean and nothing runs while closed.
  const body = open ? <SearchBody {...rest} onClose={() => onOpenChange(false)} /> : null
  if (desktop) {
    return (
      <Dialog key={opening.count} open={open} onOpenChange={onOpenChange} title="Search" className="top-[8dvh] max-h-[84dvh] translate-y-0 sm:max-w-xl">
        {body}
      </Dialog>
    )
  }
  return (
    <Sheet key={opening.count} open={open} onOpenChange={onOpenChange} side="right" title="Search" className="border-0 sm:max-w-none">
      {body}
    </Sheet>
  )
}

function SearchBody({ role, destinations, assistant = false, coachTeamIds, owner, onClose }: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
  const navigate = useNavigate()
  const [text, setText] = useState("")
  const [dataHits, setDataHits] = useState<SearchHit[]>([])
  /** The query the data hits belong to. Rows for an older query are not shown against a newer one. */
  const [answeredFor, setAnsweredFor] = useState("")
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches(owner))
  const listRef = useRef<HTMLDivElement>(null)
  const teamKey = (coachTeamIds ?? []).join(",")

  const query = cleanQuery(text)
  const searchable = isSearchable(query)
  const screenIndex = useMemo(() => buildScreenIndex(role, destinations, { assistant }), [assistant, destinations, role])
  const screenHits = useMemo(() => (searchable ? searchScreens(role, screenIndex, query) : []), [query, role, screenIndex, searchable])

  // Ask the server a moment after the last keystroke. A newer query cancels the one in flight.
  useEffect(() => {
    if (!searchable) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void searchEverything(query, { role, assistant, coachTeamIds: teamKey ? teamKey.split(",") : [] }, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setDataHits(result.ok ? result.data : [])
        setFailed(!result.ok)
        setAnsweredFor(query)
      })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [assistant, query, role, searchable, teamKey])

  const waiting = searchable && answeredFor !== query
  const groups = useMemo(
    () => (searchable ? groupHits(role, [...(answeredFor === query ? dataHits : []), ...screenHits], { assistant }) : []),
    [answeredFor, assistant, dataHits, query, role, screenHits, searchable],
  )
  const rows = useMemo(() => visibleHits(groups, expanded), [expanded, groups])
  const activeIndex = rows.length === 0 ? -1 : Math.min(active, rows.length - 1)
  const activeHit = activeIndex >= 0 ? rows[activeIndex] : null

  useEffect(() => {
    listRef.current?.querySelector("[aria-current='true']")?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, rows])

  const onType = (value: string) => {
    setText(value.slice(0, MAX_QUERY_LENGTH))
    setActive(0)
    setExpanded(new Set())
  }

  /** Runs just before the row's link is followed. */
  const onPicked = useCallback(
    (hit: SearchHit) => {
      rememberSearch(owner, query)
      if (hit.childId) selectGuardianChild(hit.childId)
      onClose()
    },
    [onClose, owner, query],
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (rows.length > 0) setActive((activeIndex + 1) % rows.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      if (rows.length > 0) setActive((activeIndex - 1 + rows.length) % rows.length)
    } else if (event.key === "Enter") {
      if (!activeHit) return
      event.preventDefault()
      onPicked(activeHit)
      navigate(activeHit.href)
    }
    // Escape closes the dialog or sheet itself.
  }

  const total = groups.reduce((sum, group) => sum + group.hits.length, 0)
  let rowIndex = -1

  return (
    <div className="flex min-w-0 flex-col gap-4" data-search-panel>
      <SearchInput
        autoFocus
        value={text}
        onChange={(event) => onType(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search"
        aria-label="Search"
        aria-controls="global-search-results"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={MAX_QUERY_LENGTH}
      />

      <div id="global-search-results" ref={listRef} className="min-h-[14rem] lg:max-h-[58dvh] lg:overflow-y-auto" aria-live="polite">
        {!searchable ? (
          <div className="flex flex-col gap-4">
            <p className="text-[0.9375rem] leading-snug text-sk-mute">{query.length === 1 ? "Keep typing. Search starts at 2 letters." : HINT[role]}</p>
            {recent.length > 0 ? (
              <section aria-label="Recent searches" data-search-group="recent">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[0.8125rem] font-bold text-sk-mute">Recent searches</h3>
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => {
                      clearRecentSearches(owner)
                      setRecent([])
                    }}
                  >
                    Clear
                  </Button>
                </div>
                <List>
                  {recent.map((item) => (
                    <ListRow key={item} leading={<ClockCounterClockwise className="size-5 text-sk-mute" aria-hidden />} title={item} onClick={() => onType(item)} />
                  ))}
                </List>
                <p className="mt-2 text-sm text-sk-mute">Kept on this device only.</p>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {failed && !waiting ? <Notice tone="error">Search could not reach the server. Screens are still listed. Try again in a moment.</Notice> : null}
            {groups.map((group) => {
              const isOpen = expanded.has(group.id)
              const shown = isOpen ? group.hits : group.hits.slice(0, GROUP_PREVIEW)
              return (
                <section key={group.id} aria-label={group.label} data-search-group={group.id}>
                  <h3 className="text-[0.8125rem] font-bold text-sk-mute">{group.label}</h3>
                  <List>
                    {shown.map((hit) => {
                      rowIndex += 1
                      const isActive = rowIndex === activeIndex
                      const KindIcon = KIND_ICON[hit.kind]
                      return (
                        <ListRow
                          key={`${hit.kind}:${hit.id}`}
                          to={hit.href}
                          onNavigate={() => onPicked(hit)}
                          aria-current={isActive ? "true" : undefined}
                          className={cn("rounded-[10px] px-2", isActive && "bg-sk-soft")}
                          leading={<KindIcon className="size-5 text-sk-ink-2" aria-hidden />}
                          title={hit.title}
                          subtitle={hit.subtitle ?? undefined}
                        />
                      )
                    })}
                  </List>
                  {group.hits.length > GROUP_PREVIEW && !isOpen ? (
                    <Button variant="quiet" size="sm" className="mt-1" onClick={() => setExpanded((current) => new Set(current).add(group.id))}>
                      Show all {group.hits.length}
                    </Button>
                  ) : null}
                </section>
              )
            })}
            {waiting ? <SkeletonRows rows={groups.length > 0 ? 2 : 3} label="Searching" /> : null}
            {!waiting && total === 0 && !failed ? (
              <div data-search-empty>
                <p className="text-base font-bold text-sk-ink">Nothing found for &quot;{query}&quot;</p>
                <p className="mt-1 text-[0.9375rem] leading-snug text-sk-mute">Check the spelling or try fewer letters. Search only looks at what you can open.</p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <p className="hidden text-sm text-sk-mute lg:block">Up and down arrows to move, Enter to open, Esc to close.</p>
    </div>
  )
}

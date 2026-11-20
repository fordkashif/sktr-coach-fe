import { Link } from "react-router-dom"
import { ArrowRight, Check, Heartbeat } from "@phosphor-icons/react"
import type { WellnessEntry } from "@/lib/data/wellness/types"

const READINESS_WORD: Record<WellnessEntry["readiness"], string> = {
  green: "Ready",
  yellow: "Take care",
  red: "Go easy",
}

/**
 * The daily check-in, at the top of Home. Before it is done it is the first thing to tap;
 * after, it shrinks to today's readiness and stays tappable to change the answers.
 */
export function CheckInCard({ entry }: { entry: WellnessEntry | null }) {
  if (!entry) {
    return (
      <Link to="/athlete/wellness" className="sk-checkin" data-state="due" aria-label="Daily check-in, due today. Check in">
        <span className="sk-checkin-icon" aria-hidden>
          <Heartbeat weight="bold" />
        </span>
        <span className="sk-checkin-text">
          <span className="sk-checkin-label">Due today</span>
          <span className="sk-checkin-title">Daily check-in</span>
        </span>
        <span className="sk-checkin-go" aria-hidden>
          Check in
          <ArrowRight weight="bold" />
        </span>
      </Link>
    )
  }

  return (
    <Link
      to="/athlete/wellness"
      className="sk-checkin"
      data-state="done"
      data-readiness={entry.readiness}
      aria-label={`Checked in today. Readiness ${entry.readinessScore}, ${READINESS_WORD[entry.readiness]}. Change answers`}
    >
      <span className="sk-checkin-icon" aria-hidden>
        <Check weight="bold" />
      </span>
      <span className="sk-checkin-text">
        <span className="sk-checkin-label">Checked in</span>
        <span className="sk-checkin-title">{READINESS_WORD[entry.readiness]}</span>
      </span>
      <span className="sk-checkin-score" aria-hidden>
        <span className="sk-num">{entry.readinessScore}</span>
        <span className="sk-checkin-of">Readiness</span>
      </span>
    </Link>
  )
}

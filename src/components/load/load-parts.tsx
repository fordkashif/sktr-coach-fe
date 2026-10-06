import { useId, useState } from "react"
import { Button, StatusText } from "@/components/sk"
import { describeAvailability, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import {
  LOAD_BAND_LABEL,
  LOAD_BAND_TONE,
  RATIO_USUAL_FROM,
  RATIO_USUAL_TO,
  RATIO_WELL_ABOVE,
  loadBand,
  noBandReason,
  type AthleteLoad,
} from "@/lib/data/load/training-load"

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The band of the last 7 days as a dot and words, for coaches. An athlete who is injured, sick or
 * away is marked with that instead: their load is expected to be off, so it is not flagged.
 */
export function LoadBandText({ load, asOf, availability }: { load: AthleteLoad; asOf: string; availability?: AthleteAvailability | null }) {
  const ratio = load.weeks[load.weeks.length - 1]?.ratio ?? null
  const band = loadBand(ratio)
  if (availability) {
    return (
      <span className="flex flex-col gap-0.5" data-load-band="unavailable">
        <StatusText tone="neutral">{sentenceCase(describeAvailability(availability, asOf))}</StatusText>
        {band ? <span className="text-sm text-sk-mute">{`${LOAD_BAND_LABEL[band]} (${ratio?.toFixed(2)}), not flagged`}</span> : null}
      </span>
    )
  }
  if (!band) {
    return (
      <span className="text-sk-mute" data-load-band="none">
        {noBandReason(load, asOf)}
      </span>
    )
  }
  return (
    <span className="flex flex-col gap-0.5" data-load-band={band}>
      <StatusText tone={LOAD_BAND_TONE[band]}>{LOAD_BAND_LABEL[band]}</StatusText>
      <span className="text-sm text-sk-mute">{`${ratio?.toFixed(2)} times the usual week`}</span>
    </span>
  )
}

/** "How this is worked out": closed until asked for. `audience` picks the wording. */
export function LoadExplainer({ audience }: { audience: "coach" | "athlete" }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="mt-2">
      <Button variant="quiet" size="sm" className="-ml-2.5" aria-expanded={open} aria-controls={id} onClick={() => setOpen((current) => !current)}>
        How this is worked out
      </Button>
      {open ? (
        <ul id={id} className="mt-1 flex max-w-[44rem] list-disc flex-col gap-1.5 pl-5 text-[0.9375rem] leading-relaxed text-sk-ink-2">
          <li>The load of a session is its effort (1 to 10) times its minutes. A 60 minute session at effort 7 is 420.</li>
          <li>Weekly load adds up the sessions of a week, Monday to Sunday.</li>
          <li>The last 7 days are compared with the usual week: the average week over the last 28 days. 1.0 means the same as usual.</li>
          <li>Today counts once a session is finished today. Until then the 7 days end yesterday, so a morning before training does not look like a light week.</li>
          {audience === "coach" ? (
            <li>
              Under {RATIO_USUAL_FROM.toFixed(1)} is well below usual, {RATIO_USUAL_FROM.toFixed(1)} to {RATIO_USUAL_TO.toFixed(1)} is the usual range, over {RATIO_USUAL_TO.toFixed(1)} and up to{" "}
              {RATIO_WELL_ABOVE.toFixed(1)} is above usual, and over {RATIO_WELL_ABOVE.toFixed(1)} is well above usual. These are the cut-offs most often used with this method.
            </li>
          ) : null}
          <li>It is a guide to how training is changing. It does not predict injury.</li>
          <li>The comparison shows after 4 weeks of logged sessions. A session with no effort or no time has no load. It is left out, never guessed.</li>
        </ul>
      ) : null}
    </div>
  )
}

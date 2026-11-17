import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { Burst, Mark } from "@/components/sk"

/** What the event screen is handed after saving a new personal best. */
export type PbMomentData = {
  eventLabel: string
  display: string
  unit: string
  /** "0.04 s faster", "12 cm further". */
  gain: string | null
}

/**
 * PbMoment: the celebration after an athlete saves a new personal best. The mark lands with a
 * burst of lime and ink, then one button to carry on. Escape or the button closes it.
 */
export function PbMoment({ pb, onClose }: { pb: PbMomentData; onClose: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    button.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    try {
      navigator.vibrate?.([40, 60, 40])
    } catch {
      // No vibration here.
    }
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pb-moment-title"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-white/96 px-6 text-center backdrop-blur-sm"
    >
      <p id="pb-moment-title" className="sk-anim-rise font-display text-[3.5rem] font-black uppercase leading-[0.85] text-sk-ink">
        New PB
      </p>
      <Burst play>
        <span className="block rounded-[22px] bg-sk-lime px-5 py-3">
          <Mark value={pb.display} unit={pb.unit} size="lg" className="text-[5.5rem] lg:text-[6.5rem]" />
        </span>
      </Burst>
      <p className="sk-anim-rise text-lg font-bold text-sk-ink [animation-delay:200ms]">
        {pb.eventLabel}
        {pb.gain ? `, ${pb.gain}` : ""}
      </p>
      <button
        ref={button}
        type="button"
        onClick={onClose}
        className="sk-anim-rise h-[60px] min-w-56 cursor-pointer rounded-full bg-sk-ink px-8 font-display text-[1.5rem] font-black uppercase text-sk-lime [animation-delay:320ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-ink"
      >
        Let's go
      </button>
    </div>,
    document.body,
  )
}

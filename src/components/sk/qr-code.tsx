import { useMemo } from "react"
import { encodeQr } from "@/lib/qr/qr-encode"
import { cn } from "@/lib/utils"

/**
 * QrCode: a QR code for a link, drawn on the page as crisp squares (SVG, no image request, no
 * outside service). Black on white with the quiet margin a scanner needs, so it also works
 * projected on a wall. `label` says in words what scanning it does. Always show the link itself
 * beside it for people who cannot scan. Sizes: `md` 220px for a dialog, `lg` fills the width up to
 * 360px for showing a squad.
 */
export function QrCode({ value, label, size = "md", className }: { value: string; label: string; size?: "md" | "lg"; className?: string }) {
  const qr = useMemo(() => {
    try {
      return encodeQr(value)
    } catch {
      return null
    }
  }, [value])

  if (!qr) {
    return <p className="text-[0.9375rem] text-sk-mute">This link is too long to show as a QR code. Share the link instead.</p>
  }

  const quiet = 4
  const span = qr.size + quiet * 2
  // One path for all dark squares keeps the DOM small.
  let path = ""
  for (let y = 0; y < qr.size; y++) {
    let x = 0
    while (x < qr.size) {
      if (!qr.modules[y][x]) {
        x++
        continue
      }
      let run = 1
      while (x + run < qr.size && qr.modules[y][x + run]) run++
      path += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`
      x += run
    }
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      className={cn("block h-auto bg-white", size === "lg" ? "w-full max-w-[360px]" : "w-[220px] max-w-full", className)}
      data-qr-value={value}
    >
      <rect width={span} height={span} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}

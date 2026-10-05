import { CircleNotch as CircleNotchGlyph } from "@phosphor-icons/react"
import { cn } from '@/lib/utils'

function Spinner({ className, ...props }: React.ComponentProps<typeof CircleNotchGlyph>) {
  return (
    <CircleNotchGlyph weight="bold" role="status" aria-label="Loading" className={cn('size-4 animate-spin', className)} {...props} />
  )
}

export { Spinner }

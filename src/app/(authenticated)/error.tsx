"use client"

import { useEffect } from "react"
import { Link } from "react-router-dom"
import { ArrowClockwise, House, WarningCircle } from "@phosphor-icons/react"

export default function AuthenticatedError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="sk-page">
      <div className="flex max-w-[640px] flex-col items-start gap-4 rounded-[20px] border border-sk-line bg-white p-6 sm:p-8" role="alert">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-sk-coral-tint text-[#b32a0c]">
          <WarningCircle className="size-6" weight="fill" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="sk-h2">This page did not load</h1>
          <p className="max-w-[52ch] leading-relaxed text-sk-mute">
            Something went wrong on our side while opening it. Nothing you entered elsewhere has been lost. Try again, and if it keeps happening go back to your home screen.
          </p>
          {error.digest ? <p className="text-sm text-sk-mute">Reference: {error.digest}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="sk-btn sk-btn-primary" onClick={reset}>
            <ArrowClockwise className="size-5" weight="bold" aria-hidden />
            Try again
          </button>
          <Link to="/" className="sk-btn sk-btn-quiet">
            <House className="size-5" weight="bold" aria-hidden />
            Go to home
          </Link>
        </div>
      </div>
    </div>
  )
}

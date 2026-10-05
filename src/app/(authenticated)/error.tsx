"use client"

import { useEffect } from "react"
import { ArrowClockwise } from "@phosphor-icons/react"
import { Button, LinkButton, Notice, Screen, ScreenHeader } from "@/components/sk"
import { SUPPORT_EMAIL } from "@/lib/support"

/** Shown in place of a signed-in screen that failed while opening. */
export default function AuthenticatedError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <Screen width="narrow">
      <ScreenHeader
        title="This page did not load"
        lede="Something went wrong on our side while opening it. Nothing you entered elsewhere has been lost. Try again, and if it keeps happening go back to your home screen."
      />
      <div role="alert" className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={reset}>
          <ArrowClockwise className="size-5" weight="bold" aria-hidden />
          Try again
        </Button>
        <LinkButton to="/" variant="quiet">
          Go to home
        </LinkButton>
      </div>
      {error.digest ? (
        <Notice>
          If you email {SUPPORT_EMAIL}, include this reference: {error.digest}
        </Notice>
      ) : null}
    </Screen>
  )
}

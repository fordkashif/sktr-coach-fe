"use client"

import { ArrowRight } from "@phosphor-icons/react"
import { LinkButton, ScreenHeader } from "@/components/sk"
import { AuthSplit } from "@/layouts/auth-layout"
import { REQUEST_REVIEW_TIME } from "@/lib/support"

export default function CreateClubAccountPage() {
  return (
    <AuthSplit headline={["Your whole club", "on one plan."]} body="Coaches write the training, athletes log it, and you see every team from one place.">
      <ScreenHeader
        title="Clubs join by request"
        lede={`You cannot create a club account on your own yet. Send us a short request instead and we will set your club up, ${REQUEST_REVIEW_TIME}.`}
      />
      <div className="flex flex-wrap gap-2">
        <LinkButton to="/login?mode=request" variant="primary">
          Request access for your club
          <ArrowRight className="size-5" weight="bold" aria-hidden />
        </LinkButton>
        <LinkButton to="/login" variant="quiet">
          Back to sign in
        </LinkButton>
      </div>
    </AuthSplit>
  )
}

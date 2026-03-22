"use client"

import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"

export default function CreateClubAccountPage() {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <section className="page-intro">
        <div className="space-y-2">
          <h1 className="page-intro-title">Organization Provisioning</h1>
          <p className="page-intro-copy">
            Direct self-serve club creation is disabled. New organizations must submit a request for platform review.
          </p>
        </div>
      </section>

      <section className="mobile-card-primary space-y-4">
        <p className="text-sm text-slate-600">
          This route is intentionally non-provisioning while the request-only onboarding model is active.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild className="h-11 rounded-full px-5">
            <Link to="/login?mode=request">Open request form</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 rounded-full px-5">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}

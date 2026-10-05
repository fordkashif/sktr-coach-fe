"use client"

import { Link } from "react-router-dom"
import { AUTH_PHOTOS, AuthSplit } from "@/layouts/auth-layout"
import { REQUEST_REVIEW_TIME } from "@/lib/support"

export default function CreateClubAccountPage() {
  return (
    <AuthSplit
      photo={AUTH_PHOTOS.lanes}
      headline="Put your whole club on one plan."
      body="Coaches write the training, athletes log it, and you see every team from one place."
    >
      <div className="space-y-7">
        <header className="space-y-3">
          <h1 className="sk-title">Clubs join by request</h1>
          <p className="sk-lede">
            You cannot create a club account on your own yet. Send us a short request instead and we will set your club up, {REQUEST_REVIEW_TIME}.
          </p>
        </header>
        <div className="flex flex-wrap gap-2">
          <Link to="/login?mode=request" className="sk-btn sk-btn-primary">
            Request access for your club
          </Link>
          <Link to="/login" className="sk-btn sk-btn-quiet">
            Back to sign in
          </Link>
        </div>
      </div>
    </AuthSplit>
  )
}

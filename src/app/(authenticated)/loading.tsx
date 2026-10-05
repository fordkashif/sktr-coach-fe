import { Link } from "react-router-dom"
import { CircleNotch } from "@phosphor-icons/react"

export default function AuthenticatedLoading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center" role="status" aria-live="polite">
      <CircleNotch className="size-8 animate-spin text-sk-blue" weight="bold" aria-hidden />
      <p className="sk-h3">Loading workspace...</p>
      <p className="text-sm text-sk-mute">
        Taking a while?{" "}
        <Link to="/" className="font-bold text-sk-blue hover:underline">
          Go to home
        </Link>
      </p>
    </div>
  )
}

import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "@phosphor-icons/react"
import { Button, LinkButton, ScreenHeader } from "@/components/sk"
import { PublicFrame, TrackArt } from "@/layouts/auth-layout"

export function NotFoundPage() {
  const navigate = useNavigate()
  const canGoBack = typeof window !== "undefined" && window.history.length > 1

  return (
    <PublicFrame>
      <ScreenHeader
        fact="Page not found (404)"
        title="This lane is empty"
        lede="There is no page at this address. The link may be old, or the page may have moved. Your account and your data are fine."
      />
      <div className="flex flex-wrap gap-2">
        <LinkButton to="/" variant="primary">
          Go to home
        </LinkButton>
        <LinkButton to="/login">Go to login</LinkButton>
        {canGoBack ? (
          <Button variant="quiet" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-5" weight="bold" aria-hidden />
            Go back
          </Button>
        ) : null}
      </div>
      <div className="h-52 overflow-hidden rounded-3xl bg-sk-blue sm:h-64">
        <TrackArt className="size-full" />
      </div>
    </PublicFrame>
  )
}

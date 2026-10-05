import { Link } from "react-router-dom"
import { ArrowLeft, MagnifyingGlass } from "@phosphor-icons/react"

export function InvalidEntityPage({
  title,
  description,
  backTo,
}: {
  title: string
  description: string
  backTo: string
}) {
  return (
    <div className="sk-page">
      <div className="flex max-w-[640px] flex-col items-start gap-4 rounded-[20px] border border-dashed border-[#cdd2de] bg-white p-6 sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-sk-yellow text-sk-ink">
          <MagnifyingGlass className="size-5" weight="bold" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="sk-h2">{title}</h1>
          <p className="max-w-[52ch] leading-relaxed text-sk-mute">{description}</p>
        </div>
        <Link to={backTo} className="sk-btn sk-btn-primary">
          <ArrowLeft className="size-5" weight="bold" aria-hidden />
          Go back
        </Link>
      </div>
    </div>
  )
}

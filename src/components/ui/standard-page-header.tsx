import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface HeaderStat {
  label: string
  value: ReactNode
}

interface StandardPageHeaderProps {
  variant?: "hero" | "admin" | "darkHero"
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  stats?: HeaderStat[]
  statsClassName?: string
  className?: string
  contentClassName?: string
}

export function StandardPageHeader({
  variant = "hero",
  eyebrow,
  title,
  description,
  meta,
  trailing,
  stats,
  statsClassName,
  className,
  contentClassName,
}: StandardPageHeaderProps) {
  if (variant === "admin") {
    return (
      <section className={cn("px-1 py-1 sm:px-2 lg:px-3", className)}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className={cn("space-y-4", contentClassName)}>
            {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1368ff]">{eyebrow}</p> : null}
            <h1 className="admin-page-intro-title">{title}</h1>
            {description ? <p className="admin-page-intro-copy">{description}</p> : null}
            {meta}
          </div>
          {stats?.length ? (
            <div className={cn("grid grid-cols-2 gap-3", statsClassName)}>
              {stats.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1368ff]">{item.label}</p>
                  <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{item.value}</div>
                </div>
              ))}
            </div>
          ) : (
            trailing
          )}
        </div>
      </section>
    )
  }

  if (variant === "darkHero") {
    return (
      <section
        className={cn(
          "overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(7,17,34,0.96)_0%,rgba(10,24,44,0.9)_55%,rgba(20,67,160,0.72)_100%)] text-white shadow-[0_24px_80px_rgba(5,12,24,0.28)]",
          className,
        )}
      >
        <div className="grid gap-8 px-5 py-6 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,420px)] lg:px-8 lg:py-9 xl:px-10">
          <div className={cn("space-y-6", contentClassName)}>
            <div className="space-y-3">
              {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6fb6ff]">{eyebrow}</p> : null}
              <h1 className="max-w-[11ch] text-[clamp(2.35rem,6vw,4.9rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-white">
                {title}
              </h1>
              {description ? <p className="max-w-[58ch] text-sm leading-7 text-white/72 sm:text-base">{description}</p> : null}
            </div>
            {meta}
            {stats?.length ? (
              <div className={cn("grid gap-3 sm:grid-cols-3", statsClassName)}>
                {stats.map((item) => (
                  <div key={item.label} className="rounded-[24px] border border-white/12 bg-white/[0.06] px-4 py-4 backdrop-blur-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6fb6ff]">{item.label}</p>
                    <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">{item.value}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {trailing ? <div className="rounded-[28px] border border-white/12 bg-white/[0.08] p-5 backdrop-blur-sm lg:self-end">{trailing}</div> : null}
        </div>
      </section>
    )
  }

  return (
    <section className={cn("mobile-proof-hero", className)}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(220px,0.85fr)] lg:items-start">
        <div className={cn("space-y-4", contentClassName)}>
          {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1368ff]">{eyebrow}</p> : null}
          <div className="space-y-2">
            <h1 className="mobile-proof-title">{title}</h1>
            {description ? <p className="mobile-proof-copy">{description}</p> : null}
          </div>
          {meta}
        </div>
        {trailing ? <div className="lg:justify-self-end">{trailing}</div> : null}
      </div>
      {stats?.length ? (
        <div className={cn("mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4", statsClassName)}>
          {stats.map((item) => (
            <div
              key={item.label}
              className="rounded-[24px] border border-slate-200 bg-white/80 px-4 py-4 shadow-[0_14px_32px_rgba(15,23,42,0.05)] backdrop-blur"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{item.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

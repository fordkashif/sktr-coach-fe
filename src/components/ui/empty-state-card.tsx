"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

type EmptyStateCardProps = {
  eyebrow?: string
  title: string
  description: string
  hint?: string
  icon?: ReactNode
  actions?: ReactNode
  className?: string
  contentClassName?: string
}

export function EmptyStateCard({
  eyebrow,
  title,
  description,
  hint,
  icon,
  actions,
  className,
  contentClassName,
}: EmptyStateCardProps) {
  return (
    <Empty
      className={cn(
        "rounded-[28px] border border-dashed border-slate-300 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-5 py-8 text-left shadow-[0_18px_50px_rgba(15,23,42,0.05)]",
        className,
      )}
    >
      <EmptyContent className={cn("max-w-none items-start text-left", contentClassName)}>
        {icon ? (
          <EmptyMedia variant="icon" className="size-12 rounded-2xl bg-[#eef5ff] text-[#1368ff]">
            {icon}
          </EmptyMedia>
        ) : null}
        <EmptyHeader className="max-w-2xl items-start text-left">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{eyebrow}</p>
          ) : null}
          <EmptyTitle className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{title}</EmptyTitle>
          <EmptyDescription className="text-sm leading-6 text-slate-600">{description}</EmptyDescription>
          {hint ? <p className="text-sm leading-6 text-slate-500">{hint}</p> : null}
        </EmptyHeader>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </EmptyContent>
    </Empty>
  )
}

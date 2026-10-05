import type { ReactNode } from "react"
import { Link, Outlet } from "react-router-dom"
import { cn } from "@/lib/utils"

export function AuthLayout() {
  return (
    <div className="min-h-dvh bg-white">
      <Outlet />
    </div>
  )
}

/** Track and field photographs used on the public pages. Each sits on a solid sk-blue-tint block in case it fails to load. */
export const AUTH_PHOTOS = {
  blocks: {
    src: "https://images.unsplash.com/photo-1526676317768-d9b14f15615a?auto=format&fit=crop&w=1400&q=80",
    alt: "A sprinter pushing out of the starting blocks on a red track",
  },
  lanes: {
    src: "https://images.unsplash.com/photo-1474546652694-a33dd8161d66?auto=format&fit=crop&w=1400&q=80",
    alt: "A red running track with white lane lines and numbered starting positions",
  },
  markings: {
    src: "https://images.unsplash.com/photo-1549896869-ca27eeffe4fb?auto=format&fit=crop&w=1200&q=80",
    alt: "Lane markings painted on a red running track",
  },
} as const

export type AuthPhoto = { src: string; alt: string }

export function AuthBrand({ className }: { className?: string }) {
  return (
    <Link
      to="/login"
      className={cn(
        "inline-flex items-center gap-2.5 rounded-lg text-lg font-extrabold tracking-[-0.03em] text-sk-blue focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sk-blue",
        className,
      )}
    >
      <img src="/app-icon.png" alt="" className="size-8 rounded-[10px] object-contain" />
      SKTR Coach
    </Link>
  )
}

/**
 * Front door frame: the form on white, and on wide screens a photograph with one plain line about the product.
 * On small screens the photograph is left out so the form is the first thing on the page.
 */
export function AuthSplit({
  photo,
  headline,
  body,
  wide = false,
  children,
}: {
  photo: AuthPhoto
  headline: ReactNode
  body?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className="min-h-dvh bg-white lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <main className="flex min-w-0 flex-col px-5 pb-12 pt-6 sm:px-8 sm:pt-8 lg:px-12 lg:pb-16 lg:pt-10">
        <div className={cn("mx-auto flex w-full flex-1 flex-col", wide ? "max-w-[600px]" : "max-w-[440px]")}>
          <AuthBrand className="self-start" />
          <div className={cn("flex flex-1 flex-col pt-8 sm:pt-12", !wide && "lg:justify-center lg:pb-16 lg:pt-10")}>{children}</div>
        </div>
      </main>

      <aside className="hidden p-4 lg:block" aria-label="About SKTR Coach">
        <div className="sticky top-4 flex h-[calc(100dvh-2rem)] min-h-[560px] flex-col overflow-hidden rounded-[28px] bg-sk-blue-tint">
          <div className="relative min-h-0 flex-1 bg-sk-blue-tint">
            <img
              src={photo.src}
              alt={photo.alt}
              decoding="async"
              className="absolute inset-0 size-full object-cover"
              onError={(event) => {
                event.currentTarget.style.visibility = "hidden"
              }}
            />
          </div>
          <div className="bg-sk-blue px-9 pb-10 pt-8 text-white xl:px-12 xl:pb-12 xl:pt-10">
            <p className="max-w-[16ch] text-[2.5rem] font-extrabold leading-[0.98] tracking-[-0.045em] xl:text-[3.25rem]">{headline}</p>
            {body ? <p className="mt-4 max-w-[44ch] text-base leading-relaxed text-white/85 xl:text-lg">{body}</p> : null}
          </div>
        </div>
      </aside>
    </div>
  )
}

/** Small centered frame for notices that are not forms: not found, errors, loading. */
export function AuthNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn("mx-auto flex w-full max-w-[560px] flex-col gap-6 px-4 pb-12 pt-8 sm:px-6 sm:pt-14", className)}>{children}</main>
  )
}

import { useCallback, useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { Button, Notice } from "@/components/sk"
import { dismissPlatformNotice, getMyPlatformNotices, type VisibleNotice } from "@/lib/data/platform-admin/tools-data"
import type { NoticeRole } from "@/lib/data/platform-admin/tools-logic"

const REFRESH_MS = 10 * 60 * 1000

/**
 * A notice from the SKTR team to every club, shown at the top of the app until the person
 * dismisses it, it ends or it is withdrawn. Mounted once in the app shell. Shows the newest one;
 * dismissing it brings up the next. Renders nothing when there is none (and for a platform admin).
 */
export function PlatformNoticeBanner({ role }: { role: NoticeRole | null }) {
  const { pathname } = useLocation()
  const [notices, setNotices] = useState<VisibleNotice[]>([])

  const load = useCallback(async () => {
    setNotices(await getMyPlatformNotices(role))
  }, [role])

  // On arrival, when the person comes back to the tab, and every ten minutes, so a withdrawn or
  // ended notice goes away without a reload.
  useEffect(() => {
    if (!role || role === "platform-admin") return
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    const onFocus = () => void load()
    window.addEventListener("focus", onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }, [load, role])

  // An ended notice also leaves when the person moves to another screen.
  const now = Date.now()
  const live = notices.filter((notice) => !notice.expiresAt || new Date(notice.expiresAt).getTime() > now)
  const notice = live[0]
  // Not during club setup or sign-in style screens that have no chrome of their own.
  if (!notice || !role || role === "platform-admin" || pathname.startsWith("/club-admin/setup") || pathname === "/club-admin/get-started") return null

  const dismiss = () => {
    setNotices((current) => current.filter((item) => item.id !== notice.id))
    void dismissPlatformNotice(notice.id, role)
  }

  const link = notice.linkUrl
  return (
    <div data-platform-notice={notice.id} className="mx-auto w-full max-w-[1240px] px-5 pt-4 sm:px-6 lg:px-10 print:hidden">
      <Notice
        action={
          <Button variant="quiet" size="sm" onClick={dismiss} aria-label={`Dismiss notice: ${notice.title}`}>
            Dismiss
          </Button>
        }
      >
        <span className="block font-bold text-sk-ink">{notice.title}</span>
        <span className="mt-0.5 block whitespace-pre-line break-words font-normal text-sk-ink-2">{notice.body}</span>
        {link ? (
          link.startsWith("/") ? (
            <Link to={link} className="sk-link mt-1 inline-block">
              Open
            </Link>
          ) : (
            <a href={link} target="_blank" rel="noopener noreferrer" className="sk-link mt-1 inline-block break-all">
              Read more
            </a>
          )
        ) : null}
      </Notice>
    </div>
  )
}

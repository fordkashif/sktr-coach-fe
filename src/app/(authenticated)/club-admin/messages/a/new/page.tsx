"use client"

import ClubAdminMessagesPage from "@/app/(authenticated)/club-admin/messages/page"
import { AnnouncementCompose } from "@/components/messages/announcement-compose"

/** Writing an announcement: a sheet over the club's messages. */
export default function ClubAdminNewAnnouncementPage() {
  return (
    <>
      <ClubAdminMessagesPage />
      <AnnouncementCompose role="club-admin" team={null} />
    </>
  )
}

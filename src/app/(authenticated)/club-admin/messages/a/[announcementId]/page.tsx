"use client"

import { useParams } from "react-router-dom"
import { AnnouncementView } from "@/components/messages/announcement-view"

export default function AnnouncementPage() {
  const { announcementId = "" } = useParams()
  return <AnnouncementView key={announcementId} role="club-admin" announcementId={announcementId} />
}

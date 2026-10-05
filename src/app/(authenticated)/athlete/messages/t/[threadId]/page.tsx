"use client"

import { useParams } from "react-router-dom"
import { ThreadView } from "@/components/messages/thread-view"

export default function ThreadPage() {
  const { threadId = "" } = useParams()
  return <ThreadView key={threadId} role="athlete" threadId={threadId} />
}

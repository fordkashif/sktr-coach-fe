import { ScreenSkeleton } from "@/components/sk"

/** Shown while a signed-in screen loads: the shape of a screen, so nothing jumps when it arrives. */
export default function AuthenticatedLoading() {
  return <ScreenSkeleton />
}

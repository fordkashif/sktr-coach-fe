import { Avatar } from "@/components/sk"
import { useAvatarLookup } from "@/lib/account-store"

/**
 * The kit Avatar for a person in a list: their photo when the signed-in user may see it, otherwise
 * initials. Pass whichever id the row has (athlete id on rosters, user id or email on People lists).
 */
export function PersonAvatar({
  name,
  athleteId,
  userId,
  email,
  size = "md",
  className,
}: {
  name: string
  athleteId?: string | null
  userId?: string | null
  email?: string | null
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
}) {
  const lookup = useAvatarLookup()
  return <Avatar name={name} src={lookup({ athleteId, userId, email })} size={size} className={className} />
}

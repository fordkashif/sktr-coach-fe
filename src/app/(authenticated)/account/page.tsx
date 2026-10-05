import { EmptyState, LinkButton, List, ListRow, Screen, ScreenHeader, Section } from "@/components/sk"
import { useRole } from "@/lib/role-context"

/** Placeholder until the account screen is built. It keeps the "Your account" menu entry from being a dead link. */
export default function AccountPage() {
  const { role, userEmail } = useRole()
  const roleLabel = role === "platform-admin" ? "Platform admin" : role === "club-admin" ? "Club admin" : role === "coach" ? "Coach" : "Athlete"

  return (
    <Screen width="narrow">
      <ScreenHeader title="Your account" lede="Your sign-in details and how you appear to your club." />

      <Section title="Signed in as">
        <List>
          <ListRow title="Email" trailing={userEmail ?? "Not available"} />
          <ListRow title="Role" trailing={roleLabel} />
        </List>
      </Section>

      <Section title="Settings">
        <List>
          <ListRow to="/settings/notifications" title="Notification settings" subtitle="Choose what we tell you about and how." />
        </List>
      </Section>

      <EmptyState
        title="More account settings are coming"
        body="Changing your name, photo and password will live here soon. Until then, a club admin can update your details for you."
        action={
          role === "athlete" ? (
            <LinkButton to="/athlete/profile">Open your profile</LinkButton>
          ) : undefined
        }
      />
    </Screen>
  )
}

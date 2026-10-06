import { List, ListRow, Screen, ScreenHeader, Section } from "@/components/sk"
import { CoachContactSection, DevicesSection, HelpSection, NameSection, PhotoSection, SignInSection } from "@/components/account/account-sections"
import { DeleteAccountSection, YourDataSection } from "@/components/account/data-rights-sections"
import { useCurrentAccount } from "@/lib/account-store"
import { useRole } from "@/lib/role-context"
import { UnitsSection } from "@/components/account/units-section"

/** Your account: photo, name, sign-in details. Every role opens it; athletes reach it from their profile. */
export default function AccountPage() {
  const { role } = useRole()
  const { displayName } = useCurrentAccount()
  const isAthlete = role === "athlete"

  return (
    <Screen width="narrow">
      <ScreenHeader
        title={isAthlete ? "Account and security" : "Your account"}
        lede={isAthlete ? "Your photo and how you sign in." : "Your photo, your name and how you sign in."}
        back={isAthlete ? { to: "/athlete/profile", label: "Profile" } : undefined}
      />

      <PhotoSection hint={role === "platform-admin" ? "Shown in the top bar." : isAthlete ? "Your coaches see this on the roster." : "Your club sees this next to your name."} />

      {isAthlete ? (
        <Section title="Name">
          <List>
            <ListRow to="/athlete/profile" title={displayName} subtitle="Change your name, date of birth and events on your profile." />
          </List>
        </Section>
      ) : (
        <NameSection />
      )}

      <SignInSection />

      {role === "coach" ? <CoachContactSection /> : null}

      <Section title="Settings">
        <List>
          <ListRow to="/settings/notifications" title="Notification settings" subtitle="Choose what we tell you about and how." />
        </List>
      </Section>

      {role === "platform-admin" ? null : <UnitsSection />}

      <DevicesSection />
      <YourDataSection />
      <DeleteAccountSection />
      <HelpSection />
    </Screen>
  )
}

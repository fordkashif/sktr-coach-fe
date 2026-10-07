import { useState } from "react"
import { Button, Section, StatusText } from "@/components/sk"
import { INSTALL_REASON, InstallSteps, InstallStepsBody } from "@/components/install-banner"
import { useInstallOffer } from "@/lib/install-prompt"

/**
 * "Get the app" in Your account: the install action or the steps, at any time, also after
 * "Not now" on the banner. Says so when the app is already on this device.
 */
export function GetAppSection() {
  const offer = useInstallOffer()
  const [stepsOpen, setStepsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (offer.installed) {
    return (
      <Section title="Get the app" hint="Open SKTR Coach from your Home Screen. Notifications arrive there.">
        <div data-install-state="installed" className="border-y border-sk-line py-4">
          <StatusText tone="green">Installed on this device</StatusText>
        </div>
      </Section>
    )
  }

  const install = async () => {
    setBusy(true)
    await offer.install()
    setBusy(false)
  }

  return (
    <Section title="Get the app" hint={INSTALL_REASON}>
      <div data-install-state={offer.canPrompt ? "one-tap" : "steps"} className="flex flex-col items-start gap-4">
        {offer.canPrompt ? (
          <Button variant="primary" disabled={busy} onClick={() => void install()}>
            Install SKTR Coach
          </Button>
        ) : offer.available ? (
          <Button onClick={() => setStepsOpen(true)}>Show me how</Button>
        ) : (
          <InstallStepsBody platform={offer.platform} />
        )}
      </div>
      <InstallSteps open={stepsOpen} onOpenChange={setStepsOpen} platform={offer.platform} />
    </Section>
  )
}

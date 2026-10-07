import { useState, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { Copy, DotsThreeVertical, DownloadSimple, Export, type Icon, PlusSquare, CheckCircle, Compass } from "@phosphor-icons/react"
import { Button, Dialog, Sheet, notify } from "@/components/sk"
import { useIsMobile } from "@/hooks/use-mobile"
import { onAppInstalled, useInstallOffer, type InstallPlatform } from "@/lib/install-prompt"

export const INSTALL_TITLE = "Get SKTR Coach on your phone"
export const INSTALL_REASON = "Opens in one tap, works with weak signal at the track, and sends you notifications."
const APP_ICON = "/icons/icon-192.png"

// One message however the install was started (banner, Your account or the sign-in screen).
onAppInstalled(() => {
  notify("SKTR Coach is installed. Open it from your Home Screen.")
})

type Step = { icon: Icon; text: ReactNode }

const SAFARI_STEPS: Step[] = [
  { icon: Export, text: "Tap the Share button at the bottom of Safari." },
  { icon: PlusSquare, text: <>Scroll down and tap &quot;Add to Home Screen&quot;.</> },
  { icon: CheckCircle, text: <>Tap &quot;Add&quot;.</> },
]

const ANDROID_STEPS: Step[] = [
  { icon: DotsThreeVertical, text: "Tap the menu (three dots) at the top right." },
  { icon: PlusSquare, text: <>Tap &quot;Install app&quot; or &quot;Add to Home screen&quot;.</> },
  { icon: DownloadSimple, text: <>Tap &quot;Install&quot;.</> },
]

function StepList({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol aria-label={label} className="divide-y divide-sk-line border-y border-sk-line">
      {steps.map((step, index) => (
        <li key={index} className="flex min-h-14 items-center gap-3 py-3">
          <span className="w-5 shrink-0 text-center text-[1.0625rem] font-extrabold tabular-nums text-sk-blue-ink" aria-hidden>
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 text-[1rem] font-semibold leading-snug text-sk-ink">{step.text}</span>
          <step.icon className="size-6 shrink-0 text-sk-ink-2" weight="bold" aria-hidden />
        </li>
      ))}
    </ol>
  )
}

function CopyLink() {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin)
      setCopied(true)
      notify("Link copied. Paste it in Safari.")
    } catch {
      notify("Could not copy the link", `Type ${window.location.host} in Safari.`)
    }
  }
  return (
    <Button onClick={() => void copy()}>
      <Copy className="size-5" weight="bold" aria-hidden />
      {copied ? "Link copied" : "Copy link"}
    </Button>
  )
}

/** The steps for this kind of phone. Shared by the sheet and by Your account. */
export function InstallStepsBody({ platform }: { platform: InstallPlatform }) {
  if (platform === "android") {
    return (
      <div className="flex flex-col gap-4" data-install-steps="android">
        <StepList steps={ANDROID_STEPS} label="Steps to install on Android" />
        <p className="text-[0.9375rem] leading-snug text-sk-mute">Open SKTR Coach from your Home screen from now on.</p>
      </div>
    )
  }
  if (platform === "desktop" || platform === "unknown") {
    return (
      <p className="text-[0.9375rem] leading-snug text-sk-mute" data-install-steps="desktop">
        Open this page on your phone to add SKTR Coach to its Home Screen. On this computer, use Chrome or Edge and look for the install button in the address bar.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4" data-install-steps={platform}>
      {platform === "ios-other" ? (
        <div className="flex flex-col items-start gap-3">
          <p className="flex items-center gap-2.5 text-[1.0625rem] font-bold leading-snug text-sk-ink">
            <Compass className="size-6 shrink-0 text-sk-blue-ink" weight="bold" aria-hidden />
            Open this page in Safari first
          </p>
          <p className="text-[0.9375rem] leading-snug text-sk-mute">On an iPhone only Safari can put an app on the Home Screen. Copy the link, open Safari and paste it there. Then:</p>
          <CopyLink />
        </div>
      ) : null}
      <StepList steps={SAFARI_STEPS} label="Steps to install on iPhone or iPad" />
      <p className="text-[0.9375rem] leading-snug text-sk-mute">Open SKTR Coach from your Home Screen from now on. Notifications only work from there.</p>
    </div>
  )
}

/** The steps in a sheet on a phone and a dialog on a computer. */
export function InstallSteps({ open, onOpenChange, platform }: { open: boolean; onOpenChange: (open: boolean) => void; platform: InstallPlatform }) {
  const isMobile = useIsMobile()
  const title = "Add SKTR Coach to your Home Screen"
  const body = <InstallStepsBody platform={platform} />
  const done = (
    <Button variant="primary" onClick={() => onOpenChange(false)}>
      Done
    </Button>
  )
  return isMobile ? (
    <Sheet open={open} onOpenChange={onOpenChange} side="bottom" title={title} footer={done}>
      {body}
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} footer={done}>
      {body}
    </Dialog>
  )
}

/**
 * The strip at the top of the signed-in app that offers the install. Mounted once in the app shell.
 * Shows only when the app is not installed, this device can install it and the person has not said
 * "Not now" lately. On a computer that means only when the browser offers its one tap install.
 */
export function InstallBanner() {
  const { pathname } = useLocation()
  const offer = useInstallOffer()
  const [stepsOpen, setStepsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const closeSteps = (open: boolean) => {
    setStepsOpen(open)
    // They have seen how. The banner steps back; the steps stay in Your account.
    if (!open) offer.snooze()
  }

  const steps = <InstallSteps open={stepsOpen} onOpenChange={closeSteps} platform={offer.platform} />
  const hiddenHere = pathname.startsWith("/club-admin/setup") || pathname === "/club-admin/get-started"
  if (!offer.visible || hiddenHere) return stepsOpen ? steps : null

  const primary = async () => {
    if (offer.showSteps) {
      setStepsOpen(true)
      return
    }
    setBusy(true)
    const outcome = await offer.install()
    setBusy(false)
    // The browser's question was closed: treat it like "Not now" so the banner does not sit there dead.
    if (outcome !== "accepted") offer.snooze()
  }

  return (
    <div data-install-banner={offer.platform} className="mx-auto w-full max-w-[1240px] px-5 pt-4 sm:px-6 lg:px-10 print:hidden">
      <section aria-label="Install SKTR Coach" className="flex flex-col gap-3 rounded-2xl bg-sk-blue-tint p-4 sm:flex-row sm:items-center sm:gap-4 sm:py-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <img src={APP_ICON} alt="" width={44} height={44} className="size-11 shrink-0 rounded-[12px]" />
          <div className="min-w-0">
            <p className="text-[1.0625rem] font-extrabold leading-tight tracking-[-0.02em] text-sk-ink">{offer.platform === "desktop" ? "Get SKTR Coach as an app on this computer" : INSTALL_TITLE}</p>
            <p className="mt-1 text-[0.9375rem] leading-snug text-sk-ink-2">{offer.platform === "desktop" ? "Opens in its own window, one click from your dock or taskbar." : INSTALL_REASON}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" className="flex-1 sm:flex-none" disabled={busy} onClick={() => void primary()}>
            {offer.showSteps ? "Show me how" : "Install"}
          </Button>
          <Button variant="quiet" className="flex-1 sm:flex-none" onClick={offer.snooze}>
            Not now
          </Button>
        </div>
      </section>
      {steps}
    </div>
  )
}

/** One quiet line under the sign-in form. Nothing when the app is installed or cannot be. */
export function InstallTip() {
  const offer = useInstallOffer()
  const [stepsOpen, setStepsOpen] = useState(false)
  if (!offer.available) return null

  const open = async () => {
    if (offer.showSteps) setStepsOpen(true)
    else await offer.install()
  }

  return (
    <div data-install-tip className="-mt-2 flex justify-center">
      <button type="button" onClick={() => void open()} className="flex min-h-11 items-center gap-2.5 rounded-[12px] px-2 text-[0.9375rem] font-semibold text-sk-mute hover:text-sk-ink">
        <img src={APP_ICON} alt="" width={24} height={24} className="size-6 shrink-0 rounded-[7px]" />
        {offer.platform === "desktop" ? "Tip: install SKTR Coach on this computer" : "Tip: install SKTR Coach on your phone"}
      </button>
      <InstallSteps open={stepsOpen} onOpenChange={setStepsOpen} platform={offer.platform} />
    </div>
  )
}

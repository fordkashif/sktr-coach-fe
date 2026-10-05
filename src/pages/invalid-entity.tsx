import { LinkButton, Screen, ScreenHeader } from "@/components/sk"

/** Shown inside the app when a link points at something that does not exist (or is not yours to see). */
export function InvalidEntityPage({ title, description, backTo }: { title: string; description: string; backTo: string }) {
  return (
    <Screen width="narrow">
      <ScreenHeader back={{ to: backTo, label: "Go back" }} title={title} lede={description} />
      <div>
        <LinkButton to="/" variant="primary">
          Go to home
        </LinkButton>
      </div>
    </Screen>
  )
}

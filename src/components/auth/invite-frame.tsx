import type { ReactNode } from "react"
import { List, ListRow, Screen, Section } from "@/components/sk"

/**
 * The frame of the public invite pages (athlete claim, coach invite): no app chrome, the brand, then
 * the same kit parts as every signed-in screen so the two pages are siblings.
 */
export function InviteFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[560px] py-4 sm:py-10">
      <Screen width="narrow">
        <p className="text-lg font-extrabold tracking-[-0.03em] text-sk-blue">SKTR Coach</p>
        {children}
      </Screen>
    </main>
  )
}

/** The numbered "what happens next" list under an invite. */
export function InviteSteps({ title, steps }: { title: string; steps: Array<{ title: string; body: string }> }) {
  return (
    <Section title={title}>
      <List ordered>
        {steps.map((step, index) => (
          <ListRow key={step.title} leading={<span className="w-5 text-center font-bold text-sk-blue-link">{index + 1}</span>} title={step.title} subtitle={step.body} />
        ))}
      </List>
    </Section>
  )
}

import type { ReactNode } from "react"
import { Section } from "@/components/sk"
import { AuthSplit } from "@/layouts/auth-layout"

/**
 * The frame of the public invite pages (athlete claim, coach invite, guardian claim, join a team):
 * the same front door as sign in, with the form on white and the photo panel beside it. `headline`
 * is the line on the panel; each invite says what is waiting for the person.
 */
export function InviteFrame({ children, headline = ["Your team", "is waiting."], body }: { children: ReactNode; headline?: string[]; body?: ReactNode }) {
  return (
    <AuthSplit headline={headline} body={body ?? "Plans, check-ins, results and messages from your club, all in one place."}>
      {children}
    </AuthSplit>
  )
}

/** The numbered "what happens next" steps under an invite, as tiles that land one after another. */
export function InviteSteps({ title, steps }: { title: string; steps: Array<{ title: string; body: string }> }) {
  return (
    <Section title={title}>
      <ol className="flex flex-col gap-2.5 pt-1" aria-label={title}>
        {steps.map((step, index) => (
          <li key={step.title} className="sk-tile-item" style={{ animationDelay: `${index * 80}ms` }}>
            <div className="sk-tile flex items-start gap-4 p-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sk-accent font-display text-[1.5rem] font-black leading-none text-sk-on-accent">{index + 1}</span>
              <span className="min-w-0 pt-0.5">
                <span className="block font-bold text-sk-ink">{step.title}</span>
                <span className="mt-0.5 block text-sm leading-snug text-sk-mute">{step.body}</span>
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  )
}

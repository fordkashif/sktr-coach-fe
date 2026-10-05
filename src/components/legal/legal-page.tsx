import type { ReactNode } from "react"
import { Fact, FactList, Notice, ScreenHeader, Section } from "@/components/sk"
import { PublicFrame } from "@/layouts/auth-layout"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"

/**
 * The date the current text of the legal pages takes effect. OWNER: fill this in when the text has
 * been reviewed (for example "1 December 2026"), and set LEGAL_REVIEWED to true to remove the draft
 * notice. Until then both pages say they are drafts.
 */
export const LEGAL_EFFECTIVE_DATE: string | null = null
export const LEGAL_REVIEWED = false

/** The frame of a legal page: brand, title, the draft notice, the dates, then the sections. */
export function LegalPage({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <PublicFrame width="reading">
      <ScreenHeader title={title} lede={lede} />
      {LEGAL_REVIEWED ? null : <Notice tone="warning">Draft. This page has not been reviewed by a lawyer yet.</Notice>}
      <FactList aria-label="About this page">
        <Fact label="Effective date" empty="Not set yet">
          {LEGAL_EFFECTIVE_DATE}
        </Fact>
        <Fact label="Who runs SKTR Coach">SKTR Labs, Kingston, Jamaica</Fact>
        <Fact label="Contact">
          <a href={SUPPORT_MAILTO} className="sk-link">
            {SUPPORT_EMAIL}
          </a>
        </Fact>
      </FactList>
      {children}
    </PublicFrame>
  )
}

/** One headed part of a legal page. Children are LegalText and LegalList. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <div className="flex flex-col gap-3 pt-2">{children}</div>
    </Section>
  )
}

/** A short paragraph of long-form text. */
export function LegalText({ children }: { children: ReactNode }) {
  return <p className="max-w-[68ch] text-base leading-relaxed text-sk-ink-2">{children}</p>
}

/** A plain bulleted list inside a legal section. */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex max-w-[68ch] list-disc flex-col gap-1.5 pl-5 text-base leading-relaxed text-sk-ink-2 marker:text-sk-faint">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

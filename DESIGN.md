# SKTR Coach design system

Light, friendly, bold. One typeface (Outfit). Flat color, no gradients, no drop shadows, no dark surfaces.
The loudest thing on any screen is a number or a name, never decoration.

## Tokens (Tailwind classes, defined in `src/styles/globals.css`)

| Token | Hex | Use |
|---|---|---|
| `sk-ink` | #0E1320 | Text, ink buttons |
| `sk-ink-2` / `sk-mute` | #3A4252 / #6A7385 | Secondary and tertiary text |
| `sk-line` | #E3E6EE | Borders, dividers |
| `sk-canvas` | #F5F6FA | Page background, wells |
| `sk-blue` (+ `-tint`) | #2152FF | Primary action, active nav, the key metric |
| `sk-green` (+ `-tint`) | #0C9D61 | Ready, on track, improved |
| `sk-yellow` (+ `-tint`) | #FFC93C | Watch, highlights, PRs |
| `sk-coral` (+ `-tint`) | #FF5C39 | Review, behind, destructive |

Color always means something: green ready, yellow watch, coral review. Blue is action. Do not use color as decoration.

## Building blocks

Import from `@/components/sk`: `PageHeader`, `Stat`, `Panel`, `Tag`, `ReadinessTag`, `Initials`, `Meter`, `scoreTone`, `EmptyState`, `Segmented`.

CSS classes: `sk-page` (page frame), `sk-title`, `sk-lede`, `sk-h2`, `sk-h3`, `sk-label`, `sk-num`, `sk-card`, `sk-well`, `sk-row`,
`sk-btn` + `sk-btn-primary | -ink | -quiet | -ghost | -danger` (+ `sk-btn-sm`), `sk-tag-*`, `sk-seg`, `sk-field`, `sk-meter`.

Icons: `@phosphor-icons/react` only, `weight="bold"` by default and `weight="fill"` for active or emphasis. No Hugeicons, no Lucide.

## Rules

1. Every screen is `<div className="sk-page">` starting with one `PageHeader`. The title is the thing itself (team name, athlete name, "Training plans"), said once. No eyebrow labels above headings.
2. No uppercase tracked labels. Labels are sentence case, `text-sm font-semibold text-sk-mute`.
3. One level of card. A `Panel` holds rows, lists, tables or a `sk-well`. Never a bordered card inside a bordered card.
4. Lists of people or items are rows with dividers (`sk-row` or a table), not a stack of mini cards.
5. One primary (`sk-btn-primary`) action per screen. Everything else is quiet or ghost.
6. Radius: 20px cards, 14px controls, 8px tags. Buttons are not full pills.
7. Copy is plain and short, written to the coach: "Who needs you", "Build a plan". Sentence case. No em dashes. Button text says what happens.
8. Empty states say what will appear and give the next action. Never show placeholder or made-up numbers.
9. Mobile first: stat blocks 2 across, panels stack, tables scroll sideways inside the panel, tap targets 44px.
10. Keep visible focus rings and semantic markup (tables with `th scope`, `aria-current`, labels on inputs).

Reference implementation: `src/app/(authenticated)/coach/dashboard/page.tsx`.

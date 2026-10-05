# SKTR Coach design system v2: clean lists

This is the only design direction for the app. If a screen disagrees with this file, the screen is wrong.

Two reference screens show everything below in use. Copy them:

- Phone: `src/app/(authenticated)/athlete/home/page.tsx`
- Desktop: `src/app/(authenticated)/coach/dashboard/page.tsx`

## The idea in five lines

1. The page is white. Content sits directly on it. There are no boxes around sections, no grey canvas, no drop shadows.
2. Sections are separated by whitespace. Things inside a section are separated by 1px hairlines.
3. Lists are rows. Tables are tables. A stat is a number with a small label.
4. Type does the work: one typeface (Outfit), big tight bold titles, plain sentence case words.
5. Colour means state. If a colour is not telling the reader "act", "ready", "watch" or "needs attention", remove it.

It has to feel like an app, not a report: the same chrome on every screen, the same header pattern on every screen, content that starts straight away, and nothing that jumps while loading.

## How to build a screen

Import from `@/components/sk` and nothing else for layout. A screen file contains data loading and a tree of kit parts. It contains no hand-written page padding, max width, card, border, heading style or grid.

```tsx
<Screen>
  <ScreenHeader title="Sprint Group" lede="Week 3 of 8. One athlete needs a look today." actions={...} />
  <StatStrip>
    <Stat label="Plan adherence" value={86} unit="%" />
    <Stat label="Ready to train" value={3} of={4} />
  </StatStrip>
  <Split
    main={<Section title="Athletes" action={<Link className="sk-link" to="...">Open roster</Link>}><DataTable ... /></Section>}
    side={<Section title="This week's plan"><List>...</List></Section>}
  />
</Screen>
```

Checklist before you open a pull request:

- The root is `Screen`. The first child is exactly one `ScreenHeader`.
- Every block under it is a `Section`, `StatStrip`, `Split`, `Notice` or (at most one) `HeroBlock`.
- No element on the screen has a border on all four sides except a control (button, input, tag).
- No `bg-*` on anything larger than a control, apart from the one `HeroBlock`.
- One primary button at most.
- At 390px wide nothing scrolls sideways and every tap target is 44px tall.
- While loading, the screen shows `SkeletonRows` where the rows will be. It never shows "Loading..." text in place of the screen and never changes height when data arrives.

If you need something the kit does not have, add it to the kit (and to this file) rather than writing it in the screen.

## Tokens

Defined in `src/styles/globals.css`. Use the Tailwind names (`text-sk-mute`, `border-sk-line`), never raw hex in a screen.

| Token | Hex | Use |
|---|---|---|
| `sk-ink` | #0e1320 | Text. The athlete's round log button. Never a panel or a large surface. |
| `sk-ink-2` | #3a4252 | Secondary text in tables, inactive top bar tabs |
| `sk-mute` | #5a6274 | Labels, subtitles, hints (14px) |
| `sk-faint` | #8a91a1 | Placeholders, rest days |
| `sk-line` | #e6e8ee | Hairlines |
| `sk-line-strong` | #d5d9e3 | Borders of controls (outlined buttons, inputs) |
| `sk-soft`, `sk-soft-2` | #f3f4f8, #eef0f5 | Soft fill for neutral chips, inputs, hover, skeletons |
| `sk-blue` | #2152ff | Action and active. Primary button, active tab, today |
| `sk-blue-link`, `sk-blue-ink`, `sk-blue-tint` | #1b46e0, #1638b8, #e8edff | Text links, active tab text, active tab fill |
| `sk-green`, `sk-green-ink` | #0c9d61, #07673f | Ready, done |
| `sk-amber`, `sk-amber-ink` | #e0a800, #7a5600 | Watch. Amber is a dot; the words beside it use the dark amber |
| `sk-coral`, `sk-coral-ink` | #ff5c39, #c7300f | Needs attention, destructive |
| `sk-yellow` | #ffc93c | Avatar fill and to-do dots only |

The page background is white everywhere, including sign-in screens. There is no dark theme and no near-black surface.

## Type

Outfit only, loaded as a variable font. No other typeface, no serif, no monospace for numbers (use `tabular-nums`).

| Role | Class | Phone | Desktop |
|---|---|---|---|
| Screen title (h1) | `sk-title` | 30px, 800, -0.04em | 44px, 800, -0.045em |
| Detail screen title (h1) | `sk-title-compact` | 24px, 800 | 32px, 800 |
| Lede under the title | `sk-lede` | 15px, mute | 17px, mute |
| Section heading (h2) | `sk-h2` | 18px, 700, -0.02em | 22px, 700 |
| Row title | `sk-list-title` | 16px, 600 | same |
| Body | (default) | 15 to 17px, ink | same |
| Secondary, labels, hints | `sk-label`, `sk-list-sub` | 14px, mute | same |
| Stat number | `sk-stat-value` | 32px, 800 | 40px, 800 |

Rules: sentence case everywhere, including buttons, tabs and table headers. No uppercase, no letter-spaced labels, no small category label above a heading. A screen has one h1 and its sections use h2. The kit sets all of this; do not restyle headings in a screen.

## Colour means state

| Meaning | Colour | Shown as |
|---|---|---|
| Something to do, or the current item | blue | Primary button, active tab, today's day, a blue dot |
| Ready, done, improved | green | Green dot plus dark green text |
| Watch | amber | Amber dot plus dark amber text |
| Needs attention, behind, destructive | coral | Coral dot plus dark coral text |
| Everything else | ink and mute | No colour |

State is a small dot followed by text (`StatusText`, `StatusDot`, `ReadinessText`). It is not a pill. The only place a tinted tag is allowed is a status column inside a `DataTable` (`Tag`). Stats, section headings and icons are never coloured for decoration.

### The one colour block

A screen may have at most one solid colour block, `HeroBlock`, and most screens have none. It is for the single most important thing on the screen together with its primary action: the athlete's session for today with "Start session". Do not use it for stats, tips, onboarding, notices or because a screen looks plain. If you are not sure the screen needs one, it does not.

## The kit

All from `@/components/sk`.

### Frame

| Part | What it is |
|---|---|
| `Screen` | Root of every screen. White, centred, 1160px content width on desktop with 40px side padding, 20px side padding on phone, 28px between blocks on phone and 36px on desktop. `width="narrow"` (720px) for forms and simple detail screens. |
| `ScreenHeader` | The h1 with an optional lede, optional `actions` (buttons, right on desktop, under the title on phone) and optional `fact` (one plain line above the title such as today's date). With `back={{ to, label }}` it becomes the detail variant: a back link above a smaller title. Every screen reached from a list has `back`. |
| `Section` | An h2 and its content. `hint` is a line under the heading, `meta` is plain text on the right ("2 of 4 done"), `action` is a link on the right (`<Link className="sk-link">`). No border, no background. |
| `Split` | The only two-column layout: `main` (about two thirds) and `side`. Stacks on phone, main first. |
| `HeroBlock` | The one solid colour block. See above. Its button is `HeroAction`. |

### Lists, numbers, tables

| Part | What it is |
|---|---|
| `List`, `ListRow` | Rows with hairline dividers, 56px minimum. `leading` takes a `StatusDot`, `Avatar`, icon, weekday or step number. `title`, `subtitle`, `trailing` (a value). Pass `to`, `href` or `onClick` to make the whole row the target; rows that navigate get a chevron. |
| `ActionRow`, `RowMenu` | `ActionRow` is a list row that opens something and also carries its own actions to the right, outside the click target, with room under it for an `InlineConfirm`. `RowMenu` is the "more" button (three dots) for the actions used now and then (duplicate, archive, delete, export), so a list is not a wall of buttons. |
| `CheckRow` | A list row you tick: the whole row is the label of its checkbox, with the same slots as `ListRow`. For picking people from a roster. |
| `PersonPicker` | Choose one person (radio buttons) or, with `multiple`, several (tick boxes) from a list of people: photo or initials, name, one line of detail, a state on the right. A person who cannot be picked stays in the list, greyed, with the reason ("No login"). A search box appears for long lists; `renderChosen` puts more under a ticked person (the events to enter them in). For recipients and for a roster to enter in something. |
| `StatStrip`, `Stat` | A hairline above and below, stats divided by vertical hairlines. One row on desktop, two columns on phone. `Stat` takes `label`, `value`, `unit`, and `of` for "3 of 4". Two to five stats. Never coloured. |
| `DataTable`, `TableSub` | A real table: caption for screen readers, `th scope`, right-aligned numeric columns (`align: "right"`). The first column is the row header (name, with `TableSub` for a second line). On phone each row restacks into a list row: use `phone: "trailing"` for the one value to keep on the right, `"plain"` for a value that needs no label, `"hide"` to drop a column; other columns become labelled lines. It never scrolls the page sideways. `rowBelow` opens something under one row across the full width (an `InlineConfirm` for that row's action). |
| `DayStrip` | Seven days of a week as circles: today blue, done green tick, planned soft fill, rest plain. |
| `WeekPager` | Which week is showing ("Week 2 of 4" with the dates under it) with previous and next buttons, and room for a quiet "Today" action. |
| `DayPicker` | `DayStrip` you can tap: pick one of seven days, the chosen one has a ring. Also shows skipped (dash) and missed (coral). Use with `WeekPager`. |
| `DayLabel` | A weekday over the day of the month as the leading part of a `ListRow` in a week list. Today is blue. |
| `Meter` | A thin progress bar. Give it an `aria-label` via `label`. |
| `Sparkline` | One small trend line with no axes (readiness over the last weeks). Ink line, newest point marked, missing days skipped. Needs a `label` that says the trend in words. |
| `TrendLine`, `TrendBars` | A real chart with axes, straight on the page (no box): one series, a 2px line in blue or slim bars in green, hairline grid, 12px grey labels, a tooltip on hover or tap. `TrendLine` takes dates (drawn to scale) or even steps; `TrendBars` is a count per period and starts at zero. Both need a `label` sentence, and the headline number goes in words beside them. |
| `Mark` | A result written the track and field way: the number bold, its unit small beside it, and a `qualifier` for the wind reading ("11.28 s +0.9"). Sizes `sm` (table), `md` (trailing value of a row), `lg` (the one mark a screen is about). Ink only; "personal best" is said beside it with `StatusText` or a `Tag`. |
| `FactList`, `Fact` | Read-only details as label and value rows with hairlines (a profile, an invite). `empty` is the grey text for a value not added yet, `stack` puts a long value under its label. |
| `EmptyState` | Two lines of plain text (what will appear here) and one action. No box, no icon. |
| `SkeletonRows`, `Skeleton`, `ScreenSkeleton` | Loading placeholders the height of real rows. |

### State and people

| Part | What it is |
|---|---|
| `StatusDot`, `StatusText` | Dot, and dot plus bold text. Tones: `green`, `amber`, `coral`, `blue`, `neutral`. |
| `ReadinessText` | Readiness with the app-wide mapping: green Ready, yellow Watch, red Review. Optional `detail` ("slept 5h"). |
| `Tag` | Small tinted tag for a status column in a table only. |
| `Avatar` | The photo when `src` is given, otherwise initials on a solid colour chosen from the name. Sizes `sm` 32, `md` 40, `lg` 44, `xl` 64. |
| `FilterBar`, `FilterChips` | Above a list or table: `FilterBar` holds a `SearchInput` and its `FilterChips` rows (one row per thing to filter by, one chip always chosen, first is "All"). On phone the chips fold behind a "Filters" button with the number in use. |
| `QrCode` | A QR code for a link, drawn as crisp black squares on white (SVG, made in the browser by `src/lib/qr/qr-encode.ts`, no outside service). Needs a `label`; always show the link beside it. `md` 220px, `lg` up to 360px for showing a squad. |
| `PasteList` | Bring in a list by typing, pasting or choosing a CSV or text file: a tall text box with a "Choose a file" link. It only collects the text; the screen shows a preview `DataTable` under it before anything is saved. |
| `PasswordInput` | An `Input` for a password with a "Show" / "Hide" button inside it. Wrap it in a `Field`. Two of them (new password and confirm) can share one `shown` state. |
| `ClubMark` | A club's logo as a small square. With no logo: the club's short name on the club colour, with black or white letters picked for contrast. The only place a club colour appears on screen; it never colours buttons, links or state. Always put the club's name in words beside it. |
| `RadioRow` | A list row you pick one of, the whole row being the label of its radio button: `title`, `subtitle`, `detail`, and a plain `note` on the right. For choices that need a line of explanation (a package). Goes inside a `List`. |
| `SuggestInput` | A text input that offers matching saved items under it while you type (an exercise from the club library): `options`, `onPick`, a `listLabel`. Free text is always allowed. Arrow keys and Enter pick, Escape closes; with nothing highlighted every key reaches `onKeyDown`, so it works inside `EditableRows` style tables. |
| `Notice` | One line about the screen: could not load, saved, heads up. Tones `info`, `success`, `warning`, `error`. Small and tinted. It never wraps other content. |
| `notify`, `notifyError` | A short toast after an action ("Plan saved"). |

### Controls

| Part | What it is |
|---|---|
| `Button`, `LinkButton` | `variant`: `primary` (solid blue, one per screen), `secondary` (outlined, the default), `quiet` (blue text, for cancel and minor actions), `danger` (outlined, coral text). `size`: `md` 44px, `sm` (44px on phone, 40px on desktop), `lg` 52px. `LinkButton` whenever pressing goes to another screen. Text says what happens; an icon may go before the text. |
| `Field` with `Input`, `Textarea`, `Select` | Label above, control (44px), then a hint or an error. `Field` wires ids and aria for you. |
| `FormGrid`, `FormActions`, `SearchInput` | `FormGrid` lays out a group of Fields: one column on phone, two (or four with `columns={4}`) above. `FormActions` ends a form: quiet "Cancel" first, the main action last. `SearchInput` is an `Input` with the search icon. |
| `DateRangeFields` | "From" and "To" as two date fields with optional quick ranges under them ("Last 28 days"). The range is always kept the right way round. |
| `EditableRows` | A short table you type straight into (the exercises of a block). Tab moves across, Enter moves down and adds a row on the last one, Backspace in an empty row removes it. Restacks on phone. |
| `DayChecks` | Tick any of the seven days of a week, each a square toggle with an optional mark under it (the A or B of an alternating pattern). |
| `EntryGrid`, `SaveState` | `EntryGrid` is for typing many numbers fast, spreadsheet style: rows down, columns across, Enter goes down, Tab across, paste a column from a spreadsheet, each cell shows saving, saved or not saved. The first column stays put and the rest scrolls inside the grid, with a line that says so. `SaveState` is the dot and words for anything that saves by itself ("Saving...", "Saved", "Not saved"). |
| `ConversationScreen`, `MessageList`, `MessageDay`, `MessageItem`, `MessageAction`, `ComposerBar` | A two-person message thread. `ConversationScreen` replaces `Screen` (narrow, and tall enough that the composer rests at the bottom). `MessageItem` is not a chat bubble: name and time on one line, the text under it, a thin rule down the side (blue on the right for mine, grey on the left for theirs); `status` is one quiet word under it ("Seen"), `hidden` a stub in place of the text, `headerAction` one `MessageAction` at the end of the name line ("Report"). `MessageDay` is the date on a hairline. `ComposerBar` stays above the phone tab bar like `ActionBar`: a text box that grows to five lines, Send, a character count near the limit, one `note` line above it, or a `readOnly` sentence instead of the box. |
| `Segmented` | Two to four views of the same thing. |
| `TapScale` | A 1 to 5 answer in one tap: numbered buttons, the two end words under them, the chosen word beside the question. |
| `Stepper` | A number changed with minus and plus (hours of sleep), shown large between the two buttons. |
| `Choices` | Tap to pick one (or, with `multiple`, several) from a short set of words, as a grid of equal buttons. For answers in a form; `Segmented` is for switching views. |
| `SetList`, `SetGroup`, `SetRow` | Logging results set by set. `SetGroup` is one exercise (name, target, a hint such as "Last time", progress, a row of quiet actions); each `SetRow` is one set: its number, the inputs, the tick. |
| `NumberInput` | A big number field for a phone (52px, decimal keypad, unit inside on the right). `mode="time"` also takes minutes and seconds. |
| `TickButton` | A 52px square tick: tap to mark a set done (green), tap again to undo. |
| `EffortScale` | A 1 to 10 answer in one tap, two rows of five, with the word for the chosen number under it. |
| `EffortButton` | The effort of one set, in a `SetRow` between the inputs and the tick (`effort` slot; `SetGroup effortColumn` labels it). Shows the number once given, a dash before, and opens an `EffortScale` in a bottom `Sheet`. `SetGroup` also takes `below` (a full width line under the heading, the "last time" line) and `footer` (under the actions, a note field). |
| `ActionBar` | A bar that stays at the bottom while the screen scrolls, above the phone tab bar: progress and save state of a long task, at most one button (a quiet text action such as "Save draft" may sit beside the state). Last child of `Screen`. |
| `Tabs` | Underlined tabs for more views or longer labels. |
| `StepIndicator` | Where someone is in a short run of screens done in order (the club setup wizard): one thin bar per step, blue up to the current one, the step names under them from tablet up. Read only. Goes straight under the `ScreenHeader`, whose `fact` says "Step 3 of 6: Club details" for phones. |
| `NavTabs` | The sub-sections of one destination when each is its own screen with its own address (Progress: Overview, Records, Competitions, Tests). Looks like `Tabs`, every tab is a link. Goes straight under the `ScreenHeader` of each of those screens. |
| `InlineConfirm` | "Are you sure" in place, where the button was. Use it instead of a dialog for remove, archive, cancel. |
| `SubSection`, `SubSections` | A titled group one level below a `Section` (an h3, an optional hint, a quiet `action`), for the parts of a `Sheet` or `Dialog`: "About the requester", "History". `SubSections` is the column they sit in. |
| `Sheet` | A panel over the screen with a title and a close button. `side="right"` for something to glance at (notifications), `side="bottom"` for a short choice on phone. |
| `Dialog` | A centred panel for one short form or decision. Title, close button, actions in `footer`. |
| `PrintSheet`, `PrintHeading`, `PrintTable`, `PrintBreak`, `printPage` | What goes on paper or into a PDF when the screen itself is the wrong thing to print (a plan week as a table). Invisible on screen; while one is mounted, printing shows the sheet and nothing else. Without one, any screen prints without the navigation and without being cut at one page; mark controls `print:hidden`. |

Controls: 44px minimum tap height, radius 12 to 16px, never a full pill. Focus rings stay visible (2px blue).

Icons: `@phosphor-icons/react` only. `weight="bold"` in buttons and rows, `weight="fill"` for the active tab. No Lucide, no Hugeicons. Icons support words; they do not replace them, except the bell, back, close and the athlete's log button, which carry an `aria-label`.

## Navigation

Built once in `src/components/app-shell.tsx`. Screens never draw navigation.

**Desktop, 1024px and wider: a top bar.** There is no sidebar. Left to right: the brand, the member's club (its `ClubMark` and, from 1280px, its name; nothing for a platform admin), the team switcher (only for a coach on two or more teams), the role's destinations as tabs, then the Messages button, the notifications bell and the profile avatar. The active tab has the soft blue fill with dark blue text. The bar is one row at every width from 1024px up; labels are kept short so that seven destinations fit. A coach on two or more teams also has the team switcher in the row, so between 1024px and 1280px "Test weeks" and "Competitions" read "Tests" and "Meets".

**Phone: an app bar and a tab bar.** The app bar is one 56px row: the brand on the left (or the team switcher for a multi-team coach, or a back button while a screen is in detail mode), the bell and the avatar on the right (and the Messages button for the athlete). The tab bar is white with a hairline on top, icon over label, the active one blue. It holds at most five items. A role with more destinations shows four and "More", which opens a bottom sheet with the rest. For the athlete the centre item is a raised round ink button that opens the session log. The athlete's Progress tab has four sections, each its own screen with `NavTabs` under the header (Overview, Records, Competitions, Tests); the tab stays lit on all of them and on the screens below them.

| Role | Desktop tabs | Phone tabs |
|---|---|---|
| Athlete | Home, Plan, Log, Progress, Profile. Messages button | Home, Plan, (log button), Progress, Me. Messages button in the app bar |
| Coach | Dashboard, Athletes, Plans, Test weeks, Competitions, Reports. Messages button | Dashboard, Athletes, Plans, Messages, More (Test weeks, Competitions, Reports) |
| Club admin | Dashboard, People, Teams, Reports, Club, Activity, Billing. Messages button | Dashboard, People, Teams, Reports, More (Messages, Club, Activity, Billing) |
| Platform admin | Dashboard, Requests, Clubs, Billing, Packages, Activity | Dashboard, Requests, Clubs, Billing, More (Packages, Activity) |

**Messages** is an icon button beside the bell wherever it is not a tab: a speech bubble with the number of unread messages and announcements (for a club admin, plus reported messages waiting for a look). It is a link to the role's Messages screen, not a sheet. On the coach's phone it is a tab with the same count; for a club admin on a phone it is the first row behind More. Where a link sits is declared on the link itself in `app-shell.tsx` (`desktop: "icon"`, `phone: "more"` or `"icon"`).

The bell is there for every role. It shows the number of unread notifications and opens the notifications sheet: the ten most recent as list rows (a blue dot and a bold title mean unread, then a relative time), "Mark all read" and "See all", which goes to `/notifications` (the full history grouped by day). A row is a link to the screen it is about and is marked read when followed. Where each kind of notification leads is decided in one file, `supabase/functions/_shared/notification-target.ts`.

The avatar opens the profile menu: on a phone the member's club first (mark and name), then Your account, Notification settings, Sign out (athletes also get Join a team).

Detail screens (an athlete, a plan, a test week) use `ScreenHeader` with `back`. A phone screen that takes over the whole view can also ask the shell for a back button and no tab bar by dispatching `pacelab:mobile-detail-mode` (see `app-shell.tsx`). A role's main destinations (the tabs, the athlete's plan and log included) never do this: the tab bar stays.

## Words

- Plain and short, written to the person: "Who needs a look", "Build a plan", "Nothing planned today".
- Sentence case. No exclamation marks. Never an em dash; use a comma, a full stop or brackets.
- Buttons say what happens ("Save plan", not "Submit").
- Empty states say what will appear and give the next step. Never show placeholder or made-up numbers.
- Errors say what went wrong and what to do next.

## Never

- A bordered or filled box around a section, a card inside a card, a drop shadow.
- A grey page, a dark or near-black panel, a gradient.
- Coloured stat tiles. More than one colour block on a screen.
- Pill badges for state outside a table. Uppercase labels. A label above a heading.
- A second primary button on the same screen.
- A sidebar. A marquee or ticker.
- Sideways scrolling of the page on a phone.
- Layout written by hand in a screen file.

## Older screens

Screens that have not been converted still import the v1 names. Those names now render the v2 look, so nothing is boxed while the work is in progress, but they are deprecated. Replace them when you convert a screen:

| Old | Use instead |
|---|---|
| `<div className="sk-page">` | `Screen` |
| `PageHeader` | `ScreenHeader` |
| `Panel` | `Section` with `List`, `DataTable` or plain content |
| `Stat tone="..."` in a grid | `StatStrip` with `Stat` (tone is ignored) |
| `ReadinessTag` | `ReadinessText` |
| `Initials` | `Avatar` |
| `EmptyState icon=... className="bg-..."` | `EmptyState` with title, body, action only |
| `sk-card`, `sk-well` | `Section` (both classes no longer draw a box) |
| `sk-row` | `List` and `ListRow` |
| `sk-btn sk-btn-*` | `Button` or `LinkButton` (`sk-btn-ink` is now outlined, `sk-btn-ghost` is the quiet variant) |
| `sk-field` on a bare input | `Field` with `Input` |
| `sk-h2`, `sk-h3`, `sk-label` in a screen | `Section` titles, `ListRow` titles |

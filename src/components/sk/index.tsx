/**
 * SKTR Coach kit, v2 "Clean lists". Read DESIGN.md first.
 * Screens are assembled from these parts and never hand-roll layout chrome.
 */
export { Screen, ScreenHeader, Section, Split, HeroBlock } from "./layout"
export {
  List,
  ListRow,
  StatStrip,
  Stat,
  DataTable,
  TableSub,
  DayStrip,
  EmptyState,
  Skeleton,
  SkeletonRows,
  ScreenSkeleton,
  type DataTableColumn,
  type DayStripDay,
} from "./lists"
export {
  StatusDot,
  StatusText,
  ReadinessText,
  Tag,
  Avatar,
  Meter,
  scoreTone,
  Notice,
  type StateTone,
  type TagTone,
} from "./status"
export { Button, LinkButton, HeroAction, Field, Input, Textarea, Select, Segmented, Tabs, InlineConfirm, type ButtonVariant, type ButtonSize } from "./controls"
export { Sheet, Dialog, notify, notifyError } from "./overlays"

// Deprecated v1 names. They keep older screens working on the v2 look. Replacements are noted on each.
export { PageHeader, Panel } from "./legacy"
export { ReadinessTag, Initials, type Tone } from "./status"

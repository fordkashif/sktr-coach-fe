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
export { NumberInput, TickButton, SetList, SetGroup, SetRow, EffortScale } from "./logging"
export { WeekPager, DayPicker, DayLabel, ActionBar, type DayPickerDay } from "./week"
export { TapScale, Stepper, Choices, type ChoiceOption } from "./inputs"
export { FactList, Fact } from "./facts"
export { Sparkline } from "./sparkline"
export { TrendLine, TrendBars, type TrendLinePoint, type ChartColor } from "./charts"
export { Mark } from "./mark"
export { NavTabs, type NavTabItem } from "./nav-tabs"
export { ActionRow, RowMenu, CheckRow, type RowMenuItem } from "./rows"
export { FormGrid, FormActions, SearchInput, DateRangeFields, type DateRangeValue } from "./form"
export { EditableRows, DayChecks, type EditableColumn } from "./editable-rows"
export { EntryGrid, SaveState, type EntryGridCell, type EntryGridColumn, type EntryGridRow, type SaveStateValue } from "./entry-grid"
export { PrintSheet, PrintHeading, PrintTable, PrintBreak, printPage } from "./print"
export { ConversationScreen, MessageList, MessageDay, MessageItem, MessageAction, ComposerBar } from "./messages"
export { PersonPicker, type PickerPerson } from "./person-picker"
export { FilterChips, FilterBar, type FilterChipOption } from "./filter-chips"
export { QrCode } from "./qr-code"
export { PasteList } from "./paste-list"

// Deprecated v1 names. They keep older screens working on the v2 look. Replacements are noted on each.
export { PageHeader, Panel } from "./legacy"
export { ReadinessTag, Initials, type Tone } from "./status"

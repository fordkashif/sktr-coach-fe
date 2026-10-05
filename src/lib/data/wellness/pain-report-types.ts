/** Pain and injury reports. Health information: see who may read it in SUPABASE_RLS_POLICY_MATRIX.md. */

export type PainTrainingImpact = "none" | "modified" | "cannot_train"
export type PainReportStatus = "open" | "resolved"

export type BodyRegionKey = "upper-legs" | "lower-legs" | "trunk" | "arms"

type BodyAreaDefinition = { base: string; label: string; region: BodyRegionKey; sided: boolean }

/**
 * Keep in step with the pain_reports_body_areas_known constraint in
 * supabase/migrations/20261008110000_pain_reports_and_athlete_profile_fields.sql.
 * A sided area is stored as "<base>_left" / "<base>_right".
 */
const BODY_AREA_DEFINITIONS: BodyAreaDefinition[] = [
  { base: "hip", label: "Hip", region: "upper-legs", sided: true },
  { base: "glute", label: "Glute", region: "upper-legs", sided: true },
  { base: "quad", label: "Quad", region: "upper-legs", sided: true },
  { base: "hamstring", label: "Hamstring", region: "upper-legs", sided: true },
  { base: "knee", label: "Knee", region: "upper-legs", sided: true },
  { base: "groin", label: "Groin", region: "upper-legs", sided: false },
  { base: "shin", label: "Shin", region: "lower-legs", sided: true },
  { base: "calf", label: "Calf", region: "lower-legs", sided: true },
  { base: "achilles", label: "Achilles", region: "lower-legs", sided: true },
  { base: "ankle", label: "Ankle", region: "lower-legs", sided: true },
  { base: "foot", label: "Foot", region: "lower-legs", sided: true },
  { base: "lower_back", label: "Lower back", region: "trunk", sided: false },
  { base: "upper_back", label: "Upper back", region: "trunk", sided: false },
  { base: "neck", label: "Neck", region: "trunk", sided: false },
  { base: "head", label: "Head", region: "trunk", sided: false },
  { base: "chest", label: "Chest", region: "trunk", sided: false },
  { base: "abdomen", label: "Abdomen", region: "trunk", sided: false },
  { base: "shoulder", label: "Shoulder", region: "arms", sided: true },
  { base: "elbow", label: "Elbow", region: "arms", sided: true },
  { base: "wrist_hand", label: "Wrist or hand", region: "arms", sided: true },
]

export type BodyArea = { key: string; label: string; region: BodyRegionKey }

export const BODY_REGIONS: Array<{ key: BodyRegionKey; label: string; areas: BodyArea[] }> = (
  [
    { key: "upper-legs", label: "Hips and thighs" },
    { key: "lower-legs", label: "Lower legs" },
    { key: "trunk", label: "Back and trunk" },
    { key: "arms", label: "Arms" },
  ] as Array<{ key: BodyRegionKey; label: string }>
).map((region) => ({
  ...region,
  areas: BODY_AREA_DEFINITIONS.filter((area) => area.region === region.key).flatMap((area) =>
    area.sided
      ? [
          { key: `${area.base}_left`, label: `Left ${area.label.toLowerCase()}`, region: region.key },
          { key: `${area.base}_right`, label: `Right ${area.label.toLowerCase()}`, region: region.key },
        ]
      : [{ key: area.base, label: area.label, region: region.key }],
  ),
}))

const BODY_AREA_BY_KEY = new Map(BODY_REGIONS.flatMap((region) => region.areas).map((area) => [area.key, area]))

export function isBodyAreaKey(key: string) {
  return BODY_AREA_BY_KEY.has(key)
}

export function bodyAreaLabel(key: string) {
  return BODY_AREA_BY_KEY.get(key)?.label ?? key.replace(/_/g, " ")
}

/** "Left hamstring, left knee" */
export function bodyAreasSummary(keys: string[]) {
  const labels = keys.map(bodyAreaLabel)
  return labels.map((label, index) => (index === 0 ? label : label.toLowerCase())).join(", ")
}

export const PAIN_SEVERITY_WORDS = ["Niggle", "Mild", "Moderate", "Bad", "Severe"]
export const PAIN_MAX_AREAS = 12
export const PAIN_NOTE_MAX_LENGTH = 500

export const PAIN_IMPACT_OPTIONS: Array<{ value: PainTrainingImpact; label: string; detail: string }> = [
  { value: "none", label: "No", detail: "I can train" },
  { value: "modified", label: "Partly", detail: "Needs changes" },
  { value: "cannot_train", label: "Yes", detail: "I cannot train" },
]

export function painImpactLabel(impact: PainTrainingImpact) {
  return impact === "cannot_train" ? "Cannot train" : impact === "modified" ? "Training modified" : "Training as normal"
}

export type PainReport = {
  id: string
  athleteId: string
  bodyAreas: string[]
  severity: number
  /** ISO date (YYYY-MM-DD). */
  startedOn: string
  trainingImpact: PainTrainingImpact
  note: string | null
  status: PainReportStatus
  resolvedAt: string | null
  createdAt: string
}

export type PainReportInput = {
  bodyAreas: string[]
  severity: number | null
  startedOn: string
  trainingImpact: PainTrainingImpact | null
  note: string | null
}

export type PainReportField = keyof PainReportInput

/** A report with the athlete's name, for staff lists. */
export type TeamPainReport = PainReport & { athleteName: string }

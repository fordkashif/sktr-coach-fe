/**
 * Who may read an athlete's health information as their parent or guardian.
 *
 * Health means wellness check-ins, pain and injury reports, medical notes and the reason an
 * athlete is unavailable. The rule, which the database enforces too (guardian_health_rule in
 * supabase/migrations/20261016090000_guardian_access.sql):
 *
 *   under 18                  visible to their guardians
 *   18 or older               hidden, unless the athlete switched sharing on in their profile
 *   no date of birth on file  hidden (and the coach is asked to add it)
 */

export type GuardianHealthRule = "minor" | "adult_opted_in" | "adult_not_opted_in" | "unknown_age"

export const ADULT_AGE = 18

function parseDay(value: string | null | undefined): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "")
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/** Whole years between a date of birth and a day (both "YYYY-MM-DD"). Null when either is missing, not a date, or the birth is in the future. */
export function ageOn(dateOfBirth: string | null | undefined, today: string): number | null {
  const born = parseDay(dateOfBirth)
  const now = parseDay(today)
  if (!born || !now) return null
  let age = now.year - born.year
  if (now.month < born.month || (now.month === born.month && now.day < born.day)) age -= 1
  return age < 0 ? null : age
}

export function guardianHealthRule(input: { dateOfBirth: string | null | undefined; adultOptIn: boolean; today: string }): GuardianHealthRule {
  const age = ageOn(input.dateOfBirth, input.today)
  if (age === null) return "unknown_age"
  if (age < ADULT_AGE) return "minor"
  return input.adultOptIn ? "adult_opted_in" : "adult_not_opted_in"
}

export function guardianSeesHealth(rule: GuardianHealthRule): boolean {
  return rule === "minor" || rule === "adult_opted_in"
}

export function asGuardianHealthRule(value: unknown): GuardianHealthRule {
  return value === "minor" || value === "adult_opted_in" || value === "adult_not_opted_in" ? value : "unknown_age"
}

/** One plain sentence about the rule, for the person reading it. */
export function healthRuleText(rule: GuardianHealthRule, firstName: string, reader: "guardian" | "coach" | "athlete"): string {
  if (reader === "athlete") {
    if (rule === "minor") return "You are under 18, so your parent or guardian can see your check-ins, pain reports and medical notes."
    if (rule === "adult_opted_in") return "You chose to share your check-ins, pain reports and medical notes with your parent or guardian."
    if (rule === "adult_not_opted_in") return "You are 18 or older, so your parent or guardian cannot see your check-ins, pain reports or medical notes unless you switch this on."
    return "Your date of birth is not on your profile, so your health information is hidden from your parent or guardian. Add it to set this."
  }
  if (reader === "coach") {
    if (rule === "minor") return `${firstName} is under 18, so guardians can see their check-ins, pain reports and medical notes.`
    if (rule === "adult_opted_in") return `${firstName} is 18 or older and chose to share health information with guardians.`
    if (rule === "adult_not_opted_in") return `${firstName} is 18 or older, so guardians do not see health information unless ${firstName} switches it on in their profile.`
    return `No date of birth on file, so guardians cannot see ${firstName}'s health information. Add the date of birth to the athlete's details.`
  }
  if (rule === "minor") return `${firstName} is under 18, so you can see their check-ins, pain reports and medical notes.`
  if (rule === "adult_opted_in") return `${firstName} chose to share their check-ins, pain reports and medical notes with you.`
  if (rule === "adult_not_opted_in") return `${firstName} is 18 or older. Their health information is theirs to share, and they have not switched it on.`
  return `The club has no date of birth for ${firstName}, so health information is hidden. Ask the coach to add it.`
}

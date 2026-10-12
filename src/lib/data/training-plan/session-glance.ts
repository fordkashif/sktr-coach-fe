/**
 * A session at a glance: its parts and how many exercises, instead of every exercise in a row.
 * Kash, Oct 12: the home card and the week list read like a wall of words. The detail is one tap
 * away (the session itself, or the day in the plan).
 */

/** "Strength: Hang snatch 5 x 3 @ 55lbs | Back squat ..." -> "Strength". A preview with no colon is the name. */
export function blockNameFromPreview(preview: string): string {
  const cut = preview.indexOf(": ")
  return (cut > 0 ? preview.slice(0, cut) : preview).trim()
}

/** "Strength, Core and Sprints". Repeats are dropped; past `max` names: "A, B, C and 2 more". */
export function joinBlockNames(names: string[], max = 3): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  if (unique.length === 0) return ""
  if (unique.length > max) return `${unique.slice(0, max).join(", ")} and ${unique.length - max} more`
  if (unique.length === 1) return unique[0]
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`
}

export function exerciseCount(count: number): string {
  return count === 1 ? "1 exercise" : `${count} exercises`
}

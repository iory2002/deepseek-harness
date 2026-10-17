/**
 * The companion's clock: how long an owed answer or an idle Host has to last
 * before her mood changes, and which local hours count as night. These are her
 * pacing, not deployment options, so they are module constants rather than
 * settings — the same reason `PET_CELEBRATION_MS` lives beside its window.
 * @module
 */

/** A pending answer waits this long before she starts asking about it. */
export const PET_WAIT_ANNOYED_MS = 45_000
/** A pending answer waits this long before she stops being polite about it. */
export const PET_WAIT_DESPERATE_MS = 180_000
/** An idle Host this long tilts her random motions toward boredom. */
export const PET_IDLE_BORED_MS = 90_000
/** An idle Host this long puts her to sleep. */
export const PET_IDLE_ASLEEP_MS = 300_000
/** First local hour counted as night. */
export const PET_NIGHT_FROM_HOUR = 23
/** First local hour no longer counted as night. */
export const PET_NIGHT_TO_HOUR = 6

/**
 * Whether a local time falls in the companion's night window. The window wraps
 * midnight, so crossing it needs no special case: the comparison is on the hour.
 * @param date - Local time to classify.
 * @returns whether the hour is at or after {@link PET_NIGHT_FROM_HOUR}, or before {@link PET_NIGHT_TO_HOUR}.
 */
export function isPetNight(date: Date): boolean {
  const hour = date.getHours()
  return hour >= PET_NIGHT_FROM_HOUR || hour < PET_NIGHT_TO_HOUR
}

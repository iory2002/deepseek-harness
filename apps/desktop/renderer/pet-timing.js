/**
 * Renderer copy of the mood thresholds. The companion renderer loads over
 * `file://` and cannot import the shell's TypeScript, so these numbers are
 * duplicated here; `pet-timing.spec.ts` fails if the two copies drift.
 */

/** A pending answer waits this long before she starts asking about it. */
export const PET_WAIT_ANNOYED_MS = 45_000
/** A pending answer waits this long before she stops being polite about it. */
export const PET_WAIT_DESPERATE_MS = 180_000
/** An idle Host this long tilts her random motions toward boredom. */
export const PET_IDLE_BORED_MS = 90_000
/** An idle Host this long puts her to sleep. */
export const PET_IDLE_ASLEEP_MS = 300_000

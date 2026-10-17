/**
 * Type surface for `actions.js`, which the companion loads as plain ESM over
 * `file://`. Keep this in step with the implementation.
 */

/** One playable whole-body motion. */
export interface ActionSpec {
  /** Milliseconds one iteration takes. */
  readonly durationMs: number
  /** Iteration count; `Infinity` for ambient loops. */
  readonly iterations: number
  /** WAAPI easing string. */
  readonly easing: string
  /** Fill mode; defaults to `none` when absent. */
  readonly fill?: string
  /** Keyframes, each a property map plus an optional offset. */
  readonly keyframes: ReadonlyArray<Record<string, string | number>>
}

/** Every motion the director can name. */
export declare const ACTIONS: Record<string, ActionSpec>
/** Resting transform applied when nothing is playing. */
export declare const REST: string

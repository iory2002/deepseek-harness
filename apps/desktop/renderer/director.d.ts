/**
 * Type surface for `director.js`, which the companion loads as plain ESM over
 * `file://` and therefore cannot ship as TypeScript. Keep this in step with the
 * implementation: the specs type-check against it.
 */

/** One motion the performer should play. */
export interface DirectorCue {
  /** Key into `actions.js`, or null for rest. */
  action: string | null
  /** Pose the window should show. */
  pose: string
  /** Symbol-band occupant, or null. */
  symbol: string | null
  /** Side-band prop, or null. */
  prop: string | null
  /** Relative urgency of this cue. */
  priority: number
  /** Milliseconds the action runs. */
  durationMs: number
  /** Whether this cue replaced another one. */
  interrupt: boolean
}

/** Everything the director remembers between events. */
export interface DirectorState {
  phase: string
  waits: number
  waitSeconds: number
  idleSeconds: number
  night: boolean
  celebrating: boolean
  hover: boolean
  pressed: boolean
  dragging: boolean
  card: boolean
  reducedMotion: boolean
  random: { action: string; until: number } | null
  nextRandomAt: number
  releaseUntil: number
  current: { action: string | null; pose: string; symbol: string | null; prop: string | null; priority: number } | null
}

/** Injected clock and randomness. */
export interface DirectorContext {
  now: number
  random: () => number
}

/** Result of applying one event. */
export interface DirectorResult {
  state: DirectorState
  cue: DirectorCue | null
}

/** How long the pointer must rest on the window before she leans toward it. */
export declare const HOVER_DELAY_MS: number
/** Shortest gap between two random motions. */
export declare const RANDOM_MIN_MS: number
/** Longest gap between two random motions. */
export declare const RANDOM_MAX_MS: number
/** Relative urgency by trigger family. */
export declare const PRIORITY: Record<string, number>
/** Random motions and their weights. */
export declare const RANDOM_POOL: ReadonlyArray<{ action: string; weight: number }>

/** @returns a fresh director state. */
export declare function initialState(): DirectorState

/**
 * Apply one event.
 * @param state - Current director state.
 * @param event - Presentation, pointer fact, or tick.
 * @param context - Injected clock and randomness.
 * @returns next state and the cue to play, if the motion changed.
 */
export declare function reduce(state: DirectorState, event: Record<string, unknown>, context: DirectorContext): DirectorResult

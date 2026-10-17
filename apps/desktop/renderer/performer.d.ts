/**
 * Type surface for `performer.js`, which the companion loads as plain ESM over
 * `file://`. Keep this in step with the implementation: the specs type-check
 * against it.
 */

import type { DirectorCue } from './director'

/** The node whose data attributes drive pose, symbol, and prop selection. */
export interface PerformerRoot {
  readonly dataset: Record<string, string>
}

/** A node the performer moves or writes custom properties to. */
export interface PerformerTarget {
  readonly style: {
    transform: string
    setProperty(name: string, value: string): void
  }
}

/** Animation factory the performer calls; injectable for tests. */
export type PerformerAnimate = (target: PerformerTarget, keyframes: unknown, options: Record<string, unknown>) => { cancel(): void }

/** Collaborators for one companion document. */
export interface PerformerOptions {
  readonly root: PerformerRoot
  readonly body: PerformerTarget
  readonly stage: PerformerTarget
  readonly animate?: PerformerAnimate
}

/** Presentation facts that change how a cue looks. */
export interface PerformerPresentation {
  night: boolean
  reducedMotion: boolean
}

/** What the renderer can ask the performer to do. */
export interface Performer {
  /**
   * Paint one cue.
   * @param cue - Pose, symbol, prop, and action to show.
   * @param presentation - Night and reduced-motion facts.
   */
  apply(cue: Pick<DirectorCue, 'action' | 'pose' | 'symbol' | 'prop'>, presentation: PerformerPresentation): void
  /** Stop every animation. */
  dispose(): void
}

/**
 * Build the performer for one companion document.
 * @param options - Nodes to paint plus the animation factory.
 * @returns the performer.
 */
export declare function createPerformer(options: PerformerOptions): Performer

/**
 * Applies one director cue to the companion document. Each element owns exactly
 * one transform: `#body` carries the always-on breathing and sway, `#stage`
 * carries whatever the cue asks for. Keeping them on separate elements is what
 * stops a reaction from overwriting the ambient motion.
 */

import { ACTIONS, REST } from './actions.js'

/** @returns WAAPI options for one action. */
function options(spec) {
  return {
    duration: spec.durationMs,
    iterations: spec.iterations,
    easing: spec.easing,
    fill: spec.fill ?? 'none',
  }
}

/**
 * Build the performer for one companion document.
 * @param elements - `root`, `body`, and `stage` nodes.
 * @param elements.root - Element carrying the `data-pose`/`data-symbol`/`data-prop` attributes.
 * @param elements.body - Element that owns the ambient breathing animation.
 * @param elements.stage - Element that owns the cue animation.
 * @param animate - Animation factory, injectable so tests can audit calls.
 * @returns the performer's `apply` entry point and a `dispose` that stops motion.
 */
export function createPerformer({ root, body, stage, animate = (element, keyframes, timing) => element.animate(keyframes, timing) }) {
  let ambient = null
  let current = null
  let lastAction = null

  /** Drop every running animation and return the stage to its resting transform. */
  function stop() {
    ambient?.cancel()
    ambient = null
    current?.cancel()
    current = null
    lastAction = null
    stage.style.transform = REST
  }

  /**
   * Play one action on the stage, restarting one-shots and leaving loops alone.
   * @param action - Key into {@link ACTIONS}, or null for rest.
   * @param context - Presentation facts that change the motion's look.
   * @param context.reducedMotion - Whether movement must not run at all.
   */
  function play(action, { reducedMotion }) {
    if (reducedMotion) {
      stop()
      return
    }
    if (ambient === null) ambient = animate(body, ACTIONS.breatheSway.keyframes, options(ACTIONS.breatheSway))
    const spec = action === null ? undefined : ACTIONS[action]
    if (spec === undefined) {
      current?.cancel()
      current = null
      lastAction = null
      stage.style.transform = REST
      return
    }
    if (action === lastAction && spec.iterations !== 1) return
    current?.cancel()
    stage.style.transform = REST
    current = animate(stage, spec.keyframes, options(spec))
    lastAction = action
  }

  return {
    /**
     * Paint one cue.
     * @param cue - Director cue: pose, symbol, prop, and action.
     * @param presentation - `night` and `reducedMotion` facts for this frame.
     */
    apply(cue, presentation) {
      root.dataset.pose = cue.pose
      root.dataset.symbol = cue.symbol ?? 'none'
      root.dataset.prop = cue.prop ?? 'none'
      root.style.setProperty('--amp', presentation.night ? '0.5' : '1')
      play(cue.action, presentation)
    },
    /** Stop everything; used when the document is torn down. */
    dispose: stop,
  }
}

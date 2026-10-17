/**
 * The companion's motion vocabulary. Every entry is a whole-body transform
 * sequence: the artwork is a flat frame per pose, so limbs cannot move on their
 * own. Amplitudes multiply by `--amp`, which the renderer halves at night.
 */

/** One playable motion. */
export const ACTIONS = {
  // Ambient body motion, installed once and left running.
  breatheSway: {
    durationMs: 5_200,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'rotate(calc(-0.8deg * var(--amp))) scale(1)' },
      { offset: 0.35, transform: 'rotate(calc(0.2deg * var(--amp))) scale(1.012)' },
      { offset: 0.7, transform: 'rotate(calc(0.8deg * var(--amp))) scale(1)' },
      { transform: 'rotate(calc(-0.8deg * var(--amp))) scale(1)' },
    ],
  },

  // Phase motion.
  tidy: {
    durationMs: 2_400,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'translateY(0) rotate(0deg)' },
      { offset: 0.4, transform: 'translateY(calc(2px * var(--amp))) rotate(calc(-1deg * var(--amp)))' },
      { offset: 0.7, transform: 'translateY(0) rotate(0deg)' },
      { transform: 'translateY(0) rotate(0deg)' },
    ],
  },
  pace: {
    durationMs: 16_000,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'translate(0, 0) rotate(0deg)' },
      { offset: 0.08, transform: 'translate(calc(-14px * var(--amp)), 0) rotate(calc(-1.4deg * var(--amp)))' },
      { offset: 0.18, transform: 'translate(calc(-6px * var(--amp)), 0) rotate(calc(1.4deg * var(--amp)))' },
      { offset: 0.3, transform: 'translate(calc(6px * var(--amp)), 0) rotate(calc(-1.4deg * var(--amp)))' },
      { offset: 0.42, transform: 'translate(calc(14px * var(--amp)), 0) rotate(calc(1.4deg * var(--amp)))' },
      { offset: 0.54, transform: 'translate(calc(2px * var(--amp)), 0) rotate(calc(-1.4deg * var(--amp)))' },
      { offset: 0.62, transform: 'translate(0, -2px) rotate(0deg)' },
      { offset: 0.8, transform: 'translate(0, 0) rotate(0deg)' },
      { transform: 'translate(0, 0) rotate(0deg)' },
    ],
  },
  busyJitter: {
    durationMs: 3_600,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'translate(0, 0) rotate(0deg)' },
      { offset: 0.06, transform: 'translate(calc(-0.8px * var(--amp)), calc(-1px * var(--amp))) rotate(calc(-0.6deg * var(--amp)))' },
      { offset: 0.14, transform: 'translate(calc(0.8px * var(--amp)), 0) rotate(calc(0.6deg * var(--amp)))' },
      { offset: 0.24, transform: 'translate(calc(-0.8px * var(--amp)), calc(-1.4px * var(--amp))) rotate(calc(-0.5deg * var(--amp)))' },
      { offset: 0.36, transform: 'translate(0, 0) rotate(0deg)' },
      { offset: 0.5, transform: 'translate(0, calc(-4px * var(--amp))) rotate(0deg) scale(1.006)' },
      { offset: 0.62, transform: 'translate(0, 0) rotate(0deg)' },
      { offset: 0.8, transform: 'translate(calc(0.4px * var(--amp)), calc(-0.6px * var(--amp))) rotate(calc(0.2deg * var(--amp)))' },
      { transform: 'translate(0, 0) rotate(0deg)' },
    ],
  },
  waitWave: {
    durationMs: 1_200,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'rotate(calc(-1.2deg * var(--amp))) translateY(0)' },
      { transform: 'rotate(calc(1.2deg * var(--amp))) translateY(calc(-4px * var(--amp)))' },
      { transform: 'rotate(calc(-1.2deg * var(--amp))) translateY(0)' },
    ],
  },
  waitAnnoyed: {
    durationMs: 1_000,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'rotate(calc(-2deg * var(--amp))) translateY(0)' },
      { transform: 'rotate(calc(2deg * var(--amp))) translateY(calc(-6px * var(--amp)))' },
      { transform: 'rotate(calc(-2deg * var(--amp))) translateY(0)' },
    ],
  },
  waitDesperate: {
    durationMs: 800,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'rotate(calc(-3deg * var(--amp))) translateY(calc(-2px * var(--amp)))' },
      { transform: 'rotate(calc(3deg * var(--amp))) translateY(calc(-9px * var(--amp)))' },
      { transform: 'rotate(calc(-3deg * var(--amp))) translateY(calc(-2px * var(--amp)))' },
    ],
  },
  glance: {
    durationMs: 4_400,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'rotate(0deg)' },
      { offset: 0.16, transform: 'rotate(calc(-6deg * var(--amp)))' },
      { offset: 0.34, transform: 'rotate(calc(-6deg * var(--amp)))' },
      { offset: 0.5, transform: 'rotate(0deg)' },
      { offset: 0.66, transform: 'rotate(calc(6deg * var(--amp)))' },
      { offset: 0.84, transform: 'rotate(calc(6deg * var(--amp)))' },
      { transform: 'rotate(0deg)' },
    ],
  },
  hum: {
    durationMs: 3_000,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'translateY(0) rotate(0deg)' },
      { offset: 0.5, transform: 'translateY(calc(-4px * var(--amp))) rotate(calc(1.6deg * var(--amp)))' },
      { transform: 'translateY(0) rotate(0deg)' },
    ],
  },
  lieDown: {
    durationMs: 7_000,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'translateY(0) scale(1)' },
      { offset: 0.5, transform: 'translateY(calc(-1.5px * var(--amp))) scale(1.004)' },
      { transform: 'translateY(0) scale(1)' },
    ],
  },

  // One-shot reactions.
  celebrate: {
    durationMs: 2_600,
    iterations: 1,
    easing: 'ease-out',
    keyframes: [
      { transform: 'translateY(0) scale(1)' },
      { offset: 0.12, transform: 'translateY(-16px) scale(1.02)' },
      { offset: 0.26, transform: 'translateY(0) scale(1)' },
      { offset: 0.4, transform: 'translateY(-9px) scale(1.01)' },
      { offset: 0.54, transform: 'translateY(0) scale(1)' },
      { offset: 0.68, transform: 'translateY(-4px) scale(1)' },
      { transform: 'translateY(0) scale(1)' },
    ],
  },
  hoverLean: {
    durationMs: 220,
    iterations: 1,
    easing: 'ease-out',
    fill: 'forwards',
    keyframes: [
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-2px) scale(1.02)' },
    ],
  },
  pressSquash: {
    durationMs: 120,
    iterations: 1,
    easing: 'ease-out',
    fill: 'forwards',
    keyframes: [
      { transform: 'scale(1)' },
      { transform: 'scale(0.98)' },
    ],
  },
  dragFlail: {
    durationMs: 600,
    iterations: Number.POSITIVE_INFINITY,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'rotate(calc(-2deg * var(--amp))) translateY(0)' },
      { transform: 'rotate(calc(2deg * var(--amp))) translateY(calc(-3px * var(--amp)))' },
      { transform: 'rotate(calc(-2deg * var(--amp))) translateY(0)' },
    ],
  },
  releaseBounce: {
    durationMs: 220,
    iterations: 1,
    easing: 'ease-out',
    keyframes: [
      { transform: 'scale(0.98)' },
      { offset: 0.5, transform: 'scale(1.04)' },
      { transform: 'scale(1)' },
    ],
  },

  // Random pool.
  peek: {
    durationMs: 1_600,
    iterations: 1,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'rotate(0deg)' },
      { offset: 0.4, transform: 'rotate(calc(-5deg * var(--amp)))' },
      { offset: 0.7, transform: 'rotate(calc(5deg * var(--amp)))' },
      { transform: 'rotate(0deg)' },
    ],
  },
  apron: {
    durationMs: 1_800,
    iterations: 1,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'translateY(0) rotate(0deg)' },
      { offset: 0.45, transform: 'translateY(calc(2px * var(--amp))) rotate(calc(2deg * var(--amp)))' },
      { transform: 'translateY(0) rotate(0deg)' },
    ],
  },
  hop: {
    durationMs: 900,
    iterations: 1,
    easing: 'ease-out',
    keyframes: [
      { transform: 'translateY(0) scale(1)' },
      { offset: 0.4, transform: 'translateY(calc(-12px * var(--amp))) scale(1.02)' },
      { transform: 'translateY(0) scale(1)' },
    ],
  },
  stretch: {
    durationMs: 2_400,
    iterations: 1,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'scaleY(1) translateY(0)' },
      { offset: 0.45, transform: 'scaleY(1.04) translateY(calc(-2px * var(--amp)))' },
      { offset: 0.8, transform: 'scaleY(1) translateY(0)' },
      { transform: 'scaleY(1) translateY(0)' },
    ],
  },
  peekLie: {
    durationMs: 1_400,
    iterations: 1,
    easing: 'ease-in-out',
    keyframes: [
      { transform: 'translateY(0) rotate(0deg)' },
      { offset: 0.5, transform: 'translateY(calc(3px * var(--amp))) rotate(calc(-2deg * var(--amp)))' },
      { transform: 'translateY(0) rotate(0deg)' },
    ],
  },
}

/** Resting transform, played when a reaction ends or motion is reduced. */
export const REST = 'translate(0, 0) rotate(0deg) scale(1)'

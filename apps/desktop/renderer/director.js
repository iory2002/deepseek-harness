/**
 * Pure decision layer for the companion. It maps what the shell reports and
 * what the pointer does onto the motion vocabulary in `actions.js`; it never
 * touches the DOM and never reads a clock, so every rule here is a plain
 * function of (state, event, now, random).
 */

import { ACTIONS } from './actions.js'
import {
  PET_IDLE_ASLEEP_MS,
  PET_IDLE_BORED_MS,
  PET_WAIT_ANNOYED_MS,
  PET_WAIT_DESPERATE_MS,
} from './pet-timing.js'

/** How long the pointer must rest on the window before she leans toward it. */
export const HOVER_DELAY_MS = 200
/** Shortest gap between two random motions. */
export const RANDOM_MIN_MS = 6_000
/** Longest gap between two random motions. */
export const RANDOM_MAX_MS = 14_000

/**
 * Relative urgency. Resolution order is explicit rather than numeric: a random
 * motion only fills a gap, so it never wins by comparing priorities.
 */
export const PRIORITY = {
  celebrate: 100,
  drag: 80,
  press: 70,
  hover: 60,
  ambient: 40,
  random: 10,
}

/** Random motions, and how likely each is when the phase allows one. */
export const RANDOM_POOL = [
  { action: 'peek', weight: 3 },
  { action: 'apron', weight: 3 },
  { action: 'hop', weight: 2 },
  { action: 'stretch', weight: 2 },
  { action: 'peekLie', weight: 1 },
]

/** Chance a due random motion actually plays, per phase. */
const PHASE_WEIGHT = {
  starting: 0,
  idle: 1,
  working: 0.35,
  waiting: 0.25,
  subagent: 0.6,
  offline: 0,
  background: 0.8,
}

/** A state that owns the sprite outright, so a random motion must wait. */
function blocked(state) {
  return state.celebrating || state.dragging || state.pressed || state.hover || state.card
}

/** @returns a fresh, JSON-serializable director state. */
export function initialState() {
  return {
    phase: 'starting',
    waits: 0,
    waitSeconds: 0,
    idleSeconds: 0,
    night: false,
    celebrating: false,
    hover: false,
    pressed: false,
    dragging: false,
    card: false,
    reducedMotion: false,
    random: null,
    nextRandomAt: RANDOM_MIN_MS,
    releaseUntil: 0,
    current: null,
  }
}

/** The motion one phase settles into when nothing else is happening. */
function phaseCue(state) {
  switch (state.phase) {
    case 'starting':
      return { action: 'tidy', pose: 'stand', symbol: null, prop: null }
    case 'working':
      return { action: 'busyJitter', pose: 'stand', symbol: 'sweat', prop: 'cup' }
    case 'waiting': {
      const waited = state.waitSeconds * 1_000
      const action = waited >= PET_WAIT_DESPERATE_MS
        ? 'waitDesperate'
        : waited >= PET_WAIT_ANNOYED_MS ? 'waitAnnoyed' : 'waitWave'
      return { action, pose: 'work', symbol: 'question', prop: 'clock' }
    }
    case 'subagent':
      return { action: 'glance', pose: 'stand', symbol: null, prop: null }
    case 'background':
      return { action: 'hum', pose: 'stand', symbol: 'note', prop: null }
    case 'offline':
      return { action: null, pose: 'stand', symbol: null, prop: null }
    case 'idle':
    default: {
      const asleep = state.idleSeconds * 1_000 >= PET_IDLE_ASLEEP_MS
      return asleep
        ? { action: 'lieDown', pose: 'idle', symbol: 'zzz', prop: null }
        : { action: 'pace', pose: 'stand', symbol: null, prop: null }
    }
  }
}

/** Pick one pool entry, biased toward stretching when she is bored or it is late. */
function pickRandom(state, random) {
  const tired = state.night || state.idleSeconds * 1_000 >= PET_IDLE_BORED_MS
  const weighted = RANDOM_POOL.map(entry => ({
    action: entry.action,
    weight: entry.action === 'stretch' && tired ? entry.weight + 4 : entry.weight,
  }))
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0)
  let ticket = random() * total
  for (const entry of weighted) {
    ticket -= entry.weight
    if (ticket < 0) return entry.action
  }
  return weighted[weighted.length - 1].action
}

/** @returns a delay inside the random window, using the injected random source. */
function nextGap(random) {
  return RANDOM_MIN_MS + Math.floor(random() * (RANDOM_MAX_MS - RANDOM_MIN_MS))
}

/** Whether two resolutions ask for the same presentation. */
function same(left, right) {
  if (left === null) return false
  return left.action === right.action && left.pose === right.pose
    && left.symbol === right.symbol && left.prop === right.prop
}

/**
 * Resolve the state into the motion that should be playing.
 * @param state - Director state after the event.
 * @param now - Injected clock, in milliseconds.
 * @returns the chosen cue, before it is compared with what is already playing.
 */
function resolve(state, now) {
  let cue
  if (state.celebrating) {
    cue = { action: 'celebrate', pose: 'happy', symbol: 'mark', prop: null, priority: PRIORITY.celebrate }
  } else if (state.dragging) {
    cue = { action: 'dragFlail', pose: 'work', symbol: 'sweat', prop: null, priority: PRIORITY.drag }
  } else if (state.releaseUntil > now) {
    cue = { ...phaseCue(state), action: 'releaseBounce', priority: PRIORITY.drag }
  } else if (state.pressed) {
    cue = { ...phaseCue(state), action: 'pressSquash', priority: PRIORITY.press }
  } else if (state.hover) {
    cue = { ...phaseCue(state), action: 'hoverLean', priority: PRIORITY.hover }
  } else if (state.random !== null && state.random.until > now) {
    cue = { action: state.random.action, pose: 'stand', symbol: null, prop: null, priority: PRIORITY.random }
  } else {
    const base = phaseCue(state)
    cue = { ...base, priority: PRIORITY.ambient }
    if (cue.prop === null && state.night) cue.prop = 'lamp'
  }
  // An open counts card owns the space above her: the numbers come first.
  if (state.card) cue = { ...cue, symbol: null, prop: null }
  return cue
}

/**
 * Apply one event.
 * @param state - Current director state.
 * @param event - What happened: a presentation, a pointer fact, or a tick.
 * @param context - Injected `now` and `random`, so tests control both.
 * @returns the next state and, when the motion changes, the cue to play.
 */
export function reduce(state, event, context) {
  const now = context.now
  const random = context.random
  const next = { ...state }

  switch (event.type) {
    case 'presentation': {
      const presentation = event.presentation
      next.phase = presentation.status.phase
      next.waits = presentation.status.waits
      next.waitSeconds = numberOr(presentation.waitSeconds, 0)
      next.idleSeconds = numberOr(presentation.idleSeconds, 0)
      next.celebrating = presentation.celebrating === true
      next.night = presentation.night === true
      break
    }
    case 'hover':
      next.hover = event.value === true
      break
    case 'press':
      next.pressed = event.value === true
      break
    case 'drag':
      next.dragging = event.value === true
      break
    case 'release':
      next.dragging = false
      next.releaseUntil = now + ACTIONS.releaseBounce.durationMs
      break
    case 'card':
      next.card = event.value === true
      break
    case 'motion':
      next.reducedMotion = event.value === true
      break
    case 'tick':
      break
    default:
      return { state, cue: null }
  }

  if (now >= next.nextRandomAt && !next.reducedMotion) {
    next.nextRandomAt = now + nextGap(random)
    if (!blocked(next) && random() < (PHASE_WEIGHT[next.phase] ?? 0)) {
      const action = pickRandom(next, random)
      next.random = { action, until: now + ACTIONS[action].durationMs }
    }
  }
  if (next.random !== null && next.random.until <= now) next.random = null

  const cue = resolve(next, now)
  next.current = same(state.current, cue)
    ? state.current
    : { action: cue.action, pose: cue.pose, symbol: cue.symbol, prop: cue.prop, priority: cue.priority }
  const changed = !same(state.current, cue)
  return {
    state: next,
    cue: changed
      ? { ...cue, durationMs: ACTIONS[cue.action]?.durationMs ?? 0, interrupt: state.current !== null }
      : null,
  }
}

/** @returns the value when it is a usable number, else the fallback. */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

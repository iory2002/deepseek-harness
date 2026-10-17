import { describe, expect, it } from 'vitest'
import { initialState, reduce, RANDOM_MIN_MS } from '../renderer/director.js'

/** Presentation payload the shell pushes; only the fields the director reads. */
function presentation(overrides: Record<string, unknown> = {}) {
  return {
    status: { phase: 'working', agents: 1, subagents: 0, jobs: 0, waits: 0, completed: 0 },
    celebrating: false,
    waitSeconds: 0,
    idleSeconds: 0,
    night: false,
    ...overrides,
  }
}

/** Drive one event from a fresh state and return the cue it produced. */
function cueFor(event: Record<string, unknown>, context: { now?: number; random?: () => number } = {}) {
  const result = reduce(initialState(), event, { now: context.now ?? 0, random: context.random ?? (() => 0) })
  return result.cue
}

/** A state that has already painted one presentation, so the next cue is a change. */
function seeded(payload: Record<string, unknown>) {
  return reduce(initialState(), { type: 'presentation', presentation: payload }, { now: 0, random: () => 0 }).state
}

describe('companion director', () => {
  it('settles each phase into its own motion and pose', () => {
    expect(cueFor({ type: 'presentation', presentation: presentation() }))
      .toMatchObject({ action: 'busyJitter', pose: 'stand', symbol: 'sweat', prop: 'cup' })
    expect(cueFor({ type: 'presentation', presentation: presentation({ status: { phase: 'waiting', waits: 1 } }) }))
      .toMatchObject({ action: 'waitWave', pose: 'work', symbol: 'question', prop: 'clock' })
    expect(cueFor({ type: 'presentation', presentation: presentation({ status: { phase: 'subagent' } }) }))
      .toMatchObject({ action: 'glance', pose: 'stand' })
    expect(cueFor({ type: 'presentation', presentation: presentation({ status: { phase: 'background' } }) }))
      .toMatchObject({ action: 'hum', symbol: 'note' })
    expect(cueFor({ type: 'presentation', presentation: presentation({ status: { phase: 'starting' } }) }))
      .toMatchObject({ action: 'tidy', pose: 'stand' })
  })

  it('escalates a pending answer at the two wait thresholds', () => {
    const waiting = { phase: 'waiting', waits: 1 }
    expect(cueFor({ type: 'presentation', presentation: presentation({ status: waiting, waitSeconds: 44 }) }))
      .toMatchObject({ action: 'waitWave' })
    expect(cueFor({ type: 'presentation', presentation: presentation({ status: waiting, waitSeconds: 45 }) }))
      .toMatchObject({ action: 'waitAnnoyed' })
    expect(cueFor({ type: 'presentation', presentation: presentation({ status: waiting, waitSeconds: 180 }) }))
      .toMatchObject({ action: 'waitDesperate' })
  })

  it('lies down once the host has been idle long enough, and brings a lamp at night', () => {
    expect(cueFor({ type: 'presentation', presentation: presentation({ status: { phase: 'idle' }, idleSeconds: 299 }) }))
      .toMatchObject({ action: 'pace', pose: 'stand', symbol: null })
    expect(cueFor({
      type: 'presentation',
      presentation: presentation({ status: { phase: 'idle' }, idleSeconds: 300, night: true }),
    })).toMatchObject({ action: 'lieDown', pose: 'idle', symbol: 'zzz', prop: 'lamp' })
  })

  it('puts the celebration above every pointer reaction', () => {
    const celebrating = cueFor({
      type: 'presentation',
      presentation: presentation({ celebrating: true }),
    })
    expect(celebrating).toMatchObject({ action: 'celebrate', pose: 'happy', symbol: 'mark' })

    const state = seeded(presentation({ celebrating: true }))
    const hovering = reduce({ ...state, hover: true, dragging: true }, { type: 'hover', value: true }, { now: 0, random: () => 0 })
    expect(hovering.cue).toBeNull()
  })

  it('reacts to the pointer in priority order', () => {
    expect(cueFor({ type: 'presentation', presentation: presentation({ status: { phase: 'waiting', waits: 1 } }) }))
      .toMatchObject({ action: 'waitWave' })

    const hovering = reduce(
      { ...initialState(), phase: 'waiting' },
      { type: 'hover', value: true },
      { now: 0, random: () => 0 },
    )
    expect(hovering.cue).toMatchObject({ action: 'hoverLean', pose: 'work' })

    const pressed = reduce(hovering.state, { type: 'press', value: true }, { now: 0, random: () => 0 })
    expect(pressed.cue).toMatchObject({ action: 'pressSquash' })

    const dragging = reduce(pressed.state, { type: 'drag', value: true }, { now: 0, random: () => 0 })
    expect(dragging.cue).toMatchObject({ action: 'dragFlail', pose: 'work' })

    const released = reduce(dragging.state, { type: 'release' }, { now: 0, random: () => 0 })
    expect(released.cue).toMatchObject({ action: 'releaseBounce', pose: 'work' })
  })

  it('only plays a random motion in a gap, never over a pointer reaction', () => {
    const idle = seeded(presentation({ status: { phase: 'idle' } }))
    const played = reduce(idle, { type: 'tick' }, { now: RANDOM_MIN_MS, random: () => 0 })
    expect(played.cue).toMatchObject({ action: 'peek' })

    const hovered = reduce(idle, { type: 'hover', value: true }, { now: RANDOM_MIN_MS - 1, random: () => 0 })
    const ticked = reduce(hovered.state, { type: 'tick' }, { now: RANDOM_MIN_MS, random: () => 0 })
    expect(ticked.state.random).toBeNull()
    expect(ticked.cue).toBeNull()
  })

  it('keeps random motions away from a working host', () => {
    // Weight 0.35: a roll above it skips the motion even when the timer is due.
    const working = seeded(presentation())
    const skipped = reduce(working, { type: 'tick' }, { now: RANDOM_MIN_MS, random: () => 0.9 })
    expect(skipped.cue).toBeNull()
  })

  it('clears the symbol and prop while the counts card is open', () => {
    const working = seeded(presentation())
    const opened = reduce(working, { type: 'card', value: true }, { now: 0, random: () => 0 })
    expect(opened.cue).toMatchObject({ action: 'busyJitter', symbol: null, prop: null })
  })

  it('stops starting random motions under reduced motion', () => {
    const reduced = { ...seeded(presentation({ status: { phase: 'idle' } })), reducedMotion: true }
    const result = reduce(reduced, { type: 'tick' }, { now: RANDOM_MIN_MS, random: () => 0 })
    expect(result.cue).toBeNull()
    expect(result.state.random).toBeNull()
  })

  it('reports a cue only when the motion actually changes', () => {
    const first = reduce(initialState(), { type: 'presentation', presentation: presentation() }, { now: 0, random: () => 0 })
    expect(first.cue).not.toBeNull()
    const again = reduce(first.state, { type: 'presentation', presentation: presentation() }, { now: 1_000, random: () => 0 })
    expect(again.cue).toBeNull()
  })
})

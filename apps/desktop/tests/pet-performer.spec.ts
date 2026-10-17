import { describe, expect, it } from 'vitest'
import { REST } from '../renderer/actions.js'
import { createPerformer } from '../renderer/performer.js'

/** A node with the two faces the performer touches. */
function fakeElement() {
  const properties: Record<string, string> = {}
  return {
    dataset: {} as Record<string, string>,
    properties,
    style: {
      transform: '',
      setProperty: (key: string, value: string) => { properties[key] = value },
    },
  }
}

/** Records every animation the performer starts or stops. */
function recorder() {
  const started: Array<{ target: unknown; keyframes: unknown; options: Record<string, unknown> }> = []
  const stopped: unknown[] = []
  return {
    started,
    stopped,
    animate: (target: unknown, keyframes: unknown, options: Record<string, unknown>) => {
      started.push({ target, keyframes, options })
      return {
        cancel() { stopped.push(target) },
      }
    },
  }
}

function build() {
  const root = fakeElement()
  const body = fakeElement()
  const stage = fakeElement()
  const record = recorder()
  const performer = createPerformer({ root, body, stage, animate: record.animate })
  return { root, body, stage, record, performer }
}

const day = { night: false, reducedMotion: false }

describe('companion performer', () => {
  it('paints the pose, symbol, and prop, then animates the stage', () => {
    const { root, record, performer } = build()
    performer.apply({ action: 'waitAnnoyed', pose: 'work', symbol: 'question', prop: 'clock' }, day)
    expect(root.dataset).toEqual({ pose: 'work', symbol: 'question', prop: 'clock' })
    expect(root.properties['--amp']).toBe('1')
    // One ambient animation on the body, one cue animation on the stage.
    expect(record.started).toHaveLength(2)
    expect(record.started[0]?.target).toBe(record.started[0]?.target)
    expect(record.started[1]?.options).toMatchObject({ duration: 1_000, iterations: Number.POSITIVE_INFINITY })
  })

  it('writes both facts the CSS reads for an absent symbol and prop', () => {
    const { root, performer } = build()
    performer.apply({ action: 'pace', pose: 'stand', symbol: null, prop: null }, day)
    expect(root.dataset.symbol).toBe('none')
    expect(root.dataset.prop).toBe('none')
  })

  it('halves the amplitude at night', () => {
    const { root, performer } = build()
    performer.apply({ action: 'pace', pose: 'stand', symbol: null, prop: null }, { ...day, night: true })
    expect(root.properties['--amp']).toBe('0.5')
  })

  it('restarts a one-shot but leaves a looping action alone', () => {
    const { record, performer } = build()
    performer.apply({ action: 'busyJitter', pose: 'stand', symbol: null, prop: null }, day)
    expect(record.started).toHaveLength(2)
    performer.apply({ action: 'busyJitter', pose: 'stand', symbol: null, prop: null }, day)
    expect(record.started).toHaveLength(2)
    performer.apply({ action: 'hop', pose: 'stand', symbol: null, prop: null }, day)
    performer.apply({ action: 'hop', pose: 'stand', symbol: null, prop: null }, day)
    expect(record.started).toHaveLength(4)
  })

  it('cancels the previous cue before starting the next one', () => {
    const { stage, record, performer } = build()
    performer.apply({ action: 'busyJitter', pose: 'stand', symbol: null, prop: null }, day)
    performer.apply({ action: 'celebrate', pose: 'happy', symbol: 'mark', prop: null }, day)
    expect(record.stopped).toContain(stage)
  })

  it('stops everything and holds the resting frame under reduced motion', () => {
    const { stage, record, performer } = build()
    performer.apply({ action: 'busyJitter', pose: 'stand', symbol: null, prop: null }, day)
    const before = record.started.length
    performer.apply({ action: 'celebrate', pose: 'happy', symbol: 'mark', prop: null }, { night: false, reducedMotion: true })
    expect(record.started).toHaveLength(before)
    expect(stage.style.transform).toBe(REST)
    expect(record.stopped).toContain(stage)
  })

  it('returns to rest for an action it does not know', () => {
    const { stage, performer } = build()
    performer.apply({ action: null, pose: 'stand', symbol: null, prop: null }, day)
    expect(stage.style.transform).toBe(REST)
  })
})

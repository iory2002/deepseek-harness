import { describe, expect, it } from 'vitest'
import * as renderer from '../renderer/pet-timing.js'
import { isPetNight, PET_IDLE_ASLEEP_MS, PET_IDLE_BORED_MS, PET_WAIT_ANNOYED_MS, PET_WAIT_DESPERATE_MS } from '../src/pet-timing.ts'

describe('companion timing', () => {
  it('keeps the renderer copy of the thresholds in step with the shell', () => {
    expect(renderer.PET_WAIT_ANNOYED_MS).toBe(PET_WAIT_ANNOYED_MS)
    expect(renderer.PET_WAIT_DESPERATE_MS).toBe(PET_WAIT_DESPERATE_MS)
    expect(renderer.PET_IDLE_BORED_MS).toBe(PET_IDLE_BORED_MS)
    expect(renderer.PET_IDLE_ASLEEP_MS).toBe(PET_IDLE_ASLEEP_MS)
  })

  it('treats the night window as a wrap around midnight', () => {
    const at = (hour: number, minute = 0) => new Date(2026, 4, 1, hour, minute)
    expect(isPetNight(at(22, 59))).toBe(false)
    expect(isPetNight(at(23))).toBe(true)
    expect(isPetNight(at(0))).toBe(true)
    expect(isPetNight(at(5, 59))).toBe(true)
    expect(isPetNight(at(6))).toBe(false)
    expect(isPetNight(at(12))).toBe(false)
  })
})

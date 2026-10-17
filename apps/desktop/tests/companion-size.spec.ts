import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => ({ contents: new Map<string, string>() }))
const atomic = vi.hoisted(() => ({ written: [] as Array<{ path: string; content: string }> }))

vi.mock('node:fs/promises', () => ({
  readFile: async (path: string) => {
    const value = files.contents.get(path)
    if (value === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return value
  },
}))
vi.mock('@deepseek-ai/dsh-atomic-write', () => ({
  writeFileAtomic: async (path: string, content: string) => { atomic.written.push({ path, content }) },
}))

const {
  COMPANION_DESIGN_SIZE, COMPANION_SCALES, CompanionSizeStore, companionBounds, readCompanionScale,
} = await import('../src/companion-size.ts')

const PATH = 'C:/userData/companion.json'

beforeEach(() => {
  files.contents.clear()
  atomic.written.length = 0
})

afterEach(() => { vi.clearAllMocks() })

describe('companion size steps', () => {
  it('offers three ascending steps around the design size', () => {
    expect(COMPANION_SCALES).toEqual([0.85, 1, 1.25])
    expect(companionBounds(1)).toEqual({ width: COMPANION_DESIGN_SIZE.width, height: COMPANION_DESIGN_SIZE.height })
  })

  it('scales both window edges and rounds them', () => {
    expect(companionBounds(0.85)).toEqual({ width: 187, height: 306 })
    expect(companionBounds(1.25)).toEqual({ width: 275, height: 450 })
  })

  it('accepts only the offered steps', () => {
    for (const scale of COMPANION_SCALES) expect(readCompanionScale(scale)).toBe(scale)
    for (const value of [0, 1.1, 1.5, '1', null, undefined, {}, []]) {
      expect(readCompanionScale(value)).toBeUndefined()
    }
  })
})

describe('companion size preference', () => {
  it('opens at the default when nothing was stored', async () => {
    await expect(new CompanionSizeStore(PATH).read()).resolves.toBe(1)
  })

  it('returns the stored step', async () => {
    files.contents.set(PATH, '{"scale":1.25}\n')
    await expect(new CompanionSizeStore(PATH).read()).resolves.toBe(1.25)
  })

  it('falls back to the default for a file it cannot use', async () => {
    for (const stored of ['not json', 'null', '"large"', '{"scale":2}', '{"size":1.25}', '[]']) {
      files.contents.set(PATH, stored)
      await expect(new CompanionSizeStore(PATH).read()).resolves.toBe(1)
    }
  })

  it('stores one step through the atomic writer', async () => {
    await new CompanionSizeStore(PATH).write(0.85)
    expect(atomic.written).toEqual([{ path: PATH, content: '{"scale":0.85}\n' }])
  })
})

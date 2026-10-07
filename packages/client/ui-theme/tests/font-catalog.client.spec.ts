/** Font catalog: which tokens an override writes and how sizes map to line heights. */
import { describe, expect, it } from 'vitest'
import {
  clampFontItemSize, FONT_FAMILY_STACKS, FONT_ITEM_BY_TOKEN, FONT_ITEMS, fontOverrideLayer, fontOverrideTokens,
} from '../src/font-catalog.ts'

describe('font catalog', () => {
  it('lists every row under a section with a description key', () => {
    expect(FONT_ITEMS.length).toBeGreaterThanOrEqual(15)
    for (const item of FONT_ITEMS) {
      expect(item.description.startsWith('fontItem.')).toBe(true)
      expect(item.axis === undefined || item.size !== undefined).toBe(true)
    }
    expect(new Set(FONT_ITEMS.map(item => item.token)).size).toBe(FONT_ITEMS.length)
  })

  it('rebuilds a size-bearing item with its own ratio and every sub-token', () => {
    // h1 ships 21px/30px (ratio 30/21): 28px must land on a 40px line height.
    expect(fontOverrideTokens({ token: '--dsw-font-markdown-h1', size: 28 })).toEqual({
      '--dsw-font-markdown-h1': '700 28px/40px var(--dsw-font-family)',
      '--dsw-font-markdown-h1-font-size': '28px',
      '--dsw-font-markdown-h1-line-height': '40px',
      '--dsw-font-markdown-h1-font-family': 'var(--dsw-font-family)',
    })
  })

  it('keeps every weight and style variant of an item in step', () => {
    const tokens = fontOverrideTokens({ token: '--dsw-font-markdown-base', size: 16, family: 'serif' })
    expect(tokens['--dsw-font-markdown-base']).toBe(`400 16px/27px ${FONT_FAMILY_STACKS.serif}`)
    expect(tokens['--dsw-font-markdown-base-strong']).toBe(`600 16px/27px ${FONT_FAMILY_STACKS.serif}`)
    expect(tokens['--dsw-font-markdown-base-italic']).toBe(`italic 400 16px/27px ${FONT_FAMILY_STACKS.serif}`)
    expect(tokens['--dsw-font-markdown-base-strong-italic']).toBe(`italic 600 16px/27px ${FONT_FAMILY_STACKS.serif}`)
  })

  it('embeds the code stack for code items and writes nothing for an axis row', () => {
    expect(fontOverrideTokens({ token: '--dsw-font-markdown-code-block', size: 14 })['--dsw-font-markdown-code-block'])
      .toBe(`400 14px/24px ${FONT_FAMILY_STACKS.code}`)
    expect(fontOverrideTokens({ token: '--dsh-content-font-size', size: 18 })).toEqual({})
  })

  it('replaces the stack itself for a family-only row', () => {
    expect(fontOverrideTokens({ token: '--dsw-font-family', family: 'serif' }))
      .toEqual({ '--dsw-font-family': FONT_FAMILY_STACKS.serif })
    expect(fontOverrideTokens({ token: '--ds-font-family-code', family: 'brand' }))
      .toEqual({ '--ds-font-family-code': FONT_FAMILY_STACKS.brand })
  })

  it('merges entries into one layer and ignores tokens outside the catalog', () => {
    expect(fontOverrideLayer([
      { token: '--dsw-font-xxs-12', size: 13 },
      { token: '--dsw-font-family', family: 'code' },
      { token: '--not-a-token', size: 20 },
    ])).toEqual({
      '--dsw-font-xxs-12': '400 13px/20px var(--dsw-font-family)',
      '--dsw-font-xxs-12-font-size': '13px',
      '--dsw-font-xxs-12-line-height': '20px',
      '--dsw-font-xxs-12-font-family': 'var(--dsw-font-family)',
      '--dsw-font-family': FONT_FAMILY_STACKS.code,
    })
  })

  it('clamps a size into the row bounds and rejects size-less rows', () => {
    expect(clampFontItemSize('--dsw-font-markdown-h1', 999)).toBe(32)
    expect(clampFontItemSize('--dsw-font-markdown-h1', 2)).toBe(9)
    expect(clampFontItemSize('--dsh-content-font-size', 999)).toBe(22)
    expect(clampFontItemSize('--dsw-font-markdown-h1', 17.6)).toBe(18)
    expect(clampFontItemSize('--dsw-font-family', 20)).toBeUndefined()
    expect(clampFontItemSize('--unknown', 20)).toBeUndefined()
    expect(FONT_ITEM_BY_TOKEN.get('--dsw-font-xs-13')?.size?.default).toBe(13)
  })
})

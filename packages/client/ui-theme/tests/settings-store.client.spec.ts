/** Appearance and font-size row stores: snapshot-mirror actions and the revision guards. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore, createTypographyStore } from '../src/client/settings-store.ts'

describe('createAppearanceRowStore', () => {
  it('init shape: system preference with revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({ preference: 'system', revision: -1 })
  })

  it('sync mirrors the preference and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 0)
    expect(store.getSnapshot()).toEqual({ preference: 'dark', revision: 0 })
    store.actions.sync('light', 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 3)
    store.actions.sync('system', 2)
    store.actions.sync('system', 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().revision).toBe(3)
  })
})

describe('createTypographyStore', () => {
  it('init shape: both axes at their defaults, nothing pinned, revision at -1', () => {
    const store = createTypographyStore().create()
    expect(store.getSnapshot()).toEqual({ fontSize: 14, workspaceFontSize: 14, fonts: [], revision: -1 })
  })

  it('sync mirrors both axes and the pinned tokens; the revision guard drops stale and duplicate writes', () => {
    const store = createTypographyStore().create()
    store.actions.sync(16, 18, [{ token: '--dsw-font-xs-13', size: 15 }], 3)
    expect(store.getSnapshot()).toEqual({
      fontSize: 16, workspaceFontSize: 18, fonts: [{ token: '--dsw-font-xs-13', size: 15 }], revision: 3,
    })
    store.actions.sync(12, 12, [], 2)
    store.actions.sync(12, 12, [], 3)
    expect(store.getSnapshot().fontSize).toBe(16)
    expect(store.getSnapshot().workspaceFontSize).toBe(18)
    expect(store.getSnapshot().fonts).toEqual([{ token: '--dsw-font-xs-13', size: 15 }])
    expect(store.getSnapshot().revision).toBe(3)
  })
})

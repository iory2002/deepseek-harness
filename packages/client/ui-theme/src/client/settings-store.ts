/**
 * Typography settings stores: mirrors of the theme service's font state. The
 * plugin's apply-world change listener is the only writer; the Appearance row
 * and both font surfaces read via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_FONT_SIZE, DEFAULT_WORKSPACE_FONT_SIZE, type ThemePreference } from '../theme-settings.ts'
import type { FontOverride } from '../font-catalog.ts'

/** Store state mirrored from the theme snapshot. */
export interface AppearanceRowState {
  /** Persisted preference (selection state reads this, never the resolved active theme). */
  preference: ThemePreference
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (draft: AppearanceRowState, preference: ThemePreference, revision: number) => void
}

/**
 * Declares the Appearance row state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({ preference: 'system', revision: -1 }),
    actions: {
      sync: (d, preference: ThemePreference, revision: number) => {
        if (revision <= d.revision) return
        d.preference = preference
        d.revision = revision
      },
    },
  })
}

/** Store state mirrored from the theme snapshot's typography. */
export interface TypographyState {
  /** Persisted content font size in px. */
  fontSize: number
  /** Persisted workspace document font size in px. */
  workspaceFontSize: number
  /** Persisted pinned typography tokens, in catalog table order. */
  fonts: readonly FontOverride[]
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type TypographyActions = {
  sync: (draft: TypographyState, fontSize: number, workspaceFontSize: number,
    fonts: readonly FontOverride[], revision: number) => void
}

/**
 * Declares the typography state and write surface shared by the font-size rows,
 * the font settings table, and the button row that opens it.
 * @returns the store handle.
 */
export function createTypographyStore(): EngineStoreHandle<TypographyState, TypographyActions> {
  return defineStore({
    init: (): TypographyState => ({
      fontSize: DEFAULT_FONT_SIZE, workspaceFontSize: DEFAULT_WORKSPACE_FONT_SIZE, fonts: [], revision: -1,
    }),
    actions: {
      sync: (d, fontSize: number, workspaceFontSize: number, fonts: readonly FontOverride[], revision: number) => {
        if (revision <= d.revision) return
        d.fontSize = fontSize
        d.workspaceFontSize = workspaceFontSize
        d.fonts = fonts
        d.revision = revision
      },
    },
  })
}

/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import {
  FONT_FAMILY_IDS, FONT_ITEM_SIZE_MAX, FONT_ITEM_SIZE_MIN, FONT_ITEMS, type FontOverride,
} from './font-catalog.ts'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the conversation content font size. */
export const FONT_SIZE_FIELD = 'fontSize'

/** Field carrying the workspace document font size. */
export const WORKSPACE_FONT_SIZE_FIELD = 'workspaceFontSize'

/** Field carrying per-token typography overrides from the font settings table. */
export const FONT_OVERRIDES_FIELD = 'fonts'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Smallest accepted content font size (px). */
export const FONT_SIZE_MIN = 10

/** Largest accepted content font size (px). */
export const FONT_SIZE_MAX = 22

/** Content font size when the user-settings document has no override (px). */
export const DEFAULT_FONT_SIZE = 14

/** Workspace document font size when the user-settings document has no override (px). */
export const DEFAULT_WORKSPACE_FONT_SIZE = 14

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Conversation content font size in px (integer within {@link FONT_SIZE_MIN}..{@link FONT_SIZE_MAX}). */
  fontSize: number
  /** Workspace document font size in px (integer within {@link FONT_SIZE_MIN}..{@link FONT_SIZE_MAX}). */
  workspaceFontSize: number
  /** Pinned typography tokens; an absent entry keeps the shipped default. */
  fonts?: FontOverride[]
}

/** Durable per-token typography overrides; an absent entry keeps the shipped default. */
export const FontOverrideListSchema = z.array(z.object({
  token: z.union([...FONT_ITEMS.map(item => item.token)]).required(),
  size: z.number().step(1).min(FONT_ITEM_SIZE_MIN).max(FONT_ITEM_SIZE_MAX),
  family: z.union([...FONT_FAMILY_IDS]),
}))

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
  [WORKSPACE_FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_WORKSPACE_FONT_SIZE),
  [FONT_OVERRIDES_FIELD]: FontOverrideListSchema,
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

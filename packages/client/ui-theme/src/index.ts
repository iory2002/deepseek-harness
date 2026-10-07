/** Host registration for the browser theme preference and pre-plugin palette. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile } from '@deepseek-ai/cordis'
import type { ThemePreference } from './theme-settings.ts'
import z from '@deepseek-ai/schemastery'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { bootThemeInjections } from './boot-theme.ts'
import {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, DEFAULT_WORKSPACE_FONT_SIZE, FONT_SIZE_MIN, FONT_SIZE_MAX,
  FontOverrideListSchema, THEME_PREFERENCES,
} from './theme-settings.ts'
import type { FontOverride } from './font-catalog.ts'

export {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, DEFAULT_WORKSPACE_FONT_SIZE, FONT_OVERRIDES_FIELD, FONT_SIZE_FIELD,
  FONT_SIZE_MAX, FONT_SIZE_MIN, THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  WORKSPACE_FONT_SIZE_FIELD,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'
export {
  FONT_FAMILY_IDS, FONT_FAMILY_STACKS, FONT_ITEMS, fontOverrideLayer, fontOverrideTokens,
  type FontFamilyId, type FontItem, type FontOverride,
} from './font-catalog.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Browser palette preference. */
  preference: Volatile<ThemePreference>
  /** Browser font size in pixels. */
  fontSize: Volatile<number>
  /** Workspace document font size in pixels. */
  workspaceFontSize: Volatile<number>
  /** Pinned typography tokens from the font settings table. */
  fonts?: Volatile<readonly FontOverride[]>
}

/** Live theme and typography preferences. */
export const Config = z.object({
  preference: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE).volatile(),
  fontSize: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE).volatile(),
  workspaceFontSize: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX)
    .default(DEFAULT_WORKSPACE_FONT_SIZE).volatile(),
  fonts: FontOverrideListSchema.default([]).volatile(),
})

/** Supply the current palette before browser plugins start.
 * @param ctx Host plugin context.
 * @param config Validated live theme preferences.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.on('webserver/index-inject', (table) => {
    table.push(...bootThemeInjections(
      config.preference.get(), config.fontSize.get(), config.workspaceFontSize.get(), config.fonts?.get()))
  }, { prepend: true })
}

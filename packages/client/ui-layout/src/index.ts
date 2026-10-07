/** Host registration for the browser-only layout plugin and its arrangement setting. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ARRANGEMENT_FIELD, LayoutSettingsFields } from './arrangement-settings.ts'
import type { LayoutArrangement } from './arrangement-settings.ts'

export {
  ARRANGEMENT_FIELD, DEFAULT_LAYOUT_ARRANGEMENT, LAYOUT_ARRANGEMENTS,
  LAYOUT_SETTINGS_NAMESPACE, LayoutSettingsSchema,
  type LayoutArrangement, type LayoutSettings,
} from './arrangement-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Which surface the flexible center column hosts. */
  arrangement: Volatile<LayoutArrangement>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  [ARRANGEMENT_FIELD]: LayoutSettingsFields[ARRANGEMENT_FIELD].volatile(),
})

/**
 * Host preferences are consumed through the configuration form projection; the
 * browser half reads the same namespace instead of this config object.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}

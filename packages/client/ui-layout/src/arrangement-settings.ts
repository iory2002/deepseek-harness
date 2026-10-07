/** Durable layout preference owned by this plugin: which surface the center hosts. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the layout plugin. */
export const LAYOUT_SETTINGS_NAMESPACE = 'ui-layout'

/** Field carrying the frame arrangement. */
export const ARRANGEMENT_FIELD = 'arrangement'

/** Frame arrangements accepted at the setting and render boundaries. */
export const LAYOUT_ARRANGEMENTS = ['conversation-center', 'workspace-center'] as const

/**
 * Which surface the flexible center column hosts; the other one takes the right
 * column. `conversation-center` is the shipped composition: the Conversation
 * keeps the flexible center and the workspace surface docks on the right edge.
 */
export type LayoutArrangement = typeof LAYOUT_ARRANGEMENTS[number]

/** Default keeps the Conversation central and the workspace surface docked right. */
export const DEFAULT_LAYOUT_ARRANGEMENT: LayoutArrangement = 'conversation-center'

/** Durable layout section shared by the Host schema and the browser scope. */
export interface LayoutSettings {
  /** Frame arrangement. */
  arrangement: LayoutArrangement
}

/** Durable layout schema; also the wire envelope the browser scope validates against. */
export const LayoutSettingsFields = {
  [ARRANGEMENT_FIELD]: z.union([...LAYOUT_ARRANGEMENTS]).default(DEFAULT_LAYOUT_ARRANGEMENT),
}

/** Schema for shared configuration values. */
export const LayoutSettingsSchema = z.object(LayoutSettingsFields)

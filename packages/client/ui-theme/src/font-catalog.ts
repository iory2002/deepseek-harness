/**
 * The editable typography catalog: which font tokens a user may pin, what each
 * one draws, and the shipped default it falls back to. The list is deliberately
 * closed — every entry has a current consumer, so the settings table never
 * offers a token that would change nothing — and both halves of the plugin read
 * it: the Host validates and boot-injects the same values the browser dialog edits.
 */

/** Curated font stacks a user may pin. Free text is not accepted. */
export const FONT_FAMILY_IDS = ['interface', 'code', 'brand', 'serif'] as const

/** One selectable font stack. */
export type FontFamilyId = typeof FONT_FAMILY_IDS[number]

/** Token value of each selectable stack. */
export const FONT_FAMILY_STACKS: Record<FontFamilyId, string> = {
  interface: 'var(--dsw-font-family)',
  code: 'var(--ds-font-family-code)',
  brand: "'Montserrat', var(--dsw-font-family)",
  serif: "'Georgia', 'Times New Roman', 'Songti SC', 'SimSun', serif",
}

/** Which built-in stack a size-bearing item embeds when no family is pinned. */
type FamilySlot = 'interface' | 'code'

const FAMILY_SLOT_TOKENS: Record<FamilySlot, string> = {
  interface: 'var(--dsw-font-family)',
  code: 'var(--ds-font-family-code)',
}

/** Size bounds shared by every size-bearing catalog item. */
export const FONT_ITEM_SIZE_MIN = 9

/** Upper bound shared by every size-bearing catalog item. */
export const FONT_ITEM_SIZE_MAX = 32

/** One weight/style occurrence sharing the item's size and family. */
export interface FontItemVariant {
  /** Token suffix after the item token; empty for the item's own token. */
  readonly suffix: string
  /** CSS font-weight kept in the rebuilt shorthand. */
  readonly weight: string
  /** CSS font-style kept in the rebuilt shorthand. */
  readonly style?: 'italic'
}

/** Locale keys describing what each catalog token draws. */
export type FontItemDescriptionKey =
  | 'fontItem.contentAxis' | 'fontItem.workspaceAxis'
  | 'fontItem.familyInterface' | 'fontItem.familyCode' | 'fontItem.familyBrand'
  | 'fontItem.markdownH1' | 'fontItem.markdownH2' | 'fontItem.markdownH3' | 'fontItem.markdownH4'
  | 'fontItem.markdownBase' | 'fontItem.markdownTable' | 'fontItem.markdownCodeBlock'
  | 'fontItem.markdownCode' | 'fontItem.xs13' | 'fontItem.xxs12' | 'fontItem.xxxs11'

/** One row of the font settings table. */
export interface FontItem {
  /** Shorthand token the item edits (also the row's identity). */
  readonly token: string
  /** Section the row is grouped under. */
  readonly group: 'axis' | 'family' | 'markdown' | 'scale'
  /** Locale key of the row's description (which elements the token draws). */
  readonly description: FontItemDescriptionKey
  /**
   * Size editing: the shipped size in px, the item's own bounds, and the line
   * height at that size (an override keeps this ratio).
   */
  readonly size?: { readonly default: number; readonly min: number; readonly max: number; readonly lineHeight: number }
  /** Family editing: the built-in stack the item embeds by default. */
  readonly family?: FamilySlot
  /** The token IS a family stack, so its size column stays disabled. */
  readonly familyOnly?: boolean
  /** Stack shown and used for a family-only token before the user pins one. */
  readonly defaultFamily?: FontFamilyId
  /** Which size axis routes the edit, for the two user-facing axes. */
  readonly axis?: 'content' | 'workspace'
  /** Weight/style occurrences kept in step with the item's size and family. */
  readonly variants?: readonly FontItemVariant[]
}

const PLAIN: readonly FontItemVariant[] = [{ suffix: '', weight: '400' }]

/** Every editable typography token, in table order. */
export const FONT_ITEMS: readonly FontItem[] = [
  // The two user axes: size only, and their edits route to the axis fields.
  { token: '--dsh-content-font-size', group: 'axis', axis: 'content',
    description: 'fontItem.contentAxis', size: { default: 14, min: 10, max: 22, lineHeight: 24 } },
  { token: '--dsh-workspace-font-size', group: 'axis', axis: 'workspace',
    description: 'fontItem.workspaceAxis', size: { default: 14, min: 10, max: 22, lineHeight: 24 } },
  { token: '--dsw-font-family', group: 'family', familyOnly: true, defaultFamily: 'interface',
    description: 'fontItem.familyInterface' },
  { token: '--ds-font-family-code', group: 'family', familyOnly: true, defaultFamily: 'code',
    description: 'fontItem.familyCode' },
  { token: '--dsw-font-family-brand', group: 'family', familyOnly: true, defaultFamily: 'brand',
    description: 'fontItem.familyBrand' },
  { token: '--dsw-font-markdown-h1', group: 'markdown', description: 'fontItem.markdownH1',
    size: { default: 21, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 30 }, family: 'interface',
    variants: [{ suffix: '', weight: '700' }] },
  { token: '--dsw-font-markdown-h2', group: 'markdown', description: 'fontItem.markdownH2',
    size: { default: 19, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 28 }, family: 'interface',
    variants: [{ suffix: '', weight: '700' }] },
  { token: '--dsw-font-markdown-h3', group: 'markdown', description: 'fontItem.markdownH3',
    size: { default: 18, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 26 }, family: 'interface',
    variants: [{ suffix: '', weight: '700' }] },
  { token: '--dsw-font-markdown-h4', group: 'markdown', description: 'fontItem.markdownH4',
    size: { default: 14, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 24 }, family: 'interface',
    variants: [{ suffix: '', weight: '600' }] },
  { token: '--dsw-font-markdown-base', group: 'markdown', description: 'fontItem.markdownBase',
    size: { default: 14, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 24 }, family: 'interface',
    variants: [
      { suffix: '', weight: '400' },
      { suffix: '-strong', weight: '600' },
      { suffix: '-italic', weight: '400', style: 'italic' },
      { suffix: '-strong-italic', weight: '600', style: 'italic' },
    ] },
  { token: '--dsw-font-markdown-table', group: 'markdown', description: 'fontItem.markdownTable',
    size: { default: 13, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 22 }, family: 'interface',
    variants: [{ suffix: '', weight: '400' }, { suffix: '-head', weight: '500' }] },
  { token: '--dsw-font-markdown-code-block', group: 'markdown', description: 'fontItem.markdownCodeBlock',
    size: { default: 11, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 19 }, family: 'code',
    variants: [
      { suffix: '', weight: '400' },
      { suffix: '-small', weight: '400' },
    ] },
  { token: '--dsw-font-markdown-code', group: 'markdown', description: 'fontItem.markdownCode',
    size: { default: 12, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 19 }, family: 'code',
    variants: PLAIN },
  { token: '--dsw-font-xs-13', group: 'scale', description: 'fontItem.xs13',
    size: { default: 13, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 20 }, family: 'interface',
    variants: [{ suffix: '', weight: '400' }, { suffix: '-strong', weight: '500' }] },
  { token: '--dsw-font-xxs-12', group: 'scale', description: 'fontItem.xxs12',
    size: { default: 12, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 18 }, family: 'interface',
    variants: PLAIN },
  { token: '--dsw-font-xxxs-11', group: 'scale', description: 'fontItem.xxxs11',
    size: { default: 11, min: FONT_ITEM_SIZE_MIN, max: FONT_ITEM_SIZE_MAX, lineHeight: 14 }, family: 'interface',
    variants: PLAIN },
]

/** Lookup of one catalog row by its token. */
export const FONT_ITEM_BY_TOKEN: ReadonlyMap<string, FontItem> = new Map(FONT_ITEMS.map(item => [item.token, item]))

/** One row's explicit choice; absent fields keep the shipped default. */
export interface FontOverride {
  /** Catalog token the choice applies to. */
  token: string
  /** Pinned size in px. */
  size?: number
  /** Pinned family stack id. */
  family?: FontFamilyId
}

/** Line height an override uses: the shipped ratio at the pinned size. */
function lineHeightFor(item: FontItem, size: number): number {
  /* v8 ignore next -- only size-bearing items reach here, and the catalog gives each a size. */
  const spec = item.size ?? { default: size, lineHeight: size }
  return Math.max(1, Math.round(size * spec.lineHeight / spec.default))
}

/** Family stack an item uses when the user pinned none. */
function defaultStack(item: FontItem): string {
  return item.family === undefined ? '' : FAMILY_SLOT_TOKENS[item.family]
}

/**
 * Font tokens one override writes. Size-bearing items rebuild their shorthand
 * and every size/line-height/family sub-token; family-only items replace the
 * stack itself. Axis items write nothing — their edits route to the axis fields.
 * @param override - the user's choice for one catalog token.
 * @returns token name → CSS value, empty when the token is not editable here.
 */
export function fontOverrideTokens(override: FontOverride): Record<string, string> {
  const item = FONT_ITEM_BY_TOKEN.get(override.token)
  if (item === undefined || item.axis !== undefined) return {}
  const stack = override.family === undefined ? defaultStack(item) : FONT_FAMILY_STACKS[override.family]
  if (item.familyOnly) return { [item.token]: stack }
  /* v8 ignore next -- a non-axis, non-family-only item always declares a size. */
  const spec = item.size ?? { default: 0, min: 0, max: 0, lineHeight: 0 }
  const size = override.size ?? spec.default
  const lineHeight = lineHeightFor(item, size)
  const tokens: Record<string, string> = {}
  for (const variant of item.variants ?? PLAIN) {
    const token = `${item.token}${variant.suffix}`
    const style = variant.style === undefined ? '' : `${variant.style} `
    tokens[token] = `${style}${variant.weight} ${size}px/${lineHeight}px ${stack}`.trim()
    tokens[`${token}-font-size`] = `${size}px`
    tokens[`${token}-line-height`] = `${lineHeight}px`
    tokens[`${token}-font-family`] = stack
  }
  return tokens
}

/**
 * Font tokens every override writes together, as the boot script and the
 * document presenter publish them.
 * @param overrides - the durable list of pinned choices.
 * @returns token name → CSS value across all entries.
 */
export function fontOverrideLayer(overrides: readonly FontOverride[]): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const override of overrides) Object.assign(tokens, fontOverrideTokens(override))
  return tokens
}

/**
 * Narrow a wire value to a persistable size for one item.
 * @param token - catalog token the size belongs to.
 * @param size - candidate size in px.
 * @returns the clamped integer size, or undefined when the item takes no size.
 */
export function clampFontItemSize(token: string, size: number): number | undefined {
  const item = FONT_ITEM_BY_TOKEN.get(token)
  if (item?.size === undefined) return undefined
  return Math.min(item.size.max, Math.max(item.size.min, Math.round(size)))
}

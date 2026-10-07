/**
 * Global theme DOM applier: projects the resolved ThemeSnapshot onto the
 * document — `html { color-scheme }` for native UA chrome (scrollbars, form
 * controls), `body[data-ds-dark-theme]` for the token palette, the active
 * theme's alias-token overrides as inline CSS variables on body, the content
 * and workspace font-size axes (`--dsh-content-font-size`,
 * `--dsh-workspace-font-size`), every pinned typography token the snapshot
 * carries, `html[data-ds-theme-source]` for native-chrome mirroring, and one
 * presenter-owned `meta[name="theme-color"]` for surrounding browser UI. Pure
 * DOM writes, no React involvement; the presenter only ever retracts what it
 * wrote itself, so foreign attributes, metadata, and inline styles survive.
 */
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Body attribute selecting the dark base palette in the token stylesheets. */
export const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/**
 * Root attribute publishing the theme source (`light`, `dark`, or `system`)
 * for host shells that mirror it into the native theme (the Electron preload
 * forwards it to `nativeTheme.themeSource`, so native chrome, renderer
 * `prefers-color-scheme` queries, and Platform login links follow the app
 * palette on every platform). `system` only when the preference is `system`;
 * a fixed preference (including registered theme ids) publishes its resolved
 * scheme.
 */
export const THEME_SOURCE_ATTRIBUTE = 'data-ds-theme-source'

/** Body variable carrying the user's content font size in px. */
export const CONTENT_FONT_SIZE_VARIABLE = '--dsh-content-font-size'

/** Body variable carrying the user's workspace document font size in px. */
export const WORKSPACE_FONT_SIZE_VARIABLE = '--dsh-workspace-font-size'

/** Applies theme snapshots to the document; one instance per plugin fiber. */
export class ThemePresenter {
  /** Token names this presenter wrote in the last apply (its retraction set). */
  private appliedTokens: string[] = []
  /** Pinned typography token names this presenter wrote in the last apply. */
  private appliedFontTokens: string[] = []
  /** The single metadata node this presenter inserts and removes. */
  private readonly themeColorMeta: HTMLMetaElement

  /** Create the presenter-owned metadata node before the first snapshot arrives. */
  constructor() {
    this.themeColorMeta = document.createElement('meta')
    this.themeColorMeta.name = 'theme-color'
  }

  /**
   * Project a snapshot onto the document: set root `color-scheme` and the body
   * palette attribute from `active.colorScheme` (never the id — `system` is
   * resolved upstream), publish the content font-size axis, then replace the
   * previously applied token variables with `active.tokens`. Browser
   * theme-color metadata follows the computed body background after those
   * writes, so the rendered palette remains the color authority.
   * @param snapshot - resolved theme snapshot from ctx.theme.
   */
  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    document.documentElement.setAttribute(THEME_SOURCE_ATTRIBUTE,
      snapshot.preference === 'system' ? 'system' : scheme)
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)
    body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`)
    body.style.setProperty(WORKSPACE_FONT_SIZE_VARIABLE, `${snapshot.workspaceFontSize}px`)
    for (const name of this.appliedFontTokens) body.style.removeProperty(name)
    this.appliedFontTokens = []
    for (const [name, value] of Object.entries(snapshot.fontTokens)) {
      body.style.setProperty(name, value)
      this.appliedFontTokens.push(name)
    }
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta)
  }

  /**
   * Retract root color-scheme, the theme-source attribute, the palette
   * attribute, token variables, both font-size axes, and the owned metadata node.
   */
  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    document.documentElement.removeAttribute(THEME_SOURCE_ATTRIBUTE)
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    body.style.removeProperty(CONTENT_FONT_SIZE_VARIABLE)
    body.style.removeProperty(WORKSPACE_FONT_SIZE_VARIABLE)
    for (const name of this.appliedFontTokens) body.style.removeProperty(name)
    this.appliedFontTokens = []
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    this.themeColorMeta.remove()
  }
}

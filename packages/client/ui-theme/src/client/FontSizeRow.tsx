/**
 * Font-size preference row registered into the General section item slot:
 * title + scope description + stepper pill (centered value; hover reveals the
 * up/down arrow column anchored to the pill's right edge) + a px unit label
 * after the pill. One component serves both typography axes — the conversation
 * content size and the workspace document size — because only the labels, the
 * mirrored value, and the write entry differ; the registration supplies `kind`
 * and its own setter. The displayed value follows the persisted setting, never
 * the click echo.
 */
import {
  IconChevronDownOutlineRegular, IconChevronUpOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../theme-settings.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createTypographyStore } from './settings-store.ts'
import css from './FontSizeRow.module.css'

/** Which typography axis this row edits. */
export type FontSizeAxis = 'content' | 'workspace'

/** Injected business face: the axis this row edits and its preference write. */
export interface FontSizeRowInjected {
  /** Typography axis this registration edits. */
  kind: FontSizeAxis
  /** Change this axis's size (integer px within FONT_SIZE_MIN..FONT_SIZE_MAX). */
  setFontSize: (px: number) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type FontSizeRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createTypographyStore>>
  & PropsLocale<'settings.theme'> & FontSizeRowInjected

/** Copy keys per axis, so the two rows share one render path. */
const LABELS: Record<FontSizeAxis, { title: 'fontSize.title' | 'workspaceFontSize.title'
  description: 'fontSize.description' | 'workspaceFontSize.description' }> = {
  content: { title: 'fontSize.title', description: 'fontSize.description' },
  workspace: { title: 'workspaceFontSize.title', description: 'workspaceFontSize.description' },
}

/**
 * Render one font-size row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function FontSizeRow({ t, kind, setFontSize, useStore }: FontSizeRowComponentProps) {
  const fontSize = useStore(s => kind === 'workspace' ? s.workspaceFontSize : s.fontSize)
  const labels = LABELS[kind]
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(labels.title)}</div>
        <div className={css.desc}>{t(labels.description)}</div>
      </div>
      <div className={css.control}>
        <div className={css.stepper}>
          <span className={css.value}>{fontSize}</span>
          <span className={css.arrows}>
            <button
              type="button"
              className={css.arrow}
              aria-label={t('fontSize.increase')}
              disabled={fontSize >= FONT_SIZE_MAX}
              onClick={() => { setFontSize(fontSize + 1) }}
            >
              <IconChevronUpOutlineRegular size={9} />
            </button>
            <button
              type="button"
              className={css.arrow}
              aria-label={t('fontSize.decrease')}
              disabled={fontSize <= FONT_SIZE_MIN}
              onClick={() => { setFontSize(fontSize - 1) }}
            >
              <IconChevronDownOutlineRegular size={9} />
            </button>
          </span>
        </div>
        <span className={css.unit}>{t('fontSize.unit')}</span>
      </div>
    </div>
  )
}

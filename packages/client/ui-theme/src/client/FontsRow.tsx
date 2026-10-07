/**
 * General Settings row that opens the font settings table. The row states how
 * many tokens are currently pinned, so a user who changed fonts months ago can
 * still see that the shipped composition is not in force.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_FONT_SIZE, DEFAULT_WORKSPACE_FONT_SIZE } from '../theme-settings.ts'
import type { createTypographyStore } from './settings-store.ts'
import { FontsDialog, type FontsDialogActions } from './FontsDialog.tsx'
import css from './FontsRow.module.css'

/** Full row props: the shared typography store, the locale seat, and the dialog's writes. */
export type FontsRowComponentProps =
  PropsStore<ReturnType<typeof createTypographyStore>>
  & PropsLocale<'settings.theme'>
  & FontsDialogActions

/**
 * Render the font table entry row.
 * @param props - composed slot props.
 * @returns the row element tree, plus its dialog while open.
 */
export function FontsRow(props: FontsRowComponentProps): ReactNode {
  const { t, useStore } = props
  const pinnedTokens = useStore(s => s.fonts.length)
  const contentSize = useStore(s => s.fontSize)
  const workspaceSize = useStore(s => s.workspaceFontSize)
  const pinned = pinnedTokens + (contentSize === DEFAULT_FONT_SIZE ? 0 : 1)
    + (workspaceSize === DEFAULT_WORKSPACE_FONT_SIZE ? 0 : 1)
  const [open, setOpen] = useState(false)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('fonts.title')}</div>
        <div className={css.desc}>{t('fonts.rowDescription')}</div>
      </div>
      <div className={css.control}>
        {pinned > 0 && <span className={css.count}>{t('fonts.pinnedCount', { count: pinned })}</span>}
        <Button variant="outline" size="sm" onClick={() => { setOpen(true) }}>{t('fonts.open')}</Button>
      </div>
      <FontsDialog {...props} open={open} onClose={() => { setOpen(false) }} />
    </div>
  )
}

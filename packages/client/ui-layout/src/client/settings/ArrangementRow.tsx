/** General Settings row for the frame arrangement. */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { LAYOUT_ARRANGEMENTS } from '../../arrangement-settings.ts'
import type { LayoutArrangement } from '../../arrangement-settings.ts'
import type { createLayoutStore } from '../stores.ts'
import type { en } from '../locales.ts'
import css from './ArrangementRow.module.css'

/** Full Settings-row props: the frame's own store carries the live arrangement. */
export type ArrangementRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'layout'>

const LABELS: Record<LayoutArrangement, keyof typeof en> = {
  'conversation-center': 'settings.arrangement.conversationCenter',
  'workspace-center': 'settings.arrangement.workspaceCenter',
}

/**
 * Render the frame arrangement selector.
 * @param props - composed Settings slot props.
 * @returns the layout row.
 */
export function ArrangementRow({ useStore, actions, t }: ArrangementRowProps) {
  const arrangement = useStore(state => state.layoutInfo.arrangement)
  const [open, setOpen] = useState(false)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.arrangement.title')}</div>
        <div className={css.desc}>{t('settings.arrangement.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={LAYOUT_ARRANGEMENTS.map(id => ({ id, label: t(LABELS[id]) }))}
        selectedId={arrangement}
        onSelect={(id) => {
          setOpen(false)
          actions.setArrangement(id as LayoutArrangement)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(LABELS[arrangement])}
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}

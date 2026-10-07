/**
 * Font settings table: one row per catalog token with its family stack, its
 * size, a live sample, and the elements the token draws. The table is the only
 * place the pinned-token overrides are edited; every row can be released back to
 * the shipped composition, and the footer releases all of them at once so a
 * mistyped font is always recoverable.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, Menu, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { FONT_FAMILY_IDS, FONT_ITEMS, type FontFamilyId, type FontItem } from '../font-catalog.ts'
import type { createTypographyStore } from './settings-store.ts'
import type { ThemeKey } from './locales.ts'
import css from './FontsDialog.module.css'

/** Writes the dialog routes through; the registration supplies them. */
export interface FontsDialogActions {
  /** Change the conversation content size. */
  setFontSize: (px: number) => void
  /** Change the workspace document size. */
  setWorkspaceFontSize: (px: number) => void
  /** Pin one catalog token's size and/or family. */
  setFontOverride: (token: string, patch: { size?: number; family?: FontFamilyId }) => void
  /** Release one token back to the shipped composition. */
  clearFontOverride: (token: string) => void
  /** Release every pinned token. */
  resetFontOverrides: () => void
}

/** Full dialog props: the shared typography store, the locale seat, and the writes. */
export type FontsDialogProps =
  PropsStore<ReturnType<typeof createTypographyStore>>
  & PropsLocale<'settings.theme'>
  & FontsDialogActions
  & { open: boolean; onClose: () => void }

/** Section order and copy keys of the table's group headers. */
const GROUPS: readonly { id: FontItem['group']; label: ThemeKey }[] = [
  { id: 'axis', label: 'fonts.group.axis' },
  { id: 'family', label: 'fonts.group.family' },
  { id: 'markdown', label: 'fonts.group.markdown' },
  { id: 'scale', label: 'fonts.group.scale' },
]

/** Family selector labels, keyed by stack id. */
const FAMILY_LABELS: Record<FontFamilyId, ThemeKey> = {
  interface: 'fonts.family.interface',
  code: 'fonts.family.code',
  brand: 'fonts.family.brand',
  serif: 'fonts.family.serif',
}

/** The two user axes, looked up once so the dialog can name their defaults. */
function axisDefault(axis: 'content' | 'workspace'): number {
  const item = FONT_ITEMS.find(candidate => candidate.axis === axis)
  /* v8 ignore next -- the catalog always carries both axes; the schema default stands in if one moves out. */
  return item?.size?.default ?? 14
}

/** One row's live values: the size it renders at, the stack, and whether it is pinned. */
interface RowState {
  readonly size: number
  readonly family: FontFamilyId
  readonly pinned: boolean
  readonly familyEnabled: boolean
  readonly sizeEnabled: boolean
}

/**
 * Resolve a catalog row's live state from the durable fields and its pin.
 * @param item - catalog row.
 * @param fontSize - live conversation content size.
 * @param workspaceFontSize - live workspace document size.
 * @param pins - pinned choices by token.
 * @returns the row's size, family, pinned flag, and which columns accept an edit.
 */
function rowState(item: FontItem, fontSize: number, workspaceFontSize: number,
  pins: ReadonlyMap<string, FontOverridePin>): RowState {
  const pin = pins.get(item.token)
  if (item.axis !== undefined) {
    const size = item.axis === 'content' ? fontSize : workspaceFontSize
    // An axis row counts as customized by VALUE: it is edited through its own
    // durable field, not through the pinned-token list.
    return { size, family: 'interface', pinned: size !== (item.size?.default ?? 14),
      familyEnabled: false, sizeEnabled: true }
  }
  const pinned = pin !== undefined
  if (item.familyOnly === true) {
    return { size: 0, family: pin?.family ?? item.defaultFamily ?? 'interface',
      pinned, familyEnabled: true, sizeEnabled: false }
  }
  const slot = item.family === 'code' ? 'code' : 'interface'
  return { size: pin?.size ?? item.size?.default ?? 0, family: pin?.family ?? slot,
    pinned, sizeEnabled: item.size !== undefined, familyEnabled: true }
}

/** The pinned fields of one row, as the dialog reads them from the store. */
type FontOverridePin = { readonly size?: number; readonly family?: FontFamilyId }

/**
 * Render the font settings dialog.
 * @param props - open state, locale seat, shared typography store, and writes.
 * @returns the table dialog, or null while it is closed.
 */
export function FontsDialog({
  open, onClose, useStore, t, setFontSize, setWorkspaceFontSize, setFontOverride, clearFontOverride, resetFontOverrides,
}: FontsDialogProps): ReactNode {
  const fontSize = useStore(s => s.fontSize)
  const workspaceFontSize = useStore(s => s.workspaceFontSize)
  const fonts = useStore(s => s.fonts)
  const [openFamily, setOpenFamily] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const pins = new Map<string, FontOverridePin>(fonts.map(entry => [entry.token, entry]))
  const axesChanged = fontSize !== axisDefault('content') || workspaceFontSize !== axisDefault('workspace')
  const anyPinned = fonts.length > 0 || axesChanged

  const applySize = (item: FontItem, next: number): void => {
    if (item.axis === 'content') setFontSize(next)
    else if (item.axis === 'workspace') setWorkspaceFontSize(next)
    else setFontOverride(item.token, { size: next, family: rowState(item, fontSize, workspaceFontSize, pins).family })
  }

  const applyFamily = (item: FontItem, family: FontFamilyId): void => {
    if (item.familyOnly === true) setFontOverride(item.token, { family })
    else setFontOverride(item.token, { family, size: rowState(item, fontSize, workspaceFontSize, pins).size })
  }

  const release = (item: FontItem): void => {
    if (item.axis === 'content') setFontSize(item.size?.default ?? 14)
    else if (item.axis === 'workspace') setWorkspaceFontSize(item.size?.default ?? 14)
    else clearFontOverride(item.token)
  }

  const row = (item: FontItem, first: boolean): ReactNode => {
    const state = rowState(item, fontSize, workspaceFontSize, pins)
    const bounds = item.size
    return (
      <div className={css.row} key={item.token} data-font-row={item.token}>
        <span className={css.token}>
          {item.token}
          {state.pinned && <span className={css.pinned}>{t('fonts.pinned')}</span>}
        </span>
        <Menu
          open={openFamily === item.token}
          onClose={() => { setOpenFamily(null) }}
          items={FONT_FAMILY_IDS.map(id => ({ id, label: t(FAMILY_LABELS[id]) }))}
          selectedId={state.family}
          onSelect={(id) => { setOpenFamily(null); applyFamily(item, id as FontFamilyId) }}
          align="start"
          portal
          anchor={(
            <button
              type="button"
              className={css.selector}
              aria-label={t('fonts.familyFor', { token: item.token })}
              aria-haspopup="menu"
              aria-expanded={openFamily === item.token}
              disabled={!state.familyEnabled}
              onClick={() => { setOpenFamily(current => current === item.token ? null : item.token) }}
            >
              <span className={css.selectorLabel}>
                {state.familyEnabled ? t(FAMILY_LABELS[state.family]) : t('fonts.familyUnavailable')}
              </span>
              <IconChevronDownOutlineRegular size={12} />
            </button>
          )}
        />
        <span className={css.stepper}>
          <span className={css.value}>{state.sizeEnabled ? state.size : '—'}</span>
          {state.sizeEnabled && bounds !== undefined && (
            <span className={css.arrows}>
              <button
                type="button"
                className={css.arrow}
                aria-label={t('fonts.increaseFor', { token: item.token })}
                disabled={state.size >= bounds.max}
                {...(first ? { 'data-modal-autofocus': true } : {})}
                onClick={() => { applySize(item, Math.min(bounds.max, state.size + 1)) }}
              >
                <IconChevronUpOutlineRegular size={9} />
              </button>
              <button
                type="button"
                className={css.arrow}
                aria-label={t('fonts.decreaseFor', { token: item.token })}
                disabled={state.size <= bounds.min}
                onClick={() => { applySize(item, Math.max(bounds.min, state.size - 1)) }}
              >
                <IconChevronDownOutlineRegular size={9} />
              </button>
            </span>
          )}
          {state.sizeEnabled && <span className={css.unit}>{t('fontSize.unit')}</span>}
        </span>
        <span className={css.description}>
          {t(item.description)}
          <span
            className={css.sample}
            style={item.familyOnly === true
              ? { fontFamily: `var(${item.token})` }
              : { font: `var(${item.token})` }}
          >
            {t('fonts.sample')}
          </span>
        </span>
        <span className={css.reset}>
          {state.pinned && (
            <Button variant="ghost" size="sm" onClick={() => { release(item) }}>{t('fonts.resetRow')}</Button>
          )}
        </span>
      </div>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('fonts.title')}
      closeLabel={t('fonts.close')}
      className={css.dialog ?? ''}
      contentClassName={css.dialogContent ?? ''}
      footer={(
        <div className={css.footer}>
          {confirmReset
            ? (
              <span className={css.confirm}>
                {t('fonts.resetAllConfirm')}
                <Button variant="ghost" size="sm" onClick={() => { setConfirmReset(false) }}>{t('fonts.cancel')}</Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setConfirmReset(false)
                    setFontSize(axisDefault('content'))
                    setWorkspaceFontSize(axisDefault('workspace'))
                    resetFontOverrides()
                  }}
                >
                  {t('fonts.confirm')}
                </Button>
              </span>
            )
            : (
              <Button variant="ghost" size="sm" disabled={!anyPinned} onClick={() => { setConfirmReset(true) }}>
                {t('fonts.resetAll')}
              </Button>
            )}
          <Button variant="primary" size="sm" onClick={onClose}>{t('fonts.done')}</Button>
        </div>
      )}
    >
      <div className={css.body}>
        <p className={css.note}>{t('fonts.note')}</p>
        <div className={css.table}>
          <div className={css.head}>
            <span>{t('fonts.column.item')}</span>
            <span>{t('fonts.column.family')}</span>
            <span>{t('fonts.column.size')}</span>
            <span>{t('fonts.column.description')}</span>
            <span />
          </div>
          {GROUPS.map(group => (
            <div key={group.id}>
              <div className={css.group}>{t(group.label)}</div>
              {FONT_ITEMS.filter(item => item.group === group.id).map((item, index) => row(item, group.id === 'axis' && index === 0))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

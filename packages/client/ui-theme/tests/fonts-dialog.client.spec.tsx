// @vitest-environment jsdom
/** Font settings dialog: the table's rows, its writes, and both restore paths. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FONT_ITEMS, type FontOverride } from '../src/font-catalog.ts'
import { createTypographyStore } from '../src/client/settings-store.ts'
import { FontsDialog } from '../src/client/FontsDialog.tsx'
import type { FontsDialogProps } from '../src/client/FontsDialog.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** What one mount seeds into the shared typography store. */
interface MountOptions {
  fonts?: readonly FontOverride[]
  fontSize?: number
  workspaceFontSize?: number
}

function mount(options: MountOptions = {}) {
  const store = createTypographyStore().create()
  store.actions.sync(options.fontSize ?? 14, options.workspaceFontSize ?? 14, options.fonts ?? [], 0)
  const actions = {
    setFontSize: vi.fn(),
    setWorkspaceFontSize: vi.fn(),
    setFontOverride: vi.fn(),
    clearFontOverride: vi.fn(),
    resetFontOverrides: vi.fn(),
  }
  const props: FontsDialogProps = {
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: makeTranslate(en),
    open: true,
    onClose: vi.fn(),
    ...actions,
  }
  render(<FontsDialog {...props} />)
  return { store, actions, props }
}

describe('FontsDialog', () => {
  it('renders one row per catalog token with the four requested columns', () => {
    mount()
    for (const heading of ['Token', 'Font family', 'Size', 'Used by']) {
      expect(screen.getByText(heading)).toBeDefined()
    }
    for (const item of FONT_ITEMS) {
      expect(screen.getByText(item.token)).toBeDefined()
      expect(screen.getByText(en[item.description])).toBeDefined()
    }
    // Both user axes report their live values and take no family.
    expect(screen.getAllByText('Not applicable')).toHaveLength(2)
    expect(screen.getByText('Restore all defaults')).toBeDefined()
  })

  it('steps a role size through the pinned-token write', () => {
    const { actions } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Increase the size of --dsw-font-markdown-h1' }))
    expect(actions.setFontOverride).toHaveBeenCalledWith('--dsw-font-markdown-h1', { size: 22, family: 'interface' })
    fireEvent.click(screen.getByRole('button', { name: 'Decrease the size of --dsw-font-markdown-h1' }))
    expect(actions.setFontOverride).toHaveBeenLastCalledWith('--dsw-font-markdown-h1', { size: 20, family: 'interface' })
  })

  it('routes the two axis rows to the axis setters', () => {
    const { actions } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Increase the size of --dsh-content-font-size' }))
    expect(actions.setFontSize).toHaveBeenCalledWith(15)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease the size of --dsh-workspace-font-size' }))
    expect(actions.setWorkspaceFontSize).toHaveBeenCalledWith(13)
    expect(actions.setFontOverride).not.toHaveBeenCalled()
  })

  it('picks a family stack for one token', () => {
    const { actions } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Font family for --dsw-font-markdown-base' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Serif font' }))
    expect(actions.setFontOverride).toHaveBeenCalledWith('--dsw-font-markdown-base', { size: 14, family: 'serif' })
  })

  it('marks a pinned row and releases it back to the shipped composition', () => {
    const { actions } = mount({ fonts: [{ token: '--dsw-font-xs-13', size: 15, family: 'serif' }] })
    expect(screen.getAllByText('Customized')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }))
    expect(actions.clearFontOverride).toHaveBeenCalledWith('--dsw-font-xs-13')
  })

  it('releases an axis row back to its default size', () => {
    const { actions } = mount({ fontSize: 20, workspaceFontSize: 18,
      fonts: [{ token: '--dsh-content-font-size', size: 20 }] })
    const buttons = screen.getAllByRole('button', { name: 'Restore default' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0]!)
    expect(actions.setFontSize).toHaveBeenCalledWith(14)
  })

  it('restores every pin only after an explicit confirmation', () => {
    const { actions } = mount({ fonts: [{ token: '--dsw-font-xs-13', size: 15 }] })
    fireEvent.click(screen.getByRole('button', { name: 'Restore all defaults' }))
    expect(actions.resetFontOverrides).not.toHaveBeenCalled()
    expect(screen.getByText('Restore every font setting?')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(actions.resetFontOverrides).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Restore all defaults' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(actions.resetFontOverrides).toHaveBeenCalledTimes(1)
  })

  it('disables the restore-all control while nothing is pinned', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Restore all defaults' }).hasAttribute('disabled')).toBe(true)
  })
})

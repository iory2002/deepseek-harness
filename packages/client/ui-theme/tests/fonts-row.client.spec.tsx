// @vitest-environment jsdom
/** Font settings entry row: the pinned count and the dialog it opens. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createTypographyStore } from '../src/client/settings-store.ts'
import { FontsRow } from '../src/client/FontsRow.tsx'
import type { FontsRowComponentProps } from '../src/client/FontsRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function mount(fonts: { token: string; size?: number }[] = [], fontSize = 14, workspaceFontSize = 14) {
  const store = createTypographyStore().create()
  store.actions.sync(fontSize, workspaceFontSize, fonts, 0)
  const props: FontsRowComponentProps = {
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: makeTranslate(en),
    setFontSize: vi.fn(),
    setWorkspaceFontSize: vi.fn(),
    setFontOverride: vi.fn(),
    clearFontOverride: vi.fn(),
    resetFontOverrides: vi.fn(),
  }
  render(<FontsRow {...props} />)
  return props
}

describe('FontsRow', () => {
  it('states the shipped composition and opens the table', () => {
    mount()
    expect(screen.getByText('Font settings')).toBeDefined()
    expect(screen.getByText(en['fonts.rowDescription'])).toBeDefined()
    expect(screen.queryByText(/customized/u)).toBeNull()
    // The dialog is closed until the button asks for it.
    expect(screen.queryByText('Token')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open font table' }))
    expect(screen.getByText('Token')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Done' })).toBeDefined()
  })

  it('counts pinned tokens and changed axes so the row never claims to be shipped', () => {
    mount([{ token: '--dsw-font-xs-13', size: 15 }], 18, 14)
    expect(screen.getByText('2 customized')).toBeDefined()
  })
})

// @vitest-environment jsdom
/** Frame arrangement Settings row over a real layout store. */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { createLayoutStore } from '../src/client/stores.ts'
import { ArrangementRow } from '../src/client/settings/ArrangementRow.tsx'
import type { ArrangementRowProps } from '../src/client/settings/ArrangementRow.tsx'
import { en } from '../src/client/locales.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

beforeEach(() => { vi.stubGlobal('innerWidth', 1920) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount() {
  const instance = createLayoutStore().create()
  const props: ArrangementRowProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>({
      ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
    })),
    useSessionStatus: bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map())),
    useSessionRetainInfo: () => undefined,
    useResource,
    useWorkspaces: bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
      items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    })),
    useStore: bindSnapshotSelector(instance),
    actions: instance.actions,
    t: makeTranslate(en),
  }
  render(<ArrangementRow {...props} />)
  return instance
}

describe('ArrangementRow', () => {
  it('shows the shipped arrangement with its description', () => {
    mount()
    expect(screen.getByText('Interface layout')).toBeDefined()
    expect(screen.getByText(en['settings.arrangement.description'])).toBeDefined()
    expect(screen.getByRole('button', { name: /Conversation center/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('selects the workspace center and follows a later arrangement change', () => {
    const instance = mount()
    fireEvent.click(screen.getByRole('button', { name: /Conversation center/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Workspace center' }))
    expect(instance.getSnapshot().layoutInfo.arrangement).toBe('workspace-center')
    expect(screen.getByRole('button', { name: /Workspace center/ })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Workspace center/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Conversation center' }))
    expect(instance.getSnapshot().layoutInfo.arrangement).toBe('conversation-center')
  })
})

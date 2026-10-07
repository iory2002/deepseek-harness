// @vitest-environment jsdom
/** Live arrangement ↔ Host setting bridge, driven through a real layout store. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { bindLayoutArrangement } from '../src/client/arrangement.ts'
import { createLayoutStore } from '../src/client/stores.ts'
import type { LayoutArrangement, LayoutSettings } from '../src/arrangement-settings.ts'

beforeEach(() => { vi.stubGlobal('innerWidth', 1920) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/**
 * Host scope stub: `set` records writes, and the test drives the accepted value
 * directly so adoption and refusal recovery are observable.
 */
function hostScope(accepted: LayoutArrangement) {
  const listeners = new Set<() => void>()
  let snapshot: ConfigFormSnapshot<LayoutSettings> = {
    status: 'ready', value: { arrangement: accepted }, base: undefined, user: undefined,
    revision: 1, writable: true, mode: 'host',
  }
  const notify = (): void => { for (const listener of listeners) listener() }
  const set = vi.fn(async (_field: string, value: unknown): Promise<boolean> => {
    const arrangement = value as LayoutArrangement
    snapshot = { ...snapshot, value: { arrangement } }
    notify()
    return true
  })
  const form: ConfigForm<LayoutSettings> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate: async () => true,
    set,
    unset: async () => true,
  }
  return {
    form,
    set,
    /** Accept a Host value without a client write, as a reload or another window does. */
    accept: (arrangement: LayoutArrangement): void => { snapshot = { ...snapshot, value: { arrangement } }; notify() },
    /** Refuse the last write the way the Host does: reload state, then notify. */
    refuse: (): void => { snapshot = { ...snapshot, value: { arrangement: accepted } }; notify() },
  }
}

describe('layout arrangement binding', () => {
  it('adopts the accepted Host value into the live store', () => {
    const instance = createLayoutStore().create()
    const scope = hostScope('workspace-center')
    const dispose = bindLayoutArrangement(instance, scope.form)
    expect(instance.getSnapshot().layoutInfo.arrangement).toBe('workspace-center')
    scope.accept('conversation-center')
    expect(instance.getSnapshot().layoutInfo.arrangement).toBe('conversation-center')
    scope.accept('workspace-center')
    expect(instance.getSnapshot().layoutInfo.arrangement).toBe('workspace-center')
    dispose()
    scope.accept('conversation-center')
    expect(instance.getSnapshot().layoutInfo.arrangement).toBe('workspace-center')
  })

  it('persists a local choice once and ignores the acceptance echo', () => {
    const instance = createLayoutStore().create()
    const scope = hostScope('conversation-center')
    bindLayoutArrangement(instance, scope.form)
    instance.actions.setArrangement('workspace-center')
    expect(scope.set).toHaveBeenCalledTimes(1)
    expect(scope.set).toHaveBeenCalledWith('arrangement', 'workspace-center')
    expect(instance.getSnapshot().layoutInfo.arrangement).toBe('workspace-center')
    // Re-adopting the same accepted value is not a store change, so no second write.
    scope.accept('workspace-center')
    expect(scope.set).toHaveBeenCalledTimes(1)
  })

  it('reverts the live arrangement when the Host refuses the write', async () => {
    const instance = createLayoutStore().create()
    const scope = hostScope('conversation-center')
    bindLayoutArrangement(instance, scope.form)
    instance.actions.setArrangement('workspace-center')
    scope.refuse()
    await Promise.resolve()
    expect(instance.getSnapshot().layoutInfo.arrangement).toBe('conversation-center')
  })

  it('leaves local choices process-local without a Host scope', () => {
    const instance = createLayoutStore().create()
    const dispose = bindLayoutArrangement(instance)
    instance.actions.setArrangement('workspace-center')
    expect(instance.getSnapshot().layoutInfo.arrangement).toBe('workspace-center')
    dispose()
    expect(instance.getSnapshot().layoutInfo.arrangement).toBe('workspace-center')
  })

  it('writes nothing before the Host accepts a section, or when it refuses writes', () => {
    const pending = createLayoutStore().create()
    const unresolved = hostScope('conversation-center')
    let snapshot: ConfigFormSnapshot<LayoutSettings> = {
      status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: true, mode: 'host',
    }
    const pendingForm: ConfigForm<LayoutSettings> = { ...unresolved.form, getSnapshot: () => snapshot }
    bindLayoutArrangement(pending, pendingForm)
    pending.actions.setSidebar(320)
    pending.actions.setArrangement('workspace-center')
    expect(pending.getSnapshot().layoutInfo.arrangement).toBe('workspace-center')
    expect(unresolved.set).not.toHaveBeenCalled()

    const memory = createLayoutStore().create()
    const local = hostScope('conversation-center')
    snapshot = {
      status: 'ready', value: { arrangement: 'conversation-center' }, base: undefined, user: undefined,
      revision: 1, writable: false, mode: 'memory',
    }
    bindLayoutArrangement(memory, { ...local.form, getSnapshot: () => snapshot })
    memory.actions.setArrangement('workspace-center')
    expect(memory.getSnapshot().layoutInfo.arrangement).toBe('workspace-center')
    expect(local.set).not.toHaveBeenCalled()
  })

  it('ignores unrelated store commits while the accepted arrangement already stands', () => {
    const instance = createLayoutStore().create()
    const scope = hostScope('conversation-center')
    bindLayoutArrangement(instance, scope.form)
    instance.actions.setSidebar(320)
    instance.actions.openRightbar(true, false)
    expect(scope.set).not.toHaveBeenCalled()
  })
})

/**
 * Frame arrangement persistence: the live value is the layout store's, and this
 * bridge keeps it in step with the Host-backed layout setting in both
 * directions — an accepted Host value is adopted, a local choice is written.
 */
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ARRANGEMENT_FIELD } from '../arrangement-settings.ts'
import type { LayoutArrangement, LayoutSettings } from '../arrangement-settings.ts'

/** Live arrangement source and its single mutation, as the layout store declares them. */
export interface LayoutArrangementSource {
  /** @returns the live store snapshot. */
  getSnapshot(): { layoutInfo: { arrangement: LayoutArrangement } }
  /** @param listener - notified after each store commit. @returns the disposer removing it. */
  subscribe(listener: () => void): () => void
  readonly actions: {
    /** Set the live arrangement; the bridge persists it. */
    setArrangement(next: LayoutArrangement): void
  }
}

/**
 * Bind the live arrangement to its Host scope. Without a scope the store keeps
 * the composition default and local choices stay process-local.
 * @param store - the layout store instance shared with the root registration.
 * @param host - shared layout configuration form, when this client exposes one.
 * @returns release callback for both subscriptions.
 */
export function bindLayoutArrangement(store: LayoutArrangementSource, host?: ConfigForm<LayoutSettings>): () => void {
  if (host === undefined) return () => {}
  // Only an accepted, writable section is a persisted value. Before the Host
  // answers (or in memory mode) nothing is durable, so unrelated store commits
  // must not read as pending writes.
  const durable = (): LayoutArrangement | undefined => {
    const snapshot = host.getSnapshot()
    return snapshot.writable ? snapshot.value?.arrangement : undefined
  }
  const adopt = (): void => {
    const accepted = durable()
    if (accepted !== undefined && accepted !== store.getSnapshot().layoutInfo.arrangement) {
      store.actions.setArrangement(accepted)
    }
  }
  const mirror = (): void => {
    const accepted = durable()
    if (accepted === undefined || accepted === store.getSnapshot().layoutInfo.arrangement) return
    void host.set(ARRANGEMENT_FIELD, store.getSnapshot().layoutInfo.arrangement)
  }
  const disposers = [host.subscribe(adopt), store.subscribe(mirror)]
  adopt()
  return () => { for (const dispose of disposers) dispose() }
}

/** Client-owned observation of the optional Desktop companion sizing API. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopCompanionBridge, DesktopCompanionScale, DesktopCompanionSizeView } from '../types.ts'

/** Owns the preload's companion size across the General row's mounts. */
export class CompanionSizeSource {
  /** Framework-observed companion size shown by the General row. */
  readonly store = createSnapshotStore<DesktopCompanionSizeView>({ scale: 1, failed: false })
  private live = true

  /**
   * @param bridge - Isolated Electron companion API; only a shell that offers it registers the row.
   */
  constructor(private readonly bridge: DesktopCompanionBridge) {
    void bridge.size().then((scale) => {
      if (this.live) this.store.set({ scale, failed: false })
    }, () => {
      if (this.live) this.store.set({ ...this.store.getSnapshot(), failed: true })
    })
  }

  /**
   * Ask the shell for one offered size. The choice shows before the shell
   * answers, and a refusal restores the size the shell still holds.
   * @param scale - Offered size the user picked.
   * @returns a promise settled once the shell accepted or refused the size.
   */
  async setSize(scale: DesktopCompanionScale): Promise<void> {
    if (!this.live) return
    const previous = this.store.getSnapshot().scale
    this.store.set({ scale, failed: false })
    await this.bridge.setSize(scale).then((accepted) => {
      if (this.live) this.store.set({ scale: accepted, failed: false })
    }, () => {
      if (this.live) this.store.set({ scale: previous, failed: true })
    })
  }

  /** Detach the carrier and ignore every pending answer. */
  dispose(): void { this.live = false }
}

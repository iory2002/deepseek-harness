/** Type-only Electron update and companion declarations shared by the settings UI and Desktop compatibility checks. */

/** Classified failure copy selected by the Web locale without exposing raw updater diagnostics. */
export type DesktopUpdateFailureKind =
  | 'check'
  | 'check-network'
  | 'download'
  | 'download-network'
  | 'install'
  | 'install-network'
  | 'stop-failed'
  | 'tasks-changed'
  | 'tasks-unavailable'

/** Public semantic preload fields consumed by the settings row. */
export interface DesktopUpdatePresentation {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly percent?: number
  readonly failure?: DesktopUpdateFailureKind
}

/** Optional carrier API; it cannot select artifacts or authorize installation. */
export interface DesktopUpdateBridge {
  status(): Promise<DesktopUpdatePresentation>
  open(): Promise<void>
  subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void
}

/** Shared carrier status for the account row and collapsed sidebar badge. */
export interface DesktopUpdateView {
  readonly presentation?: DesktopUpdatePresentation
  readonly failed: boolean
  readonly opening: boolean
}

/** Offered companion window sizes, smallest first; the shell owns both the window and its steps. */
export type DesktopCompanionScale = 0.85 | 1 | 1.25

/**
 * Optional carrier API for the Electron desktop companion window. It arrived
 * after protocol 1, so consumers feature-detect this member rather than the
 * carrier's protocol version.
 */
export interface DesktopCompanionBridge {
  size(): Promise<DesktopCompanionScale>
  setSize(scale: DesktopCompanionScale): Promise<DesktopCompanionScale>
}

/** Companion size the General row shows; a refused change restores the previous step and raises `failed`. */
export interface DesktopCompanionSizeView {
  readonly scale: DesktopCompanionScale
  readonly failed: boolean
}

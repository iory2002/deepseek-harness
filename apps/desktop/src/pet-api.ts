/** Operations and localized copy available to the isolated companion renderer. */

import type { DesktopWorkPhase, DesktopWorkStatus } from './work-status.ts'
import type { CompanionScale } from './companion-size.ts'

/** Private companion channels, installed only while its window exists. */
export const PET_IPC = {
  presentation: 'dsh-pet:presentation',
  read: 'dsh-pet:read',
  dragStart: 'dsh-pet:drag-start',
  dragEnd: 'dsh-pet:drag-end',
  activate: 'dsh-pet:activate',
  menu: 'dsh-pet:menu',
} as const

/** Localized copy the main process supplies; the renderer owns no product text. */
export interface DesktopPetCopy {
  /** Status chip text, one entry per phase. */
  readonly phases: Readonly<Record<DesktopWorkPhase, string>>
  /** Detail-card labels for each reported count. */
  readonly agents: string
  readonly subagents: string
  readonly jobs: string
  readonly waits: string
  /** Hover hint describing dragging and double-clicking. */
  readonly hint: string
  /** Context-menu entries. */
  readonly open: string
  readonly hide: string
  readonly quit: string
}

/** One status update for the companion window. */
export interface DesktopPetPresentation {
  readonly status: DesktopWorkStatus
  readonly copy: DesktopPetCopy
  /** Whether the companion is marking a work burst the Host just finished. */
  readonly celebrating: boolean
  /** Size step the renderer scales its layout by; the window is this times the design size. */
  readonly scale: CompanionScale
  /** Whole seconds an answer has been owed; 0 when none is pending. Frozen while hidden. */
  readonly waitSeconds: number
  /** Whole seconds the Host has reported `idle`; 0 for every other phase. Frozen while hidden. */
  readonly idleSeconds: number
  /** Whether the local clock is inside the companion's night window. */
  readonly night: boolean
}

/** What the isolated companion renderer may ask the shell to do. */
export interface DesktopPetApi {
  /** @returns the current status and copy, so the first paint needs no empty state. */
  presentation(): Promise<DesktopPetPresentation>
  /** @param listener - status recipient. @returns subscription disposer. */
  onPresentation(listener: (presentation: DesktopPetPresentation) => void): () => void
  /** Move the window with the pointer until {@link endDrag}. */
  beginDrag(): void
  /** Release a drag started by {@link beginDrag}. */
  endDrag(): void
  /** Bring the primary application window forward. */
  activate(): void
  /** Pop up the companion's native context menu. */
  openMenu(): void
}

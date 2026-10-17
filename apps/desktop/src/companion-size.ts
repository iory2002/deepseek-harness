/**
 * Device-local companion size preference in Electron userData: the steps the
 * settings page offers, and the window bounds each one produces.
 * @module
 */

import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/**
 * Window size every step scales from. The renderer lays its contents out for
 * exactly this box and scales the result, so the two never disagree about a
 * position.
 */
export const COMPANION_DESIGN_SIZE = { width: 220, height: 360 } as const

/** Offered companion sizes, smallest first. */
export const COMPANION_SCALES = [0.85, 1, 1.25] as const

/** One offered companion size. */
export type CompanionScale = (typeof COMPANION_SCALES)[number]

/** Step used when nothing usable was stored. */
export const DEFAULT_COMPANION_SCALE: CompanionScale = 1

/** Window bounds one step renders at. */
export interface CompanionBounds {
  readonly width: number
  readonly height: number
}

/**
 * @param scale - Offered step.
 * @returns the window bounds that step renders at.
 */
export function companionBounds(scale: CompanionScale): CompanionBounds {
  return {
    width: Math.round(COMPANION_DESIGN_SIZE.width * scale),
    height: Math.round(COMPANION_DESIGN_SIZE.height * scale),
  }
}

/**
 * @param value - Candidate step, from the preference file or from the renderer.
 * @returns the step, or undefined when this build does not offer it.
 */
export function readCompanionScale(value: unknown): CompanionScale | undefined {
  return COMPANION_SCALES.find(scale => scale === value)
}

/** The companion size preference, backed by one JSON file the shell owns. */
export class CompanionSizeStore {
  /** @param path - Absolute path of the preference file, resolved from Electron userData. */
  constructor(private readonly path: string) {}

  /** @returns the stored step, or the default when the file is absent or unusable. */
  async read(): Promise<CompanionScale> {
    let stored: unknown
    try {
      stored = JSON.parse(await readFile(this.path, 'utf8')) as unknown
    } catch {
      // A missing or unreadable file only costs the default size.
      return DEFAULT_COMPANION_SCALE
    }
    if (typeof stored !== 'object' || stored === null) return DEFAULT_COMPANION_SCALE
    return readCompanionScale((stored as { scale?: unknown }).scale) ?? DEFAULT_COMPANION_SCALE
  }

  /**
   * Store one step.
   * @param scale - Step to persist; the wire boundary validates it before this runs.
   */
  async write(scale: CompanionScale): Promise<void> {
    await writeFileAtomic(this.path, `${JSON.stringify({ scale })}\n`, { mode: 0o600, dirMode: 0o700 })
  }
}

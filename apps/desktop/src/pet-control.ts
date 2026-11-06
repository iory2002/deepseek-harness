/**
 * File bridge to the whale-work companion window.
 *
 * The companion is a separate Electron process owned by a Harness plugin, so the
 * shell cannot call into it. The two sides meet in the Harness home:
 *
 * - the pet publishes its visibility on a heartbeat and reads a requested action,
 * - the pet asks for the shell window to be revealed, and this class answers.
 *
 * The reveal channel exists because the alternative — relaunching the
 * application so its single-instance lock forwards to the running instance —
 * costs about two seconds of Electron startup. A file read costs a frame.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The companion stops publishing once it exits; a heartbeat older than this means it is gone. */
const STALE_MS = 6000

/** How often the shell looks for a reveal request from the companion. */
const REVEAL_POLL_MS = 150

/** Resolve the Harness home the same way the plugin does: `$DSH_HOME`, then `~/.dsh`. */
function harnessHome(): string {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured.trim().length > 0 ? configured : join(homedir(), '.dsh')
}

/** The actions the companion understands. */
export type PetAction = 'show' | 'hide' | 'toggle'

/** Read and drive the companion window's visibility. */
export class PetControl {
  private readonly visiblePath = join(harnessHome(), 'whale-work-pet.visible.json')
  private readonly commandPath = join(harnessHome(), 'whale-work-pet.command.json')
  private readonly revealPath = join(harnessHome(), 'whale-work-pet.open.json')
  private readonly revealAckPath = join(harnessHome(), 'whale-work-pet.open-ack.json')
  private lastReveal = 0

  /**
   * Whether the companion window is on screen right now.
   * @returns true only for a fresh heartbeat that reports a visible window.
   */
  visible(): boolean {
    try {
      const state = JSON.parse(readFileSync(this.visiblePath, 'utf8')) as { visible?: unknown; updatedAt?: unknown }
      const updatedAt = typeof state.updatedAt === 'number' ? state.updatedAt : 0
      if (Date.now() - updatedAt > STALE_MS) return false
      return state.visible === true
    } catch {
      // No companion has ever run, or the file is mid-replacement.
      return false
    }
  }

  /**
   * Ask the companion to change its visibility.
   * @param action - the action to request; the default flips the current state.
   * @returns {void}
   */
  request(action?: PetAction): void {
    const resolved = action ?? (this.visible() ? 'hide' : 'show')
    try {
      writeFileSync(this.commandPath, JSON.stringify({ at: Date.now(), action: resolved }))
    } catch {
      // A missing or unwritable Harness home leaves the tray item as a no-op.
    }
  }

  /**
   * Start answering the companion's requests to reveal the shell window.
   *
   * Every request is acknowledged with the same stamp, so the companion can fall
   * back to relaunching the application when this process is not listening.
   * @param reveal - shows and focuses the shell window.
   * @returns a disposer stopping the poll.
   */
  watchReveal(reveal: () => void): () => void {
    const timer = setInterval(() => {
      let request: { at?: unknown }
      try {
        request = JSON.parse(readFileSync(this.revealPath, 'utf8')) as { at?: unknown }
      } catch {
        return
      }
      const at = typeof request.at === 'number' ? request.at : 0
      if (at <= this.lastReveal) return
      this.lastReveal = at
      reveal()
      try {
        writeFileSync(this.revealAckPath, JSON.stringify({ at }))
      } catch {
        // Without the acknowledgement the companion relaunches instead; the
        // window still appears, just slower.
      }
    }, REVEAL_POLL_MS)
    timer.unref()
    return () => clearInterval(timer)
  }
}

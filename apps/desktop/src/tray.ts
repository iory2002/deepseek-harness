/** Windows system tray: the always-present way back to a hidden window and the explicit quit entry. */

import { Menu, nativeImage, Tray } from 'electron'
import type { DesktopLocale } from './locale.ts'
import type { PetControl } from './pet-control.ts'

/** Main-process actions the tray triggers; both run the same paths as the window and application menu. */
export interface DesktopTrayOptions {
  /** Multi-size ICO rendered by `scripts/render-tray-icon.ts`; Windows picks the bitmap for the display scale. */
  readonly iconPath: string
  readonly locale: () => DesktopLocale
  /** Show and focus the primary window. */
  readonly open: () => void
  /** Request quit through the same confirmation as every other quit entry. */
  readonly quit: () => void
  /** The whale-work companion, when one can be reached. */
  readonly pet?: PetControl
}

/** Tray icon present for the whole run, not only while the window is hidden. */
export class DesktopTray {
  private tray: Tray | undefined

  /** @param options - Icon path, locale reader, open/quit actions, and the optional companion. */
  constructor(private readonly options: DesktopTrayOptions) {
    const tray = new Tray(nativeImage.createFromPath(options.iconPath))
    this.tray = tray
    tray.on('click', () => { options.open() })
    // The menu is rebuilt per right-click: the companion entry names the action
    // that applies right now, and it must not be captured once at startup.
    tray.on('right-click', () => { tray.popUpContextMenu(this.menu()) })
    this.relabel()
  }

  /** Rebuild the tooltip in the current locale. */
  relabel(): void {
    const tray = this.tray
    if (tray === undefined) return
    tray.setToolTip(this.options.locale().messages.aboutProduct)
  }

  /**
   * Build the tray menu for the current state.
   * @returns the menu to show.
   */
  private menu(): Menu {
    const { messages } = this.options.locale()
    const pet = this.options.pet
    const items = [
      { label: messages.openApplication, click: () => { this.options.open() } },
      { type: 'separator' as const },
      ...(pet === undefined
        ? []
        : [{
            label: pet.visible() ? messages.hidePet : messages.showPet,
            click: () => { pet.request() },
          }, { type: 'separator' as const }]),
      { label: messages.quitApplication, click: () => { this.options.quit() } },
    ]
    return Menu.buildFromTemplate(items)
  }

  /** Remove the icon; called once the quit is confirmed so no dead icon outlives the process. */
  dispose(): void {
    const tray = this.tray
    this.tray = undefined
    tray?.destroy()
  }
}

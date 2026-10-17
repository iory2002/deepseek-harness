/**
 * Always-on-top companion window reporting Host work while the application is
 * in the background. The window is frameless, transparent, and moved with the
 * pointer by the shell rather than by a native drag region, so a double-click
 * still reaches the renderer.
 * @module
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { PET_IPC, type DesktopPetCopy, type DesktopPetPresentation } from './pet-api.ts'
import { COMPANION_DESIGN_SIZE, companionBounds, type CompanionScale } from './companion-size.ts'
import type { DesktopLocale } from './locale.ts'
import { isPetNight } from './pet-timing.ts'
import { OFFLINE_WORK_STATUS, STARTING_WORK_STATUS, type DesktopWorkStatus } from './work-status.ts'

/** Companion window width in device-independent pixels at its default size. */
export const PET_WINDOW_WIDTH = COMPANION_DESIGN_SIZE.width
/** Companion window height in device-independent pixels at its default size. */
export const PET_WINDOW_HEIGHT = COMPANION_DESIGN_SIZE.height
/** Gap kept between the companion and the work-area edges of its display. */
export const PET_DEFAULT_MARGIN = 24
/** Status poll period; polling pauses while the companion is hidden. */
export const PET_POLL_INTERVAL_MS = 1_000
/** Pointer sampling period during a drag. */
export const PET_DRAG_INTERVAL_MS = 16
/** How long the companion marks a finished work burst. */
export const PET_CELEBRATION_MS = 2_600
/**
 * Consecutive failed polls before the companion reports the Host offline. One
 * failure is a blip; a companion that keeps claiming work after the Host died
 * is worse than a moment of `offline`.
 */
const PET_OFFLINE_FAILURES = 2

/** Shell-owned collaborators the companion window needs. */
export interface DesktopPetWindowOptions {
  /** Isolated companion preload, as an absolute CommonJS path. */
  readonly preload: string
  /** Current shell dictionary; read on every update so a language change reaches the companion. */
  readonly locale: () => DesktopLocale
  /** Bring the primary application window forward. */
  readonly activate: () => void
  /** Read the Host's current work; rejects when the Host is unavailable. */
  readonly readStatus: () => Promise<DesktopWorkStatus>
  /** File holding the last window position. */
  readonly positionFile: string
  /** Size step the window opens at; the settings page changes it through {@link DesktopPetWindow.setScale}. */
  readonly scale: CompanionScale
  /** Hide the companion from its own context menu. */
  readonly hide: () => void
  /** Quit the application from the companion's context menu. */
  readonly quit: () => void
}

/** Localized companion copy for one shell dictionary. */
export function desktopPetCopy(locale: DesktopLocale): DesktopPetCopy {
  const { messages } = locale
  return {
    phases: {
      starting: messages.petPhaseStarting,
      idle: messages.petPhaseIdle,
      working: messages.petPhaseWorking,
      waiting: messages.petPhaseWaiting,
      subagent: messages.petPhaseSubagent,
      background: messages.petPhaseBackground,
      offline: messages.petPhaseOffline,
    },
    agents: messages.petAgents,
    subagents: messages.petSubagents,
    jobs: messages.petJobs,
    waits: messages.petWaits,
    hint: messages.petHint,
    open: messages.openApplication,
    hide: messages.petHide,
    quit: messages.quitApplication,
  }
}

/** One parsed window position, or undefined when nothing usable was stored. */
function readPosition(value: unknown): { x: number; y: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const { x, y } = candidate
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return undefined
  return { x, y }
}

/** The desktop companion: one transparent window, its status poll, and its pointer drag. */
export class DesktopPetWindow {
  private window: BrowserWindow | undefined
  private poll: ReturnType<typeof setInterval> | undefined
  private polling = false
  private failures = 0
  private status: DesktopWorkStatus = STARTING_WORK_STATUS
  /**
   * Completion count of the last report, or undefined before the first one. A
   * decrease means a new Host process, so it resynchronizes without celebrating.
   */
  private completed: number | undefined
  /** Waking time of the current celebration, or 0 when none is running. */
  private celebratingUntil = 0
  /**
   * When the current owed answer started, or undefined when none is pending.
   * The renderer only sees elapsed seconds, so hiding and reshowing the window
   * cannot suddenly present her as fed up.
   */
  private waitingSince: number | undefined
  /** When the Host last became idle, or undefined while it is doing anything else. */
  private idleSince: number | undefined
  /** Size step the window occupies; every bounds calculation reads it. */
  private scale: CompanionScale
  private drag: {
    readonly cursorX: number
    readonly cursorY: number
    readonly originX: number
    readonly originY: number
    readonly timer: ReturnType<typeof setInterval>
  } | undefined
  private disposeIpc: (() => void) | undefined
  private disposed = false

  /** @param options - Shell collaborators; the window itself is created on first show. */
  constructor(private readonly options: DesktopPetWindowOptions) {
    this.scale = options.scale
  }

  /** @returns whether the companion is on screen; a destroyed or never-shown window is not. */
  get visible(): boolean {
    const window = this.window
    return window !== undefined && !window.isDestroyed() && window.isVisible()
  }

  /** Create the window on first use, show it without stealing focus, and start reporting work. */
  async show(): Promise<void> {
    if (this.disposed) return
    try {
      const window = this.window ?? await this.create()
      // A concurrent dispose destroys the window this call just created.
      if (window === undefined || window.isDestroyed()) return
      if (!window.isVisible()) window.showInactive()
      this.startPolling()
    } catch (error) {
      // The companion is decoration: a window that cannot open must not break the application.
      console.error('desktop companion: could not open its window', error)
      this.dispose()
    }
  }

  /** Take the companion off screen and stop polling until it is shown again. */
  hide(): void {
    this.stopPolling()
    this.finishDrag()
    this.persistPosition()
    // A burst that finishes while the companion is away is not announced later.
    this.completed = undefined
    this.celebratingUntil = 0
    // Elapsed moods restart when she comes back: she was not waiting in front
    // of anyone while the window was hidden.
    this.waitingSince = undefined
    this.idleSince = undefined
    const window = this.window
    if (window !== undefined && !window.isDestroyed()) window.hide()
  }

  /** Toggle the companion; a show is asynchronous and completes on its own. */
  toggle(): void {
    if (this.visible) this.hide()
    else void this.show()
  }

  /** Destroy the window and release its IPC handlers; safe to call more than once. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopPolling()
    this.finishDrag()
    this.disposeIpc?.()
    this.disposeIpc = undefined
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }

  private async create(): Promise<BrowserWindow | undefined> {
    const window = new BrowserWindow({
      ...companionBounds(this.scale),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      title: app.name,
      webPreferences: {
        preload: this.options.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    this.window = window
    window.setAlwaysOnTop(true, 'floating')
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.setMenu(null)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => { event.preventDefault() })
    window.on('closed', () => { if (this.window === window) this.window = undefined })
    const position = readPosition(await this.readStoredPosition()) ?? this.defaultPosition()
    window.setPosition(position.x, position.y, false)
    this.clampToDisplay()
    this.installIpc(window)
    try {
      await window.loadFile(join(app.getAppPath(), 'renderer', 'pet.html'))
    } catch (error) {
      // The companion is decoration: a window that cannot load must not take the application down.
      console.error('desktop companion: failed to load its document', error)
      this.disposeIpc?.()
      this.disposeIpc = undefined
      if (this.window === window) this.window = undefined
      if (!window.isDestroyed()) window.destroy()
      return undefined
    }
    return window
  }

  private async readStoredPosition(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.options.positionFile, 'utf8')) as unknown
    } catch {
      // A missing or malformed position file only costs the default corner.
      return undefined
    }
  }

  private defaultPosition(): { x: number; y: number } {
    const area = screen.getPrimaryDisplay().workArea
    const { width, height } = companionBounds(this.scale)
    return {
      x: area.x + area.width - width - PET_DEFAULT_MARGIN,
      y: area.y + area.height - height - PET_DEFAULT_MARGIN,
    }
  }

  /** Keep the whole window inside the work area of the display it is nearest to. */
  private clampToDisplay(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const { x, y } = window.getBounds()
    const { width, height } = companionBounds(this.scale)
    const area = screen.getDisplayNearestPoint({ x, y }).workArea
    window.setPosition(
      Math.min(Math.max(x, area.x), area.x + area.width - width),
      Math.min(Math.max(y, area.y), area.y + area.height - height),
      false,
    )
  }

  /**
   * Resize the companion to one offered step, keeping its top-left corner and
   * pulling it back inside the display the step just grew past.
   * @param scale - Step the settings page selected; the shell validates it first.
   */
  setScale(scale: CompanionScale): void {
    this.scale = scale
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const { x, y } = window.getBounds()
    window.setBounds({ x, y, ...companionBounds(scale) })
    this.clampToDisplay()
    this.send()
  }

  private persistPosition(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const { x, y } = window.getBounds()
    void writeFile(this.options.positionFile, `${JSON.stringify({ x, y })}\n`, 'utf8')
      .catch((error: unknown) => { console.error('desktop companion: could not store its position', error) })
  }

  private installIpc(window: BrowserWindow): void {
    const owned = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => this.window === window
      && !window.isDestroyed()
      && event.sender === window.webContents
      && event.senderFrame === window.webContents.mainFrame
    const reject = (): never => { throw new Error('desktop companion: rejected action from an unowned frame') }
    const read = (event: IpcMainInvokeEvent): DesktopPetPresentation => (owned(event) ? this.presentation() : reject())
    const dragStart = (event: IpcMainEvent): void => { if (owned(event)) this.beginDrag() }
    const dragEnd = (event: IpcMainEvent): void => { if (owned(event)) this.endDrag() }
    const activate = (event: IpcMainEvent): void => { if (owned(event)) this.options.activate() }
    const menu = (event: IpcMainEvent): void => { if (owned(event)) this.openMenu() }
    ipcMain.handle(PET_IPC.read, read)
    ipcMain.on(PET_IPC.dragStart, dragStart)
    ipcMain.on(PET_IPC.dragEnd, dragEnd)
    ipcMain.on(PET_IPC.activate, activate)
    ipcMain.on(PET_IPC.menu, menu)
    this.disposeIpc = () => {
      ipcMain.removeHandler(PET_IPC.read)
      ipcMain.removeListener(PET_IPC.dragStart, dragStart)
      ipcMain.removeListener(PET_IPC.dragEnd, dragEnd)
      ipcMain.removeListener(PET_IPC.activate, activate)
      ipcMain.removeListener(PET_IPC.menu, menu)
    }
  }

  private openMenu(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const copy = desktopPetCopy(this.options.locale())
    Menu.buildFromTemplate([
      { label: copy.open, click: () => { this.options.activate() } },
      { type: 'separator' },
      { label: copy.hide, click: () => { this.options.hide() } },
      { label: copy.quit, click: () => { this.options.quit() } },
    ]).popup({ window })
  }

  private beginDrag(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed() || this.drag !== undefined) return
    const bounds = window.getBounds()
    const cursor = screen.getCursorScreenPoint()
    const timer = setInterval(() => { this.followPointer() }, PET_DRAG_INTERVAL_MS)
    this.drag = { cursorX: cursor.x, cursorY: cursor.y, originX: bounds.x, originY: bounds.y, timer }
  }

  private followPointer(): void {
    const drag = this.drag
    const window = this.window
    if (drag === undefined || window === undefined || window.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    window.setPosition(drag.originX + (cursor.x - drag.cursorX), drag.originY + (cursor.y - drag.cursorY), false)
  }

  private endDrag(): void {
    const dragged = this.drag !== undefined
    this.finishDrag()
    if (!dragged) return
    this.clampToDisplay()
    this.persistPosition()
  }

  private finishDrag(): void {
    const drag = this.drag
    if (drag === undefined) return
    this.drag = undefined
    clearInterval(drag.timer)
  }

  private startPolling(): void {
    if (this.poll !== undefined) return
    this.poll = setInterval(() => { void this.refresh() }, PET_POLL_INTERVAL_MS)
    void this.refresh()
  }

  private stopPolling(): void {
    const poll = this.poll
    if (poll === undefined) return
    this.poll = undefined
    clearInterval(poll)
  }

  private async refresh(): Promise<void> {
    if (this.polling || this.disposed) return
    this.polling = true
    try {
      const status = await this.options.readStatus()
      this.failures = 0
      this.acceptCompleted(status.completed)
      this.publish(status)
    } catch {
      // An unavailable Host is a state the companion shows, not a shell failure.
      this.failures++
      if (this.failures >= PET_OFFLINE_FAILURES) this.publish(OFFLINE_WORK_STATUS)
    } finally {
      this.polling = false
    }
  }

  /** Mark the burst the Host reports as finished, if this report finished one. */
  private acceptCompleted(completed: number): void {
    const previous = this.completed
    this.completed = completed
    // Only an increase is a finished burst; a decrease is a restarted Host.
    if (previous !== undefined && completed > previous) this.celebratingUntil = Date.now() + PET_CELEBRATION_MS
  }

  private publish(status: DesktopWorkStatus): void {
    // Work that is running again takes the window back from the celebration.
    if (status.phase !== 'idle') this.celebratingUntil = 0
    this.trackMoods(status)
    this.status = status
    this.send()
  }

  /**
   * Start or clear the two elapsed moods. A pending answer is measured by
   * `waits` rather than by `phase`: the phase is what she shows, the count is
   * what is actually true.
   * @param status - Report that just arrived.
   */
  private trackMoods(status: DesktopWorkStatus): void {
    const now = Date.now()
    if (status.waits > 0) this.waitingSince ??= now
    else this.waitingSince = undefined
    if (status.phase === 'idle') this.idleSince ??= now
    else this.idleSince = undefined
  }

  /** @returns whole seconds since one mood started, or 0 when it is not running. */
  private elapsedSeconds(since: number | undefined): number {
    return since === undefined ? 0 : Math.max(0, Math.floor((Date.now() - since) / 1000))
  }

  /** Push the current presentation to the renderer, while it is still there to receive it. */
  private send(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send(PET_IPC.presentation, this.presentation())
  }

  private presentation(): DesktopPetPresentation {
    return {
      status: this.status,
      copy: desktopPetCopy(this.options.locale()),
      celebrating: this.celebratingUntil > Date.now(),
      scale: this.scale,
      waitSeconds: this.elapsedSeconds(this.waitingSince),
      idleSeconds: this.elapsedSeconds(this.idleSince),
      night: isPetNight(new Date()),
    }
  }
}

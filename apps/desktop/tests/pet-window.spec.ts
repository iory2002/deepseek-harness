import type { DesktopPetPresentation } from '../src/pet-api.ts'
import type { DesktopPetWindowOptions } from '../src/pet-window.ts'
import type { DesktopWorkStatus } from '../src/work-status.ts'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import { PET_IPC } from '../src/pet-api.ts'
import { DesktopPetWindow, PET_CELEBRATION_MS, PET_POLL_INTERVAL_MS, PET_WINDOW_HEIGHT, PET_WINDOW_WIDTH, desktopPetCopy } from '../src/pet-window.ts'
import { OFFLINE_WORK_STATUS, STARTING_WORK_STATUS, parseHostWorkStatus } from '../src/work-status.ts'

const working: DesktopWorkStatus = { phase: 'working', agents: 1, subagents: 2, jobs: 3, waits: 0, completed: 0 }
const quiet: DesktopWorkStatus = { phase: 'idle', agents: 0, subagents: 0, jobs: 0, waits: 0, completed: 1 }
const zhCopy = desktopPetCopy(resolveDesktopLocale('zh'))

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')

  class FakeWebContents extends EventEmitter {
    readonly sent: Array<{ channel: string; payload: DesktopPetPresentation }> = []
    readonly mainFrame = { url: 'file:///companion/pet.html' }
    gone = false
    setWindowOpenHandler(): void {}
    isDestroyed(): boolean { return this.gone }
    send(channel: string, payload: DesktopPetPresentation): void { this.sent.push({ channel, payload }) }
  }

  class FakeBrowserWindow extends EventEmitter {
    static readonly instances: FakeBrowserWindow[] = []
    readonly webContents = new FakeWebContents()
    readonly options: Record<string, unknown>
    position = { x: 0, y: 0 }
    size = { width: 0, height: 0 }
    visible = false
    destroyed = false
    level: string | undefined
    menu: unknown
    loaded: string | undefined
    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      this.size = { width: Number(options.width ?? 0), height: Number(options.height ?? 0) }
      FakeBrowserWindow.instances.push(this)
    }
    setAlwaysOnTop(_flag: boolean, level?: string): void { this.level = level }
    setVisibleOnAllWorkspaces(): void {}
    setMenu(menu: unknown): void { this.menu = menu }
    setPosition(x: number, y: number): void { this.position = { x, y } }
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      this.position = { x: bounds.x, y: bounds.y }
      this.size = { width: bounds.width, height: bounds.height }
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return { x: this.position.x, y: this.position.y, ...this.size }
    }
    isDestroyed(): boolean { return this.destroyed }
    isVisible(): boolean { return this.visible }
    showInactive(): void { this.visible = true }
    hide(): void { this.visible = false }
    destroy(): void { this.destroyed = true; this.visible = false; this.emit('closed') }
    loadFile(path: string): Promise<void> { this.loaded = path; return Promise.resolve() }
  }

  type FakeMenuItem = { label?: string; type?: string; click?: () => void }
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>()
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
  const menus: FakeMenuItem[][] = []
  let cursor = { x: 0, y: 0 }
  return {
    FakeBrowserWindow, handlers, listeners, menus,
    setCursor: (value: { x: number; y: number }) => { cursor = value },
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
      removeHandler: (channel: string) => { handlers.delete(channel) },
      on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
        const set = listeners.get(channel) ?? new Set()
        set.add(listener)
        listeners.set(channel, set)
      },
      removeListener: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
        listeners.get(channel)?.delete(listener)
      },
    },
    screen: {
      getPrimaryDisplay: () => ({ workArea }),
      getDisplayNearestPoint: () => ({ workArea }),
      getCursorScreenPoint: () => cursor,
    },
    Menu: { buildFromTemplate: (template: FakeMenuItem[]) => { menus.push(template); return { template, popup: vi.fn() } } },
    app: { name: 'DeepSeek Harness', getAppPath: () => 'C:/app' },
  }
})

const files = vi.hoisted(() => ({ contents: new Map<string, string>(), writes: [] as string[] }))

vi.mock('electron', () => ({
  app: native.app,
  BrowserWindow: native.FakeBrowserWindow,
  ipcMain: native.ipcMain,
  Menu: native.Menu,
  screen: native.screen,
}))
vi.mock('node:fs/promises', () => ({
  readFile: async (path: string) => {
    const value = files.contents.get(path)
    if (value === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return value
  },
  writeFile: async (path: string, content: string) => { files.contents.set(path, content); files.writes.push(path) },
}))

const POSITION_FILE = 'C:/userData/companion-position.json'
const DEFAULT_POSITION = { x: 1920 - PET_WINDOW_WIDTH - 24, y: 1040 - PET_WINDOW_HEIGHT - 24 }

function created(): (typeof native.FakeBrowserWindow.instances)[number] {
  const window = native.FakeBrowserWindow.instances.at(-1)
  if (window === undefined) throw new Error('the companion window was not created')
  return window
}

/** Payloads pushed on the presentation channel, oldest first. */
function pushed(): DesktopPetPresentation[] {
  return created().webContents.sent.filter(message => message.channel === PET_IPC.presentation).map(message => message.payload)
}

function setup(overrides: Partial<DesktopPetWindowOptions> = {}) {
  const readStatus = vi.fn(() => Promise.resolve({ ...working }))
  const activate = vi.fn()
  const hide = vi.fn()
  const quit = vi.fn()
  const companion = new DesktopPetWindow({
    preload: 'C:/app/lib/preload-pet.cjs',
    locale: () => resolveDesktopLocale('zh'),
    activate,
    readStatus,
    positionFile: POSITION_FILE,
    scale: 1,
    hide,
    quit,
    ...overrides,
  })
  return { companion, readStatus, activate, hide, quit }
}

/** Dispatch one channel to the companion as its own renderer would. */
function emit(channel: string): void {
  for (const listener of native.listeners.get(channel) ?? []) {
    listener({ sender: created().webContents, senderFrame: created().webContents.mainFrame })
  }
}

beforeEach(() => {
  native.FakeBrowserWindow.instances.length = 0
  native.handlers.clear()
  native.listeners.clear()
  native.menus.length = 0
  native.setCursor({ x: 0, y: 0 })
  files.contents.clear()
  files.writes.length = 0
  vi.useFakeTimers()
  // A fixed local midday keeps `night` false and the mood clocks deterministic.
  vi.setSystemTime(new Date('2026-05-01T12:00:00'))
})

afterEach(() => { vi.useRealTimers() })

describe('desktop companion window', () => {
  it('opens a frameless transparent always-on-top window in the default corner and loads its document', async () => {
    const f = setup()
    await f.companion.show()
    const window = created()
    expect(window.options).toMatchObject({
      width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT, show: false, frame: false, transparent: true,
      resizable: false, skipTaskbar: true, alwaysOnTop: true,
    })
    expect(window.level).toBe('floating')
    expect(window.loaded).toBe(join('C:/app', 'renderer', 'pet.html'))
    expect(window.position).toEqual(DEFAULT_POSITION)
    expect(window.visible).toBe(true)
    expect(f.companion.visible).toBe(true)
  })

  it('restores a stored position and ignores an unusable one', async () => {
    files.contents.set(POSITION_FILE, '{"x":120,"y":240}')
    await setup().companion.show()
    expect(created().position).toEqual({ x: 120, y: 240 })

    native.FakeBrowserWindow.instances.length = 0
    files.contents.set(POSITION_FILE, '{"x":120}')
    await setup().companion.show()
    expect(created().position).toEqual(DEFAULT_POSITION)
  })

  it('pulls a stored position that no longer fits a display back into the work area', async () => {
    files.contents.set(POSITION_FILE, '{"x":5000,"y":5000}')
    await setup().companion.show()
    expect(created().position).toEqual({ x: 1920 - PET_WINDOW_WIDTH, y: 1040 - PET_WINDOW_HEIGHT })
  })

  it('reports host work with the current locale', async () => {
    const f = setup()
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.readStatus).toHaveBeenCalledOnce()
    expect(pushed()).toHaveLength(1)
    expect(pushed()[0]).toMatchObject({
      status: working, copy: zhCopy, celebrating: false, scale: 1, waitSeconds: 0, idleSeconds: 0, night: false,
    })
    expect(zhCopy.phases.working).toBe('工作中')
    expect(zhCopy.hint).toBe('拖动可移动 · 双击打开应用')
  })

  it('answers a renderer read with the current presentation', async () => {
    const f = setup()
    await f.companion.show()
    const read = native.handlers.get(PET_IPC.read)
    expect(read).toBeDefined()
    expect(read?.({ sender: created().webContents, senderFrame: created().webContents.mainFrame }))
      .toMatchObject({ status: working, copy: zhCopy, celebrating: false, scale: 1, waitSeconds: 0, idleSeconds: 0, night: false })
  })

  it('rejects a read from a frame the window does not own', async () => {
    await setup().companion.show()
    await expect(async () => native.handlers.get(PET_IPC.read)?.({ sender: {}, senderFrame: {} }))
      .rejects.toThrow('unowned frame')
  })

  it('reports the host offline only after repeated failures and recovers on the next report', async () => {
    const f = setup()
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(0)
    f.readStatus.mockRejectedValue(new Error('host is gone'))
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(f.readStatus).toHaveBeenCalledTimes(2)
    expect(pushed().at(-1)).toMatchObject({ status: { phase: 'working' } })
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(f.readStatus).toHaveBeenCalledTimes(3)
    expect(pushed().at(-1)).toMatchObject({ status: OFFLINE_WORK_STATUS, copy: zhCopy, celebrating: false, scale: 1 })
    f.readStatus.mockResolvedValue({ ...working })
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({ status: { phase: 'working' } })
  })

  it('follows the pointer while a drag is open and stores the released position', async () => {
    const f = setup()
    await f.companion.show()
    native.setCursor({ x: 400, y: 400 })
    emit(PET_IPC.dragStart)
    native.setCursor({ x: 460, y: 430 })
    await vi.advanceTimersByTimeAsync(32)
    expect(created().position).toEqual({ x: DEFAULT_POSITION.x + 60, y: DEFAULT_POSITION.y + 30 })
    emit(PET_IPC.dragEnd)
    await vi.advanceTimersByTimeAsync(0)
    expect(files.contents.get(POSITION_FILE)).toBe(`${JSON.stringify(created().position)}\n`)
  })

  it('stops polling while hidden and resumes when shown again', async () => {
    const f = setup()
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(0)
    const polls = f.readStatus.mock.calls.length
    f.companion.hide()
    expect(created().visible).toBe(false)
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS * 3)
    expect(f.readStatus).toHaveBeenCalledTimes(polls)
    await f.companion.show()
    expect(created().visible).toBe(true)
  })

  it('toggles between hidden and shown', async () => {
    const f = setup()
    await f.companion.show()
    f.companion.toggle()
    expect(f.companion.visible).toBe(false)
    f.companion.toggle()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.companion.visible).toBe(true)
  })

  it('routes activation and the context menu through the shell', async () => {
    const f = setup()
    await f.companion.show()
    emit(PET_IPC.activate)
    expect(f.activate).toHaveBeenCalledOnce()
    emit(PET_IPC.menu)
    const template = native.menus.at(-1)
    expect(template?.map(item => item.type === 'separator' ? 'separator' : item.label))
      .toEqual(['打开 DeepSeek Harness', 'separator', '隐藏浮窗', '退出 DeepSeek Harness'])
    template?.[0]?.click?.()
    template?.[2]?.click?.()
    template?.[3]?.click?.()
    expect(f.activate).toHaveBeenCalledTimes(2)
    expect(f.hide).toHaveBeenCalledOnce()
    expect(f.quit).toHaveBeenCalledOnce()
  })

  it('releases its handlers and window on disposal, and refuses further work', async () => {
    const f = setup()
    await f.companion.show()
    f.companion.dispose()
    expect(created().destroyed).toBe(true)
    expect(native.handlers.size).toBe(0)
    expect(native.listeners.get(PET_IPC.dragStart)?.size ?? 0).toBe(0)
    await f.companion.show()
    expect(native.FakeBrowserWindow.instances).toHaveLength(1)
  })
})

describe('companion completion celebration', () => {
  /** Show the companion and let the first report settle, so the next one compares counts. */
  async function opened(report: DesktopWorkStatus) {
    const f = setup()
    f.readStatus.mockResolvedValue(report)
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(0)
    return f
  }

  it('marks the burst the host reports as finished', async () => {
    const f = await opened(working)
    f.readStatus.mockResolvedValue(quiet)
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({
      status: quiet, copy: zhCopy, celebrating: true, scale: 1, waitSeconds: 0, idleSeconds: 0, night: false,
    })
  })

  it('stops marking the burst once it has had its time', async () => {
    const f = await opened(working)
    f.readStatus.mockResolvedValue(quiet)
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({ celebrating: true })
    // The flag clears with the report that follows the celebration, not inside it.
    await vi.advanceTimersByTimeAsync(PET_CELEBRATION_MS + PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({ celebrating: false })
  })

  it('does not mark work that had already finished before the first report', async () => {
    await opened(quiet)
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({ celebrating: false })
  })

  it('does not mark a count that dropped, which is a restarted host', async () => {
    const f = await opened({ ...quiet, completed: 4 })
    f.readStatus.mockResolvedValue(quiet)
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({ status: quiet, copy: zhCopy, celebrating: false, scale: 1 })
  })

  it('gives the window back when work starts again', async () => {
    const f = await opened(working)
    f.readStatus.mockResolvedValue(quiet)
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({ celebrating: true })
    f.readStatus.mockResolvedValue({ ...working, completed: 1 })
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({ status: { phase: 'working' }, celebrating: false })
  })

  it('does not replay a burst that finished while it was hidden', async () => {
    const f = await opened(working)
    f.companion.hide()
    f.readStatus.mockResolvedValue(quiet)
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS * 2)
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({ status: quiet, copy: zhCopy, celebrating: false, scale: 1 })
  })
})

describe('companion mood clock', () => {
  it('counts how long an answer has been owed and clears it once the answer arrives', async () => {
    const waiting: DesktopWorkStatus = { ...working, phase: 'waiting', waits: 1 }
    const f = setup()
    f.readStatus.mockResolvedValue(waiting)
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(pushed().at(-1)).toMatchObject({ waitSeconds: 0 })
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS * 3)
    expect(pushed().at(-1)).toMatchObject({ waitSeconds: 3 })
    f.readStatus.mockResolvedValue({ ...working, phase: 'working', waits: 0 })
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({ waitSeconds: 0 })
  })

  it('counts idle time and drops it as soon as work starts', async () => {
    const f = setup()
    f.readStatus.mockResolvedValue(quiet)
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS * 2)
    expect(pushed().at(-1)).toMatchObject({ idleSeconds: 2 })
    f.readStatus.mockResolvedValue(working)
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS)
    expect(pushed().at(-1)).toMatchObject({ idleSeconds: 0 })
  })

  it('restarts both clocks after the window is hidden and shown again', async () => {
    const waiting: DesktopWorkStatus = { ...working, phase: 'waiting', waits: 1 }
    const f = setup()
    f.readStatus.mockResolvedValue(waiting)
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS * 2)
    expect(pushed().at(-1)).toMatchObject({ waitSeconds: 2 })
    f.companion.hide()
    await vi.advanceTimersByTimeAsync(PET_POLL_INTERVAL_MS * 5)
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(pushed().at(-1)).toMatchObject({ waitSeconds: 0 })
  })

  it('reports night inside the local night window', async () => {
    vi.setSystemTime(new Date('2026-05-01T23:30:00'))
    const f = setup()
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(pushed().at(-1)).toMatchObject({ night: true })
  })
})

describe('companion size step', () => {
  it('opens at the step the stored preference names', async () => {
    const f = setup({ scale: 0.85 })
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(created().options).toMatchObject({ width: 187, height: 306 })
    expect(pushed().at(-1)).toMatchObject({ scale: 0.85 })
  })

  it('keeps a step chosen before the window exists for its first show', async () => {
    const f = setup()
    f.companion.setScale(0.85)
    await f.companion.show()
    expect(created().options).toMatchObject({ width: 187, height: 306 })
  })

  it('resizes to a step the settings page selects and reports it', async () => {
    const f = setup()
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(created().size).toEqual({ width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT })
    f.companion.setScale(1.25)
    expect(created().size).toEqual({ width: 275, height: 450 })
    expect(pushed().at(-1)).toMatchObject({ scale: 1.25 })
  })

  it('pulls a window the larger step pushed past the edge back inside the display', async () => {
    files.contents.set(POSITION_FILE, JSON.stringify({ x: 1920 - PET_WINDOW_WIDTH, y: 1040 - PET_WINDOW_HEIGHT }))
    const f = setup()
    await f.companion.show()
    await vi.advanceTimersByTimeAsync(0)
    f.companion.setScale(1.25)
    expect(created().position).toEqual({ x: 1920 - 275, y: 1040 - 450 })
  })
})

describe('companion work status parsing', () => {
  it('accepts every host phase and count', () => {
    for (const phase of ['idle', 'working', 'waiting', 'subagent', 'background']) {
      expect(parseHostWorkStatus({ phase, agents: 1, subagents: 2, jobs: 3, waits: 4, completed: 5 }))
        .toEqual({ phase, agents: 1, subagents: 2, jobs: 3, waits: 4, completed: 5 })
    }
  })

  it('rejects shell-owned phases, malformed counts, and non-objects', () => {
    expect(parseHostWorkStatus({ phase: 'starting', agents: 0, subagents: 0, jobs: 0, waits: 0, completed: 0 })).toBeUndefined()
    expect(parseHostWorkStatus({ phase: 'offline', agents: 0, subagents: 0, jobs: 0, waits: 0, completed: 0 })).toBeUndefined()
    expect(parseHostWorkStatus({ phase: 'idle', agents: -1, subagents: 0, jobs: 0, waits: 0, completed: 0 })).toBeUndefined()
    expect(parseHostWorkStatus({ phase: 'idle', agents: 0.5, subagents: 0, jobs: 0, waits: 0, completed: 0 })).toBeUndefined()
    expect(parseHostWorkStatus({ phase: 'idle', agents: '1', subagents: 0, jobs: 0, waits: 0, completed: 0 })).toBeUndefined()
    expect(parseHostWorkStatus({ phase: 'idle', agents: 0, subagents: 0, jobs: 0, completed: 0 })).toBeUndefined()
    // Without the completion count a report cannot say whether a burst just ended.
    expect(parseHostWorkStatus({ phase: 'idle', agents: 0, subagents: 0, jobs: 0, waits: 0 })).toBeUndefined()
    expect(parseHostWorkStatus(null)).toBeUndefined()
    expect(parseHostWorkStatus('idle')).toBeUndefined()
  })

  it('names the shell-owned states the host never reports', () => {
    expect(STARTING_WORK_STATUS.phase).toBe('starting')
    expect(OFFLINE_WORK_STATUS.phase).toBe('offline')
  })
})

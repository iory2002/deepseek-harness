import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import { DesktopTray } from '../src/tray.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const trays: FakeTray[] = []
  class FakeTray extends EventEmitter {
    readonly setToolTip = vi.fn()
    readonly popUpContextMenu = vi.fn()
    readonly destroy = vi.fn()
    constructor(readonly image: unknown) { super(); trays.push(this) }
  }
  const menus: MenuItemConstructorOptions[][] = []
  return {
    trays, FakeTray, menus,
    createFromPath: vi.fn((path: string) => ({ path })),
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => { menus.push(template); return { template } }),
  }
})
vi.mock('electron', () => ({
  Tray: native.FakeTray,
  nativeImage: { createFromPath: native.createFromPath },
  Menu: { buildFromTemplate: native.buildFromTemplate },
}))

afterEach(() => { native.trays.length = 0; native.menus.length = 0; vi.clearAllMocks() })

function setup(locale = 'en', petVisible = false) {
  let current = resolveDesktopLocale(locale)
  const open = vi.fn()
  const quit = vi.fn()
  const request = vi.fn()
  const state = { visible: petVisible }
  const tray = new DesktopTray({
    iconPath: 'C:/app/resources/tray.ico',
    locale: () => current,
    open,
    quit,
    pet: { visible: () => state.visible, request } as never,
  })
  return {
    tray, open, quit, request, state, native: native.trays[0]!,
    setLocale: (next: string) => { current = resolveDesktopLocale(next) },
  }
}

function labels(menu: MenuItemConstructorOptions[]): (string | undefined)[] {
  return menu.map(item => item.type === 'separator' ? 'separator' : item.label)
}

it('shows the application icon with its name as the tooltip', () => {
  const f = setup()
  expect(native.createFromPath).toHaveBeenCalledWith('C:/app/resources/tray.ico')
  expect(f.native.image).toEqual({ path: 'C:/app/resources/tray.ico' })
  expect(f.native.setToolTip).toHaveBeenCalledWith('DeepSeek Harness')
})

it('opens the window on a single click', () => {
  const f = setup()
  f.native.emit('click')
  expect(f.open).toHaveBeenCalledOnce()
})

it('builds the menu on each right-click, offering the pet action that applies', () => {
  const f = setup()
  f.native.emit('right-click')
  expect(f.native.popUpContextMenu).toHaveBeenCalledOnce()
  expect(labels(native.menus[0]!)).toEqual([
    'Open DeepSeek Harness', 'separator', 'Show pet', 'separator', 'Quit DeepSeek Harness',
  ])

  f.state.visible = true
  f.native.emit('right-click')
  expect(labels(native.menus[1]!)).toEqual([
    'Open DeepSeek Harness', 'separator', 'Hide pet', 'separator', 'Quit DeepSeek Harness',
  ])
})

it('routes the open, pet, and quit entries to their actions', () => {
  const f = setup()
  f.native.emit('right-click')
  const menu = native.menus[0]!
  ;(menu[0] as { click: () => void }).click()
  ;(menu[2] as { click: () => void }).click()
  ;(menu[4] as { click: () => void }).click()
  expect(f.open).toHaveBeenCalledOnce()
  expect(f.request).toHaveBeenCalledOnce()
  expect(f.quit).toHaveBeenCalledOnce()
})

it('relabels the tooltip and menu in the current locale and ignores relabel after disposal', () => {
  const f = setup()
  f.setLocale('zh')
  f.tray.relabel()
  expect(f.native.setToolTip).toHaveBeenLastCalledWith('DeepSeek Harness')
  f.native.emit('right-click')
  expect(labels(native.menus[0]!)).toEqual([
    '打开 DeepSeek Harness', 'separator', '显示小宠物', 'separator', '退出 DeepSeek Harness',
  ])
  f.tray.dispose()
  f.tray.dispose()
  expect(f.native.destroy).toHaveBeenCalledOnce()
})

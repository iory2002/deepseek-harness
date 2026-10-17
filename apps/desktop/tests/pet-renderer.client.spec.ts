// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DesktopPetPresentation } from '../src/pet-api.ts'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PET_IPC } from '../src/pet-api.ts'

const copy = {
  phases: { starting: '', idle: '', working: '', waiting: '', subagent: '', background: '', offline: '' },
  agents: 'agents',
  subagents: 'subagents',
  jobs: 'jobs',
  waits: 'waits',
  hint: 'hint',
  open: 'open',
  hide: 'hide',
  quit: 'quit',
}

/** One presentation the shell could push. */
function presentation(overrides: Partial<DesktopPetPresentation> = {}): DesktopPetPresentation {
  return {
    status: { phase: 'working', agents: 0, subagents: 0, jobs: 0, waits: 0, completed: 0 },
    copy,
    celebrating: false,
    scale: 1,
    waitSeconds: 0,
    idleSeconds: 0,
    night: false,
    ...overrides,
  }
}

/** The preload surface the renderer expects on `window`. */
const bridge = {
  listeners: [] as Array<(value: DesktopPetPresentation) => void>,
  sent: [] as string[],
  initial: undefined as DesktopPetPresentation | undefined,
  presentation: () => Promise.resolve(bridge.initial),
  onPresentation: (listener: (value: DesktopPetPresentation) => void) => {
    bridge.listeners.push(listener)
    return () => {}
  },
  beginDrag: () => { bridge.sent.push(PET_IPC.dragStart) },
  endDrag: () => { bridge.sent.push(PET_IPC.dragEnd) },
  activate: () => { bridge.sent.push(PET_IPC.activate) },
  openMenu: () => { bridge.sent.push(PET_IPC.menu) },
}

beforeAll(async () => {
  const html = readFileSync(resolve(import.meta.dirname, '../renderer/pet.html'), 'utf8')
  document.documentElement.innerHTML = html
    .replace(/<script[^>]*><\/script>/u, '')
    .replace(/<head>[\s\S]*<\/head>/u, '')

  // jsdom ships neither the Web Animations API nor a media-query list.
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ cancel: vi.fn() })),
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  Object.defineProperty(window, 'dshPet', { configurable: true, value: bridge })
  bridge.initial = presentation()

  await import('../renderer/pet.js')
  await Promise.resolve()
})

describe('companion renderer', () => {
  it('paints a pushed presentation onto the pose the director chose', async () => {
    const waiting = presentation({
      status: { phase: 'waiting', agents: 0, subagents: 0, jobs: 0, waits: 1, completed: 0 },
      waitSeconds: 0,
    })
    for (const listener of bridge.listeners) listener(waiting)
    await Promise.resolve()
    const root = document.getElementById('pet')
    expect(root?.dataset.pose).toBe('work')
    expect(root?.dataset.symbol).toBe('question')
    expect(root?.dataset.prop).toBe('clock')
    expect(document.getElementById('phase')?.textContent).toBe('')
  })

  it('brings the main window forward on a double click', () => {
    bridge.sent.length = 0
    document.getElementById('pet')?.dispatchEvent(new window.Event('dblclick'))
    expect(bridge.sent).toContain(PET_IPC.activate)
  })
})

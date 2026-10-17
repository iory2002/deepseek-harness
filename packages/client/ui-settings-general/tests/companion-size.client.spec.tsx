// @vitest-environment jsdom
/**
 * The Electron-only companion size row: the three offered steps, the size the
 * shell answers with, and the absence the preload feature detection decides in
 * a browser or a shell without the companion API.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { CompanionSizeRow } from '../src/client/CompanionSizeRow.tsx'
import type { CompanionSizeRowInjected } from '../src/client/CompanionSizeRow.tsx'
import { CompanionSizeSource } from '../src/client/companion-size-source.ts'
import { apply } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import type { DesktopCompanionBridge, DesktopCompanionScale, DesktopCompanionSizeView } from '../src/types.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

type RowProps = Parameters<typeof CompanionSizeRow>[0]
type SettingsTranslate = PropsLocale<'settings'>['t']
type AttentionSnapshot = Parameters<Parameters<GlobalStandardProps['useSessionStatus']>[0]>[0]

// Global standard kit stubs: this row consumes none of the standing seats.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const unusedHook = (() => { throw new Error('unused by the companion size row') }) as never
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: RowProps['useSessionStatus'] = selector => selector(noAttention)
const kit = {
  useSessions: unusedHook,
  useSessionStatus,
  usePanelInfo,
  useSessionRetainInfo: () => undefined,
  useResource,
  useWorkspaces: unusedHook,
}

/** Dictionary lookup with parameter substitution, like the production locale chain. */
function translate(dictionary: typeof zh | typeof en): SettingsTranslate {
  const messages: Readonly<Record<string, string>> = dictionary
  return (key, params) => Object.entries(params ?? {})
    .reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
      messages[key] ?? key)
}

/** Render the row over one observed size and the writer under test. */
function mountRow(options: {
  scale?: DesktopCompanionScale
  failed?: boolean
  setSize?: (scale: DesktopCompanionScale) => Promise<void>
  dictionary?: typeof zh | typeof en
} = {}) {
  const state = createSnapshotStore<DesktopCompanionSizeView>({
    scale: options.scale ?? 1, failed: options.failed ?? false,
  })
  const setSize = options.setSize ?? vi.fn(async () => {})
  const view = render(<CompanionSizeRow
    {...kit}
    t={translate(options.dictionary ?? zh)}
    useCompanionSize={bindSnapshotSelector(state)}
    setSize={setSize}
  />)
  return { state, setSize, view }
}

/** One bridge whose size answer the test settles. */
function deferredBridge(initial: DesktopCompanionScale) {
  const answer = Promise.withResolvers<DesktopCompanionScale>()
  const setSize = vi.fn((_scale: DesktopCompanionScale) => answer.promise)
  return { answer, setSize, source: new CompanionSizeSource({ size: async () => initial, setSize }) }
}

describe('CompanionSizeRow', () => {
  it('renders the three steps and marks the current one', () => {
    mountRow({ scale: 1 })
    const list = screen.getByRole('tablist', { name: zh['companionSize.title'] })
    expect(list.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: '中' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '小' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: '大' }).getAttribute('aria-selected')).toBe('false')
  })

  it.each([[0.85, '小'], [1, '中'], [1.25, '大']] as const)('marks the step the shell reports: %s', (scale, label) => {
    mountRow({ scale })
    expect(screen.getByRole('tab', { name: label }).getAttribute('aria-selected')).toBe('true')
  })

  it.each([['小', 0.85], ['大', 1.25]] as const)('asks the shell for the %s step', (label, scale) => {
    const { setSize } = mountRow({ scale: 1 })
    fireEvent.click(screen.getByRole('tab', { name: label }))
    expect(setSize).toHaveBeenCalledExactlyOnceWith(scale)
  })

  it('renders every step label from the active locale', () => {
    mountRow({ dictionary: en })
    expect(screen.getByText(en['companionSize.title'])).toBeTruthy()
    expect(screen.getByRole('tab', { name: en['companionSize.small'] })).toBeTruthy()
    expect(screen.getByRole('tab', { name: en['companionSize.medium'] })).toBeTruthy()
    expect(screen.getByRole('tab', { name: en['companionSize.large'] })).toBeTruthy()
  })

  it.each([[zh], [en]])('shows the localized failure notice %#', (dictionary) => {
    mountRow({ failed: true, dictionary })
    expect(screen.getByRole('alert').textContent).toBe(dictionary['companionSize.error'])
  })

  it('shows the failure copy when the shell refuses the chosen size', async () => {
    const source = new CompanionSizeSource({
      size: async () => 1,
      setSize: async () => { throw new Error('refused') },
    })
    render(<CompanionSizeRow
      {...kit}
      t={translate(zh)}
      useCompanionSize={bindSnapshotSelector(source.store)}
      setSize={scale => source.setSize(scale)}
    />)
    fireEvent.click(screen.getByRole('tab', { name: '大' }))
    expect((await screen.findByRole('alert')).textContent).toBe(zh['companionSize.error'])
    // The step the shell still holds stays selected.
    expect(screen.getByRole('tab', { name: '中' }).getAttribute('aria-selected')).toBe('true')
    source.dispose()
  })
})

describe('CompanionSizeSource', () => {
  it('adopts the size the shell reports', async () => {
    const source = new CompanionSizeSource({ size: async () => 1.25, setSize: async scale => scale })
    expect(source.store.getSnapshot()).toEqual({ scale: 1, failed: false })
    await waitFor(() => { expect(source.store.getSnapshot()).toEqual({ scale: 1.25, failed: false }) })
    source.dispose()
  })

  it('reports a failed size read and keeps the current step', async () => {
    const source = new CompanionSizeSource({
      size: async () => { throw new Error('no companion') },
      setSize: async scale => scale,
    })
    await waitFor(() => { expect(source.store.getSnapshot()).toEqual({ scale: 1, failed: true }) })
    source.dispose()
  })

  it('shows the chosen step immediately and adopts the step the shell accepts', async () => {
    const f = deferredBridge(0.85)
    const pending = f.source.setSize(1.25)
    expect(f.setSize).toHaveBeenCalledExactlyOnceWith(1.25)
    expect(f.source.store.getSnapshot()).toEqual({ scale: 1.25, failed: false })
    f.answer.resolve(1)
    await pending
    expect(f.source.store.getSnapshot()).toEqual({ scale: 1, failed: false })
    f.source.dispose()
  })

  it('keeps the previous step and reports a refused size', async () => {
    const f = deferredBridge(1)
    const pending = f.source.setSize(0.85)
    f.answer.reject(new Error('refused'))
    await pending
    expect(f.source.store.getSnapshot()).toEqual({ scale: 1, failed: true })
    f.source.dispose()
  })

  it('ignores every answer that arrives after disposal', async () => {
    // A size read that lands after the row unloads changes nothing.
    const size = Promise.withResolvers<DesktopCompanionScale>()
    const stale = new CompanionSizeSource({ size: () => size.promise, setSize: async scale => scale })
    stale.dispose()
    size.reject(new Error('late read'))
    await Promise.resolve()
    expect(stale.store.getSnapshot()).toEqual({ scale: 1, failed: false })

    // An accepted size that lands after the row unloads keeps only the optimistic step.
    const accepted = Promise.withResolvers<DesktopCompanionScale>()
    const settled = new CompanionSizeSource({ size: async () => 1, setSize: () => accepted.promise })
    const adopted = settled.setSize(1.25)
    settled.dispose()
    accepted.resolve(0.85)
    await adopted
    expect(settled.store.getSnapshot()).toEqual({ scale: 1.25, failed: false })

    // A refused size that lands after the row unloads raises no notice.
    const denied = Promise.withResolvers<DesktopCompanionScale>()
    const rejected = new CompanionSizeSource({ size: async () => 1, setSize: () => denied.promise })
    const pending = rejected.setSize(0.85)
    rejected.dispose()
    denied.reject(new Error('late refusal'))
    await pending
    expect(rejected.store.getSnapshot()).toEqual({ scale: 0.85, failed: false })
  })

  it('stops asking the shell once the row is unloaded', async () => {
    const f = deferredBridge(1)
    f.source.dispose()
    await f.source.setSize(0.85)
    expect(f.setSize).not.toHaveBeenCalled()
    expect(f.source.store.getSnapshot()).toEqual({ scale: 1, failed: false })
  })
})

/** One registered row, as the slot ledger receives it. */
interface RegisteredRow {
  readonly name?: string
  readonly id?: string
  readonly order?: number
  readonly locale?: string
  readonly inject?: () => CompanionSizeRowInjected
}

/** Apply this plugin over a stub ledger and the given preload carrier. */
function boot(carrier: unknown) {
  vi.stubGlobal('dshDesktop', carrier)
  const rows: RegisteredRow[] = []
  const disposers: (() => void)[] = []
  const ctx = {
    effect: (install: () => (() => void) | undefined) => {
      const dispose = install()
      if (dispose !== undefined) disposers.push(dispose)
    },
    get: () => ({ state: createSnapshotStore('connected'), reconnect: () => {} }),
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    remote: { $host: { isLoopback: false } },
    configForms: { developerTools: { enabled: createSnapshotStore(false), setEnabled: async () => {} } },
    shortcuts: { register: () => () => {} },
    slots: {
      inject: (_name: string, install: () => (() => void) | undefined) => {
        const dispose = install()
        if (dispose !== undefined) disposers.push(dispose)
      },
      register: (options: RegisteredRow, component: unknown) => {
        const row: RegisteredRow & { component: unknown } = { ...options, component }
        rows.push(row)
        return () => { rows.splice(rows.indexOf(row), 1) }
      },
    },
  }
  apply(ctx as never)
  return { rows, disposers }
}

describe('companion size registration', () => {
  it('seats the row and drives it through the preload companion API', async () => {
    const setSize = vi.fn(async (scale: DesktopCompanionScale) => scale)
    const companion: DesktopCompanionBridge = { size: async () => 0.85, setSize }
    const booted = boot({ protocolVersion: 1, companion })
    const row = booted.rows.find(entry => entry.id === 'companion-size')!
    expect(row).toMatchObject({ name: 'settings.general.item', order: 20, locale: 'settings' })
    const injected = row.inject!()
    await waitFor(() => { expect(injected.hooks.companionSize.getSnapshot()).toEqual({ scale: 0.85, failed: false }) })
    await injected.setSize(1.25)
    expect(setSize).toHaveBeenCalledExactlyOnceWith(1.25)
    expect(injected.hooks.companionSize.getSnapshot()).toEqual({ scale: 1.25, failed: false })
    // Unloading the plugin detaches the carrier: a later write reaches neither the shell nor the store.
    for (const dispose of booted.disposers.reverse()) dispose()
    await injected.setSize(1)
    expect(setSize).toHaveBeenCalledOnce()
    expect(injected.hooks.companionSize.getSnapshot()).toEqual({ scale: 1.25, failed: false })
  })

  it.each([
    ['a browser', undefined],
    ['a shell without the companion API', { protocolVersion: 1 }],
  ])('registers no row in %s', (_where, carrier) => {
    const booted = boot(carrier)
    expect(booted.rows.some(entry => entry.id === 'companion-size')).toBe(false)
    // The ownerless rows this package always supplies are still seated.
    expect(booted.rows.some(entry => entry.id === 'current-version')).toBe(true)
    expect(booted.rows.some(entry => entry.id === 'developer-tools')).toBe(true)
  })
})

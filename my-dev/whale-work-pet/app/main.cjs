/**
 * Standalone desktop window for the whale-work pet.
 *
 * A frameless, transparent, always-on-top BrowserWindow that reads the same
 * session projection cache the host plugin folds and paints one whale girl.
 * It never talks to the Harness HTTP surface: the renderer gets state over IPC,
 * and the animation clips load from the package's own `assets/` directory over
 * `file://`, so no route, port, or credential is involved.
 *
 * `WHALE_PET_OPTIONS` (JSON) carries the row's config from the host half;
 * `WHALE_PET_SNAPSHOT` asks for one captured frame and an immediate exit, which
 * is how the window is verified without a human looking at the desktop.
 */

const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron')
const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const HERE = __dirname
const PACKAGE = join(HERE, '..')

/** Row config forwarded by the host half. */
const OPTIONS = (() => {
  try {
    return JSON.parse(process.env.WHALE_PET_OPTIONS ?? '{}')
  } catch {
    return {}
  }
})()

const SIZE = typeof OPTIONS.size === 'number' && OPTIONS.size > 0 ? OPTIONS.size : 220
const MARGIN = typeof OPTIONS.margin === 'number' ? OPTIONS.margin : 24
const ALWAYS_ON_TOP = OPTIONS.alwaysOnTop !== false
const SNAPSHOT = process.env.WHALE_PET_SNAPSHOT

/** The Harness process that spawned this window; a hard crash there leaves no disposer. */
const PARENT_PID = Number(process.env.WHALE_PET_PARENT_PID ?? 0)

/** Card + pill + stage, so the card can open upward without resizing the window. */
const WINDOW_WIDTH = SIZE + 60
const WINDOW_HEIGHT = SIZE + 210

/** Poll cadence for the live snapshot the host half publishes. */
const TICK_MS = 200

/** How often the throttled disk fold is consulted when no live snapshot is fresh. */
const FOLD_MS = 1200

/** A live snapshot older than this means the host half stopped publishing. */
const LIVE_FRESH_MS = 2500

/** The host half's live snapshot file, next to the rest of the Harness home. */
const LIVE_FILE = 'whale-work-pet.live.json'

let win = null
let dragOrigin = null
let timer = null
let foldAt = 0
let stateDirectory = null

/**
 * Resolve the Electron binary to run this app with.
 *
 * The host half runs inside the Harness process, whose own `node_modules` do not
 * hold Electron, so the path is either configured, exported, or found in the
 * pnpm store of the checkout this package lives in.
 *
 * @param {object} options - row config, possibly carrying `electronPath`.
 * @returns {string | null} an absolute executable path, or null when unavailable.
 */
function resolveElectron(options) {
  const { existsSync, readdirSync } = require('node:fs')
  const candidates = []
  if (typeof options.electronPath === 'string') candidates.push(options.electronPath)
  if (typeof process.env.DSH_ELECTRON_PATH === 'string') candidates.push(process.env.DSH_ELECTRON_PATH)
  for (const root of [join(PACKAGE, '..', '..', '..'), process.cwd()]) {
    const store = join(root, 'node_modules', '.pnpm')
    if (!existsSync(store)) continue
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith('electron@')) continue
      candidates.push(join(store, entry, 'node_modules', 'electron', 'dist', 'electron.exe'))
    }
  }
  return candidates.find(candidate => existsSync(candidate)) ?? null
}

/**
 * Resolve the Harness home once, through the host half's own resolution order,
 * and keep the imported module so repeat folds cost nothing.
 * @returns {Promise<{home: string, sessions: string, module: object}>} the resolved paths.
 */
async function harness() {
  if (stateDirectory !== null) return stateDirectory
  const module = await import(pathToFileURL(join(PACKAGE, 'index.js')).href)
  const home = module.__testing__.resolveDshHome()
  stateDirectory = {
    home,
    sessions: join(home, 'storages', 'session_projcache', 'sessions'),
    module,
  }
  return stateDirectory
}

/**
 * Fold the projection cache once. This is the fallback path: the Harness
 * throttles the cache flush, so it trails the host by seconds.
 * @returns {Promise<object>} the state payload the renderer paints.
 */
async function readFolded() {
  const harnessPaths = await harness()
  return harnessPaths.module.__testing__.readState(harnessPaths.sessions)
}

/**
 * Read the host half's live snapshot when it is still fresh.
 * @param {number} now - current epoch milliseconds.
 * @returns {Promise<object | null>} the payload, or null when absent or stale.
 */
async function readLive(now) {
  try {
    const harnessPaths = await harness()
    const text = await readFile(join(harnessPaths.home, LIVE_FILE), 'utf8')
    const payload = JSON.parse(text)
    const age = typeof payload.liveAt === 'number' ? now - payload.liveAt : Number.POSITIVE_INFINITY
    if (!(age < LIVE_FRESH_MS)) return null
    // `detail.staleMs` is left as the fold reported it: the phase is event-driven
    // and current, while the numbers behind it come from the throttled cache.
    return { ...payload, source: 'live' }
  } catch {
    return null
  }
}

/** Place the window near the bottom-right corner of the primary work area. */
function placeWindow() {
  const area = screen.getPrimaryDisplay().workArea
  win.setPosition(
    Math.round(area.x + area.width - WINDOW_WIDTH - MARGIN),
    Math.round(area.y + area.height - WINDOW_HEIGHT - MARGIN),
  )
}

/** Create the transparent companion window. */
function createWindow() {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: ALWAYS_ON_TOP,
    focusable: true,
    show: false,
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  if (ALWAYS_ON_TOP) win.setAlwaysOnTop(true, 'floating')
  win.setMenuBarVisibility(false)
  // Click-through by default; the renderer re-enables input over the artwork.
  win.setIgnoreMouseEvents(true, { forward: true })
  placeWindow()
  win.loadFile(join(HERE, 'pet.html'), {
    query: { size: String(SIZE), open: process.env.WHALE_PET_SNAPSHOT_OPEN === '1' ? '1' : '0' },
  })

  win.once('ready-to-show', () => {
    // A hidden window produces no frames, so even the snapshot path shows it.
    win.showInactive()
  })

  win.on('closed', () => {
    win = null
    app.quit()
  })
}

/**
 * Push the freshest payload to the renderer.
 *
 * The host half publishes a live snapshot on every Cordis event, so the normal
 * path costs one small file read and reacts within a frame. Only when that file
 * is missing or stale does this fall back to folding the throttled projection
 * cache, and then no more often than `FOLD_MS`.
 * @returns {Promise<void>} resolves once the payload has been handed over.
 */
async function pushState() {
  if (win === null || win.isDestroyed()) return
  const now = Date.now()
  try {
    let state = await readLive(now)
    if (state === null) {
      if (now - foldAt < FOLD_MS) return
      foldAt = now
      state = await readFolded()
    }
    if (win !== null && !win.isDestroyed()) win.webContents.send('whale:state', state)
  } catch (error) {
    if (win !== null && !win.isDestroyed()) {
      win.webContents.send('whale:state', { phase: 'unknown', detail: { reason: String(error?.message ?? error) } })
    }
  }
}

ipcMain.on('whale:drag-start', () => {
  if (win === null) return
  const [x, y] = win.getPosition()
  dragOrigin = { x, y }
})

ipcMain.on('whale:drag-move', (_event, delta) => {
  if (win === null || dragOrigin === null) return
  if (typeof delta?.dx !== 'number' || typeof delta?.dy !== 'number') return
  win.setPosition(Math.round(dragOrigin.x + delta.dx), Math.round(dragOrigin.y + delta.dy))
})

ipcMain.on('whale:drag-end', () => {
  dragOrigin = null
})

ipcMain.on('whale:ignore-mouse', (_event, ignore) => {
  if (win === null) return
  win.setIgnoreMouseEvents(ignore === true, { forward: true })
})

ipcMain.on('whale:hide', () => {
  if (win !== null) win.hide()
})

ipcMain.on('whale:menu', () => {
  if (win === null) return
  Menu.buildFromTemplate([
    { label: '隐藏', click: () => win?.hide() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]).popup({ window: win })
})

app.whenReady().then(async () => {
  createWindow()
  await pushState()
  timer = setInterval(() => { void pushState() }, TICK_MS)

  if (SNAPSHOT !== undefined) {
    setTimeout(async () => {
      try {
        const image = await win.capturePage()
        await writeFile(SNAPSHOT, image.toPNG())
      } finally {
        app.quit()
      }
    }, 2600)
  }
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  if (timer !== null) clearInterval(timer)
})

// A crashed or killed Harness never runs its disposer, so the window watches the
// process that spawned it and leaves on its own.
if (PARENT_PID > 0) {
  setInterval(() => {
    try {
      process.kill(PARENT_PID, 0)
    } catch {
      app.quit()
    }
  }, 5000)
}

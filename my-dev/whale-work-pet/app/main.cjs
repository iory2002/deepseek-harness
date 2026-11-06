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

const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen } = require('electron')
const { spawn } = require('node:child_process')
const { appendFile, readFile, writeFile } = require('node:fs/promises')
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

/** The desktop application a double-click opens; empty when the host could not name one. */
const APP_PATH = (() => {
  const candidate = process.env.WHALE_PET_APP ?? ''
  if (candidate.length === 0) return ''
  // A source launch reports the runtime binary, not the app; opening that would
  // spawn a stray console window instead of the desktop client.
  const base = candidate.slice(candidate.lastIndexOf('\\') + 1).slice(candidate.lastIndexOf('/') + 1).toLowerCase()
  return base === 'node.exe' || base === 'electron.exe' || base === 'node' || base === 'electron' ? '' : candidate
})()

/** Card + pill + stage, so the card can open upward without resizing the window. */
const WINDOW_WIDTH = SIZE + 60
const WINDOW_HEIGHT = SIZE + 210

/** Append-only trace of window-side actions; empty disables it. */
const LOG = process.env.WHALE_PET_LOG ?? ''

/**
 * Append one diagnostic line.
 * @param {string} message - what happened.
 * @returns {void}
 */
function log(message) {
  if (LOG.length === 0) return
  appendFile(LOG, `${new Date().toISOString()} ${message}\n`).catch(() => {})
}

// Keep the trace to the current window generation, so it cannot grow forever.
if (LOG.length > 0) {
  writeFile(LOG, '').then(() => log(`start pid=${process.pid} parent=${PARENT_PID} app=${APP_PATH || '(raise)'}`)).catch(() => {})
}

/** Poll cadence for the live snapshot the host half publishes. */
const TICK_MS = 200

/** How often the throttled disk fold is consulted when no live snapshot is fresh. */
const FOLD_MS = 1200

/** A live snapshot older than this means the host half stopped publishing. */
const LIVE_FRESH_MS = 2500

/** The host half's live snapshot file, next to the rest of the Harness home. */
const LIVE_FILE = 'whale-work-pet.live.json'

let win = null
let tray = null
let dragOrigin = null
let timer = null
let foldAt = 0
let stateDirectory = null

/** Bring the window back after a hide, keeping it above other windows. */
function showWindow() {
  if (win === null || win.isDestroyed()) return
  win.show()
  if (ALWAYS_ON_TOP) win.setAlwaysOnTop(true, 'floating')
  log('show')
}

/** Hide the window; the tray icon is the way back. */
function hideWindow() {
  if (win === null || win.isDestroyed()) return
  win.hide()
  log('hide')
}

/** Whether the pet is currently on screen. */
const windowVisible = () => win !== null && !win.isDestroyed() && win.isVisible()

/**
 * The PowerShell that raises the Harness window.
 *
 * Neither `WScript.Shell.AppActivate` nor a bare `SetForegroundWindow` works
 * from a background process: Windows' foreground lock swallows both and reports
 * success. Attaching to the foreground thread's input queue releases the lock,
 * and `SwitchToThisWindow` covers the case where it still refuses.
 *
 * The window is found by walking up the process ancestry for the first ancestor
 * that owns a visible window — a source launch reports a bare runtime, so the
 * executable path cannot be used.
 */
const RAISE_SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Raise {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);
}
"@
$id = __WHALE_PARENT__
$hwnd = [IntPtr]::Zero
while ($id -gt 0) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p -and $p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle; break }
  $id = (Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue).ParentProcessId
}
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "no-window"; exit 1 }
$fgPid = 0
$fgThread = [Raise]::GetWindowThreadProcessId([Raise]::GetForegroundWindow(), [ref]$fgPid)
$me = [Raise]::GetCurrentThreadId()
[void][Raise]::AttachThreadInput($me, $fgThread, $true)
if ([Raise]::IsIconic($hwnd)) { [void][Raise]::ShowWindow($hwnd, 9) }
[void][Raise]::BringWindowToTop($hwnd)
$set = [Raise]::SetForegroundWindow($hwnd)
[void][Raise]::SetActiveWindow($hwnd)
[void][Raise]::AttachThreadInput($me, $fgThread, $false)
if ([Raise]::GetForegroundWindow() -ne $hwnd) { [Raise]::SwitchToThisWindow($hwnd, $true) }
Start-Sleep -Milliseconds 150
$front = [Raise]::GetForegroundWindow().ToInt64()
Write-Output "raise set=$set foreground=$front target=$($hwnd.ToInt64())"
`

/**
 * Bring the DeepSeek Harness desktop window to the front.
 *
 * The pet only exists while the Harness runs, so "open" almost always means
 * "raise". A packaged host reports its own executable, which is launched first
 * (its single-instance lock focuses the existing window); everything else walks
 * the process ancestry and raises the window directly.
 * @returns {void}
 */
function openApp() {
  if (APP_PATH.length > 0) {
    try {
      spawn(APP_PATH, [], { detached: true, stdio: 'ignore' }).unref()
      log(`open-app: launched ${APP_PATH}`)
      return
    } catch {
      // A moved or uninstalled app falls through to the ancestry walk.
    }
  }
  if (process.platform !== 'win32' || PARENT_PID <= 0) {
    log('open-app: no path and no ancestry walk available')
    return
  }
  const script = RAISE_SCRIPT.replace('__WHALE_PARENT__', String(PARENT_PID))
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', chunk => log(`open-app: ${String(chunk).trim()}`))
  child.stderr?.on('data', chunk => log(`open-app stderr: ${String(chunk).trim()}`))
  child.on('error', error => log(`open-app failed: ${error.message}`))
  child.on('exit', code => log(`open-app powershell exit ${code}`))
}

/**
 * Build the show/hide menu. The two states are exclusive: whichever is true now
 * is the only one offered, so the list never says both.
 * @returns {object} a menu template.
 */
function toggleTemplate() {
  const visible = windowVisible()
  return [
    { label: visible ? '隐藏小宠物' : '显示小宠物', click: visible ? hideWindow : showWindow },
    { type: 'separator' },
    { label: '打开 DeepSeek Harness', click: openApp },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]
}

/**
 * Put an icon in the notification area, so a hidden window can always come back.
 * @returns {void}
 */
function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(join(HERE, 'tray.png')))
  } catch (error) {
    log(`tray failed: ${error.message}`)
    return
  }
  tray.setToolTip('鲸鱼娘工作台')
  tray.setContextMenu(Menu.buildFromTemplate(toggleTemplate()))
  tray.on('click', () => {
    if (windowVisible()) hideWindow()
    else showWindow()
  })
  log('tray created')
}

/** Rebuild the tray menu so it reflects the current visibility. */
function refreshTray() {
  if (tray === null) return
  tray.setContextMenu(Menu.buildFromTemplate(toggleTemplate()))
}

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
    log('window shown')
  })

  // The tray menu offers only the action that applies, so it is rebuilt on
  // every visibility change.
  win.on('show', refreshTray)
  win.on('hide', refreshTray)

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
  hideWindow()
})

ipcMain.on('whale:open-app', () => {
  openApp()
})

ipcMain.on('whale:menu', () => {
  if (win === null) return
  log('context menu')
  Menu.buildFromTemplate(toggleTemplate()).popup({ window: win })
})

app.whenReady().then(async () => {
  createWindow()
  // The snapshot path is a one-shot capture; a tray icon would outlive it.
  if (SNAPSHOT === undefined) {
    createTray()
    // A shortcut that does not depend on finding the tray icon in the overflow.
    const ok = globalShortcut.register('Control+Alt+P', () => {
      if (windowVisible()) hideWindow()
      else showWindow()
    })
    log(`hotkey Control+Alt+P registered=${ok}`)
  }
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
  globalShortcut.unregisterAll()
  if (tray !== null) {
    tray.destroy()
    tray = null
  }
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

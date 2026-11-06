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

const { app, BrowserWindow, Menu, globalShortcut, ipcMain, screen } = require('electron')
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

/** Status pill above the artwork, so the window is the pet plus its label. */
const WINDOW_WIDTH = SIZE + 60
const WINDOW_HEIGHT = SIZE + 56

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

/**
 * File channel to the Harness desktop tray, which cannot talk to this process
 * directly. The pet publishes its visibility and polls for a requested action;
 * `<HOME>` arrives from the host half so both sides agree on one directory.
 */
const HOME = process.env.WHALE_PET_HOME ?? ''
const VISIBLE_FILE = HOME.length > 0 ? join(HOME, 'whale-work-pet.visible.json') : ''
const COMMAND_FILE = HOME.length > 0 ? join(HOME, 'whale-work-pet.command.json') : ''
const OPEN_FILE = HOME.length > 0 ? join(HOME, 'whale-work-pet.open.json') : ''
const OPEN_ACK_FILE = HOME.length > 0 ? join(HOME, 'whale-work-pet.open-ack.json') : ''

/** Commands written before this window existed are ignored. */
let lastCommandAt = Date.now()

let win = null
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
  publishVisibility()
}

/** Hide the window; the hotkey or the right-click menu brings it back. */
function hideWindow() {
  if (win === null || win.isDestroyed()) return
  win.hide()
  log('hide')
  publishVisibility()
}

/** Whether the pet is currently on screen. */
const windowVisible = () => win !== null && !win.isDestroyed() && win.isVisible()

/**
 * Publish the current visibility for the desktop tray. A heartbeat as well as an
 * edge: a stale file tells the tray the pet is gone.
 * @returns {void}
 */
function publishVisibility() {
  if (VISIBLE_FILE.length === 0) return
  writeFile(VISIBLE_FILE, JSON.stringify({ visible: windowVisible(), updatedAt: Date.now() })).catch(() => {})
}

/**
 * Apply one requested action from the desktop tray, if it is newer than the last
 * one seen. Everything else (bad JSON, a half-written file, an old request) is
 * ignored rather than applied.
 * @returns {Promise<void>} resolves once the check finishes.
 */
async function pollCommand() {
  if (COMMAND_FILE.length === 0) return
  let command
  try {
    command = JSON.parse(await readFile(COMMAND_FILE, 'utf8'))
  } catch {
    return
  }
  const at = typeof command?.at === 'number' ? command.at : 0
  if (at <= lastCommandAt) return
  lastCommandAt = at
  if (command.action === 'show') showWindow()
  else if (command.action === 'hide') hideWindow()
  else if (command.action === 'toggle') {
    if (windowVisible()) hideWindow()
    else showWindow()
  }
  log(`command ${command.action}`)
}

/**
 * The PowerShell that brings the Harness desktop forward.
 *
 * Two cases, because "closed" and "behind another window" need different moves:
 *
 * - A window still exists: raise it. Neither `WScript.Shell.AppActivate` nor a
 *   bare `SetForegroundWindow` works from a background process — Windows'
 *   foreground lock swallows both and reports success — so the script attaches to
 *   the foreground thread's input queue and falls back to `SwitchToThisWindow`.
 * - No window exists (the user closed it to the tray): relaunch the application
 *   with the command line of the process that owns it. Its single-instance lock
 *   routes the launch to the running instance, which recreates and shows the
 *   window. Inspector and debugging flags are dropped so the new process cannot
 *   fight over those ports.
 *
 * The owning process is identified by `--user-data-dir`, not by executable path:
 * a source launch runs a bare `electron` with the application directory as an
 * argument, and the host process in this tree has its own command line.
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
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@
$id = __WHALE_PARENT__
$hwnd = [IntPtr]::Zero
$appExe = ''
$appCommand = ''
while ($id -gt 0) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
  if (-not $process) { break }
  if ($hwnd -eq [IntPtr]::Zero) {
    $running = Get-Process -Id $id -ErrorAction SilentlyContinue
    # A closed-to-tray window keeps its handle but loses its title and visibility;
    # raising that handle does nothing, so only a titled, visible window counts.
    if ($running -and $running.MainWindowHandle -ne 0 -and $running.MainWindowTitle -ne '' -and [Raise]::IsWindowVisible($running.MainWindowHandle)) {
      $hwnd = $running.MainWindowHandle
    }
  }
  if ($appExe -eq '' -and $process.CommandLine -like '*--user-data-dir*') {
    $appExe = $process.ExecutablePath
    $appCommand = $process.CommandLine
  }
  $id = $process.ParentProcessId
}

if ($hwnd -ne [IntPtr]::Zero) {
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
  Write-Output "raise set=$set foreground=$([Raise]::GetForegroundWindow().ToInt64()) target=$($hwnd.ToInt64())"
  exit 0
}

if ($appExe -ne '' -and $appCommand -ne '') {
  $offset = $appCommand.IndexOf($appExe)
  $rest = if ($offset -ge 0) { $appCommand.Substring($offset + $appExe.Length).Trim() } else { '' }
  $parts = @($rest -split '\s+' | Where-Object { $_ -ne '' -and $_ -notlike '--inspect*' -and $_ -notlike '--remote-debugging-port*' })
  $workdir = $null
  if ($parts.Count -gt 0 -and (Test-Path -LiteralPath $parts[-1] -PathType Container)) { $workdir = $parts[-1] }
  $start = @{ FilePath = $appExe; ArgumentList = $parts }
  if ($workdir) { $start.WorkingDirectory = $workdir }
  # These turn the child into a plain Node process, which would exit without
  # ever asking the running instance to show its window.
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Remove-Item Env:ELECTRON_NO_ATTACH_CONSOLE -ErrorAction SilentlyContinue
  Start-Process @start -ErrorAction Stop | Out-Null
  Write-Output "relaunch $appExe $($parts -join ' ')"
  exit 0
}

Write-Output 'no-window'
exit 1
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
  // Fast path: the running shell answers a file request in about a frame.
  void askShellToReveal().then((answered) => {
    if (answered) return
    log('open-app: no acknowledgement, falling back to relaunch')
    relaunchShell()
  })
}

/**
 * Ask the running shell to show its window through the Harness home.
 *
 * Relaunching the application so its single-instance lock forwards costs about
 * two seconds of Electron startup; this costs one file write and a poll.
 * @returns {Promise<boolean>} true when the shell acknowledged the request.
 */
async function askShellToReveal() {
  if (OPEN_FILE.length === 0 || OPEN_ACK_FILE.length === 0) return false
  const at = Date.now()
  try {
    await writeFile(OPEN_FILE, JSON.stringify({ at }))
  } catch {
    return false
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 60))
    try {
      const ack = JSON.parse(await readFile(OPEN_ACK_FILE, 'utf8'))
      if (typeof ack?.at === 'number' && ack.at >= at) {
        log('open-app: reveal acknowledged')
        return true
      }
    } catch {
      // No acknowledgement yet; keep waiting for the rest of the budget.
    }
  }
  return false
}

/**
 * Fall back to launching the application again and letting its single-instance
 * lock route the launch to the running instance.
 * @returns {void}
 */
function relaunchShell() {
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
    { label: '喂小鱼干', click: () => playClip('snack.webm') },
    { label: '摸摸头', click: () => playClip('react-happy.webm') },
    { label: '让她打扫', click: () => playClip('cleaning.webm') },
    { type: 'separator' },
    { label: '打开 DeepSeek Harness', click: openApp },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]
}

/**
 * Play one animation because a menu entry asked for it.
 * @param {string} clip - the asset file name to show.
 * @returns {void}
 */
function playClip(clip) {
  if (win === null || win.isDestroyed()) return
  win.webContents.send('whale:play', clip)
  log(`menu play ${clip}`)
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
  win.loadFile(join(HERE, 'pet.html'), { query: { size: String(SIZE) } })

  win.once('ready-to-show', () => {
    // A hidden window produces no frames, so even the snapshot path shows it.
    win.showInactive()
    log('window shown')
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
  // The snapshot path is a one-shot capture; a hotkey would outlive it.
  if (SNAPSHOT === undefined) {
    // The way back to a hidden pet when its own menu is out of reach.
    const ok = globalShortcut.register('Control+Alt+P', () => {
      if (windowVisible()) hideWindow()
      else showWindow()
    })
    log(`hotkey Control+Alt+P registered=${ok}`)
  }
  await pushState()
  timer = setInterval(() => { void pushState() }, TICK_MS)

  if (SNAPSHOT === undefined) {
    publishVisibility()
    setInterval(publishVisibility, 2000)
    setInterval(() => { void pollCommand() }, 400)
  }

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

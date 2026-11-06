/**
 * Host half of the whale-work-pet bundle.
 *
 * The pet lives in its own always-on-top Electron window: `apply` spawns that
 * process and kills it when the plugin deactivates. The window does not use the
 * Harness HTTP surface at all — it imports this module's fold directly and
 * renders the vendored clips over `file://`, so the desktop path needs no route,
 * port, or credential.
 *
 * Three jobs here:
 *
 * 1. Launch and own the window process; `electronPath`, `launch`, `size`,
 *    `margin`, and `alwaysOnTop` come from the row's `config`.
 * 2. `GET /api/whale-work/state` folds what the Harness agent is doing right now
 *    out of the session projection cache, for anything else that wants the same
 *    answer. The cache is a documented, versioned, atomically written artifact;
 *    folding it needs no Harness package import, which matters because a
 *    profile-installed bundle cannot resolve a bare `@deepseek-ai/...` specifier
 *    at activation.
 * 3. `GET /pet-assets/<clip>.webm` serves the vendored animations to HTTP
 *    consumers; the desktop window reads the same files from disk.
 *
 * Live Cordis events only ever *shorten* latency here: an event can promote the
 * folded phase to `working` for at most `LIVE_BOOST_MS`, and never demotes or
 * pins a phase. A missed or renamed event therefore costs freshness, never
 * correctness — the disk fold stays authoritative.
 *
 * Every tunable is read from the row's `config` object rather than a declared
 * `Config`, because a schemastery schema cannot be imported in this package.
 */

import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { appendFile, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, normalize, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'whale-work-pet'

/** `webServer` serves both routes; without it the plugin stays inactive instead of throwing. */
export const inject = ['webServer']

/** Prefix route for the vendored animation clips. A prefix matches itself and `p/<anything>`. */
const ASSET_ROUTE = '/pet-assets'

/** Exact route the overlay polls. */
const STATE_ROUTE = '/api/whale-work/state'

/** Cache files are small; refuse anything implausible rather than parsing it. */
const MAX_CACHE_BYTES = 8 * 1024 * 1024

/** Only projection files touched within this window are considered candidates. */
const CANDIDATE_FRESH_MS = 15 * 60 * 1000

/** Files the state is folded from, newest first, before giving up. */
const MAX_CANDIDATES = 8

/**
 * How recently a session must have been touched to represent "the agent right
 * now". Older sessions still contribute a `waiting` state, because a question
 * that has sat unanswered is exactly what a companion should point at, but they
 * never make the whale look busy or freshly done.
 */
const ACTIVE_WINDOW_MS = 10 * 60 * 1000

/** A completion this recent still reads as `done` rather than falling back to `idle`. */
const DONE_WINDOW_MS = 90 * 1000

/** A live `working` hint from Cordis events expires after this long. */
const LIVE_BOOST_MS = 45 * 1000

/**
 * The live snapshot the desktop window prefers over the throttled disk fold.
 * Written to the Harness home, so no port, route, or credential is needed.
 */
const LIVE_FILE = 'whale-work-pet.live.json'

/** Coalesce a burst of events into one write. */
const PUBLISH_DEBOUNCE_MS = 30

/** How often the disk fold refreshes the detail behind the live phase. */
const FOLD_INTERVAL_MS = 2000

/** Every answer is per-request state; nothing about it may be cached. */
const NO_STORE = { 'cache-control': 'no-store' }

/** Package root, used to resolve `assets/` without trusting the request path. */
const PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url))

/** Resolved once: the only directory the asset route may read from. */
const ASSET_DIR = join(PACKAGE_ROOT, 'assets')

const CONTENT_TYPES = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.png': 'image/png',
}

/**
 * Expand a leading `~` to the user's home directory.
 * @param {string} path - a path that may start with `~`, `~/`, or `~\`.
 * @returns {string} the expanded path.
 */
function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the Harness home: an explicit path wins, then a non-blank `$DSH_HOME`,
 * then `~/.dsh`, matching `@deepseek-ai/dsh-home-paths`.
 * @param {string} [configured] - explicit override with the highest precedence.
 * @returns {string} the normalized absolute Harness home.
 */
function resolveDshHome(configured) {
  const fromEnv = process.env.DSH_HOME
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh'))
  return resolvePath(expandHome(selected))
}

/**
 * Read one projection row's value. Row values are envelope-wrapped
 * (`{ ver, seq, val }`), and a null `val` means the projection is unset.
 * @param {object} rows - the projection cache's `record.rows`.
 * @param {string} key - row name.
 * @returns {unknown} the unwrapped value, or undefined.
 */
function rowValue(rows, key) {
  if (typeof rows !== 'object' || rows === null) return undefined
  const row = rows[key]
  if (typeof row !== 'object' || row === null) return undefined
  return row.val
}

/**
 * Fold one session projection document into the whale's phase vocabulary.
 *
 * The phases come straight from documented projection fields:
 * `sessionStats.openStep` and `pendingCalls` mean work in flight;
 * `userQuestions.questions.active` means the agent is blocked on a person;
 * an open turn with no open step means the turn is winding down; a closed turn
 * that ended on a step boundary means the turn finished.
 *
 * @param {object} doc - a parsed `session_projcache` document.
 * @returns {{phase: string, detail: object}} the phase name and its evidence.
 */
function foldSession(doc) {
  const rows = doc?.record?.rows
  const stats = rowValue(rows, 'sessionStats') ?? {}
  const turn = rowValue(rows, 'turnBoundary') ?? {}
  const questions = rowValue(rows, 'userQuestions')
  const pressure = rowValue(rows, 'contextPressure')

  const active = questions?.questions?.active
  const activeQuestions = Array.isArray(active) ? active.length : 0
  const pendingCalls = stats?.pendingCalls
  const pending = typeof pendingCalls === 'object' && pendingCalls !== null ? Object.keys(pendingCalls).length : 0
  const openStep = stats?.openStep
  const openTurn = turn?.openTurnStartSeq
  const startedAt = typeof openStep?.startTime === 'number' ? openStep.startTime : null
  const contextPercent = typeof pressure?.contextWindow === 'number' && pressure.contextWindow > 0
    ? Math.round((Number(pressure.pressureTokens) / pressure.contextWindow) * 100)
    : null

  const detail = {
    openTurn: openTurn ?? null,
    openStep: openStep === undefined || openStep === null ? null : { turn: openStep.turn, step: openStep.step },
    pendingCalls: pending,
    activeQuestions,
    lastStepKind: turn?.lastStepBoundary?.kind ?? null,
    lastTurn: turn?.lastTurn ?? null,
    startedAt,
    steps: typeof stats.steps === 'number' ? stats.steps : null,
    contextPercent,
  }

  if (activeQuestions > 0) return { phase: 'waiting', detail }
  if (pending > 0 || (openStep !== undefined && openStep !== null)) return { phase: 'working', detail }
  if (openTurn !== undefined && openTurn !== null) return { phase: 'working', detail }
  if (detail.lastStepKind === 'end') return { phase: 'done', detail }
  return { phase: 'idle', detail }
}

/**
 * List plausible projection cache files, newest first.
 * @param {string} dir - the projection cache session directory.
 * @returns {Promise<Array<{path: string, mtimeMs: number}>>} candidates within the freshness window.
 */
async function listCandidates(dir) {
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const cutoff = Date.now() - CANDIDATE_FRESH_MS
  const found = []
  for (const entry of names) {
    if (!entry.endsWith('.json')) continue
    const path = join(dir, entry)
    try {
      const info = await stat(path)
      if (info.isFile() && info.size > 0 && info.size <= MAX_CACHE_BYTES && info.mtimeMs >= cutoff) {
        found.push({ path, mtimeMs: info.mtimeMs })
      }
    } catch {
      // A cache entry may be replaced between listing and stat; skipping it is correct.
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return found.slice(0, MAX_CANDIDATES)
}

/**
 * Fold whale phase across every projection the route can see.
 *
 * A person running several sessions expects the whale to react to whichever is
 * asking for attention, so a single session's state is not enough: any session
 * waiting on a person outranks any session that is busy, which in turn outranks
 * a recent completion. `sessions` reports every candidate for debugging.
 *
 * @param {string} dir - the projection cache session directory.
 * @returns {Promise<object>} the payload body, carrying the disk phase and detail.
 */
async function readState(dir) {
  const sampledAt = Date.now()
  const candidates = await listCandidates(dir)
  if (candidates.length === 0) {
    return basePayload(sampledAt, { reason: 'no recent session projection found', sessions: [] }, 'unknown')
  }

  const sessions = []
  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate.path, 'utf8')
      const folded = foldSession(JSON.parse(text))
      sessions.push({
        id: candidate.path.replace(/^.*[\\/]/, '').replace(/\.json$/, ''),
        phase: folded.phase,
        detail: folded.detail,
        mtimeMs: candidate.mtimeMs,
      })
    } catch {
      // A malformed or half-written cache entry loses this candidate only.
    }
  }

  if (sessions.length === 0) {
    return basePayload(sampledAt, { reason: 'no readable session projection', sessions: [] }, 'unknown')
  }

  // Rank by urgency, but only let a recent session claim a non-waiting phase:
  // "the agent is working" must describe work happening now, not last week.
  const rank = { waiting: 3, working: 2, done: 1, idle: 0 }
  const freshBefore = sampledAt - ACTIVE_WINDOW_MS
  const eligible = sessions.filter(session => session.phase === 'waiting' || session.mtimeMs >= freshBefore)
  const pool = eligible.length > 0 ? eligible : sessions

  const winner = pool.reduce((best, current) => {
    const delta = (rank[current.phase] ?? 0) - (rank[best.phase] ?? 0)
    if (delta !== 0) return delta > 0 ? current : best
    return current.mtimeMs > best.mtimeMs ? current : best
  })

  const staleMs = sampledAt - winner.mtimeMs
  let phase = winner.phase
  // A completion only reads as `done` while it is still news.
  if (phase === 'done' && staleMs > DONE_WINDOW_MS) phase = 'idle'

  return {
    phase,
    detail: {
      ...winner.detail,
      sessionId: winner.id,
      staleMs,
      sessions: sessions.map(session => ({ id: session.id, phase: session.phase, mtimeMs: session.mtimeMs })),
    },
    source: 'projcache',
    sampledAt: new Date(sampledAt).toISOString(),
  }
}

/**
 * Build the payload for a fold that found no usable session.
 * @param {number} sampledAt - fold timestamp in epoch milliseconds.
 * @param {object} detail - the reason and empty session list.
 * @param {string} missingPhase - the phase to report when nothing was found.
 * @returns {object} the payload body.
 */
function basePayload(sampledAt, detail, missingPhase) {
  return {
    phase: missingPhase,
    detail: { ...detail },
    source: 'projcache',
    sampledAt: new Date(sampledAt).toISOString(),
  }
}

/**
 * Combine the disk phase with the live event facts.
 *
 * The live facts are always fresher than the projection cache, so they win
 * whenever they have something to say: a person being asked something outranks
 * any work in flight, work in flight outranks a stale `idle`/`done` on disk, and
 * a turn that just closed shows `done` until the fold catches up.
 *
 * @param {{running: boolean, waiting: number, lastIdleAt: number}} live - event facts.
 * @param {string} diskPhase - the phase the projection cache currently implies.
 * @returns {string} the phase to report.
 */
function overlayPhase(live, diskPhase) {
  if (live.waiting > 0) return 'waiting'
  if (live.running) return diskPhase === 'waiting' ? 'waiting' : 'working'
  if (live.lastIdleAt > 0 && Date.now() - live.lastIdleAt < DONE_WINDOW_MS) return 'done'
  return diskPhase
}

/**
 * Read the tool name out of a `tools/execute` payload without assuming one
 * field name; an unexpected payload yields null instead of throwing inside the
 * waterfall.
 * @param {unknown} exec - the dispatch execution passed to the waterfall.
 * @returns {string | null} the called tool's name.
 */
function toolNameOf(exec) {
  if (typeof exec !== 'object' || exec === null) return null
  const candidates = [exec.name, exec.tool?.name, exec.call?.name, exec.request?.name]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return null
}

/**
 * Deny a request the shared connection layer would reject, mirroring the
 * profile's other local plugins.
 * @param {object} ctx - Host context.
 * @returns {((req: object, res: object) => boolean) | null} a guard, or null when the check is unavailable.
 */
function createRouteGuard(ctx) {
  const connection = ctx.get('connection')
  if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') return null
  return (req, res) => {
    const rejection = connection.requestRejection(req)
    if (rejection === undefined) return false
    res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    return true
  }
}

/**
 * Resolve one requested asset to a path inside `assets/`.
 * @param {string} requested - the decoded request path below the asset prefix.
 * @returns {string | null} the absolute file path, or null when it escapes the directory.
 */
function resolveAsset(requested) {
  if (requested.length === 0 || requested.includes('\0')) return null
  const candidate = resolvePath(ASSET_DIR, normalize(requested))
  if (candidate !== ASSET_DIR && !candidate.startsWith(ASSET_DIR + sep)) return null
  return candidate
}

/**
 * Stream one animation clip to the page.
 * @param {string} file - absolute path inside `assets/`.
 * @param {object} req - the incoming request.
 * @param {object} res - the server response.
 * @returns {Promise<void>} resolves once the response has been handed to the stream.
 */
async function sendAsset(file, req, res) {
  let info
  try {
    info = await stat(file)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  if (!info.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  const extension = file.slice(file.lastIndexOf('.'))
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'content-length': String(info.size),
    'cache-control': 'public, max-age=3600',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('error', reject)
    res.on('close', resolve)
    stream.pipe(res)
  })
}

/**
 * Activate the plugin: one state route, one asset route, and the optional live
 * event hints.
 * @param {object} ctx - Host context.
 * @param {object} [config] - the row's `config` object.
 * @returns {void}
 */
export function apply(ctx, config) {
  const dshHome = resolveDshHome(config?.dshHome)
  const sessionsDir = join(dshHome, 'storages', 'session_projcache', 'sessions')
  const guard = createRouteGuard(ctx)

  /**
   * Live phase facts, updated by Cordis events. The disk fold stays
   * authoritative for *detail* (step counts, context, tool history) and for the
   * fallback phase; these facts are what let the window flip within a frame
   * instead of waiting for the throttled projection cache.
   */
  const live = { running: false, waiting: 0, lastTool: null, lastEventAt: 0, lastIdleAt: 0 }

  // Diagnostic tap: with `config.debug`, every delivered event lands in one
  // append-only line, which is how the push path is measured end to end.
  const debugLog = config?.debug === true ? join(dshHome, 'whale-work-pet.events.log') : null
  const note = (kind, extra) => {
    if (debugLog === null) return
    appendFile(debugLog, `${Date.now()} ${kind} ${JSON.stringify(extra ?? {})}\n`).catch(() => {})
  }

  const liveFile = join(dshHome, LIVE_FILE)

  /** Last completed disk fold; refreshed on a timer, never on the event path. */
  let folded = { phase: 'unknown', detail: {}, source: 'projcache' }
  let publishTimer = null
  let publishing = false
  let queued = false

  /**
   * Combine the cached fold with the live facts.
   * @returns {object} the payload both the window and the HTTP route report.
   */
  const snapshot = () => ({
    ...folded,
    phase: overlayPhase(live, folded.phase),
    detail: {
      ...folded.detail,
      waiting: live.waiting,
      lastTool: live.lastTool,
      liveHintAgeMs: live.lastEventAt > 0 ? Date.now() - live.lastEventAt : null,
    },
    liveAt: Date.now(),
  })

  /**
   * Publish the snapshot for the desktop window. The write is atomic, and a
   * burst of events collapses into one write instead of one per event.
   * @returns {Promise<void>} resolves once the file holds the newest snapshot.
   */
  async function publish() {
    if (publishing) {
      queued = true
      return
    }
    publishing = true
    try {
      const payload = snapshot()
      const text = JSON.stringify(payload)
      const temporary = `${liveFile}.${process.pid}.tmp`
      await writeFile(temporary, text)
      await rename(temporary, liveFile)
      note('publish', {
        phase: payload.phase,
        sinceEventMs: live.lastEventAt > 0 ? Date.now() - live.lastEventAt : null,
      })
    } catch (error) {
      ctx.logger?.warn?.('whale-work-pet: live snapshot failed: %s', error?.message ?? String(error))
    } finally {
      publishing = false
      if (queued) {
        queued = false
        void publish()
      }
    }
  }

  /** Debounced publish used by every event handler. */
  const schedulePublish = () => {
    if (publishTimer !== null) return
    publishTimer = setTimeout(() => {
      publishTimer = null
      void publish()
    }, PUBLISH_DEBOUNCE_MS)
  }

  // Refresh the detail behind the live phase; this is the only disk I/O on the
  // steady path, and it runs at a fixed cadence rather than per event.
  ctx.effect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const next = await readState(sessionsDir)
        if (!alive) return
        folded = next
        await publish()
      } catch (error) {
        ctx.logger?.warn?.('whale-work-pet: state read failed: %s', error?.message ?? String(error))
      }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, FOLD_INTERVAL_MS)
    return () => {
      alive = false
      clearInterval(timer)
      if (publishTimer !== null) {
        clearTimeout(publishTimer)
        publishTimer = null
      }
    }
  }, 'whale-work-pet: live snapshot')

  // `global: true` makes the listener scope-independent: these events are
  // emitted on an Agent-scoped context, while this plugin lives at the root.
  ctx.effect(() => ctx.on('agent/status', (payload) => {
    note('agent/status', { status: payload?.status })
    if (payload?.status === 'running') {
      live.running = true
      live.lastIdleAt = 0
    } else {
      live.running = false
      live.waiting = 0
      live.lastIdleAt = Date.now()
    }
    live.lastEventAt = Date.now()
    schedulePublish()
  }, { global: true }), 'whale-work-pet: agent status')

  ctx.effect(() => ctx.on('tools/execute', async (exec, next) => {
    const tool = toolNameOf(exec)
    note('tools/execute', { tool })
    live.lastEventAt = Date.now()
    live.running = true
    live.lastIdleAt = 0
    if (tool !== null) live.lastTool = tool
    schedulePublish()
    return next()
  }, { global: true }), 'whale-work-pet: tool calls')

  // Both asks are waterfalls: incrementing around `next()` reports the wait from
  // the moment the person is asked until the decision lands.
  ctx.effect(() => ctx.on('approval/request', async (request, next) => {
    note('approval/request')
    live.waiting += 1
    live.lastEventAt = Date.now()
    schedulePublish()
    try {
      return await next()
    } finally {
      live.waiting = Math.max(0, live.waiting - 1)
      schedulePublish()
    }
  }, { global: true }), 'whale-work-pet: approvals')

  ctx.effect(() => ctx.on('user-questions/request', async (request, next) => {
    note('user-questions/request')
    live.waiting += 1
    live.lastEventAt = Date.now()
    schedulePublish()
    try {
      return await next()
    } finally {
      live.waiting = Math.max(0, live.waiting - 1)
      schedulePublish()
    }
  }, { global: true }), 'whale-work-pet: questions')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATE_ROUTE,
    handler: async (req, res) => {
      if (guard !== null && guard(req, res)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
        res.end('method not allowed')
        return
      }
      const text = JSON.stringify(snapshot())
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(text)),
        ...NO_STORE,
      })
      res.end(req.method === 'HEAD' ? undefined : text)
    },
  }), 'whale-work-pet: state route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ASSET_ROUTE,
    handler: async (req, res) => {
      if (guard !== null && guard(req, res)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
        res.end('method not allowed')
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const requested = decodeURIComponent(url.pathname.slice(ASSET_ROUTE.length)).replace(/^\/+/, '')
      const file = resolveAsset(requested)
      if (file === null) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('bad asset path')
        return
      }
      await sendAsset(file, req, res)
    },
  }), 'whale-work-pet: asset route')

  ctx.logger?.info?.('whale-work-pet: serving %s and %s from %s', STATE_ROUTE, ASSET_ROUTE, sessionsDir)

  if (config?.launch !== false) launchWindow(ctx, config)
}

/**
 * Resolve the Electron binary that runs the window.
 *
 * The Harness process has no dependency on Electron, so the executable comes
 * from the row's `electronPath`, then `$DSH_ELECTRON_PATH`, then the pnpm store
 * of the checkout this package sits in. A published install would need the first
 * two; resolving the sibling store keeps a source checkout zero-config.
 *
 * @param {object} [config] - the row's config object.
 * @returns {string | null} an absolute executable path, or null when none exists.
 */
function resolveElectron(config) {
  const candidates = []
  if (typeof config?.electronPath === 'string' && config.electronPath.length > 0) candidates.push(config.electronPath)
  if (typeof process.env.DSH_ELECTRON_PATH === 'string') candidates.push(process.env.DSH_ELECTRON_PATH)
  // `<repo>/my-dev/<package>` → `<repo>`: the source checkout's pnpm store.
  const roots = [join(PACKAGE_ROOT, '..', '..'), process.cwd()]
  for (const root of roots) {
    const store = join(root, 'node_modules', '.pnpm')
    let entries
    try {
      entries = readdirSync(store)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('electron@')) continue
      const dist = join(store, entry, 'node_modules', 'electron', 'dist')
      // A half-materialised store entry can hold the executable without its ICU
      // data; Electron then dies at startup instead of opening a window.
      if (!existsSync(join(dist, 'icudtl.dat'))) continue
      candidates.push(join(dist, process.platform === 'win32' ? 'electron.exe' : 'electron'))
    }
  }
  return candidates.find(candidate => existsSync(candidate)) ?? null
}

/**
 * Spawn the standalone window and tie its lifetime to this plugin's fiber.
 * @param {object} ctx - Host context.
 * @param {object} [config] - the row's config object.
 * @returns {void}
 */
function launchWindow(ctx, config) {
  const electron = resolveElectron(config)
  if (electron === null) {
    ctx.logger?.warn?.('whale-work-pet: no Electron binary found; set config.electronPath to open the desktop window')
    return
  }

  const options = {
    size: typeof config?.size === 'number' && config.size > 0 ? config.size : 220,
    margin: typeof config?.margin === 'number' ? config.margin : 24,
    alwaysOnTop: config?.alwaysOnTop !== false,
  }

  ctx.effect(() => {
    const env = {
      ...process.env,
      WHALE_PET_OPTIONS: JSON.stringify(options),
      // The window leaves by itself if this process dies without a disposer.
      WHALE_PET_PARENT_PID: String(process.pid),
    }
    // Both flags turn Electron into a plain Node process; inherited from a
    // launcher they would leave a windowless child that silently exits.
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_NO_ATTACH_CONSOLE
    const child = spawn(electron, [join(PACKAGE_ROOT, 'app', 'main.cjs')], {
      cwd: PACKAGE_ROOT,
      env,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.on('error', (error) => {
      ctx.logger?.warn?.('whale-work-pet: window failed to start: %s', error?.message ?? String(error))
    })
    child.on('exit', (code) => {
      ctx.logger?.info?.('whale-work-pet: window exited with code %s', code)
    })
    ctx.logger?.info?.('whale-work-pet: desktop window started from %s', electron)
    return () => {
      // The window is a child of this process; killing the plugin closes it.
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }
  }, 'whale-work-pet: desktop window')
}

/**
 * Test surface. The Loader only reads `apply`/`inject`, so these exports cost
 * nothing at runtime and let a verifier exercise the fold against real session
 * projections without booting a Harness.
 */
export const __testing__ = { foldSession, readState, listCandidates, resolveDshHome, resolveAsset, STATE_ROUTE, ASSET_ROUTE }

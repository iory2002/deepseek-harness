/**
 * Host half of the whale-pet bundle.
 *
 * Serves one authenticated `/api/whale-pet/state` route describing what the
 * Harness agent is doing right now, so an external desktop window can show a
 * whale that reacts to it.
 *
 * Only `node:*` builtins are imported. A profile-installed bundle's
 * `node_modules` holds no Harness packages, so a bare `@deepseek-ai/...`
 * specifier would fail to resolve at activation. That is also why the plugin
 * declares no `Config`: a schemastery schema cannot be imported. Tunables are
 * read from the row's `config` object instead, and are documented below.
 *
 * Two deliberate design notes:
 *
 * 1. The route is served from the connection fence, matching account-balance.
 *    A route must start with `/api/` to sit inside that fence.
 * 2. The state is folded from the session projection cache on disk rather than
 *    from live Cordis events. Folding live events would need `inject`ing the
 *    session/agent services, which is the more invasive route; the cache is a
 *    documented, versioned, atomically written Harness artifact. The tradeoff
 *    is latency, so it is stated honestly in the payload's `staleMs` and in
 *    `source`. Swapping in event-driven state later does not change this file's
 *    route contract, only `readState`.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'

/** The route the desktop window reads. It must start with `/api/` to sit inside Connection's authentication fence. */
const ROUTE = '/api/whale-pet/state'

/** Cache files are small; refuse anything implausible rather than parsing it. */
const MAX_CACHE_BYTES = 8 * 1024 * 1024

/** Only projection files touched within this window are considered candidates. */
const CANDIDATE_FRESH_MS = 15 * 60 * 1000

/** Files the state is folded from, newest first, before giving up. */
const MAX_CANDIDATES = 8

/**
 * How recently a session must have been touched to represent "the agent right
 * now". Older sessions still contribute a `waiting` state, because a question
 * that has sat unanswered for a while is exactly what a companion should point
 * at, but they never make the whale look busy or freshly done.
 */
const ACTIVE_WINDOW_MS = 10 * 60 * 1000

/** Every answer is per-request state; nothing about it may be cached. */
const NO_STORE = { 'cache-control': 'no-store' }
export const name = 'whale-pet'

/** `connection` provides the authenticated route surface; without it the plugin stays inactive instead of throwing. */
export const inject = ['connection']

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
 * Resolve the Harness home. Mirrors `@deepseek-ai/dsh-home-paths` `resolveDshHome`:
 * an explicit path wins, then a non-blank `$DSH_HOME`, then `~/.dsh`.
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
 * Fold one session projection document into the whale's state vocabulary.
 *
 * The four states come straight from documented projection fields:
 * `sessionStats.openStep` and `pendingCalls` mean work in flight;
 * `userQuestions.questions.active` means the agent is blocked on a person;
 * an open turn with no open step means the turn is winding down; no open turn
 * means idle. A live `approval/asked` without a matching `approval/decided`
 * lives in the session log rather than this cache, so it is not visible here —
 * `waiting` therefore covers questions, and approves may briefly read as busy.
 *
 * @param {object} doc - a parsed `session_projcache` document.
 * @returns {{state: string, detail: object}} the state name and its evidence.
 */
function foldState(doc) {
  const rows = doc?.record?.rows
  const stats = rowValue(rows, 'sessionStats') ?? {}
  const turn = rowValue(rows, 'turnBoundary') ?? {}
  const questions = rowValue(rows, 'userQuestions')

  const active = questions?.questions?.active
  const activeQuestions = Array.isArray(active) ? active.length : 0
  const pendingCalls = stats?.pendingCalls
  const pending = typeof pendingCalls === 'object' && pendingCalls !== null ? Object.keys(pendingCalls).length : 0
  const openStep = stats?.openStep
  const openTurn = turn?.openTurnStartSeq

  const detail = {
    openTurnStartSeq: openTurn ?? null,
    openStep: openStep === undefined || openStep === null ? null : { turn: openStep.turn, step: openStep.step },
    pendingCalls: pending,
    activeQuestions,
    lastStepKind: turn?.lastStepBoundary?.kind ?? null,
    lastTurn: turn?.lastTurn ?? null,
  }

  if (activeQuestions > 0) return { state: 'waiting', detail }
  if (pending > 0 || (openStep !== undefined && openStep !== null)) return { state: 'busy', detail }
  if (openTurn !== undefined && openTurn !== null) return { state: 'busy', detail }
  if (detail.lastStepKind === 'end') return { state: 'done', detail }
  return { state: 'idle', detail }
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
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, name)
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
 * Fold whale state across the projections the route can see.
 *
 * A person running several sessions expects the whale to react to whichever is
 * asking for attention, so a single session's state is not enough: any session
 * waiting on a person outranks any session that is busy, which in turn outranks
 * a recent completion. `sessions` reports every candidate for debugging.
 *
 * @param {string} dir - the projection cache session directory.
 * @returns {Promise<object>} the payload body.
 */
async function readState(dir) {
  const candidates = await listCandidates(dir)
  if (candidates.length === 0) {
    return {
      state: 'unknown',
      detail: { reason: 'no recent session projection found', sessions: [] },
      source: 'projcache',
      staleMs: null,
    }
  }

  const sessions = []
  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate.path, 'utf8')
      const folded = foldState(JSON.parse(text))
      sessions.push({
        id: candidate.path.replace(/^.*[\\/]/, '').replace(/\.json$/, ''),
        state: folded.state,
        detail: folded.detail,
        mtimeMs: candidate.mtimeMs,
      })
    } catch {
      // A malformed or half-written cache entry loses this candidate only.
    }
  }

  if (sessions.length === 0) {
    return {
      state: 'unknown',
      detail: { reason: 'no readable session projection', sessions: [] },
      source: 'projcache',
      staleMs: null,
    }
  }

  // Rank by urgency, but only let a recent session claim a non-waiting state:
  // "the agent is working" must describe work happening now, not last week.
  const rank = { waiting: 3, busy: 2, done: 1, idle: 0 }
  const freshBefore = Date.now() - ACTIVE_WINDOW_MS
  const eligible = sessions.filter(session => session.state === 'waiting' || session.mtimeMs >= freshBefore)
  const pool = eligible.length > 0 ? eligible : sessions

  const winner = pool.reduce((best, current) => {
    const delta = (rank[current.state] ?? 0) - (rank[best.state] ?? 0)
    if (delta !== 0) return delta > 0 ? current : best
    return current.mtimeMs > best.mtimeMs ? current : best
  })

  return {
    state: winner.state,
    detail: {
      ...winner.detail,
      sessionId: winner.id,
      sessions: sessions.map(s => ({ id: s.id, state: s.state, mtimeMs: s.mtimeMs })),
    },
    source: 'projcache',
    staleMs: Date.now() - winner.mtimeMs,
    sampledAt: new Date().toISOString(),
  }
}

/**
 * Activate the plugin: register the state route.
 * @param {object} ctx - Host context.
 * @param {object} [config] - the row's `config` object; `dshHome` overrides Harness home resolution.
 * @returns {void}
 */
export function apply(ctx, config) {
  // `inject: ['connection']` means the service is present before `apply` runs, so
  // no presence guard is needed here; a missing service would keep the plugin
  // inactive instead of calling this at all.
  const dshHome = resolveDshHome(config?.dshHome)
  const sessionsDir = join(dshHome, 'storages', 'session_projcache', 'sessions')

  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => readState(sessionsDir).then(
      body => Response.json(body, { headers: NO_STORE }),
      (error) => {
        ctx.logger?.warn?.('whale-pet: state read failed: %s', error?.message ?? String(error))
        return Response.json(
          { state: 'unknown', detail: { reason: 'state read failed' }, source: 'projcache', staleMs: null },
          { status: 500, headers: NO_STORE },
        )
      },
    ),
  }))

  ctx.logger?.info?.('whale-pet: serving %s from %s', ROUTE, sessionsDir)
}

/**
 * Test surface. The Loader only ever reads `apply`/`inject`/`Config`, so these
 * exports cost nothing at runtime and let a verifier exercise the state fold
 * against real session projections without booting a Harness.
 */
export const __testing__ = { foldState, readState, listCandidates, resolveDshHome, ROUTE }


/**
 * Host half of the account-balance bundle.
 *
 * Serves one authenticated `/api/account-balance` route carrying the local
 * price table with the band in force at request time, and the account balance
 * read from the API-key route's `/user/balance`. The two are fetched together
 * because the browser refreshes them at the same moments, so one round trip
 * covers both.
 *
 * Only `node:*` builtins are imported. A profile-installed bundle's
 * `node_modules` holds no Harness packages, so a bare `@deepseek-ai/...`
 * specifier would fail to resolve at activation. That is also why the plugin
 * declares no `Config`: a schemastery schema cannot be imported. Tunables are
 * read from the row's `config` object instead, and are documented below.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'

/** The route the browser half reads. It must start with `/api/` to sit inside Connection's authentication fence. */
const ROUTE = '/api/account-balance'

/** The balance route hangs off the bare provider root, never a Messages base URL. */
const BALANCE_PATH = '/user/balance'

/** The Messages adapter's default base URL ends here; the bare root is what `/user/balance` needs. */
const ANTHROPIC_SUFFIX = '/anthropic'

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_THRESHOLD = 10
const DEFAULT_TIMEOUT_MS = 8000

/** The settings namespace the API-key adapter publishes its live connection under. */
const LLM_SETTINGS_NS = 'llm-deepseek'

/** ISO weekday numbers (Monday 1 … Sunday 7) keyed by the short English weekday name. */
const ISO_WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

/** Every answer is per-request state; nothing about it may be cached by the browser or an intermediary. */
const NO_STORE = { 'cache-control': 'no-store' }

export const name = 'account-balance'
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
 * Read one live settings namespace's projected value.
 * @param {object} ctx - Host context.
 * @param {string} ns - settings namespace (the Loader entry id).
 * @returns {Record<string, unknown> | undefined} the namespace's value, or undefined when settings is absent or the namespace is unconfigured.
 */
function settingsValue(ctx, ns) {
  const settings = ctx.get('settings')
  if (settings === undefined || typeof settings.describe !== 'function') return undefined
  try {
    const row = settings.describe().find(candidate => candidate.ns === ns)
    return row?.value
  } catch (error) {
    // `describe()` builds every active plugin's form and throws on a malformed
    // one. This read is an optimization over a documented default, so a broken
    // unrelated plugin must not take the balance route down with it.
    ctx.logger?.warn?.('account-balance: settings.describe() failed: %s', error?.message ?? String(error))
    return undefined
  }
}

/**
 * Resolve the API key for the balance request, preferring the credentials
 * service over the launching environment, in the order the API-key adapter uses.
 * @param {object} ctx - Host context.
 * @param {string} ref - credential reference name.
 * @returns {Promise<string | undefined>} the key, or undefined when neither source has one.
 */
async function resolveApiKey(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    const hit = await credentials.resolve(ref)
    if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
  }
  const ambient = process.env[ref]
  return ambient !== undefined && ambient.length > 0 ? ambient : undefined
}

/**
 * Read and parse the price table. The file is re-read on every request so the
 * updating skill takes effect without reinstalling or restarting.
 * @param {string} path - absolute path of the price table.
 * @returns {Promise<Record<string, unknown>>} the parsed document.
 * @throws When the file is unreadable or is not a JSON object.
 */
async function readPricing(path) {
  const text = await readFile(path, 'utf8')
  const parsed = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('account-pricing.json must contain a JSON object')
  }
  return parsed
}

/** Extract `HH:MM` in the target timezone. */
function zonedClock(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const read = type => parts.find(part => part.type === type)?.value
  return {
    weekday: read('weekday'),
    hour: read('hour') ?? '00',
    minute: read('minute') ?? '00',
    date: `${read('year')}-${read('month')}-${read('day')}`,
  }
}

/**
 * Decide the band in force at one instant.
 *
 * Peak is a configured weekday, not a configured holiday, and inside one
 * configured window; everything else — weekends, holidays, and every hour
 * outside the windows — is off-peak. An unreadable rule cannot be interpreted,
 * so it falls back to off-peak rather than to a peak price that would overstate
 * the cost.
 * @param {Record<string, unknown>} pricing - the parsed price table.
 * @param {Date} now - the instant to classify.
 * @returns {'peak' | 'offPeak'} the band in force.
 */
function bandAt(pricing, now) {
  const rule = pricing.bandRule
  if (typeof rule !== 'object' || rule === null) return 'offPeak'
  const timeZone = typeof rule.timezone === 'string' ? rule.timezone : 'Asia/Shanghai'
  let clock
  try {
    clock = zonedClock(now, timeZone)
  } catch (error) {
    // An unknown IANA zone is a configuration error, not a peak day: the cost
    // is an estimate and must not silently double.
    return 'offPeak'
  }
  const weekday = ISO_WEEKDAY[clock.weekday]
  const peakWeekdays = Array.isArray(rule.peakWeekdays) ? rule.peakWeekdays : []
  if (weekday === undefined || !peakWeekdays.includes(weekday)) return 'offPeak'
  const holidays = Array.isArray(pricing.holidays) ? pricing.holidays : []
  if (holidays.includes(clock.date)) return 'offPeak'
  const windows = Array.isArray(rule.peakWindows) ? rule.peakWindows : []
  const at = `${clock.hour}:${clock.minute}`
  return windows.some(window => typeof window?.from === 'string' && typeof window?.to === 'string'
    && at >= window.from && at < window.to) ? 'peak' : 'offPeak'
}

/** Keep only the balance fields the browser renders, as the decimal strings the API sent. */
function normalizeBalance(payload) {
  const raw = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
  const infos = raw.flatMap(info => typeof info?.currency === 'string'
    && typeof info.total_balance === 'string'
    ? [{
      currency: info.currency,
      totalBalance: info.total_balance,
      grantedBalance: typeof info.granted_balance === 'string' ? info.granted_balance : '0',
      toppedUpBalance: typeof info.topped_up_balance === 'string' ? info.topped_up_balance : '0',
    }]
    : [])
  return { isAvailable: payload?.is_available === true, infos }
}

/**
 * Ask the provider for the account balance.
 * @param {string} baseUrl - provider root, without the Messages `/anthropic` suffix.
 * @param {string} apiKey - resolved API key.
 * @param {number} timeoutMs - request deadline.
 * @returns {Promise<{ isAvailable: boolean, infos: object[] }>} the normalized balance.
 * @throws When the request fails or the provider refuses it.
 */
async function fetchBalance(baseUrl, apiKey, timeoutMs) {
  const root = baseUrl.endsWith(ANTHROPIC_SUFFIX) ? baseUrl.slice(0, -ANTHROPIC_SUFFIX.length) : baseUrl
  const response = await fetch(`${root.replace(/\/+$/, '')}${BALANCE_PATH}`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`GET ${BALANCE_PATH} answered ${response.status}`)
  return normalizeBalance(await response.json())
}

/**
 * Resolve the deployment knobs from the row's `config`, the live API-key
 * adapter settings, then the built-in defaults, in that order.
 * @param {object} ctx - Host context.
 * @param {Record<string, unknown>} [config] - the Loader row's `config`.
 * @returns {{ pricingPath: string, apiKeyEnv: string, baseUrl: string, threshold: number, timeoutMs: number }} resolved knobs.
 */
function resolveKnobs(ctx, config) {
  const row = config ?? {}
  const llm = settingsValue(ctx, LLM_SETTINGS_NS)
  const home = resolveDshHome(typeof row.dshHome === 'string' ? row.dshHome : undefined)
  const settingsBaseUrl = typeof llm?.baseURL === 'string' && llm.baseURL.length > 0 ? llm.baseURL : undefined
  return {
    pricingPath: typeof row.pricingPath === 'string' && row.pricingPath.length > 0
      ? resolvePath(expandHome(row.pricingPath))
      : join(home, 'account-pricing.json'),
    apiKeyEnv: typeof row.apiKeyEnv === 'string' && row.apiKeyEnv.length > 0
      ? row.apiKeyEnv
      : typeof llm?.apiKeyEnv === 'string' && llm.apiKeyEnv.length > 0 ? llm.apiKeyEnv : DEFAULT_API_KEY_ENV,
    baseUrl: typeof row.baseUrl === 'string' && row.baseUrl.length > 0
      ? row.baseUrl
      : settingsBaseUrl ?? DEFAULT_BASE_URL,
    threshold: Number.isFinite(row.lowBalanceThreshold) ? row.lowBalanceThreshold : DEFAULT_THRESHOLD,
    timeoutMs: Number.isFinite(row.timeoutMs) ? row.timeoutMs : DEFAULT_TIMEOUT_MS,
  }
}

/**
 * Answer one balance request: the price table with the current band, plus the
 * account balance. A failure in either chain is reported in its own field so
 * the other still reaches the browser.
 * @param {object} ctx - Host context.
 * @param {{ pricingPath: string, apiKeyEnv: string, baseUrl: string, threshold: number, timeoutMs: number }} knobs - resolved deployment knobs.
 * @returns {Promise<Response>} the JSON answer, never a thrown error.
 */
async function handle(ctx, knobs) {
  let pricing = null
  try {
    const document = await readPricing(knobs.pricingPath)
    pricing = {
      currency: typeof document.currency === 'string' ? document.currency : 'CNY',
      unit: typeof document.unit === 'string' ? document.unit : 'per-million-tokens',
      band: bandAt(document, new Date()),
      models: typeof document.models === 'object' && document.models !== null ? document.models : {},
      aliases: typeof document.aliases === 'object' && document.aliases !== null ? document.aliases : {},
    }
  } catch (error) {
    ctx.logger?.warn?.('account-balance: price table unavailable: %s', error?.message ?? String(error))
  }

  let balance
  try {
    const apiKey = await resolveApiKey(ctx, knobs.apiKeyEnv)
    if (apiKey === undefined) {
      balance = { ok: false, reason: 'missing-key' }
    } else {
      balance = { ok: true, ...await fetchBalance(knobs.baseUrl, apiKey, knobs.timeoutMs) }
    }
  } catch (error) {
    balance = { ok: false, reason: 'unreachable', detail: error?.message ?? String(error) }
  }

  return Response.json({ pricing, balance, threshold: knobs.threshold }, { headers: NO_STORE })
}

/**
 * Register the authenticated balance route for this profile.
 * @param {object} ctx - Host context carrying Connection and the optional credentials and settings services.
 * @param {Record<string, unknown>} [config] - the Loader row's `config`.
 */
export function apply(ctx, config) {
  const knobs = resolveKnobs(ctx, config)
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: request => handle(ctx, knobs).catch((error) => {
      ctx.logger?.warn?.('account-balance: route failed: %s', error?.message ?? String(error))
      return Response.json({ pricing: null, balance: { ok: false, reason: 'route' }, threshold: knobs.threshold },
        { status: 500, headers: NO_STORE })
    }),
  }))
}

/**
 * Verification harness for the whale-pet host half.
 *
 * Exercises the state fold against the real session projection cache on this
 * machine, and against synthetic documents covering every state. Run it with
 * Node; it exits non-zero on the first synthetic case that folds wrong.
 *
 * Usage (from any directory):
 *   node D:\deepseek-harness\my-dev\whale-pet\verify-host.mjs
 */

import { __testing__ } from './index.js'

const { foldState, readState, resolveDshHome } = __testing__

/** Envelope-wrap a projection value the way the cache stores it. */
const row = (val) => ({ ver: 1, seq: 1, val })

/** Build a minimal projection document from row values. */
const doc = (rows) => ({ version: 7, record: { rows } })

let failures = 0

/**
 * Assert one synthetic document folds to the expected state.
 * @param {string} name - case name.
 * @param {string} expected - expected state.
 * @param {object} document - the projection document.
 */
function check(name, expected, document) {
  const actual = foldState(document).state
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} expected=${expected.padEnd(8)} actual=${actual}`)
}

console.log('--- synthetic folds ---')

check('no rows at all', 'idle', doc({}))

check('open step', 'busy', doc({
  sessionStats: row({ openStep: { turn: 1, step: 2 }, pendingCalls: {} }),
  turnBoundary: row({ openTurnStartSeq: 10, lastStepBoundary: { kind: 'start' } }),
}))

check('pending tool call', 'busy', doc({
  sessionStats: row({ openStep: null, pendingCalls: { callA: {} } }),
  turnBoundary: row({ openTurnStartSeq: 10, lastStepBoundary: { kind: 'start' } }),
}))

check('open turn, no open step', 'busy', doc({
  sessionStats: row({ openStep: null, pendingCalls: {} }),
  turnBoundary: row({ openTurnStartSeq: 10, lastStepBoundary: { kind: 'end' } }),
}))

check('question outranks busy', 'waiting', doc({
  sessionStats: row({ openStep: { turn: 1, step: 1 }, pendingCalls: {} }),
  turnBoundary: row({ openTurnStartSeq: 10, lastStepBoundary: { kind: 'start' } }),
  userQuestions: row({ questions: { active: [{ id: 'q1' }], settled: [] } }),
}))

check('closed turn ended', 'done', doc({
  sessionStats: row({ openStep: null, pendingCalls: {} }),
  turnBoundary: row({ openTurnStartSeq: null, lastStepBoundary: { kind: 'end' } }),
}))

check('closed turn mid-step', 'idle', doc({
  sessionStats: row({ openStep: null, pendingCalls: {} }),
  turnBoundary: row({ openTurnStartSeq: null, lastStepBoundary: { kind: 'start' } }),
}))

check('null-valued rows are tolerated', 'idle', doc({
  sessionStats: row(null), turnBoundary: row(null), userQuestions: row(null),
}))

console.log('\n--- real projection cache ---')

const home = resolveDshHome()
const sessionsDir = `${home}\\storages\\session_projcache\\sessions`
console.log(`home: ${home}`)
console.log(`dir : ${sessionsDir}`)

const live = await readState(sessionsDir)
console.log(JSON.stringify(live, null, 2))

if (live.state !== 'unknown') {
  // The winner must be the most recently touched session whenever that session
  // is fresh; otherwise the whale reports whatever session merely sorted first.
  const newest = live.detail.sessions.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a))
  const fresh = Date.now() - newest.mtimeMs < 10 * 60 * 1000
  const ok = !fresh || live.detail.sessionId === newest.id
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  picks the freshest session         newest=${newest.id.slice(0, 22)} chose=${live.detail.sessionId.slice(0, 22)}`)
}

if (live.state === 'unknown') {
  console.log('\nNOTE: no readable projection found. That is expected on a cold machine but')
  console.log('      suspicious on a machine with an active session.')
}

console.log(`\n${failures === 0 ? 'all synthetic cases passed' : `${failures} synthetic case(s) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

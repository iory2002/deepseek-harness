/**
 * Guards the one duplication the client half is forced to make.
 *
 * `client.js` runs inside the browser module table, where a `require` of this
 * package's own subpath misses the table and throws. So the art constants are
 * copied there. This script reads both files as text and fails when the copies
 * disagree, which turns a silent visual drift into a test failure.
 *
 * Usage:
 *   node D:\deepseek-harness\my-dev\whale-pet\verify-parity.mjs
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  WHALE_BOX, WHALE_COLORS, WHALE_STATES, WHALE_CAPTIONS, whaleShapeParts,
} from './whale-art.js'

const here = dirname(fileURLToPath(import.meta.url))
const clientSource = await readFile(join(here, 'client.js'), 'utf8')

let failures = 0

/**
 * Assert a condition, recording a failure instead of throwing so every
 * mismatch is reported in one run.
 * @param {string} what - description of the check.
 * @param {boolean} ok - whether it held.
 * @param {string} [detail] - extra context printed on failure.
 */
function check(what, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok || detail === '' ? '' : `\n        ${detail}`}`)
}

/**
 * Extract the source text of one `const NAME = ...` declaration from client.js
 * by walking its braces, so a trailing semicolon or a following declaration
 * cannot leak into the slice.
 * @param {string} name - declared identifier.
 * @returns {string|null} the initializer source, or null when absent.
 */
function declaration(name) {
  const start = clientSource.indexOf(`const ${name} = `)
  if (start === -1) return null
  const from = start + `const ${name} = `.length
  let depth = 0
  let seen = false
  for (let i = from; i < clientSource.length; i += 1) {
    const character = clientSource[i]
    if (character === '{' || character === '[' || character === '(') {
      depth += 1
      seen = true
    } else if (character === '}' || character === ']' || character === ')') {
      depth -= 1
      if (seen && depth === 0) return clientSource.slice(from, i + 1).trim()
    }
  }
  return null
}

/** Evaluate an extracted object literal. It is local, checked-in source. */
const evalLiteral = (name) => {
  const source = declaration(name)
  if (source === null) return undefined
  // eslint-disable-next-line no-new-func -- evaluating a checked-in literal by design
  return new Function(`return (${source.replace(/;\s*$/s, '')})`)()
}

check('client.js declares BOX', declaration('BOX') !== null)
check('client.js declares COLORS', declaration('COLORS') !== null)
check('client.js declares STATES', declaration('STATES') !== null)
check('client.js declares CAPTIONS', declaration('CAPTIONS') !== null)
check('client.js declares PARTS', declaration('PARTS') !== null)

const localBox = evalLiteral('BOX')
const localColors = evalLiteral('COLORS')
const localStates = evalLiteral('STATES')
const localCaptions = evalLiteral('CAPTIONS')
const localParts = evalLiteral('PARTS')

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Compare two string arrays as sets, so declaration order cannot matter. */
const sameSet = (a, b) => sameJson([...a].sort(), [...b].sort())

check('BOX matches whale-art.js', sameJson(localBox, WHALE_BOX), `${JSON.stringify(localBox)} vs ${JSON.stringify(WHALE_BOX)}`)
check('COLORS matches whale-art.js', sameJson(localColors, WHALE_COLORS), `${JSON.stringify(localColors)} vs ${JSON.stringify(WHALE_COLORS)}`)
check('CAPTIONS matches whale-art.js', sameJson(localCaptions, WHALE_CAPTIONS), `${JSON.stringify(localCaptions)} vs ${JSON.stringify(WHALE_CAPTIONS)}`)
check('PARTS matches whaleShapeParts()', sameJson(localParts, whaleShapeParts()),
  `client has ${Object.keys(localParts ?? {}).join(',')} / art has ${Object.keys(whaleShapeParts()).join(',')}`)

// The client copy deliberately omits `bubble` and `swimSpeed`: it renders
// neither. Compare only the fields it actually owns.
const CLIENT_FIELDS = ['tailAngle', 'tailPeriod', 'bob', 'bobPeriod', 'blinkPeriod', 'spout']
const stateNames = Object.keys(WHALE_STATES)
check('STATES has the same state names', sameSet(Object.keys(localStates ?? {}), stateNames),
  `client: ${Object.keys(localStates ?? {}).join(',')} / art: ${stateNames.join(',')}`)

for (const name of stateNames) {
  const mine = localStates?.[name]
  const theirs = WHALE_STATES[name]
  if (mine === undefined) {
    check(`STATES.${name} exists`, false)
    continue
  }
  const diffs = CLIENT_FIELDS.filter(field => mine[field] !== theirs[field])
  check(`STATES.${name} animation fields match`, diffs.length === 0,
    diffs.map(field => `${field}: client=${mine[field]} art=${theirs[field]}`).join('; '))
}

check('client does not require the art subpath', !/require\(\s*['"]@local\/dsh-whale-pet\/art/.test(clientSource))

console.log(`\n${failures === 0 ? 'client and art agree' : `${failures} mismatch(es) — client copy has drifted`}`)
process.exit(failures === 0 ? 0 : 1)

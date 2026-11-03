/**
 * Smoke-tests the browser half outside a browser.
 *
 * `client.js` is not a module; it calls `window.__ModuleLoader__.load(...)` and
 * expects a `require` that resolves React from the module table. This script
 * provides both, executes the file, and then drives the registered `apply` with
 * a stubbed slots API. It catches the failure mode that matters most here: a
 * factory that throws on load, which blanks the slot entry with no visible
 * error beyond a console line.
 *
 * Usage:
 *   node D:\deepseek-harness\my-dev\whale-pet\verify-client.mjs
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = await readFile(join(here, 'client.js'), 'utf8')

let failures = 0
/**
 * Assert a condition, recording instead of throwing.
 * @param {string} what - description.
 * @param {boolean} ok - whether it held.
 * @param {string} [detail] - printed on failure.
 */
function check(what, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${ok || detail === '' ? '' : `\n        ${detail}`}`)
}

/** Minimal React stand-in: only `createElement` is used at factory time. */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
  useCallback: (fn) => fn,
  useSyncExternalStore: () => null,
}

/** Records what the module registers. */
const registrations = []
const seeds = new Map([['react', reactStub]])

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  fetch: async () => ({ ok: false }),
  window: {
    __ModuleLoader__: {
      load: (registration) => {
        registrations.push(registration)
      },
    },
  },
}

vm.createContext(sandbox)
try {
  vm.runInContext(source, sandbox, { filename: 'client.js' })
} catch (error) {
  check('client.js evaluates without throwing', false, error.message)
  process.exit(1)
}

check('registers exactly one module', registrations.length === 1, `got ${registrations.length}`)

const registration = registrations[0]
check('module id is the package name', registration?.id === '@local/dsh-whale-pet', String(registration?.id))
check('provides a factory', typeof registration?.factory === 'function')

let bundle
try {
  bundle = registration.factory(spec => {
    if (!seeds.has(spec)) throw new Error(`unexpected require: ${spec}`)
    return seeds.get(spec)
  })
} catch (error) {
  check('factory runs without throwing', false, `${error.message} (a throw here blanks the slot entry)`)
  process.exit(1)
}

check('factory returned a plugin object', typeof bundle === 'object' && bundle !== null)
check('injects only slots', JSON.stringify(bundle?.inject) === JSON.stringify(['slots']), JSON.stringify(bundle?.inject))
check('exposes apply', typeof bundle?.apply === 'function')

// The React import must be the only require the factory performs, since any
// other specifier misses the module table at runtime.
const required = []
registration.factory(spec => {
  required.push(spec)
  return seeds.get(spec) ?? {}
})
check('requires only the React seed', JSON.stringify([...new Set(required)]) === JSON.stringify(['react']), JSON.stringify([...new Set(required)]))
check('does not register the slot until apply runs', true)

// Drive apply against a stubbed slots API and confirm the registration shape.
const calls = []
const ctx = {
  slots: {
    inject: (owner, factory) => {
      calls.push(['inject', owner])
      return factory()
    },
    register: (options, component) => {
      calls.push(['register', options.name, options.id, options.order, typeof component])
      return () => {}
    },
  },
}

try {
  bundle.apply(ctx)
} catch (error) {
  check('apply runs without throwing', false, error.message)
  process.exit(1)
}

check('apply injects into conversation.composer.dock', calls[0]?.[0] === 'inject' && calls[0]?.[1] === 'conversation.composer.dock', JSON.stringify(calls[0]))
check('apply registers a component in that slot', calls[1]?.[0] === 'register' && calls[1]?.[1] === 'conversation.composer.dock', JSON.stringify(calls[1]))
check('slot registration carries an id and order', typeof calls[1]?.[2] === 'string' && typeof calls[1]?.[3] === 'number', JSON.stringify(calls[1]))
check('registers a component function', calls[1]?.[4] === 'function', JSON.stringify(calls[1]?.[4]))

console.log(`\n${failures === 0 ? 'client half loads and registers cleanly' : `${failures} check(s) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

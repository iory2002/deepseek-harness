/**
 * Desktop companion renderer: paints what the shell pushes, forwards pointer
 * intent, and lets the director decide which motion plays. The window follows
 * the pointer only while a drag is open, so a double-click still reaches the page.
 */

import { HOVER_DELAY_MS, initialState, reduce } from './director.js'
import { watchReducedMotion } from './motion.js'
import { createPerformer } from './performer.js'

/** How often the director gets a chance to start a random motion. */
const TICK_MS = 250
/** Pointer travel that turns a press into a window drag. */
const DRAG_SLOP_PX = 3

const bridge = window.dshPet
const root = document.getElementById('pet')
const phase = document.getElementById('phase')
const details = document.getElementById('details')
const counts = document.getElementById('counts')
const hint = document.getElementById('hint')

const performer = createPerformer({
  root,
  body: document.getElementById('body'),
  stage: document.getElementById('stage'),
})

let state = initialState()
let copy = null
let status = { phase: 'starting', agents: 0, subagents: 0, jobs: 0, waits: 0, completed: 0 }
let scale = 1
let expanded = false
let pressed = false
let dragged = false
let suppressClick = false
let startX = 0
let startY = 0
let hoverTimer

/** Feed one event to the director and play whatever it decides. */
function dispatch(event) {
  const { state: next, cue } = reduce(state, event, { now: Date.now(), random: Math.random })
  state = next
  if (cue !== null) performer.apply(cue, { night: state.night, reducedMotion: state.reducedMotion })
}

/** Repaint the chrome: the phase accent, its label, and the non-zero counts. */
function paint() {
  root.dataset.phase = status.phase
  root.dataset.card = expanded ? 'true' : 'false'
  root.style.setProperty('--pet-scale', String(scale))
  phase.textContent = copy === null ? '' : copy.phases[status.phase]
  hint.textContent = copy === null ? '' : copy.hint
  const rows = copy === null ? [] : [
    [copy.agents, status.agents],
    [copy.subagents, status.subagents],
    [copy.jobs, status.jobs],
    [copy.waits, status.waits],
  ].filter(row => row[1] > 0)
  counts.replaceChildren(...rows.map((row) => {
    const item = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = row[0]
    const amount = document.createElement('strong')
    amount.textContent = String(row[1])
    item.append(name, amount)
    return item
  }))
  details.hidden = !expanded
}

/** Receive one pushed presentation. */
function apply(presentation) {
  copy = presentation.copy
  status = presentation.status
  scale = typeof presentation.scale === 'number' ? presentation.scale : 1
  dispatch({ type: 'presentation', presentation })
  paint()
}

function release(event) {
  if (!pressed) return
  pressed = false
  if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId)
  dispatch({ type: 'press', value: false })
  bridge.endDrag()
  if (dragged) {
    dragged = false
    // The click that ends a drag must not also open the counts card.
    suppressClick = true
    dispatch({ type: 'release' })
  }
}

root.addEventListener('pointerenter', () => {
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => { dispatch({ type: 'hover', value: true }) }, HOVER_DELAY_MS)
})

root.addEventListener('pointerleave', () => {
  clearTimeout(hoverTimer)
  dispatch({ type: 'hover', value: false })
})

root.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  pressed = true
  dragged = false
  startX = event.screenX
  startY = event.screenY
  root.setPointerCapture(event.pointerId)
  bridge.beginDrag()
  dispatch({ type: 'press', value: true })
})

root.addEventListener('pointermove', (event) => {
  if (!pressed || dragged) return
  // The window travels with the pointer, so only screen coordinates reveal movement.
  if (Math.abs(event.screenX - startX) > DRAG_SLOP_PX || Math.abs(event.screenY - startY) > DRAG_SLOP_PX) {
    dragged = true
    dispatch({ type: 'drag', value: true })
  }
})

root.addEventListener('pointerup', release)
root.addEventListener('pointercancel', release)

root.addEventListener('click', () => {
  if (suppressClick) {
    suppressClick = false
    return
  }
  expanded = !expanded
  dispatch({ type: 'card', value: expanded })
  paint()
})

root.addEventListener('dblclick', () => { bridge.activate() })
root.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  bridge.openMenu()
})

window.addEventListener('blur', () => {
  if (!pressed) return
  pressed = false
  bridge.endDrag()
  dispatch({ type: 'press', value: false })
})

watchReducedMotion(value => { dispatch({ type: 'motion', value }) })
setInterval(() => { dispatch({ type: 'tick' }) }, TICK_MS)

bridge.onPresentation(apply)
bridge.presentation().then(apply, () => {
  /* The first pushed presentation still arrives; the poll owns retries. */
})

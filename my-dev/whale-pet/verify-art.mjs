/**
 * Generates a static preview of the whale in every state.
 *
 * Writes `preview/whale-states.html`, which lays the six states out side by
 * side with the shared CSS and each state's custom properties applied. Opening
 * it in any browser shows what the desktop window and the in-GUI widget will
 * look like without installing anything.
 *
 * Usage:
 *   node D:\deepseek-harness\my-dev\whale-pet\verify-art.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  WHALE_BOX, WHALE_CSS, WHALE_STATES, whaleSvgMarkup, whaleStateVars, whaleStateCaption,
} from './whale-art.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'preview')

/** Turn a custom-property bag into an inline style attribute. */
const styleOf = (name) => Object.entries(whaleStateVars(name)).map(([k, v]) => `${k}:${v}`).join(';')

const markup = whaleSvgMarkup('preview')

/** Every state plus the host's unknown state, which has no parameter row of its own. */
const shown = [...Object.keys(WHALE_STATES), 'unknown']

const cards = shown.map((name) => {
  const bubble = WHALE_STATES[name]?.bubble
  return `    <figure class="card" data-state="${name}">
      <svg class="wp-whale" viewBox="0 0 ${WHALE_BOX.width} ${WHALE_BOX.height}" width="200" height="140" style="${styleOf(name)}" role="img" aria-label="${name}">
        ${markup}
      </svg>
      <figcaption>
        <b>${name}</b>
        <span>${whaleStateCaption(name)}</span>
        ${bubble === undefined || bubble === null ? '' : `<em>${bubble}</em>`}
      </figcaption>
    </figure>`
}).join('\n')

const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>小蓝鲸 — 六态预览</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; font: 14px/1.5 system-ui, "Microsoft YaHei", sans-serif;
         background: #0f1220; color: #e8ecff; }
  h1 { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
  p.note { margin: 0 0 20px; opacity: .65; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .card { margin: 0; padding: 12px; border-radius: 12px; background: #1a1f36;
          display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .card figcaption { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 12px; }
  .card figcaption b { font-family: ui-monospace, monospace; color: #9db2ff; }
  .card figcaption span { opacity: .8; }
  .card figcaption em { font-style: normal; opacity: .6; }
${WHALE_CSS}
</style>
<h1>小蓝鲸 — 六态预览</h1>
<p class="note">同一份 whale-art.js，桌面窗与 Web GUI 组件共用。此页仅用于肉眼校验造型与动效。</p>
<div class="grid">
${cards}
</div>
</html>
`

await mkdir(outDir, { recursive: true })
const out = join(outDir, 'whale-states.html')
await writeFile(out, html, 'utf8')

console.log(`states rendered : ${shown.join(', ')}`)
console.log(`markup bytes    : ${markup.length}`)
console.log(`wrote           : ${out}`)

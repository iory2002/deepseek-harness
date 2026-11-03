/**
 * Browser half of the whale-pet bundle.
 *
 * Renders one mini whale into `conversation.composer.dock`, mirroring the same
 * state the desktop window shows. The state comes from this bundle's own
 * `/api/whale-pet/state` route; when the route is unreachable the whale keeps
 * the last known state and shows a muted tone rather than pretending to be idle.
 *
 * Two constraints shape this file:
 *
 * 1. `require` here only resolves the platform seed words (React) and modules
 *    already materialized in the module table. Requiring this package's own
 *    `art` subpath misses that table and throws, which blanks the whole slot
 *    entry. So the art constants are duplicated below, and
 *    `verify-parity.mjs` fails when this copy drifts from `whale-art.js`.
 * 2. Only `--dsw-alias-*` tokens are used for text and chrome. The artwork
 *    carries its own colours, which the guidance permits.
 */

const NS = 'whale-pet';

/** Document-relative form of the host route; a leading `/api/...` is not fetchable as written. */
const ROUTE = 'api/whale-pet/state';

/** Poll cadence. The host route folds a disk cache, so a sub-second cadence would buy nothing. */
const POLL_MS = 2000;

/** After this long without a successful poll, the widget marks itself out of contact. */
const STALE_MS = 12000;

/** Mirrors `WHALE_BOX` and `WHALE_COLORS` in whale-art.js. Checked by verify-parity.mjs. */
const BOX = { width: 200, height: 140 };
const COLORS = {
  backLight: '#6d8bf7',
  backDeep: '#2b46c8',
  belly: '#f3f7ff',
  eye: '#101a3a',
  cheek: '#ff9db3',
};

/**
 * Mirrors `WHALE_STATES` in whale-art.js. Checked by verify-parity.mjs.
 * Angles in degrees, durations in seconds.
 */
const STATES = {
  idle: { tailAngle: 6, tailPeriod: 3.4, bob: 3, bobPeriod: 3.0, blinkPeriod: 5.0, spout: 0 },
  busy: { tailAngle: 16, tailPeriod: 1.1, bob: 5, bobPeriod: 1.2, blinkPeriod: 2.6, spout: 0.35 },
  waiting: { tailAngle: 9, tailPeriod: 2.2, bob: 4, bobPeriod: 1.8, blinkPeriod: 3.4, spout: 0.15 },
  done: { tailAngle: 13, tailPeriod: 1.6, bob: 9, bobPeriod: 0.9, blinkPeriod: 3.0, spout: 0.7 },
  dragged: { tailAngle: 20, tailPeriod: 0.9, bob: 2, bobPeriod: 0.7, blinkPeriod: 1.6, spout: 0 },
  subagent: { tailAngle: 12, tailPeriod: 1.4, bob: 4, bobPeriod: 1.4, blinkPeriod: 2.8, spout: 0.2 },
};

/** Mirrors `WHALE_CAPTIONS` in whale-art.js. Checked by verify-parity.mjs. */
const CAPTIONS = {
  idle: '空闲',
  busy: '干活中',
  waiting: '等你回话',
  done: '干完了',
  subagent: '派了小助手',
  dragged: '被拖拽',
  unknown: '联系不上',
};

/** Mirrors `whaleShapeParts()` in whale-art.js. Checked by verify-parity.mjs. */
const PARTS = {
  bodyPath: 'M28 84 C26 54 62 36 100 36 C136 36 152 54 152 74 C152 94 134 104 100 106 C64 108 30 106 28 84 Z',
  bellyPath: 'M70 92 C80 108 96 112 114 110 C130 108 140 100 144 90 C132 102 112 106 94 104 C80 102 74 98 70 92 Z',
  tailPath: 'M138 72 C158 58 176 40 188 26 C186 50 184 64 182 78 C184 92 186 106 188 128 C176 114 158 96 138 84 Z',
  finPath: '',
  spray: { cx: 98, cy: 12, r: 3 },
  blowhole: { cx: 94, cy: 32, rx: 3.5, ry: 1.8 },
  eyeLeft: { cx: 68, cy: 64, rx: 6.5, ry: 7.5 },
  eyeRight: { cx: 96, cy: 63, rx: 6, ry: 7 },
  cheek: { cx: 80, cy: 84, rx: 7, ry: 4 },
  smile: 'M80 90 C84 95 92 95 96 90',
};

/** Fall back rather than throw, so a newer host's unknown state stays calm. */
const paramsOf = (name) => STATES[name] ?? STATES.idle;
const captionOf = (name) => CAPTIONS[name] ?? CAPTIONS.idle;

const CSS = `
.wp-root { order: 2; display: inline-flex; align-items: center; gap: 6px; }
.wp-graphic { display: block; overflow: visible; }
.wp-caption {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px; line-height: 1; white-space: nowrap; user-select: none;
}
.wp-root[data-stale='true'] .wp-caption { opacity: 0.55; }
.wp-root[data-stale='true'] .wp-whale { filter: saturate(0.4); }

/* Motion is parameterised by inline custom properties so one rule per part
   serves every state, and the state table stays the only place tuning lives. */
.wp-whale { transform-box: fill-box; transform-origin: 50% 60%; }
.wp-bob { animation: wp-bob var(--wp-bob-period, 3s) ease-in-out infinite; }
.wp-tail-part { transform-box: fill-box; transform-origin: 20% 50%; animation: wp-tail var(--wp-tail-period, 3s) ease-in-out infinite; }
.wp-fin-part { transform-box: fill-box; transform-origin: 50% 10%; animation: wp-fin var(--wp-tail-period, 3s) ease-in-out infinite; }
.wp-eye { animation: wp-blink var(--wp-blink-period, 5s) steps(1, end) infinite; }
.wp-spout-part { animation: wp-spout 2.4s ease-out infinite; opacity: var(--wp-spout, 0); }

@keyframes wp-bob { 0%, 100% { transform: translateY(calc(var(--wp-bob, 3px) * -1)); } 50% { transform: translateY(var(--wp-bob, 3px)); } }
@keyframes wp-tail { 0%, 100% { transform: rotate(calc(var(--wp-tail-angle, 6deg) * -1)); } 50% { transform: rotate(var(--wp-tail-angle, 6deg)); } }
@keyframes wp-fin { 0%, 100% { transform: rotate(6deg); } 50% { transform: rotate(-10deg); } }
@keyframes wp-blink { 0%, 92% { transform: scaleY(1); } 96%, 100% { transform: scaleY(0.08); } }
@keyframes wp-spout { 0% { opacity: var(--wp-spout, 0); transform: translateY(4px) scale(0.9); } 40% { opacity: var(--wp-spout, 0); } 100% { opacity: 0; transform: translateY(-8px) scale(1.1); } }

@media (prefers-reduced-motion: reduce) {
  .wp-bob, .wp-tail-part, .wp-fin-part, .wp-eye, .wp-spout-part { animation: none; }
  .wp-spout-part { opacity: 0; }
}
`;

window.__ModuleLoader__.load({
  id: '@local/dsh-whale-pet',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    /**
     * Read the host's whale state once.
     * @param {AbortSignal} signal - cancels the request when the widget unmounts.
     * @returns {Promise<{state: string} | null>} the payload, or null on any failure.
     */
    async function fetchState(signal) {
      try {
        const response = await fetch(ROUTE, { signal, headers: { accept: 'application/json' } });
        if (!response.ok) return null;
        const body = await response.json();
        return typeof body?.state === 'string' ? body : null;
      } catch {
        return null;
      }
    }

    /**
     * The mini whale.
     * @param {{state: string}} props - the resolved state name.
     * @returns {object} the React element.
     */
    function WhaleGraphic({ state }) {
      const p = paramsOf(state);
      const style = {
        '--wp-tail-angle': `${p.tailAngle}deg`,
        '--wp-tail-period': `${p.tailPeriod}s`,
        '--wp-bob': `${p.bob}px`,
        '--wp-bob-period': `${p.bobPeriod}s`,
        '--wp-blink-period': `${p.blinkPeriod}s`,
        '--wp-spout': String(p.spout),
      };
      const gid = `wp-client-${state}`;
      return h('svg', {
        className: 'wp-graphic wp-whale',
        viewBox: `0 0 ${BOX.width} ${BOX.height}`,
        width: 42,
        height: 30,
        role: 'img',
        'aria-hidden': 'true',
        style,
      },
      h('defs', null,
        h('linearGradient', { id: `${gid}-body`, x1: 0, y1: 0, x2: 0, y2: 1 },
          h('stop', { offset: 0, stopColor: COLORS.backLight }),
          h('stop', { offset: 1, stopColor: COLORS.backDeep })),
        h('linearGradient', { id: `${gid}-belly`, x1: 0, y1: 0, x2: 0, y2: 1 },
          h('stop', { offset: 0, stopColor: COLORS.belly }),
          h('stop', { offset: 1, stopColor: COLORS.belly, stopOpacity: 0.7 }))),
      h('g', { className: 'wp-bob' },
        h('path', { className: 'wp-tail-part', d: PARTS.tailPath, fill: `url(#${gid}-body)` }),
        h('path', { d: PARTS.bodyPath, fill: `url(#${gid}-body)` }),
        h('path', { d: PARTS.bellyPath, fill: `url(#${gid}-belly)`, opacity: 0.95 }),
        h('path', { className: 'wp-fin-part', d: PARTS.finPath, fill: COLORS.backDeep }),
        h('ellipse', { cx: PARTS.blowhole.cx, cy: PARTS.blowhole.cy, rx: PARTS.blowhole.rx, ry: PARTS.blowhole.ry, fill: COLORS.backDeep, opacity: 0.75 }),
        h('circle', { className: 'wp-spout-part', cx: PARTS.spray.cx, cy: PARTS.spray.cy, r: PARTS.spray.r, fill: COLORS.belly }),
        h('ellipse', { cx: PARTS.cheek.cx, cy: PARTS.cheek.cy, rx: PARTS.cheek.rx, ry: PARTS.cheek.ry, fill: COLORS.cheek, opacity: 0.5 }),
        h('path', { d: PARTS.smile, stroke: COLORS.eye, strokeWidth: 2.5, strokeLinecap: 'round', fill: 'none', opacity: 0.75 }),
        h('ellipse', { className: 'wp-eye', cx: PARTS.eyeLeft.cx, cy: PARTS.eyeLeft.cy, rx: PARTS.eyeLeft.rx, ry: PARTS.eyeLeft.ry, fill: COLORS.eye }),
        h('circle', { cx: PARTS.eyeLeft.cx + 1.5, cy: PARTS.eyeLeft.cy - 2.5, r: 1.6, fill: '#ffffff' }),
        h('ellipse', { className: 'wp-eye', cx: PARTS.eyeRight.cx, cy: PARTS.eyeRight.cy, rx: PARTS.eyeRight.rx, ry: PARTS.eyeRight.ry, fill: COLORS.eye }),
        h('circle', { cx: PARTS.eyeRight.cx + 1.5, cy: PARTS.eyeRight.cy - 2.5, r: 1.5, fill: '#ffffff' })));
    }

    /**
     * The status widget: one whale plus its state caption.
     * Renders nothing until the first successful poll, so a missing route shows
     * no widget rather than a permanently blank one.
     * @returns {object|null} the React element.
     */
    function WhaleStatus() {
      const [state, setState] = useState(null);
      const [stale, setStale] = useState(false);
      const lastOk = useRef(0);

      useEffect(() => {
        const controller = new AbortController();
        let timer = null;
        const tick = async () => {
          const body = await fetchState(controller.signal);
          if (controller.signal.aborted) return;
          if (body !== null) {
            lastOk.current = Date.now();
            setState(body.state);
            setStale(false);
          } else {
            setStale(Date.now() - lastOk.current > STALE_MS);
          }
          timer = setTimeout(tick, POLL_MS);
        };
        tick();
        return () => {
          controller.abort();
          if (timer !== null) clearTimeout(timer);
        };
      }, []);

      if (state === null) return null;

      return h('span', { className: 'wp-root', 'data-stale': stale ? 'true' : 'false' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h(WhaleGraphic, { state }),
        h('span', { className: 'wp-caption' }, captionOf(state)));
    }

    /**
     * Register the widget. Registrations are disposed with the slot declaration.
     * @param {object} ctx - Client context.
     * @returns {void}
     */
    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'whale-pet',
        order: 2,
      }, WhaleStatus));
    }

    return { inject: ['slots'], apply };
  },
});

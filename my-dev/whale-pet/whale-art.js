/**
 * Shared whale artwork and the animation parameter table.
 *
 * Deliberately environment-free: no imports, no DOM access, no Node built-ins.
 * It is the single source of the character so the desktop window and the
 * in-GUI decoration cannot drift apart, and so replacing the renderer later
 * (raster cut-out, Inochi2D, Live2D) only replaces this module.
 *
 * The artwork is original: a chibi blue whale drawn from primitives. It keeps
 * the whale motif — blue/white, fluke, blowhole — but is not the DeepSeek
 * Harness logo, and must not be presented as an official asset.
 */

/** The viewBox the parts are authored in. Geometry depends on these numbers. */
export const WHALE_BOX = { width: 200, height: 140 };

/** Prefix for generated DOM ids, so two instances on one page cannot collide. */
export const WHALE_ID_PREFIX = 'dsh-whale-pet';

/** Body gradient stops, top to bottom. */
export const WHALE_COLORS = {
  backLight: '#6d8bf7',
  backDeep: '#2b46c8',
  belly: '#f3f7ff',
  eye: '#101a3a',
  cheek: '#ff9db3',
};

/**
 * One animation state per value the host reports.
 *
 * Angles are degrees, durations are seconds, `spout` and `swimSpeed` are 0–1.
 * `bubble` is the default bubble line; `null` shows none. Keeping this table as
 * plain data is what lets the renderer be swapped: the state machine only ever
 * produces a state name, and everything visual is looked up here.
 */
export const WHALE_STATES = {
  idle: {
    tailAngle: 6, tailPeriod: 3.4,
    bob: 3, bobPeriod: 3.0,
    blinkPeriod: 5.0, spout: 0, swimSpeed: 0,
    bubble: null,
  },
  busy: {
    tailAngle: 16, tailPeriod: 1.1,
    bob: 5, bobPeriod: 1.2,
    blinkPeriod: 2.6, spout: 0.35, swimSpeed: 1,
    bubble: '干活中…',
  },
  waiting: {
    tailAngle: 9, tailPeriod: 2.2,
    bob: 4, bobPeriod: 1.8,
    blinkPeriod: 3.4, spout: 0.15, swimSpeed: 0,
    bubble: '等你回话',
  },
  done: {
    tailAngle: 13, tailPeriod: 1.6,
    bob: 9, bobPeriod: 0.9,
    blinkPeriod: 3.0, spout: 0.7, swimSpeed: 0,
    bubble: '干完啦',
  },
  dragged: {
    tailAngle: 20, tailPeriod: 0.9,
    bob: 2, bobPeriod: 0.7,
    blinkPeriod: 1.6, spout: 0, swimSpeed: 0,
    bubble: '哇——',
  },
  subagent: {
    tailAngle: 12, tailPeriod: 1.4,
    bob: 4, bobPeriod: 1.4,
    blinkPeriod: 2.8, spout: 0.2, swimSpeed: 0.5,
    bubble: '派了个小助手',
  },
};

/** The state used when the host is unreachable or reports an unknown value. */
export const WHALE_FALLBACK_STATE = 'idle';

/**
 * Short state captions used by the in-GUI widget. The desktop window uses the
 * longer `bubble` line from the state table instead, so these stay terse.
 */
export const WHALE_CAPTIONS = {
  idle: '空闲',
  busy: '干活中',
  waiting: '等你回话',
  done: '干完了',
  subagent: '派了小助手',
  dragged: '被拖拽',
  unknown: '联系不上',
};

/**
 * Resolve a state name to its parameter row, falling back rather than throwing
 * so an unknown state from a newer host degrades to a calm whale.
 * @param {string} name - state reported by the host.
 * @returns {object} the parameter row.
 */
export function whaleStateParams(name) {
  return WHALE_STATES[name] ?? WHALE_STATES[WHALE_FALLBACK_STATE];
}

/**
 * Resolve a state name to its caption.
 * @param {string} name - state reported by the host.
 * @returns {string} the caption, or the fallback state's caption.
 */
export function whaleStateCaption(name) {
  return WHALE_CAPTIONS[name] ?? WHALE_CAPTIONS[WHALE_FALLBACK_STATE];
}

/**
 * The whale's static geometry as plain numbers and point strings.
 *
 * Exposed so a renderer can build its own element tree (the browser half builds
 * React elements) while sharing one geometry. Keep this and `whaleSvgMarkup`
 * in step: `whaleSvgMarkup` is the same shape serialised for `innerHTML`.
 *
 * The body is a closed cubic path rather than an ellipse on purpose: a whale
 * reads as a whale because the head is blunt and the back tapers into the
 * peduncle, which no single ellipse gives.
 *
 * @returns {object} part definitions in `WHALE_BOX` coordinates.
 */
export function whaleShapeParts() {
  return {
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
}

/**
 * Build the whale as SVG markup.
 *
 * Returned as a string rather than a DOM node because the desktop window
 * injects markup directly. The browser half builds equivalent React elements
 * from `whaleShapeParts` and the same palette.
 *
 * @param {string} [idPrefix] - unique prefix for the generated `defs` ids.
 * @returns {string} the `<defs>` plus `<g>` markup for the whale's static geometry.
 */
export function whaleSvgMarkup(idPrefix = WHALE_ID_PREFIX) {
  const p = whaleShapeParts();
  const bodyId = `${idPrefix}-body`;
  const bellyId = `${idPrefix}-belly`;
  return `<defs>
<linearGradient id="${bodyId}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${WHALE_COLORS.backLight}"/>
<stop offset="1" stop-color="${WHALE_COLORS.backDeep}"/>
</linearGradient>
<linearGradient id="${bellyId}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${WHALE_COLORS.belly}"/>
<stop offset="1" stop-color="${WHALE_COLORS.belly}" stop-opacity="0.7"/>
</linearGradient>
</defs>
<g class="wp-bob">
<path class="wp-tail-part" d="${p.tailPath}" fill="url(#${bodyId})"/>
<path d="${p.bodyPath}" fill="url(#${bodyId})"/>
<path d="${p.bellyPath}" fill="url(#${bellyId})" opacity="0.95"/>
<path class="wp-fin-part" d="${p.finPath}" fill="${WHALE_COLORS.backDeep}"/>
<ellipse cx="${p.blowhole.cx}" cy="${p.blowhole.cy}" rx="${p.blowhole.rx}" ry="${p.blowhole.ry}" fill="${WHALE_COLORS.backDeep}" opacity="0.75"/>
<circle class="wp-spout-part" cx="${p.spray.cx}" cy="${p.spray.cy}" r="${p.spray.r}" fill="${WHALE_COLORS.belly}"/>
<ellipse cx="${p.cheek.cx}" cy="${p.cheek.cy}" rx="${p.cheek.rx}" ry="${p.cheek.ry}" fill="${WHALE_COLORS.cheek}" opacity="0.5"/>
<path d="${p.smile}" stroke="${WHALE_COLORS.eye}" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.75"/>
<ellipse class="wp-eye" cx="${p.eyeLeft.cx}" cy="${p.eyeLeft.cy}" rx="${p.eyeLeft.rx}" ry="${p.eyeLeft.ry}" fill="${WHALE_COLORS.eye}"/>
<circle cx="${p.eyeLeft.cx + 1.5}" cy="${p.eyeLeft.cy - 2.5}" r="1.6" fill="#ffffff"/>
<ellipse class="wp-eye" cx="${p.eyeRight.cx}" cy="${p.eyeRight.cy}" rx="${p.eyeRight.rx}" ry="${p.eyeRight.ry}" fill="${WHALE_COLORS.eye}"/>
<circle cx="${p.eyeRight.cx + 1.5}" cy="${p.eyeRight.cy - 2.5}" r="1.5" fill="#ffffff"/>
</g>`;
}

/**
 * The CSS driving every animated part, parameterised by custom properties.
 *
 * Shared so the desktop window and the in-GUI widget move identically. The
 * properties are set per state by the caller from `whaleStateParams`.
 */
export const WHALE_CSS = `
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

/**
 * Build the custom-property bag for one state, so a renderer only assigns
 * `style` and never re-derives animation numbers.
 * @param {string} name - state reported by the host.
 * @returns {Record<string, string>} CSS custom properties.
 */
export function whaleStateVars(name) {
  const p = whaleStateParams(name);
  return {
    '--wp-tail-angle': `${p.tailAngle}deg`,
    '--wp-tail-period': `${p.tailPeriod}s`,
    '--wp-bob': `${p.bob}px`,
    '--wp-bob-period': `${p.bobPeriod}s`,
    '--wp-blink-period': `${p.blinkPeriod}s`,
    '--wp-spout': String(p.spout),
  };
}

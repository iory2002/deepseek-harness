/**
 * Reduced-motion probe. CSS `@media (prefers-reduced-motion: reduce)` cannot
 * govern `element.animate()`, so the decision layer is told directly and the
 * performer falls back to a still frame.
 */

/**
 * Watch the operating system's reduced-motion preference.
 * @param onChange - Called with the current value, then on every change.
 * @param matchMedia - Media-query factory, injectable for tests.
 * @returns disposer that stops watching.
 */
export function watchReducedMotion(onChange, matchMedia = globalThis.matchMedia?.bind(globalThis)) {
  const query = matchMedia?.('(prefers-reduced-motion: reduce)')
  if (query === undefined) {
    onChange(false)
    return () => {}
  }
  const update = () => { onChange(query.matches) }
  update()
  query.addEventListener('change', update)
  return () => { query.removeEventListener('change', update) }
}

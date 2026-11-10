// SPDX-License-Identifier: AGPL-3.0-only
/** Freeze the requested scope. A missing marked region must NEVER mean all. */
export function smoothRegion(scope: 'all' | 'marked', explicit: Uint32Array | null | undefined, painted: () => Uint32Array): Uint32Array | null {
  if (scope === 'marked' && explicit === null) throw new Error('Marked region cannot use a whole-part request. Mark the surface and try again.')
  const selected = explicit === undefined ? (scope === 'marked' ? painted() : null) : explicit
  if (selected === null) return null
  if (selected.length === 0) throw new Error('Nothing is marked. Mark the surface first; Smooth will not fall back to the whole part.')
  return Uint32Array.from(new Set(selected))
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'

export type AdaptiveLock = Readonly<{ index: number; point: readonly [number, number, number] }>
export type AdaptiveLocks = readonly AdaptiveLock[]

function point(net: Net, index: number): readonly [number, number, number] {
  if (!Number.isSafeInteger(index) || Object.is(index, -0) || index < 0 || index >= net.poles.length)
    throw new Error('Indice di blocco non valido.')
  const p = net.poles[index]
  if (!Array.isArray(p) || p.length !== 3 || [0,1,2].some(i => typeof p[i] !== 'number' || !Number.isFinite(p[i])))
    throw new Error('Coordinate del punto bloccato non valide.')
  return p as [number, number, number]
}

/** Validates consistency, not the authenticity or history of a snapshot. */
export function validateAdaptiveLocks(net: Net, locks: AdaptiveLocks): void {
  if (!Array.isArray(locks)) throw new Error('Blocchi non validi.')
  const seen = new Set<number>()
  for (const lock of locks) {
    if (!lock || seen.has(lock.index)) throw new Error('Blocco duplicato o non valido.')
    const p = point(net, lock.index)
    if (!Array.isArray(lock.point) || lock.point.length !== 3 ||
        [0,1,2].some(i => typeof lock.point[i] !== 'number' || !Number.isFinite(lock.point[i]) || lock.point[i] !== p[i]))
      throw new Error('Un punto bloccato è stato modificato.')
    seen.add(lock.index)
  }
}

/** Capture new locks at current positions and retain existing snapshots. */
export function updateAdaptiveLocks(net: Net, previous: AdaptiveLocks, indices: readonly number[]): AdaptiveLocks {
  validateAdaptiveLocks(net, previous)
  if (!Array.isArray(indices) || new Set(indices).size !== indices.length ||
      Array.from({length:indices.length},(_,i)=>!Object.hasOwn(indices,i)).some(Boolean))
    throw new Error('Indici di blocco duplicati o non validi.')
  const prior = new Map(previous.map(lock => [lock.index, lock.point]))
  const result = indices.map(index => {
    const current = point(net, index), saved = prior.get(index) ?? current
    const copy = Object.freeze([...saved]) as readonly [number, number, number]
    return Object.freeze({ index, point: copy })
  }).sort((a, b) => a.index - b.index)
  return Object.freeze(result)
}

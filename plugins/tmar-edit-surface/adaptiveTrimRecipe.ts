// SPDX-License-Identifier: AGPL-3.0-only
import { readRecipe, type LegacySurfaceEditRecipe } from './recipe'

/** Isolated format: legacy readers and workers do not support this policy. */
export type AdaptiveTrimRecipe = Omit<Extract<LegacySurfaceEditRecipe, { version: 4 }>, 'version' | 'preparation' | 'boundaryMode'> & {
  version: 7
  preparation: 'plane-to-bicubic'
  boundaryMode: 'locked'
  trimPolicy: 'circular-fine-v1'
}

const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return !!descriptor && 'value' in descriptor && descriptor.enumerable
  })
}
const dense = (value: unknown): value is unknown[] => Array.isArray(value) &&
  Reflect.ownKeys(value).length === value.length + 1 &&
  Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
    .every(d => !!d && 'value' in d && d.enumerable)

export function readAdaptiveTrimRecipe(input: unknown): AdaptiveTrimRecipe {
  const invalid = (): never => { throw new Error('Ricetta Edit Surface v7 non supportata o incompleta.') }
  if (!exact(input, ['schema', 'version', 'engine', 'units', 'coordinateFrame', 'source', 'faceIndex', 'preparation',
    'baseNetSha256', 'continuity', 'edits', 'lockedPoles', 'boundaryMode', 'refinements', 'trimPolicy'])) return invalid()
  if (input.version !== 7 || input.trimPolicy !== 'circular-fine-v1' || input.preparation !== 'plane-to-bicubic' ||
      input.boundaryMode !== 'locked' || !exact(input.source, ['bodyId', 'brepSha256', 'faceCount', 'solidCount']) ||
      !dense(input.edits) || !dense(input.lockedPoles) || !dense(input.refinements) ||
      input.edits.some(e => !exact(e, ['index', 'point']) || !dense(e.point) || e.point.length !== 3) ||
      input.refinements.some(op => !exact(op, ['axis', 'value', 'count']))) return invalid()
  try {
    const snapshot = structuredClone(input)
    const { trimPolicy: _policy, ...common } = snapshot
    const legacy = readRecipe({ ...common, version: 4 })
    if (legacy.version !== 4) return invalid()
    return { ...legacy, version: 7, preparation: 'plane-to-bicubic', boundaryMode: 'locked', trimPolicy: 'circular-fine-v1' }
  } catch { return invalid() }
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import type { KnotInsertion } from './refineClampedNet'

/** A strict replay recipe, not an automatic topological naming algorithm. */
interface SurfaceEditRecipeBase {
  schema: 'tmar.surface-edit'
  engine: 'occt-wasm-5.7.1/brep-v3'
  units: 'mm'
  coordinateFrame: 'imported-step'
  source: { bodyId: string; brepSha256: string; faceCount: number; solidCount: number }
  faceIndex: number
  preparation: 'plane-to-bicubic' | 'bicubic-midpoint-refinement' | 'native-nurbs'
  baseNetSha256: string
  continuity: 'G0' | 'G1'
  edits: { index: number; point: Point }[]
  /** Locks apply at the edited positions when reopening, not the original ones. */
  lockedPoles: number[]
}

/**
 * v2/v3 retain their original base and pole indexing. v4 replays the ordered
 * insertions before checking baseNetSha256 and applying edits/locks, whose
 * indices refer to that refined base. UV values use the original CAD domain.
 */
export type SurfaceEditRecipe = SurfaceEditRecipeBase & (
  | { version: 2; boundaryMode?: never; refinements?: never }
  | { version: 3; boundaryMode: 'free-natural'; refinements?: never }
  | { version: 4; boundaryMode: 'locked' | 'free-natural'; refinements: KnotInsertion[] }
)

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('')
}

export function readRecipe(value: unknown): SurfaceEditRecipe {
  const r = value as SurfaceEditRecipe | null
  const integer = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
  const digest = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(r, key)
  const validBoundaryMode = !!r && !hasOwn('freeBoundary') && (
    (r.version === 2 && !hasOwn('boundaryMode') && !hasOwn('refinements')) ||
    (r.version === 3 && !hasOwn('refinements') && r.boundaryMode === 'free-natural' && r.source?.faceCount === 1 && r.source?.solidCount === 0) ||
    (r.version === 4 && (r.boundaryMode === 'locked' ||
      (r.boundaryMode === 'free-natural' && r.source?.faceCount === 1 && r.source?.solidCount === 0)))
  )
  if (!r || r.schema !== 'tmar.surface-edit' || !validBoundaryMode || r.engine !== 'occt-wasm-5.7.1/brep-v3'
    || r.units !== 'mm' || r.coordinateFrame !== 'imported-step'
    || !r.source || typeof r.source.bodyId !== 'string' || !r.source.bodyId.trim() || r.source.bodyId.length > 1024
    || !digest(r.source.brepSha256) || !integer(r.source.faceCount, 1, 1000000) || !integer(r.source.solidCount, 0, 1)
    || !integer(r.faceIndex, 0, r.source.faceCount - 1) || !digest(r.baseNetSha256)
    || !['plane-to-bicubic', 'bicubic-midpoint-refinement', 'native-nurbs'].includes(r.preparation)
    || !['G0', 'G1'].includes(r.continuity) || !Array.isArray(r.edits) || r.edits.length > 1600
    || !Array.isArray(r.lockedPoles) || r.lockedPoles.length > 1600) throw new Error('Ricetta Edit Surface non supportata o incompleta.')
  // The source-dependent domain, multiplicity and final pole budget are checked
  // by refineClampedNet during replay, never inferred from recipe metadata.
  if (r.version === 4 && (!Array.isArray(r.refinements) || r.refinements.length === 0 || r.refinements.length > 128 ||
    Array.from(r.refinements).some(op => !op || Array.isArray(op) || (op.axis !== 'U' && op.axis !== 'V') ||
      typeof op.value !== 'number' || !Number.isFinite(op.value) || !integer(op.count, 1, 25) ||
      Object.keys(op).some(key => !['axis', 'value', 'count'].includes(key)))))
    throw new Error('Raffinamenti della ricetta Edit Surface non validi.')
  if (r.edits.some(e => !e || !integer(e.index, 0, 1599) || !Array.isArray(e.point) || e.point.length !== 3 || e.point.some(x => typeof x !== 'number' || !Number.isFinite(x)))
    || new Set(r.edits.map(e => e.index)).size !== r.edits.length
    || r.lockedPoles.some(i => !integer(i, 0, 1599)) || new Set(r.lockedPoles).size !== r.lockedPoles.length) throw new Error('Poli della ricetta Edit Surface non validi.')
  return structuredClone(r)
}

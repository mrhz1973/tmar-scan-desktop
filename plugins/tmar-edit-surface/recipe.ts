// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'

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

/** v2 keeps protected boundaries. v3 explicitly permits the eligible natural free rim. */
export type SurfaceEditRecipe = SurfaceEditRecipeBase & (
  | { version: 2; boundaryMode?: never }
  | { version: 3; boundaryMode: 'free-natural' }
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
    (r.version === 2 && !hasOwn('boundaryMode')) ||
    (r.version === 3 && r.boundaryMode === 'free-natural' && r.source?.faceCount === 1 && r.source?.solidCount === 0)
  )
  if (!r || r.schema !== 'tmar.surface-edit' || !validBoundaryMode || r.engine !== 'occt-wasm-5.7.1/brep-v3'
    || r.units !== 'mm' || r.coordinateFrame !== 'imported-step'
    || !r.source || typeof r.source.bodyId !== 'string' || !r.source.bodyId.trim() || r.source.bodyId.length > 1024
    || !digest(r.source.brepSha256) || !integer(r.source.faceCount, 1, 1000000) || !integer(r.source.solidCount, 0, 1)
    || !integer(r.faceIndex, 0, r.source.faceCount - 1) || !digest(r.baseNetSha256)
    || !['plane-to-bicubic', 'bicubic-midpoint-refinement', 'native-nurbs'].includes(r.preparation)
    || !['G0', 'G1'].includes(r.continuity) || !Array.isArray(r.edits) || r.edits.length > 1600
    || !Array.isArray(r.lockedPoles) || r.lockedPoles.length > 1600) throw new Error('Ricetta Edit Surface non supportata o incompleta.')
  if (r.edits.some(e => !e || !integer(e.index, 0, 1599) || !Array.isArray(e.point) || e.point.length !== 3 || e.point.some(x => typeof x !== 'number' || !Number.isFinite(x)))
    || new Set(r.edits.map(e => e.index)).size !== r.edits.length
    || r.lockedPoles.some(i => !integer(i, 0, 1599)) || new Set(r.lockedPoles).size !== r.lockedPoles.length) throw new Error('Poli della ricetta Edit Surface non validi.')
  return structuredClone(r)
}

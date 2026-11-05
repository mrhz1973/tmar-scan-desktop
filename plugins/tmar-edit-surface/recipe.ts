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
export type LegacySurfaceEditRecipe = SurfaceEditRecipeBase & (
  | { version: 2; boundaryMode?: never; refinements?: never }
  | { version: 3; boundaryMode: 'free-natural'; refinements?: never }
  | { version: 4; boundaryMode: 'locked' | 'free-natural'; refinements: KnotInsertion[] }
)

/** JSON numbers lose negative zero; v5 coefficients encode it explicitly. */
export type SerializedCoordinate = number | '-0'
export type SerializedPoint = [SerializedCoordinate, SerializedCoordinate, SerializedCoordinate]
export interface SerializedPoleEdit { index: number; point: SerializedPoint }
export interface RecipePlaneTangency {
  kind: 'plane'
  supportFaceIndex: number
  edgeIndex: number
  side: 'uMin' | 'uMax' | 'vMin' | 'vMax'
  distanceTolerance: number
  initialLockedPoles: number[]
  /** Both sparse nets are relative to the fingerprinted, prepared source net. */
  proposalBaseEdits: SerializedPoleEdit[]
  acceptedReferenceEdits: SerializedPoleEdit[]
}
export type SurfaceEditRecipeV5 = Omit<SurfaceEditRecipeBase, 'edits'> & {
  version: 5
  boundaryMode: 'locked'
  refinements: KnotInsertion[]
  edits: SerializedPoleEdit[]
  planeTangency: RecipePlaneTangency
}
export type SurfaceEditRecipe = LegacySurfaceEditRecipe | SurfaceEditRecipeV5

/** Explicit opt-in format. Existing readRecipe/worker callers must reject v6
 * until they can adopt a curved constraint, its queue and its fresh tokens. */
export interface RecipeCurvedTangency extends Omit<RecipePlaneTangency, 'kind'> {
  kind: 'compatible-bspline'
  supportSide: 'uMin' | 'uMax' | 'vMin' | 'vMax'
  reverseSupport: boolean
  scale: number
  derivativeTolerance: number
  supportNetSha256: string
}
export type SurfaceEditRecipeV6 = Omit<SurfaceEditRecipeV5, 'version' | 'preparation' | 'refinements' | 'planeTangency'> & {
  version: 6
  preparation: 'native-nurbs'
  /** Current curved certification requires the original native basis exactly. */
  refinements: []
  curvedTangency: RecipeCurvedTangency
}

const serializedCoordinate = (x: unknown): x is SerializedCoordinate => x === '-0' ||
  (typeof x === 'number' && Number.isFinite(x) && !Object.is(x, -0))
const serializedPoint = (p: unknown): p is SerializedPoint => Array.isArray(p) && p.length === 3 &&
  Array.from(p).every(serializedCoordinate)

export function encodeRecipePoint(point: Point): SerializedPoint {
  if (!Array.isArray(point) || point.length !== 3 || Array.from(point).some(x => typeof x !== 'number' || !Number.isFinite(x)))
    throw new Error('Coordinate della ricetta Edit Surface non valide.')
  return point.map(x => Object.is(x, -0) ? '-0' : x) as SerializedPoint
}
export function decodeRecipePoint(point: SerializedPoint): Point {
  if (!serializedPoint(point)) throw new Error('Coordinate della ricetta Edit Surface non valide.')
  return point.map(x => x === '-0' ? -0 : x) as Point
}

/** v5 is deliberately closed: transient tokens, aliases and unknown policy are refused. */
function readG1Recipe(value: unknown): SurfaceEditRecipeV5 {
  const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
  const keys = (x: Record<string, unknown>, expected: readonly string[]) =>
    Object.keys(x).length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(x, key))
  const integer = (x: unknown, min: number, max: number): x is number =>
    typeof x === 'number' && Number.isInteger(x) && !Object.is(x, -0) && x >= min && x <= max
  const digest = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)
  const ids = (x: unknown): x is number[] => Array.isArray(x) && x.length <= 1600 &&
    Array.from(x).every(i => integer(i, 0, 1599)) && new Set(x).size === x.length
  const edits = (x: unknown): x is SerializedPoleEdit[] => Array.isArray(x) && x.length <= 1600 &&
    Array.from(x).every(e => object(e) && keys(e, ['index', 'point']) && integer(e.index, 0, 1599) && serializedPoint(e.point)) &&
    new Set(x.map(e => e.index)).size === x.length
  const invalid = () => { throw new Error('Ricetta Edit Surface G1 v5 non supportata o incompleta.') }
  if (!object(value) || !keys(value, ['schema', 'version', 'engine', 'units', 'coordinateFrame', 'source', 'faceIndex',
    'preparation', 'baseNetSha256', 'continuity', 'edits', 'lockedPoles', 'boundaryMode', 'refinements', 'planeTangency'])) return invalid()
  const r = value, source = r.source, constraint = r.planeTangency
  if (r.schema !== 'tmar.surface-edit' || r.version !== 5 || r.engine !== 'occt-wasm-5.7.1/brep-v3' ||
      r.units !== 'mm' || r.coordinateFrame !== 'imported-step' || r.boundaryMode !== 'locked' ||
      !object(source) || !keys(source, ['bodyId', 'brepSha256', 'faceCount', 'solidCount']) ||
      typeof source.bodyId !== 'string' || !source.bodyId.trim() || source.bodyId.length > 1024 ||
      !digest(source.brepSha256) || !integer(source.faceCount, 2, 1000000) || !integer(source.solidCount, 0, 1) ||
      !integer(r.faceIndex, 0, source.faceCount - 1) || !digest(r.baseNetSha256) ||
      !['plane-to-bicubic', 'bicubic-midpoint-refinement', 'native-nurbs'].includes(r.preparation as string) ||
      !['G0', 'G1'].includes(r.continuity as string) || !ids(r.lockedPoles) || !edits(r.edits) ||
      !Array.isArray(r.refinements) || r.refinements.length > 128 ||
      Array.from(r.refinements).some(op => !object(op) || !keys(op, ['axis', 'value', 'count']) ||
        (op.axis !== 'U' && op.axis !== 'V') || typeof op.value !== 'number' || !Number.isFinite(op.value) ||
        Object.is(op.value, -0) || !integer(op.count, 1, 25)) ||
      !object(constraint) || !keys(constraint, ['kind', 'supportFaceIndex', 'edgeIndex', 'side', 'distanceTolerance',
        'initialLockedPoles', 'proposalBaseEdits', 'acceptedReferenceEdits']) || constraint.kind !== 'plane' ||
      !integer(constraint.supportFaceIndex, 0, source.faceCount - 1) || constraint.supportFaceIndex === r.faceIndex ||
      !integer(constraint.edgeIndex, 0, 3) || !['uMin', 'uMax', 'vMin', 'vMax'].includes(constraint.side as string) ||
      typeof constraint.distanceTolerance !== 'number' || !Number.isFinite(constraint.distanceTolerance) ||
      constraint.distanceTolerance <= 0 || constraint.distanceTolerance > 1e-6 ||
      !ids(constraint.initialLockedPoles) || !edits(constraint.proposalBaseEdits) || !edits(constraint.acceptedReferenceEdits)) return invalid()
  // Actual domains, pole counts, natural topology and coefficient protections
  // belong to kernel replay; schema metadata cannot establish CAD eligibility.
  return structuredClone(value) as SurfaceEditRecipeV5
}

/** Deliberately separate from readRecipe: no generic caller may drop the curved
 * constraint and reinterpret these signed-zero coefficients as legacy edits. */
export function readCurvedRecipe(value: unknown): SurfaceEditRecipeV6 {
  const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
  const keys = (x: Record<string, unknown>, expected: readonly string[]) => Object.keys(x).length === expected.length &&
    expected.every(key => Object.prototype.hasOwnProperty.call(x, key))
  const invalid = (): never => { throw new Error('Ricetta Edit Surface G1 B-spline v6 non supportata o incompleta.') }
  // Validate the owned snapshot that will actually be returned, including when
  // a direct kernel caller supplies accessors instead of JSON data.
  try { value = structuredClone(value) } catch { return invalid() }
  if (!object(value) || !keys(value, ['schema', 'version', 'engine', 'units', 'coordinateFrame', 'source', 'faceIndex',
    'preparation', 'baseNetSha256', 'continuity', 'edits', 'lockedPoles', 'boundaryMode', 'refinements', 'curvedTangency'])) return invalid()
  const c = value.curvedTangency
  if (value.version !== 6 || value.preparation !== 'native-nurbs' || !Array.isArray(value.refinements) || value.refinements.length !== 0 ||
      !object(c) || !keys(c, ['kind', 'supportFaceIndex', 'edgeIndex', 'side', 'supportSide', 'reverseSupport', 'scale',
        'distanceTolerance', 'derivativeTolerance', 'supportNetSha256', 'initialLockedPoles', 'proposalBaseEdits', 'acceptedReferenceEdits']) ||
      c.kind !== 'compatible-bspline' || !['uMin', 'uMax', 'vMin', 'vMax'].includes(c.supportSide as string) ||
      typeof c.reverseSupport !== 'boolean' || typeof c.scale !== 'number' || !Number.isFinite(c.scale) || c.scale <= 0 ||
      typeof c.derivativeTolerance !== 'number' || !Number.isFinite(c.derivativeTolerance) || c.derivativeTolerance <= 0 || c.derivativeTolerance > 1e-6 ||
      typeof c.supportNetSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(c.supportNetSha256)) return invalid()
  // Reuse the unchanged v5 policy for every shared field, lock and signed-zero
  // sparse net. This adapter is validation-only; no v5 recipe escapes this API.
  const { curvedTangency: _curved, ...common } = value
  try {
    readG1Recipe({ ...common, version: 5, planeTangency: { kind: 'plane', supportFaceIndex: c.supportFaceIndex,
      edgeIndex: c.edgeIndex, side: c.side, distanceTolerance: c.distanceTolerance, initialLockedPoles: c.initialLockedPoles,
      proposalBaseEdits: c.proposalBaseEdits, acceptedReferenceEdits: c.acceptedReferenceEdits } })
  } catch { return invalid() }
  return value as SurfaceEditRecipeV6
}

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('')
}

export function readRecipe(value: unknown): SurfaceEditRecipe {
  if ((value as { version?: unknown } | null)?.version === 5) return readG1Recipe(value)
  const r = value as LegacySurfaceEditRecipe | null
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

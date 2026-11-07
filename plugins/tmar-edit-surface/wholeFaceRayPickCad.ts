// SPDX-License-Identifier: AGPL-3.0-only
// Resolve a visible mesh seed against the selected CAD face on the editor worker.
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'
import type { Point } from './brep'

const CAD_TOLERANCE_MM = 1e-6
/** The renderer meshes use 0.08 mm linear deflection; retain margin for a ray/triangle seed. */
export const WHOLE_FACE_PICK_SEED_TOLERANCE_MM = 0.16
const MIN_RAY_INCIDENCE = 0.1

const vec = (p: Point): Vec3 => ({ x: p[0], y: p[1], z: p[2] })
const tuple = (p: Vec3): Point => [p.x, p.y, p.z]
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export interface WholeFaceRayPickInput {
  /** Ray/preview-mesh intersection in the selected face's part coordinates. */
  readonly seed: Point
  /** Ray origin and unit direction in the same part coordinates as seed. */
  readonly origin: Point
  readonly direction: Point
}

export interface WholeFaceRayPick {
  /** Exact CAD intersection point on the selected face. */
  readonly point: Point
  readonly u: number
  readonly v: number
  /** Unit CAD face normal; surfaceNormal already accounts for face orientation. */
  readonly normal: Point
  readonly rayDistanceMm: number
  readonly seedDistanceMm: number
  readonly intersectionCount: 1
}

/**
 * Verify that a tessellated-face pick corresponds to one unique, transverse
 * intersection of the camera ray with the actual CAD face. The caller must
 * separately bind the result to its preview/selection revision.
 */
export function queryWholeFaceRayPickCad(
  kernel: OcctKernel,
  face: ShapeHandle,
  input: WholeFaceRayPickInput,
): WholeFaceRayPick {
  const { seed, origin, direction } = input
  if ([seed, origin, direction].some(p => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)))
    throw new Error('Raggio o punto di selezione CAD non valido.')
  const directionLength = Math.hypot(...direction)
  if (!Number.isFinite(directionLength) || Math.abs(directionLength - 1) > 1e-8)
    throw new Error('La direzione del raggio CAD deve essere unitaria.')
  const seedOffset = seed.map((x, i) => x - origin[i]) as Point
  const seedDepth = dot(seedOffset, direction)
  const seedProjection = origin.map((x, i) => x + direction[i] * seedDepth) as Point
  if (!Number.isFinite(seedDepth) || seedDepth <= 1e-5 || seedDepth > 1e6 || distance(seed, seedProjection) > CAD_TOLERANCE_MM)
    throw new Error('Il punto scelto non appartiene a un raggio CAD qualificabile.')

  const endDepth = seedDepth + WHOLE_FACE_PICK_SEED_TOLERANCE_MM + CAD_TOLERANCE_MM * 8
  const end = origin.map((x, i) => x + direction[i] * endDepth) as Point
  const owned: ShapeHandle[] = []
  const own = (shape: ShapeHandle): ShapeHandle => { owned.push(shape); return shape }
  const children = (shape: ShapeHandle, type: 'edge' | 'vertex'): ShapeHandle[] => {
    const result = kernel.getSubShapes(shape, type)
    owned.push(...result)
    return result
  }
  try {
    const segment = own(kernel.makeLineEdge(vec(origin), vec(end)))
    const section = own(kernel.section(face, segment))
    const sectionEdges = children(section, 'edge')
    const vertices = children(section, 'vertex')
    if (sectionEdges.length || vertices.length !== 1)
      throw new Error('Il raggio CAD non identifica un solo punto di intersezione.')

    const hit = tuple(kernel.vertexPosition(vertices[0]))
    if (!hit.every(Number.isFinite)) throw new Error('Intersezione CAD non valida.')
    const hitOffset = hit.map((x, i) => x - origin[i]) as Point
    const rayDistanceMm = dot(hitOffset, direction)
    const onRay = origin.map((x, i) => x + direction[i] * rayDistanceMm) as Point
    const seedDistanceMm = distance(hit, seed)
    if (!Number.isFinite(rayDistanceMm) || rayDistanceMm <= 1e-5 || rayDistanceMm > endDepth ||
        distance(hit, onRay) > CAD_TOLERANCE_MM || !Number.isFinite(seedDistanceMm) ||
        seedDistanceMm > WHOLE_FACE_PICK_SEED_TOLERANCE_MM)
      throw new Error('La faccia CAD non corrisponde al punto visibile selezionato.')

    const uv = kernel.uvFromPoint(face, vec(hit))
    if (!Number.isFinite(uv.u) || !Number.isFinite(uv.v)) throw new Error('Coordinate UV CAD non determinate.')
    const bounds = kernel.uvBounds(face)
    if (![bounds.uMin, bounds.uMax, bounds.vMin, bounds.vMax].every(Number.isFinite) ||
        uv.u < bounds.uMin || uv.u > bounds.uMax || uv.v < bounds.vMin || uv.v > bounds.vMax ||
        kernel.classifyPointOnFace(face, uv.u, uv.v) !== 'in')
      throw new Error('Il punto del raggio non è interno alla faccia CAD selezionata.')

    const cadPoint = tuple(kernel.pointOnSurface(face, uv.u, uv.v))
    if (!cadPoint.every(Number.isFinite) || distance(cadPoint, hit) > CAD_TOLERANCE_MM)
      throw new Error('Proiezione UV e intersezione del raggio non coincidono.')
    const orientation = kernel.shapeOrientation(face)
    if (orientation !== 'forward' && orientation !== 'reversed')
      throw new Error('Orientamento della faccia CAD non supportato.')
    const rawNormal = tuple(kernel.surfaceNormal(face, uv.u, uv.v))
    const normalLength = Math.hypot(...rawNormal)
    if (!rawNormal.every(Number.isFinite) || !Number.isFinite(normalLength) || normalLength <= 1e-12)
      throw new Error('Normale della faccia CAD non determinata.')
    const normal = rawNormal.map(x => x / normalLength) as Point
    if (Math.abs(dot(normal, direction)) < MIN_RAY_INCIDENCE)
      throw new Error('Il raggio è troppo radente alla faccia CAD.')

    return { point: cadPoint, u: uv.u, v: uv.v, normal, rayDistanceMm, seedDistanceMm, intersectionCount: 1 }
  } finally {
    owned.reverse().forEach(shape => kernel.release(shape))
  }
}

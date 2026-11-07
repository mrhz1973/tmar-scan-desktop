// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'
import type { Point } from './brep'
import { proveBoundaryPointVisibility } from './boundaryVisibilityCad'
import { sheetEdgePaths, withBoundary } from './sheetExtension'

const tolerance = 1e-6
const endpointMargin = 1e-5
const finite = (p:readonly number[]) => p.length === 3 && p.every(Number.isFinite)
const tuple = (p:Vec3):Point => [p.x,p.y,p.z]
const vec = (p:Point):Vec3 => ({x:p[0],y:p[1],z:p[2]})
const distance = (a:Point,b:Point) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])

export interface SheetEdgeVisibilityCandidate {
  /** Same free-edge index and path supplied by sheetEdgePaths for this CAD revision. */
  edge:number
  path:readonly Point[]
  seed:Point
}

/** A read-only proof for overlapping straight free edges of one open CAD shell.
 * The caller supplies the screen-equivalent candidates and still owns the
 * preview/camera fence and reprojection of the returned point.
 */
export function queryVisibleSheetEdge(k:OcctKernel,source:ShapeHandle,candidates:readonly SheetEdgeVisibilityCandidate[],
  cameraOrigin:Point,parallelDirection?:Point):{edge:number;point:Point}|null {
  if (!candidates.length || candidates.length > 8 || !finite(cameraOrigin) ||
      (parallelDirection && !finite(parallelDirection)) ||
      candidates.some(candidate => !Number.isSafeInteger(candidate.edge) || candidate.edge < 0 ||
        candidate.path.length !== 2 || !candidate.path.every(finite) || !finite(candidate.seed)) ||
      new Set(candidates.map(candidate => candidate.edge)).size !== candidates.length) return null
  const kind = k.getShapeType(source)
  if (kind !== 'shell' && kind !== 'face') return null
  const text = k.toBREP(source)
  const faceHeaders = [...text.matchAll(/^Fa\s*\n\s*[01]\s+([\deE+.-]+)\s+\d+\s+(\d+)\s*$/gm)]
  const edgeVertexTolerances = [...text.matchAll(/^(?:Ed|Ve)\s*\n\s*([\deE+.-]+)/gm)].map(match => Number(match[1]))
  if (!faceHeaders.length || !edgeVertexTolerances.length || faceHeaders.some(match => match[2] !== '0') ||
      [...edgeVertexTolerances,...faceHeaders.map(match => Number(match[1]))]
        .some(value => !Number.isFinite(value) || value < 0 || value > tolerance)) return null
  const shell = k.fromBREP(text)
  const faces:ShapeHandle[] = []
  try {
    if (!k.isValid(shell) || k.getShapeType(shell) !== kind || k.subShapeCount(shell,'solid') !== 0) return null
    faces.push(...k.getSubShapes(shell,'face'))
    if (faces.length !== faceHeaders.length) return null
    const paths = sheetEdgePaths(k,shell)
    return withBoundary(k,shell,edges => {
      let winner:{edge:number;point:Point}|null = null
      for (const candidate of candidates) {
        const edge = edges[candidate.edge], path = paths[candidate.edge]
        if (!edge || !path || path.length !== 2 || k.curveType(edge) !== 'line' ||
            !path.every((point,i) => distance(point,candidate.path[i]) <= tolerance)) return null
        const matches = paths.filter(other => other.length === 2 &&
          (other.every((point,i) => distance(point,path[i]) <= tolerance) ||
           other.every((point,i) => distance(point,path[1-i]) <= tolerance)))
        if (matches.length !== 1) return null
        const {first,last} = k.curveParameters(edge)
        const projected = k.projectPointOnEdge(edge,vec(candidate.seed)), point = tuple(projected.point)
        if (!Number.isFinite(first) || !Number.isFinite(last) || !Number.isFinite(projected.parameter) ||
            projected.parameter <= first || projected.parameter >= last || !finite(point) ||
            distance(point,candidate.seed) > tolerance || path.some(end => distance(end,point) < endpointMargin)) return null
        const incident = faces.filter(face => {
          const rims = k.getSubShapes(face,'edge')
          try { return rims.some(rim => k.isSame(rim,edge)) } finally { rims.forEach(rim => k.release(rim)) }
        })
        if (incident.length !== 1) return null
        const face = incident[0], {u,v} = k.uvFromPoint(face,vec(point))
        if (!Number.isFinite(u) || !Number.isFinite(v)) return null
        const surface = tuple(k.pointOnSurface(face,u,v))
        if (!finite(surface) || distance(surface,point) > tolerance ||
            !['in','on'].includes(k.classifyPointOnFace(face,u,v))) return null
        const result = proveBoundaryPointVisibility(k,shell,point,tuple(k.surfaceNormal(face,u,v)),cameraOrigin,parallelDirection)
        if (result.reason === 'occluded') continue
        if (!result.visible || winner) return null
        winner = {edge:candidate.edge,point:result.point}
      }
      return winner
    })
  } finally { faces.forEach(face => k.release(face)); k.release(shell) }
}

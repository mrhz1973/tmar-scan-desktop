// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'
import type { Point } from './brep'
import { proveBoundaryPointVisibility } from './boundaryVisibilityCad'
import { proveClippedBoundaryVisibility } from './clippedBoundaryVisibilityCad'
import { clippedPointCertainty, type ClippedRayMargins, type WorldClipPlane } from './clippedRayInterval'
import { sheetEdgePaths, withBoundary } from './sheetExtension'

const tolerance = 1e-6
const endpointMargin = 1e-5
const finite = (p:readonly number[]) => p.length === 3 && p.every(Number.isFinite)
const tuple = (p:Vec3):Point => [p.x,p.y,p.z]
const vec = (p:Point):Vec3 => ({x:p[0],y:p[1],z:p[2]})
const distance = (a:Point,b:Point) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])

export interface SheetEdgeClippingProof {
  partToWorld:readonly number[]
  planes:readonly WorldClipPlane[]
  margins:ClippedRayMargins
}

export interface SheetEdgeVisibilityCandidate {
  /** Same free-edge index and path supplied by sheetEdgePaths for this CAD revision. */
  edge:number
  path:readonly Point[]
  seed:Point
  /** Required for a sampled curved edge. Straight paths have only segment 0. */
  segment?:number
}

function candidatePoint(k:OcctKernel,edge:ShapeHandle,path:Point[],candidate:SheetEdgeVisibilityCandidate):Point|null {
  const {first,last}=k.curveParameters(edge)
  if (!Number.isFinite(first) || !Number.isFinite(last) || last<=first) return null
  const kind=k.curveType(edge)
  let t:number, point:Point
  if (kind==='line' && path.length===2 && (candidate.segment===undefined || candidate.segment===0)) {
    const projected=k.projectPointOnEdge(edge,vec(candidate.seed))
    t=projected.parameter
    point=tuple(projected.point)
    if (distance(point,candidate.seed)>tolerance) return null
  } else {
    const segment=candidate.segment
    if (kind!=='bspline' || path.length!==49 || segment===undefined || !Number.isInteger(segment) ||
        segment<0 || segment>=path.length-1 || k.curveIsClosed(edge) || k.curveIsPeriodic(edge)) return null
    const start=path[segment], end=path[segment+1]
    const chord=end.map((value,i)=>value-start[i])
    const squared=chord.reduce((sum,value)=>sum+value*value,0)
    if (!Number.isFinite(squared) || squared<=1e-18) return null
    const fraction=chord.reduce((sum,value,i)=>sum+value*(candidate.seed[i]-start[i]),0)/squared
    const along=Math.max(0,Math.min(1,fraction))
    const onChord=start.map((value,i)=>value+along*chord[i]) as Point
    if (!finite(onChord) || distance(onChord,candidate.seed)>1e-7) return null
    const step=(last-first)/(path.length-1), lo=first+segment*step, hi=first+(segment+1)*step
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi<=lo) return null
    const nativeStart=tuple(k.curvePointAtParam(edge,lo)), nativeEnd=tuple(k.curvePointAtParam(edge,hi))
    if (!finite(nativeStart) || !finite(nativeEnd) ||
        distance(nativeStart,start)>tolerance || distance(nativeEnd,end)>tolerance) return null
    // The picker chord is parameterized by samples of this very edge. Map
    // its fraction to that interval, without a global nearest-point search.
    t=lo+along*(hi-lo)
    if (!(t>=lo && t<=hi)) return null
    point=tuple(k.curvePointAtParam(edge,t))
    const tangent=tuple(k.curveTangent(edge,t))
    if (!finite(tangent) || Math.hypot(...tangent)<=1e-12) return null
  }
  return Number.isFinite(t) && t>first && t<last && finite(point) &&
    [path[0],path[path.length-1]].every(end=>distance(end,point)>=endpointMargin) ? point : null
}

/** A read-only proof for straight or open, nonperiodic B-spline free edges of one CAD shell.
 * The caller supplies the screen-equivalent candidates and still owns the
 * preview/camera fence and reprojection of the returned point.
 */
export function queryVisibleSheetEdge(k:OcctKernel,source:ShapeHandle,candidates:readonly SheetEdgeVisibilityCandidate[],
  cameraOrigin:Point,parallelDirection?:Point,clipping?:SheetEdgeClippingProof):{edge:number;point:Point}|null {
  if (!candidates.length || candidates.length > 8 || !finite(cameraOrigin) ||
      (parallelDirection && !finite(parallelDirection)) ||
      candidates.some(candidate => !Number.isSafeInteger(candidate.edge) || candidate.edge < 0 ||
        ![2,49].includes(candidate.path.length) || !candidate.path.every(finite) || !finite(candidate.seed)) ||
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
        if (!edge || !path || path.length!==candidate.path.length ||
            !path.every((point,i) => distance(point,candidate.path[i]) <= tolerance)) return null
        const matches = paths.filter(other => other.length===path.length &&
          (other.every((point,i) => distance(point,path[i]) <= tolerance) ||
           other.every((point,i) => distance(point,path[path.length-1-i]) <= tolerance)))
        if (matches.length !== 1) return null
        const point=candidatePoint(k,edge,path,candidate)
        if (!point) return null
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
        if (clipping && clippedPointCertainty(point,clipping.partToWorld,clipping.planes,
          clipping.margins.planeClearanceMm)==='clipped') continue
        const normal=tuple(k.surfaceNormal(face,u,v))
        const result = clipping
          ? proveClippedBoundaryVisibility(k,shell,point,normal,cameraOrigin,clipping.partToWorld,clipping.planes,clipping.margins,parallelDirection)
          : proveBoundaryPointVisibility(k,shell,point,normal,cameraOrigin,parallelDirection)
        if (result.reason === 'occluded') continue
        if (!result.visible || winner) return null
        winner = {edge:candidate.edge,point}
      }
      return winner
    })
  } finally { faces.forEach(face => k.release(face)); k.release(shell) }
}

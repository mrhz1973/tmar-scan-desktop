// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'

export interface WorldClipPlane {
  /** Plane equation in world coordinates: normal · point + constant >= 0 is retained. */
  normal: Point
  constant: number
}

export interface ClippedRayMargins {
  /** Required world-space clearance of both the target and section extension from every plane. */
  planeClearanceMm: number
  /** Moves the section start this far before a clipping-plane crossing. */
  startGuardMm: number
  /** Extension before and after the target used to make the native section robust. */
  endpointExtensionMm: number
  /** Minimum retained ray length after the start guard and before the target extension. */
  minimumVisibleLengthMm: number
  /** Minimum absolute cosine at a clipped-to-retained crossing; rejects near-tangent cuts. */
  minimumCrossingCosine: number
}

export interface ClippedRayIntervalInput {
  originPart: Point
  targetPart: Point
  /** Column-major affine transform from part coordinates to world coordinates. */
  partToWorld: readonly number[]
  planes: readonly WorldClipPlane[]
  margins: ClippedRayMargins
}

export interface ClippedRayInterval {
  /** Parameter of the section start; it is at or before entry into all retained half-spaces. */
  startParameter: number
  /** Before this parameter at least one half-space certainly excludes the point. */
  certainlyClippedUntilParameter: number
  /** Conservative parameter at or after entry into all retained half-spaces. */
  visibleStartParameter: number
  /** Retained length from the first clip-plane crossing to targetPart, in world millimetres. */
  visibleLengthMm: number
  /** Start (possibly in the clipped region) and extended end for a native CAD section. */
  sectionStartPart: Point
  sectionEndPart: Point
  /** End of the clear-front segment, in part coordinates. */
  frontClearEndPart: Point
}

const maxInputMagnitude = 1e12
const finiteDense = (values: readonly number[], length: number): boolean => Array.isArray(values) && values.length === length &&
  Array.from({length},(_,index)=>Object.prototype.hasOwnProperty.call(values,index) && Number.isFinite(values[index]) &&
    Math.abs(values[index]) <= maxInputMagnitude).every(Boolean)
const finitePoint = (point: readonly number[]): boolean => finiteDense(point,3)
const finiteMargins = (m: ClippedRayMargins): boolean => !!m && typeof m === 'object' &&
  [m.planeClearanceMm, m.startGuardMm, m.endpointExtensionMm, m.minimumVisibleLengthMm,
    m.minimumCrossingCosine].every(value=>Number.isFinite(value) && Math.abs(value)<=maxInputMagnitude) &&
  m.planeClearanceMm >= 0 && m.startGuardMm >= 0 && m.endpointExtensionMm >= 0 &&
  m.minimumVisibleLengthMm > 0 && m.minimumCrossingCosine > 0 && m.minimumCrossingCosine < 1

const transformPoint = (point: Point, matrix: readonly number[]): {point:Point; error:Point} => {
  const xTerms=[matrix[0]*point[0],matrix[4]*point[1],matrix[8]*point[2],matrix[12]]
  const yTerms=[matrix[1]*point[0],matrix[5]*point[1],matrix[9]*point[2],matrix[13]]
  const zTerms=[matrix[2]*point[0],matrix[6]*point[1],matrix[10]*point[2],matrix[14]]
  const x = matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12]
  const y = matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13]
  const z = matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14]
  const w = matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15]
  const pointWorld:Point = Math.abs(w - 1) <= 1e-12 ? [x, y, z] : [Number.NaN, Number.NaN, Number.NaN]
  const roundoff=64*Number.EPSILON
  return {point:pointWorld,error:[roundoff*xTerms.reduce((sum,value)=>sum+Math.abs(value),0),
    roundoff*yTerms.reduce((sum,value)=>sum+Math.abs(value),0),roundoff*zTerms.reduce((sum,value)=>sum+Math.abs(value),0)]}
}

const planeDistance = (plane: WorldClipPlane, point: Point, pointError:Point): {distance:number;error:number} => {
  const length = Math.hypot(...plane.normal)
  if (!Number.isFinite(length) || length <= 1e-15) return {distance:Number.NaN,error:Number.NaN}
  const normal=plane.normal.map(value=>value/length),constant=plane.constant/length
  const terms=normal.map((value,index)=>value*point[index])
  const distance=terms[0]+terms[1]+terms[2]+constant
  const error=64*Number.EPSILON*(terms.reduce((sum,value)=>sum+Math.abs(value),Math.abs(constant))+1)+
    normal.reduce((sum,value,index)=>sum+Math.abs(value)*pointError[index],0)
  return {distance,error}
}

const lerp = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/**
 * Compute the visible portion of an origin-to-target ray against intersecting
 * world-space clipping half-spaces. Invalid or marginal cases return null so
 * callers can fail closed. This is only a geometric interval helper; it does
 * not establish CAD visibility or prove that the target lies on a CAD edge.
 */
export function clippedRayInterval(input: ClippedRayIntervalInput): ClippedRayInterval | null {
  if (!input || typeof input !== 'object') return null
  const { originPart, targetPart, partToWorld, planes, margins } = input
  if (!finitePoint(originPart) || !finitePoint(targetPart) || !finiteDense(partToWorld,16) || !finiteMargins(margins) ||
      !Array.isArray(planes)) return null
  for(let index=0;index<planes.length;index++) {
    if(!Object.prototype.hasOwnProperty.call(planes,index))return null
    const plane=planes[index]
    if(!plane || typeof plane!=='object' || !finitePoint(plane.normal) || !Number.isFinite(plane.constant) ||
        Math.abs(plane.constant)>maxInputMagnitude || Math.hypot(...plane.normal)<=1e-15)return null
  }
  // A projective transform would make the linear parameter cease to describe
  // a world-space ray, so accept affine transforms only.
  if (Math.abs(partToWorld[3]) > 1e-12 || Math.abs(partToWorld[7]) > 1e-12 ||
      Math.abs(partToWorld[11]) > 1e-12 || Math.abs(partToWorld[15] - 1) > 1e-12) return null

  const originTransformed = transformPoint(originPart, partToWorld)
  const targetTransformed = transformPoint(targetPart, partToWorld)
  const originWorld=originTransformed.point,targetWorld=targetTransformed.point
  if (!finitePoint(originWorld) || !finitePoint(targetWorld) || !finitePoint(originTransformed.error) ||
      !finitePoint(targetTransformed.error) ||
      [...originWorld,...targetWorld].some(value=>Math.abs(value)>maxInputMagnitude)) return null
  // Transform the difference directly, avoiding cancellation of a large
  // shared world translation when the actual ray segment is short.
  const rayPart:Point=[targetPart[0]-originPart[0],targetPart[1]-originPart[1],targetPart[2]-originPart[2]]
  const rayTerms=[
    [partToWorld[0]*rayPart[0],partToWorld[4]*rayPart[1],partToWorld[8]*rayPart[2]],
    [partToWorld[1]*rayPart[0],partToWorld[5]*rayPart[1],partToWorld[9]*rayPart[2]],
    [partToWorld[2]*rayPart[0],partToWorld[6]*rayPart[1],partToWorld[10]*rayPart[2]],
  ]
  const rayWorld:Point=rayTerms.map(terms=>terms[0]+terms[1]+terms[2]) as Point
  const rayWorldError:Point=rayTerms.map((terms,index)=>64*Number.EPSILON*(terms.reduce((sum,value)=>sum+Math.abs(value),0)+
    Math.abs(partToWorld[index]*0))) as Point
  const rayLength = Math.hypot(...rayWorld)
  const rayLengthError=Math.hypot(...rayWorldError)
  if (!Number.isFinite(rayLength) || !Number.isFinite(rayLengthError) ||
      rayLength-rayLengthError <= margins.minimumVisibleLengthMm + margins.endpointExtensionMm) return null

  let startDistance = 0, certainlyClippedUntilDistance=0, visibleStartDistance=0
  for (const plane of planes) {
    const from=planeDistance(plane,originWorld,originTransformed.error)
    const to=planeDistance(plane,targetWorld,targetTransformed.error)
    if (!Number.isFinite(from.distance) || !Number.isFinite(to.distance) ||
        to.distance - to.error <= margins.planeClearanceMm) return null
    // If the origin may be clipped (including numerically uncertain starts),
    // include the whole boundary band in the native section. Moving the
    // section start forward would skip visible occluders just beyond the cut.
    if (from.distance <= from.error) {
      if(from.distance>=-from.error)return null
      const crossingDistanceLower=to.distance-to.error-(from.distance+from.error)
      const crossingCosine = crossingDistanceLower / (rayLength+rayLengthError)
      if (!Number.isFinite(crossingCosine) || crossingCosine <= margins.minimumCrossingCosine) return null
      const earliestDenominator=(to.distance+to.error)-(from.distance+from.error)
      const latestDenominator=(to.distance-to.error)-(from.distance-from.error)
      const earliestCrossing=-(from.distance+from.error)/earliestDenominator
      const latestCrossing=-(from.distance-from.error)/latestDenominator
      const conservativeStart = earliestCrossing - margins.startGuardMm / (rayLength-rayLengthError)
      if (!Number.isFinite(earliestCrossing) || !Number.isFinite(latestCrossing) ||
          earliestDenominator<=0 || latestDenominator<=0 || earliestCrossing<0 ||
          latestCrossing<0 || latestCrossing>=1 ||
          !Number.isFinite(conservativeStart) || conservativeStart >= 1) return null
      certainlyClippedUntilDistance = Math.max(certainlyClippedUntilDistance, earliestCrossing)
      visibleStartDistance = Math.max(visibleStartDistance, latestCrossing)
      startDistance = Math.max(startDistance, Math.max(0, conservativeStart))
    }
  }

  const visibleLengthMm = (1 - visibleStartDistance) * rayLength
  if (!Number.isFinite(visibleLengthMm) || visibleLengthMm - margins.endpointExtensionMm < margins.minimumVisibleLengthMm) return null
  const extensionParameter = margins.endpointExtensionMm / rayLength
  const sectionEndParameter = 1 + extensionParameter
  const frontEndParameter = 1 - extensionParameter
  const sectionStartPart = lerp(originPart, targetPart, startDistance)
  const sectionEndPart = lerp(originPart, targetPart, sectionEndParameter)
  const frontClearEndPart = lerp(originPart, targetPart, frontEndParameter)
  const sectionEndWorld = transformPoint(sectionEndPart, partToWorld)
  const sectionEndWorldPoint=sectionEndWorld.point
  if (!finitePoint(sectionStartPart) || !finitePoint(sectionEndPart) || !finitePoint(frontClearEndPart) ||
      !finitePoint(sectionEndWorldPoint) || planes.some(plane => {
        const end = planeDistance(plane, sectionEndWorldPoint,sectionEndWorld.error)
        return !Number.isFinite(end.distance) || end.distance-end.error <= margins.planeClearanceMm
      })) return null

  return { startParameter: startDistance, certainlyClippedUntilParameter:certainlyClippedUntilDistance,
    visibleStartParameter:visibleStartDistance, visibleLengthMm,
    sectionStartPart, sectionEndPart, frontClearEndPart }
}

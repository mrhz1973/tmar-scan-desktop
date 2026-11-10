// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'

type XYZ = { x: number; y: number; z: number }
type Pole = { point: XYZ; v: number; direction: number }
const EPS = 1e-6
const meridians = Array.from({ length: 12 }, (_, i) => (i + .5) / 12)
const levels = [1e-3, 2.5e-4, 6.25e-5]
const distance = (a: XYZ, b: XYZ) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z)
const dot = (a: XYZ, b: XYZ) => a.x*b.x+a.y*b.y+a.z*b.z
function fail(reason: string): never { throw new Error(`Sfera: ${reason}`) }
function unit(p: XYZ): XYZ {
  const length = Math.hypot(p.x,p.y,p.z)
  if (!Number.isFinite(length) || length < 1e-8) fail('normale regolare non determinata.')
  return { x:p.x/length, y:p.y/length, z:p.z/length }
}
function same(a: XYZ, b: XYZ): void {
  const d = distance(a,b)
  if (!Number.isFinite(d) || d > EPS) fail('testimoni 3D non coincidenti.')
}
function onFace(k: OcctKernel, face: ShapeHandle, p: XYZ): number {
  const vertex = k.makeVertex(p.x,p.y,p.z)
  try {
    // A FACE, never its owning solid: volume distance can hide an interior point.
    const d = k.distanceBetween(vertex,face)
    if (!Number.isFinite(d) || d > EPS) fail('punto fuori dalla faccia rifilata.')
    return d
  } finally { k.release(vertex) }
}
function classification(k: OcctKernel, face: ShapeHandle, u: number, v: number): boolean {
  const state = k.classifyPointOnFace(face,u,v)
  return state === 'in' || state === 'on'
}
function poles(k: OcctKernel, face: ShapeHandle, partial: boolean): Pole[] {
  const b = k.uvBounds(face)
  if (![b.uMin,b.uMax,b.vMin,b.vMax].every(Number.isFinite) || b.uMax<=b.uMin || b.vMax<=b.vMin)
    fail('dominio non determinato.')
  // Narrow fingerprints only: full sphere, or one angular quarter of an
  // hemisphere. A UV rectangle alone never establishes the actual trim.
  for (const [kind,count] of [['wire',1],['edge',partial?4:3],['vertex',partial?3:2]] as const) {
    const parts = k.getSubShapes(face,kind)
    try { if (parts.length!==count) fail('topologia o trim non qualificati.') }
    finally { parts.forEach(h=>k.release(h)) }
  }
  const result: Pole[] = []
  for (const [index,v] of [b.vMin,b.vMax].entries()) {
    const point = k.pointOnSurface(face,b.uMin,v)
    const collapsed = [0,...meridians,1].every(fraction=>distance(point,k.pointOnSurface(face,b.uMin+(b.uMax-b.uMin)*fraction,v))<=EPS)
    if (!collapsed) continue
    for (const fraction of [0,...meridians,1]) {
      const u = b.uMin+(b.uMax-b.uMin)*fraction
      same(point,k.pointOnSurface(face,u,v))
      if (!classification(k,face,u,v)) fail('trim ambiguo al polo.')
    }
    onFace(k,face,point)
    result.push({ point,v,direction:index===0?1:-1 })
  }
  if (result.length!==(partial?1:2)) fail('numero di poli collassati non qualificato.')
  return result
}

/** Bidirectional sampled boundary evidence, including degenerate pole edges.
 * A nearby point on the infinite support cannot stand in for the trimmed wire. */
function auditBoundary(k: OcctKernel, from: ShapeHandle, to: ShapeHandle): void {
  const edges = k.getSubShapes(from,'edge'), wires = k.getSubShapes(to,'wire')
  try {
    if (wires.length!==1) fail('trim del bordo ambiguo.')
    for (const edge of edges) {
      const range = k.curveParameters(edge)
      if (![range.first,range.last].every(Number.isFinite) || range.last<range.first) fail('parametri del bordo non determinati.')
      for (let i=0;i<=32;i++) {
        const p = k.curvePointAtParam(edge,range.first+(range.last-range.first)*i/32)
        onFace(k,to,p)
        const vertex = k.makeVertex(p.x,p.y,p.z)
        try {
          const d = k.distanceBetween(vertex,wires[0])
          if (!Number.isFinite(d) || d>EPS) fail('bordi rifilati non corrispondenti.')
        } finally { k.release(vertex) }
      }
    }
  } finally { [...edges,...wires].forEach(h=>k.release(h)) }
}

export interface SpherePoleAudit {
  /** Evidence only; does not authorize editing, Apply, release, or arbitrary STEP. */
  scope: 'sampled-full-sphere-poles' | 'sampled-quarter-hemisphere-pole'
  poles: XYZ[]
  regularWitnesses: number
  maxFaceDistance: number
  minimumMatchedNormalDot: number
  minimumLimitNormalDot: number
}

/** Isolated prototype, intentionally not imported by the editor.
 * Borrow two FACE handles: analytic full sphere (or angular quarter of an
 * hemisphere with one pole) and identity-generalTransform
 * BSpline. Never evaluate a normal at a collapsed pole and never replace a
 * singular normal with an arbitrary neighbouring sample. Establish a shared
 * pole point and check regular normals approaching it in 12 directions at
 * three levels, in both parameterizations, against the analytic radial limit.
 * Finite sampling and the topology fingerprint are NOT a global trim or
 * deviation proof. Unknown topology, missing witnesses and ambiguous trim
 * fail closed. No source mutation and all temporary handles are released.
 */
export function auditSpherePoles(k: OcctKernel, sourceFace: ShapeHandle, bsplineFace: ShapeHandle): SpherePoleAudit {
  if (k.surfaceType(sourceFace)!=='sphere' || k.surfaceType(bsplineFace)!=='bspline' ||
      !k.isValid(sourceFace) || !k.isValid(bsplineFace)) fail('attese facce sfera e BSpline valide.')
  const orientation = k.shapeOrientation(sourceFace)
  if ((orientation!=='forward' && orientation!=='reversed') || k.shapeOrientation(bsplineFace)!==orientation)
    fail('orientamento non corrispondente.')
  const analytic = k.uvBounds(sourceFace)
  const close = (a: number,b: number)=>Number.isFinite(a)&&Math.abs(a-b)<=1e-10
  const full = close(analytic.uMax-analytic.uMin,2*Math.PI) && close(analytic.vMin,-Math.PI/2) && close(analytic.vMax,Math.PI/2)
  const partial = close(analytic.uMax-analytic.uMin,Math.PI/2) &&
    ((close(analytic.vMin,-Math.PI/2)&&close(analytic.vMax,0)) || (close(analytic.vMin,0)&&close(analytic.vMax,Math.PI/2)))
  if (!full && !partial)
    fail('sfera analitica parziale non qualificata.')
  const a = poles(k,sourceFace,partial), b = poles(k,bsplineFace,partial)
  a.forEach((p,i)=>same(p.point,b[i].point))
  // Analytic support evaluation outside a partial trim is used ONLY to infer
  // its sphere center; every accepted witness must belong to the real face.
  const south = k.pointOnSurface(sourceFace,analytic.uMin,-Math.PI/2)
  const north = k.pointOnSurface(sourceFace,analytic.uMin,Math.PI/2)
  const center = { x:(south.x+north.x)/2, y:(south.y+north.y)/2, z:(south.z+north.z)/2 }
  const radius = distance(south,north)/2
  if (!Number.isFinite(radius) || radius<=EPS*100) fail('scala della sfera non qualificata.')
  const sign = orientation==='reversed'?-1:1
  auditBoundary(k,sourceFace,bsplineFace)
  auditBoundary(k,bsplineFace,sourceFace)
  const result: SpherePoleAudit = { scope:partial?'sampled-quarter-hemisphere-pole':'sampled-full-sphere-poles',poles:a.map(p=>p.point),regularWitnesses:0,maxFaceDistance:0,minimumMatchedNormalDot:1,minimumLimitNormalDot:1 }
  for (const [from,to,ownPoles] of [[sourceFace,bsplineFace,a],[bsplineFace,sourceFace,b]] as const) {
    const bounds = k.uvBounds(from), otherBounds = k.uvBounds(to)
    if (partial) {
      // Check all four parameter boundaries against actual trimming wires;
      // unsupported curved trims must not inherit rectangular semantics.
      const wires = k.getSubShapes(from,'wire')
      try {
        for (let i=0;i<=32;i++) for (const [u,v] of [
          [bounds.uMin+(bounds.uMax-bounds.uMin)*i/32,bounds.vMin],
          [bounds.uMin+(bounds.uMax-bounds.uMin)*i/32,bounds.vMax],
          [bounds.uMin,bounds.vMin+(bounds.vMax-bounds.vMin)*i/32],
          [bounds.uMax,bounds.vMin+(bounds.vMax-bounds.vMin)*i/32],
        ]) {
          if (!classification(k,from,u,v)) fail('trim rettangolare non determinato.')
          const p = k.pointOnSurface(from,u,v), vertex = k.makeVertex(p.x,p.y,p.z)
          try {
            const d = k.distanceBetween(vertex,wires[0])
            if (!Number.isFinite(d) || d>EPS) fail('rettangolo UV non corrispondente al trim.')
          } finally { k.release(vertex) }
        }
      } finally { wires.forEach(h=>k.release(h)) }
    }
    // Pole neighbourhoods alone cannot detect an ellipsoid sharing the same
    // two poles. Additional interior witnesses reject that obvious ambiguity;
    // they still do not constitute a bound between samples.
    for (const latitude of [.25,.5,.75]) for (const fraction of meridians) {
      const u = bounds.uMin+(bounds.uMax-bounds.uMin)*fraction
      const v = bounds.vMin+(bounds.vMax-bounds.vMin)*latitude
      if (k.classifyPointOnFace(from,u,v)!=='in') fail('trim interno non qualificato.')
      const p = k.pointOnSurface(from,u,v)
      if (Math.abs(distance(p,center)-radius)>EPS) fail('scarto dalla sfera analitica.')
      result.maxFaceDistance = Math.max(result.maxFaceDistance,onFace(k,to,p))
    }
    for (let poleIndex=0;poleIndex<ownPoles.length;poleIndex++) {
      const pole = ownPoles[poleIndex], expected = unit({ x:sign*(a[poleIndex].point.x-center.x), y:sign*(a[poleIndex].point.y-center.y), z:sign*(a[poleIndex].point.z-center.z) })
      for (const level of levels) for (const fraction of meridians) {
        const u = bounds.uMin+(bounds.uMax-bounds.uMin)*fraction
        const v = pole.v+pole.direction*(bounds.vMax-bounds.vMin)*level
        if (k.classifyPointOnFace(from,u,v)!=='in') fail('intorno regolare rifilato o ambiguo.')
        const p = k.pointOnSurface(from,u,v)
        if (Math.abs(distance(p,center)-radius)>EPS) fail('scarto dalla sfera analitica.')
        // OCCT 5.7.1 projectPointOnFace can return an inaccurate extremum
        // close to a BSpline pole. Use the evaluated UV witness together with
        // independent distance to the trimmed FACE, not that projection API.
        const uv = k.uvFromPoint(to,p)
        if (![uv.u,uv.v].every(Number.isFinite)) fail('proiezione non determinata.')
        // A periodic projection may choose an equivalent angular turn. Accept
        // only a classified representative evaluating to the SAME 3D point.
        const period = otherBounds.uMax-otherBounds.uMin
        const candidates = full?[uv.u,uv.u-period,uv.u+period]:k.surfaceType(to)==='sphere'?[uv.u,uv.u-2*Math.PI,uv.u+2*Math.PI]:[uv.u]
        const mappedU = candidates.find(x=>classification(k,to,x,uv.v) && distance(p,k.pointOnSurface(to,x,uv.v))<=EPS)
        if (mappedU===undefined) fail('trim della proiezione non determinato.')
        same(p,k.pointOnSurface(to,mappedU,uv.v))
        result.maxFaceDistance = Math.max(result.maxFaceDistance,onFace(k,from,p),onFace(k,to,p))
        const n = unit(k.surfaceNormal(from,u,v)), m = unit(k.surfaceNormal(to,mappedU,uv.v))
        const match = dot(n,m), limit = Math.min(dot(n,expected),dot(m,expected))
        if (!Number.isFinite(match) || match<1-1e-7 || !Number.isFinite(limit) || limit<1-2e-5)
          fail('normali regolari incoerenti nel limite al polo.')
        result.minimumMatchedNormalDot = Math.min(result.minimumMatchedNormalDot,match)
        result.minimumLimitNormalDot = Math.min(result.minimumLimitNormalDot,limit)
        result.regularWitnesses++
      }
      result.maxFaceDistance = Math.max(result.maxFaceDistance,onFace(k,to,pole.point))
    }
  }
  return result
}

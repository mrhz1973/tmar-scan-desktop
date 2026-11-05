// SPDX-License-Identifier: AGPL-3.0-only
import type { Mesh, OcctKernel, ShapeHandle } from 'occt-wasm'
import { replaceSurface, type Net } from './brep'
import { exclusiveFaceSurface } from './exclusiveSurface'
import { auditCylinderSeam } from './cylinderSeam'
import { assertSmoothCylinderMove } from './periodic'
import { assertMatchedCylinderTolerances } from './cylinderTolerance'

/** Isolated contacts must lie on the original boundary, including on faces
 * which were already adjacent to the original cylinder. */
export function assertCylinderSectionVertices(k: OcctKernel, vertices: ShapeHandle[], boundaries: ShapeHandle[]): void {
  for (const vertex of vertices) {
    if (!boundaries.some(w => k.distanceBetween(vertex,w) <= 1e-6))
      throw new Error('Intersezione puntuale fuori dal bordo originale.')
  }
}

/** Experimental cylinder preview only. No trusted volume is returned. Checks
 * are sampled and this does not enable editor Apply or certify arbitrary STEP. */
export function evaluatePreparedCylinder(k: OcctKernel, prepared: {brep:string;net:Net}, faceIndex:number, candidate:Net): {mesh:Mesh;step:string;faceBrep:string} {
  assertSmoothCylinderMove(prepared.net,candidate)
  const base=k.fromBREP(prepared.brep);let edited:ShapeHandle|null=null
  let before:ShapeHandle[]=[],after:ShapeHandle[]=[]
  try {
    before=k.getSubShapes(base,'face')
    if(!k.isValid(base)||!Number.isInteger(faceIndex)||!before[faceIndex]) throw new Error('Deformazione cilindrica non valida.')
    const support=exclusiveFaceSurface(prepared.brep,k.toBREP(before[faceIndex]),before.length)
    if(JSON.stringify(support.periodicNet)!==JSON.stringify(prepared.net)) throw new Error('Base cilindrica non corrispondente.')
    edited=k.fromBREP(replaceSurface(prepared.brep,support,candidate))
    after=k.getSubShapes(edited,'face')
    if(!k.isValid(edited)||after.length!==before.length)
      throw new Error('Deformazione cilindrica non valida.')
    for(const kind of ['solid','edge','vertex'] as const) {
      const a=k.getSubShapes(base,kind);let b:ShapeHandle[]=[]
      try {b=k.getSubShapes(edited,kind);if(a.length!==b.length) throw new Error('Topologia cilindrica alterata.')}
      finally {[...a,...b].forEach(h=>k.release(h))}
    }
    assertMatchedCylinderTolerances(k,base,edited)
    const original=before[faceIndex],face=after[faceIndex],bounds=k.uvBounds(original)
    if(k.shapeOrientation(original)!==k.shapeOrientation(face)) throw new Error('Orientamento della faccia alterato.')
    auditCylinderSeam(k,face)
    // Retain the original sampling and also inspect each refined knot span.
    // This remains a finite check, not a proof of global surface validity.
    const vSamples=Array.from({length:17},(_,j)=>bounds.vMin+(bounds.vMax-bounds.vMin)*j/16)
    for(let j=1;j<candidate.kv.length;j++) for(let s=0;s<=4;s++) {
      const v=candidate.kv[j-1]+(candidate.kv[j]-candidate.kv[j-1])*s/4
      if(v>bounds.vMin && v<bounds.vMax) vSamples.push(v)
    }
    for(let i=0;i<=32;i++) for(const v of vSamples) {
      const u=bounds.uMin+(bounds.uMax-bounds.uMin)*i/32
      const p=k.pointOnSurface(original,u,v),q=k.pointOnSurface(face,u,v),a=k.surfaceNormal(original,u,v),b=k.surfaceNormal(face,u,v)
      const gap=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z),dot=a.x*b.x+a.y*b.y+a.z*b.z
      if(!Number.isFinite(gap)||!Number.isFinite(dot)||dot<.05) throw new Error('Deformazione cilindrica troppo forte.')
      if((i===0||i===32||v===bounds.vMin||v===bounds.vMax) && (gap>1e-6||dot<1-1e-8)) throw new Error('Bordo cilindrico o tangente alterata.')
    }
    // Check exact sections against the original boundary, as in the existing
    // planar editor. The finite edge samples do not prove no self-intersection.
    const boundaries=k.getSubShapes(original,'wire')
    try {
      for(let i=0;i<after.length;i++) if(i!==faceIndex) {
        const section=k.section(face,after[i]);let edges:ShapeHandle[]=[],vertices:ShapeHandle[]=[]
        try {
          edges=k.getSubShapes(section,'edge');vertices=k.getSubShapes(section,'vertex')
          if(vertices.length&&k.distanceBetween(original,before[i])>1e-6) throw new Error('Intersezione con una faccia non adiacente.')
          assertCylinderSectionVertices(k,vertices,boundaries)
          for(const edge of edges) {
            const range=k.curveParameters(edge)
            for(let j=0;j<=16;j++) {
              const p=k.curvePointAtParam(edge,range.first+(range.last-range.first)*j/16),vertex=k.makeVertex(p.x,p.y,p.z)
              try {if(!boundaries.some(w=>k.distanceBetween(vertex,w)<=1e-6)) throw new Error('Intersezione fuori dal bordo originale.')}
              finally {k.release(vertex)}
            }
          }
        } finally {[...edges,...vertices].forEach(h=>k.release(h));k.release(section)}
      }
    } finally {boundaries.forEach(h=>k.release(h))}
    return {mesh:k.tessellate(edited,{linearDeflection:.08,angularDeflection:.15}),step:k.exportStep(edited),faceBrep:k.toBREP(face)}
  } finally {[...before,...after].forEach(h=>k.release(h));if(edited)k.release(edited);k.release(base)}
}

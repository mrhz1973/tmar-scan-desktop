// SPDX-License-Identifier: AGPL-3.0-only
import type { Mesh, OcctKernel, ShapeHandle } from 'occt-wasm'
import { replaceSurface, signature, surfaceTable, type Net } from './brep'
import { auditCylinderSeam } from './cylinderSeam'
import { assertSmoothCylinderMove } from './periodic'
import { assertMatchedCylinderTolerances } from './cylinderTolerance'

/** Experimental cylinder preview only. No trusted volume is returned. Checks
 * are sampled and this does not enable editor Apply or certify arbitrary STEP. */
export function evaluatePreparedCylinder(k: OcctKernel, prepared: {brep:string;net:Net}, faceIndex:number, candidate:Net): {mesh:Mesh;step:string} {
  assertSmoothCylinderMove(prepared.net,candidate)
  const records=surfaceTable(prepared.brep), entries=records.filter(r=>r.periodicNet)
  if(entries.length!==1 || JSON.stringify(entries[0].periodicNet)!==JSON.stringify(prepared.net)) throw new Error('Base cilindrica non corrispondente.')
  const base=k.fromBREP(prepared.brep);let edited:ShapeHandle|null=null
  let before:ShapeHandle[]=[],after:ShapeHandle[]=[]
  try {
    edited=k.fromBREP(replaceSurface(prepared.brep,entries[0],candidate))
    before=k.getSubShapes(base,'face');after=k.getSubShapes(edited,'face')
    if(!k.isValid(base)||!k.isValid(edited)||!Number.isInteger(faceIndex)||!before[faceIndex]||after.length!==before.length)
      throw new Error('Deformazione cilindrica non valida.')
    const faceText=k.toBREP(before[faceIndex]),headers=[...faceText.matchAll(/^Fa\s*\n\s*[01]\s+[\deE+.-]+\s+(\d+)\s+0\s*$/gm)]
    const own=headers.length===1?surfaceTable(faceText)[Number(headers[0][1])-1]:undefined
    if(!own || signature(own)!==signature(entries[0])) throw new Error('La faccia non corrisponde al reticolo cilindrico.')
    for(const kind of ['solid','edge','vertex'] as const) {
      const a=k.getSubShapes(base,kind);let b:ShapeHandle[]=[]
      try {b=k.getSubShapes(edited,kind);if(a.length!==b.length) throw new Error('Topologia cilindrica alterata.')}
      finally {[...a,...b].forEach(h=>k.release(h))}
    }
    assertMatchedCylinderTolerances(k,base,edited)
    const original=before[faceIndex],face=after[faceIndex],bounds=k.uvBounds(original)
    if(k.shapeOrientation(original)!==k.shapeOrientation(face)) throw new Error('Orientamento della faccia alterato.')
    auditCylinderSeam(k,face)
    for(let i=0;i<=32;i++) for(let j=0;j<=16;j++) {
      const u=bounds.uMin+(bounds.uMax-bounds.uMin)*i/32,v=bounds.vMin+(bounds.vMax-bounds.vMin)*j/16
      const p=k.pointOnSurface(original,u,v),q=k.pointOnSurface(face,u,v),a=k.surfaceNormal(original,u,v),b=k.surfaceNormal(face,u,v)
      const gap=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z),dot=a.x*b.x+a.y*b.y+a.z*b.z
      if(!Number.isFinite(gap)||!Number.isFinite(dot)||dot<.05) throw new Error('Deformazione cilindrica troppo forte.')
      if((i===0||i===32||j===0||j===16) && (gap>1e-6||dot<1-1e-8)) throw new Error('Bordo cilindrico o tangente alterata.')
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
    return {mesh:k.tessellate(edited,{linearDeflection:.08,angularDeflection:.15}),step:k.exportStep(edited)}
  } finally {[...before,...after].forEach(h=>k.release(h));if(edited)k.release(edited);k.release(base)}
}

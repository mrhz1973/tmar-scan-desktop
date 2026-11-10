// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'

function tolerance(k: OcctKernel, handle: ShapeHandle, kind: 'Ed' | 'Ve'): number {
  const records=[...k.toBREP(handle).matchAll(new RegExp(`^${kind}\\s*\\n\\s*([\\deE+.-]+)`,'gm'))]
  if(records.length!==1) throw new Error('Tolleranza topologica non identificabile.')
  const value=Number(records[0][1])
  if(!Number.isFinite(value)||value<0) throw new Error('Tolleranza topologica non valida.')
  return value
}

/** Compare uniquely matched boundary subshapes using bidirectional samples.
 * Sampled geometric pairing is not an exact topological naming algorithm. */
export function assertMatchedCylinderTolerances(k: OcctKernel, source: ShapeHandle, candidate: ShapeHandle): void {
  for(const [kind,record] of [['edge','Ed'],['vertex','Ve']] as const) {
    const before=k.getSubShapes(source,kind);let after:ShapeHandle[]=[]
    try {
      after=k.getSubShapes(candidate,kind)
      if(!before.length||before.length!==after.length) throw new Error('Topologia dei bordi alterata.')
      const related=(a:ShapeHandle,b:ShapeHandle):boolean=>{
        if(kind==='vertex') {
          const p=k.vertexPosition(a),q=k.vertexPosition(b),d=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)
          return Number.isFinite(d)&&d<=1e-6
        }
        for(const [from,to] of [[a,b],[b,a]] as const) {
          const range=k.curveParameters(from)
          if(!Number.isFinite(range.first)||!Number.isFinite(range.last)||range.last<=range.first) return false
          for(let i=0;i<=16;i++) {
            const p=k.curvePointAtParam(from,range.first+(range.last-range.first)*i/16),v=k.makeVertex(p.x,p.y,p.z)
            try { const d=k.distanceBetween(v,to);if(!Number.isFinite(d)||d>1e-6) return false }
            finally {k.release(v)}
          }
        }
        return true
      }
      const used=new Set<number>()
      for(const a of before) {
        const matches=after.flatMap((b,index)=>related(a,b)?[index]:[])
        if(matches.length!==1||used.has(matches[0])) throw new Error('Corrispondenza dei bordi cilindrici ambigua.')
        const index=matches[0];used.add(index)
        if(tolerance(k,after[index],record)>tolerance(k,a,record)+1e-12) throw new Error('Tolleranza del bordo cilindrico aumentata.')
      }
    } finally {[...before,...after].forEach(h=>k.release(h))}
  }
}

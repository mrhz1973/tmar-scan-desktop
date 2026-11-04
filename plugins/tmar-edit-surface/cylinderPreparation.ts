// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { replaceSurface, signature, surfaceTable, type Net } from './brep'
import { assertSimpleCylinderSource } from './cylinderSource'
import { auditCylinderSeam } from './cylinderSeam'
import { moveSmoothCylinderPole, refineLinearPeriodicV } from './periodic'
import { assertMatchedCylinderTolerances } from './cylinderTolerance'

/** Refuse an increase in the sorted edge/vertex tolerance distribution. This
 * does not identify corresponding TShapes or prove per-edge equivalence. */
export function assertToleranceDistribution(source: string, candidate: string): void {
  for(const kind of ['Ed','Ve']) {
    const read=(text:string)=>Array.from(text.matchAll(new RegExp(`^${kind}\\s*\\n\\s*([\\deE+.-]+)`,'gm')),m=>Number(m[1])).sort((a,b)=>a-b)
    const before=read(source),after=read(candidate)
    if(!before.length || before.length!==after.length || [...before,...after].some(v=>!Number.isFinite(v)||v<0) ||
       before.some((value,index)=>after[index]>value+1e-12))
      throw new Error('Tolleranze dei bordi cilindrici alterate.')
  }
}

/** Experimental native conversion for a single, simple STEP cylinder. Never
 * mutates the borrowed source or enables editing. Comparisons are sampled;
 * arbitrary BREP encodings and seam identities still require qualification.
 * Face pairing uses OCCT's returned order and rejects changed pair geometry. */
export function prepareCylinder(k: OcctKernel, source: ShapeHandle, index: number): { brep: string; net: Net; sourceVolume: number; preparedVolume: number } {
  const originalFaces = k.getSubShapes(source, 'face')
  let converted: ShapeHandle | null = null, refined: ShapeHandle | null = null
  try {
    if (!Number.isInteger(index) || !originalFaces[index]) throw new Error('Faccia cilindrica non valida.')
    assertSimpleCylinderSource(k, source, originalFaces[index])
    const sourceBrep=k.toBREP(source)
    converted = k.generalTransform(source,[1,0,0,0,0,1,0,0,0,0,1,0])
    const convertedFaces=k.getSubShapes(converted,'face')
    try {
      if (!k.isValid(converted) || convertedFaces.length !== originalFaces.length) throw new Error('Conversione cilindrica non valida.')
      for (const kind of ['solid','edge','vertex'] as const) {
        const before=k.getSubShapes(source,kind);let after:ShapeHandle[]=[]
        try { after=k.getSubShapes(converted,kind);if(before.length!==after.length) throw new Error('Topologia cilindrica alterata.') }
        finally { [...before,...after].forEach(h=>k.release(h)) }
      }
      for(let f=0;f<originalFaces.length;f++) {
        const a=originalFaces[f],b=convertedFaces[f]
        if(k.shapeOrientation(a)!==k.shapeOrientation(b)) throw new Error('Orientamento delle facce alterato.')
        for(const [from,to] of [[a,b],[b,a]] as const) {
          const bounds=k.uvBounds(from)
          for(let i=0;i<=8;i++) for(let j=0;j<=8;j++) {
            const u=bounds.uMin+(bounds.uMax-bounds.uMin)*i/8,v=bounds.vMin+(bounds.vMax-bounds.vMin)*j/8
            if(k.classifyPointOnFace(from,u,v)==='out') continue
            const p=k.pointOnSurface(from,u,v),q=k.projectPointOnFace(to,p),uv=k.uvFromPoint(to,p)
            const n=k.surfaceNormal(from,u,v),m=k.surfaceNormal(to,uv.u,uv.v)
            const gap=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z),dot=n.x*m.x+n.y*m.y+n.z*m.z
            if(!Number.isFinite(gap)||gap>1e-6||!Number.isFinite(dot)||dot<1-1e-7 ||
                !Number.isFinite(uv.u)||!Number.isFinite(uv.v)||k.classifyPointOnFace(to,uv.u,uv.v)==='out')
              throw new Error('Geometria della conversione cilindrica alterata.')
          }
          const originalEdges=k.getSubShapes(from,'edge');let targetEdges:ShapeHandle[]=[]
          try {
            targetEdges=k.getSubShapes(to,'edge')
            for(const edge of originalEdges) {
              const range=k.curveParameters(edge)
              for(let i=0;i<=16;i++) {
                const p=k.curvePointAtParam(edge,range.first+(range.last-range.first)*i/16),vertex=k.makeVertex(p.x,p.y,p.z)
                try {
                  const distances=targetEdges.map(e=>k.distanceBetween(vertex,e))
                  if(!distances.length || distances.some(d=>!Number.isFinite(d)) || Math.min(...distances)>1e-6) throw new Error('Bordo della conversione cilindrica alterato.')
                } finally { k.release(vertex) }
              }
            }
          } finally { [...originalEdges,...targetEdges].forEach(h=>k.release(h)) }
        }
      }
      auditCylinderSeam(k,convertedFaces[index])
      const text=k.toBREP(converted),faceText=k.toBREP(convertedFaces[index]),headers=[...faceText.matchAll(/^Fa\s*\n\s*[01]\s+[\deE+.-]+\s+(\d+)\s+0\s*$/gm)]
      assertToleranceDistribution(sourceBrep,text)
      assertMatchedCylinderTolerances(k,source,converted)
      if(headers.length!==1) throw new Error('Superficie cilindrica non identificabile.')
      const own=surfaceTable(faceText)[Number(headers[0][1])-1],matches=own?surfaceTable(text).filter(r=>signature(r)===signature(own)):[]
      if(matches.length!==1 || !matches[0].periodicNet) throw new Error('Reticolo cilindrico ambiguo.')
      const net=refineLinearPeriodicV(matches[0].periodicNet)
      moveSmoothCylinderPole(net,[0,0,0]) // Reject unsupported weights/knot conventions before exposing the net.
      const brep=replaceSurface(text,matches[0],net)
      refined=k.fromBREP(brep)
      if(!k.isValid(refined)) throw new Error('Raffinamento cilindrico non valido.')
      assertToleranceDistribution(sourceBrep,k.toBREP(refined))
      assertMatchedCylinderTolerances(k,source,refined)
      const refinedFaces=k.getSubShapes(refined,'face')
      try {
        if(refinedFaces.length!==convertedFaces.length) throw new Error('Topologia del raffinamento alterata.')
        auditCylinderSeam(k,refinedFaces[index])
        const b=k.uvBounds(convertedFaces[index])
        for(let i=0;i<=16;i++) for(let j=0;j<=8;j++) {
          const u=b.uMin+(b.uMax-b.uMin)*i/16,v=b.vMin+(b.vMax-b.vMin)*j/8
          const p=k.pointOnSurface(convertedFaces[index],u,v),q=k.pointOnSurface(refinedFaces[index],u,v)
          const gap=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)
          if(!Number.isFinite(gap)||gap>1e-8) throw new Error('Raffinamento cilindrico ha cambiato la superficie.')
        }
      } finally { refinedFaces.forEach(h=>k.release(h)) }
      const sourceVolume=k.getVolume(source),preparedVolume=k.getVolume(refined)
      if(!Number.isFinite(sourceVolume)||!Number.isFinite(preparedVolume)||sourceVolume<=0||preparedVolume<=0) throw new Error('Volume cilindrico non disponibile.')
      return {brep,net,sourceVolume,preparedVolume}
    } finally { convertedFaces.forEach(h=>k.release(h)) }
  } finally { originalFaces.forEach(h=>k.release(h));if(refined)k.release(refined);if(converted)k.release(converted) }
}

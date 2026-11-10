// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in diagnostic: the real imported STEP remains untouched.
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { boundaryLocked } from '../brep'
import { SurfaceEditorKernel } from '../editorKernel'
import { visiblePoleWitness } from '../visiblePoleWitness'

const path=process.env.SURFACE_QA_STEP
it.skipIf(!path)('reports visible support for the first dense trimmed face',async()=>{
  const editor=await SurfaceEditorKernel.load(), k=editor.kernel
  const imported=k.importStep(readFileSync(path!,'utf8')), solids=k.getSubShapes(imported,'solid')
  try {
    const opened=editor.open(k.exportStep(solids[0]))
    const candidate=opened.faces.find(f=>f.kind==='plane' && f.reason==='Tutti i poli influenzano un contorno ritagliato.')!
    expect(candidate).toBeDefined()
    const prepared=editor.selectDenseTrimmedPlane(candidate.index), net=prepared.net
    const shape=k.fromBREP((editor as unknown as {editBrep:string}).editBrep), faces=k.getSubShapes(shape,'face')
    try {
      const face=faces[candidate.index], b=k.uvBounds(face), locks=new Set([...prepared.trimLocks,...prepared.hiddenPoles])
      let inside=0
      for(let i=0;i<256;i++) for(let j=0;j<256;j++)
        if(k.classifyPointOnFace(face,b.uMin+(i+.5)*(b.uMax-b.uMin)/256,b.vMin+(j+.5)*(b.vMax-b.vMin)/256)==='in') inside++
      const free=net.poles.flatMap((_,i)=>!locks.has(i)&&!boundaryLocked(net,i,'G1')?[i]:[])
      const visible=free.filter(i=>visiblePoleWitness(net,i,(u,v)=>k.classifyPointOnFace(face,u,v))!==null)
      const pole=free[0], n=k.surfaceNormal(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      expect(pole).toBeDefined()
      net.poles[pole]=[net.poles[pole][0]+n.x*.02,net.poles[pole][1]+n.y*.02,net.poles[pole][2]+n.z*.02]
      const result=editor.evaluate(net,'G1',true)
      expect(result.valid).toBe(true);expect(result.step).toBeTruthy()
      const edited=k.importStep(result.step!), editedFaces=k.getSubShapes(edited,'face')
      let maxChange=0
      try {
        for(let i=0;i<256;i++) for(let j=0;j<256;j++) {
          const u=b.uMin+(i+.5)*(b.uMax-b.uMin)/256,v=b.vMin+(j+.5)*(b.vMax-b.vMin)/256
          if(k.classifyPointOnFace(face,u,v)!=='in') continue
          const p=k.pointOnSurface(face,u,v),q=k.pointOnSurface(editedFaces[candidate.index],u,v)
          maxChange=Math.max(maxChange,Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z))
        }
      } finally {editedFaces.forEach(f=>k.release(f));k.release(edited)}
      console.log(JSON.stringify({face:candidate.index,insideSamples:inside,freePoles:free.length,visibleWitnesses:visible.length,pole,maxChangeMm:maxChange}))
      expect(inside).toBeGreaterThan(0)
      // A null witness is inconclusive for the thin region, not evidence of safety.
    } finally {faces.forEach(f=>k.release(f));k.release(shape)}
  } finally {solids.forEach(s=>k.release(s));k.release(imported);editor.dispose()}
},120000)

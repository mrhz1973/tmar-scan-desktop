// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { assertToleranceDistribution, prepareCylinder } from '../cylinderPreparation'
import { moveSmoothCylinderPole, assertSmoothCylinderMove, canonicalizeCylinderGesture } from '../periodic'
import { localFrame } from '../localFrame'
import { evaluatePreparedCylinder } from '../cylinderEvaluation'
import { replaceSurface, surfaceTable } from '../brep'
import { auditCylinderSeam } from '../cylinderSeam'

it('rejects increased or missing topological tolerances',()=>{
  const source='Ed\n 1e-7 1 1 0\nVe\n1e-7\n'
  expect(()=>assertToleranceDistribution(source,source)).not.toThrow()
  expect(()=>assertToleranceDistribution(source,'Ed\n 0.1 1 1 0\nVe\n1e-7\n')).toThrow(/Tolleranze/)
  expect(()=>assertToleranceDistribution(source,'Ed\n 1e-7 1 1 0\n')).toThrow(/Tolleranze/)
})

it.each([false,true])('prepares the converted cylindrical STEP support without modifying its source (rotated: %s)',async rotated=>{
  const e=await SurfaceEditorKernel.load(),k=e.kernel,p=k.makeCylinder(10,20)
  const r=rotated?k.rotate(p,{point:{x:0,y:0,z:0},direction:{x:1,y:1,z:0}},.73):null
  const positioned=r?k.translate(r,7,-11,4):null,source=k.importStep(k.exportStep(positioned??p)),faces=k.getSubShapes(source,'face')
  try {
    const before=k.toBREP(source),index=faces.findIndex(f=>k.surfaceType(f)==='cylinder')
    expect(index).toBeGreaterThanOrEqual(0)
    const result=prepareCylinder(k,source,index)
    expect(k.toBREP(source)).toBe(before)
    expect(result.net.periodic).toEqual([1,0]);expect(result.net.nv).toBe(6)
    expect(result.net.mv).toEqual([4,1,1,4])
    // Keep both readings visible without requiring a known kernel discrepancy
    // to persist or treating the prepared reading as an accurate volume.
    expect(result.sourceVolume).toBeCloseTo(Math.PI*100*20,5)
    expect(Number.isFinite(result.preparedVolume)).toBe(true)
    const records=surfaceTable(result.brep),entry=records.find(x=>x.periodicNet)!
    const first=moveSmoothCylinderPole(result.net,[.2,-.1,.15],2)
    const next=moveSmoothCylinderPole(first,[-.12,.08,-.05],3)
    expect(()=>assertSmoothCylinderMove(result.net,next)).not.toThrow()
    expect(localFrame(result.net,20)).not.toBeNull();expect(localFrame(result.net,21)).not.toBeNull()
    const gesture=structuredClone(first);gesture.poles[21][2]+=.15
    expect(canonicalizeCylinderGesture(first,gesture).poles[15][2]).not.toBe(first.poles[15][2])
    const invalid=structuredClone(next);invalid.poles[15][0]+=.01
    expect(()=>assertSmoothCylinderMove(result.net,invalid)).toThrow()
    const evaluation=evaluatePreparedCylinder(k,result,index,next),checked=k.importStep(evaluation.step)
    try {expect(k.isValid(checked)).toBe(true)} finally {k.release(checked)}
    const edited=k.fromBREP(replaceSurface(result.brep,entry,next)),round=k.importStep(k.exportStep(edited)),roundFaces=k.getSubShapes(round,'face'),editedFaces=k.getSubShapes(edited,'face')
    try {
      expect(k.isValid(round)).toBe(true);expect(roundFaces).toHaveLength(3)
      expect(()=>auditCylinderSeam(k,roundFaces[index])).not.toThrow()
      for(const u of result.net.ku.slice(1,-1)) for(const v of result.net.kv.slice(1,-1)) {
        const pairs=[[u-1e-7,v,u+1e-7,v],[u,v-1e-7,u,v+1e-7]]
        for(const [u1,v1,u2,v2] of pairs) {
          const a=k.surfaceNormal(editedFaces[index],u1,v1),b=k.surfaceNormal(editedFaces[index],u2,v2)
          expect(a.x*b.x+a.y*b.y+a.z*b.z).toBeGreaterThan(1-1e-8)
        }
      }
    } finally {[...roundFaces,...editedFaces].forEach(h=>k.release(h));k.release(round);k.release(edited)}
    expect(()=>prepareCylinder(k,source,faces.findIndex(f=>k.surfaceType(f)==='plane'))).toThrow()
  } finally {faces.forEach(h=>k.release(h));k.release(source);if(positioned)k.release(positioned);if(r)k.release(r);k.release(p);e.dispose()}
},60000)

it('refuses preparation of a trimmed cylinder',async()=>{
  const e=await SurfaceEditorKernel.load(),k=e.kernel,p=k.makeCylinder(10,20),tool=k.makeBox(12,30,30),moved=k.translate(tool,0,-15,-5),cut=k.cut(p,moved)
  const source=k.importStep(k.exportStep(cut)),faces=k.getSubShapes(source,'face')
  try {
    const index=faces.findIndex(f=>k.surfaceType(f)==='cylinder')
    expect(index).toBeGreaterThanOrEqual(0)
    expect(()=>prepareCylinder(k,source,index)).toThrow()
  } finally {faces.forEach(h=>k.release(h));[source,cut,moved,tool,p].forEach(h=>k.release(h));e.dispose()}
},60000)

it('edits a full cylindrical boss on a box without modifying the original STEP',async()=>{
  const e=await SurfaceEditorKernel.load(),k=e.kernel,box=k.makeBox(30,30,5),base=k.translate(box,-15,-15,-5)
  const pin=k.makeCylinder(5,11),offset=k.translate(pin,0,0,-1),fused=k.fuse(base,offset)
  const source=k.importStep(k.exportStep(fused)),faces=k.getSubShapes(source,'face')
  try {
    const before=k.toBREP(source),index=faces.findIndex(f=>k.surfaceType(f)==='cylinder')
    expect(index).toBeGreaterThanOrEqual(0);expect(faces.length).toBeGreaterThan(3)
    const prepared=prepareCylinder(k,source,index)
    const net=moveSmoothCylinderPole(prepared.net,[.1,0,.05],2)
    const result=evaluatePreparedCylinder(k,prepared,index,net),round=k.importStep(result.step),after=k.getSubShapes(round,'face')
    try {
      expect(k.isValid(round)).toBe(true);expect(k.toBREP(source)).toBe(before);expect(after.length).toBe(faces.length)
      for(let f=0;f<faces.length;f++) if(f!==index) {
        const b=k.uvBounds(faces[f]);let tested=0
        for(let i=1;i<4;i++) for(let j=1;j<4;j++) {
          const u=b.uMin+(b.uMax-b.uMin)*i/4,v=b.vMin+(b.vMax-b.vMin)*j/4
          if(k.classifyPointOnFace(faces[f],u,v)!=='in')continue
          const p=k.pointOnSurface(faces[f],u,v),q=k.projectPointOnFace(after[f],p)
          expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-6);tested++
        }
        expect(tested).toBeGreaterThan(0)
      }
    } finally {after.forEach(h=>k.release(h));k.release(round)}
  } finally {[...faces,source,fused,offset,pin,base,box].forEach(h=>k.release(h));e.dispose()}
},60000)

it('edits one of two distinct cylindrical bosses while preserving the other',async()=>{
  const e=await SurfaceEditorKernel.load(),k=e.kernel,box=k.makeBox(50,30,5),base=k.translate(box,-25,-15,-5)
  const cylinder=k.makeCylinder(4,9),left=k.translate(cylinder,-10,0,-1),right=k.translate(cylinder,10,0,-1)
  const one=k.fuse(base,left),both=k.fuse(one,right),source=k.importStep(k.exportStep(both)),faces=k.getSubShapes(source,'face')
  try {
    const indices=faces.map((f,i)=>k.surfaceType(f)==='cylinder'?i:-1).filter(i=>i>=0)
    expect(indices).toHaveLength(2)
    const prepared=prepareCylinder(k,source,indices[0]),edited=evaluatePreparedCylinder(k,prepared,indices[0],moveSmoothCylinderPole(prepared.net,[.08,0,.05]))
    const round=k.importStep(edited.step),after=k.getSubShapes(round,'face')
    try {
      expect(k.isValid(round)).toBe(true);expect(after).toHaveLength(faces.length)
      const b=k.uvBounds(faces[indices[1]])
      for(let i=1;i<5;i++)for(let j=1;j<5;j++) {
        const p=k.pointOnSurface(faces[indices[1]],b.uMin+(b.uMax-b.uMin)*i/5,b.vMin+(b.vMax-b.vMin)*j/5)
        const q=k.projectPointOnFace(after[indices[1]],p)
        expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-6)
      }
    } finally {after.forEach(h=>k.release(h));k.release(round)}
  } finally {[...faces,source,both,one,right,left,cylinder,base,box].forEach(h=>k.release(h));e.dispose()}
},60000)

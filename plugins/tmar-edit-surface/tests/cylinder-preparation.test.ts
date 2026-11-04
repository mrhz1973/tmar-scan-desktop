// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { assertToleranceDistribution, prepareCylinder } from '../cylinderPreparation'
import { moveSmoothCylinderPole, assertSmoothCylinderMove } from '../periodic'
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
    expect(result.net.periodic).toEqual([1,0]);expect(result.net.nv).toBe(5)
    // Keep both readings visible without requiring a known kernel discrepancy
    // to persist or treating the prepared reading as an accurate volume.
    expect(result.sourceVolume).toBeCloseTo(Math.PI*100*20,5)
    expect(Number.isFinite(result.preparedVolume)).toBe(true)
    const records=surfaceTable(result.brep),entry=records.find(x=>x.periodicNet)!,next=moveSmoothCylinderPole(result.net,[.2,-.1,.15])
    expect(()=>assertSmoothCylinderMove(result.net,next)).not.toThrow()
    const edited=k.fromBREP(replaceSurface(result.brep,entry,next)),round=k.importStep(k.exportStep(edited)),roundFaces=k.getSubShapes(round,'face')
    try {
      expect(k.isValid(round)).toBe(true);expect(roundFaces).toHaveLength(3)
      expect(()=>auditCylinderSeam(k,roundFaces[index])).not.toThrow()
    } finally {roundFaces.forEach(h=>k.release(h));k.release(round);k.release(edited)}
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

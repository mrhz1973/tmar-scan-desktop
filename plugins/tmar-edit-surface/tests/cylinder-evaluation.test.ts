// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { prepareCylinder } from '../cylinderPreparation'
import { evaluatePreparedCylinder } from '../cylinderEvaluation'
import { moveSmoothCylinderPole } from '../periodic'

it.each([false,true])('evaluates and reopens a coupled cylindrical deformation (rotated: %s)',async rotated=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,primitive=k.makeCylinder(10,20)
  const moved=rotated?k.rotate(primitive,{point:{x:0,y:0,z:0},direction:{x:1,y:1,z:0}},.73):null
  const source=k.importStep(k.exportStep(moved??primitive)),faces=k.getSubShapes(source,'face')
  try {
    const sourceBefore=k.toBREP(source),index=faces.findIndex(f=>k.surfaceType(f)==='cylinder')
    const prepared=prepareCylinder(k,source,index),net=moveSmoothCylinderPole(prepared.net,[.2,-.1,.15])
    const result=evaluatePreparedCylinder(k,prepared,index,net),round=k.importStep(result.step),after=k.getSubShapes(round,'face')
    const base=k.fromBREP(prepared.brep),baseFaces=k.getSubShapes(base,'face')
    try {
      expect(k.isValid(round)).toBe(true);expect(after).toHaveLength(3);expect(result.mesh.triangleCount).toBeGreaterThan(0)
      const b=k.uvBounds(baseFaces[index]),p=k.pointOnSurface(baseFaces[index],(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2),q=k.projectPointOnFace(after[index],p)
      expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeGreaterThan(.001)
      expect(k.toBREP(source)).toBe(sourceBefore)
      expect('volume' in result).toBe(false)
    } finally {[...after,...baseFaces].forEach(h=>k.release(h));k.release(base);k.release(round)}
    expect(()=>evaluatePreparedCylinder(k,prepared,(index+1)%faces.length,net)).toThrow(/faccia|corrisponde/i)
    const wrongBase=structuredClone(prepared);wrongBase.net.weights[0]*=1.1
    expect(()=>evaluatePreparedCylinder(k,wrongBase,index,net)).toThrow()
    const bad=structuredClone(net);bad.poles[0][0]+=.01
    expect(()=>evaluatePreparedCylinder(k,prepared,index,bad)).toThrow()
    expect(()=>evaluatePreparedCylinder(k,prepared,index,moveSmoothCylinderPole(prepared.net,[100,0,0]))).toThrow()
  } finally {faces.forEach(h=>k.release(h));k.release(source);if(moved)k.release(moved);k.release(primitive);editor.dispose()}
},60000)

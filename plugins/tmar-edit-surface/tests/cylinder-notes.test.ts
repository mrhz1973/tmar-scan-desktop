// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { prepareCylinder } from '../cylinderPreparation'
import { evaluatePreparedCylinder } from '../cylinderEvaluation'
import { cylinderAnchorFromPick, resolveCylinderAnchor } from '../cylinderNotes'
import { moveSmoothCylinderPole } from '../periodic'

it('anchors a picked point to the evaluated cylindrical CAD face',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,shape=k.makeCylinder(10,20)
  const source=k.importStep(k.exportStep(shape)),faces=k.getSubShapes(source,'face')
  try {
    const index=faces.findIndex(f=>k.surfaceType(f)==='cylinder'),prepared=prepareCylinder(k,source,index)
    const result=evaluatePreparedCylinder(k,prepared,index,moveSmoothCylinderPole(prepared.net,[.2,-.1,.15]))
    const face=k.fromBREP(result.faceBrep)
    try {
      const b=k.uvBounds(face),p=k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      const picked=cylinderAnchorFromPick(k,result.faceBrep,index,42,[p.x,p.y,p.z])
      const resolved=resolveCylinderAnchor(k,result.faceBrep,index,42,picked.anchor)
      expect(Math.hypot(resolved.at[0]-p.x,resolved.at[1]-p.y,resolved.at[2]-p.z)).toBeLessThan(1e-6)
      expect(Math.hypot(...resolved.normal)).toBeCloseTo(1,8)
      expect(()=>resolveCylinderAnchor(k,result.faceBrep,index,43,picked.anchor)).toThrow(/estraneo/)
      expect(()=>cylinderAnchorFromPick(k,result.faceBrep,index,42,[1000,1000,1000])).toThrow()
    } finally {k.release(face)}
  } finally {faces.forEach(f=>k.release(f));k.release(source);k.release(shape);editor.dispose()}
},60000)

// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { replaceSurface, surfaceTable } from '../brep'
import { moveSmoothCylinderPole, refineLinearPeriodicV } from '../periodic'

// Restricted fixture reader: this test accepts only the clamped quadratic 2D
// B-spline seam records produced by OCCT for this particular STEP cylinder.
function seamCurves(brep: string) {
  const section=/Curve2ds\s+(\d+)\s*\n([\s\S]*?)\nCurves\s+\d+/.exec(brep)
  if(!section) throw new Error('No 2D curve table')
  const values=section[2].trim().split(/\s+/).map(Number);let pos=0
  const take=()=>{const n=values[pos++];if(!Number.isFinite(n))throw new Error('Invalid 2D record');return n}
  const curves=Array.from({length:Number(section[1])},()=>{
    let type=take(),first:number|undefined,last:number|undefined
    if(type===8){first=take();last=take();type=take()}
    if(type!==7)throw new Error('Expected B-spline')
    const rational=take(),periodic=take(),degree=take(),count=take(),kcount=take()
    const poles=Array.from({length:count},()=>{const x=take(),y=take(),w=rational?take():1;return {x,y,w}})
    const knots=Array.from({length:kcount},()=>({value:take(),mult:take()}))
    return {first:first??knots[0].value,last:last??knots.at(-1)!.value,rational,periodic,degree,poles,knots}
  })
  const seam=/^3\s+(\d+)\s+(\d+)\s*(?:CN|C[0-9]|G[0-9])\s+(\d+)\s+\d+\s+([\deE+.-]+)\s+([\deE+.-]+)\s*$/m.exec(brep)
  if(!seam) throw new Error('No two-sided seam record')
  return {curves:[curves[Number(seam[1])-1],curves[Number(seam[2])-1]],first:Number(seam[4]),last:Number(seam[5])}
}

it.each([false,true])('preserves both seam pcurves and their 3D edge on a synthetic cylinder (rotated: %s)', async rotated => {
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,primitive=k.makeCylinder(10,20)
  const rotatedPrimitive=rotated?k.rotate(primitive,{point:{x:0,y:0,z:0},direction:{x:1,y:1,z:0}},0.73):null
  const positioned=rotatedPrimitive?k.translate(rotatedPrimitive,7,-11,4):null
  const source=k.importStep(k.exportStep(positioned??primitive)),base=k.generalTransform(source,[1,0,0,0,0,1,0,0,0,0,1,0])
  const text=k.toBREP(base),record=surfaceTable(text).find(r=>r.periodicNet)!,net=moveSmoothCylinderPole(refineLinearPeriodicV(record.periodicNet!),[.5,0,0])
  const edited=k.fromBREP(replaceSurface(text,record,net)),reopened=k.importStep(k.exportStep(edited))
  try {
    for(const shape of [base,edited,reopened]) {
      expect(k.isValid(shape)).toBe(true)
      const faces=k.getSubShapes(shape,'face'),face=faces[0],edges=k.getSubShapes(face,'edge')
      try {
        const seam=seamCurves(k.toBREP(shape)),candidates=edges.filter(e=>Math.abs(k.curveParameters(e).last-seam.last)<1e-6)
        expect(candidates).toHaveLength(1)
        const edge=candidates[0]
        for(const curve of seam.curves) {
          expect(curve.rational).toBe(0);expect(curve.periodic).toBe(0);expect(curve.degree).toBe(2)
          expect(curve.poles).toHaveLength(3);expect(curve.knots.map(k=>k.mult)).toEqual([3,3])
          expect(curve.first).toBeCloseTo(seam.first,8);expect(curve.last).toBeCloseTo(seam.last,8)
          expect(curve.knots[0].value).toBeCloseTo(seam.first,8);expect(curve.knots[1].value).toBeCloseTo(seam.last,8)
          for(let i=0;i<=64;i++) {
            const s=i/64,t=seam.first+(seam.last-seam.first)*s,p=curve.poles
            const u=(1-s)**2*p[0].x+2*s*(1-s)*p[1].x+s*s*p[2].x
            const v=(1-s)**2*p[0].y+2*s*(1-s)*p[1].y+s*s*p[2].y
            const a=k.curvePointAtParam(edge,t),b=k.pointOnSurface(face,u,v)
            expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeLessThan(1e-6)
          }
        }
        const bounds=k.uvBounds(face)
        for(let i=0;i<=64;i++) {
          const v=bounds.vMin+(bounds.vMax-bounds.vMin)*i/64
          const a=k.surfaceNormal(face,bounds.uMin,v),b=k.surfaceNormal(face,bounds.uMax,v)
          expect(a.x*b.x+a.y*b.y+a.z*b.z).toBeGreaterThan(1-1e-8)
        }
      } finally { [...faces,...edges].forEach(h=>k.release(h)) }
    }
  } finally { k.release(reopened);k.release(edited);k.release(base);k.release(source);if(positioned)k.release(positioned);if(rotatedPrimitive)k.release(rotatedPrimitive);k.release(primitive);editor.dispose() }
},60000)

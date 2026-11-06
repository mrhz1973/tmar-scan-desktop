// SPDX-License-Identifier: AGPL-3.0-only
// Real kernel only; no transient transforms, browser, or source-file writes.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { visiblePoleWitness } from '../visiblePoleWitness'
import { updateAdaptiveLocks } from '../adaptiveLockSnapshot'

const path=process.env.SURFACE_QA_STEP
it.skipIf(!path || process.env.SURFACE_QA_ADAPTIVE_PROBE!=='1').each([3,7])
('creates and replays a v7 adaptive edit on real STEP face %i',async index=>{
  const input=readFileSync(path!),digest=(x:Uint8Array)=>createHash('sha256').update(x).digest('hex')
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,source=k.importStep(input.toString('utf8')),solids=k.getSubShapes(source,'solid')
  try {
    const step=k.exportStep(solids[0]),opened=editor.open(step)
    const prepared=editor.selectAdaptiveExperimental(index),net=prepared.net
    const nonPlane=opened.faces.find(f=>f.kind!=='plane')
    expect(nonPlane).toBeDefined()
    expect(()=>editor.selectAdaptiveExperimental(nonPlane!.index)).toThrow()
    const shape=k.importStep(step),faces=k.getSubShapes(shape,'face')
    try {
      const witness=visiblePoleWitness(net,prepared.witnessPole,(u,v)=>k.classifyPointOnFace(faces[index],u,v),0.01)!
      expect(witness).toBeTruthy()
      const n=k.surfaceNormal(faces[index],witness.u,witness.v),p=net.poles[prepared.witnessPole]
      net.poles[prepared.witnessPole]=[p[0]+n.x*.02,p[1]+n.y*.02,p[2]+n.z*.02]
      await expect(editor.createRecipe(net,'G1',[],'real-adaptive')).rejects.toThrow(/v7/)
      await expect(editor.createAdaptiveRecipe(net,'G1',[prepared.witnessPole],'real-adaptive')).rejects.toThrow(/bloccato/)
      const recipe=await editor.createAdaptiveRecipe(net,'G1',[],'real-adaptive')
      expect(recipe.version).toBe(7);expect(recipe.trimPolicy).toBe('circular-fine-v1')
      await expect(editor.replayAdaptiveRecipe(step,{...recipe,lockedPoles:[prepared.witnessPole]},'real-adaptive')).rejects.toThrow(/bloccato/)
      // Move first, then freeze that exact location and save it in v8.
      const locks=updateAdaptiveLocks(net,[],[prepared.witnessPole])
      const v8=await editor.createAdaptiveLockedRecipe(net,'G1',locks,'real-adaptive')
      expect(v8.version).toBe(8);expect(v8.lockedValues[0].point).toEqual(net.poles[prepared.witnessPole])
      const replayLocked=await editor.replayAdaptiveLockedRecipe(step,JSON.parse(JSON.stringify(v8)),'real-adaptive')
      expect(replayLocked.valid).toBe(true);expect(replayLocked.step).toBeTruthy()
      const bad=structuredClone(v8);bad.lockedValues[0].point[0]+=.1
      await expect(editor.replayAdaptiveLockedRecipe(step,bad,'real-adaptive')).rejects.toThrow(/bloccato/)
      const badNet=structuredClone(net);badNet.poles[prepared.witnessPole][0]+=.1
      await expect(editor.createAdaptiveLockedRecipe(badNet,'G1',locks,'real-adaptive')).rejects.toThrow(/bloccato/)
      const direct=editor.evaluate(net,'G1',true),replayed=await editor.replayAdaptiveRecipe(step,JSON.parse(JSON.stringify(recipe)),'real-adaptive')
      expect(direct.valid).toBe(true);expect(replayed.valid).toBe(true)
      const d=k.importStep(direct.step!),r=k.importStep(replayed.step!),locked=k.importStep(replayLocked.step!),df=k.getSubShapes(d,'face'),rf=k.getSubShapes(r,'face'),lf=k.getSubShapes(locked,'face')
      try {
        expect(k.isValid(d)).toBe(true);expect(k.isValid(r)).toBe(true);expect(k.isValid(locked)).toBe(true)
        expect(k.getVolume(locked)).toBeCloseTo(k.getVolume(d),6)
        const original=k.pointOnSurface(faces[index],witness.u,witness.v), a=k.pointOnSurface(df[index],witness.u,witness.v),b=k.pointOnSurface(rf[index],witness.u,witness.v)
        const c=k.pointOnSurface(lf[index],witness.u,witness.v)
        expect(Math.hypot(original.x-a.x,original.y-a.y,original.z-a.z)).toBeGreaterThan(.00019)
        expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeLessThan(1e-7)
        expect(Math.hypot(a.x-c.x,a.y-c.y,a.z-c.z)).toBeLessThan(1e-7)
        for(let f=0;f<faces.length;f++) if(f!==index){
          const q=k.uvBounds(faces[f])
          for(const u of [.25,.5,.75])for(const v of [.25,.5,.75]){
            const x=q.uMin+(q.uMax-q.uMin)*u,y=q.vMin+(q.vMax-q.vMin)*v
            if(k.classifyPointOnFace(faces[f],x,y)!=='in')continue
            const p=k.pointOnSurface(faces[f],x,y),z=k.pointOnSurface(lf[f],x,y)
            expect(Math.hypot(p.x-z.x,p.y-z.y,p.z-z.z)).toBeLessThan(1e-6)
          }
        }
        const wires=k.getSubShapes(faces[index],'wire'),edges=wires.flatMap(w=>k.getSubShapes(w,'edge'))
        try {for(const edge of edges){
          const t=k.curveParameters(edge)
          for(let i=0;i<=24;i++){
            const p=k.curvePointAtParam(edge,t.first+(t.last-t.first)*i/24),uv=k.uvFromPoint(faces[index],p)
            const z=k.pointOnSurface(lf[index],uv.u,uv.v),n=k.surfaceNormal(faces[index],uv.u,uv.v),m=k.surfaceNormal(lf[index],uv.u,uv.v)
            expect(Math.hypot(p.x-z.x,p.y-z.y,p.z-z.z)).toBeLessThan(1e-6)
            expect(n.x*m.x+n.y*m.y+n.z*m.z).toBeGreaterThan(1-1e-8)
          }
        }} finally {edges.forEach(e=>k.release(e));wires.forEach(w=>k.release(w))}
      } finally {df.forEach(f=>k.release(f));rf.forEach(f=>k.release(f));lf.forEach(f=>k.release(f));k.release(d);k.release(r);k.release(locked)}
    } finally {faces.forEach(f=>k.release(f));k.release(shape)}
    expect(digest(readFileSync(path!))).toBe(digest(input))
  } finally {solids.forEach(s=>k.release(s));k.release(source);editor.dispose()}
},120000)

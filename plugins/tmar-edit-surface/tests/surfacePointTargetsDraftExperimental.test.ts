// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest'
import {SurfaceEditorKernel} from '../editorKernel'
import {SurfaceRuntime} from '../surfaceRuntime'
import {SurfaceDraft} from '../surfaceDraft'
import {targetSurfacePoint} from '../surfacePointTarget'
import {boundaryLocked,type Net,type Point} from '../brep'
import type {Request} from '../editor.worker'
import type {KnotInsertion} from '../refineClampedNet'

it('adds a second simultaneous contact on imported STEP without losing the first and undoes the batch in one geometry step',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,box=k.makeBox(20,30,10),step=k.exportStep(box),input=k.importStep(step)
  const sourceBrep=k.toBREP(input),sourceFaces=k.getSubShapes(input,'face'),top=sourceFaces.findIndex(face=>{
    const b=k.uvBounds(face);return Math.abs(k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z-10)<1e-8
  })
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  const client={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
    postMessage(message:Request){host.onmessage!({data:structuredClone(message)} as MessageEvent<Request>)},terminate(){}}
  const host={onmessage:null as ((e:MessageEvent<Request>)=>void)|null,
    postMessage(reply:unknown){client.onmessage?.({data:structuredClone(reply)} as MessageEvent)}}
  let runtime:SurfaceRuntime|undefined,draft:SurfaceDraft|undefined
  try{
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    await runtime.worker.ask({action:'open',step})
    const initial=await runtime.worker.ask<Net>({action:'select',face:top})
    const refinements:KnotInsertion[]=(['U','V'] as const).flatMap(axis=>{
      const knots=axis==='U'?initial.ku:initial.kv
      return [.25,.75].map(t=>({axis,value:knots[0]+t*(knots.at(-1)!-knots[0]),count:1}))
    })
    const prepared=await runtime.worker.ask<{net:Net;trimLocks:number[];hiddenPoles:number[]}>({action:'selectRefined',face:top,refinements})
    draft=new SurfaceDraft(runtime);draft.install(prepared.net,{face:top,refinements,trimLocks:prepared.trimLocks,hiddenPoles:prepared.hiddenPoles})
    const ready=async()=>vi.waitFor(()=>{const d=draft!.getSnapshot();expect(d.calculating).toBe(false);expect(d.validNet).toBe(d.net)},{timeout:15000,interval:20})
    await ready()
    const sourceNet=draft.getSnapshot().net!,locked=Math.floor(sourceNet.nu/2)*sourceNet.nv+Math.floor(sourceNet.nv/2)
    draft.setLocks([locked])
    const editablePoles=sourceNet.poles.flatMap((_,i)=>i!==locked&&!boundaryLocked(sourceNet,i,'G1')&&!prepared.trimLocks.includes(i)&&!prepared.hiddenPoles.includes(i)?[i]:[])
    const b=k.uvBounds(sourceFaces[top]),points=[{s:.3,t:.35,dz:.04},{s:.7,t:.65,dz:-.02}].map(({s,t,dz})=>{
      const u=b.uMin+s*(b.uMax-b.uMin),v=b.vMin+t*(b.vMax-b.vMin),p=k.pointOnSurface(sourceFaces[top],u,v)
      expect(k.classifyPointOnFace(sourceFaces[top],u,v)).toBe('in')
      return {u,v,target:[p.x,p.y,p.z+dz] as Point}
    })
    const options={editablePoles,maxPoleDisplacement:1,minInfluence:.01,residualTolerance:1e-9}
    const first=targetSurfacePoint(sourceNet,{...options,...points[0]})
    draft.commit(first.net);await ready()
    const beforeBatch=draft.getSnapshot().net!,beforeLocks=draft.getSnapshot().locks
    draft.setSelection(editablePoles)
    const snapshot=draft.getSnapshot(),witness=await runtime.worker.ask<{faceBrep:string}>({action:'finalFaceWitness',previewRevision:snapshot.preview!.previewRevision!})
    const nativeFace=k.fromBREP(witness.faceBrep),anchors=[]
    try{for(const point of points){
      const p=k.pointOnSurface(nativeFace,point.u,point.v)
      const picked=await runtime.worker.ask<{anchor:import('../editorKernel').DraftAnchor}>({action:'notePick',point:[p.x,p.y,p.z],previewRevision:snapshot.preview!.previewRevision!})
      anchors.push({anchor:picked.anchor,target:point.target})
    }}finally{k.release(nativeFace)}
    const result=await draft.targetPointsExperimental(snapshot,anchors,options,()=>true)
    expect(draft.getSnapshot().validNet).toBeNull();await ready()
    const exported=await draft.evaluateForExport(),shape=k.importStep(exported.step),faces=k.getSubShapes(shape,'face'),solids=k.getSubShapes(shape,'solid')
    let maxTargetResidual=0,maxBoundaryError=0,minimumBoundaryNormalDot=1
    try{
      expect(k.isValid(shape)).toBe(true);expect(faces).toHaveLength(6);expect(solids).toHaveLength(1)
      for(const target of points){const p=k.pointOnSurface(faces[top],target.u,target.v);maxTargetResidual=Math.max(maxTargetResidual,Math.hypot(p.x-target.target[0],p.y-target.target[1],p.z-target.target[2]))}
      expect(maxTargetResidual).toBeLessThan(1e-8)
      for(let i=0;i<=16;i++)for(const [u,v] of [[b.uMin,b.vMin+(b.vMax-b.vMin)*i/16],[b.uMax,b.vMin+(b.vMax-b.vMin)*i/16],
        [b.uMin+(b.uMax-b.uMin)*i/16,b.vMin],[b.uMin+(b.uMax-b.uMin)*i/16,b.vMax]]){
        const p=k.pointOnSurface(faces[top],u,v),q=k.pointOnSurface(sourceFaces[top],u,v),a=k.surfaceNormal(faces[top],u,v),c=k.surfaceNormal(sourceFaces[top],u,v)
        maxBoundaryError=Math.max(maxBoundaryError,Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z));minimumBoundaryNormalDot=Math.min(minimumBoundaryNormalDot,a.x*c.x+a.y*c.y+a.z*c.z)
      }
      expect(maxBoundaryError).toBeLessThan(1e-8);expect(minimumBoundaryNormalDot).toBeGreaterThan(1-1e-10)
    }finally{faces.forEach(h=>k.release(h));solids.forEach(h=>k.release(h));k.release(shape)}
    expect(draft.getSnapshot().net!.poles[locked]).toEqual(sourceNet.poles[locked])
    expect(draft.undo()).toBe(true);await ready();expect(draft.getSnapshot().net).toEqual(beforeBatch);expect(draft.getSnapshot().locks).toEqual(beforeLocks)
    const undo=await draft.evaluateForExport(),undoShape=k.importStep(undo.step),undoFaces=k.getSubShapes(undoShape,'face')
    let firstContactUndoResidual=0
    try{const p=k.pointOnSurface(undoFaces[top],points[0].u,points[0].v);firstContactUndoResidual=Math.hypot(p.x-points[0].target[0],p.y-points[0].target[1],p.z-points[0].target[2]);expect(firstContactUndoResidual).toBeLessThan(1e-8);expect(k.isValid(undoShape)).toBe(true)}
    finally{undoFaces.forEach(h=>k.release(h));k.release(undoShape)}
    expect(k.toBREP(input)).toBe(sourceBrep)
    console.log(JSON.stringify({scope:'Two finite simultaneous surface constraints; real SurfaceDraft, dispatcher and OCCT; simulated transport',passes:result.passes,
      maxTargetResidualMm:maxTargetResidual,maxBoundaryErrorMm:maxBoundaryError,minimumBoundaryNormalDot,firstContactUndoResidualMm:firstContactUndoResidual,
      stepValid:true,faces:6,solids:1,manualLockPreserved:true,singleBatchUndo:true,sourceUnchanged:true,browser:'NOT_RUN'}))
  }finally{draft?.dispose();runtime?.dispose();vi.unstubAllGlobals();load.mockRestore();sourceFaces.forEach(h=>k.release(h));k.release(input);k.release(box);editor.dispose()}
},60000)

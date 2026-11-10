// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { SurfaceEditorKernel, type DraftAnchor } from '../editorKernel'
import { SurfaceRuntime } from '../surfaceRuntime'
import { createWorkspaceSurfaceSession, type WorkspaceSurfaceSession } from '../workspaceSession'
import { boundaryLocked, type Point } from '../brep'
import type { Request } from '../editor.worker'

it('qualifies clicked-anchor targeting through real STEP, dispatcher, OCCT validation and Undo (in-memory transport)',async()=>{
  vi.useFakeTimers()
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,box=k.makeBox(20,30,10)
  const source=k.exportStep(box),bytes=new TextEncoder().encode(source)
  const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex'),hash=sha(bytes)
  const input=k.importStep(source),sourceFaces=k.getSubShapes(input,'face')
  const sourceFace=sourceFaces.find(f=>{const b=k.uvBounds(f);return Math.abs(k.pointOnSurface(f,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z-10)<1e-8})!
  const sourceBounds=k.uvBounds(sourceFace)
  const seedPoint=k.pointOnSurface(sourceFace,(sourceBounds.uMin+sourceBounds.uMax)/2,(sourceBounds.vMin+sourceBounds.vMax)/2)
  const seed:Point=[seedPoint.x,seedPoint.y,seedPoint.z],target:Point=[seed[0],seed[1],seed[2]+.2]
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  const actions:string[]=[]
  const client={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
    postMessage(message:Request){actions.push(message.action);host.onmessage!({data:structuredClone(message)} as MessageEvent<Request>)},terminate(){}}
  const host={onmessage:null as ((e:MessageEvent<Request>)=>void)|null,
    postMessage(value:unknown){client.onmessage?.({data:structuredClone(value)} as MessageEvent)}}
  let runtime:SurfaceRuntime|undefined,session:WorkspaceSurfaceSession|undefined
  const imported:ReturnType<typeof k.importStep>[]=[]
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()}
  const ready=async()=>{await vi.advanceTimersByTimeAsync(90);await flush();expect(session!.getSnapshot().validation.kind).toBe('valid')}
  const snapshot=async()=>{
    const current=await runtime!.worker.ask<{face:number;selectionRevision:number;previewRevision:number;faceBrep:string}>({
      action:'finalFaceWitness',previewRevision:session!.getViewState().preview!.previewRevision!})
    const f=k.fromBREP(current.faceBrep)
    try {
      const at=k.pointOnSurface(f,anchor.u,anchor.v),bounds=k.uvBounds(f),boundary:Point[]=[],normals:Point[]=[]
      for(let i=0;i<=16;i++)for(const [u,v] of [[bounds.uMin,bounds.vMin+(bounds.vMax-bounds.vMin)*i/16],
        [bounds.uMax,bounds.vMin+(bounds.vMax-bounds.vMin)*i/16],
        [bounds.uMin+(bounds.uMax-bounds.uMin)*i/16,bounds.vMin],
        [bounds.uMin+(bounds.uMax-bounds.uMin)*i/16,bounds.vMax]]) {
        const p=k.pointOnSurface(f,u,v),n=k.surfaceNormal(f,u,v)
        boundary.push([p.x,p.y,p.z]);normals.push([n.x,n.y,n.z])
      }
      return {point:[at.x,at.y,at.z] as Point,boundary,normals}
    } finally{k.release(f)}
  }
  let anchor:DraftAnchor
  try {
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    const context={apiVersion:1,sessionId:'surface-point-occt',source:{documentEpoch:'synthetic',sourceEpoch:1,bodyId:1,bodyKey:'box',
      buildVersion:1,kernelGeneration:1,frameRevision:1,stepSha256:hash,units:'mm',coordinateFrame:'part'},step:bytes,
      capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:new AbortController().signal,
      assertSourceCurrent:()=>{},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
    session=await createWorkspaceSurfaceSession(context as never,vi.fn() as never,{runtime,sha256:async b=>sha(b)})
    // Face order follows the STEP imported by this real session, not a hardcoded index.
    const faceIndex=sourceFaces.indexOf(sourceFace)
    await session.chooseFace(faceIndex);await ready()
    const picked=await runtime.worker.ask<{anchor:DraftAnchor;at:Point;normal:Point}>({action:'notePick',point:seed,
      previewRevision:session.getViewState().preview!.previewRevision!})
    anchor=picked.anchor
    const original=session.getPanelState().net!,before=await snapshot()
    const center=Math.floor(original.nu/2)*original.nv+Math.floor(original.nv/2)
    session.selectPoints([0,center,original.poles.length-1],false)
    session.beginSurfaceTarget('scan',2)
    let resolverCalls=0
    await session.pickSurfaceTarget(seed,(at,normal,distance,kind)=>{
      resolverCalls++;expect(at).toEqual(picked.at);expect(normal[2]).toBeGreaterThan(.99)
      expect(distance).toBe(1);expect(kind).toBe('scan')
      return {point:target,kind,label:'Synthetic reference plane at Z=10.2',current:()=>true}
    })
    await ready()
    expect(resolverCalls).toBe(1)
    const changed=session.getPanelState().net!,after=await snapshot()
    const changedPoles=changed.poles.flatMap((p,i)=>p.some((x,d)=>x!==original.poles[i][d])?[i]:[])
    expect(changedPoles).toEqual([center])
    original.poles.forEach((p,i)=>{if(boundaryLocked(original,i,'G1'))expect(changed.poles[i]).toEqual(p)})
    const pointResidual=Math.hypot(...after.point.map((x,d)=>x-target[d]))
    expect(pointResidual).toBeLessThan(1e-7)
    const maxBoundaryGap=Math.max(...before.boundary.map((p,i)=>Math.hypot(...p.map((x,d)=>x-after.boundary[i][d]))))
    const minimumNormalDot=Math.min(...before.normals.map((p,i)=>p.reduce((s,x,d)=>s+x*after.normals[i][d],0)))
    expect(maxBoundaryGap).toBeLessThan(1e-8);expect(minimumNormalDot).toBeGreaterThan(1-1e-10)
    const output=await session.exportStep(),saved=k.importStep(output.step);imported.push(saved)
    expect(k.isValid(saved)).toBe(true)
    const savedSolids=k.getSubShapes(saved,'solid'),savedFaces=k.getSubShapes(saved,'face')
    let stepPointResidual:number
    try {
      expect(savedSolids).toHaveLength(1);expect(savedFaces).toHaveLength(6)
      // BREP tables also include adjacent supports referenced by pcurves;
      // identify the face's own support using OCCT, never any table record.
      const curvedFaces=savedFaces.filter(f=>k.surfaceType(f)!=='plane')
      expect(curvedFaces).toHaveLength(1)
      const changedFace=curvedFaces[0]
      const projected=k.projectPointOnFace(changedFace,{x:target[0],y:target[1],z:target[2]})
      stepPointResidual=Math.hypot(projected.x-target[0],projected.y-target[1],projected.z-target[2])
      expect(stepPointResidual).toBeLessThan(1e-7)
    }finally{savedFaces.forEach(f=>k.release(f));savedSolids.forEach(s=>k.release(s))}
    const changedVolume=k.getVolume(saved)
    expect(changedVolume).toBeGreaterThan(6000)
    await ready();session.undo();await ready()
    expect(session.getPanelState().net).toEqual(original)
    expect(session.getPanelState().canUndo).toBe(false)
    const undone=await snapshot(),undoResidual=Math.hypot(...undone.point.map((x,d)=>x-before.point[d]))
    expect(undoResidual).toBeLessThan(1e-9)
    const undoStep=await session.exportStep(),undoSolid=k.importStep(undoStep.step);imported.push(undoSolid)
    expect(k.isValid(undoSolid)).toBe(true);expect(k.getVolume(undoSolid)).toBeCloseTo(6000,6)
    await ready();session.selectPoints([center],false);session.lockSelected(true);await ready()
    expect(session.getPanelState().canTargetPoint).toBe(false)
    expect(()=>session!.beginSurfaceTarget('scan',2)).toThrow()
    session.undo();await ready();session.beginSurfaceTarget('scan',.001)
    await expect(session.pickSurfaceTarget(seed,()=>({point:target,kind:'scan',label:'Budget refusal',current:()=>true}))).rejects.toThrow(/limite/)
    expect(session.getPanelState().net).toEqual(original)
    expect(session.getSnapshot().validation.kind).toBe('valid')
    expect(sha(bytes)).toBe(hash);expect(context.reportFatal).not.toHaveBeenCalled()
    const evidence={checkpoint:'8c708fc',fixture:'Synthetic 20 x 30 x 10 mm box, STEP export/import',
      transport:'In-memory structuredClone dispatcher; real editor.worker and OCCT; simulated host and reference resolver',
      browser:'NOT_RUN: no browser launch attempted',inputSha256:hash,before:before.point,target,after:after.point,
      pointResidualMm:pointResidual,stepPointResidualMm:stepPointResidual!,undo:undone.point,undoResidualMm:undoResidual,
      changedPoles,maxBoundaryGapMm:maxBoundaryGap,minimumBoundaryNormalDot:minimumNormalDot,boundarySamples:before.boundary.length,
      sourceVolumeMm3:k.getVolume(input),changedVolumeMm3:changedVolume,undoVolumeMm3:k.getVolume(undoSolid),
      reimport:{valid:true,solids:1,faces:6},manualLockRefusal:true,budgetRefusal:true,inputBytesUnchanged:true,actions}
    if(process.env.SURFACE_POINT_TARGET_EVIDENCE) {
      const destination=process.env.SURFACE_POINT_TARGET_EVIDENCE,folder=dirname(destination)
      writeFileSync(destination,JSON.stringify(evidence,null,2)+'\n')
      writeFileSync(join(folder,'input-box.step'),source)
      writeFileSync(join(folder,'targeted-box.step'),output.step)
      writeFileSync(join(folder,'undo-box.step'),undoStep.step)
    }
    console.log(JSON.stringify(evidence))
  } finally {
    if(session)await session.dispose('cancelled');else runtime?.dispose()
    vi.unstubAllGlobals();load.mockRestore();vi.useRealTimers()
    imported.forEach(s=>k.release(s));sourceFaces.forEach(f=>k.release(f));k.release(input);k.release(box);editor.dispose()
  }
},60000)

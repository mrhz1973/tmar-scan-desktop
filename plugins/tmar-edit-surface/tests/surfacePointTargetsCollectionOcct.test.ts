// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import * as THREE from 'three'
import {SurfaceEditorKernel} from '../editorKernel'
import {SurfaceRuntime} from '../surfaceRuntime'
import {createWorkspaceSurfaceSession,type WorkspaceSurfaceSession} from '../workspaceSession'
import {boundaryLocked,type Point} from '../brep'
import {snapAlong} from '../snap'
import type {Request} from '../editor.worker'

it('collects actual THREE reference hits with CAD anchors, reviews without geometry, validates one batch and restores it with Undo',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,box=k.makeBox(20,30,10),step=k.exportStep(box),bytes=new TextEncoder().encode(step)
  const sourceBrep=k.toBREP(box),inputHash=createHash('sha256').update(bytes).digest('hex')
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  const client={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
    postMessage(message:Request){host.onmessage!({data:structuredClone(message)} as MessageEvent<Request>)},terminate(){}}
  const host={onmessage:null as ((e:MessageEvent<Request>)=>void)|null,postMessage(reply:unknown){client.onmessage?.({data:structuredClone(reply)} as MessageEvent)}}
  let runtime:SurfaceRuntime|undefined,session:WorkspaceSurfaceSession|undefined
  const references:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>[]=[]
  try{
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    const context={apiVersion:1,sessionId:'collected-targets-qa',source:{documentEpoch:'synthetic',sourceEpoch:1,bodyId:1,bodyKey:'box',buildVersion:1,kernelGeneration:1,frameRevision:1,stepSha256:inputHash,units:'mm',coordinateFrame:'part'},
      step:bytes,capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:new AbortController().signal,
      assertSourceCurrent:()=>{},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
    session=await createWorkspaceSurfaceSession(context as never,vi.fn() as never,{runtime,sha256:async b=>createHash('sha256').update(b).digest('hex')})
    const ready=async()=>vi.waitFor(()=>expect(session!.getSnapshot().validation.kind).toBe('valid'),{timeout:15000,interval:20})
    await session.chooseFace(5);await ready();await session.refineNet('both');await ready()
    const original=session.getPanelState().net!,free=original.poles.flatMap((_,i)=>!boundaryLocked(original,i,'G1')?[i]:[])
    session.selectPoints(free,false)
    const before=session.getPanelState().net!,history=session.getSnapshot().historyRevision
    const seeds:Point[]=[[6,10.5,10],[14,19.5,10]],targets=seeds.map((p,i)=>[p[0],p[1],p[2]+(i===0?.04:-.02)] as Point)
    for(let i=0;i<targets.length;i++){
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
      mesh.position.set(...targets[i]);mesh.userData.snapKind='scan';mesh.userData.snapLabel=`Synthetic scan patch ${i+1}`;mesh.updateMatrixWorld(true);references.push(mesh)
    }
    session.beginSurfaceTarget('scan',1,true)
    for(const seed of seeds)await session.pickSurfaceTarget(seed,(at,normal,distance,kind)=>{
      const hit=snapAlong(new THREE.Vector3(...at),new THREE.Vector3(...normal),distance,references)
      expect(hit).not.toBeNull()
      return {point:hit!.point.toArray() as Point,kind,label:hit!.label,current:()=>true}
    })
    expect(session.getPanelState().net).toBe(before);expect(session.getSnapshot().historyRevision).toBe(history)
    const collected=session.getPanelState().surfaceTargetBatch!
    expect(collected).toHaveLength(2)
    collected.forEach((pair,i)=>expect(Math.hypot(...pair.target.map((x,d)=>x-targets[i][d]))).toBeLessThan(1e-10))
    await session.applySurfaceTargets();await ready()
    expect(session.getSnapshot().historyRevision).toBe(history+1);expect(session.getPanelState().surfaceTargetBatch).toBeNull()
    const exported=await session.exportStep(),output=k.importStep(exported.step),faces=k.getSubShapes(output,'face'),solids=k.getSubShapes(output,'solid')
    let maxTargetSkinDistance=0
    try{
      expect(k.isValid(output)).toBe(true);expect(faces).toHaveLength(6);expect(solids).toHaveLength(1)
      for(const p of targets){const vertex=k.makeVertex(...p);try{maxTargetSkinDistance=Math.max(maxTargetSkinDistance,Math.min(...faces.map(face=>k.distanceBetween(vertex,face))))}finally{k.release(vertex)}}
      expect(maxTargetSkinDistance).toBeLessThan(1e-6)
    }finally{faces.forEach(f=>k.release(f));solids.forEach(f=>k.release(f));k.release(output)}
    session.undo();await ready();expect(session.getPanelState().net).toEqual(original)
    expect(k.toBREP(box)).toBe(sourceBrep);expect(context.reportFatal).not.toHaveBeenCalled()
    console.log(JSON.stringify({scope:'Collected 2-point workflow; real session/CAD/THREE intersections; simulated transport and immutable reference lifetime',
      reviewedPairs:2,geometryUnchangedDuringCollection:true,oneGeometryCommit:true,maxTargetSkinDistanceMm:maxTargetSkinDistance,
      valid:true,faces:6,solids:1,undoNetRestored:true,sourceUnchanged:true,inputHash,browser:'NOT_RUN'}))
  }finally{if(session)await session.dispose('cancelled');else runtime?.dispose();references.forEach(r=>{r.geometry.dispose();r.material.dispose()});vi.unstubAllGlobals();load.mockRestore();k.release(box);editor.dispose()}
},60000)

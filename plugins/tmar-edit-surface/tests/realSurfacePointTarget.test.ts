// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in, one fixed real-file case. No candidate search or fallback after refusal.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { SurfaceEditorKernel, type DraftAnchor } from '../editorKernel'
import { SurfaceRuntime } from '../surfaceRuntime'
import { createWorkspaceSurfaceSession, type WorkspaceSurfaceSession } from '../workspaceSession'
import { snapAlong } from '../snap'
import { boundaryLocked, type Point } from '../brep'
import type { Request } from '../editor.worker'

const inputPath=process.env.SURFACE_QA_STEP
it.skipIf(!inputPath || process.env.SURFACE_QA_POINT_TARGET!=='1')('targets one fixed LEGO face using a real THREE plane and OCCT dispatcher, read-only source',async()=>{
  vi.useFakeTimers()
  const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
  const originalBytes=readFileSync(inputPath!),sourceHash=sha(originalBytes)
  const evidence:Record<string,unknown>={checkpoint:'8c708fc / b3c8e78',status:'RUNNING',solidIndex:1,faceIndex:19,
    inputSha256:sourceHash,inputBytes:originalBytes.length,policy:'One fixed face and midpoint; no fallback after refusal',
    transport:'In-memory structuredClone; real session, editor.worker dispatcher and OCCT',
    target:'Synthetic THREE.PlaneGeometry + real snapAlong ray intersection, offset 0.02 mm along CAD normal',
    browser:'NOT_RUN; no browser launch attempted'}
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,model=k.importStep(originalBytes.toString('utf8'))
  const solids=k.getSubShapes(model,'solid'),load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  let runtime:SurfaceRuntime|undefined,session:WorkspaceSurfaceSession|undefined,mesh:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>|undefined
  const owned:ReturnType<typeof k.importStep>[]=[]
  const actions:string[]=[]
  const client={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
    postMessage(message:Request){actions.push(message.action);host.onmessage!({data:structuredClone(message)} as MessageEvent<Request>)},terminate(){}}
  const host={onmessage:null as ((e:MessageEvent<Request>)=>void)|null,
    postMessage(value:unknown){client.onmessage?.({data:structuredClone(value)} as MessageEvent)}}
  const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve()}
  const ready=async()=>{await vi.advanceTimersByTimeAsync(90);await flush();expect(session!.getSnapshot().validation.kind).toBe('valid')}
  let anchor:DraftAnchor
  const measured=async()=>{
    const witness=await runtime!.worker.ask<{faceBrep:string}>({action:'finalFaceWitness',previewRevision:session!.getViewState().preview!.previewRevision!})
    const face=k.fromBREP(witness.faceBrep)
    try{const p=k.pointOnSurface(face,anchor.u,anchor.v);return [p.x,p.y,p.z] as Point}finally{k.release(face)}
  }
  try {
    expect(solids).toHaveLength(2)
    const step=k.exportStep(solids[1]),bytes=new TextEncoder().encode(step)
    evidence.selectedSolidVolumeMm3=k.getVolume(solids[1])
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    const context={apiVersion:1,sessionId:'real-lego-point-target',source:{documentEpoch:'read-only-lego',sourceEpoch:1,bodyId:2,bodyKey:'lego-solid-1',
      buildVersion:1,kernelGeneration:1,frameRevision:1,stepSha256:sha(bytes),units:'mm',coordinateFrame:'part'},step:bytes,
      capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:new AbortController().signal,
      assertSourceCurrent:()=>{},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
    session=await createWorkspaceSurfaceSession(context as never,vi.fn() as never,{runtime,sha256:async b=>sha(b)})
    const info=session.getPanelState().faces[19]
    evidence.faceInfo=info
    if(!info || info.reason)throw Error(`Fixed face refused: ${info?.reason ?? 'missing face 19'}`)
    await session.chooseFace(19);await ready()
    const original=session.getPanelState().net!,faceWitness=await runtime.worker.ask<{faceBrep:string}>({action:'finalFaceWitness',previewRevision:session.getViewState().preview!.previewRevision!})
    const face=k.fromBREP(faceWitness.faceBrep)
    let seed:Point
    try {
      const b=k.uvBounds(face),u=(b.uMin+b.uMax)/2,v=(b.vMin+b.vMax)/2
      const classification=k.classifyPointOnFace(face,u,v)
      evidence.midpointClassification=classification
      if(classification!=='in')throw Error('Fixed UV midpoint refused by trim classification.')
      const p=k.pointOnSurface(face,u,v);seed=[p.x,p.y,p.z]
    }finally{k.release(face)}
    const pin=await runtime.worker.ask<{anchor:DraftAnchor;at:Point;normal:Point}>({action:'notePick',point:seed,previewRevision:session.getViewState().preview!.previewRevision!})
    anchor=pin.anchor
    const before=await measured(),normal=new THREE.Vector3(...pin.normal).normalize()
    const target=new THREE.Vector3(...pin.at).addScaledVector(normal,.02)
    mesh=new THREE.Mesh(new THREE.PlaneGeometry(1000,1000),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
    mesh.position.copy(target);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal)
    mesh.userData.snapKind='cad';mesh.userData.snapLabel='Synthetic reference plane +0.02 mm';mesh.updateMatrixWorld(true)
    session.selectAllFree()
    const selection=session.getPanelState().selected
    evidence.selectedPoles=selection.length;evidence.trimLocks=info.trimLocks.length;evidence.hiddenPoles=info.hiddenPoles.length
    if(!session.getPanelState().canTargetPoint)throw Error('Fixed face refused: no authorized editable poles/preparation.')
    session.beginSurfaceTarget('cad',1)
    let hitPoint:Point|undefined
    await session.pickSurfaceTarget(seed,(at,direction,reach,kind)=>{
      const hit=snapAlong(new THREE.Vector3(...at),new THREE.Vector3(...direction),reach,[mesh!])
      if(!hit)return null
      hitPoint=hit.point.toArray() as Point
      return {point:hitPoint,kind,label:hit.label,current:()=>true}
    })
    await ready()
    const after=await measured(),changed=session.getPanelState().net!
    const residual=Math.hypot(...after.map((x,d)=>x-hitPoint![d]))
    evidence.before=before;evidence.after=after;evidence.threeIntersection=hitPoint;evidence.pointResidualMm=residual
    expect(residual).toBeLessThan(1e-7)
    const moved=changed.poles.flatMap((p,i)=>p.some((x,d)=>x!==original.poles[i][d])?[i]:[])
    const forbidden=new Set([...info.trimLocks,...info.hiddenPoles,...session.getPanelState().manualLocks])
    for(let i=0;i<original.poles.length;i++)if(boundaryLocked(original,i,'G1') || forbidden.has(i))expect(changed.poles[i]).toEqual(original.poles[i])
    evidence.changedPoles=moved;evidence.protectedPolesUnchanged=true
    const output=await session.exportStep(),reopened=k.importStep(output.step);owned.push(reopened)
    expect(k.isValid(reopened)).toBe(true)
    const savedSolids=k.getSubShapes(reopened,'solid'),savedFaces=k.getSubShapes(reopened,'face')
    try {expect(savedSolids).toHaveLength(1);expect(savedFaces).toHaveLength(session.getPanelState().faces.length)
      evidence.result={valid:true,solids:savedSolids.length,faces:savedFaces.length,volumeMm3:k.getVolume(reopened)}
    } finally{savedSolids.forEach(s=>k.release(s));savedFaces.forEach(f=>k.release(f))}
    await ready();session.undo();await ready()
    expect(session.getPanelState().net).toEqual(original)
    const undo=await measured(),undoResidual=Math.hypot(...undo.map((x,d)=>x-before[d]))
    expect(undoResidual).toBeLessThan(1e-9);expect(session.getPanelState().canUndo).toBe(false)
    evidence.undo=undo;evidence.undoResidualMm=undoResidual
    evidence.status='PASS'
  } catch(error) {
    evidence.status='REFUSED_OR_FAILED';evidence.error=String((error as Error).message)
    throw error
  } finally {
    evidence.inputSha256After=sha(readFileSync(inputPath!));evidence.inputUnchanged=evidence.inputSha256After===sourceHash;evidence.actions=actions
    expect(evidence.inputUnchanged).toBe(true)
    if(process.env.SURFACE_POINT_TARGET_EVIDENCE)writeFileSync(process.env.SURFACE_POINT_TARGET_EVIDENCE,JSON.stringify(evidence,null,2)+'\n')
    console.log(JSON.stringify(evidence))
    if(session)await session.dispose('cancelled');else runtime?.dispose()
    mesh?.geometry.dispose();mesh?.material.dispose();owned.forEach(s=>k.release(s));solids.forEach(s=>k.release(s));k.release(model)
    vi.unstubAllGlobals();load.mockRestore();editor.dispose();vi.useRealTimers()
  }
},60000)

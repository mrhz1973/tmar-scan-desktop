// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in, one fixed semantic face. Original scan and CAD are read only.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { acceleratedRaycast, MeshBVH, type MeshBVHOptions } from 'three-mesh-bvh'
import { SurfaceEditorKernel, type DraftAnchor } from '../editorKernel'
import { SurfaceRuntime } from '../surfaceRuntime'
import { createWorkspaceSurfaceSession, type WorkspaceSurfaceSession } from '../workspaceSession'
import { snapAlong } from '../snap'
import { boundaryLocked, type Point } from '../brep'
import type { Request } from '../editor.worker'

const cadPath=process.env.SURFACE_QA_PAIRED_CAD,scanPath=process.env.SURFACE_QA_SCAN
it.skipIf(!cadPath || !scanPath || process.env.SURFACE_QA_REAL_SCAN!=='1')('targets the actual paired LEGO scan at the minimum-Y outer wall without alignment or fallback',async()=>{
  vi.useFakeTimers()
  const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
  const cad=readFileSync(cadPath!),scan=readFileSync(scanPath!),cadHash=sha(cad),scanHash=sha(scan)
  const manifestBytes=readFileSync(join(dirname(cadPath!),'lego_R01_manifest.json'))
  const reportBytes=readFileSync(join(dirname(cadPath!),'lego_REPORT_R01.md'))
  const manifest=JSON.parse(manifestBytes.toString('utf8')) as {sourceSha256:string;files:{name:string;sha256:string}[]}
  const evidence:Record<string,unknown>={status:'RUNNING',cadSha256:cadHash,scanSha256:scanHash,
    reportSha256:sha(reportBytes),manifestSha256:sha(manifestBytes),scanBytes:scan.length,
    alignment:'Identity, as recorded in the hash-matched R01 report; no fitting, translation, rotation or scaling applied',
    scale:'Millimetres assumed by the source report; no independent physical scale verification',
    case:'One fixed semantic face: planar face with minimum centre Y, midpoint UV. No alternate face/pole after refusal.',
    browser:'NOT_RUN; no launch attempted',transport:'Simulated host and in-memory structuredClone; real session, dispatcher, OCCT, STLLoader, MeshBVH and snapAlong'}
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,source=k.importStep(cad.toString('utf8')),faces=k.getSubShapes(source,'face')
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  let runtime:SurfaceRuntime|undefined,session:WorkspaceSurfaceSession|undefined,geometry:THREE.BufferGeometry|undefined,material:THREE.MeshBasicMaterial|undefined
  const owned:ReturnType<typeof k.importStep>[]=[]
  const actions:string[]=[]
  const client={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
    postMessage(message:Request){actions.push(message.action);host.onmessage!({data:structuredClone(message)} as MessageEvent<Request>)},terminate(){}}
  const host={onmessage:null as ((e:MessageEvent<Request>)=>void)|null,
    postMessage(value:unknown){client.onmessage?.({data:structuredClone(value)} as MessageEvent)}}
  const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve()}
  const ready=async()=>{await vi.advanceTimersByTimeAsync(90);await flush();expect(session!.getSnapshot().validation.kind).toBe('valid')}
  let anchor:DraftAnchor
  const measure=async()=>{
    const witness=await runtime!.worker.ask<{faceBrep:string}>({action:'finalFaceWitness',previewRevision:session!.getViewState().preview!.previewRevision!})
    const f=k.fromBREP(witness.faceBrep)
    try{const p=k.pointOnSurface(f,anchor.u,anchor.v);return [p.x,p.y,p.z] as Point}finally{k.release(f)}
  }
  try {
    expect(scanHash).toBe(manifest.sourceSha256.toLowerCase())
    expect(cadHash).toBe(manifest.files.find(f=>f.name==='lego_CAD_R01.step')!.sha256.toLowerCase())
    expect(sha(reportBytes)).toBe(manifest.files.find(f=>f.name==='lego_REPORT_R01.md')!.sha256.toLowerCase())
    expect(reportBytes.toString('utf8')).toContain('Trasformazione finale identita: nessun riallineamento best-fit.')
    const planar=faces.flatMap((face,index)=>{
      if(k.surfaceType(face)!=='plane')return []
      const b=k.uvBounds(face),u=(b.uMin+b.uMax)/2,v=(b.vMin+b.vMax)/2,p=k.pointOnSurface(face,u,v)
      return [{index,u,v,center:[p.x,p.y,p.z] as Point,y:p.y}]
    }).sort((a,b)=>a.y-b.y)
    if(!planar.length)throw Error('Fixed semantic face refused: no planar face.')
    const selected=planar[0]
    evidence.faceIndex=selected.index;evidence.sourceMidpoint=selected.center
    const classification=k.classifyPointOnFace(faces[selected.index],selected.u,selected.v)
    evidence.midpointClassification=classification
    if(classification!=='in')throw Error('Fixed midpoint refused by trim classification.')
    geometry=new STLLoader().parse(new Uint8Array(scan).buffer)
    geometry.computeBoundingBox()
    evidence.scanBounds={min:geometry.boundingBox?.min.toArray(),max:geometry.boundingBox?.max.toArray()}
    evidence.scanTriangles=geometry.getAttribute('position').count/3
    geometry.boundsTree=new MeshBVH(geometry,{indirect:true} as MeshBVHOptions)
    material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide})
    const targetMesh=new THREE.Mesh(geometry,material)
    targetMesh.raycast=acceleratedRaycast;targetMesh.matrixAutoUpdate=false;targetMesh.matrix.identity();targetMesh.matrixWorld.identity()
    targetMesh.userData.snapKind='scan';targetMesh.userData.snapLabel='Read-only lego.stl, R01 identity frame'
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    const context={apiVersion:1,sessionId:'paired-real-scan-point',source:{documentEpoch:'read-only-R01',sourceEpoch:1,bodyId:1,bodyKey:'lego-R01',
      buildVersion:1,kernelGeneration:1,frameRevision:1,stepSha256:cadHash,units:'mm',coordinateFrame:'part'},step:cad,
      capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:new AbortController().signal,
      assertSourceCurrent:()=>{},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
    session=await createWorkspaceSurfaceSession(context as never,vi.fn() as never,{runtime,sha256:async b=>sha(b)})
    const info=session.getPanelState().faces[selected.index];evidence.faceInfo=info
    if(!info || info.reason)throw Error(`Fixed semantic face refused: ${info?.reason ?? 'missing face'}`)
    await session.chooseFace(selected.index);await ready()
    const pin=await runtime.worker.ask<{anchor:DraftAnchor;at:Point;normal:Point}>({action:'notePick',point:selected.center,previewRevision:session.getViewState().preview!.previewRevision!})
    anchor=pin.anchor
    const original=session.getPanelState().net!,before=await measure()
    session.selectAllFree()
    evidence.selectedPoles=session.getPanelState().selected
    if(!session.getPanelState().canTargetPoint)throw Error('Fixed face refused: no authorized editable poles.')
    session.beginSurfaceTarget('scan',1)
    let hitPoint:Point|undefined
    await session.pickSurfaceTarget(selected.center,(at,normal,reach,kind)=>{
      const hit=snapAlong(new THREE.Vector3(...at),new THREE.Vector3(...normal),reach,[targetMesh])
      if(!hit)return null
      hitPoint=hit.point.toArray() as Point
      return {point:hitPoint,kind,label:hit.label,current:()=>true}
    })
    await ready()
    const after=await measure(),residual=Math.hypot(...after.map((x,d)=>x-hitPoint![d]))
    evidence.before=before;evidence.after=after;evidence.actualScanIntersection=hitPoint;evidence.pointResidualMm=residual
    evidence.distanceToScanBeforeMm=Math.hypot(...before.map((x,d)=>x-hitPoint![d]))
    expect(residual).toBeLessThan(1e-7)
    const changed=session.getPanelState().net!
    const locked=new Set([...info.trimLocks,...info.hiddenPoles,...session.getPanelState().manualLocks])
    for(let i=0;i<original.poles.length;i++)if(boundaryLocked(original,i,'G1') || locked.has(i))expect(changed.poles[i]).toEqual(original.poles[i])
    evidence.protectedPolesUnchanged=true
    evidence.changedPoles=changed.poles.flatMap((p,i)=>p.some((x,d)=>x!==original.poles[i][d])?[i]:[])
    const output=await session.exportStep(),saved=k.importStep(output.step);owned.push(saved)
    expect(k.isValid(saved)).toBe(true)
    const solids=k.getSubShapes(saved,'solid'),savedFaces=k.getSubShapes(saved,'face')
    try{expect(solids).toHaveLength(1);expect(savedFaces).toHaveLength(faces.length)
      evidence.reimport={valid:true,solids:solids.length,faces:savedFaces.length,sourceVolumeMm3:k.getVolume(source),volumeMm3:k.getVolume(saved)}
    }finally{solids.forEach(s=>k.release(s));savedFaces.forEach(f=>k.release(f))}
    await ready();session.undo();await ready()
    expect(session.getPanelState().net).toEqual(original);expect(session.getPanelState().canUndo).toBe(false)
    const undone=await measure();evidence.undo=undone;evidence.undoResidualMm=Math.hypot(...undone.map((x,d)=>x-before[d]))
    expect(evidence.undoResidualMm).toBeLessThan(1e-9)
    evidence.status='PASS'
  }catch(error){evidence.status='REFUSED_OR_FAILED';evidence.error=String((error as Error).message);throw error}
  finally{
    evidence.cadSha256After=sha(readFileSync(cadPath!));evidence.scanSha256After=sha(readFileSync(scanPath!));evidence.actions=actions
    evidence.inputsUnchanged=evidence.cadSha256After===cadHash && evidence.scanSha256After===scanHash
    if(process.env.SURFACE_POINT_TARGET_EVIDENCE)writeFileSync(process.env.SURFACE_POINT_TARGET_EVIDENCE,JSON.stringify(evidence,null,2)+'\n')
    console.log(JSON.stringify(evidence))
    if(session)await session.dispose('cancelled');else runtime?.dispose()
    material?.dispose();geometry?.dispose();owned.forEach(s=>k.release(s));faces.forEach(f=>k.release(f));k.release(source)
    vi.unstubAllGlobals();load.mockRestore();editor.dispose();vi.useRealTimers()
    expect(evidence.inputsUnchanged).toBe(true)
  }
},60000)

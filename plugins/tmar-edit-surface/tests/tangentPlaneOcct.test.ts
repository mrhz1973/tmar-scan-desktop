// SPDX-License-Identifier: AGPL-3.0-only
import {createHash} from 'node:crypto'
import {expect,it,vi} from 'vitest'
import {SurfaceEditorKernel} from '../editorKernel'
import {SurfaceRuntime} from '../surfaceRuntime'
import {createWorkspaceSurfaceSession,type WorkspaceSurfaceSession} from '../workspaceSession'
import {boundaryLocked,type Point} from '../brep'
import type {Request} from '../editor.worker'

it('projects a selected pole onto the chosen tangent plane of a curved CAD draft and validates one Undo',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,box=k.makeBox(20,30,10)
  const bytes=new TextEncoder().encode(k.exportStep(box)),source=k.toBREP(box)
  const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  const client={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
    postMessage(message:Request){host.onmessage!({data:structuredClone(message)} as MessageEvent<Request>)},terminate(){}}
  const host={onmessage:null as ((e:MessageEvent<Request>)=>void)|null,
    postMessage(reply:unknown){client.onmessage?.({data:structuredClone(reply)} as MessageEvent)}}
  let runtime:SurfaceRuntime|undefined,session:WorkspaceSurfaceSession|undefined
  try{
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    const context={apiVersion:1,sessionId:'tangent-plane-qa',source:{documentEpoch:'synthetic',sourceEpoch:1,bodyId:1,bodyKey:'box',
      buildVersion:1,kernelGeneration:1,frameRevision:1,stepSha256:hash(bytes),units:'mm',coordinateFrame:'part'},
      step:bytes,capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:new AbortController().signal,
      assertSourceCurrent:()=>{},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
    session=await createWorkspaceSurfaceSession(context as never,vi.fn() as never,{runtime,sha256:async b=>hash(b)})
    const ready=async()=>vi.waitFor(()=>expect(session!.getSnapshot().validation.kind).toBe('valid'),{timeout:15000,interval:20})
    await session.chooseFace(5);await ready()
    const base=session.getPanelState().net!
    const pole=base.poles.findIndex((_,i)=>!boundaryLocked(base,i,'G1'))
    expect(pole).toBeGreaterThanOrEqual(0)
    session.selectPoints([0,pole],false);session.setDragMode('axis');session.setAxis(2)
    session.moveSelected(.4);await ready()
    const before=session.getPanelState().net!,history=session.getSnapshot().historyRevision
    const witness=await runtime.worker.ask<{faceBrep:string}>({action:'finalFaceWitness',previewRevision:session.getViewState().preview!.previewRevision!})
    const face=k.fromBREP(witness.faceBrep)
    let at:Point,normal:Point
    try{
      const bounds=k.uvBounds(face),u=bounds.uMin+.3*(bounds.uMax-bounds.uMin),v=(bounds.vMin+bounds.vMax)/2
      const p=k.pointOnSurface(face,u,v),n=k.surfaceNormal(face,u,v)
      at=[p.x,p.y,p.z];normal=[n.x,n.y,n.z]
    }finally{k.release(face)}
    expect(Math.hypot(normal[0],normal[1])).toBeGreaterThan(1e-3)
    session.beginTangentPlane();await session.pickTangentPlane(at);await ready()
    const changed=session.getPanelState().net!,projected=changed.poles[pole]
    const residual=Math.abs(projected.reduce((sum,x,i)=>sum+(x-at[i])*normal[i],0))
    expect(residual).toBeLessThan(1e-8)
    expect(Math.hypot(...projected.map((x,i)=>x-before.poles[pole][i]))).toBeGreaterThan(.01)
    changed.poles.forEach((p,i)=>{if(i!==pole)expect(p).toEqual(before.poles[i])})
    expect(session.getSnapshot().historyRevision).toBe(history+1)
    const result=await session.exportStep(),shape=k.importStep(result.step)
    try{
      expect(k.isValid(shape)).toBe(true);expect(k.subShapeCount(shape,'face')).toBe(6);expect(k.subShapeCount(shape,'solid')).toBe(1)
    }finally{k.release(shape)}
    await ready();session.undo();await ready();expect(session.getPanelState().net).toEqual(before)
    expect(k.toBREP(box)).toBe(source);expect(context.reportFatal).not.toHaveBeenCalled()
    console.log(JSON.stringify({normal,projectedPoleResidualMm:residual,changedPoles:1,stepValid:true,faces:6,solids:1,oneUndo:true,sourceUnchanged:true}))
  }finally{
    if(session)await session.dispose('cancelled');else runtime?.dispose()
    vi.unstubAllGlobals();load.mockRestore();k.release(box);editor.dispose()
  }
},60000)

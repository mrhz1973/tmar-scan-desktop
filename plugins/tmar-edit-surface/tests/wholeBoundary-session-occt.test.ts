// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { expect,it,vi } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { SurfaceRuntime } from '../surfaceRuntime'
import { createWorkspaceSurfaceSession,type WorkspaceSurfaceSession } from '../workspaceSession'
import type { Request } from '../editor.worker'
import type { Point } from '../brep'

it('moves the complete natural CAD edge without duplication through session/dispatcher/OCCT and Undo',async()=>{
  vi.useFakeTimers()
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,box=k.makeBox(20,30,10),boxFaces=k.getSubShapes(box,'face')
  const input=k.exportStep(boxFaces[5]),bytes=new TextEncoder().encode(input)
  const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),hash=sha(bytes)
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  const client={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
    postMessage(message:Request){host.onmessage!({data:structuredClone(message)} as MessageEvent<Request>)},terminate(){}}
  const host={onmessage:null as ((e:MessageEvent<Request>)=>void)|null,
    postMessage(value:unknown){client.onmessage?.({data:structuredClone(value)} as MessageEvent)}}
  let runtime:SurfaceRuntime|undefined,session:WorkspaceSurfaceSession|undefined
  const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve()}
  const ready=async()=>{await vi.advanceTimersByTimeAsync(90);await flush();expect(session!.getSnapshot().validation.kind).toBe('valid')}
  const edgeSamples=async()=>{
    const witness=await runtime!.worker.ask<{faceBrep:string}>({action:'finalFaceWitness',previewRevision:session!.getViewState().preview!.previewRevision!})
    const face=k.fromBREP(witness.faceBrep)
    try{const b=k.uvBounds(face);return Array.from({length:33},(_,i)=>{
      const p=k.pointOnSurface(face,b.uMin,b.vMin+(b.vMax-b.vMin)*i/32)
      return [p.x,p.y,p.z] as Point
    })}finally{k.release(face)}
  }
  try{
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    const context={apiVersion:1,sessionId:'whole-boundary-qa',source:{documentEpoch:'synthetic',sourceEpoch:1,bodyId:1,bodyKey:'sheet',
      buildVersion:1,kernelGeneration:1,frameRevision:1,stepSha256:hash,units:'mm',coordinateFrame:'part'},step:bytes,
      capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:new AbortController().signal,
      assertSourceCurrent:()=>{},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
    session=await createWorkspaceSurfaceSession(context as never,vi.fn() as never,{runtime,sha256:async b=>sha(b)})
    await session.chooseFace(0);await ready();session.setFreeBoundary(true);await ready()
    const original=session.getPanelState().net!,before=await edgeSamples()
    session.moveWholeBoundary('U0',[0,0,.2]);await ready()
    const after=await edgeSamples(),maxEdgeTranslationError=Math.max(...after.map((p,i)=>Math.hypot(...p.map((x,d)=>x-before[i][d]-(d===2?.2:0)))))
    expect(maxEdgeTranslationError).toBeLessThan(1e-8)
    const changed=session.getPanelState().net!,moved=changed.poles.flatMap((p,i)=>p.some((x,d)=>x!==original.poles[i][d])?[i]:[])
    expect(moved).toEqual(Array.from({length:original.nv},(_,i)=>i))
    expect({...changed,poles:[]}).toEqual({...original,poles:[]})
    const output=await session.exportStep(),saved=k.importStep(output.step)
    let faceCount=0,edgeCount=0,maxStepEdgeTranslationError=0
    try{
      expect(k.isValid(saved)).toBe(true)
      const faces=k.getSubShapes(saved,'face'),edges=k.getSubShapes(saved,'edge')
      try{
        faceCount=faces.length;edgeCount=edges.length;expect(faceCount).toBe(1);expect(edgeCount).toBe(4)
        const b=k.uvBounds(faces[0])
        for(let i=0;i<33;i++){
          const p=k.pointOnSurface(faces[0],b.uMin,b.vMin+(b.vMax-b.vMin)*i/32)
          maxStepEdgeTranslationError=Math.max(maxStepEdgeTranslationError,Math.hypot(p.x-before[i][0],p.y-before[i][1],p.z-before[i][2]-.2))
        }
        expect(maxStepEdgeTranslationError).toBeLessThan(1e-7)
      }finally{faces.forEach(f=>k.release(f));edges.forEach(e=>k.release(e))}
    }finally{k.release(saved)}
    await ready();session.undo();await ready()
    expect(session.getPanelState().net).toEqual(original)
    const undo=await edgeSamples(),maxUndoError=Math.max(...undo.map((p,i)=>Math.hypot(...p.map((x,d)=>x-before[i][d]))))
    expect(maxUndoError).toBeLessThan(1e-9)
    expect(sha(bytes)).toBe(hash);expect(context.reportFatal).not.toHaveBeenCalled()
    const evidence={scope:'Single natural open STEP sheet, complete U0 boundary moved without duplication',
      transport:'Real session, editor.worker dispatcher and OCCT; in-memory transport and simulated host',browser:'NOT_RUN',
      deltaMm:[0,0,.2],samples:33,movedPoles:moved,maxEdgeTranslationErrorMm:maxEdgeTranslationError,
      maxStepEdgeTranslationErrorMm:maxStepEdgeTranslationError,stepValid:true,faceCount,edgeCount,maxUndoErrorMm:maxUndoError,inputHash:hash}
    if(process.env.WHOLE_BOUNDARY_QA_EVIDENCE)writeFileSync(process.env.WHOLE_BOUNDARY_QA_EVIDENCE,JSON.stringify(evidence,null,2)+'\n')
    console.log(JSON.stringify(evidence))
  }finally{
    if(session)await session.dispose('cancelled');else runtime?.dispose()
    vi.unstubAllGlobals();load.mockRestore();boxFaces.forEach(f=>k.release(f));k.release(box);editor.dispose();vi.useRealTimers()
  }
},60000)

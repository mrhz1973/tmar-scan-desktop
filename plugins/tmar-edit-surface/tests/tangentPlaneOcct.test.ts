// SPDX-License-Identifier: AGPL-3.0-only
import {createHash} from 'node:crypto'
import {expect,it,vi} from 'vitest'
import {SurfaceRuntime} from '../surfaceRuntime'
import {createWorkspaceSurfaceSession,type WorkspaceSurfaceSession} from '../workspaceSession'
import {boundaryLocked,type Point} from '../brep'
import type {Request} from '../editor.worker'

it.each(['pole','span'] as const)('validates tangent plane projection of a curved CAD draft (%s) and one Undo',async mode=>{
  // editor.worker owns module-level editor state. Reload it for each table row
  // so `self.onmessage` and its mocked kernel editor bind to this case's host.
  vi.resetModules()
  const {SurfaceEditorKernel}=await import('../editorKernel')
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
    if(mode==='span'){
      await session.refineNet('both');await ready()
      await session.refineNet('both');await ready()
    }
    const base=session.getPanelState().net!
    const pole=mode==='span' ? Math.floor(base.nu/2)*base.nv+Math.floor(base.nv/2)
      : base.poles.findIndex((_,i)=>!boundaryLocked(base,i,'G1'))
    expect(pole).toBeGreaterThanOrEqual(0)
    session.selectPoints([0,pole],false);session.setDragMode('axis');session.setAxis(2)
    session.moveSelected(.4);await ready()
    const before=session.getPanelState().net!,history=session.getSnapshot().historyRevision
    const witness=await runtime.worker.ask<{faceBrep:string}>({action:'finalFaceWitness',previewRevision:session.getViewState().preview!.previewRevision!})
    const face=k.fromBREP(witness.faceBrep)
    const rimSamples=(shape:typeof face)=>{
      const b=k.uvBounds(shape)
      return Array.from({length:17},(_,i)=>i/16).flatMap(t=>[
        [b.uMin,b.vMin+t*(b.vMax-b.vMin)], [b.uMax,b.vMin+t*(b.vMax-b.vMin)],
        [b.uMin+t*(b.uMax-b.uMin),b.vMin], [b.uMin+t*(b.uMax-b.uMin),b.vMax],
      ].map(([u,v])=>({point:k.pointOnSurface(shape,u,v),normal:k.surfaceNormal(shape,u,v)})))
    }
    let at:Point,normal:Point
    let rimBefore:ReturnType<typeof rimSamples>
    try{
      const bounds=k.uvBounds(face)
      const u=bounds.uMin+(mode==='span'?.46:.3)*(bounds.uMax-bounds.uMin)
      const v=bounds.vMin+(mode==='span'?.44:.5)*(bounds.vMax-bounds.vMin)
      const p=k.pointOnSurface(face,u,v),n=k.surfaceNormal(face,u,v)
      at=[p.x,p.y,p.z];normal=[n.x,n.y,n.z]
      rimBefore=rimSamples(face)
    }finally{k.release(face)}
    expect(Math.hypot(normal[0],normal[1])).toBeGreaterThan(1e-3)
    let review
    if(mode==='span'){
      // The picked region depends on several off-plane poles. A single selected
      // pole cannot authorize this edit.
      session.beginTangentPlane('span')
      await expect(session.pickTangentPlane(at)).rejects.toThrow(/fuori piano/)
      expect(session.getPanelState().net).toBe(before);expect(session.getSnapshot().historyRevision).toBe(history)
      session.selectAllFree()
      session.beginTangentPlane('span');await session.pickTangentPlane(at)
      review=session.getPanelState().tangentSpanReview!
      expect(review.u).toEqual(before.ku.slice(3,5));expect(review.v).toEqual(before.kv.slice(3,5))
      expect(review.supportCount).toBe(16);expect(review.movedCount).toBeGreaterThan(1)
      expect(session.getPanelState().net).toBe(before);expect(session.getSnapshot().historyRevision).toBe(history)
      session.applyTangentSpan()
    }else{
      session.beginTangentPlane();await session.pickTangentPlane(at)
    }
    await ready()
    const changed=session.getPanelState().net!,projected=changed.poles[pole]
    const residual=Math.abs(projected.reduce((sum,x,i)=>sum+(x-at[i])*normal[i],0))
    expect(residual).toBeLessThan(1e-8)
    expect(Math.hypot(...projected.map((x,i)=>x-before.poles[pole][i]))).toBeGreaterThan(.01)
    const changedIds=changed.poles.flatMap((p,i)=>p.some((x,d)=>x!==before.poles[i][d])?[i]:[])
    expect(changedIds).toHaveLength(review?.movedCount??1)
    changed.poles.forEach((p,i)=>{if(boundaryLocked(before,i,'G1'))expect(p).toEqual(before.poles[i])})
    expect(session.getSnapshot().historyRevision).toBe(history+1)
    const result=await session.exportStep(),shape=k.importStep(result.step)
    let maxSpanResidual=0,maxRimGap=0,minRimNormalDot=1
    try{
      expect(k.isValid(shape)).toBe(true);expect(k.subShapeCount(shape,'face')).toBe(6);expect(k.subShapeCount(shape,'solid')).toBe(1)
      if(review){
        const faces=k.getSubShapes(shape,'face')
        try{
          for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){
            const u=review.u[0]+(review.u[1]-review.u[0])*i/8,v=review.v[0]+(review.v[1]-review.v[0])*j/8
            const p=k.pointOnSurface(faces[5],u,v)
            maxSpanResidual=Math.max(maxSpanResidual,Math.abs((p.x-at[0])*normal[0]+(p.y-at[1])*normal[1]+(p.z-at[2])*normal[2]))
          }
          rimSamples(faces[5]).forEach(({point,normal},i)=>{
            const source=rimBefore[i]
            maxRimGap=Math.max(maxRimGap,Math.hypot(point.x-source.point.x,point.y-source.point.y,point.z-source.point.z))
            minRimNormalDot=Math.min(minRimNormalDot,normal.x*source.normal.x+normal.y*source.normal.y+normal.z*source.normal.z)
          })
          expect(maxSpanResidual).toBeLessThan(1e-8);expect(maxRimGap).toBeLessThan(1e-8)
          expect(minRimNormalDot).toBeGreaterThan(1-1e-10)
        }finally{faces.forEach(f=>k.release(f))}
      }
    }finally{k.release(shape)}
    await ready();session.undo();await ready();expect(session.getPanelState().net).toEqual(before)
    expect(k.toBREP(box)).toBe(source);expect(context.reportFatal).not.toHaveBeenCalled()
    console.log(JSON.stringify({mode,normal,projectedPoleResidualMm:residual,changedPoles:changedIds.length,review,
      maxSpanResidualMm:maxSpanResidual,maxRimGapMm:maxRimGap,minRimNormalDot,stepValid:true,faces:6,solids:1,oneUndo:true,sourceUnchanged:true}))
  }finally{
    if(session)await session.dispose('cancelled');else runtime?.dispose()
    vi.unstubAllGlobals();load.mockRestore();k.release(box);editor.dispose()
  }
},60000)

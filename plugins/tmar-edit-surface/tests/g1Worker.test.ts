// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel, type DraftAnchor, type G1PlaneResult, type G1PublishedPlaneResult, type G1SupportCandidates, type Preview } from '../editorKernel'
import type { Net } from '../brep'
import type { SurfaceWorkerPayload } from '../workerClient'

it('dispatches isolated and published G1 to real OCCT, preserves notes and refuses stale or cylindrical selections',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const rectangle=(x:number)=>{
    const p=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
    const edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%4]));owned.push(...edges)
    const wire=k.makeWire(edges);owned.push(wire)
    const face=k.makeFace(wire);owned.push(face);return face
  }
  const shell=k.sew([rectangle(0),rectangle(10)],1e-7);owned.push(shell)
  const step=k.exportStep(shell),load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>()
  const worker:{onmessage:((event:MessageEvent)=>void)|null;postMessage:(reply:{id:number;result?:unknown;error?:string})=>void}={
    onmessage:null,postMessage(reply){
      const waiter=pending.get(reply.id)!
      pending.delete(reply.id)
      if(reply.error)waiter.reject(new Error(reply.error));else waiter.resolve(reply.result)
    },
  }
  vi.stubGlobal('self',worker)
  let serial=0
  const ask=<T>(request:SurfaceWorkerPayload):Promise<T>=>new Promise((resolve,reject)=>{
    const id=++serial
    pending.set(id,{resolve:resolve as (value:unknown)=>void,reject})
    worker.onmessage!({data:{...request,id}} as MessageEvent)
  })
  try {
    await import('../editor.worker')
    await ask({action:'open',step})
    const selection={face:0,refinements:[]}
    const net=await ask<Net>({action:'select',face:0})
    const {candidates:[choice]}=await ask<G1SupportCandidates>({action:'g1SupportCandidates'})
    const u=choice.side==='uMin'?1:choice.side==='uMax'?net.nu-2:Math.floor(net.nu/2)
    const v=choice.side==='vMin'?1:choice.side==='vMax'?net.nv-2:Math.floor(net.nv/2)
    const index=u*net.nv+v,base=structuredClone(net)
    base.poles[index]=base.poles[index].map((x,d)=>x+.2*choice.plane.normal[d]) as [number,number,number]
    const current=await ask<Preview>({action:'evaluate',net:base,continuity:'G0',selection})
    const witness=await ask({action:'finalFaceWitness',previewRevision:current.previewRevision!})
    const result=await ask<G1PlaneResult>({action:'proposeG1PlaneTangency',net:base,choice,lockedPoles:[],selection,exportStep:true})
    expect(result.changedIndices).toEqual([index])
    expect(result.net.poles[index]).toEqual(net.poles[index])
    expect(result.step).toContain('ISO-10303-21')
    expect(result.preview.valid).toBe(true)
    expect(result.preview.previewRevision).toBeUndefined()
    expect(result.revisions.preview).toBe(current.previewRevision)
    const validated=await ask<G1PlaneResult>({action:'validateG1PlaneTangency',baseNet:base,net:result.net,choice,lockedPoles:[],selection})
    expect(validated.net).toEqual(result.net)
    expect(validated.validation.globalG1Certified).toBe(false)
    expect(await ask({action:'finalFaceWitness',previewRevision:current.previewRevision!})).toEqual(witness)
    const proposal={action:'proposeG1PlaneTangency' as const,net:base,choice,selection}
    await expect(ask({...proposal,selection:{face:1,refinements:[]}})).rejects.toThrow('scaduta')
    await expect(ask({...proposal,choice:{...choice,stamp:{...choice.stamp,faceIndex:1}}})).rejects.toThrow('scaduta')
    await expect(ask({...proposal,lockedPoles:[index]})).rejects.toThrow('incompatibile')
    expect(await ask({action:'finalFaceWitness',previewRevision:current.previewRevision!})).toEqual(witness)
    const publish={action:'publishG1PlaneTangency' as const,baseNet:base,net:result.net,choice,lockedPoles:[],selection}
    await expect(ask({...publish,selection:{face:1,refinements:[]}})).rejects.toThrow('scaduta')
    const published=await ask<G1PublishedPlaneResult>(publish)
    expect(published.preview.previewRevision).toBeGreaterThan(current.previewRevision!)
    expect(published.stamp).toEqual(choice.stamp)
    const publishedWitness=await ask<{selectionRevision:number}>({action:'finalFaceWitness',previewRevision:published.preview.previewRevision})
    const point=result.net.poles[12]
    const picked=await ask<{anchor:DraftAnchor;at:number[];normal:number[]}>({action:'notePick',point,previewRevision:published.preview.previewRevision})
    expect(picked.anchor.selectionRevision).toBe(publishedWitness.selectionRevision)
    const evaluate={action:'evaluateG1PlaneTangency' as const,constraintId:published.constraintId,net:result.net,lockedPoles:[],selection}
    await expect(ask({...evaluate,selection:{face:1,refinements:[]}})).rejects.toThrow('scaduta')
    await expect(ask({...evaluate,constraintId:-1})).rejects.toThrow('scaduto')
    const unsafe=structuredClone(result.net);unsafe.poles[0][2]+=.1
    await expect(ask({...evaluate,net:unsafe})).rejects.toThrow()
    expect(await ask({action:'finalFaceWitness',previewRevision:published.preview.previewRevision})).toEqual(publishedWitness)
    const reevaluated=await ask<G1PublishedPlaneResult>({...evaluate,exportStep:true})
    expect(reevaluated.constraintId).toBe(published.constraintId)
    expect(reevaluated.step).toContain('ISO-10303-21')
    expect(reevaluated.stamp).toEqual(published.stamp)
    expect(reevaluated.preview.previewRevision).toBeGreaterThan(published.preview.previewRevision)
    expect(await ask({action:'noteResolve',anchor:picked.anchor,previewRevision:reevaluated.preview.previewRevision})).toMatchObject({at:picked.at,normal:picked.normal})
    await expect(ask({action:'finalFaceWitness',previewRevision:published.preview.previewRevision})).rejects.toThrow('Anteprima')
    // Same face/refinements is still a new kernel-stamped selection.
    await ask({action:'select',face:0})
    await expect(ask(proposal)).rejects.toThrow('scaduta')
    await expect(ask(publish)).rejects.toThrow('scaduta')
    await expect(ask(evaluate)).rejects.toThrow('scaduto')
    const fresh=await ask<G1SupportCandidates>({action:'g1SupportCandidates'})
    await ask({action:'open',step})
    await expect(ask({...proposal,choice:fresh.candidates[0]})).rejects.toThrow('scaduta')
    await expect(ask(evaluate)).rejects.toThrow('scaduta')
    await ask({action:'select',face:0})
    await expect(ask({...proposal,choice:fresh.candidates[0]})).rejects.toThrow('scaduta')
    const cylinder=k.makeCylinder(10,20);owned.push(cylinder)
    await ask({action:'open',step:k.exportStep(cylinder)})
    const cylinderFace=editor.infos.find(f=>f.experimentalCylinder)!.index
    await ask({action:'prepareCylinder',face:cylinderFace})
    await expect(ask(proposal)).rejects.toThrow('cilindrica')
    await expect(ask(publish)).rejects.toThrow('cilindrica')
    await expect(ask(evaluate)).rejects.toThrow('cilindrica')
    expect(load).toHaveBeenCalledTimes(1)
  } finally {
    vi.unstubAllGlobals();load.mockRestore()
    owned.forEach(handle=>k.release(handle));editor.dispose()
  }
},60000)

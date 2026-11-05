// SPDX-License-Identifier: AGPL-3.0-only
// Real OCCT + actual worker dispatcher; local message transport only.
import {expect,it,vi} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel,type G1SupportCandidates,type G1PlaneResult,type Preview} from '../editorKernel'
import type {Net} from '../brep'
import type {SurfaceWorkerPayload} from '../workerClient'

it('keeps active planar and cylindrical worker sessions after isolated replay/restore rejects',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>()
  const host={onmessage:null as ((event:MessageEvent)=>void)|null,
    postMessage(reply:{id:number;result?:unknown;error?:string}){
      const waiter=pending.get(reply.id)!;pending.delete(reply.id)
      if(reply.error)waiter.reject(new Error(reply.error));else waiter.resolve(reply.result)
    }}
  vi.stubGlobal('self',host)
  let serial=0
  const ask=<T>(request:SurfaceWorkerPayload):Promise<T>=>new Promise((resolve,reject)=>{
    const id=++serial;pending.set(id,{resolve:resolve as (value:unknown)=>void,reject})
    host.onmessage!({data:{...request,id}} as MessageEvent)
  })
  const rectangle=(x:number)=>{
    const points=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
    const edges=points.map((a,i)=>k.makeLineEdge(a,points[(i+1)%4]));owned.push(...edges)
    const wire=k.makeWire(edges);owned.push(wire)
    const face=k.makeFace(wire);owned.push(face);return face
  }
  try{
    await import('../editor.worker')
    const shell=k.sew([rectangle(0),rectangle(10)],1e-7);owned.push(shell)
    const step=k.exportStep(shell),cylinder=k.makeCylinder(10,20);owned.push(cylinder)
    for(const action of ['replayRecipe','restoreRecipe'] as const){
      await ask({action:'open',step})
      const selection={face:0,refinements:[]},net=await ask<Net>({action:'select',face:0})
      const {candidates:[choice]}=await ask<G1SupportCandidates>({action:'g1SupportCandidates'})
      const before=await ask<Preview>({action:'evaluate',net,continuity:'G0',selection})
      const witness=await ask({action:'finalFaceWitness',previewRevision:before.previewRevision!})
      await expect(ask({action,step,recipe:null,bodyId:'invalid-recipe'})).rejects.toThrow()
      expect(await ask({action:'finalFaceWitness',previewRevision:before.previewRevision!})).toEqual(witness)
      // No reselect is allowed: original stamp and worker selection must survive.
      const proposal=await ask<G1PlaneResult>({action:'proposeG1PlaneTangency',net,choice,selection})
        .then(value=>({value,error:null}),error=>({value:null,error:String(error)}))
      expect.soft(proposal.error,`${action} must retain the worker planar selection key`).toBeNull()
      if(proposal.value){expect(proposal.value.stamp).toEqual(choice.stamp);expect(proposal.value.revisions.preview).toBe(before.previewRevision)}
      await ask({action:'open',step:k.exportStep(cylinder)})
      const cylinderFace=editor.infos.find(f=>f.experimentalCylinder)!.index
      const prepared=await ask<{session:number;net:Net}>({action:'prepareCylinder',face:cylinderFace})
      const shown=await ask<{kind:string}>({action:'previewCylinder',session:prepared.session,net:prepared.net})
      expect(shown.kind).toBe('provisional')
      await expect(ask({action,step,recipe:null,bodyId:'invalid-recipe'})).rejects.toThrow()
      const again=await ask<{kind:string}>({action:'previewCylinder',session:prepared.session,net:prepared.net})
        .then(value=>({value,error:null}),error=>({value:null,error:String(error)}))
      expect.soft(again.error,`${action} must retain the active cylinder session`).toBeNull()
      if(again.value)expect(again.value.kind).toBe('provisional')
    }
  }finally{
    vi.unstubAllGlobals();load.mockRestore();owned.forEach(h=>k.release(h));editor.dispose()
  }
},60000)

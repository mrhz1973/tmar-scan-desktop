// SPDX-License-Identifier: AGPL-3.0-only
// Actual Draft, dispatcher and OCCT. Only transport (and one malformed reply) is local.
import {expect,it,vi} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel,type FaceInfo,type G1SupportCandidates,type RecipeRestoreResult} from '../editorKernel'
import type {Request} from '../editor.worker'
import {boundaryLocked,type Net} from '../brep'
import {SurfaceRuntime} from '../surfaceRuntime'
import {SurfaceDraft} from '../surfaceDraft'

it('persists a constrained draft through the real worker, restores G1 history behavior and fails closed on an invalid restore reply',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor),sent:Request[]=[]
  let runtime:SurfaceRuntime|undefined,draft:SurfaceDraft|undefined,corruptRestore=false
  const actions=new Map<number,string>()
  const client={onmessage:null as ((event:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
    postMessage(request:Request){const copy=structuredClone(request);sent.push(copy);actions.set(copy.id,copy.action);host.onmessage!({data:copy} as MessageEvent<Request>)},terminate(){}}
  const host={onmessage:null as ((event:MessageEvent<Request>)=>void)|null,
    postMessage(reply:{id:number;result?:unknown;error?:string}){
      const copy=structuredClone(reply)
      if(corruptRestore&&actions.get(reply.id)==='restoreRecipe'&&copy.result){
        corruptRestore=false
        const result=copy.result as RecipeRestoreResult
        result.preview.valid=false
      }
      client.onmessage?.({data:copy} as MessageEvent)
    }}
  const rectangle=(x:number)=>{
    const points=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
    const edges=points.map((a,i)=>k.makeLineEdge(a,points[(i+1)%4]));owned.push(...edges)
    const wire=k.makeWire(edges);owned.push(wire)
    const face=k.makeFace(wire);owned.push(face);return face
  }
  const settled=()=>vi.waitFor(()=>{
    const s=draft!.getSnapshot();expect(s.error).toBe('');expect(s.calculating).toBe(false)
    expect(s.validNet).toBe(s.net);expect(s.previewStale).toBe(false);expect(s.preview?.valid).toBe(true)
  },{timeout:10000,interval:20})
  try{
    const shell=k.sew([rectangle(0),rectangle(10)],1e-7);owned.push(shell)
    const step=k.exportStep(shell)
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker);draft=new SurfaceDraft(runtime)
    const opened=await runtime.worker.ask<{faces:FaceInfo[]}>({action:'open',step})
    const face=opened.faces.findIndex(f=>!f.reason),net=await runtime.worker.ask<Net>({action:'select',face})
    const {candidates:[choice]}=await runtime.worker.ask<G1SupportCandidates>({action:'g1SupportCandidates'})
    const u=choice.side==='uMin'?1:choice.side==='uMax'?net.nu-2:Math.floor(net.nu/2)
    const v=choice.side==='vMin'?1:choice.side==='vMax'?net.nv-2:Math.floor(net.nv/2)
    const inner=u*net.nv+v,base=structuredClone(net);base.poles[inner][2]+=.2
    draft.install(base,{face,originalNet:net,continuity:'G0'});await settled()
    await draft.applyPlaneTangency(choice)
    const accepted=draft.getSnapshot(),constraint=accepted.planeTangency!
    expect(constraint).not.toBeNull()
    const free=net.poles.findIndex((_,id)=>!boundaryLocked(net,id,'G1'))
    expect(free).toBeGreaterThanOrEqual(0)
    const moved=structuredClone(accepted.net!);moved.poles[free][2]+=.08
    draft.preview(moved);await settled();draft.commit()
    const beforeSave=draft.getSnapshot(),witness=editor.finalFaceWitness(beforeSave.preview!.previewRevision!)
    const recipe=await draft.createRecipe('draft-v5-body')
    expect(recipe.version).toBe(5)
    expect(sent.at(-1)).toMatchObject({action:'createRecipe',constraintId:constraint.constraintId,bodyId:'draft-v5-body'})
    expect(draft.getSnapshot().net).toBe(beforeSave.net)
    expect(editor.finalFaceWitness(beforeSave.preview!.previewRevision!)).toEqual(witness)
    const persisted=JSON.parse(JSON.stringify(recipe))
    const restored=await draft.restoreRecipe(step,persisted,'draft-v5-body'),state=draft.getSnapshot()
    expect(state.net).toEqual(moved);expect(state.validNet).toBe(state.net)
    expect(state.planeTangency?.constraintId).toBe(restored.planeTangency!.constraintId)
    expect(state.planeTangency?.constraintId).not.toBe(constraint.constraintId)
    expect(state.planeTangency?.baseNet).toEqual(base)
    expect(state.planeTangency?.referenceNet).toEqual(accepted.net)
    expect(state.canUndo).toBe(false);expect(state.canRedo).toBe(false)
    // Caller owns the result; mutating it must not affect the installed draft.
    restored.net.poles[free][2]+=99
    expect(draft.getSnapshot().net).toEqual(moved)
    const changed=structuredClone(state.net!);changed.poles[free][2]+=.04
    draft.preview(changed);await settled();draft.commit()
    expect(draft.undo()).toBe(true);await settled();expect(draft.getSnapshot().net).toEqual(moved)
    expect(draft.redo()).toBe(true);await settled();expect(draft.getSnapshot().net).toEqual(changed)
    expect(draft.getSnapshot().planeTangency?.constraintId).toBe(state.planeTangency!.constraintId)
    const recent=sent.filter(r=>r.action==='evaluateG1PlaneTangency')
    expect(recent.length).toBeGreaterThanOrEqual(4)
    expect(recent.at(-1)).toMatchObject({constraintId:state.planeTangency!.constraintId})
    const illegal=structuredClone(changed);illegal.poles[inner][2]+=.1
    expect(()=>draft!.preview(illegal)).toThrow()
    expect(draft.getSnapshot().net).toEqual(changed)
    const stable=draft.getSnapshot(),stableWitness=editor.finalFaceWitness(stable.preview!.previewRevision!)
    await expect(draft.restoreRecipe(step,{...persisted,source:{...persisted.source,bodyId:'wrong'}},'draft-v5-body')).rejects.toThrow()
    expect(draft.getSnapshot().net).toEqual(stable.net)
    expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    expect(editor.finalFaceWitness(stable.preview!.previewRevision!)).toEqual(stableWitness)
    corruptRestore=true
    await expect(draft.restoreRecipe(step,persisted,'draft-v5-body')).rejects.toThrow()
    const invalid=draft.getSnapshot()
    expect(invalid.net).toEqual(stable.net);expect(invalid.validNet).toBeNull();expect(invalid.preview).toBeNull()
    expect(()=>draft!.preview(changed)).toThrow()
    await expect(draft.evaluateForExport()).rejects.toThrow()
    await draft.restoreRecipe(step,persisted,'draft-v5-body')
    expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    expect(draft.getSnapshot().planeTangency).not.toBeNull()
    const final=await draft.evaluateForExport()
    expect(final.valid).toBe(true);expect(final.step).toContain('ISO-10303-21')
    expect(sent.at(-1)).toMatchObject({action:'evaluateG1PlaneTangency',exportStep:true})
    expect(load).toHaveBeenCalledTimes(1)
  }finally{draft?.dispose();runtime?.dispose();vi.unstubAllGlobals();load.mockRestore();owned.forEach(h=>k.release(h));editor.dispose()}
},60000)

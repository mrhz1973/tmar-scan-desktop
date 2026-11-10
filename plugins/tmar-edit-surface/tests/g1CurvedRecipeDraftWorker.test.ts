// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial fixture for future variable-normal support work; no GUI.
import {expect,it,vi} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel,type FaceInfo,type G1CurvedSupportCandidates,type DraftAnchor,type CurvedRecipeRestoreResult} from '../editorKernel'
import type {Request} from '../editor.worker'
import {SurfaceRuntime} from '../surfaceRuntime'
import {SurfaceDraft} from '../surfaceDraft'
import {readCurvedRecipe,type SurfaceEditRecipeV6} from '../recipe'
import {replaceSurface,surfaceTable,boundaryLocked,type Net,type Point} from '../brep'
import {refineClampedNet} from '../refineClampedNet'

async function fixture(){
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const own=(h:ShapeHandle)=>{owned.push(h);return h}
  const build=(start:number,curved:boolean)=>{
    const p=[{x:start,y:0,z:0},{x:start+10,y:0,z:0},{x:start+10,y:10,z:0},{x:start,y:10,z:0}]
    const seedWire=own(k.makeWire(p.map((a,i)=>own(k.makeLineEdge(a,p[(i+1)%4])))))
    const seed=own(k.makeFace(seedWire)),text=k.toBREP(seed),record=surfaceTable(text).find(r=>r.kind===1)!,b=k.uvBounds(seed)
    const poles:Point[]=[]
    // Cubic V basis with one midpoint knot; q and dq vanish at both ends.
    const q=[0,0,.2,0,0],greville=[0,1/6,.5,5/6,1]
    for(let u=0;u<4;u++)for(let v=0;v<5;v++)poles.push([start+10*u/3,10*greville[v],curved?(10*u/3)*q[v]:0])
    const seedNet:Net={nu:4,nv:5,du:3,dv:3,poles,weights:poles.map(()=>1),rational:[0,0],ku:[b.uMin,b.uMax],kv:[b.vMin,(b.vMin+b.vMax)/2,b.vMax],mu:[4,4],mv:[4,1,4]}
    const net=refineClampedNet(seedNet,[{axis:'U',value:(b.uMin+b.uMax)/2,count:1}])
    const support=own(k.fromBREP(replaceSurface(text,record,net)))
    const border=(ids:number[],axis:'u'|'v')=>{
      const points=ids.map(i=>net.poles[i]),a=points[0],z=points.at(-1)!,d=z.map((x,i)=>x-a[i]),length=Math.hypot(...d)
      const straight=points.every(p=>Math.hypot(...p.map((x,i)=>x-a[i]-(d[i]/length)*p.reduce((sum,y,j)=>sum+(y-a[j])*d[j]/length,0)))<1e-9)
      return straight?own(k.makeLineEdge({x:a[0],y:a[1],z:a[2]},{x:z[0],y:z[1],z:z[2]})):
        own(k.makeBSplineEdge(points.flat(),ids.map(i=>net.weights[i]),axis==='u'?net.ku:net.kv,axis==='u'?net.mu:net.mv,3))
    }
    const wire=own(k.makeWire([border([0,5,10,15,20],'u'),border([20,21,22,23,24],'v'),border([24,19,14,9,4],'u'),border([4,3,2,1,0],'v')]))
    const face=own(k.fixShape(own(k.makeFaceOnSurface(support,wire))))
    return {face,net}
  }
  try{
    const selected=build(0,false),support=build(10,true),third=build(-10,false),shell=own(k.sew([selected.face,support.face,third.face],1e-7)),step=k.exportStep(shell)
    return {editor,k,selected,support,shell,step,dispose:()=>{owned.reverse().forEach(h=>k.release(h));editor.dispose()}}
  }catch(error){owned.reverse().forEach(h=>k.release(h));editor.dispose();throw error}
}

// Actual Draft, queue, dispatcher and native OCCT; only transport and explicit
// fault injection are local. No workspace persistence or GUI claim follows.
it('saves/replays/restores an explicit v6 curved draft and fails closed on corrupt or late restore replies',async()=>{
  const f=await fixture(),{editor,k}=f,load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  let runtime:SurfaceRuntime|undefined,draft:SurfaceDraft|undefined,corruptRestore:'preview'|'kind'|'confirmation'|null=null,corruptCreate=false,holdAction:string|null=null
  const injected={preview:0,kind:0,confirmation:0}
  const sent:Request[]=[],actions=new Map<number,string>(),held:{id:number;result?:unknown;error?:string}[]=[]
  const client={onmessage:null as ((event:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,terminate:vi.fn(),
    postMessage(request:Request){const copy=structuredClone(request);sent.push(copy);actions.set(copy.id,copy.action);host.onmessage!({data:copy} as MessageEvent<Request>)}}
  const host={onmessage:null as ((event:MessageEvent<Request>)=>void)|null,
    postMessage(reply:{id:number;result?:unknown;error?:string}){
      const copy=structuredClone(reply),action=actions.get(reply.id)
      if((corruptRestore==='preview'||corruptRestore==='kind')&&action==='restoreCurvedRecipe'&&copy.result){
        injected[corruptRestore]++
        const result=copy.result as CurvedRecipeRestoreResult
        if(corruptRestore==='preview')result.preview.valid=false
        else(result.curvedTangency as unknown as {kind:string}).kind='plane'
        corruptRestore=null
      }
      if(corruptRestore==='confirmation'&&action==='evaluateG1CurvedTangency'&&copy.result){
        injected.confirmation++
        ;(copy.result as {validation:{globalG1Certified:boolean}}).validation.globalG1Certified=true
        corruptRestore=null
      }
      if(corruptCreate&&action==='createCurvedRecipe'&&copy.result){
        corruptCreate=false
        const recipe=copy.result as SurfaceEditRecipeV6,edit=recipe.edits.find(e=>e.index===12)!
        edit.point[2]=Number(edit.point[2])+.01
      }
      if(action===holdAction){held.push(copy);return}
      client.onmessage?.({data:copy} as MessageEvent)
    }}
  const ready=()=>vi.waitFor(()=>{
    const s=draft!.getSnapshot();expect(s.error).toBe('');expect(s.net).not.toBeNull();expect(s.calculating).toBe(false)
    expect(s.validNet).toBe(s.net);expect(s.previewStale).toBe(false);expect(s.preview?.valid).toBe(true)
  },{timeout:10000,interval:20})
  const release=()=>{holdAction=null;const reply=held.shift();expect(reply).toBeDefined();client.onmessage?.({data:reply} as MessageEvent)}
  const bodyId='curved-v6-draft'
  try{
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker);draft=new SurfaceDraft(runtime)
    const ask=runtime.worker.ask.bind(runtime.worker)
    await ask<{faces:FaceInfo[]}>({action:'open',step:f.step})
    const shape=k.importStep(f.step),faces=k.getSubShapes(shape,'face');let face=-1,support=-1
    try{faces.forEach((item,index)=>{const b=k.uvBounds(item),p=k.pointOnSurface(item,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      if(p.x>0&&p.x<10)face=index;if(p.x>10&&p.z>.1)support=index
    })}finally{faces.forEach(h=>k.release(h));k.release(shape)}
    const net=await ask<Net>({action:'select',face})
    expect(net).toMatchObject({nu:5,nv:5});expect(boundaryLocked(net,12,'G1')).toBe(false)
    draft.install(net,{face,originalNet:net,continuity:'G0'});await ready()
    const initialRevision=draft.getSnapshot().preview!.previewRevision!,picked=await ask<{anchor:DraftAnchor;at:Point;normal:Point}>({action:'notePick',point:net.poles[12],previewRevision:initialRevision})
    const choices=await ask<G1CurvedSupportCandidates>({action:'g1CurvedSupportCandidates'}),choice=choices.candidates.find(c=>c.supportFaceIndex===support)!
    await draft.applyCurvedTangency(choice)
    const accepted=draft.getSnapshot(),initialId=accepted.curvedTangency!.constraintId
    const changed=structuredClone(accepted.net!);changed.poles[12][2]+=.08
    draft.preview(changed);await ready();draft.commit()
    const savedState=draft.getSnapshot(),savedRevision=savedState.preview!.previewRevision!
    const witness=await ask({action:'finalFaceWitness',previewRevision:savedRevision}),pin=await ask<{at:Point;normal:Point}>({action:'noteResolve',anchor:picked.anchor,previewRevision:savedRevision})
    const recipe=readCurvedRecipe(await draft.createCurvedRecipe(bodyId)),persisted=JSON.parse(JSON.stringify(recipe))
    expect(recipe.version).toBe(6)
    expect(sent.at(-1)).toMatchObject({action:'createCurvedRecipe',constraintId:initialId,selection:{face,refinements:[]}})
    expect(draft.getSnapshot().net).toBe(savedState.net)
    expect(await ask({action:'finalFaceWitness',previewRevision:savedRevision})).toEqual(witness)
    await expect(draft.createRecipe(bodyId)).rejects.toThrow()
    await expect(draft.restoreRecipe(f.step,persisted,bodyId)).rejects.toThrow()
    await expect(ask({action:'restoreRecipe',step:f.step,recipe:persisted,bodyId})).rejects.toThrow()
    const replay=await ask<{valid:boolean;step:string}>({action:'replayCurvedRecipe',step:f.step,recipe:persisted,bodyId})
    expect(replay.valid).toBe(true)
    const replayShape=k.importStep(replay.step);try{expect(k.isValid(replayShape)).toBe(true)}finally{k.release(replayShape)}
    expect(await ask({action:'finalFaceWitness',previewRevision:savedRevision})).toEqual(witness)
    expect(await ask({action:'noteResolve',anchor:picked.anchor,previewRevision:savedRevision})).toEqual(pin)
    const restored=await draft.restoreCurvedRecipe(f.step,persisted,bodyId),state=draft.getSnapshot(),id=state.curvedTangency!.constraintId
    expect(state.net).toEqual(changed);expect(state.validNet).toBe(state.net)
    expect(state.curvedTangency).not.toBeNull();expect(state.planeTangency).toBeNull()
    expect(id).not.toBe(initialId);expect(id).toBe(restored.curvedTangency.constraintId)
    expect(state.canUndo).toBe(false);expect(state.canRedo).toBe(false)
    expect(state.curvedTangency!.baseNet).toEqual(net);expect(state.curvedTangency!.referenceNet).toEqual(accepted.net)
    restored.net.poles[12][2]+=99;expect(draft.getSnapshot().net).toEqual(changed)
    await expect(ask({action:'noteResolve',anchor:picked.anchor,previewRevision:state.preview!.previewRevision!})).rejects.toThrow()
    const newPick=await ask<{anchor:DraftAnchor;at:Point;normal:Point}>({action:'notePick',point:pin.at,previewRevision:state.preview!.previewRevision!})
    expect(newPick.anchor.selectionRevision).not.toBe(picked.anchor.selectionRevision)
    const later=structuredClone(state.net!);later.poles[12][2]+=.04
    draft.preview(later);await ready();draft.commit()
    expect(draft.undo()).toBe(true);await ready();expect(draft.getSnapshot().net).toEqual(changed)
    expect(draft.redo()).toBe(true);await ready();expect(draft.getSnapshot().net).toEqual(later)
    expect(draft.getSnapshot().curvedTangency?.constraintId).toBe(id)
    const stable=draft.getSnapshot(),stableWitness=await ask({action:'finalFaceWitness',previewRevision:stable.preview!.previewRevision!})
    corruptCreate=true
    await expect(draft.createCurvedRecipe(bodyId)).rejects.toThrow()
    expect(draft.getSnapshot().net).toBe(stable.net)
    expect(await ask({action:'finalFaceWitness',previewRevision:stable.preview!.previewRevision!})).toEqual(stableWitness)
    const bad=structuredClone(persisted);bad.curvedTangency.supportNetSha256='0'.repeat(64)
    await expect(draft.restoreCurvedRecipe(f.step,bad,bodyId)).rejects.toThrow()
    expect(draft.getSnapshot().net).toBe(stable.net);expect(draft.getSnapshot().validNet).toBe(stable.net)
    expect(await ask({action:'finalFaceWitness',previewRevision:stable.preview!.previewRevision!})).toEqual(stableWitness)
    const fault=vi.spyOn(k,'importStep').mockImplementationOnce(()=>{throw Error('real restore import fault')})
    try{await expect(draft.restoreCurvedRecipe(f.step,persisted,bodyId)).rejects.toThrow('real restore import fault')}finally{fault.mockRestore()}
    expect(draft.getSnapshot().net).toBe(stable.net)
    expect(await ask({action:'finalFaceWitness',previewRevision:stable.preview!.previewRevision!})).toEqual(stableWitness)
    for(const mode of ['preview','kind','confirmation'] as const){
      const old=draft.getSnapshot(),oldFrame=runtime.history.current;corruptRestore=mode
      await expect(draft.restoreCurvedRecipe(f.step,persisted,bodyId)).rejects.toThrow()
      expect(injected[mode]).toBe(1)
      expect(draft.getSnapshot().net).toBe(old.net)
      expect(runtime.history.current).toBe(oldFrame)
      expect(draft.getSnapshot().preview).toBeNull();expect(draft.getSnapshot().validNet).toBeNull()
      expect(()=>draft!.preview(later)).toThrow(/non verificabile/)
      await expect(draft.evaluateForExport()).rejects.toThrow()
      await expect(draft.createCurvedRecipe(bodyId)).rejects.toThrow()
      await draft.restoreCurvedRecipe(f.step,persisted,bodyId);await ready()
    }
    const output=await draft.evaluateForExport()
    expect(output.valid).toBe(true);expect(output.step).toContain('ISO-10303-21')
    expect(sent.at(-1)).toMatchObject({action:'evaluateG1CurvedTangency',exportStep:true})
    holdAction='restoreCurvedRecipe'
    const pending=draft.restoreCurvedRecipe(f.step,persisted,bodyId),closed=expect(pending).rejects.toThrow()
    await vi.waitFor(()=>expect(held).toHaveLength(1),{timeout:10000,interval:20})
    expect(()=>draft!.preview(later)).toThrow()
    draft.dispose();release();await closed
    expect(draft.getSnapshot()).toMatchObject({net:null,preview:null,validNet:null,curvedTangency:null})
    expect(runtime.history.current).toBeUndefined()
    expect(load).toHaveBeenCalledTimes(1)
  }finally{draft?.dispose();runtime?.dispose();vi.unstubAllGlobals();load.mockRestore();f.dispose()}
},60000)

// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial fixture for future variable-normal support work; no GUI.
import {expect,it,vi} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel,type FaceInfo,type G1CurvedSupportCandidates,type DraftAnchor} from '../editorKernel'
import type {Request} from '../editor.worker'
import {SurfaceRuntime} from '../surfaceRuntime'
import {SurfaceDraft} from '../surfaceDraft'
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

// The transport is local and cloned; all Draft, queue, worker dispatch and CAD
// code is real. This does not exercise the workspace UI or persistent notes.
it('carries a curved G1 draft through publication, interior edit, history, note witnesses and races/disposal while refusing unsupported recipes',async()=>{
  const f=await fixture(),{editor,k}=f
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor),sent:Request[]=[],actions=new Map<number,string>()
  let runtime:SurfaceRuntime|undefined,draft:SurfaceDraft|undefined,holdAction:string|null=null
  const held:{id:number;result?:unknown;error?:string}[]=[]
  const client={onmessage:null as ((event:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,terminate:vi.fn(),
    postMessage(request:Request){const copy=structuredClone(request);sent.push(copy);actions.set(copy.id,copy.action);host.onmessage!({data:copy} as MessageEvent<Request>)}}
  const host={onmessage:null as ((event:MessageEvent<Request>)=>void)|null,
    postMessage(reply:{id:number;result?:unknown;error?:string}){
      const copy=structuredClone(reply)
      if(actions.get(reply.id)===holdAction){held.push(copy);return}
      client.onmessage?.({data:copy} as MessageEvent)
    }}
  const settled=()=>vi.waitFor(()=>{
    const state=draft!.getSnapshot();expect(state.net).not.toBeNull();expect(state.calculating).toBe(false)
    expect(state.error).toBe('');expect(state.validNet).toBe(state.net);expect(state.preview?.valid).toBe(true);expect(state.previewStale).toBe(false)
  },{timeout:10000,interval:20})
  const release=()=>{holdAction=null;const reply=held.shift();expect(reply).toBeDefined();client.onmessage?.({data:reply} as MessageEvent)}
  try{
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker);draft=new SurfaceDraft(runtime)
    const ask=runtime.worker.ask.bind(runtime.worker)
    await ask<{faces:FaceInfo[]}>({action:'open',step:f.step})
    const shape=k.importStep(f.step),faces=k.getSubShapes(shape,'face');let face=-1,support=-1
    try{faces.forEach((item,index)=>{const b=k.uvBounds(item),p=k.pointOnSurface(item,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      if(p.x>0&&p.x<10)face=index;if(p.x>10&&p.z>.1)support=index
    })}finally{faces.forEach(h=>k.release(h));k.release(shape)}
    expect(face).toBeGreaterThanOrEqual(0);expect(support).toBeGreaterThanOrEqual(0)
    const net=await ask<Net>({action:'select',face})
    expect(net).toMatchObject({nu:5,nv:5});expect(boundaryLocked(net,12,'G1')).toBe(false)
    draft.install(net,{face,originalNet:net,continuity:'G0'});await settled()
    const choices=await ask<G1CurvedSupportCandidates>({action:'g1CurvedSupportCandidates'}),choice=choices.candidates.find(c=>c.supportFaceIndex===support)!
    expect(choice).toBeDefined()
    const before=draft.getSnapshot(),picked=await ask<{anchor:DraftAnchor;at:Point;normal:Point}>({action:'notePick',point:net.poles[12],previewRevision:before.preview!.previewRevision!})
    await draft.applyCurvedTangency(choice)
    const published=draft.getSnapshot(),constraint=published.curvedTangency!
    expect(constraint.kind).toBe('compatible-bspline');expect(published.planeTangency).toBeNull()
    expect(published.validNet).toBe(published.net);expect(published.net!.poles[17][2]).toBeLessThan(-.3)
    expect(Object.isFrozen(constraint.referenceNet.poles[17])).toBe(true)
    expect(Object.isFrozen(constraint.choice.stamp)).toBe(true)
    const initialPublishedRevision=published.preview!.previewRevision!
    expect(initialPublishedRevision).toBeGreaterThan(before.preview!.previewRevision!)
    const witness=await ask<{selectionRevision:number}>({action:'finalFaceWitness',previewRevision:initialPublishedRevision})
    expect(witness.selectionRevision).toBe(picked.anchor.selectionRevision)
    const acceptedPin=await ask<{at:Point;normal:Point}>({action:'noteResolve',anchor:picked.anchor,previewRevision:initialPublishedRevision})
    // Undo/Redo the G1 operation itself, then edit inside its preserved ring.
    expect(draft.undo()).toBe(true);await settled()
    expect(draft.getSnapshot().curvedTangency).toBeNull();expect(draft.getSnapshot().net).toEqual(net)
    expect(draft.redo()).toBe(true);await settled()
    expect(draft.getSnapshot().curvedTangency?.constraintId).toBe(constraint.constraintId)
    const changed=structuredClone(draft.getSnapshot().net!);changed.poles[12][2]+=.08
    draft.preview(changed);expect(draft.getSnapshot().validNet).toBeNull();await settled();draft.commit()
    const edited=draft.getSnapshot(),resolved=await ask<{at:Point;normal:Point}>({action:'noteResolve',anchor:picked.anchor,previewRevision:edited.preview!.previewRevision!})
    expect(resolved.at[2]).toBeGreaterThan(acceptedPin.at[2]+.001)
    expect(edited.curvedTangency).toBe(published.curvedTangency)
    for(let id=0;id<net.poles.length;id++)if(boundaryLocked(net,id,'G1'))expect(edited.net!.poles[id]).toEqual(published.net!.poles[id])
    const illegal=structuredClone(changed);illegal.poles[17][2]+=.01
    expect(()=>draft!.preview(illegal)).toThrow()
    expect(draft.undo()).toBe(true);await settled();expect(draft.getSnapshot().net).toEqual(published.net)
    expect(draft.redo()).toBe(true);await settled();expect(draft.getSnapshot().net).toEqual(changed)
    const exported=await draft.evaluateForExport()
    expect(exported.valid).toBe(true);expect(exported.step).toContain('ISO-10303-21')
    expect(sent.at(-1)).toMatchObject({action:'evaluateG1CurvedTangency',constraintId:constraint.constraintId,exportStep:true})
    const output=k.importStep(exported.step);try{expect(k.isValid(output)).toBe(true)}finally{k.release(output)}
    expect(await ask({action:'noteResolve',anchor:picked.anchor,previewRevision:exported.previewRevision!})).toEqual(resolved)
    const requestCount=sent.length,saved=draft.getSnapshot()
    await expect(draft.createRecipe('curved-draft-body')).rejects.toThrow(/curv/i)
    expect(sent).toHaveLength(requestCount);expect(draft.getSnapshot().net).toBe(saved.net)
    expect(draft.getSnapshot().validNet).toBe(saved.net)
    // A held isolated response must not overwrite a newer local draft.
    draft.install(net,{face,originalNet:net,continuity:'G0'});await settled()
    holdAction='proposeG1CurvedTangency'
    const stale=draft.applyCurvedTangency(choice),staleRejected=expect(stale).rejects.toThrow()
    await vi.waitFor(()=>expect(held).toHaveLength(1),{timeout:10000,interval:20})
    const newer=structuredClone(net);newer.poles[12][2]+=.02
    draft.preview(newer);await settled();draft.commit()
    release();await staleRejected
    expect(draft.getSnapshot().net).toEqual(newer);expect(draft.getSnapshot().curvedTangency).toBeNull()
    expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    // Kernel publication has completed, but its held reply cannot revive a
    // disposed Draft or restore stale geometry/history through recovery.
    draft.install(net,{face,originalNet:net,continuity:'G0'});await settled()
    holdAction='publishG1CurvedTangency'
    const disposing=draft.applyCurvedTangency(choice),disposedRejected=expect(disposing).rejects.toThrow()
    await vi.waitFor(()=>expect(held).toHaveLength(1),{timeout:10000,interval:20})
    draft.dispose();release();await disposedRejected
    expect(draft.getSnapshot()).toMatchObject({net:null,preview:null,validNet:null,curvedTangency:null,canUndo:false,canRedo:false})
    expect(runtime.history.current).toBeUndefined()
    runtime.dispose();expect(client.terminate).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledTimes(1)
  }finally{draft?.dispose();runtime?.dispose();vi.unstubAllGlobals();load.mockRestore();f.dispose()}
},60000)

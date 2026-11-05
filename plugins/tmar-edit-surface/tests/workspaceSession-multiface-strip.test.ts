// SPDX-License-Identifier: AGPL-3.0-only
// Controller gestures + real CAD worker; no DOM, pointer picking or GUI qualification.
import {expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
import type {Request} from '../editor.worker'
import type {Point} from '../brep'
import {SurfaceRuntime} from '../surfaceRuntime'
import {createWorkspaceSurfaceSession,type WorkspaceSurfaceSession} from '../workspaceSession'

it('starts D on two-face shells, reopens three faces and retains valid geometry across pending/error/stale replies',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  let client:{onmessage:((event:MessageEvent)=>void)|null;postMessage:(request:Request)=>void;onerror:null;onmessageerror:null;terminate:()=>void}
  let held:Request|null=null,holdDuplicate=false,corruptDuplicate=false
  const actions=new Map<number,string>()
  const host={onmessage:null as ((event:MessageEvent<Request>)=>void)|null,
    postMessage(reply:{id:number;result?:unknown;error?:string}){
      const copy=structuredClone(reply)
      if(corruptDuplicate&&actions.get(reply.id)==='duplicateSheetEdge'&&copy.result){
        corruptDuplicate=false
        ;(copy.result as {preview:{faceMeshes:unknown[]}}).preview.faceMeshes.pop()
      }
      client.onmessage?.({data:copy} as MessageEvent)
    }}
  const sessions:WorkspaceSurfaceSession[]=[],runtimes:SurfaceRuntime[]=[]
  const rectangle=(x:number)=>{
    const p=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
    const edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%4]));owned.push(...edges)
    const wire=k.makeWire(edges);owned.push(wire)
    const face=k.makeFace(wire);owned.push(face);return face
  }
  const measure=(step:string)=>{
    const shape=k.importStep(step),faces=k.getSubShapes(shape,'face'),solids=k.getSubShapes(shape,'solid')
    try{
      let shared=0
      for(let a=0;a<faces.length;a++)for(let b=a+1;b<faces.length;b++){
        const edges=k.sharedEdges(faces[a],faces[b]);shared+=edges.length;edges.forEach(h=>k.release(h))
      }
      return {valid:k.isValid(shape),faces:faces.length,solids:solids.length,area:k.getSurfaceArea(shape),shared}
    }
    finally{faces.forEach(h=>k.release(h));solids.forEach(h=>k.release(h));k.release(shape)}
  }
  const waitReady=(session:WorkspaceSurfaceSession)=>vi.waitFor(()=>{
    expect(session.getSnapshot().validation.kind).toBe('valid')
    expect(session.getViewState().directStrip).not.toBeNull()
  },{timeout:10000,interval:20})
  const setup=async(step:string)=>{
    let sourceCurrent=true
    client={onmessage:null,onerror:null,onmessageerror:null,terminate(){},postMessage(request){
      const copy=structuredClone(request);actions.set(copy.id,copy.action)
      if(holdDuplicate&&copy.action==='duplicateSheetEdge'){held=copy;return}
      host.onmessage!({data:copy} as MessageEvent<Request>)
    }}
    const runtime=new SurfaceRuntime(()=>client as unknown as Worker);runtimes.push(runtime)
    const bytes=new TextEncoder().encode(step),hash=createHash('sha256').update(bytes).digest('hex')
    const context={apiVersion:1,sessionId:crypto.randomUUID(),source:{documentEpoch:'shell-doc',sourceEpoch:1,bodyId:1,bodyKey:'shell',buildVersion:1,kernelGeneration:1,frameRevision:1,stepSha256:hash,units:'mm',coordinateFrame:'part'},
      step:bytes,capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:new AbortController().signal,
      assertSourceCurrent:()=>{if(!sourceCurrent)throw Error('source changed')},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
    const session=await createWorkspaceSurfaceSession(context as never,(()=>({cancelGesture:()=>true,dispose(){}})) as never,{runtime,sha256:async data=>createHash('sha256').update(data).digest('hex')})
    sessions.push(session)
    const face=session.getPanelState().faces.find(f=>!f.reason)!.index
    await session.chooseFace(face);await waitReady(session)
    return {session,invalidate:()=>{sourceCurrent=false}}
  }
  const edgeAt=(paths:readonly (readonly Point[])[],x:number)=>paths.findIndex(path=>path.every(p=>Math.abs(p[0]-x)<1e-6&&Math.abs(p[2])<1e-6))
  try{
    vi.stubGlobal('self',host);await import('../editor.worker')
    const shell=k.sew([rectangle(0),rectangle(10)],1e-7);owned.push(shell)
    const source=k.exportStep(shell),first=await setup(source),s=first.session
    expect(s.getPanelState().faces).toHaveLength(2)
    const initial=s.getViewState().directStrip!
    expect(edgeAt(initial.paths,10)).toBe(-1) // shared seam is not a free edge
    const edge=edgeAt(initial.paths,20);expect(edge).toBeGreaterThanOrEqual(0)
    expect(s.beginDirectStripGesture(edge,initial.revision-1)).toBe(false)
    expect(s.beginDirectStripGesture(edge,initial.revision)).toBe(true)
    s.previewStripDelta([5,0,0]);await s.finishStripGesture([5,0,0])
    expect(s.getViewState().preview!.faceMeshes).toHaveLength(3)
    expect(s.getViewState().strip?.hasResult).toBe(true)
    const result=await s.exportStep(),three=measure(result.step)
    expect(three.valid).toBe(true);expect(three.faces).toBe(3);expect(three.solids).toBe(0);expect(three.area).toBeCloseTo(250,6)
    s.undo();expect(s.getViewState().preview!.faceMeshes).toHaveLength(2)
    s.redo();expect(s.getViewState().preview!.faceMeshes).toHaveLength(3)
    expect((await s.exportStep()).step).toBe(result.step)
    const last=s.getViewState().preview,paths=s.getViewState().strip!.paths
    const next=edgeAt(paths,25);expect(next).toBeGreaterThanOrEqual(0)
    // Hold only transport; pending guards must act before any native work starts.
    holdDuplicate=true;s.beginStripGesture(next)
    const pending=s.finishStripGesture([0,0,4]),rejected=expect(pending).rejects.toThrow('controlled refusal')
    expect(held).not.toBeNull();expect(s.getSnapshot().validation.kind).toBe('pending')
    expect(()=>s.undo()).toThrow();expect(()=>s.beginStripGesture(next)).toThrow()
    client.onmessage?.({data:{id:held!.id,error:'controlled refusal'}} as MessageEvent);held=null;holdDuplicate=false
    await rejected
    expect(s.getViewState().preview).toBe(last);expect(s.getViewState().strip!.paths).toEqual(paths)
    s.undo();s.redo() // clear operation error, retain the accepted strip
    corruptDuplicate=true;s.beginStripGesture(next)
    await expect(s.finishStripGesture([0,0,4])).rejects.toThrow()
    expect(s.getViewState().preview).toBe(last);expect(s.getViewState().preview!.faceMeshes).toHaveLength(3)
    s.undo();s.redo()
    holdDuplicate=true;s.beginStripGesture(next)
    const stale=s.finishStripGesture([0,0,4]),staleRejected=expect(stale).rejects.toThrow('source changed')
    first.invalidate();holdDuplicate=false
    host.onmessage!({data:held!} as MessageEvent<Request>);held=null
    await staleRejected
    expect(s.getViewState().preview).toBe(last)
    await s.dispose('cancelled')
    const second=await setup(result.step),r=second.session
    expect(r.getPanelState().faces).toHaveLength(3)
    const reopened=r.getViewState().directStrip!
    expect(edgeAt(reopened.paths,10)).toBe(-1)
    expect(edgeAt(reopened.paths,20)).toBe(-1) // second sewn seam is excluded too
    const outer=edgeAt(reopened.paths,25);expect(outer).toBeGreaterThanOrEqual(0)
    expect(r.beginDirectStripGesture(outer,reopened.revision)).toBe(true)
    await r.finishStripGesture([0,0,4])
    const final=measure((await r.exportStep()).step)
    expect(final.valid).toBe(true);expect(final.faces).toBe(4);expect(final.solids).toBe(0);expect(final.area).toBeCloseTo(290,6)
    expect(final.shared).toBe(3)
    r.undo();expect(r.getViewState().preview!.faceMeshes).toHaveLength(3)
    r.redo();expect(r.getViewState().preview!.faceMeshes).toHaveLength(4)
    expect(measure(source)).toMatchObject({valid:true,faces:2,solids:0})
    expect(measure(source).area).toBeCloseTo(200,6)
    expect(load).toHaveBeenCalledTimes(1)
  }finally{
    for(const session of sessions)await session.dispose('cancelled')
    for(const runtime of runtimes)runtime.dispose()
    vi.unstubAllGlobals();load.mockRestore();owned.forEach(h=>k.release(h));editor.dispose()
  }
},60000)


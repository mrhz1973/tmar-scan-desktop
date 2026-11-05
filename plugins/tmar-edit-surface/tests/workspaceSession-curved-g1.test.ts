// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial fixture for future variable-normal support work; no GUI.
import {expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import type {Request} from '../editor.worker'
import {SurfaceRuntime} from '../surfaceRuntime'
import {createWorkspaceSurfaceSession,type WorkspaceSurfaceSession} from '../workspaceSession'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
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
    const p=[{x:-10,y:0,z:0},{x:0,y:0,z:0},{x:0,y:10,z:0},{x:-10,y:10,z:0}]
    const planeEdges=p.map((a,i)=>own(k.makeLineEdge(a,p[(i+1)%4])))
    const third=own(k.makeFace(own(k.makeWire(planeEdges))))
    const selected=build(0,false),support=build(10,true),shell=own(k.sew([selected.face,support.face,third],1e-7)),step=k.exportStep(shell)
    return {editor,k,selected,support,shell,step,dispose:()=>{owned.reverse().forEach(h=>k.release(h));editor.dispose()}}
  }catch(error){owned.reverse().forEach(h=>k.release(h));editor.dispose();throw error}
}

it('connects the real curved draft to workspace notes/history and prepares an annotated CAD copy without claiming recipe persistence',async()=>{
  const f=await fixture(),{editor,k}=f,load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  let runtime:SurfaceRuntime|undefined,session:WorkspaceSurfaceSession|undefined
  const sent:Request[]=[]
  const client={onmessage:null as ((event:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,terminate:vi.fn(),
    postMessage(request:Request){const copy=structuredClone(request);sent.push(copy);host.onmessage!({data:copy} as MessageEvent<Request>)}}
  const host={onmessage:null as ((event:MessageEvent<Request>)=>void)|null,
    postMessage(reply:unknown){client.onmessage?.({data:structuredClone(reply)} as MessageEvent)}}
  const ready=()=>vi.waitFor(()=>{
    const p=session!.getPanelState(),s=session!.getSnapshot(),v=session!.getViewState()
    expect(s.validation.kind).toBe('valid');expect(p.busy).toBe(false);expect(p.calculating).toBe(false)
    expect(v.notePins).toHaveLength(p.notes.length)
    for(const note of p.notes)expect(note.revision).toBe(v.preview?.previewRevision)
  },{timeout:10000,interval:20})
  try{
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    const bytes=new TextEncoder().encode(f.step),hash=createHash('sha256').update(bytes).digest('hex')
    const binding={documentEpoch:'curved-qa-doc',sourceEpoch:1,bodyId:1,bodyKey:'curved-source',buildVersion:1,kernelGeneration:1,frameRevision:1,stepSha256:hash,units:'mm',coordinateFrame:'part'}
    const context={apiVersion:1,sessionId:'curved-workspace-qa',source:binding,step:bytes,
      capabilities:{apiVersion:1,enabled:true,annotationVersion:1,commitKinds:['cad-copy','annotated-cad-copy']},signal:new AbortController().signal,
      assertSourceCurrent(){},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
    session=await createWorkspaceSurfaceSession(context as never,(()=>({cancelGesture:()=>true,dispose(){}})) as never,{runtime,sha256:async data=>createHash('sha256').update(data).digest('hex')})
    const shape=k.importStep(f.step),faces=k.getSubShapes(shape,'face');let face=-1,support=-1
    try{faces.forEach((item,index)=>{const b=k.uvBounds(item),p=k.pointOnSurface(item,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      if(p.x>0&&p.x<10)face=index;if(p.x>10&&p.z>.1)support=index
    })}finally{faces.forEach(h=>k.release(h));k.release(shape)}
    await session.chooseFace(face);await ready()
    const sourceBefore=k.toBREP((editor as unknown as {source:ShapeHandle}).source),net=session.getPanelState().net!
    expect(net).toMatchObject({nu:5,nv:5});expect(boundaryLocked(net,12,'G1')).toBe(false)
    await session.loadG1Supports()
    const choices=session.getPanelState().g1Candidates
    expect(choices.some(c=>c.kind!=='compatible-bspline')).toBe(true)
    expect(choices.some(c=>c.kind==='compatible-bspline')).toBe(true)
    const choice=choices.find(c=>'kind'in c&&c.kind==='compatible-bspline'&&c.supportFaceIndex===support)!
    expect(choice).toBeDefined();expect(session.getPanelState().g1Choice).toBeNull()
    session.chooseG1Support(choice.id);expect(session.getPanelState().canApplyG1).toBe(true)
    await session.applyG1();await ready()
    expect(session.getPanelState()).toMatchObject({curvedTangencyActive:true,planeTangencyActive:false,canApplyG1:false,canBeginStrip:false,canRefineNet:false})
    const accepted=structuredClone(session.getPanelState().net!)
    expect(accepted.poles[17][2]).toBeLessThan(-.3)
    session.setStripes({orientation:'horizontal',width:3,color:'#5388b1'})
    session.setPlacingNote(true);await session.placeNote(net.poles[12])
    const id=session.getPanelState().notes[0].id
    session.setNoteText(id,'Nota sul raccordo G1 curvo');await ready()
    const originalNote=structuredClone(session.getPanelState().notes[0])
    expect(session.getPanelState().annotatedCopyAvailable).toBe(true)
    session.selectPoints([12],false);session.moveSelected(.08);await ready()
    const edited=structuredClone(session.getPanelState().net!),editedNote=structuredClone(session.getPanelState().notes[0])
    expect(edited.poles[12]).not.toEqual(accepted.poles[12])
    expect(editedNote.text).toBe(originalNote.text);expect(editedNote.id).toBe(originalNote.id)
    expect(Math.hypot(...editedNote.at.map((x,i)=>x-originalNote.at[i]))).toBeGreaterThan(.001)
    for(let i=0;i<net.poles.length;i++)if(boundaryLocked(net,i,'G1'))expect(edited.poles[i]).toEqual(accepted.poles[i])
    session.undo();await ready();expect(session.getPanelState().net).toEqual(accepted)
    session.redo();await ready();expect(session.getPanelState().net).toEqual(edited)
    expect(session.getPanelState().curvedTangencyActive).toBe(true)
    expect(session.getViewState().stripes).not.toBeNull()
    await expect(session.chooseFace(support)).rejects.toThrow(/note/)
    expect(session.getPanelState().notes[0].text).toBe(originalNote.text)
    const state=session.getSnapshot();if(state.validation.kind!=='valid')throw Error('Validated note draft expected')
    const ticket={annotationVersion:1,mode:'annotated-cad-copy',operationId:'curved-copy-qa',source:binding,stamp:state.validation.stamp,notesRevision:state.notesRevision}
    const release=session.freezeAnnotated(ticket as never)
    let packet:Awaited<ReturnType<WorkspaceSurfaceSession['prepareAnnotatedApply']>>
    try{packet=await session.prepareAnnotatedApply(ticket as never,new AbortController().signal)}finally{release()}
    expect(packet.kind).toBe('annotated-cad-copy');expect(packet.notes).toHaveLength(1)
    expect(packet.notes[0].text).toBe(originalNote.text)
    expect(packet.notes[0].target.kind).toBe('copy-face')
    expect(packet.notes[0].target.witnessKey).toBe(packet.witnesses[0].key)
    const copy=k.importStep(new TextDecoder().decode(packet.step)),copyFaces=k.getSubShapes(copy,'face')
    const original=k.importStep(f.step),originalFaces=k.getSubShapes(original,'face')
    try{
      expect(k.isValid(copy)).toBe(true);expect(copyFaces).toHaveLength(3)
      for(let index=0;index<3;index++)if(index!==face){
        const a=k.uvBounds(originalFaces[index]),b=k.uvBounds(copyFaces[index])
        for(const u of [0,.5,1])for(const v of [0,.5,1]){
          const p=k.pointOnSurface(originalFaces[index],a.uMin+u*(a.uMax-a.uMin),a.vMin+v*(a.vMax-a.vMin))
          const q=k.pointOnSurface(copyFaces[index],b.uMin+u*(b.uMax-b.uMin),b.vMin+v*(b.vMax-b.vMin))
          const n=k.surfaceNormal(originalFaces[index],a.uMin+u*(a.uMax-a.uMin),a.vMin+v*(a.vMax-a.vMin))
          const m=k.surfaceNormal(copyFaces[index],b.uMin+u*(b.uMax-b.uMin),b.vMin+v*(b.vMax-b.vMin))
          expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-8)
          expect(Math.hypot(n.x-m.x,n.y-m.y,n.z-m.z)).toBeLessThan(1e-8)
        }
      }
    }finally{originalFaces.forEach(h=>k.release(h));k.release(original);copyFaces.forEach(h=>k.release(h));k.release(copy)}
    const witness=k.fromBREP(packet.witnesses[0].brep)
    try{
      const [u,v]=packet.notes[0].target.sourceUV,p=k.pointOnSurface(witness,u,v),at=packet.notes[0].target.resolvedAt
      expect(Math.hypot(p.x-at[0],p.y-at[1],p.z-at[2])).toBeLessThan(1e-8)
    }finally{k.release(witness)}
    expect(k.toBREP((editor as unknown as {source:ShapeHandle}).source)).toBe(sourceBefore)
    expect(sent.some(r=>r.action==='publishG1CurvedTangency')).toBe(true)
    expect(sent.filter(r=>r.action==='evaluateG1CurvedTangency').length).toBeGreaterThanOrEqual(4)
    expect('recipe'in packet).toBe(false) // prepared CAD copy, not an editable feature-history recipe
    expect(load).toHaveBeenCalledTimes(1)
  }finally{await session?.dispose('cancelled');runtime?.dispose();vi.unstubAllGlobals();load.mockRestore();f.dispose()}
},60000)

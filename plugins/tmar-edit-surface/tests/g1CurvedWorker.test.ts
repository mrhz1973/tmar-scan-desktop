// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial fixture for future variable-normal support work; no GUI.
import {expect,it,vi} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel,type FaceInfo,type Preview,type G1CurvedResult,type G1PublishedCurvedResult,type G1CurvedSupportCandidates,type G1CurvedSupportGeometry} from '../editorKernel'
import type {Request} from '../editor.worker'
import {SurfaceRuntime} from '../surfaceRuntime'
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

it('dispatches curved G1 candidates/proposal/publication/evaluation with exact selection guards and ignores replies after client disposal',async()=>{
  const f=await fixture(),{editor,k}=f
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor),sent:Request[]=[],extra:ShapeHandle[]=[]
  let runtime:SurfaceRuntime|undefined,holdReplies=false
  const held:{id:number;result?:unknown;error?:string}[]=[]
  const client={onmessage:null as ((event:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,terminate:vi.fn(),
    postMessage(request:Request){const copy=structuredClone(request);sent.push(copy);host.onmessage!({data:copy} as MessageEvent<Request>)}}
  const host={onmessage:null as ((event:MessageEvent<Request>)=>void)|null,
    postMessage(reply:{id:number;result?:unknown;error?:string}){
      const copy=structuredClone(reply)
      if(holdReplies){held.push(copy);return}
      client.onmessage?.({data:copy} as MessageEvent)
    }}
  try{
    vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    const ask=runtime.worker.ask.bind(runtime.worker)
    const opened=await ask<{faces:FaceInfo[]}>({action:'open',step:f.step})
    expect(opened.faces).toHaveLength(3)
    const shape=k.importStep(f.step),faces=k.getSubShapes(shape,'face');let face=-1,support=-1
    try{faces.forEach((item,index)=>{const b=k.uvBounds(item),p=k.pointOnSurface(item,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      if(p.x>0&&p.x<10)face=index;if(p.x>10&&p.z>.1)support=index
    })}finally{faces.forEach(h=>k.release(h));k.release(shape)}
    expect(face).toBeGreaterThanOrEqual(0);expect(support).toBeGreaterThanOrEqual(0)
    const selection={face,refinements:[]},net=await ask<Net>({action:'select',face})
    expect(net).toMatchObject({nu:5,nv:5});expect(boundaryLocked(net,12,'G1')).toBe(false)
    const preview=await ask<Preview>({action:'evaluate',net,continuity:'G0',selection})
    const witness=await ask({action:'finalFaceWitness',previewRevision:preview.previewRevision!})
    const choices=await ask<G1CurvedSupportCandidates>({action:'g1CurvedSupportCandidates'}),choice=choices.candidates.find(c=>c.supportFaceIndex===support)!
    expect(choice).toBeDefined()
    const geometryRequest = {action:'g1CurvedSupportGeometry' as const, choice, selection, previewRevision:preview.previewRevision!}
    const sourceHandle = (editor as unknown as {source:ShapeHandle}).source
    const beforeGeometry = k.toBREP(sourceHandle)
    const geometry = await ask<G1CurvedSupportGeometry>(geometryRequest)
    expect(geometry.choice).toEqual(choice)
    expect(geometry.previewRevision).toBe(preview.previewRevision)
    const vertices = geometry.supportMesh.positions
    const xCoordinates = vertices.filter((_, i) => i % 3 === 0)
    expect(Math.min(...xCoordinates)).toBeCloseTo(10, 6)
    expect(Math.max(...xCoordinates)).toBeCloseTo(20, 6)
    expect(vertices.some((z, i) => i % 3 === 2 && z > .1)).toBe(true)
    const seam = [...geometry.seam].sort((a,b) => a[1]-b[1])
    expect(seam).toEqual([[expect.closeTo(10,8),expect.closeTo(0,8),expect.closeTo(0,8)],
      [expect.closeTo(10,8),expect.closeTo(10,8),expect.closeTo(0,8)]])
    expect(k.toBREP(sourceHandle)).toBe(beforeGeometry)
    expect(await ask({action:'finalFaceWitness',previewRevision:preview.previewRevision!})).toEqual(witness)
    await expect(ask({...geometryRequest,choice:{...choice,supportFaceIndex:face}})).rejects.toThrow(/scaduta o alterata/)
    await expect(ask({...geometryRequest,selection:{face:support,refinements:[]}})).rejects.toThrow(/scaduta/)

    const proposalRequest={action:'proposeG1CurvedTangency' as const,net,choice,selection,exportStep:true}
    const proposal=await ask<G1CurvedResult>(proposalRequest)
    expect(proposal.changedIndices).toEqual([17]);expect(proposal.preview.previewRevision).toBeUndefined()
    expect(proposal.step).toContain('ISO-10303-21')
    const validated=await ask<G1CurvedResult>({action:'validateG1CurvedTangency',baseNet:net,net:proposal.net,choice,selection})
    expect(validated.net).toEqual(proposal.net)
    expect(await ask({action:'finalFaceWitness',previewRevision:preview.previewRevision!})).toEqual(witness)
    const beforeSelect=sent.filter(r=>r.action==='select'||r.action==='selectRefined').length
    await expect(ask({...proposalRequest,selection:{face:support,refinements:[]}})).rejects.toThrow('scaduta')
    await expect(ask({...proposalRequest,selection:{face,refinements:[{axis:'U',value:0,count:1}]}})).rejects.toThrow('scaduta')
    await expect(ask({...proposalRequest,choice:{...choice,stamp:{...choice.stamp,faceIndex:support}}})).rejects.toThrow('scaduta')
    expect(sent.filter(r=>r.action==='select'||r.action==='selectRefined')).toHaveLength(beforeSelect)
    const publication={action:'publishG1CurvedTangency' as const,baseNet:net,net:proposal.net,choice,selection,exportStep:true}
    await expect(ask({...publication,selection:{face:support,refinements:[]}})).rejects.toThrow('scaduta')
    const published=await ask<G1PublishedCurvedResult>(publication)
    expect(published.constraintKind).toBe('compatible-bspline')
    expect(published.preview.previewRevision).toBe(preview.previewRevision!+1)
    await expect(ask(geometryRequest)).rejects.toThrow(/Anteprima cambiata/)
    expect((await ask<G1CurvedSupportGeometry>({...geometryRequest,previewRevision:published.preview.previewRevision})).seam).toEqual(geometry.seam)
    const publishedWitness=await ask({action:'finalFaceWitness',previewRevision:published.preview.previewRevision})
    const moved=structuredClone(published.net);moved.poles[12][2]+=.08
    const evaluation={action:'evaluateG1CurvedTangency' as const,constraintId:published.constraintId,net:moved,selection,exportStep:true}
    await expect(ask({...evaluation,selection:{face:support,refinements:[]}})).rejects.toThrow('scaduta')
    await expect(ask({action:'evaluateG1PlaneTangency',constraintId:published.constraintId,net:published.net,selection})).rejects.toThrow('scaduto')
    const protectedNet=structuredClone(published.net);protectedNet.poles[17][2]+=.1
    await expect(ask({...evaluation,net:protectedNet})).rejects.toThrow()
    expect(await ask({action:'finalFaceWitness',previewRevision:published.preview.previewRevision})).toEqual(publishedWitness)
    const edited=await ask<G1PublishedCurvedResult>(evaluation)
    expect(edited.net).toEqual(moved);expect(edited.constraintId).toBe(published.constraintId)
    const output=k.importStep(edited.step!);try{expect(k.isValid(output)).toBe(true)}finally{k.release(output)}
    // Actual worker queue serialization: a concurrently queued selection runs
    // after this isolated proposal. Its old response cannot authorize publish.
    const queuedProposal=ask<G1CurvedResult>(proposalRequest),queuedSelect=ask<Net>({action:'select',face})
    const [oldReply,newNet]=await Promise.all([queuedProposal,queuedSelect])
    expect(oldReply.net).toEqual(proposal.net)
    const refreshed=await ask<Preview>({action:'evaluate',net:newNet,continuity:'G0',selection})
    const refreshedWitness=await ask({action:'finalFaceWitness',previewRevision:refreshed.previewRevision!})
    await expect(ask(publication)).rejects.toThrow()
    await expect(ask(evaluation)).rejects.toThrow('scaduto')
    expect(await ask({action:'finalFaceWitness',previewRevision:refreshed.previewRevision!})).toEqual(refreshedWitness)
    const planar=(x:number)=>{
      const p=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
      const edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%4]));extra.push(...edges)
      const wire=k.makeWire(edges);extra.push(wire);const face=k.makeFace(wire);extra.push(face);return face
    }
    const planeShell=k.sew([planar(0),planar(10)],1e-7);extra.push(planeShell)
    await ask({action:'open',step:k.exportStep(planeShell)})
    const planeSelection={face:0,refinements:[]},planeNet=await ask<Net>({action:'select',face:0})
    const planeChoices=await ask<{candidates:Parameters<typeof editor.publishG1PlaneTangency>[0]['choice'][]}>({action:'g1SupportCandidates'})
    const plane=await ask<{constraintId:number}>({action:'publishG1PlaneTangency',baseNet:planeNet,net:planeNet,choice:planeChoices.candidates[0],selection:planeSelection})
    expect(plane.constraintId).not.toBe(published.constraintId)
    await expect(ask({...evaluation,constraintId:plane.constraintId,selection:planeSelection,net:planeNet})).rejects.toThrow('scaduto')
    const planeEdited=structuredClone(planeNet);planeEdited.poles[12][2]+=.05
    expect((await ask<{preview:Preview}>({action:'evaluateG1PlaneTangency',constraintId:plane.constraintId,net:planeEdited,selection:planeSelection})).preview.valid).toBe(true)
    const cylinder=k.makeCylinder(10,20);extra.push(cylinder)
    const cylinderOpened=await ask<{faces:FaceInfo[]}>({action:'open',step:k.exportStep(cylinder)})
    const cylinderFace=cylinderOpened.faces.find(f=>f.experimentalCylinder)!.index
    await ask({action:'prepareCylinder',face:cylinderFace})
    for(const request of [proposalRequest,publication,evaluation])await expect(ask(request)).rejects.toThrow('cilindrica')
    // Disposal below verifies only the real SurfaceWorkerClient transport.
    // A browser worker's actual termination is outside this local transport.
    await ask({action:'open',step:f.step});const finalNet=await ask<Net>({action:'select',face})
    await ask({action:'evaluate',net:finalNet,continuity:'G0',selection})
    const freshChoices=await ask<G1CurvedSupportCandidates>({action:'g1CurvedSupportCandidates'}),freshChoice=freshChoices.candidates.find(c=>c.supportFaceIndex===support)!
    holdReplies=true
    const pending=ask({action:'proposeG1CurvedTangency',net:finalNet,choice:freshChoice,selection}),disposed=expect(pending).rejects.toThrow()
    await vi.waitFor(()=>expect(held.length).toBeGreaterThan(0),{timeout:10000,interval:20})
    runtime.dispose();await disposed
    expect(client.terminate).toHaveBeenCalledOnce()
    const requestCount=sent.length
    holdReplies=false;for(const reply of held)client.onmessage?.({data:reply} as MessageEvent)
    await expect(ask({action:'g1CurvedSupportCandidates'})).rejects.toThrow()
    expect(sent).toHaveLength(requestCount)
    expect(load).toHaveBeenCalledTimes(1)
  }finally{runtime?.dispose();vi.unstubAllGlobals();load.mockRestore();extra.reverse().forEach(h=>k.release(h));f.dispose()}
},60000)

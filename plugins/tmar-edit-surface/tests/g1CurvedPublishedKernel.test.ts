// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial fixture for future variable-normal support work; no GUI.
import {describe,expect,it,vi} from 'vitest'
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
    const selected=build(0,false),support=build(10,true),third=build(-10,false),shell=own(k.sew([selected.face,support.face,third.face],1e-7)),step=k.exportStep(shell)
    return {editor,k,selected,support,shell,step,dispose:()=>{owned.reverse().forEach(h=>k.release(h));editor.dispose()}}
  }catch(error){owned.reverse().forEach(h=>k.release(h));editor.dispose();throw error}
}

async function prepare(){
  const f=await fixture(),{editor,k}=f
  try{
    const opened=editor.open(f.step),shape=k.importStep(f.step),faces=k.getSubShapes(shape,'face')
    let selected=-1,support=-1
    try{
      expect(faces).toHaveLength(3)
      faces.forEach((face,index)=>{const b=k.uvBounds(face),p=k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
        if(p.x>0&&p.x<10)selected=index
        if(p.x>10&&p.z>.1)support=index
      })
    }finally{faces.forEach(h=>k.release(h));k.release(shape)}
    expect(selected).toBeGreaterThanOrEqual(0);expect(support).toBeGreaterThanOrEqual(0)
    expect(opened.faces[selected].reason).toBeNull()
    const net=editor.select(selected),preview=editor.evaluate(net,'G0'),witness=editor.finalFaceWitness(preview.previewRevision)
    const anchor=editor.anchorFromPick(net.poles[7],preview.previewRevision).anchor
    const choices=await editor.g1CurvedSupportCandidates().catch(error=>{
      const shape=k.importStep(f.step),faces=k.getSubShapes(shape,'face')
      try{
        const text=k.toBREP(faces[selected])
        console.log('CURVED_KERNEL_FIXTURE_CANDIDATE_FAILURE',JSON.stringify({selected,support,pcurves:/^Curve2ds [\s\S]*?^Curves /m.exec(text)?.[0]}))
      }finally{faces.forEach(h=>k.release(h));k.release(shape)}
      throw error
    }),choice=choices.candidates.find(c=>c.supportFaceIndex===support)
    expect(choice).toBeDefined()
    return {...f,selected,support,net,preview,witness,anchor,choices,choice:choice!}
  }catch(error){f.dispose();throw error}
}
function geometry(k:Awaited<ReturnType<typeof SurfaceEditorKernel.load>>['kernel'],step:string){
  const shape=k.importStep(step),faces=k.getSubShapes(shape,'face'),solids=k.getSubShapes(shape,'solid')
  try{return {valid:k.isValid(shape),faceCount:faces.length,solidCount:solids.length,data:faces.map(face=>{
    const b=k.uvBounds(face),samples:number[][]=[]
    for(const s of [0,.25,.5,.75,1])for(const t of [0,.25,.5,.75,1]){
      const u=b.uMin+s*(b.uMax-b.uMin),v=b.vMin+t*(b.vMax-b.vMin),p=k.pointOnSurface(face,u,v),n=k.surfaceNormal(face,u,v)
      samples.push([p.x,p.y,p.z,n.x,n.y,n.z])
    }
    return {kind:k.surfaceType(face),samples}
  })}}
  finally{faces.forEach(h=>k.release(h));solids.forEach(h=>k.release(h));k.release(shape)}
}

async function publish(t:Awaited<ReturnType<typeof prepare>>,lockedPoles:number[]=[]){
  const proposal=await t.editor.proposeG1CurvedTangency({net:t.net,choice:t.choice,lockedPoles})
  return t.editor.publishG1CurvedTangency({baseNet:t.net,net:proposal.net,choice:t.choice,lockedPoles,exportStep:true})
}
const moved=(net:Net,id:number,delta=.08)=>{const copy=structuredClone(net);copy.poles[id][2]+=delta;return copy}

describe('published persistent kernel G1 on a compatible curved support',()=>{
  it('advances the CAD witness without invalidating UV anchors, permits interior edits and preserves the other two faces',async()=>{
    const t=await prepare(),{editor,k}=t
    try{
      expect(t.net).toMatchObject({nu:5,nv:5})
      expect(boundaryLocked(t.net,12,'G1')).toBe(false)
      const source=k.toBREP(t.shell),editorSource=k.toBREP((editor as unknown as {source:ShapeHandle}).source)
      const before=geometry(k,t.step),published=await publish(t)
      expect(published.constraintKind).toBe('compatible-bspline')
      expect(published.preview.previewRevision).toBe(t.preview.previewRevision+1)
      expect(published.revisions.anchorSelection).toBe(t.anchor.selectionRevision)
      expect(published.changedIndices).toEqual([17])
      expect(()=>editor.finalFaceWitness(t.preview.previewRevision)).toThrow()
      const witness=editor.finalFaceWitness(published.preview.previewRevision)
      expect(witness.selectionRevision).toBe(t.anchor.selectionRevision)
      const pin=editor.resolveAnchor(t.anchor,published.preview.previewRevision)
      const edited=moved(published.net,12),saved=structuredClone(edited)
      const evaluated=await editor.evaluateG1CurvedTangency({constraintId:published.constraintId,net:edited,exportStep:true})
      expect(evaluated.constraintId).toBe(published.constraintId)
      expect(evaluated.constraintKind).toBe('compatible-bspline')
      expect(evaluated.preview.previewRevision).toBe(published.preview.previewRevision+1)
      expect(evaluated.validation.globalG1Certified).toBe(false)
      expect(editor.resolveAnchor(t.anchor,evaluated.preview.previewRevision).at[2]).toBeGreaterThan(pin.at[2]+.001)
      expect(edited).toEqual(saved)
      const output=geometry(k,evaluated.step!)
      expect(output).toMatchObject({valid:true,faceCount:3,solidCount:0})
      for(let face=0;face<3;face++)if(face!==t.selected)for(let sample=0;sample<25;sample++)for(let d=0;d<6;d++)
        expect(Math.abs(output.data[face].samples[sample][d]-before.data[face].samples[sample][d])).toBeLessThan(1e-8)
      for(let id=0;id<t.net.poles.length;id++)if(boundaryLocked(t.net,id,'G1'))expect(evaluated.net.poles[id]).toEqual(published.net.poles[id])
      const undo=await editor.evaluateG1CurvedTangency({constraintId:published.constraintId,net:published.net})
      const redo=await editor.evaluateG1CurvedTangency({constraintId:published.constraintId,net:edited})
      expect(undo.net).toEqual(published.net);expect(redo.net).toEqual(edited)
      expect(redo.preview.previewRevision).toBe(undo.preview.previewRevision+1)
      expect(await editor.g1CurvedSupportCandidates()).toEqual(t.choices)
      expect(k.toBREP(t.shell)).toBe(source)
      expect(k.toBREP((editor as unknown as {source:ShapeHandle}).source)).toBe(editorSource)
      await expect(editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:edited})).rejects.toThrow()
    }finally{t.dispose()}
  },60000)

  it('keeps the accepted baseline and witness on protected edits, lock changes, faults and stale pending requests',async()=>{
    const t=await prepare(),{editor,k}=t
    try{
      const published=await publish(t),request={constraintId:published.constraintId,net:published.net,exportStep:true}
      const witness=editor.finalFaceWitness(published.preview.previewRevision)
      for(const id of [0,17])await expect(editor.evaluateG1CurvedTangency({...request,net:moved(published.net,id)})).rejects.toThrow()
      const weights=structuredClone(published.net);weights.weights[12]=1.1
      await expect(editor.evaluateG1CurvedTangency({...request,net:weights})).rejects.toThrow()
      await expect(editor.evaluateG1CurvedTangency({...request,lockedPoles:[12]})).rejects.toThrow()
      await expect(editor.evaluateG1CurvedTangency({...request,constraintId:-1})).rejects.toThrow()
      expect(editor.finalFaceWitness(published.preview.previewRevision)).toEqual(witness)
      const exportFault=vi.spyOn(k,'exportStep').mockImplementation(()=>{throw Error('persistent export fault')})
      try{await expect(editor.evaluateG1CurvedTangency(request)).rejects.toThrow('persistent export fault')}finally{exportFault.mockRestore()}
      const importFault=vi.spyOn(k,'importStep').mockImplementation(()=>{throw Error('persistent readback fault')})
      try{await expect(editor.evaluateG1CurvedTangency(request)).rejects.toThrow('persistent readback fault')}finally{importFault.mockRestore()}
      expect(editor.finalFaceWitness(published.preview.previewRevision)).toEqual(witness)
      const locked=await publish(t,[12]),lockedWitness=editor.finalFaceWitness(locked.preview.previewRevision)
      await expect(editor.evaluateG1CurvedTangency({constraintId:locked.constraintId,net:moved(locked.net,12),lockedPoles:[]})).rejects.toThrow()
      expect(editor.finalFaceWitness(locked.preview.previewRevision)).toEqual(lockedWitness)
      const okay=await editor.evaluateG1CurvedTangency({constraintId:published.constraintId,net:moved(published.net,12)})
      expect(okay.constraintId).toBe(published.constraintId)
      const pending=editor.evaluateG1CurvedTangency(request)
      const replacement=editor.evaluate(t.net,'G0'),replacementWitness=editor.finalFaceWitness(replacement.previewRevision)
      await expect(pending).rejects.toThrow()
      expect(editor.finalFaceWitness(replacement.previewRevision)).toEqual(replacementWitness)
      const sourcePending=editor.evaluateG1CurvedTangency(request)
      editor.open(t.step);const fresh=editor.select(t.selected),preview=editor.evaluate(fresh,'G0'),freshWitness=editor.finalFaceWitness(preview.previewRevision)
      await expect(sourcePending).rejects.toThrow()
      await expect(editor.evaluateG1CurvedTangency(request)).rejects.toThrow()
      expect(editor.finalFaceWitness(preview.previewRevision)).toEqual(freshWitness)
    }finally{t.dispose()}
  },60000)

  it('keeps plane and curved registrations distinct across source replacement',async()=>{
    const t=await prepare(),{editor,k}=t,owned:ShapeHandle[]=[]
    try{
      const curved=await publish(t)
      const face=(x:number)=>{
        const p=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
        const edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%4]));owned.push(...edges)
        const wire=k.makeWire(edges);owned.push(wire)
        const result=k.makeFace(wire);owned.push(result);return result
      }
      const shell=k.sew([face(0),face(10)],1e-7);owned.push(shell)
      editor.open(k.exportStep(shell));const net=editor.select(0)
      const {candidates:[choice]}=await editor.g1SupportCandidates()
      const plane=await editor.publishG1PlaneTangency({baseNet:net,net,choice})
      expect(plane.constraintId).not.toBe(curved.constraintId)
      const evaluated=await editor.evaluateG1PlaneTangency({constraintId:plane.constraintId,net:moved(plane.net,12),exportStep:true})
      expect(evaluated.preview.valid).toBe(true);expect(evaluated.step).toContain('ISO-10303-21')
      await expect(editor.evaluateG1CurvedTangency({constraintId:plane.constraintId,net:plane.net})).rejects.toThrow()
      await expect(editor.evaluateG1CurvedTangency({constraintId:curved.constraintId,net:curved.net})).rejects.toThrow()
    }finally{owned.reverse().forEach(h=>k.release(h));t.dispose()}
  },60000)
})

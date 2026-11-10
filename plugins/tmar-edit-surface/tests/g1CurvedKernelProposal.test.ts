// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial fixture for future variable-normal support work; no GUI.
import {describe,expect,it,vi} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
import {replaceSurface,surfaceTable,type Net,type Point} from '../brep'

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
    const net:Net={nu:4,nv:5,du:3,dv:3,poles,weights:poles.map(()=>1),rational:[0,0],ku:[b.uMin,b.uMax],kv:[b.vMin,(b.vMin+b.vMax)/2,b.vMax],mu:[4,4],mv:[4,1,4]}
    const support=own(k.fromBREP(replaceSurface(text,record,net)))
    const border=(ids:number[],axis:'u'|'v')=>{
      const points=ids.map(i=>net.poles[i]),a=points[0],z=points.at(-1)!,d=z.map((x,i)=>x-a[i]),length=Math.hypot(...d)
      const straight=points.every(p=>Math.hypot(...p.map((x,i)=>x-a[i]-(d[i]/length)*p.reduce((sum,y,j)=>sum+(y-a[j])*d[j]/length,0)))<1e-9)
      return straight?own(k.makeLineEdge({x:a[0],y:a[1],z:a[2]},{x:z[0],y:z[1],z:z[2]})):
        own(k.makeBSplineEdge(points.flat(),ids.map(i=>net.weights[i]),axis==='u'?net.ku:net.kv,axis==='u'?net.mu:net.mv,3))
    }
    const wire=own(k.makeWire([border([0,5,10,15],'u'),border([15,16,17,18,19],'v'),border([19,14,9,4],'u'),border([4,3,2,1,0],'v')]))
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

describe('isolated kernel proposals for compatible curved G1 support',()=>{
  it('preserves the interactive source/witness and protected faces, and independently reads back the proposed STEP',async()=>{
    const t=await prepare(),{editor,k}=t
    try{
      const sourceBrep=k.toBREP(t.shell),before=geometry(k,t.step),picked=editor.resolveAnchor(t.anchor,t.preview.previewRevision)
      const input={net:structuredClone(t.net),choice:structuredClone(t.choice),exportStep:true},saved=structuredClone(input)
      const proposal=await editor.proposeG1CurvedTangency(input)
      expect(input).toEqual(saved)
      expect(proposal.changedIndices).toEqual([12]);expect(proposal.net.poles[12][2]).toBeLessThan(-.6)
      expect(proposal.preview.valid).toBe(true);expect(proposal.preview.previewRevision).toBeUndefined()
      expect(proposal.revisions.preview).toBe(t.preview.previewRevision)
      expect(proposal.revisions.anchorSelection).toBe(t.anchor.selectionRevision)
      expect(proposal.validation).toMatchObject({edgeRegularity:'outward-rounded-coefficient-hull-proof',globalG1Certified:false})
      for(let i=0;i<t.net.poles.length;i++)if(i!==12)expect(proposal.net.poles[i]).toEqual(t.net.poles[i])
      const after=geometry(k,proposal.step!)
      expect(after).toMatchObject({valid:true,faceCount:3,solidCount:0})
      for(let face=0;face<3;face++)if(face!==t.selected){
        expect(after.data[face].kind).toBe(before.data[face].kind)
        for(let sample=0;sample<25;sample++)for(let d=0;d<6;d++)expect(Math.abs(after.data[face].samples[sample][d]-before.data[face].samples[sample][d])).toBeLessThan(1e-8)
      }
      const shape=k.importStep(proposal.step!),faces=k.getSubShapes(shape,'face'),shared=k.sharedEdges(faces[t.selected],faces[t.support])
      try{
        expect(shared).toHaveLength(1);expect(k.curveType(shared[0])).toBe('line')
        const a=k.uvBounds(faces[t.selected]),b=k.uvBounds(faces[t.support]);let maxGap=0,maxSin=0
        for(let i=0;i<=32;i++){
          const v=i/32,p=k.pointOnSurface(faces[t.selected],a.uMax,a.vMin+v*(a.vMax-a.vMin)),q=k.pointOnSurface(faces[t.support],b.uMin,b.vMin+v*(b.vMax-b.vMin))
          maxGap=Math.max(maxGap,Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z))
          const n=k.surfaceNormal(faces[t.selected],a.uMax,a.vMin+v*(a.vMax-a.vMin)),m=k.surfaceNormal(faces[t.support],b.uMin,b.vMin+v*(b.vMax-b.vMin))
          maxSin=Math.max(maxSin,Math.hypot(n.y*m.z-n.z*m.y,n.z*m.x-n.x*m.z,n.x*m.y-n.y*m.x))
        }
        expect(maxGap).toBeLessThan(1e-8);expect(maxSin).toBeLessThan(1e-9)
      }finally{shared.forEach(h=>k.release(h));faces.forEach(h=>k.release(h));k.release(shape)}
      expect(editor.finalFaceWitness(t.preview.previewRevision)).toEqual(t.witness)
      expect(editor.resolveAnchor(t.anchor,t.preview.previewRevision)).toEqual(picked)
      expect(await editor.g1CurvedSupportCandidates()).toEqual(t.choices)
      expect(k.toBREP(t.shell)).toBe(sourceBrep)
      const validated=await editor.validateG1CurvedTangency({baseNet:t.net,net:proposal.net,choice:t.choice,exportStep:true})
      expect(validated.net).toEqual(proposal.net);expect(validated.preview.previewRevision).toBeUndefined()
      expect(editor.finalFaceWitness(t.preview.previewRevision)).toEqual(t.witness)
    }finally{t.dispose()}
  },60000)

  it('rejects forged choices, locks, altered results and injected export/import failures without replacing the active witness',async()=>{
    const t=await prepare(),{editor,k}=t
    try{
      const input={net:t.net,choice:t.choice,exportStep:true}
      await expect(editor.proposeG1CurvedTangency({...input,lockedPoles:[12]})).rejects.toThrow()
      await expect(editor.proposeG1CurvedTangency({...input,choice:{...t.choice,supportFaceIndex:t.selected}})).rejects.toThrow()
      await expect(editor.proposeG1CurvedTangency({...input,choice:{...t.choice,stamp:{...t.choice.stamp,sourceRevision:t.choice.stamp.sourceRevision+1}}})).rejects.toThrow()
      const proposal=await editor.proposeG1CurvedTangency(input)
      const protectedEdit=structuredClone(proposal.net);protectedEdit.poles[0][2]+=.01
      await expect(editor.validateG1CurvedTangency({baseNet:t.net,net:protectedEdit,choice:t.choice})).rejects.toThrow()
      const wrong=structuredClone(proposal.net);wrong.poles[12][2]+=.01
      await expect(editor.validateG1CurvedTangency({baseNet:t.net,net:wrong,choice:t.choice})).rejects.toThrow()
      expect(editor.finalFaceWitness(t.preview.previewRevision)).toEqual(t.witness)
      const exportFault=vi.spyOn(k,'exportStep').mockImplementation(()=>{throw Error('controlled STEP export fault')})
      try{for(const exportStep of [true,false])await expect(editor.proposeG1CurvedTangency({...input,exportStep})).rejects.toThrow('controlled STEP export fault')}finally{exportFault.mockRestore()}
      expect(editor.finalFaceWitness(t.preview.previewRevision)).toEqual(t.witness)
      const importFault=vi.spyOn(k,'importStep').mockImplementation(()=>{throw Error('controlled STEP readback fault')})
      try{for(const exportStep of [true,false])await expect(editor.proposeG1CurvedTangency({...input,exportStep})).rejects.toThrow('controlled STEP readback fault')}finally{importFault.mockRestore()}
      expect(editor.finalFaceWitness(t.preview.previewRevision)).toEqual(t.witness)
      // Inject NaN only while the final readback verifier is running, after
      // ordinary candidate evaluation has completed successfully.
      const internal=editor as unknown as {checkCurvedTangencyReadback:(...args:unknown[])=>Promise<void>}
      const originalReadback=internal.checkCurvedTangencyReadback.bind(editor)
      let injectedReadbackPoint=false
      const readbackSpy=vi.spyOn(internal,'checkCurvedTangencyReadback').mockImplementation(async(...args)=>{
        const point=vi.spyOn(k,'pointOnSurface').mockImplementationOnce(()=>{injectedReadbackPoint=true;return {x:NaN,y:0,z:0}})
        try{return await originalReadback(...args)}finally{point.mockRestore()}
      })
      try{await expect(editor.proposeG1CurvedTangency(input)).rejects.toThrow(/non finite/)}finally{readbackSpy.mockRestore()}
      expect(injectedReadbackPoint).toBe(true)
      expect(editor.finalFaceWitness(t.preview.previewRevision)).toEqual(t.witness)
      const okay=await editor.proposeG1CurvedTangency(input);expect(okay.net).toEqual(proposal.net)
      const callerInput={...input,net:structuredClone(t.net),choice:structuredClone(t.choice)}
      const ownedPending=editor.proposeG1CurvedTangency(callerInput)
      callerInput.net.poles[0][2]+=9
      expect((await ownedPending).net).toEqual(proposal.net)
      const pending=editor.proposeG1CurvedTangency(input)
      const replacement=editor.evaluate(t.net,'G0'),replacementWitness=editor.finalFaceWitness(replacement.previewRevision)
      await expect(pending).rejects.toThrow()
      expect(editor.finalFaceWitness(replacement.previewRevision)).toEqual(replacementWitness)
      const staleSource=editor.proposeG1CurvedTangency(input)
      editor.open(t.step);const fresh=editor.select(t.selected),shown=editor.evaluate(fresh,'G0'),freshWitness=editor.finalFaceWitness(shown.previewRevision)
      await expect(staleSource).rejects.toThrow()
      expect(editor.finalFaceWitness(shown.previewRevision)).toEqual(freshWitness)
    }finally{t.dispose()}
  },60000)
})

// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial fixture for future variable-normal support work; no GUI.
import {describe,expect,it,vi} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
import {replaceSurface,surfaceTable,type Net,type Point} from '../brep'
import {refineClampedNet} from '../refineClampedNet'
import {readRecipe,readCurvedRecipe} from '../recipe'

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

const bodyId='curved-v6-source'
async function savedFixture(negativeZero=false){
  const t=await prepare(),{editor,k}=t
  try{
    const base=structuredClone(t.net);if(negativeZero)base.poles[0][2]=-0
    const before=editor.evaluate(base,'G0'),anchor=editor.anchorFromPick(base.poles[12],before.previewRevision).anchor
    const proposal=await editor.proposeG1CurvedTangency({net:base,choice:t.choice})
    const accepted=await editor.publishG1CurvedTangency({baseNet:base,net:proposal.net,choice:t.choice})
    const moved=structuredClone(accepted.net);moved.poles[12][2]+=.08
    const current=await editor.evaluateG1CurvedTangency({constraintId:accepted.constraintId,net:moved,exportStep:true})
    const witness=editor.finalFaceWitness(current.preview.previewRevision),pin=editor.resolveAnchor(anchor,current.preview.previewRevision)
    const raw=await editor.createCurvedRecipe(moved,'G0',[],bodyId,accepted.constraintId)
    expect(raw.version).toBe(6)
    const recipe=readCurvedRecipe(JSON.parse(JSON.stringify(raw)))
    expect(editor.finalFaceWitness(current.preview.previewRevision)).toEqual(witness)
    const translated=k.translate(t.shell,.01,0,0)
    let changedStep:string
    try{changedStep=k.exportStep(translated)}finally{k.release(translated)}
    return {...t,base,accepted,moved,current,anchor,witness,pin,recipe,changedStep}
  }catch(error){t.dispose();throw error}
}
function sameGeometry(a:ReturnType<typeof geometry>,b:ReturnType<typeof geometry>){
  expect(a).toMatchObject({valid:true,faceCount:3,solidCount:0})
  expect(b).toMatchObject({valid:true,faceCount:3,solidCount:0})
  for(let face=0;face<3;face++)for(let sample=0;sample<25;sample++)for(let d=0;d<6;d++)
    expect(Math.abs(a.data[face].samples[sample][d]-b.data[face].samples[sample][d])).toBeLessThan(1e-8)
}

describe('explicit kernel v6 compatible B-spline G1 recipes',()=>{
  it('serializes and replays exact state in isolation, restores fresh identities and invalidates old anchors without changing support geometry',async()=>{
    const t=await savedFixture(),{editor,k}=t
    try{
      const saved=JSON.stringify(t.recipe)
      expect(saved).not.toMatch(/constraintId|sourceRevision|selectionRevision/)
      expect(t.recipe).toMatchObject({version:6,preparation:'native-nurbs',boundaryMode:'locked',refinements:[],curvedTangency:{kind:'compatible-bspline',supportFaceIndex:t.support}})
      expect(()=>readRecipe(JSON.parse(saved))).toThrow()
      await expect(editor.createRecipe(t.moved,'G0',[],bodyId,false,t.accepted.constraintId)).rejects.toThrow()
      for(const action of ['restoreRecipe','replayRecipe'] as const)await expect(editor[action](t.step,JSON.parse(saved),bodyId)).rejects.toThrow()
      expect(editor.finalFaceWitness(t.current.preview.previewRevision)).toEqual(t.witness)
      const replay=await editor.replayCurvedRecipe(t.step,JSON.parse(saved),bodyId)
      sameGeometry(geometry(k,t.current.step!),geometry(k,replay.step!))
      expect(editor.finalFaceWitness(t.current.preview.previewRevision)).toEqual(t.witness)
      expect(editor.resolveAnchor(t.anchor,t.current.preview.previewRevision)).toEqual(t.pin)
      const sourceBrep=k.toBREP((editor as unknown as {source:ShapeHandle}).source)
      const restored=await editor.restoreCurvedRecipe(t.step,JSON.parse(saved),bodyId),constraint=restored.curvedTangency
      expect(restored.net).toEqual(t.moved);expect(restored.continuity).toBe('G0');expect(restored.freeBoundary).toBe(false)
      expect(constraint.kind).toBe('compatible-bspline')
      expect(constraint.constraintId).not.toBe(t.accepted.constraintId)
      expect(constraint.choice.stamp).not.toEqual(t.choice.stamp)
      expect(constraint.baseNet).toEqual(t.base);expect(constraint.referenceNet).toEqual(t.accepted.net)
      expect(()=>editor.resolveAnchor(t.anchor,restored.preview.previewRevision!)).toThrow()
      const picked=editor.anchorFromPick(t.pin.at,restored.preview.previewRevision!)
      expect(picked.anchor.selectionRevision).not.toBe(t.anchor.selectionRevision)
      expect(Math.hypot(...picked.at.map((x,i)=>x-t.pin.at[i]))).toBeLessThan(1e-8)
      await expect(editor.evaluateG1CurvedTangency({constraintId:t.accepted.constraintId,net:t.moved})).rejects.toThrow()
      const evaluated=await editor.evaluateG1CurvedTangency({constraintId:constraint.constraintId,net:restored.net,exportStep:true})
      sameGeometry(geometry(k,t.current.step!),geometry(k,evaluated.step!))
      const original=geometry(k,t.step),output=geometry(k,evaluated.step!)
      for(let face=0;face<3;face++)if(face!==t.selected)for(let sample=0;sample<25;sample++)for(let d=0;d<6;d++)
        expect(Math.abs(original.data[face].samples[sample][d]-output.data[face].samples[sample][d])).toBeLessThan(1e-8)
      expect(k.toBREP((editor as unknown as {source:ShapeHandle}).source)).toBe(sourceBrep)
      expect(JSON.stringify(t.recipe)).toBe(saved)
    }finally{t.dispose()}
  },60000)

  it('rejects altered sources, support identity and protected coefficient data atomically, including failed STEP readback',async()=>{
    const t=await savedFixture(),{editor,k}=t
    try{
      const badHash=structuredClone(t.recipe);badHash.source.brepSha256='0'.repeat(64)
      const badSupport=structuredClone(t.recipe);badSupport.curvedTangency.supportNetSha256='0'.repeat(64)
      const badSide=structuredClone(t.recipe);badSide.curvedTangency.supportSide=badSide.curvedTangency.supportSide==='uMin'?'uMax':'uMin'
      const badReversal=structuredClone(t.recipe);badReversal.curvedTangency.reverseSupport=!badReversal.curvedTangency.reverseSupport
      const badReference=structuredClone(t.recipe)
      badReference.curvedTangency.acceptedReferenceEdits=badReference.curvedTangency.acceptedReferenceEdits.filter(e=>e.index!==0)
      badReference.curvedTangency.acceptedReferenceEdits.push({index:0,point:[t.net.poles[0][0],t.net.poles[0][1],1]})
      const badFinal=structuredClone(t.recipe)
      badFinal.edits=badFinal.edits.filter(e=>e.index!==17)
      badFinal.edits.push({index:17,point:[t.moved.poles[17][0],t.moved.poles[17][1],t.moved.poles[17][2]+.01]})
      for(const recipe of [badHash,badSupport,badSide,badReversal,badReference,badFinal])for(const action of ['restoreCurvedRecipe','replayCurvedRecipe'] as const){
        await expect(editor[action](t.step,JSON.parse(JSON.stringify(recipe)),bodyId)).rejects.toThrow()
        expect(editor.finalFaceWitness(t.current.preview.previewRevision)).toEqual(t.witness)
        expect(editor.resolveAnchor(t.anchor,t.current.preview.previewRevision)).toEqual(t.pin)
      }
      for(const action of ['restoreCurvedRecipe','replayCurvedRecipe'] as const){
        await expect(editor[action](t.changedStep,t.recipe,bodyId)).rejects.toThrow()
        await expect(editor[action](t.step,t.recipe,'another-body')).rejects.toThrow()
      }
      expect(editor.finalFaceWitness(t.current.preview.previewRevision)).toEqual(t.witness)
      const fault=vi.spyOn(k,'importStep').mockImplementation(()=>{throw Error('v6 controlled import failure')})
      try{await expect(editor.restoreCurvedRecipe(t.step,t.recipe,bodyId)).rejects.toThrow('v6 controlled import failure')}finally{fault.mockRestore()}
      expect(editor.finalFaceWitness(t.current.preview.previewRevision)).toEqual(t.witness)
      const okay=await editor.evaluateG1CurvedTangency({constraintId:t.accepted.constraintId,net:t.moved})
      expect(okay.net).toEqual(t.moved)
    }finally{t.dispose()}
  },60000)

  it('retains protected negative zero in JSON and in restored current/base/reference nets',async()=>{
    const t=await savedFixture(true),{editor,k}=t
    try{
      expect(Object.is(t.base.poles[0][2],-0)).toBe(true)
      expect(JSON.stringify(t.recipe)).toContain('"-0"')
      const restored=await editor.restoreCurvedRecipe(t.step,JSON.parse(JSON.stringify(t.recipe)),bodyId)
      expect(Object.is(restored.net.poles[0][2],-0)).toBe(true)
      expect(Object.is(restored.curvedTangency.baseNet.poles[0][2],-0)).toBe(true)
      expect(Object.is(restored.curvedTangency.referenceNet.poles[0][2],-0)).toBe(true)
      const evaluated=await editor.evaluateG1CurvedTangency({constraintId:restored.curvedTangency.constraintId,net:restored.net,exportStep:true})
      sameGeometry(geometry(k,t.current.step!),geometry(k,evaluated.step!))
    }finally{t.dispose()}
  },60000)

  it('fences pending restores against a new interactive preview and never publishes replay state into it',async()=>{
    const t=await savedFixture(),{editor}=t
    try{
      const pending=editor.restoreCurvedRecipe(t.step,t.recipe,bodyId)
      const newer=editor.evaluate(t.net,'G0'),witness=editor.finalFaceWitness(newer.previewRevision)
      await expect(pending).rejects.toThrow()
      expect(editor.finalFaceWitness(newer.previewRevision)).toEqual(witness)
      const replay=editor.replayCurvedRecipe(t.step,t.recipe,bodyId)
      const latest=editor.evaluate(t.net,'G0'),latestWitness=editor.finalFaceWitness(latest.previewRevision)
      expect((await replay).valid).toBe(true)
      expect(editor.finalFaceWitness(latest.previewRevision)).toEqual(latestWitness)
      const okay=await editor.evaluateG1CurvedTangency({constraintId:t.accepted.constraintId,net:t.moved})
      expect(okay.net).toEqual(t.moved)
    }finally{t.dispose()}
  },60000)

  it('keeps the v6 schema closed and signed-zero encoding canonical before any CAD restore is attempted',async()=>{
    const t=await savedFixture()
    try{
      const base=JSON.parse(JSON.stringify(t.recipe))
      expect(readCurvedRecipe(base)).toEqual(t.recipe)
      const variants:unknown[]=[
        {...base,constraintId:123},
        {...base,sourceRevision:1},
        {...base,planeTangency:{}},
        {...base,source:{...base.source,sourceId:'transient'}},
        {...base,curvedTangency:{...base.curvedTangency,constraintId:123}},
        {...base,curvedTangency:{...base.curvedTangency,kind:'plane'}},
        {...base,curvedTangency:{...base.curvedTangency,supportSide:'diagonal'}},
        {...base,curvedTangency:{...base.curvedTangency,reverseSupport:1}},
        {...base,preparation:'plane-to-bicubic'},
        {...base,refinements:[{axis:'U',value:0,count:1}]},
      ]
      for(const scale of [0,-1,NaN,Infinity])variants.push({...base,curvedTangency:{...base.curvedTangency,scale}})
      for(const derivativeTolerance of [0,-1,1e-5,NaN,Infinity])variants.push({...base,curvedTangency:{...base.curvedTangency,derivativeTolerance}})
      for(const supportNetSha256 of ['','f'.repeat(63),'G'.repeat(64)])variants.push({...base,curvedTangency:{...base.curvedTangency,supportNetSha256}})
      for(const value of variants)expect(()=>readCurvedRecipe(value)).toThrow()
      const canonical=structuredClone(t.recipe)
      expect(canonical.edits.length).toBeGreaterThan(0)
      canonical.edits[0].point[0]='-0'
      expect(readCurvedRecipe(canonical).edits[0].point[0]).toBe('-0')
      const numeric=structuredClone(t.recipe);numeric.edits[0].point[0]=-0
      expect(()=>readCurvedRecipe(numeric)).toThrow()
      const accessor=structuredClone(t.recipe);let reads=0
      Object.defineProperty(accessor.curvedTangency,'scale',{enumerable:true,get(){reads++;return reads<=3?1:0}})
      const owned=readCurvedRecipe(accessor)
      expect(reads).toBe(1)
      expect(owned.curvedTangency.scale).toBe(1)
      const caller=structuredClone(t.recipe),output=readCurvedRecipe(caller)
      caller.curvedTangency.scale=2;caller.edits[0].point[0]=123
      expect(output.curvedTangency.scale).toBe(t.recipe.curvedTangency.scale)
      expect(output.edits).toEqual(t.recipe.edits)
      expect(t.editor.finalFaceWitness(t.current.preview.previewRevision)).toEqual(t.witness)
    }finally{t.dispose()}
  },60000)

})


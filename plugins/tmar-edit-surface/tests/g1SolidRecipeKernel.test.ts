// SPDX-License-Identifier: AGPL-3.0-only
// Real synthetic solid + kernel persistence only; no GUI or project-file claim.
import {expect,it} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
import {boundaryLocked,type Net} from '../brep'
import {readRecipe,type SurfaceEditRecipeV5} from '../recipe'

it('saves, replays and restores a plane G1 v5 recipe on the seven-face STEP solid while preserving source, anchors and token fences',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const face=(points:number[][])=>{
    const p=points.map(([x,y,z])=>({x,y,z})),edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%p.length]));owned.push(...edges)
    const wire=k.makeWire(edges);owned.push(wire)
    const result=k.makeFace(wire);owned.push(result);return result
  }
  const measure=(step:string)=>{
    const shape=k.importStep(step),faces=k.getSubShapes(shape,'face'),solids=k.getSubShapes(shape,'solid')
    try{return {valid:k.isValid(shape),isSolid:k.isSolid(shape),faces:faces.length,solids:solids.length,volume:k.getVolume(shape),samples:faces.map(face=>{
      const b=k.uvBounds(face),samples:number[][]=[]
      for(const s of [0,.5,1])for(const t of [0,.5,1]){
        const u=b.uMin+s*(b.uMax-b.uMin),v=b.vMin+t*(b.vMax-b.vMin),p=k.pointOnSurface(face,u,v),n=k.surfaceNormal(face,u,v)
        samples.push([p.x,p.y,p.z,n.x,n.y,n.z])
      }
      return samples
    })}}
    finally{faces.forEach(h=>k.release(h));solids.forEach(h=>k.release(h));k.release(shape)}
  }
  type Geometry=ReturnType<typeof measure>
  const validSolid=(geometry:Geometry)=>expect(geometry).toMatchObject({valid:true,isSolid:true,faces:7,solids:1})
  const equalGeometry=(a:Geometry,b:Geometry)=>{
    validSolid(a);validSolid(b);expect(Math.abs(a.volume-b.volume)).toBeLessThan(1e-7)
    for(let face=0;face<7;face++)for(let sample=0;sample<9;sample++)for(let d=0;d<6;d++)
      expect(Math.abs(a.samples[face][sample][d]-b.samples[face][sample][d])).toBeLessThan(1e-8)
  }
  try{
    // Same exact face layout as g1SolidFixture.test.ts: split planar top z=0.
    const faces=[
      face([[0,0,0],[10,0,0],[10,10,0],[0,10,0]]),
      face([[10,0,0],[20,0,0],[20,10,0],[10,10,0]]),
      face([[0,0,-5],[0,10,-5],[20,10,-5],[20,0,-5]]),
      face([[0,0,-5],[20,0,-5],[20,0,0],[0,0,0]]),
      face([[20,0,-5],[20,10,-5],[20,10,0],[20,0,0]]),
      face([[20,10,-5],[0,10,-5],[0,10,0],[20,10,0]]),
      face([[0,10,-5],[0,0,-5],[0,0,0],[0,10,0]]),
    ]
    const solid=k.sewAndSolidify(faces,1e-7);owned.push(solid)
    expect(k.isValid(solid)).toBe(true);expect(k.isSolid(solid)).toBe(true)
    expect(k.getVolume(solid)).toBeCloseTo(1000,7)
    const originalBrep=k.toBREP(solid),step=k.exportStep(solid),original=measure(step),opened=editor.open(step)
    validSolid(original);expect(original.volume).toBeCloseTo(1000,7)
    const frozenSource=(editor as unknown as {brep:string}).brep
    let selected=-1,source:Net|undefined,choice
    for(const f of opened.faces){
      if(f.reason)continue
      const net=editor.select(f.index)
      if(!net.poles.every(p=>Math.abs(p[2])<1e-8))continue
      const supports=await editor.g1SupportCandidates()
      const candidate=supports.candidates.find(c=>Math.abs(c.plane.normal[2])>1-1e-8&&Math.abs(c.plane.origin[2])<1e-8)
      if(candidate){selected=f.index;source=net;choice=candidate;break}
    }
    expect(selected).toBeGreaterThanOrEqual(0);expect(source).toBeDefined();expect(choice).toBeDefined()
    const base=structuredClone(source!),u=choice!.side==='uMin'?1:choice!.side==='uMax'?base.nu-2:Math.floor(base.nu/2)
    const v=choice!.side==='vMin'?1:choice!.side==='vMax'?base.nv-2:Math.floor(base.nv/2),ring=u*base.nv+v
    const interior=base.poles.findIndex((_,id)=>!boundaryLocked(base,id,'G1'))
    expect(interior).toBeGreaterThanOrEqual(0);expect(interior).not.toBe(ring)
    base.poles[ring][2]+=.2
    const before=editor.evaluate(base,'G0'),anchor=editor.anchorFromPick(source!.poles[interior],before.previewRevision).anchor
    const proposal=await editor.proposeG1PlaneTangency({net:base,choice:choice!})
    const published=await editor.publishG1PlaneTangency({baseNet:base,net:proposal.net,choice:choice!,exportStep:true})
    const flat=measure(published.step!);validSolid(flat);expect(flat.volume).toBeCloseTo(1000,6)
    const acceptedPin=editor.resolveAnchor(anchor,published.preview.previewRevision)
    const changed=structuredClone(published.net);changed.poles[interior][2]+=.08
    const current=await editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:changed,exportStep:true})
    const expected=measure(current.step!);validSolid(expected)
    expect(expected.volume-original.volume).toBeGreaterThan(1e-4)
    const pin=editor.resolveAnchor(anchor,current.preview.previewRevision),witness=editor.finalFaceWitness(current.preview.previewRevision)
    expect(pin.at[2]).toBeGreaterThan(acceptedPin.at[2]+.001)
    const bodyId='seven-face-solid-v5',recipe=readRecipe(JSON.parse(JSON.stringify(await editor.createRecipe(changed,'G0',[],bodyId,false,published.constraintId)))) as SurfaceEditRecipeV5
    expect(recipe).toMatchObject({version:5,source:{faceCount:7,solidCount:1},planeTangency:{kind:'plane',supportFaceIndex:choice!.supportFaceIndex}})
    expect(editor.finalFaceWitness(current.preview.previewRevision)).toEqual(witness)
    const saved=JSON.stringify(recipe),replay=await editor.replayRecipe(step,JSON.parse(saved),bodyId)
    equalGeometry(expected,measure(replay.step!))
    expect(editor.finalFaceWitness(current.preview.previewRevision)).toEqual(witness)
    expect(editor.resolveAnchor(anchor,current.preview.previewRevision)).toEqual(pin)
    const restored=await editor.restoreRecipe(step,JSON.parse(saved),bodyId),constraint=restored.planeTangency!
    expect(restored.net).toEqual(changed);expect(constraint.baseNet).toEqual(base);expect(constraint.referenceNet).toEqual(published.net)
    expect(constraint.constraintId).not.toBe(published.constraintId)
    expect(constraint.choice.stamp).not.toEqual(choice!.stamp)
    expect(()=>editor.resolveAnchor(anchor,restored.preview.previewRevision!)).toThrow()
    const newPick=editor.anchorFromPick(pin.at,restored.preview.previewRevision!)
    expect(newPick.anchor.selectionRevision).not.toBe(anchor.selectionRevision)
    expect(Math.hypot(...newPick.at.map((x,i)=>x-pin.at[i]))).toBeLessThan(1e-8)
    await expect(editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:changed})).rejects.toThrow()
    await expect(editor.evaluateG1CurvedTangency({constraintId:constraint.constraintId,net:changed})).rejects.toThrow()
    const final=await editor.evaluateG1PlaneTangency({constraintId:constraint.constraintId,net:restored.net,exportStep:true})
    equalGeometry(expected,measure(final.step!))
    for(let face=0;face<7;face++)if(face!==selected)for(let sample=0;sample<9;sample++)for(let d=0;d<6;d++)
      expect(Math.abs(expected.samples[face][sample][d]-original.samples[face][sample][d])).toBeLessThan(1e-8)
    const oldWitness=editor.finalFaceWitness(final.preview.previewRevision),illegal=structuredClone(restored.net)
    illegal.poles[ring][2]+=.01
    await expect(editor.evaluateG1PlaneTangency({constraintId:constraint.constraintId,net:illegal})).rejects.toThrow()
    const corrupt=structuredClone(recipe);corrupt.source.brepSha256='0'.repeat(64)
    await expect(editor.restoreRecipe(step,corrupt,bodyId)).rejects.toThrow()
    expect(editor.finalFaceWitness(final.preview.previewRevision)).toEqual(oldWitness)
    const finalPin=editor.resolveAnchor(newPick.anchor,final.preview.previewRevision).at
    expect(Math.hypot(...finalPin.map((x,i)=>x-pin.at[i]))).toBeLessThan(1e-8)
    expect(k.toBREP(solid)).toBe(originalBrep);expect(k.getVolume(solid)).toBeCloseTo(1000,7)
    expect((editor as unknown as {brep:string}).brep).toBe(frozenSource)
    expect(JSON.stringify(recipe)).toBe(saved)
    console.info('SOLID_V5_RECIPE_VOLUME_MM3',JSON.stringify({source:original.volume,accepted:flat.volume,edited:expected.volume,replayed:measure(replay.step!).volume,restored:measure(final.step!).volume}))
  }finally{owned.reverse().forEach(h=>k.release(h));editor.dispose()}
},60000)


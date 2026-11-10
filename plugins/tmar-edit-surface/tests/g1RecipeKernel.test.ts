// SPDX-License-Identifier: AGPL-3.0-only
// Native synthetic CAD tests; no browser, desktop, real scan or global G1 claim.
import {describe,expect,it} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
import {boundaryLocked} from '../brep'
import {readRecipe,type SurfaceEditRecipeV5} from '../recipe'

const bodyId='recipe-v5-source'
async function fixture(negativeZero=false){
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const rectangle=(x:number)=>{
    const p=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
    const edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%4]));owned.push(...edges)
    const wire=k.makeWire(edges);owned.push(wire)
    const face=k.makeFace(wire);owned.push(face);return face
  }
  try{
    const shell=k.sew([rectangle(0),rectangle(10)],1e-7);owned.push(shell)
    const shifted=k.translate(shell,.01,0,0);owned.push(shifted)
    const changedStep=k.exportStep(shifted)
    const step=k.exportStep(shell),opened=editor.open(step),face=opened.faces.findIndex(f=>!f.reason),source=editor.select(face)
    const {candidates:[choice]}=await editor.g1SupportCandidates()
    const u=choice.side==='uMin'?1:choice.side==='uMax'?source.nu-2:Math.floor(source.nu/2)
    const v=choice.side==='vMin'?1:choice.side==='vMax'?source.nv-2:Math.floor(source.nv/2),inner=u*source.nv+v
    const base=structuredClone(source);base.poles[inner][2]+=.2
    // A protected boundary coefficient must survive as an exact signed zero.
    if(negativeZero)base.poles[0][2]=-0
    editor.evaluate(base,'G0')
    const proposal=await editor.proposeG1PlaneTangency({net:base,choice})
    const accepted=await editor.publishG1PlaneTangency({baseNet:base,net:proposal.net,choice})
    const moved=structuredClone(accepted.net);moved.poles[12][2]+=.08
    const current=await editor.evaluateG1PlaneTangency({constraintId:accepted.constraintId,net:moved,exportStep:true})
    const raw=await editor.createRecipe(moved,'G0',[],bodyId,false,accepted.constraintId)
    expect(raw.version).toBe(5)
    const recipe=readRecipe(JSON.parse(JSON.stringify(raw))) as SurfaceEditRecipeV5
    return {editor,k,step,changedStep,source,base,accepted,current,moved,recipe,inner}
  }catch(error){editor.dispose();throw error}
  finally{owned.forEach(h=>k.release(h))}
}
function geometry(editor:SurfaceEditorKernel,step:string){
  const k=editor.kernel,shape=k.importStep(step),faces=k.getSubShapes(shape,'face'),solids=k.getSubShapes(shape,'solid')
  try{
    return {valid:k.isValid(shape),faces:faces.length,solids:solids.length,samples:faces.map(face=>{
      const b=k.uvBounds(face),out:number[][]=[]
      for(const s of [0,.25,.5,.75,1])for(const t of [0,.25,.5,.75,1]){
        const u=b.uMin+(b.uMax-b.uMin)*s,v=b.vMin+(b.vMax-b.vMin)*t,p=k.pointOnSurface(face,u,v),n=k.surfaceNormal(face,u,v)
        out.push([p.x,p.y,p.z,n.x,n.y,n.z])
      }
      return out
    })}
  }finally{faces.forEach(f=>k.release(f));solids.forEach(s=>k.release(s));k.release(shape)}
}
function sameGeometry(a:ReturnType<typeof geometry>,b:ReturnType<typeof geometry>){
  expect(a.valid).toBe(true);expect(b.valid).toBe(true);expect(a.faces).toBe(b.faces);expect(a.solids).toBe(b.solids)
  for(let f=0;f<a.faces;f++)for(let i=0;i<a.samples[f].length;i++)for(let d=0;d<6;d++)
    expect(Math.abs(a.samples[f][i][d]-b.samples[f][i][d])).toBeLessThan(1e-8)
}

describe('kernel plane G1 recipe v5 JSON persistence',()=>{
  it('replays without disturbing the active witness and restores exact nets with a fresh protected constraint',async()=>{
    const t=await fixture(),{editor}=t
    try{
      const saved=JSON.stringify(t.recipe),before=editor.finalFaceWitness(t.current.preview.previewRevision)
      expect(t.recipe.planeTangency).toMatchObject({kind:'plane',supportFaceIndex:t.accepted.choice.supportFaceIndex,edgeIndex:t.accepted.choice.edgeIndex,side:t.accepted.choice.side})
      expect(saved).not.toMatch(/constraintId|sourceRevision|selectionRevision/)
      const replay=await editor.replayRecipe(t.step,JSON.parse(saved),bodyId)
      sameGeometry(geometry(editor,t.current.step!),geometry(editor,replay.step!))
      expect(editor.finalFaceWitness(t.current.preview.previewRevision)).toEqual(before)
      const stillActive=await editor.evaluateG1PlaneTangency({constraintId:t.accepted.constraintId,net:t.moved})
      expect(stillActive.net).toEqual(t.moved)
      const restored=await editor.restoreRecipe(t.step,JSON.parse(saved),bodyId)
      expect(restored.net).toEqual(t.moved)
      expect(restored.continuity).toBe('G0');expect(restored.freeBoundary).toBe(false)
      expect(restored.preparation).toBeDefined()
      const constraint=restored.planeTangency!
      expect(constraint).toBeDefined();expect(constraint.constraintId).not.toBe(t.accepted.constraintId)
      expect(constraint.baseNet).toEqual(t.base);expect(constraint.referenceNet).toEqual(t.accepted.net)
      expect(constraint.choice.stamp).not.toEqual(t.accepted.choice.stamp)
      await expect(editor.evaluateG1PlaneTangency({constraintId:t.accepted.constraintId,net:t.moved})).rejects.toThrow()
      const next=await editor.evaluateG1PlaneTangency({constraintId:constraint.constraintId,net:restored.net,exportStep:true})
      sameGeometry(geometry(editor,t.current.step!),geometry(editor,next.step!))
      expect(next.validation.globalG1Certified).toBe(false)
      expect(next.validation.edgeRegularity).toBe('outward-rounded-interval-proof')
      const illegal=structuredClone(restored.net);illegal.poles[t.inner][2]+=.03
      const witness=editor.finalFaceWitness(next.preview.previewRevision)
      await expect(editor.evaluateG1PlaneTangency({constraintId:constraint.constraintId,net:illegal})).rejects.toThrow()
      expect(editor.finalFaceWitness(next.preview.previewRevision)).toEqual(witness)
      for(let i=0;i<t.source.poles.length;i++)if(boundaryLocked(t.source,i,'G1'))expect(restored.net.poles[i]).toEqual(t.accepted.net.poles[i])
      expect(JSON.stringify(t.recipe)).toBe(saved)
    }finally{editor.dispose()}
  },60000)

  it('rejects changed source, support and protected coefficients atomically while the prior constraint stays usable',async()=>{
    const t=await fixture(),{editor}=t
    try{
      const revision=t.current.preview.previewRevision,witness=editor.finalFaceWitness(revision)
      const badSource=structuredClone(t.recipe);badSource.source.brepSha256='0'.repeat(64)
      const badSupport=structuredClone(t.recipe);badSupport.planeTangency.side=badSupport.planeTangency.side==='uMin'?'uMax':'uMin'
      const badReference=structuredClone(t.recipe)
      badReference.planeTangency.acceptedReferenceEdits=badReference.planeTangency.acceptedReferenceEdits.filter(e=>e.index!==0)
      badReference.planeTangency.acceptedReferenceEdits.push({index:0,point:[t.source.poles[0][0],t.source.poles[0][1],1]})
      for(const recipe of [badSource,badSupport,badReference]){
        for(const action of ['restoreRecipe','replayRecipe'] as const){
          await expect(editor[action](t.step,JSON.parse(JSON.stringify(recipe)),bodyId)).rejects.toThrow()
          expect(editor.finalFaceWitness(revision)).toEqual(witness)
        }
      }
      for(const action of ['restoreRecipe','replayRecipe'] as const){
        await expect(editor[action](t.changedStep,t.recipe,bodyId)).rejects.toThrow()
        expect(editor.finalFaceWitness(revision)).toEqual(witness)
      }
      await expect(editor.restoreRecipe(t.step,t.recipe,'different-body')).rejects.toThrow()
      expect(editor.finalFaceWitness(revision)).toEqual(witness)
      const okay=await editor.evaluateG1PlaneTangency({constraintId:t.accepted.constraintId,net:t.moved})
      expect(okay.net).toEqual(t.moved)
    }finally{editor.dispose()}
  },60000)

  it('preserves a protected negative-zero coefficient through JSON and kernel reconstruction',async()=>{
    const t=await fixture(true),{editor}=t
    try{
      expect(Object.is(t.base.poles[0][2],-0)).toBe(true)
      expect(JSON.stringify(t.recipe)).toContain('"-0"')
      const restored=await editor.restoreRecipe(t.step,JSON.parse(JSON.stringify(t.recipe)),bodyId)
      expect(Object.is(restored.net.poles[0][2],-0)).toBe(true)
      expect(Object.is(restored.planeTangency!.baseNet.poles[0][2],-0)).toBe(true)
      expect(Object.is(restored.planeTangency!.referenceNet.poles[0][2],-0)).toBe(true)
      const evaluated=await editor.evaluateG1PlaneTangency({constraintId:restored.planeTangency!.constraintId,net:restored.net,exportStep:true})
      sameGeometry(geometry(editor,t.current.step!),geometry(editor,evaluated.step!))
    }finally{editor.dispose()}
  },60000)
})


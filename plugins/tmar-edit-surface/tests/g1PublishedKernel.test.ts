// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect,vi} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
import {boundaryLocked,type Net} from '../brep'

async function fixture() {
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const rectangle=(x:number)=>{
    const p=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
    const edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%4]));owned.push(...edges)
    const wire=k.makeWire(edges);owned.push(wire)
    const face=k.makeFace(wire);owned.push(face);return face
  }
  try {
    const shell=k.sew([rectangle(0),rectangle(10)],1e-7);owned.push(shell)
    const step=k.exportStep(shell),opened=editor.open(step)
    const face=opened.faces.findIndex(f=>!f.reason),net=editor.select(face)
    const choices=await editor.g1SupportCandidates(),choice=choices.candidates[0]
    expect(choices.candidates).toHaveLength(1)
    const u=choice.side==='uMin'?1:choice.side==='uMax'?net.nu-2:Math.floor(net.nu/2)
    const v=choice.side==='vMin'?1:choice.side==='vMax'?net.nv-2:Math.floor(net.nv/2)
    const baseNet=structuredClone(net),inner=u*net.nv+v
    baseNet.poles[inner][2]+=.2
    return {editor,k,step,net,baseNet,choice,choices,inner}
  } catch(error) {editor.dispose();throw error}
  finally {owned.forEach(h=>k.release(h))}
}
const change=(net:Net,id:number,z=.12)=>{
  const out=structuredClone(net);out.poles[id][2]+=z;return out
}

describe('atomic published plane G1, real OCCT synthetic shell',()=>{
  it('keeps the active G1 witness when preparation of another plane fails',async()=>{
    const {editor,k,net,baseNet,choice}=await fixture()
    try {
      const published=await editor.publishG1PlaneTangency({baseNet,net,choice})
      const witness=editor.finalFaceWitness(published.preview.previewRevision)
      const fail=vi.spyOn(k,'fixShape').mockImplementation(()=>{throw Error('conversione non disponibile')})
      expect(()=>editor.select(choice.supportFaceIndex)).toThrow('conversione non disponibile')
      fail.mockRestore()
      expect(editor.finalFaceWitness(published.preview.previewRevision)).toEqual(witness)
      const resumed=await editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net})
      expect(resumed.constraintId).toBe(published.constraintId)
      expect(resumed.preview.valid).toBe(true)
    } finally {editor.dispose()}
  },60000)
  it('publishes a host revision and final-face witness, preserves UV identity and evaluates later interior edits',async()=>{
    const {editor,k,net,baseNet,choice,choices,inner}=await fixture()
    try {
      const before=editor.evaluate(baseNet,'G0'),anchor=editor.anchorFromPick(net.poles[12],before.previewRevision).anchor
      const proposal=await editor.proposeG1PlaneTangency({net:baseNet,choice})
      const published=await editor.publishG1PlaneTangency({baseNet,net:proposal.net,choice,exportStep:true})
      expect(published.preview.previewRevision).toBe(before.previewRevision+1)
      expect(published.validation.globalG1Certified).toBe(false)
      expect(published.net.poles[inner]).toEqual(net.poles[inner])
      expect(()=>editor.finalFaceWitness(before.previewRevision)).toThrow('cambiata')
      const witness=editor.finalFaceWitness(published.preview.previewRevision)
      expect(witness.selectionRevision).toBe(anchor.selectionRevision)
      const start=editor.resolveAnchor(anchor,published.preview.previewRevision)
      const moved=change(published.net,12),saved=structuredClone(moved)
      const next=await editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:moved,exportStep:true})
      expect(next.preview.previewRevision).toBe(published.preview.previewRevision+1)
      expect(next.constraintId).toBe(published.constraintId)
      expect(next.validation.edgeRegularity).toBe('outward-rounded-interval-proof')
      expect(next.validation.globalG1Certified).toBe(false)
      expect(editor.resolveAnchor(anchor,next.preview.previewRevision).at[2]).toBeGreaterThan(start.at[2]+.001)
      expect(moved).toEqual(saved)
      const final=editor.finalFaceWitness(next.preview.previewRevision),face=k.fromBREP(final.faceBrep),round=k.importStep(next.step!)
      const fs=k.getSubShapes(round,'face')
      try {
        expect(k.isValid(round)).toBe(true);expect(fs).toHaveLength(2)
        const p=k.pointOnSurface(face,anchor.u,anchor.v),q=k.pointOnSurface(fs[final.face],anchor.u,anchor.v)
        expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-8)
        expect(editor.resolveAnchor(anchor,next.preview.previewRevision).at).toEqual([p.x,p.y,p.z])
      } finally {fs.forEach(f=>k.release(f));k.release(round);k.release(face)}
      expect(await editor.g1SupportCandidates()).toEqual(choices)
      // Baseline remains immutable across geometry Undo/Redo, not last-published.
      const undo=await editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:published.net})
      const redo=await editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:moved})
      expect(undo.net).toEqual(published.net);expect(redo.net).toEqual(moved)
      expect(redo.preview.previewRevision).toBe(undo.preview.previewRevision+1)
      for(let i=0;i<net.poles.length;i++) if(boundaryLocked(net,i,'G1')) expect(redo.net.poles[i]).toEqual(published.net.poles[i])
    } finally {editor.dispose()}
  },60000)

  it('rejects forged registration, protected edits, structure changes and unsupported variable locks without replacing the witness',async()=>{
    const {editor,net,baseNet,choice,inner}=await fixture()
    try {
      const current=editor.evaluate(net,'G0'),old=editor.finalFaceWitness(current.previewRevision)
      await expect(editor.publishG1PlaneTangency({baseNet,net:change(net,12),choice})).rejects.toThrow('protetto')
      expect(editor.finalFaceWitness(current.previewRevision)).toEqual(old)
      const published=await editor.publishG1PlaneTangency({baseNet,net,choice})
      const witness=editor.finalFaceWitness(published.preview.previewRevision)
      for(const id of [0,inner]) await expect(editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:change(net,id)})).rejects.toThrow('protetto')
      const structure=structuredClone(net);structure.weights[12]*=1.01
      await expect(editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:structure})).rejects.toThrow()
      await expect(editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:change(net,12),lockedPoles:[12]})).rejects.toThrow('Nuovi blocchi')
      for(const locks of [[-1],[.5],[net.poles.length],[NaN]])
        await expect(editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net,lockedPoles:locks})).rejects.toThrow('Blocco')
      expect(editor.finalFaceWitness(published.preview.previewRevision)).toEqual(witness)
      const locked=await editor.publishG1PlaneTangency({baseNet,net,choice,lockedPoles:[12]})
      await expect(editor.evaluateG1PlaneTangency({constraintId:locked.constraintId,net:change(net,12),lockedPoles:[]})).rejects.toThrow('protetto')
      expect(editor.finalFaceWitness(locked.preview.previewRevision).previewRevision).toBe(locked.preview.previewRevision)
    } finally {editor.dispose()}
  },60000)

  it('snapshots inputs and refuses pending source, selection and preview changes; refinement invalidates the registration',async()=>{
    const {editor,net,baseNet,choice,step}=await fixture()
    try {
      const published=await editor.publishG1PlaneTangency({baseNet,net,choice})
      const input={constraintId:published.constraintId,net:change(net,12)}
      const expected=structuredClone(input.net),pending=editor.evaluateG1PlaneTangency(input)
      input.net.poles[0][2]+=999
      const accepted=await pending;expect(accepted.net).toEqual(expected)
      const stalePreview=editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net})
      const replacement=editor.evaluate(net,'G0'),witness=editor.finalFaceWitness(replacement.previewRevision)
      await expect(stalePreview).rejects.toThrow('scaduta')
      expect(editor.finalFaceWitness(replacement.previewRevision)).toEqual(witness)
      editor.selectRefined(choice.stamp.faceIndex,[])
      await expect(editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net})).rejects.toThrow('scaduto')
      const fresh=(await editor.g1SupportCandidates()).candidates[0]
      const next=await editor.publishG1PlaneTangency({baseNet,net,choice:fresh})
      const staleSource=editor.evaluateG1PlaneTangency({constraintId:next.constraintId,net})
      editor.open(step);editor.select(choice.stamp.faceIndex)
      await expect(staleSource).rejects.toThrow('scadut')
      await expect(editor.evaluateG1PlaneTangency({constraintId:next.constraintId,net})).rejects.toThrow('scaduto')
    } finally {editor.dispose()}
  },60000)

  it('retains the prior witness and releases isolated handles on late readback and STEP failures',async()=>{
    const {editor,k,net,baseNet,choice}=await fixture()
    const acquired:ShapeHandle[]=[],released:ShapeHandle[]=[],spies:{mockRestore():void}[]=[]
    for(const name of ['getSubShapes','sharedEdges','fromBREP','importStep','section','makeVertex','outerWire'] as const) {
      const fn=k[name].bind(k) as (...args:never[])=>ShapeHandle|ShapeHandle[]
      spies.push(vi.spyOn(k,name).mockImplementation(((...args:never[])=>{
        const value=fn(...args);acquired.push(...(Array.isArray(value)?value:[value]));return value
      }) as never))
    }
    const release=k.release.bind(k)
    spies.push(vi.spyOn(k,'release').mockImplementation(h=>{released.push(h);release(h)}))
    const outstanding=()=>{
      const remaining=[...acquired]
      for(const h of released) {const at=remaining.indexOf(h);expect(at).toBeGreaterThanOrEqual(0);remaining.splice(at,1)}
      return remaining
    }
    try {
      const published=await editor.publishG1PlaneTangency({baseNet,net,choice,exportStep:true})
      const witness=editor.finalFaceWitness(published.preview.previewRevision)
      expect(outstanding()).toHaveLength(1)
      const internal=editor as unknown as {checkPlaneTangencyReadback:()=>void}
      const readback=vi.spyOn(internal,'checkPlaneTangencyReadback').mockImplementation(()=>{throw Error('injected final readback')})
      await expect(editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:change(net,12)})).rejects.toThrow('injected final readback')
      readback.mockRestore()
      expect(editor.finalFaceWitness(published.preview.previewRevision)).toEqual(witness)
      expect(outstanding()).toHaveLength(1)
      const imported=vi.spyOn(k,'importStep').mockImplementation(()=>{throw Error('injected STEP import')})
      await expect(editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:change(net,12),exportStep:true})).rejects.toThrow('injected STEP import')
      imported.mockRestore()
      expect(editor.finalFaceWitness(published.preview.previewRevision)).toEqual(witness)
      expect(outstanding()).toHaveLength(1)
      const next=await editor.evaluateG1PlaneTangency({constraintId:published.constraintId,net:change(net,12)})
      expect(next.preview.previewRevision).toBe(published.preview.previewRevision+1)
      expect(outstanding()).toHaveLength(1)
      // Release the transferred host face without adding unrelated preparation handles.
      ;(editor as unknown as {releasePreviewFace:()=>void}).releasePreviewFace()
      expect(outstanding()).toHaveLength(0)
    } finally {spies.forEach(spy=>spy.mockRestore());editor.dispose()}
  },60000)
})

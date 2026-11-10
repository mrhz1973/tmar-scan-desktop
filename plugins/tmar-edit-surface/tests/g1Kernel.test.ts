// SPDX-License-Identifier: AGPL-3.0-only
import { describe,it,expect,vi } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel } from '../editorKernel'
import { boundaryLocked, replaceSurface, surfaceTable, type Net } from '../brep'
import type { G1SupportCandidate } from '../g1SupportTopology'

async function fixture() {
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const rectangle=(x:number) => {
    const p=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
    const edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%4]));owned.push(...edges)
    const wire=k.makeWire(edges);owned.push(wire)
    const face=k.makeFace(wire);owned.push(face);return face
  }
  try {
    const left=rectangle(0),right=rectangle(10),shell=k.sew([left,right],1e-7);owned.push(shell)
    const step=k.exportStep(shell),opened=editor.open(step)
    expect(opened.faces).toHaveLength(2)
    const index=opened.faces.findIndex(f=>!f.reason)
    expect(index).toBeGreaterThanOrEqual(0)
    const net=editor.select(index),{candidates}=await editor.g1SupportCandidates()
    expect(candidates).toHaveLength(1)
    return {editor,step,net,choice:candidates[0]}
  } catch(e) {editor.dispose();throw e}
  finally {owned.forEach(h=>k.release(h))}
}
function firstInnerCentre(net:Net,choice:G1SupportCandidate) {
  const u=choice.side==='uMin'?1:choice.side==='uMax'?net.nu-2:Math.floor(net.nu/2)
  const v=choice.side==='vMin'?1:choice.side==='vMax'?net.nv-2:Math.floor(net.nv/2)
  return u*net.nv+v
}
function raised(net:Net,choice:G1SupportCandidate,height=.2) {
  const copy=structuredClone(net),index=firstInnerCentre(net,choice)
  copy.poles[index]=copy.poles[index].map((x,d)=>x+height*choice.plane.normal[d]) as [number,number,number]
  return {net:copy,index}
}

describe('planar G1 dedicated kernel path, real OCCT synthetic shell',()=>{
  it('validates base and final CAD, returns STEP/proof and preserves the active draft and preview witness',async()=>{
    const {editor,net,choice}=await fixture(),k=editor.kernel
    try {
      const base=raised(net,choice),saved=structuredClone(base.net)
      const preview=editor.evaluate(base.net,'G0'),witness=editor.finalFaceWitness(preview.previewRevision)
      const anchor=editor.anchorFromPick(net.poles[12],preview.previewRevision).anchor
      const beforeAnchor=editor.resolveAnchor(anchor,preview.previewRevision)
      expect(()=>editor.evaluate(base.net,'G1')).toThrow('protetto')
      // Reestablish the current witness after the intentional legacy refusal.
      const current=editor.evaluate(base.net,'G0'),currentWitness=editor.finalFaceWitness(current.previewRevision)
      const result=await editor.proposeG1PlaneTangency({net:base.net,choice,exportStep:true})
      expect(result.changedIndices).toEqual([base.index])
      expect(result.net.poles[base.index]).toEqual(net.poles[base.index])
      expect(result.validation.edgeRegularity).toBe('outward-rounded-interval-proof')
      expect(result.validation.globalG1Certified).toBe(false)
      expect(result.preview.valid).toBe(true);expect(result.preview.faceMeshes).toHaveLength(2)
      expect(result.preview.previewRevision).toBeUndefined()
      expect(result.revisions.preview).toBe(current.previewRevision)
      expect(result.stamp).toEqual(choice.stamp)
      expect(result.step).toContain('ISO-10303-21')
      expect(base.net).toEqual(saved)
      expect(editor.finalFaceWitness(current.previewRevision)).toEqual(currentWitness)
      expect(editor.resolveAnchor(anchor,current.previewRevision)).toEqual(beforeAnchor)
      expect(witness.face).toBe(currentWitness.face)
      const imported=k.importStep(result.step!),fs=k.getSubShapes(imported,'face')
      try {expect(k.isValid(imported)).toBe(true);expect(fs).toHaveLength(2)}
      finally {fs.forEach(f=>k.release(f));k.release(imported)}
      const checked=await editor.validateG1PlaneTangency({baseNet:base.net,net:result.net,choice})
      expect(checked.net).toEqual(result.net)
      expect(checked.validation.globalG1Certified).toBe(false)
      for(let id=0;id<net.poles.length;id++) if(boundaryLocked(net,id,'G0')||id!==base.index)
        expect(checked.net.poles[id]).toEqual(saved.poles[id])
      expect(await editor.g1SupportCandidates()).toEqual({stamp:choice.stamp,candidates:[choice]})
    } finally {editor.dispose()}
  },60000)

  it('re-resolves forged plane coordinates and refuses incompatible locks, unsafe base and protected edits atomically',async()=>{
    const {editor,net,choice}=await fixture()
    try {
      const base=raised(net,choice),active=editor.evaluate(net,'G0'),before=editor.finalFaceWitness(active.previewRevision)
      const forged=structuredClone(choice);forged.plane={origin:[999,999,999],normal:[1,0,0]}
      const valid=await editor.proposeG1PlaneTangency({net:base.net,choice:forged})
      expect(valid.choice.plane).toEqual(choice.plane)
      await expect(editor.proposeG1PlaneTangency({net:base.net,choice,lockedPoles:[base.index]})).rejects.toThrow('incompatibile')
      for(const lockedPoles of [[-1],[net.poles.length],[.5],[NaN]])
        await expect(editor.proposeG1PlaneTangency({net,choice,lockedPoles})).rejects.toThrow('Blocco')
      const unsafe=raised(net,choice,1e5).net
      await expect(editor.proposeG1PlaneTangency({net:unsafe,choice})).rejects.toThrow()
      const protectedEdit=structuredClone(valid.net);protectedEdit.poles[0][2]+=.1
      await expect(editor.validateG1PlaneTangency({baseNet:base.net,net:protectedEdit,choice})).rejects.toThrow('protetto')
      const otherRing=structuredClone(valid.net),id=net.nv+1
      otherRing.poles[id][2]+=.01
      await expect(editor.validateG1PlaneTangency({baseNet:base.net,net:otherRing,choice})).rejects.toThrow('protetto')
      await expect(editor.proposeG1PlaneTangency({net,choice:{...choice,edgeIndex:99}})).rejects.toThrow('non disponibile')
      expect(editor.finalFaceWitness(active.previewRevision)).toEqual(before)
    } finally {editor.dispose()}
  },60000)

  it('refuses stale selection/reopening and in-flight preview changes without returning a retargeted result',async()=>{
    const {editor,net,choice,step}=await fixture()
    try {
      const pending=editor.proposeG1PlaneTangency({net,choice})
      editor.evaluate(net,'G0')
      await expect(pending).rejects.toThrow('scaduta')
      const active=editor.evaluate(net,'G0'),before=editor.finalFaceWitness(active.previewRevision)
      const resolve=vi.spyOn(editor,'resolveG1SupportCandidate')
      const input={net:structuredClone(net),choice:structuredClone(choice)}
      const call=editor.proposeG1PlaneTangency(input)
      input.net.poles[0][0]+=999;input.choice.edgeIndex=999
      expect((await call).net).toEqual(net)
      expect(resolve).toHaveBeenCalled()
      expect(editor.finalFaceWitness(active.previewRevision)).toEqual(before)
      editor.selectRefined(choice.stamp.faceIndex,[])
      await expect(editor.proposeG1PlaneTangency({net,choice})).rejects.toThrow('scaduta')
      editor.open(step);editor.select(choice.stamp.faceIndex)
      await expect(editor.proposeG1PlaneTangency({net,choice})).rejects.toThrow('scaduta')
    } finally {editor.dispose()}
  },60000)

  it('rejects an OCCT readback differing from the verified proposal and retains the active witness',async()=>{
    const {editor,net,choice}=await fixture(),k=editor.kernel
    try {
      const active=editor.evaluate(net,'G0'),before=editor.finalFaceWitness(active.previewRevision)
      const read=k.fromBREP.bind(k);let reads=0
      const spy=vi.spyOn(k,'fromBREP').mockImplementation(text=>{
        // Third parse is final evaluate: inject a valid interior change that
        // legacy G0 permits, but the dedicated final coefficient check must reject.
        if(++reads===3) {
          const record=surfaceTable(text).find(r=>r.net)!,changed=structuredClone(record.net!)
          changed.poles[12][2]+=.01
          return read(replaceSurface(text,record,changed))
        }
        return read(text)
      })
      try {
        await expect(editor.proposeG1PlaneTangency({net,choice})).rejects.toThrow('Reticolo CAD finale diverso')
        expect(reads).toBe(3)
      } finally {spy.mockRestore()}
      expect(editor.finalFaceWitness(active.previewRevision)).toEqual(before)
    } finally {editor.dispose()}
  },60000)

  it('releases isolated handles on success, final CAD readback refusal and a STEP reimport read failure',async()=>{
    const {editor,net,choice}=await fixture(),k=editor.kernel
    const acquired:ShapeHandle[]=[],released:ShapeHandle[]=[],spies:{mockRestore():void}[]=[]
    let fault:'none'|'readback'|'imported-face'='none',parses=0,importedHandle:ShapeHandle|undefined
    // All handle-producing calls exercised by this natural planar path.
    for(const name of ['getSubShapes','sharedEdges','fromBREP','importStep','section','makeVertex','outerWire'] as const) {
      const fn=k[name].bind(k) as (...args:never[])=>ShapeHandle|ShapeHandle[]
      spies.push(vi.spyOn(k,name).mockImplementation(((...args:never[])=>{
        if(name==='getSubShapes' && fault==='imported-face' && args[0]===importedHandle && args[1]==='face')
          throw Error('injected STEP face read failure')
        if(name==='fromBREP' && fault==='readback' && ++parses===3) {
          const text=args[0] as string,record=surfaceTable(text).find(r=>r.net)!,changed=structuredClone(record.net!)
          changed.poles[12][2]+=.01
          args[0]=replaceSurface(text,record,changed) as never
        }
        const value=fn(...args)
        if(name==='importStep') importedHandle=value as ShapeHandle
        acquired.push(...(Array.isArray(value)?value:[value]));return value
      }) as never))
    }
    const release=k.release.bind(k)
    spies.push(vi.spyOn(k,'release').mockImplementation(h=>{released.push(h);release(h)}))
    try {
      await editor.proposeG1PlaneTangency({net:raised(net,choice).net,choice,exportStep:true})
      await expect(editor.proposeG1PlaneTangency({net:raised(net,choice).net,choice,lockedPoles:[firstInnerCentre(net,choice)]})).rejects.toThrow('incompatibile')
      expect([...released].sort((a,b)=>a-b)).toEqual([...acquired].sort((a,b)=>a-b))
      fault='readback';parses=0
      await expect(editor.proposeG1PlaneTangency({net,choice})).rejects.toThrow('Reticolo CAD finale diverso')
      expect(parses).toBe(3)
      expect([...released].sort((a,b)=>a-b)).toEqual([...acquired].sort((a,b)=>a-b))
      fault='imported-face';importedHandle=undefined
      await expect(editor.proposeG1PlaneTangency({net,choice,exportStep:true})).rejects.toThrow('injected STEP face read failure')
      expect(importedHandle).toBeDefined()
      expect(released).toContain(importedHandle)
      expect([...released].sort((a,b)=>a-b)).toEqual([...acquired].sort((a,b)=>a-b))
    } finally {spies.forEach(spy=>spy.mockRestore());editor.dispose()}
  },60000)
})

// SPDX-License-Identifier: AGPL-3.0-only
// Isolated host research only; no plugin import, GUI or user CAD session.
import {describe,expect,it} from 'vitest'
import {OcctKernel} from 'occt-wasm'
import type {ShapeHandle} from 'occt-wasm'
import {
  screenNativeSewingLineage,supportsNativeSewingLineage,
  type NativeSewingTraceV1,
} from '../core/nativeSewingLineageContract'

const protectedFaces=[1,2,3,4,5,6]
const sharedFaceTrace=():NativeSewingTraceV1=>({
  schema:'tmar.native-sewing-lineage',version:1,
  stage:'post-sew-pre-heal',
  provenance:'BRepBuilderAPI_Sewing/ModifiedSubShape',
  inputFaceCount:7,outputFaceCount:7,
  relations:[
    {inputFace:0,outputFace:4,relation:'modified'},
    {inputFace:1,outputFace:0,relation:'unchanged'},
    {inputFace:2,outputFace:1,relation:'modified'},
    {inputFace:3,outputFace:2,relation:'unchanged'},
    {inputFace:4,outputFace:3,relation:'modified'},
    {inputFace:5,outputFace:5,relation:'modified'},
    {inputFace:6,outputFace:6,relation:'modified'},
  ],
})
describe('native sewing lineage contract (not integrated)',()=>{
  it('screens a strictly one-to-one 7-face shared-support scenario but grants no geometric qualification',()=>{
    const screened=screenNativeSewingLineage(sharedFaceTrace(),0,protectedFaces)
    expect(screened.status).toBe('structural-only')
    if(screened.status!=='structural-only')throw Error(screened.reason)
    expect([...screened.byInputFace]).toHaveLength(7)
    expect(screened.changedInputs).toEqual([0,2,4,5,6])
    expect(screened.protectedInputs).toEqual(protectedFaces)
  })
  it('refuses two neighboring faces mapping to one sewn result',()=>{
    const trace=sharedFaceTrace()
    const relations=trace.relations.map(x=>x.inputFace===6
      ? {...x,outputFace:5}:x)
    expect(screenNativeSewingLineage({...trace,relations},0,protectedFaces).status).toBe('refused')
  })
  it('refuses incomplete, deleted, unknown and split lineage instead of guessing',()=>{
    const trace=sharedFaceTrace()
    for(const invalid of [
      {...trace,relations:trace.relations.slice(0,6)},
      {...trace,relations:trace.relations.map(x=>x.inputFace===3
        ? {...x,relation:'deleted' as const,outputFace:null}:x)},
      {...trace,relations:trace.relations.map(x=>x.inputFace===4
        ? {...x,relation:'unresolved' as const,outputFace:null}:x)},
      {...trace,outputFaceCount:8},
      {...trace,inputFaceCount:8},
    ])expect(screenNativeSewingLineage(invalid,0,protectedFaces).status).toBe('refused')
  })
  it('refuses dishonest stages, invalid index sets and missing native evidence',()=>{
    const trace=sharedFaceTrace()
    expect(screenNativeSewingLineage({...trace,stage:'post-sew-pre-heal' as const,
      provenance:'BRepBuilderAPI_Sewing/ModifiedSubShape'},0,protectedFaces).status).toBe('structural-only')
    expect(screenNativeSewingLineage({...trace,stage:'post-heal' as NativeSewingTraceV1['stage']},0,protectedFaces).status).toBe('refused')
    expect(screenNativeSewingLineage(trace,0,[1,2,3,4,5,5]).status).toBe('refused')
    expect(screenNativeSewingLineage(trace,0,[0,2,3,4,5,6]).status).toBe('refused')
    expect(screenNativeSewingLineage(trace,9,protectedFaces).status).toBe('refused')
    expect(supportsNativeSewingLineage(null)).toBe(false)
    expect(supportsNativeSewingLineage({sewAndSolidify(){}})).toBe(false)
  })
  it('real OCCT split-top 7-face sewing works but pinned WASM cannot produce native lineage',async()=>{
    const k=await OcctKernel.init(),owned:ShapeHandle[]=[]
    const own=(shape:ShapeHandle)=>{owned.push(shape);return shape}
    try{
      expect(supportsNativeSewingLineage(k)).toBe(false)
      const box=own(k.makeBox(20,20,10))
      const faces=k.getSubShapes(box,'face');owned.push(...faces)
      const top=faces.find(f=>{
        const b=k.uvBounds(f)
        const p=k.pointOnSurface(f,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
        return Math.abs(p.z-10)<1e-8
      })
      expect(top).toBeDefined()
      const divider=own(k.makeLineEdge({x:10,y:0,z:10},{x:10,y:20,z:10}))
      const split=own(k.split(top!,[divider]))
      const parts=k.getSubShapes(split,'face');owned.push(...parts)
      expect(parts).toHaveLength(2)
      const sewn=own(k.sewAndSolidify([...faces.filter(f=>f!==top),...parts],1e-7))
      expect(k.isValid(sewn)).toBe(true)
      const imported=own(k.importStep(k.exportStep(sewn)))
      const roundFaces=k.getSubShapes(imported,'face');owned.push(...roundFaces)
      expect(roundFaces).toHaveLength(7)
      expect(k.isValid(imported)).toBe(true)
      // No native IsModified/ModifiedSubShape trace in occt-wasm 5.7.1.
      // A valid solid MUST NOT be mistaken for a qualified lineage.
      expect(supportsNativeSewingLineage(k)).toBe(false)
    }finally{
      owned.reverse().forEach(x=>k.release(x))
      k[Symbol.dispose]()
    }
  },60000)
})

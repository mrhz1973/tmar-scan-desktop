// SPDX-License-Identifier: AGPL-3.0-only
import { describe,it,expect,vi } from 'vitest'
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { listG1SupportCandidates,resolveG1SupportCandidate,type G1SourceStamp } from '../g1SupportTopology'
import { surfaceTable,signature,replaceSurface,planeNet } from '../brep'

const stamp:G1SourceStamp={sourceId:'frozen-synthetic-step',sourceRevision:1,selectionRevision:2,faceIndex:0}
const wrapped=(k:OcctKernel,overrides:Record<string,unknown>)=>new Proxy(k,{get(target,key){if(key in overrides)return overrides[key as string];const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v}})

describe('exact source topology for planar G1 support choices',()=>{
  it('finds four exact box neighbours after STEP import; IDs are fenced and source unchanged',async()=>{
    const k=await OcctKernel.init(),box=k.makeBox(10,20,30),source=k.importStep(k.exportStep(box))
    try {
      const before=k.toBREP(source),hash=vi.fn(()=>0),api=wrapped(k,{hashCode:hash})
      const choices=listG1SupportCandidates(api,source,stamp)
      expect(choices).toHaveLength(4)
      expect(choices.map(c=>c.lengthMm).sort((a,b)=>a-b)).toEqual([20,20,30,30])
      expect(new Set(choices.map(c=>c.side)).size).toBe(4)
      expect(new Set(choices.map(c=>c.id)).size).toBe(4)
      expect(hash).not.toHaveBeenCalled()
      expect(resolveG1SupportCandidate(k,source,stamp,choices[0])).toEqual(choices[0])
      for(const changed of [{...stamp,sourceRevision:2},{...stamp,selectionRevision:3},{...stamp,sourceId:'other'},{...stamp,faceIndex:1}])
        expect(()=>resolveG1SupportCandidate(k,source,changed,choices[0])).toThrow('scaduta')
      expect(()=>resolveG1SupportCandidate(k,source,stamp,{...choices[0],edgeIndex:99})).toThrow('non disponibile')
      expect(k.toBREP(source)).toBe(before)
    }finally{k.release(source);k.release(box);k[Symbol.dispose]()}
  },60000)

  it('does not invent shared edges between distinct coincident solids',async()=>{
    const k=await OcctKernel.init(),a=k.makeBox(10,20,30),b=k.makeBox(10,20,30),source=k.makeCompound([a,b])
    try{expect(listG1SupportCandidates(k,source,stamp)).toHaveLength(4)}finally{[source,a,b].forEach(h=>k.release(h));k[Symbol.dispose]()}
  },60000)

  it('certifies a curved rational NURBS face only where all boundary poles prove straight natural sides',async()=>{
    const k=await OcctKernel.init(),box=k.makeBox(10,20,30),faces=k.getSubShapes(box,'face')
    let raw:ShapeHandle|undefined,source:ShapeHandle|undefined
    try{
      const face=faces[0],own=surfaceTable(k.toBREP(face))[0],text=k.toBREP(box),record=surfaceTable(text).find(r=>signature(r)===signature(own))!,b=k.uvBounds(face)
      const net=planeNet(own,[b.uMin,b.uMax,b.vMin,b.vMax])
      net.poles[12][0]+=.5;net.weights[12]=1.3;net.rational=[1,1]
      raw=k.fromBREP(replaceSurface(text,record,net));source=k.importStep(k.exportStep(raw))
      const sourceFaces=k.getSubShapes(source,'face')
      try{
        const faceIndex=sourceFaces.findIndex(f=>k.surfaceType(f)==='bspline')
        expect(faceIndex).toBeGreaterThanOrEqual(0)
        expect(listG1SupportCandidates(k,source,{...stamp,faceIndex})).toHaveLength(4)
      }finally{sourceFaces.forEach(h=>k.release(h))}
    }finally{faces.forEach(h=>k.release(h));if(source!==undefined)k.release(source);if(raw!==undefined)k.release(raw);k.release(box);k[Symbol.dispose]()}
  },60000)

  it('refuses curved/periodic boundaries rather than calling UV samples exact',async()=>{
    const k=await OcctKernel.init(),cylinder=k.makeCylinder(5,20),faces=k.getSubShapes(cylinder,'face')
    try{
      for(let faceIndex=0;faceIndex<faces.length;faceIndex++)expect(()=>listG1SupportCandidates(k,cylinder,{...stamp,faceIndex})).toThrow()
    }finally{faces.forEach(h=>k.release(h));k.release(cylinder);k[Symbol.dispose]()}
  },60000)

  it('refuses a real drilled face with an inner wire',async()=>{
    const k=await OcctKernel.init(),box=k.makeBox(20,20,10),cylinder=k.makeCylinder(2,20),tool=k.translate(cylinder,10,10,-5),source=k.cut(box,tool),faces=k.getSubShapes(source,'face')
    try{
      const faceIndex=faces.findIndex(f=>{
        const wires=k.getSubShapes(f,'wire')
        try{return k.surfaceType(f)==='plane'&&wires.length===2}finally{wires.forEach(h=>k.release(h))}
      })
      expect(faceIndex).toBeGreaterThanOrEqual(0)
      expect(()=>listG1SupportCandidates(k,source,{...stamp,faceIndex})).toThrow('senza fori')
    }finally{faces.forEach(h=>k.release(h));[source,tool,cylinder,box].forEach(h=>k.release(h));k[Symbol.dispose]()}
  },60000)

  it('rejects injected nonmanifold incidence and releases every acquired handle',async()=>{
    const k=await OcctKernel.init(),source=k.makeBox(10,20,30),faces=k.getSubShapes(source,'face'),acquired:ShapeHandle[]=[],released:ShapeHandle[]=[]
    const api=wrapped(k,{
      getSubShapes:(s:ShapeHandle,type:Parameters<OcctKernel['getSubShapes']>[1])=>{
        // Deterministic topology fault injection: unrelated opposite face now
        // reports the selected face edges, making the first edge have 3 owners.
        const hs=k.getSubShapes(type==='edge'&&k.isSame(s,faces[1])?faces[0]:s,type)
        acquired.push(...hs);return hs
      },
      sharedEdges:(a:ShapeHandle,b:ShapeHandle)=>{const hs=k.sharedEdges(a,b);acquired.push(...hs);return hs},
      release:(h:ShapeHandle)=>{released.push(h);k.release(h)},
    })
    try{
      expect(()=>listG1SupportCandidates(api,source,stamp)).toThrow('non manifold')
      expect(released).toEqual(acquired)
    }finally{faces.forEach(h=>k.release(h));k.release(source);k[Symbol.dispose]()}
  },60000)

  it('releases a face list when a later topology read throws',async()=>{
    const k=await OcctKernel.init(),source=k.makeBox(1,2,3),acquired:ShapeHandle[]=[],released:ShapeHandle[]=[]
    const api=wrapped(k,{
      getSubShapes:(s:ShapeHandle,type:Parameters<OcctKernel['getSubShapes']>[1])=>{if(type==='wire')throw Error('injected read failure');const hs=k.getSubShapes(s,type);acquired.push(...hs);return hs},
      release:(h:ShapeHandle)=>{released.push(h);k.release(h)},
    })
    try{expect(()=>listG1SupportCandidates(api,source,stamp)).toThrow('injected read failure');expect(released).toEqual(acquired)}finally{k.release(source);k[Symbol.dispose]()}
  },60000)
})

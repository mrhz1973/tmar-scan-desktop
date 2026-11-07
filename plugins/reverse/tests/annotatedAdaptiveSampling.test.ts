// SPDX-License-Identifier: AGPL-3.0-only
// Host-only safety regression: a narrow trimmed annulus can have zero hits
// at 9x9, yet retain a real UV interior. No plugin or user CAD is involved.
import {describe,expect,it} from 'vitest'
import type {OcctLike} from '../core/occtTypes'
import type {DraftCopyFaceNoteV1} from '../../../src/plugins/annotatedCopyTypes'
import {verifyCopyFace} from '../core/kernelAnnotatedNotes'

const U=0.46,V=0.42,INNER=0.133,OUTER=0.158
const inTrim=(u:number,v:number)=>{
  const r=Math.hypot(u-U,v-V)
  return r>INNER && r<OUTER
}
const gridCount=(divisions:number)=>{
  let count=0
  for(let i=0;i<=divisions;i++)for(let j=0;j<=divisions;j++)
    if(inTrim(i/divisions,j/divisions))count++
  return count
}
type FixtureOptions={
  candidates?:number[]
  candidateDisplacement?:boolean
  noInterior?:boolean
  invalidBounds?:boolean
  nonfiniteSample?:boolean
}
function fixture(options:FixtureOptions={}){
  const calls={classify:0,release:[] as number[]}
  const candidates=options.candidates??[2]
  const k={
    fromBREP:(value:string)=>{if(value!=='thin-witness')throw Error('bad fixture');return 1},
    getShapeType:()=> 'face',
    isValid:()=>true,
    getSubShapes:(body:number,kind:string)=>kind==='face'&&body===99? [...candidates] : [],
    subShapeCount:()=>0,
    getSurfaceArea:()=>Math.PI*(OUTER*OUTER-INNER*INNER),
    getSurfaceCenterOfMass:()=>({x:U,y:V,z:0}),
    uvBounds:()=>options.invalidBounds? {uMin:1,uMax:1,vMin:0,vMax:1} : {uMin:0,uMax:1,vMin:0,vMax:1},
    classifyPointOnFace:(_face:number,u:number,v:number)=>{
      calls.classify++
      return !options.noInterior&&inTrim(u,v)?'in':'out'
    },
    pointOnSurface:(face:number,u:number,v:number)=>({
      x:u,y:v,z:options.nonfiniteSample?NaN:options.candidateDisplacement&&face===2&&u>0.5?0.001:0,
    }),
    surfaceType:()=> 'bspline',
    uvFromPoint:(_face:number,p:{x:number;y:number;z:number})=>({u:p.x,v:p.y}),
    shapeOrientation:()=> 'forward',
    surfaceNormal:()=>({x:0,y:0,z:1}),
    hashCode:()=>77,
    release:(handle:number)=>{calls.release.push(handle)},
  } as unknown as OcctLike
  const note:DraftCopyFaceNoteV1={
    draftId:'thin-1',text:'Inspect the thin trimmed surface',
    target:{kind:'copy-face',witnessKey:'thin',
      sourceUV:[U+0.145,V],resolvedAt:[U+0.145,V,0],orientedNormal:[0,0,1],
      resolvedStamp:{sessionId:'thin-qa',sourceEpoch:1,selectionEpoch:1,draftEpoch:1,requestId:1}},
  }
  return {k,note,calls}
}

describe('host adaptive trimmed-face annotation sampling',()=>{
  it('finds well-spread interior witnesses after 9x9 misses, retaining strict face and note matching',()=>{
    expect(gridCount(8)).toBe(0)   // 9x9 original production grid
    expect(gridCount(16)).toBe(6)  // 17x17 still sparse
    expect(gridCount(32)).toBeGreaterThan(12)
    const {k,note,calls}=fixture()
    const result=verifyCopyFace(k,99,'thin-witness',[note])
    expect(result.samples).toBeGreaterThanOrEqual(12)
    expect(result.toleranceMm).toBe(1e-5)
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].at).toEqual(note.target.resolvedAt)
    expect(result.notes[0].normal).toEqual([0,0,1])
    expect(calls.release).toContain(1)
    expect(calls.release).toContain(2)
  })
  it('continues to reject ambiguous or geometrically different destinations',()=>{
    const ambiguous=fixture({candidates:[2,3]})
    expect(()=>verifyCopyFace(ambiguous.k,99,'thin-witness',[ambiguous.note])).toThrow(/non univoca/)
    const shifted=fixture({candidateDisplacement:true})
    expect(()=>verifyCopyFace(shifted.k,99,'thin-witness',[shifted.note])).toThrow(/non univoca/)
  })
  it('rejects a note in the trim hole and a reversed note normal',()=>{
    const outside=fixture()
    const hole:DraftCopyFaceNoteV1={...outside.note,target:{...outside.note.target,
      sourceUV:[U,V],resolvedAt:[U,V,0]}}
    expect(()=>verifyCopyFace(outside.k,99,'thin-witness',[hole])).toThrow(/esterna al contorno|nel foro/)
    const reversed=fixture()
    const wrong:DraftCopyFaceNoteV1={...reversed.note,target:{...reversed.note.target,orientedNormal:[0,0,-1]}}
    expect(()=>verifyCopyFace(reversed.k,99,'thin-witness',[wrong])).toThrow(/normale/)
  })
  it('fails closed with bounded cost when interior evidence is absent',()=>{
    const {k,note,calls}=fixture({noInterior:true})
    expect(()=>verifyCopyFace(k,99,'thin-witness',[note])).toThrow(/troppo sottile|dominio non verificabile/)
    expect(calls.classify).toBe(65*65)
    expect(calls.release).toContain(1)
  })
  it('rejects degenerate UV bounds and non-finite CAD evaluations',()=>{
    const bounds=fixture({invalidBounds:true})
    expect(()=>verifyCopyFace(bounds.k,99,'thin-witness',[bounds.note])).toThrow(/degenere/)
    const nonfinite=fixture({nonfiniteSample:true})
    expect(()=>verifyCopyFace(nonfinite.k,99,'thin-witness',[nonfinite.note])).toThrow(/non finito/)
  })
})

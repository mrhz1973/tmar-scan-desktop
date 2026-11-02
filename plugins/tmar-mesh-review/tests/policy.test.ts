// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { meshNoteBlock, meshReviewBlock, meshTargetLabel, type MeshReviewState } from '../policy'
const base: MeshReviewState = { tool:null, status:'idle', trimStatus:'idle', editing:false, confirming:false,
  copyTriangles:null, report:null, view:'scan', shownScan:true, shownReduced:false, shownPiece:false, shownBodies:[], trimMade:null }
describe('Mesh Tools review interaction policy',()=>{
  it('allows original scan inspection and notes without an agent',()=>{
    expect(meshReviewBlock(base,true,false,false)).toBeNull();expect(meshNoteBlock(base,true,false,false)).toBeNull()
  })
  it.each(['delete','holes','trim','cut','smooth','flip','boolean','offset','shell','islands'])('protects active %s tool clicks',tool=>{
    expect(meshReviewBlock({...base,tool},true,false,false)).toContain('Close the active')
  })
  it('protects marking and pending commands without discarding them',()=>{
    expect(meshReviewBlock(base,true,false,true)).toBeTruthy()
    expect(meshReviewBlock(base,true,true,false)).toBeTruthy()
    expect(meshReviewBlock({...base,confirming:true},true,false,false)).toBeTruthy()
  })
  it('distinguishes previews from persisted scan anchors',()=>{
    const copy={...base,copyTriangles:500}
    expect(meshReviewBlock(copy,true,false,false)).toBeNull()
    expect(meshNoteBlock(copy,true,false,false)).toContain('edited preview')
    expect(meshTargetLabel(copy)).toBe('Edited copy (preview)')
    const reduced={...base,report:{},shownReduced:true}
    expect(meshTargetLabel(reduced)).toBe('Reduced mesh (preview)')
    expect(meshNoteBlock(reduced,true,false,false)).toContain('Switch from Reduced')
  })
  it('allows notes on the original scan-side accuracy map',()=>{
    expect(meshNoteBlock({...base,tool:'reduce',report:{},view:'deviation'},true,false,false)).toBeNull()
  })
  it('does not place notes through hidden scans or overlaid solids',()=>{
    expect(meshNoteBlock({...base,shownScan:false},true,false,false)).toContain('Show the scan')
    expect(meshNoteBlock({...base,shownBodies:['body']},true,false,false)).toContain('Hide the overlaid')
    expect(meshReviewBlock(base,false,false,false)).toContain('Load a mesh')
  })
})

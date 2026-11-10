// SPDX-License-Identifier: AGPL-3.0-only
// Native, isolated fixture: a 0.1 mm annulus, not a sampled CAD production part.
// Exercises the existing correspondence criteria without widening tolerances.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import type { DraftCopyFaceNoteV1 } from '../../../src/plugins/annotatedCopyTypes'
import { verifyCopyFace } from '../core/kernelAnnotatedNotes'

let k: Awaited<ReturnType<typeof OcctKernel.init>>
beforeAll(async () => { k = await OcctKernel.init() }, 60000)
afterAll(() => k?.[Symbol.dispose]())

function annulus() {
  const handles: ShapeHandle[] = []
  const keep = (h: ShapeHandle) => { handles.push(h); return h }
  const outer = keep(k.makeCircleEdge({x:0,y:0,z:0},{x:0,y:0,z:1},10))
  const inner = keep(k.makeCircleEdge({x:0,y:0,z:0},{x:0,y:0,z:1},9.9))
  const outerWire = keep(k.makeWire([outer])), innerWire = keep(k.makeWire([inner]))
  const disk = keep(k.makeFace(outerWire)), ring = keep(k.addHolesInFace(disk,[innerWire]))
  const solid = keep(k.extrude(ring,0,0,1))
  const reopened = keep(k.importStep(k.exportStep(solid)))
  const faces = k.getSubShapes(reopened,'face'); handles.push(...faces)
  const face = faces.find(f => {
    const b = k.getBoundingBox(f)
    return Math.abs(b.zmin - 1) < 1e-6 && Math.abs(b.zmax - 1) < 1e-6
  })
  if (face === undefined) throw Error('Native annulus top face not found')
  return {solid:reopened,face,dispose:()=>handles.reverse().forEach(h=>k.release(h))}
}

function interiorCount(face: ShapeHandle, divisions: number) {
  const b = k.uvBounds(face)
  let count = 0
  for (let i=0;i<=divisions;i++) for (let j=0;j<=divisions;j++) {
    const u=b.uMin+(b.uMax-b.uMin)*i/divisions, v=b.vMin+(b.vMax-b.vMin)*j/divisions
    if (k.classifyPointOnFace(face,u,v)==='in') count++
  }
  return count
}

function noteAt(face: ShapeHandle, x: number, y: number): DraftCopyFaceNoteV1 {
  const uv=k.uvFromPoint(face,{x,y,z:1}), p=k.pointOnSurface(face,uv.u,uv.v), n=k.surfaceNormal(face,uv.u,uv.v)
  return {draftId:'native-thin-note',text:'Native annulus note',target:{kind:'copy-face',witnessKey:'thin-annulus',
    sourceUV:[uv.u,uv.v],resolvedAt:[p.x,p.y,p.z],orientedNormal:[n.x,n.y,n.z],
    resolvedStamp:{sessionId:'native-thin-annulus',sourceEpoch:1,selectionEpoch:1,draftEpoch:1,requestId:1}}}
}

describe('native thin annular face annotation correspondence', () => {
  it('refines beyond the empty 9×9 interior grid and binds a note after a real STEP roundtrip', () => {
    const f=annulus()
    try {
      expect(k.isValid(f.solid)).toBe(true)
      expect(k.subShapeCount(f.solid,'solid')).toBe(1)
      expect(k.subShapeCount(f.face,'wire')).toBe(2)
      expect(k.getSurfaceArea(f.face)).toBeCloseTo(Math.PI*(100-9.9**2),6)
      expect(interiorCount(f.face,8)).toBeLessThan(12)
      expect(interiorCount(f.face,64)).toBeGreaterThanOrEqual(12)
      const note=noteAt(f.face,9.95,0)
      const matched=verifyCopyFace(k as never,f.solid,k.toBREP(f.face),[note])
      expect(matched.toleranceMm).toBe(1e-5)
      expect(matched.samples).toBeGreaterThanOrEqual(12+18)
      expect(matched.notes).toHaveLength(1)
      expect(matched.notes[0].at[0]).toBeCloseTo(9.95,10)
      expect(matched.notes[0].at[2]).toBeCloseTo(1,10)
      expect(matched.notes[0].normal[2]).toBeGreaterThan(1-1e-6)
    } finally { f.dispose() }
  },60000)

  it('rejects a hole anchor, an inverted normal and a displaced destination on that same native geometry', () => {
    const f=annulus()
    let shifted: ShapeHandle | undefined
    try {
      const witness=k.toBREP(f.face), note=noteAt(f.face,9.95,0), hole=noteAt(f.face,0,0)
      expect(()=>verifyCopyFace(k as never,f.solid,witness,[hole])).toThrow(/foro|esterna/i)
      const inverse: DraftCopyFaceNoteV1={...note,target:{...note.target,
        orientedNormal:note.target.orientedNormal.map(x=>-x) as [number,number,number]}}
      expect(()=>verifyCopyFace(k as never,f.solid,witness,[inverse])).toThrow(/normale/i)
      shifted=k.translate(f.solid,0,0,0.01)
      expect(()=>verifyCopyFace(k as never,shifted!,witness,[note])).toThrow(/0 corrispondenze/i)
    } finally { if(shifted!==undefined)k.release(shifted); f.dispose() }
  },60000)
})

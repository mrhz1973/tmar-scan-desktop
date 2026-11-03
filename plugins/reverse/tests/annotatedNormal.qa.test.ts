// Isolated QA only: validates the signed normal of a reversed STEP face.
import { expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import type { DraftCopyFaceNoteV1 } from '../../../src/plugins/annotatedCopyTypes'
import { verifyCopyFace } from '../core/kernelAnnotatedNotes'

it('accepts the outward normal and rejects its inverse on a reversed STEP box face',async()=>{
  const k=await OcctKernel.init(), source=k.makeBox(20,30,10), imported=k.importStep(k.exportStep(source))
  const faces=k.getSubShapes(imported,'face')
  try {
    const face=faces.find(f=>k.shapeOrientation(f)==='reversed')
    if(face===undefined)throw Error('Fixture has no reversed face')
    const b=k.uvBounds(face),u=(b.uMin+b.uMax)/2,v=(b.vMin+b.vMax)/2
    const p=k.pointOnSurface(face,u,v),n=k.surfaceNormal(face,u,v)
    const outward=[p.x-10,p.y-15,p.z-5],length=Math.hypot(...outward)
    expect((n.x*outward[0]+n.y*outward[1]+n.z*outward[2])/length).toBeGreaterThan(.999999)
    const stamp={sessionId:'qa',sourceEpoch:1,selectionEpoch:1,draftEpoch:1,requestId:1}
    const note:DraftCopyFaceNoteV1={draftId:'qa-note',text:'Verified normal',target:{kind:'copy-face',witnessKey:'face',
      sourceUV:[u,v],resolvedAt:[p.x,p.y,p.z],orientedNormal:[n.x,n.y,n.z],resolvedStamp:stamp}}
    const witness=k.toBREP(face)
    const result=verifyCopyFace(k as never,imported,witness,[note])
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].normal.reduce((s,value,i)=>s+value*outward[i]/length,0)).toBeGreaterThan(.999999)
    const bad:DraftCopyFaceNoteV1={...note,target:{...note.target,orientedNormal:[-n.x,-n.y,-n.z]}}
    expect(()=>verifyCopyFace(k as never,imported,witness,[bad])).toThrow(/normale/i)
  } finally {faces.forEach(f=>k.release(f));k.release(imported);k.release(source);k[Symbol.dispose]()}
},60000)

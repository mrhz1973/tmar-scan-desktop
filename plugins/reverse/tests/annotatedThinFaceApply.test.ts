// SPDX-License-Identifier: AGPL-3.0-only
// Real headless host transport and OCCT, on an isolated 0.1 mm annulus.
// Does not qualify an interactive Edit Surface gesture or a v8 G1 recipe.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import { useHistory, undo, redo } from '../../../src/state/historyStore'
import { takeAtomicNotificationErrors } from '../../../src/state/atomicNotifications'
import { editorSha256 } from '../../../src/plugins/editorLifetime'
import { validateAnnotatedCopy } from '../../../src/plugins/annotatedCopyValidation'
import type { AnnotatedTicketV1, PreparedAnnotatedCopyV1 } from '../../../src/plugins/annotatedCopyTypes'
import { useShell } from '../../../src/state/shellStore'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { createReverseEditorHost } from '../app/workspaceEditorHost'
import { collectReversePart, applyReversePart } from '../app/projectSection'
import { revalidateAnnotations } from '../app/annotationPersistence'
import { notesForFile, validateNotes } from '../core/notes'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'
import { useReverse } from '../state/reStore'
import { useNotes } from '../state/noteStore'
import plugin from '../plugin'

let k: OcctKernel, session: ReverseSession, headless: Headless
let original: string, result: string, witness: string
let uv: [number,number], at: [number,number,number], normal: [number,number,number]
let gridCounts: {divisions:number;interior:number}[]
const off: (()=>void)[]=[]
const bytes=(text:string)=>new TextEncoder().encode(text)

function makeAnnulus(height:number) {
  const handles:ShapeHandle[]=[]
  const keep=(h:ShapeHandle)=>{handles.push(h);return h}
  try {
    const outer=keep(k.makeCircleEdge({x:0,y:0,z:0},{x:0,y:0,z:1},10))
    const inner=keep(k.makeCircleEdge({x:0,y:0,z:0},{x:0,y:0,z:1},9.9))
    const ow=keep(k.makeWire([outer])),iw=keep(k.makeWire([inner]))
    const disk=keep(k.makeFace(ow)),ring=keep(k.addHolesInFace(disk,[iw]))
    const solid=keep(k.extrude(ring,0,0,height))
    expect(k.isValid(solid)).toBe(true)
    return k.exportStep(solid)
  } finally { handles.reverse().forEach(h=>k.release(h)) }
}

beforeAll(async()=>{
  plugin.install?.();headless=await startHeadless()
  session=createReverseSession({sceneRef:{current:null},kernel:()=>new ReClient(localKernel())})
  off.push(installReverseSession(session),session.watch());k=await OcctKernel.init()
  original=makeAnnulus(1);result=makeAnnulus(1.05)
  const shape=k.importStep(result),faces=k.getSubShapes(shape,'face')
  try {
    const face=faces.find(f=>{const b=k.getBoundingBox(f);return Math.abs(b.zmin-1.05)<1e-6&&Math.abs(b.zmax-1.05)<1e-6})
    if(face===undefined)throw Error('Annulus top face unavailable')
    const q=k.uvFromPoint(face,{x:9.95,y:0,z:1.05}),p=k.pointOnSurface(face,q.u,q.v),n=k.surfaceNormal(face,q.u,q.v)
    uv=[q.u,q.v];at=[p.x,p.y,p.z];normal=[n.x,n.y,n.z];witness=k.toBREP(face)
    const b=k.uvBounds(face)
    gridCounts=[8,16,32,64].map(divisions=>{
      let interior=0
      for(let i=0;i<=divisions;i++)for(let j=0;j<=divisions;j++)
        if(k.classifyPointOnFace(face,b.uMin+(b.uMax-b.uMin)*i/divisions,b.vMin+(b.vMax-b.vMin)*j/divisions)==='in')interior++
      return {divisions,interior}
    })
    expect(gridCounts[0].interior).toBeLessThan(12)
    expect(gridCounts[3].interior).toBeGreaterThanOrEqual(12)
  } finally { faces.forEach(f=>k.release(f));k.release(shape) }
},120000)
afterAll(()=>{off.reverse().forEach(f=>f());session?.client()?.dispose();headless?.stop();k?.[Symbol.dispose]()})
beforeEach(()=>{resetReverse();useNotes.getState().load([]);useShell.getState().setWorkspace('reverse');takeAtomicNotificationErrors()})

async function prepare() {
  await run('reverse.import.step',{bytes:bytes(original),name:'thin-annulus-source.step'})
  const abort=new AbortController(),source=await createReverseEditorHost().readSource(useReverse.getState().bodies[0].id,abort.signal)
  const stamp={sessionId:'native-thin-annulus-apply',sourceEpoch:source.binding.sourceEpoch,selectionEpoch:1,draftEpoch:1,requestId:1}
  const ticket:AnnotatedTicketV1={annotationVersion:1,mode:'annotated-cad-copy',operationId:crypto.randomUUID(),source:source.binding,stamp,notesRevision:1}
  const step=bytes(result),stepHash=await editorSha256(step),witnessHash=await editorSha256(bytes(witness))
  const payload:PreparedAnnotatedCopyV1={annotationVersion:1,kind:'annotated-cad-copy',operationId:ticket.operationId,
    source:source.binding,stamp,notesRevision:1,units:'mm',coordinateFrame:'part',name:'thin-annulus-copy.step',step,
    witnesses:[{key:'annulus',kind:'occt-face-brep',brep:witness,brepSha256:witnessHash,finalStepSha256:stepHash,stamp,diagnosticFaceIndex:999}],
    notes:[{draftId:'annulus-note',text:'Nota su fascia anulare 0,1 mm',target:{kind:'copy-face',witnessKey:'annulus',sourceUV:uv,resolvedAt:at,orientedNormal:normal,resolvedStamp:stamp}}]}
  const plan=await validateAnnotatedCopy(payload,ticket)
  return {abort,source,ticket,payload,plan}
}

describe('native annotated Apply on a thin annular face',()=>{
  it('publishes atomically, undoes, redoes, saves and revalidates the actual thin-face witness after native archive reopen',async()=>{
    const p=await prepare(),sourceId=p.source.binding.bodyId,history=useHistory.getState().past.length
    const seen:{bodies:number;notes:number;history:number}[]=[]
    const read=()=>seen.push({bodies:useReverse.getState().bodies.length,notes:useNotes.getState().notes.length,history:useHistory.getState().past.length})
    const unsubscribe=[useReverse.subscribe(read),useNotes.subscribe(read),useHistory.subscribe(read)]
    const staged=await session.stageEditorCopy(result,'thin-annulus-copy.step',p.source.assertCurrent,p.abort.signal,{hideSourceBodyId:sourceId},p.plan)
    expect(seen).toHaveLength(0)
    let receipt
    try { receipt=staged.publish(p.ticket.operationId,p.plan.artifactSha256) }
    finally { staged.dispose();unsubscribe.forEach(f=>f()) }
    expect(receipt.mode).toBe('annotated-cad-copy')
    expect(receipt.createdBodyIds).toHaveLength(1);expect(receipt.notes).toHaveLength(1)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(s=>s.bodies===2&&s.notes===1&&s.history===history+1)).toBe(true)
    const copyId=receipt.createdBodyIds[0],note=useNotes.getState().notes[0]
    expect(note.attachment?.status).toBe('verified')
    expect(note.on[0]).toMatchObject({kind:'face',body:copyId})
    expect(note.at[0]).toBeCloseTo(9.95,10);expect(note.at[2]).toBeCloseTo(1.05,10)
    expect(note.normal![2]).toBeGreaterThan(1-1e-6)
    expect(useReverse.getState().hiddenBodies).toContain(sourceId)
    expect(takeAtomicNotificationErrors()).toEqual([])
    await undo();await session.settled(8000)
    expect(useReverse.getState().bodies).toHaveLength(1);expect(useNotes.getState().notes).toHaveLength(0)
    expect(useReverse.getState().hiddenBodies).not.toContain(sourceId)
    await redo();await session.settled(8000)
    expect(useReverse.getState().bodies).toHaveLength(2)
    expect(useNotes.getState().notes[0].attachment?.noteUuid).toBe(note.attachment?.noteUuid)
    const members=new Map<string,Uint8Array>()
    const part=JSON.parse(JSON.stringify(collectReversePart({addMember:(key,value)=>members.set(key,value.slice())})))
    const notes=JSON.parse(JSON.stringify(notesForFile(useNotes.getState().notes)))
    applyReversePart(part,{members,manifest:{} as never});useNotes.getState().load(validateNotes(notes));await session.settled(8000)
    await revalidateAnnotations()
    const restored=useNotes.getState().notes[0]
    expect(restored.attachment).toMatchObject({status:'verified',noteUuid:note.attachment?.noteUuid,featureUuid:receipt.createdFeatureUuid})
    expect(restored.text).toBe(note.text);expect(restored.at).toEqual(note.at)
    const inspect=async(id:number,height:number)=>{
      const reply=await session.client()!.bodyEditSource(id),shape=k.importStep(reply.text)
      try {expect(k.isValid(shape)).toBe(true);expect(k.subShapeCount(shape,'solid')).toBe(1)
        expect(k.getVolume(shape)).toBeCloseTo(Math.PI*(100-9.9**2)*height,6)
      } finally {k.release(shape)}
    }
    await inspect(sourceId,1);await inspect(copyId,1.05)
    console.log('Thin annulus native evidence',JSON.stringify({gridCounts,annulusWidthMm:0.1,
      sourceSha256:await editorSha256(bytes(original)),resultSha256:p.plan.artifactSha256,
      witnessSha256:await editorSha256(bytes(witness)),historyActions:1,annotationStatus:restored.attachment?.status}))
  },120000)

  it('refuses an inverted thin-face normal without publishing a body, note or history action',async()=>{
    const p=await prepare(),bad:PreparedAnnotatedCopyV1={...p.payload,notes:[{...p.payload.notes[0],target:{...p.payload.notes[0].target,
      orientedNormal:[0,0,-1]}}]}
    const plan=await validateAnnotatedCopy(bad,p.ticket),before=useReverse.getState(),notes=useNotes.getState(),history=useHistory.getState()
    await expect(session.stageEditorCopy(result,'bad-annulus.step',p.source.assertCurrent,p.abort.signal,undefined,plan)).rejects.toThrow()
    expect(useReverse.getState()).toBe(before);expect(useNotes.getState()).toBe(notes);expect(useHistory.getState()).toBe(history)
  },120000)
})

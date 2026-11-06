// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { run,startHeadless,type Headless } from '../../../tests/commandKit'
import { undo,redo,useHistory } from '../../../src/state/historyStore'
import { takeAtomicNotificationErrors } from '../../../src/state/atomicNotifications'
import { editorSha256 } from '../../../src/plugins/editorLifetime'
import { validateAnnotatedCopy } from '../../../src/plugins/annotatedCopyValidation'
import type { AnnotatedTicketV1,PreparedAnnotatedCopyV1 } from '../../../src/plugins/annotatedCopyTypes'
import { revalidateAnnotations } from '../app/annotationPersistence'
import { notesSection } from '../app/notesSection'
import { noteOut } from '../app/reNoteCommands'
import { useStore } from '../../../src/state/store'
import { useShell } from '../../../src/state/shellStore'
import { createReverseSession,installReverseSession,type ReverseSession } from '../app/reSession'
import { createReverseEditorHost } from '../app/workspaceEditorHost'
import { collectReversePart,applyReversePart } from '../app/projectSection'
import { notesForFile,validateNotes } from '../core/notes'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import { useNotes } from '../state/noteStore'
import plugin from '../plugin'
import { resetReverse } from './reReset'
let k:OcctKernel,session:ReverseSession,headless:Headless,original:string,result:string,brep:string,uv:[number,number],at:[number,number,number],normal:[number,number,number]
const off:(()=>void)[]=[]
beforeAll(async()=>{
  plugin.install?.();headless=await startHeadless()
  session=createReverseSession({sceneRef:{current:null},kernel:()=>new ReClient(localKernel())})
  off.push(installReverseSession(session),session.watch());k=await OcctKernel.init()
  const a=k.makeBox(20,30,10),b=k.makeBox(20,30,12),faces=k.getSubShapes(b,'face')
  try{
    original=k.exportStep(a);result=k.exportStep(b)
    const face=faces.find(f=>Math.abs(k.getBoundingBox(f).zmin-12)<1e-6)!
    brep=k.toBREP(face);const q=k.uvFromPoint(face,{x:10,y:15,z:12});uv=[q.u,q.v]
    const p=k.pointOnSurface(face,q.u,q.v),n=k.surfaceNormal(face,q.u,q.v)
    at=[p.x,p.y,p.z];normal=[n.x,n.y,n.z]
  }finally{[a,b,...faces].forEach(h=>k.release(h))}
},120_000)
afterAll(()=>{off.reverse().forEach(f=>f());session?.client()?.dispose();headless?.stop();k?.[Symbol.dispose]()})
beforeEach(()=>{resetReverse();useNotes.getState().load([]);useShell.getState().setWorkspace('reverse');takeAtomicNotificationErrors()})
async function prepared(text='Nota sulla copia'){
  await run('reverse.import.step',{bytes:new TextEncoder().encode(original),name:'source.step'})
  const abort=new AbortController(),source=await createReverseEditorHost().readSource(useReverse.getState().bodies[0].id,abort.signal)
  const stamp={sessionId:'test-session',sourceEpoch:source.binding.sourceEpoch,selectionEpoch:1,draftEpoch:1,requestId:1}
  const ticket:AnnotatedTicketV1={annotationVersion:1,mode:'annotated-cad-copy',operationId:crypto.randomUUID(),source:source.binding,stamp,notesRevision:1}
  const step=new TextEncoder().encode(result),stepHash=await editorSha256(step),witnessHash=await editorSha256(new TextEncoder().encode(brep))
  const payload:PreparedAnnotatedCopyV1={annotationVersion:1,kind:'annotated-cad-copy',operationId:ticket.operationId,source:source.binding,stamp,notesRevision:1,units:'mm',coordinateFrame:'part',name:'annotated.step',step,
    witnesses:[{key:'face',kind:'occt-face-brep',brep,brepSha256:witnessHash,finalStepSha256:stepHash,stamp,diagnosticFaceIndex:999}],
    notes:[{draftId:'n1',text,target:{kind:'copy-face',witnessKey:'face',sourceUV:uv,resolvedAt:at,orientedNormal:normal,resolvedStamp:stamp}}]}
  const plan=await validateAnnotatedCopy(payload,ticket)
  return {abort,source,ticket,payload,plan,stage:()=>session.stageEditorCopy(result,'annotated.step',source.assertCurrent,abort.signal,undefined,plan)}
}
describe('real annotated CAD-copy publication',()=>{
 it('revalidates a pending unresolved attachment before the Save Project snapshot',async()=>{
   const x=await prepared(), stage=await x.stage()
   stage.publish(x.ticket.operationId,x.plan.artifactSha256);stage.dispose()
   expect(useNotes.getState().notes).toHaveLength(1)
   useNotes.setState(state=>({notes:state.notes.map(note=>note.attachment
     ? {...note,attachment:{...note.attachment,status:'unresolved'}}:note)}))
   expect(useNotes.getState().notes[0].attachment?.status).toBe('unresolved')
   await notesSection.beforeSave?.()
   const saved=notesSection.collect({sources:{} as never,scanSaved:false,addMember:()=>{}})
   expect(saved?.notes[0].attachment?.status).toBe('verified')
 },120000)
 it('blocks unsafe Undo with unowned dependent notes before any mutation',async()=>{
   const x=await prepared(),s=await x.stage(),receipt=s.publish(x.ticket.operationId,x.plan.artifactSha256);s.dispose()
   const own=useNotes.getState().notes[0]
   useNotes.getState().addAgentNote({text:'External dependency',at:own.at,on:own.on})
   const features=useReverse.getState().features,notes=useNotes.getState().notes,past=useHistory.getState().past
   await undo()
   expect(useReverse.getState().features).toBe(features);expect(useNotes.getState().notes).toBe(notes);expect(useHistory.getState().past).toBe(past)
   expect(useStore.getState().errorText).toMatch(/altre note/);expect(receipt.createdBodyIds).toHaveLength(1)
 },120_000)
 it('rolls back an injected note publication failure without notifying a half-state',async()=>{
   const x=await prepared(),s=await x.stage(),before=useReverse.getState(),notes=useNotes.getState(),history=useHistory.getState(),client=session.client()
   let notifications=0,once=true
   const a=useReverse.subscribe(()=>notifications++),b=useNotes.subscribe(()=>notifications++)
   const set=useNotes.setState
   useNotes.setState=((...args:Parameters<typeof set>)=>{set(...args);if(once){once=false;throw Error('injected note publication failure')}}) as typeof set
   try{expect(()=>s.publish(x.ticket.operationId,x.plan.artifactSha256)).toThrow('injected')}
   finally{useNotes.setState=set;a();b();s.dispose()}
   expect(useReverse.getState()).toBe(before);expect(useNotes.getState()).toBe(notes);expect(useHistory.getState()).toBe(history);expect(session.client()).toBe(client);expect(notifications).toBe(0)
 },120_000)
 it('rejects reentrant note mutation during committed notifications, preserving the committed receipt',async()=>{
   const x=await prepared(),other=useNotes.getState().addAgentNote({text:'Unrelated',at:[0,0,0],on:[{kind:'scan'}]}),s=await x.stage()
   const off=useReverse.subscribe(()=>useNotes.getState().setText(other,'Forbidden reentrant edit'))
   const receipt=s.publish(x.ticket.operationId,x.plan.artifactSha256);off();s.dispose()
   expect(receipt.mode).toBe('annotated-cad-copy');expect(useNotes.getState().notes.find(n=>n.id===other)?.text).toBe('Unrelated')
   expect(takeAtomicNotificationErrors().map(String).join(' ')).toMatch(/Reentrant/)
 },120_000)
 it('validates attachment schemas and marks modified destination CAD unresolved without fallback',async()=>{
   const x=await prepared(),s=await x.stage(),receipt=s.publish(x.ticket.operationId,x.plan.artifactSha256);s.dispose()
   const saved=JSON.parse(JSON.stringify(notesForFile(useNotes.getState().notes)));saved[0].attachment.version=99
   expect(()=>validateNotes(saved)).toThrow('attachment')
   await run('reverse.feature.add',{feature:{kind:'moveBody',bodies:receipt.createdBodyIds,translate:[1,0,0]}})
   await revalidateAnnotations()
   const note=useNotes.getState().notes[0];expect(note.attachment?.status).toBe('unresolved')
   await notesSection.beforeSave?.()
   const savedUnresolved=notesSection.collect({sources:{} as never,scanSaved:false,addMember:()=>{}})
   expect(savedUnresolved?.notes[0].attachment?.status).toBe('unresolved')
   expect(notesSection.saveSays?.().join(' ')).toMatch(/need revalidation/)
   const out=noteOut(note);expect(out).not.toHaveProperty('nearest');expect(out.attachment).toMatchObject({status:'unresolved'})
 },120_000)

 it('publishes body/resources/notes/history without a half-visible subscriber state',async()=>{
   const x=await prepared(),before=useReverse.getState().bodies.length,h=useHistory.getState().past.length
   const states:{bodies:number;notes:number;history:number}[]=[]
   const read=()=>states.push({bodies:useReverse.getState().bodies.length,notes:useNotes.getState().notes.length,history:useHistory.getState().past.length})
   const a=useReverse.subscribe(read),b=useNotes.subscribe(read),c=useHistory.subscribe(read)
   const s=await x.stage();expect(states).toEqual([])
   const receipt=s.publish(x.ticket.operationId,x.plan.artifactSha256);s.dispose();a();b();c()
   expect(receipt.mode).toBe('annotated-cad-copy');expect(receipt.notes).toHaveLength(1)
   expect(states.length).toBeGreaterThan(0);expect(states.every(v=>v.bodies===before+1&&v.notes===1&&v.history===h+1)).toBe(true)
   expect(useNotes.getState().notes[0]).toMatchObject({text:'Nota sulla copia',at:[10,15,12],attachment:{version:1,status:'verified'}})
   expect(takeAtomicNotificationErrors()).toEqual([])
 },120_000)
 it('selective Undo/Redo retains unrelated edits, latest owned text and explicit deletion',async()=>{
   const x=await prepared(),s=await x.stage();s.publish(x.ticket.operationId,x.plan.artifactSha256);s.dispose()
   const owned=useNotes.getState().notes[0].id
   const other=useNotes.getState().addAgentNote({text:'Altra nota',at:[0,0,0],on:[{kind:'scan'}]})
   useNotes.getState().setText(owned,'Testo corretto');useNotes.getState().setText(other,'Altra nota corretta')
   const next=useNotes.getState().nextId
   await undo();await session.settled(8000)
   expect(useReverse.getState().bodies).toHaveLength(1);expect(useNotes.getState().notes.map(n=>n.text)).toEqual(['Altra nota corretta'])
   expect(useNotes.getState().nextId).toBe(next)
   await redo();await session.settled(8000)
   expect(useNotes.getState().notes.find(n=>n.id===owned)?.text).toBe('Testo corretto')
   useNotes.getState().removeNote(owned);await undo();await session.settled(8000);await redo();await session.settled(8000)
   expect(useNotes.getState().notes.map(n=>n.text)).toEqual(['Altra nota corretta'])
 },120_000)
 it('refuses wrong normal or witness before committed state changes',async()=>{
   const x=await prepared(),before=useReverse.getState(),notes=useNotes.getState(),history=useHistory.getState()
   const bad:PreparedAnnotatedCopyV1={...x.payload,notes:[{...x.payload.notes[0],target:{...x.payload.notes[0].target,orientedNormal:[0,0,-1]}}]}
   const plan=await validateAnnotatedCopy(bad,x.ticket)
   await expect(session.stageEditorCopy(result,'bad.step',x.source.assertCurrent,x.abort.signal,undefined,plan)).rejects.toThrow()
   expect(useReverse.getState()).toBe(before);expect(useNotes.getState()).toBe(notes);expect(useHistory.getState()).toBe(history)
 },120_000)
 it('hashes note content as well as the STEP and refuses stale note revision',async()=>{
   const x=await prepared(),changed:PreparedAnnotatedCopyV1={...x.payload,notes:[{...x.payload.notes[0],text:'Testo diverso'}]}
   const plan=await validateAnnotatedCopy(changed,x.ticket)
   expect(plan.artifactSha256).toBe(x.plan.artifactSha256);expect(plan.envelopeSha256).not.toBe(x.plan.envelopeSha256)
   await expect(validateAnnotatedCopy({...changed,notesRevision:2},x.ticket)).rejects.toThrow()
 },120_000)
 it('reopens native model/note data with attachments and retains a valid exact destination',async()=>{
   const x=await prepared(),s=await x.stage(),receipt=s.publish(x.ticket.operationId,x.plan.artifactSha256);s.dispose()
   const members = new Map<string, Uint8Array>()
   const part=JSON.parse(JSON.stringify(collectReversePart({addMember:(name,bytes)=>{members.set(name,bytes.slice())}})))
   const notes=JSON.parse(JSON.stringify(notesForFile(useNotes.getState().notes)))
   // Model JSON alone is not a native project: its STEP archive member is required.
   applyReversePart(part,{members,manifest:{} as import('../../../src/core/project/manifest').ProjectManifest})
   useNotes.getState().load(validateNotes(notes));await session.settled(8000)
   const note=useNotes.getState().notes[0]
   expect(note.attachment?.featureUuid).toBe(receipt.createdFeatureUuid)
   await revalidateAnnotations();expect(useNotes.getState().notes[0].attachment?.status).toBe('verified')
   const source=await session.client()!.bodyEditSource(receipt.createdBodyIds[0])
   const shape=k.importStep(source.text)
   try{expect(k.isValid(shape)).toBe(true);expect(k.getVolume(shape)).toBeCloseTo(7200,7)}finally{k.release(shape)}
 },120_000)
 it('revokes a staged annotated copy on Cancel without body/note/history residue',async()=>{
   const x=await prepared(),s=await x.stage(),before=useReverse.getState(),notes=useNotes.getState(),history=useHistory.getState()
   x.abort.abort();expect(()=>s.publish(x.ticket.operationId,x.plan.artifactSha256)).toThrow();s.dispose()
   expect(useReverse.getState()).toBe(before);expect(useNotes.getState()).toBe(notes);expect(useHistory.getState()).toBe(history)
 },120_000)
})

// Additional regression gates for the published annotated transport.
describe('annotated persistence and publication guards', () => {
  it('preserves source hiding together with selective note Undo/Redo', async () => {
    const x = await prepared(), sourceId = x.source.binding.bodyId
    const stage = await session.stageEditorCopy(result, 'hidden-annotated.step', x.source.assertCurrent, x.abort.signal,
      { hideSourceBodyId: sourceId }, x.plan)
    const receipt = stage.publish(x.ticket.operationId, x.plan.artifactSha256); stage.dispose()
    const uuid = useNotes.getState().notes[0].attachment!.noteUuid
    expect(useReverse.getState().hiddenBodies).toContain(sourceId)
    await undo(); await session.settled(8000)
    expect(useReverse.getState().hiddenBodies).not.toContain(sourceId)
    expect(useNotes.getState().notes).toHaveLength(0)
    await redo(); await session.settled(8000)
    expect(useReverse.getState().hiddenBodies).toContain(sourceId)
    expect(useNotes.getState().notes[0].attachment!.noteUuid).toBe(uuid)
    expect(useNotes.getState().notes[0].on[0]).toMatchObject({ kind: 'face', body: receipt.createdBodyIds[0] })
  }, 120_000)

  it('does not lose unrelated notes changed after staging when publication fails', async () => {
    const x = await prepared(), stage = await x.stage()
    const other = useNotes.getState().addAgentNote({ text: 'Added after staging', at: [0, 0, 0], on: [{ kind: 'scan' }] })
    const before = useNotes.getState(), state = useReverse.getState(), originalSet = useReverse.setState
    let once = true
    useReverse.setState = ((...args: Parameters<typeof originalSet>) => {
      originalSet(...args)
      if (once) { once = false; throw Error('Injected before notes publication') }
    }) as typeof originalSet
    try { expect(() => stage.publish(x.ticket.operationId, x.plan.artifactSha256)).toThrow('Injected') }
    finally { useReverse.setState = originalSet; stage.dispose() }
    expect(useNotes.getState()).toBe(before)
    expect(useNotes.getState().notes.find(n => n.id === other)?.text).toBe('Added after staging')
    expect(useReverse.getState()).toBe(state)
  }, 120_000)

  it('refuses a real document change after annotated staging', async () => {
    const x = await prepared(), stage = await x.stage()
    useReverse.setState({ documentEpoch: crypto.randomUUID() })
    const state = useReverse.getState(), notes = useNotes.getState(), history = useHistory.getState()
    try { expect(() => stage.publish(x.ticket.operationId, x.plan.artifactSha256)).toThrow('sorgente') }
    finally { stage.dispose() }
    expect(useReverse.getState()).toBe(state); expect(useNotes.getState()).toBe(notes); expect(useHistory.getState()).toBe(history)
  }, 120_000)

  it('retains an unresolved note if its persisted STEP member is absent', async () => {
    const x = await prepared(), stage = await x.stage()
    stage.publish(x.ticket.operationId, x.plan.artifactSha256); stage.dispose()
    const part = JSON.parse(JSON.stringify(collectReversePart()))
    const notes = JSON.parse(JSON.stringify(notesForFile(useNotes.getState().notes)))
    applyReversePart(part); useNotes.getState().load(validateNotes(notes)); await session.settled(8000)
    await revalidateAnnotations()
    const held = useNotes.getState().notes[0]
    expect(held.text).toBe('Nota sulla copia'); expect(held.attachment?.status).toBe('unresolved')
    expect(noteOut(held)).not.toHaveProperty('nearest')
  }, 120_000)

  it('keeps witness parameters separate and refreshes only a CAD-verified fingerprint', async () => {
    const x = await prepared(), stage = await x.stage()
    stage.publish(x.ticket.operationId, x.plan.artifactSha256); stage.dispose()
    const before = useNotes.getState().notes[0], saved = JSON.parse(JSON.stringify(notesForFile([before])))
    // A face enumeration/fingerprint is a lookup hint, not the stored identity.
    saved[0].on[0].face.area *= 2
    saved[0].attachment.uv = [123456, -98765]
    useNotes.getState().load(validateNotes(saved)); await revalidateAnnotations()
    const actual = useNotes.getState().notes[0]
    expect(actual.attachment?.status).toBe('verified')
    expect(actual.attachment?.witnessUV).toEqual(x.payload.notes[0].target.sourceUV)
    expect(actual.attachment?.uv).toEqual(before.attachment?.uv)
    expect(actual.on).toEqual(before.on)
    saved[0].attachment.witnessUV = [123456, -98765]
    useNotes.getState().load(validateNotes(saved)); await revalidateAnnotations()
    expect(useNotes.getState().notes[0].attachment?.status).toBe('unresolved')
  }, 120_000)

  it('rejects malformed and duplicate bundles without filtering notes', async () => {
    const x = await prepared(), n = x.payload.notes[0]
    for (const patch of [
      { units: 'm' }, { coordinateFrame: 'world' }, { witnesses: [] }, { notes: [] },
      { notes: [n, n] }, { notes: [{ ...n, text: ' ' }] },
      { notes: [{ ...n, target: { ...n.target, kind: 'scan' } }] },
    ]) {
      await expect(validateAnnotatedCopy({ ...x.payload, ...patch } as PreparedAnnotatedCopyV1, x.ticket)).rejects.toThrow()
    }
    expect(useNotes.getState().notes).toHaveLength(0)
  }, 120_000)
})

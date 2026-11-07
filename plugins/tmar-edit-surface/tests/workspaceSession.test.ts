// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { Net, Point } from '../brep'
import { SurfaceEditorKernel } from '../editorKernel'
import type { StripMove } from '../sheetExtension'
import { SurfaceRuntime } from '../surfaceRuntime'
import { SurfaceDraft } from '../surfaceDraft'
import { createWorkspaceSurfaceSession, type WorkspaceSurfaceSession } from '../workspaceSession'
import { replaySurfaceHistory } from '../historyReplay'
import {targetSurfacePoint} from '../surfacePointTarget'

type Msg = { id: number; action: string; exportStep?: boolean; net?: Net; edge?:number; delta?:number[]; path?:number[][]; previous?:Array<{edge:number;delta:number[];path:number[][]}> }
class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  sent: Msg[] = []
  postMessage(message: Msg) { this.sent.push(message) }
  terminate = vi.fn()
  reply(id: number, result: unknown) { this.onmessage?.({ data: { id, result } } as MessageEvent<unknown>) }
  fail(id: number, error: string) { this.onmessage?.({ data: { id, error } } as MessageEvent<unknown>) }
}
function plane(): Net {
  const poles: Net['poles'] = []
  for (let u=0;u<5;u++) for (let v=0;v<5;v++) poles.push([u,v,0])
  return { nu:5,nv:5,du:3,dv:3,poles,weights:poles.map(()=>1),
    rational:[0,0],ku:[0,.5,1],kv:[0,.5,1],mu:[4,1,4],mv:[4,1,4] }
}
const preview = (revision: number) => ({ valid:true, previewRevision:revision, mesh:{}, faceMeshes:[{}],
  volume:1, maxBoundaryError:0, minimumNormalDot:1 })
const info = { index:0,kind:'plane',reason:null,converted:true,enriched:false,
  openSheet:false,freeBoundary:false,trimLocks:[],hiddenPoles:[] }
async function flush() { for (let i=0;i<8;i++) await Promise.resolve() }
async function setup(options: {sheet?:boolean;annotated?:boolean;bodyId?:number;blockedPlane?:boolean} = {}) {
  vi.useFakeTimers()
  const worker = new FakeWorker(), runtime = new SurfaceRuntime(() => worker as unknown as Worker)
  const abort = new AbortController(), hash = 'a'.repeat(64)
  let sourceCurrent = true
  const binding = { documentEpoch:'doc-1',sourceEpoch:3,bodyId:options.bodyId??4,bodyKey:'body-key',
    buildVersion:5,kernelGeneration:6,frameRevision:7,stepSha256:hash,units:'mm',coordinateFrame:'part' }
  const owned = new Set<() => void>()
  const context = { apiVersion:1,sessionId:'session-1',source:binding,step:new Uint8Array([1,2,3]),
    capabilities:options.annotated
      ? {apiVersion:1,enabled:true,annotationVersion:1,commitKinds:['cad-copy','annotated-cad-copy']}
      : {apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:abort.signal,
    assertSourceCurrent:()=>{if(!sourceCurrent)throw Error('source changed')},
    own:(fn:()=>void)=>{let active=true;const once=()=>{if(active){active=false;owned.delete(once);fn()}};owned.add(once);return once},
    reportFatal:vi.fn() }
  let owner: WorkspaceSurfaceSession
  const layer = { cancelGesture:vi.fn(()=>{ if(owner.getSnapshot().gesture === 'pole') owner.finishPoleGesture(null); return true }),dispose:vi.fn() }
  const factory = vi.fn((_view: unknown, controller: WorkspaceSurfaceSession)=>{owner=controller;return layer})
  const creating = createWorkspaceSurfaceSession(context as never,factory as never,{runtime,sha256:async bytes=>
    bytes.length===3 && bytes[0]===1 && bytes[1]===2 && bytes[2]===3 ? hash : createHash('sha256').update(bytes).digest('hex')})
  await flush()
  expect(worker.sent[0]?.action).toBe('open')
  const first = options.blockedPlane ? {...info,reason:'Tutti i poli influenzano un contorno ritagliato.'} : info
  const faces = options.sheet ? [{...first,openSheet:true,freeBoundary:true}] : [first,{...info,index:1}]
  worker.reply(worker.sent[0].id,{faces,preview:{...preview(0),faceMeshes:faces.map(()=>({}))}})
  const session = await creating
  return { worker, runtime, abort, binding, context, session, layer, owned, invalidate:()=>{sourceCurrent=false} }
}
async function selectFace(test: Awaited<ReturnType<typeof setup>>, net = plane()) {
  const choosing = test.session.chooseFace(0)
  expect(test.worker.sent.at(-1)?.action).toBe('select')
  test.worker.reply(test.worker.sent.at(-1)!.id,net)
  await choosing
  await vi.advanceTimersByTimeAsync(90)
  const request = test.worker.sent.at(-1)!
  expect(request.action).toBe('evaluate')
  test.worker.reply(request.id,preview(1))
  await flush()
  expect(test.session.getSnapshot().validation.kind).toBe('valid')
}
function ticket(test: Awaited<ReturnType<typeof setup>>) {
  const state=test.session.getSnapshot()
  if(state.validation.kind!=='valid')throw Error('preview not valid')
  return { operationId:'op-1',mode:'cad-copy',source:{...test.binding},stamp:{...state.validation.stamp} }
}
function annotatedTicket(test: Awaited<ReturnType<typeof setup>>) {
  const state=test.session.getSnapshot()
  if(state.validation.kind!=='valid')throw Error('preview not valid')
  if(typeof state.notesRevision!=='number' || !Number.isSafeInteger(state.notesRevision))throw Error('notes revision not valid')
  return { annotationVersion:1,operationId:'annotated-op-1',mode:'annotated-cad-copy',source:{...test.binding},
    stamp:{...state.validation.stamp},notesRevision:state.notesRevision }
}
async function addNote(test: Awaited<ReturnType<typeof setup>>, text: string, u: number) {
  test.session.setPlacingNote(true)
  const placing=test.session.placeNote([u,2,3]), request=test.worker.sent.at(-1)!
  expect(request.action).toBe('notePick')
  test.worker.reply(request.id,{anchor:{face:0,selectionRevision:1,u,v:.5},at:[u,2,3],normal:[0,0,1]})
  await placing
  const id=test.session.getPanelState().notes.at(-1)!.id
  if(text)test.session.setNoteText(id,text)
  return id
}
function changedPoles(session: WorkspaceSurfaceSession, z=.2) {
  const net = session.getPanelState().net!
  const poles = structuredClone(net.poles)
  poles[12][2] = z
  return poles
}
const stripPaths = [ [[0,0,0],[4,0,0]], [[4,0,0],[4,4,0]], [[4,4,0],[0,4,0]], [[0,4,0],[0,0,0]] ]
async function enterStrip(t: Awaited<ReturnType<typeof setup>>) {
  const pending=t.session.beginStrip(), request=t.worker.sent.at(-1)!
  expect(request.action).toBe('sheetEdges')
  expect(t.session.getSnapshot().validation.kind).toBe('pending')
  t.worker.reply(request.id,structuredClone(stripPaths));await pending
}
function stripReply(request: Msg, extra: Record<string, unknown> = {}) {
  const moves=[...(request.previous ?? []),{edge:request.edge!,delta:request.delta!,path:request.path!}]
  return {step:`EXTENDED STEP ${moves.length}`,preview:{...preview(1),previewRevision:undefined,faceMeshes:moves.map(()=>({})).concat({})},
    paths:structuredClone(stripPaths),moves,addedArea:1,totalArea:4+moves.length,...extra}
}
afterEach(()=>vi.useRealTimers())

describe('whole natural boundary movement',()=>{
  const ready=async(t:Awaited<ReturnType<typeof setup>>,revision:number)=>{
    await vi.advanceTimersByTimeAsync(90);t.worker.reply(t.worker.sent.filter(r=>r.action==='evaluate').at(-1)!.id,preview(revision));await flush()
  }
  const nativeReply=()=>({face:0,previewRevision:2,results:[{side:'U1',visible:true,point:[4,2,0],pickerSegment:31,
    reason:'native-section-and-clear-front',frontDistanceMm:1e-5,intersectionCount:1}]})
  it('keeps native verification read-only and consumes only the original current receipt once',async()=>{
    const t=await setup({sheet:true});await selectFace(t);t.session.setFreeBoundary(true);await ready(t,2);t.session.setWholeBoundaryDrag('U0')
    const net=t.session.getPanelState().net!,history=t.session.getSnapshot().historyRevision
    const pending=t.session.prepareWholeBoundaryPicks(net,[{side:'U1',seed:[4,2,0],segment:31}],[10,2,10])
    expect(t.worker.sent.at(-1)?.action).toBe('verifyBoundaryVisibility')
    expect(t.session.getPanelState().busy).toBe(false);expect(t.session.getSnapshot().validation.kind).toBe('valid')
    t.worker.reply(t.worker.sent.at(-1)!.id,nativeReply());const picks=await pending
    expect(t.session.beginVerifiedWholeBoundaryGesture({...picks[0]})).toBe(false)
    expect(t.session.beginVerifiedWholeBoundaryGesture(picks[0])).toBe(true)
    t.session.finishPoleGesture(null)
    expect(t.session.beginVerifiedWholeBoundaryGesture(picks[0])).toBe(false)
    expect(t.session.getPanelState().net).toEqual(net);expect(t.session.getSnapshot().historyRevision).toBe(history)
    await t.session.dispose('cancelled')
  })
  it.each(['cancel','selection','source'] as const)('refuses native receipts superseded by %s',async change=>{
    const t=await setup({sheet:true});await selectFace(t);t.session.setFreeBoundary(true);await ready(t,2);t.session.setWholeBoundaryDrag('U0')
    const net=t.session.getPanelState().net!
    const pending=t.session.prepareWholeBoundaryPicks(net,[{side:'U1',seed:[4,2,0],segment:31}],[10,2,10])
    const rejection=expect(pending).rejects.toThrow()
    if(change==='cancel')t.session.cancelPreparedWholeBoundaryPicks()
    if(change==='selection')t.session.selectPoints([12],false)
    if(change==='source')t.invalidate()
    t.worker.reply(t.worker.sent.at(-1)!.id,nativeReply());await rejection
    expect(t.session.getPanelState().net).toBe(net)
    await t.session.dispose('cancelled')
  })
  it('adopts a directly picked different side and restores its full-row move with one Undo',async()=>{
    const t=await setup({sheet:true});await selectFace(t);t.session.setFreeBoundary(true);await ready(t,2)
    t.session.setWholeBoundaryDrag('U0')
    const before=t.session.getPanelState().net!,history=t.session.getSnapshot().historyRevision
    expect(t.session.beginWholeBoundaryGesture('U1')).toBe(true)
    expect(t.session.getPanelState().wholeBoundaryDrag).toBe('U1')
    const ids=Array.from({length:before.nv},(_,i)=>(before.nu-1)*before.nv+i)
    expect(t.session.getPanelState().selected).toEqual(ids)
    const poles=structuredClone(before.poles);for(const id of ids)poles[id][2]+=.2
    t.session.previewPoles(poles);t.session.finishPoleGesture(poles);await ready(t,3)
    expect(t.session.getSnapshot().historyRevision).toBe(history+1)
    expect(t.session.getPanelState().net!.poles).toEqual(poles)
    t.session.undo();expect(t.session.getPanelState().net).toEqual(before)
    expect(t.session.getPanelState().wholeBoundaryDrag).toBe('U1')
    await t.session.dispose('cancelled')
  })
  it('does not adopt a directly picked side containing a manual lock',async()=>{
    const t=await setup({sheet:true});await selectFace(t);t.session.setFreeBoundary(true);await ready(t,2)
    t.session.setWholeBoundaryDrag('U0')
    t.session.selectPoints([20],false);t.session.lockSelected(true);await ready(t,3)
    const before=t.session.getPanelState().net!,history=t.session.getSnapshot().historyRevision
    expect(()=>t.session.beginWholeBoundaryGesture('U1')).toThrow(/bloccato/)
    expect(t.session.getPanelState().wholeBoundaryDrag).toBe('U0')
    expect(t.session.getPanelState().net).toBe(before)
    expect(t.session.getSnapshot().historyRevision).toBe(history)
    await t.session.dispose('cancelled')
  })
  it('previews the complete natural boundary without history and commits one cancellable drag',async()=>{
    const t=await setup({sheet:true});await selectFace(t);t.session.setFreeBoundary(true);await ready(t,2)
    t.session.setWholeBoundaryDrag('U0')
    const before=t.session.getPanelState().net!,history=t.session.getSnapshot().historyRevision
    expect(t.session.beginWholeBoundaryGesture('U0')).toBe(true)
    const moved=structuredClone(before.poles);for(let i=0;i<before.nv;i++)moved[i][2]+=.3
    t.session.previewPoles(moved)
    expect(t.session.getSnapshot().historyRevision).toBe(history)
    expect(t.session.getPanelState().net!.poles).toEqual(moved)
    t.session.finishPoleGesture(moved)
    expect(t.session.getSnapshot().historyRevision).toBe(history+1)
    await ready(t,3);t.session.undo();expect(t.session.getPanelState().net).toEqual(before)
    await ready(t,4);expect(t.session.beginWholeBoundaryGesture('U0')).toBe(true)
    t.session.previewPoles(moved);t.session.finishPoleGesture(null)
    expect(t.session.getPanelState().net).toEqual(before)
    await t.session.dispose('cancelled')
  })
  it('rejects partial or unrelated pole edits and restores the last committed net after an invalid drag commit',async()=>{
    const t=await setup({sheet:true});await selectFace(t);t.session.setFreeBoundary(true);await ready(t,2)
    t.session.setWholeBoundaryDrag('U0');const before=t.session.getPanelState().net!,history=t.session.getSnapshot().historyRevision
    t.session.beginWholeBoundaryGesture('U0')
    const partial=structuredClone(before.poles);partial[0][2]=.2
    expect(()=>t.session.previewPoles(partial)).toThrow(/tutto il bordo/)
    const valid=structuredClone(before.poles);for(let i=0;i<before.nv;i++)valid[i][2]=.2
    t.session.previewPoles(valid)
    const unrelated=structuredClone(valid);unrelated[12][2]=.1
    expect(()=>t.session.finishPoleGesture(unrelated)).toThrow(/altri poli/)
    expect(t.session.getPanelState().net).toEqual(before)
    expect(t.session.getSnapshot().historyRevision).toBe(history)
    await t.session.dispose('cancelled')
  })
  it.each(['U0','U1','V0','V1'] as const)('moves every pole of %s once, with no added strip and one geometry Undo step',async side=>{
    const t=await setup({sheet:true});await selectFace(t)
    expect(t.session.getPanelState().canMoveWholeBoundary).toBe(false)
    t.session.setFreeBoundary(true);await ready(t,2)
    const before=t.session.getPanelState().net!
    t.session.moveWholeBoundary(side,[0,0,.2])
    const after=t.session.getPanelState().net!
    const ids=before.poles.flatMap((_,i)=>((side==='U0' && i<before.nv)||(side==='U1' && i>=before.poles.length-before.nv)||
      (side==='V0' && i%before.nv===0)||(side==='V1' && i%before.nv===before.nv-1))?[i]:[])
    after.poles.forEach((p,i)=>expect(p).toEqual(ids.includes(i)?[before.poles[i][0],before.poles[i][1],.2]:before.poles[i]))
    expect(t.session.getPanelState().selected).toEqual(ids)
    expect(t.session.getPanelState().strip).toBeNull()
    expect(t.session.getPanelState().canMoveWholeBoundary).toBe(false)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    await ready(t,3)
    expect(t.worker.sent.filter(r=>r.action==='evaluate').at(-1)).toMatchObject({action:'evaluate',net:after})
    t.session.undo();expect(t.session.getPanelState().net).toEqual(before)
    t.session.redo();expect(t.session.getPanelState().net).toEqual(after)
    await t.session.dispose('cancelled')
  })
  it('refuses a locked corner rather than moving only the unblocked part of a whole boundary',async()=>{
    const t=await setup({sheet:true});await selectFace(t);t.session.setFreeBoundary(true);await ready(t,2)
    t.session.selectPoints([0],false);t.session.lockSelected(true);await ready(t,3)
    const before=t.session.getPanelState().net!,history=t.session.getSnapshot().historyRevision
    expect(()=>t.session.moveWholeBoundary('U0',[0,0,.2])).toThrow(/nessuno spostamento parziale/)
    expect(t.session.getPanelState().net).toBe(before)
    expect(t.session.getSnapshot().historyRevision).toBe(history)
    await t.session.dispose('cancelled')
  })
  it('refuses protected mode, solids, symmetry, malformed motion and pending CAD',async()=>{
    const solid=await setup();await selectFace(solid)
    expect(()=>solid.session.moveWholeBoundary('U0',[0,0,.2])).toThrow()
    await solid.session.dispose('cancelled')
    const t=await setup({sheet:true});await selectFace(t)
    expect(()=>t.session.moveWholeBoundary('U0',[0,0,.2])).toThrow()
    t.session.setFreeBoundary(true)
    expect(()=>t.session.moveWholeBoundary('U0',[0,0,.2])).toThrow()
    await ready(t,2)
    for(const delta of [[0,0,0],[0,0,Infinity],[1001,0,0]] as Point[])expect(()=>t.session.moveWholeBoundary('U0',delta)).toThrow()
    expect(()=>t.session.moveWholeBoundary('invalid' as never,[0,0,.1])).toThrow()
    t.session.setSymmetry(true);expect(t.session.getPanelState().canMoveWholeBoundary).toBe(false)
    expect(()=>t.session.moveWholeBoundary('U0',[0,0,.2])).toThrow()
    await t.session.dispose('cancelled')
  })
  it('keeps CAD-refused whole-boundary movement invalid and recoverable with Undo',async()=>{
    const t=await setup({sheet:true});await selectFace(t);t.session.setFreeBoundary(true);await ready(t,2)
    const before=t.session.getPanelState().net!
    t.session.moveWholeBoundary('V1',[0,0,.2]);await vi.advanceTimersByTimeAsync(90)
    t.worker.fail(t.worker.sent.at(-1)!.id,'Bordo CAD non valido.');await flush()
    expect(t.session.getSnapshot().validation.kind).toBe('invalid')
    expect(t.session.getPanelState().canMoveWholeBoundary).toBe(false)
    t.session.undo();expect(t.session.getPanelState().net).toEqual(before)
    await t.session.dispose('cancelled')
  })
})

describe('experimental simultaneous surface-point controller',()=>{
  const pins=()=>[[.3,.4],[.7,.6]].map(([u,v])=>({anchor:{face:0,selectionRevision:1,u,v},
    at:targetSurfacePoint(plane(),{u,v,target:[0,0,0],editablePoles:Array.from({length:25},(_,i)=>i),maxPoleDisplacement:10,minInfluence:.01,residualTolerance:1e-9}).before,normal:[0,0,1]}))
  it('collects and reviews real target pairs without geometry, removes a point and applies the remaining pairs atomically',async()=>{
    const t=await setup();await selectFace(t);t.session.selectPoints([12],false)
    const points=pins(),before=t.session.getPanelState().net!,history=t.session.getSnapshot().historyRevision
    const resolve=(at:Point)=>({point:[at[0],at[1],.02] as Point,kind:'scan' as const,label:'Scan QA',current:()=>true})
    const collect=async(pin:typeof points[number])=>{
      const pending=t.session.pickSurfaceTarget(pin.at,resolve)
      expect(t.worker.sent.at(-1)?.action).toBe('notePick');t.worker.reply(t.worker.sent.at(-1)!.id,pin);await pending
    }
    t.session.beginSurfaceTarget('scan',1,true)
    await collect(points[0]);await collect(points[1])
    expect(t.session.getPanelState().surfaceTargetBatch).toHaveLength(2)
    expect(t.session.getPanelState().surfaceTargetBatch![0]).toEqual({at:points[0].at,target:[...points[0].at.slice(0,2),.02],label:'Scan QA'})
    expect(t.session.getPanelState().net).toBe(before);expect(t.session.getSnapshot().historyRevision).toBe(history)
    t.session.removeSurfaceTarget(0);expect(t.session.getPanelState().surfaceTargetBatch).toHaveLength(1)
    await collect(points[0])
    const pending=t.session.applySurfaceTargets()
    for(const pin of [points[1],points[0]]){expect(t.worker.sent.at(-1)?.action).toBe('noteResolve');t.worker.reply(t.worker.sent.at(-1)!.id,pin);await flush()}
    await pending
    expect(t.session.getPanelState().surfaceTargetBatch).toBeNull();expect(t.session.getSnapshot().historyRevision).toBe(history+1)
    await vi.advanceTimersByTimeAsync(90);t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    expect(t.session.getSnapshot().validation.kind).toBe('valid');t.session.undo()
    expect(t.session.getPanelState().net).toEqual(before);expect(t.session.getPanelState().canUndo).toBe(false)
    await t.session.dispose('cancelled')
  })
  it('retains a current collection after a precommit budget refusal and permits review and cancellation without history',async()=>{
    const t=await setup();await selectFace(t);t.session.selectPoints([12],false)
    const points=pins(),before=t.session.getPanelState().net!,history=t.session.getSnapshot().historyRevision
    t.session.beginSurfaceTarget('scan',.001,true)
    for(const pin of points){
      const pending=t.session.pickSurfaceTarget(pin.at,at=>({point:[at[0],at[1],.02],kind:'scan',label:'Scan QA',current:()=>true}))
      t.worker.reply(t.worker.sent.at(-1)!.id,pin);await pending
    }
    const count=t.worker.sent.length,pairs=t.session.getPanelState().surfaceTargetBatch
    await expect(t.session.applySurfaceTargets()).rejects.toThrow(/limite autorizzato/)
    expect(t.worker.sent).toHaveLength(count) // no CAD resolve/evaluation/commit happened
    expect(t.session.getPanelState().surfaceTargetBatch).toEqual(pairs)
    expect(t.session.getPanelState().surfaceTarget).toBe('scan');expect(t.session.getPanelState().busy).toBe(false)
    expect(t.session.getPanelState().net).toBe(before);expect(t.session.getSnapshot().historyRevision).toBe(history)
    expect(t.session.getPanelState().canUndo).toBe(false)
    t.session.removeSurfaceTarget(0);expect(t.session.getPanelState().surfaceTargetBatch).toHaveLength(1)
    t.session.cancelSurfaceTarget();expect(t.session.getPanelState().surfaceTargetBatch).toBeNull()
    expect(t.session.getPanelState().net).toBe(before);await t.session.dispose('cancelled')
  })
  it.each(['cancel','reference'] as const)('discards collected pairs on %s without changing geometry or Undo',async mode=>{
    const t=await setup();await selectFace(t);t.session.selectPoints([12],false)
    const points=pins(),before=t.session.getPanelState().net!
    let current=true;t.session.beginSurfaceTarget('cad',1,true)
    for(const pin of points){
      const pending=t.session.pickSurfaceTarget(pin.at,at=>({point:[at[0],at[1],.02],kind:'cad',label:'CAD QA',current:()=>current}))
      t.worker.reply(t.worker.sent.at(-1)!.id,pin);await pending
    }
    if(mode==='cancel')t.session.cancelSurfaceTarget()
    else{current=false;await expect(t.session.applySurfaceTargets()).rejects.toThrow(/riferimenti/)}
    expect(t.session.getPanelState().surfaceTargetBatch).toBeNull();expect(t.session.getPanelState().net).toBe(before)
    expect(t.session.getPanelState().canUndo).toBe(false);await t.session.dispose('cancelled')
  })
  it('does not restore a cancelled collection when its CAD pick returns late',async()=>{
    const t=await setup();await selectFace(t);t.session.selectPoints([12],false)
    const before=t.session.getPanelState().net!,pin=pins()[0];t.session.beginSurfaceTarget('scan',1,true)
    const pending=t.session.pickSurfaceTarget(pin.at,at=>({point:[at[0],at[1],.02],kind:'scan',label:'Scan QA',current:()=>true})).catch(e=>e as Error)
    t.session.cancelSurfaceTarget();t.worker.reply(t.worker.sent.at(-1)!.id,pin)
    expect(await pending).toBeInstanceOf(Error);expect(t.session.getPanelState().surfaceTargetBatch).toBeNull()
    expect(t.session.getPanelState().net).toBe(before);expect(t.session.getPanelState().canUndo).toBe(false)
    await t.session.dispose('cancelled')
  })
  it('announces collection counts and Apply availability in the rendered panel after additions and removal',async()=>{
    const {createElement}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server')
    const {WorkspaceSurfaceParameters}=await import('../WorkspaceSurfaceParameters')
    const t=await setup();await selectFace(t);t.session.selectPoints([12],false);t.session.beginSurfaceTarget('scan',1,true)
    const render=()=>renderToStaticMarkup(createElement(WorkspaceSurfaceParameters,{controller:t.session}))
    expect(render()).toMatch(/aria-live="polite"[^>]*aria-atomic="true"/)
    expect(render()).toContain('Punti raccolti: 0 di 8. Servono almeno due punti')
    for(const pin of pins()){
      const pending=t.session.pickSurfaceTarget(pin.at,at=>({point:[at[0],at[1],.02],kind:'scan',label:'Scan QA',current:()=>true}))
      t.worker.reply(t.worker.sent.at(-1)!.id,pin);await pending
    }
    const complete=render();expect(complete).toContain('Punti raccolti: 2 di 8. Puoi applicare')
    expect(complete).toMatch(/data-test="surface-point-apply">/)
    t.session.removeSurfaceTarget(1)
    const removed=render();expect(removed).toContain('Punti raccolti: 1 di 8. Servono almeno due punti')
    expect(removed).toMatch(/data-test="surface-point-apply" disabled/)
    await t.session.dispose('cancelled')
  })
  it('uses CAD picks and current external references for one batch commit and one Undo',async()=>{
    const t=await setup();await selectFace(t);t.session.selectPoints([12],false)
    const points=pins(),before=t.session.getPanelState().net!,history=t.session.getSnapshot().historyRevision
    const resolve=vi.fn((at:Point)=>({point:[at[0],at[1],.02] as Point,kind:'scan' as const,label:'scan QA',current:()=>true}))
    const pending=t.session.targetSurfacePointsExperimental('scan',1,points.map(p=>p.at),resolve)
    for(const pin of points){expect(t.worker.sent.at(-1)?.action).toBe('notePick');t.worker.reply(t.worker.sent.at(-1)!.id,pin);await flush()}
    for(const pin of points){expect(t.worker.sent.at(-1)?.action).toBe('noteResolve');t.worker.reply(t.worker.sent.at(-1)!.id,pin);await flush()}
    await pending
    expect(resolve).toHaveBeenCalledTimes(2);expect(t.session.getSnapshot().historyRevision).toBe(history+1)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    await vi.advanceTimersByTimeAsync(90);t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    t.session.undo();expect(t.session.getPanelState().net).toEqual(before);expect(t.session.getPanelState().canUndo).toBe(false)
    await t.session.dispose('cancelled')
  })
  it.each(['reference','cancel','source'] as const)('refuses an obsolete batch after %s changes while CAD resolves anchors',async mode=>{
    const t=await setup();await selectFace(t);t.session.selectPoints([12],false)
    const points=pins(),before=t.session.getPanelState().net!
    let current=true
    const pending=t.session.targetSurfacePointsExperimental('cad',1,points.map(p=>p.at),at=>({point:[at[0],at[1],.02],kind:'cad',label:'external CAD',current:()=>current})).catch(e=>e as Error)
    for(const pin of points){t.worker.reply(t.worker.sent.at(-1)!.id,pin);await flush()}
    t.worker.reply(t.worker.sent.at(-1)!.id,points[0]);await flush()
    const last=t.worker.sent.at(-1)!
    if(mode==='reference')current=false
    if(mode==='cancel')t.session.cancelSurfaceTarget()
    if(mode==='source')t.invalidate()
    t.worker.reply(last.id,points[1]);expect(await pending).toBeInstanceOf(Error)
    expect(t.session.getPanelState().net).toBe(before);expect(t.session.getPanelState().canUndo).toBe(false)
    await t.session.dispose('cancelled')
  })
})

describe('explicit surface-point reference alignment',()=>{
  const pin={anchor:{face:0,selectionRevision:1,u:.5,v:.5},at:[2,2,0],normal:[0,0,1]}
  it('keeps pole snapping independent, resolves a clicked surface point, and commits one validated Undo step',async()=>{
    const t=await setup();await selectFace(t);t.session.selectPoints([12],false);t.session.setSnap(false)
    expect(t.session.getPanelState().canTargetPoint).toBe(true)
    t.session.beginSurfaceTarget('scan',2)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    const resolve=vi.fn(()=>({point:[2,2,.2] as Point,kind:'scan' as const,label:'Scansione',current:()=>true}))
    const pending=t.session.pickSurfaceTarget([2,2,0],resolve),pick=t.worker.sent.at(-1)!
    expect(pick.action).toBe('notePick');t.worker.reply(pick.id,pin);await flush()
    expect(resolve).toHaveBeenCalledWith([2,2,0],[0,0,1],1,'scan')
    expect(t.worker.sent.at(-1)?.action).toBe('noteResolve')
    t.worker.reply(t.worker.sent.at(-1)!.id,pin);await pending
    expect(t.session.getPanelState().snap).toBe(false)
    expect(t.session.getPanelState().notes).toHaveLength(0)
    expect(t.session.getPanelState().surfaceTarget).toBeNull()
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    await vi.advanceTimersByTimeAsync(90);t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    expect(t.session.getPanelState().net!.poles[12][2]).toBeCloseTo(.8,12)
    t.session.undo();expect(t.session.getPanelState().net).toEqual(plane())
    expect(t.session.getPanelState().canUndo).toBe(false)
    await t.session.dispose('cancelled')
  })
  it.each(['reference','cancel','source'] as const)('does not commit a result when %s changes during resolution',async change=>{
    const t=await setup();await selectFace(t);t.session.selectPoints([12],false);t.session.beginSurfaceTarget('cad',2)
    let current=true
    const pending=t.session.pickSurfaceTarget([2,2,0],()=>({point:[2,2,.2],kind:'cad',label:'Corpo CAD 7',current:()=>current})).catch(e=>e as Error)
    t.worker.reply(t.worker.sent.at(-1)!.id,pin);await flush()
    expect(t.worker.sent.at(-1)?.action).toBe('noteResolve')
    if(change==='reference') current=false
    if(change==='cancel') t.session.cancelSurfaceTarget()
    if(change==='source') t.invalidate()
    t.worker.reply(t.worker.sent.at(-1)!.id,pin)
    expect(await pending).toBeInstanceOf(Error)
    expect(t.session.getPanelState().net).toEqual(plane())
    expect(t.session.getPanelState().canUndo).toBe(false)
    await t.session.dispose('cancelled')
  })
  it('refuses missing references and budgets and disables unsupported symmetry without altering geometry',async()=>{
    const t=await setup();await selectFace(t);t.session.selectPoints([12],false)
    expect(()=>t.session.beginSurfaceTarget('scan',0)).toThrow()
    t.session.beginSurfaceTarget('scan',1)
    const pending=t.session.pickSurfaceTarget([2,2,0],()=>null)
    t.worker.reply(t.worker.sent.at(-1)!.id,pin)
    await expect(pending).rejects.toThrow(/Nessun riferimento/)
    expect(t.session.getPanelState().net).toEqual(plane())
    t.session.setSymmetry(true)
    expect(t.session.getPanelState().canTargetPoint).toBe(false)
    expect(()=>t.session.beginSurfaceTarget('scan',1)).toThrow()
    await t.session.dispose('cancelled')
  })
})

describe('WorkspaceSurfaceSession',()=>{
  it('keeps the navigation control visible while editing a free edge',async()=>{
    const {createElement}=await import('react')
    const {renderToStaticMarkup}=await import('react-dom/server')
    const {WorkspaceSurfaceParameters}=await import('../WorkspaceSurfaceParameters')
    const t=await setup({sheet:true});await selectFace(t);await enterStrip(t)
    t.session.setNavigationOnly(true)
    const html=renderToStaticMarkup(createElement(WorkspaceSurfaceParameters,{controller:t.session}))
    expect(html).toContain('data-test=\"surface-strip-panel\"')
    expect(html).toContain('data-test=\"surface-navigation-only\"')
    expect(html).toMatch(/data-test=\"surface-navigation-only\"[^>]*checked/)
    t.session.setNavigationOnly(false)
    expect(t.session.getViewState().navigationOnly).toBe(false)
    await t.session.dispose('cancelled')
  })
  it('switches between navigation and reticle editing without changing the draft',async()=>{
    const t=await setup();await selectFace(t)
    const before=t.session.getViewState().net
    expect(t.session.getPanelState().navigationOnly).toBe(false)
    t.session.setNavigationOnly(true)
    expect(t.session.getPanelState().navigationOnly).toBe(true)
    expect(t.session.getViewState().navigationOnly).toBe(true)
    expect(t.session.getViewState().net).toBe(before)
    t.session.setNavigationOnly(false)
    expect(t.session.getViewState().navigationOnly).toBe(false)
    await t.session.dispose('cancelled')
  })
  it('does not silently retain a legacy selection when adaptive selection fails on the same face',async()=>{
    const t=await setup();await selectFace(t)
    const choosing=t.session.chooseFace(0,true,true)
    expect(t.worker.sent.at(-1)?.action).toBe('selectAdaptiveExperimental')
    t.worker.fail(t.worker.sent.at(-1)!.id,'risposta persa')
    await expect(choosing).rejects.toThrow('risposta persa')
    expect(t.context.reportFatal).toHaveBeenCalledOnce()
    expect(t.worker.terminate).toHaveBeenCalledOnce()
  })
  it('keeps adaptive selection explicitly opt-in and routes its history recipe',async()=>{
    const t=await setup({blockedPlane:true}), choosing=t.session.chooseFace(0,false,true)
    const request=t.worker.sent.at(-1)!
    expect(request.action).toBe('selectAdaptiveExperimental')
    const selection={face:0,refinements:[{axis:'U',value:.25,count:1}],trimPolicy:'circular-fine-v1',generation:1,trimLocks:[6],hiddenPoles:[]}
    t.worker.reply(request.id,{net:plane(),selection})
    await choosing
    expect(t.session.getViewState().locked).toContain(6)
    await vi.advanceTimersByTimeAsync(90)
    expect(t.worker.sent.at(-1)?.action).toBe('evaluateAdaptiveExperimental')
    t.worker.reply(t.worker.sent.at(-1)!.id,preview(1));await flush()
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    expect(t.session.getPanelState().canRefineNet).toBe(true)
    expect(t.session.getPanelState().canLoadG1).toBe(false)
    expect(t.session.getPanelState().canFreeBoundary).toBe(false)
    const marker={version:8,source:{bodyId:t.binding.bodyKey}} as never
    const save=vi.spyOn(SurfaceDraft.prototype,'createAdaptiveLockedRecipe').mockResolvedValueOnce(marker)
    const prepared=await t.session.prepareHistoryRecipe()
    expect(save).toHaveBeenCalledWith(t.binding.bodyKey)
    expect(prepared.recipe).toBe(marker)
    save.mockRestore()
    await t.session.dispose('cancelled')
  })
  it('installs a protected refined plane with its trim locks and recipe preparation',async()=>{
    const t=await setup({blockedPlane:true}), selecting=t.session.chooseFace(0)
    const request=t.worker.sent.at(-1)!
    expect(request.action).toBe('selectDenseTrimmedPlane')
    const refinements=[{axis:'U',value:.25,count:1}]
    t.worker.reply(request.id,{net:plane(),refinements,trimLocks:[6],hiddenPoles:[]})
    await selecting
    expect(t.session.getPanelState().net).toEqual(plane())
    expect(t.session.getViewState().locked).toContain(6)
    expect(t.session.getPanelState().message).toMatch(/contorni restano protetti/)
    expect(t.runtime.history.current?.preparation?.refinements).toEqual(refinements)
    await t.session.dispose('cancelled')
  })
  it('accepts the fractional body IDs used by multi-part STEP imports',async()=>{
    const t=await setup({bodyId:1.0009765625})
    await selectFace(t)
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    expect(t.session.getSnapshot().current.sourceEpoch).toBe(t.binding.sourceEpoch)
    await t.session.dispose('cancelled')
  })
  it('prepares a history recipe only for the same live source and validated draft', async()=>{
    const t=await setup(); await selectFace(t)
    const marker={version:2,source:{bodyId:t.binding.bodyKey}} as never
    let release!: (value: never) => void
    const pendingRecipe = new Promise<never>(resolve => { release=resolve })
    const create=vi.spyOn(SurfaceDraft.prototype,'createRecipe').mockReturnValueOnce(pendingRecipe)
    const pending=t.session.prepareHistoryRecipe()
    expect(create).toHaveBeenCalledWith(t.binding.bodyKey)
    expect(t.session.getPanelState().busy).toBe(true)
    expect(()=>t.session.selectPoints([12],false)).toThrow()
    release(marker)
    const result=await pending
    expect(result.recipe).toBe(marker)
    expect(result.sourceKey).toContain(t.binding.bodyKey)
    expect(t.session.getPanelState().busy).toBe(false)
    expect(t.session.isHistoryRecipeStampCurrent(result)).toBe(true)
    expect(()=>t.session.freezeHistory({...result})).toThrow('non corrisponde')
    const held=t.session.freezeHistory(result)
    expect(held.isCurrent()).toBe(true)
    expect(t.session.getPanelState().busy).toBe(true)
    expect(()=>t.session.selectPoints([12],false)).toThrow('congelata')
    expect(()=>t.session.freezeHistory(result)).toThrow()
    held.release(); held.release()
    expect(held.isCurrent()).toBe(false)
    expect(t.session.isHistoryRecipeStampCurrent(result)).toBe(true)
    expect(t.session.isHistoryRecipeStampCurrent({ ...result, sessionId: 'other-session' })).toBe(false)
    t.session.selectPoints([12],false)
    expect(t.session.isHistoryRecipeStampCurrent(result)).toBe(false)
    create.mockRestore()
    await t.session.dispose('cancelled')
  })

  it('rejects a history recipe if its source is revoked while preparation is pending', async()=>{
    const t=await setup(); await selectFace(t)
    let release!: (value: never) => void
    const pendingRecipe = new Promise<never>(resolve => { release=resolve })
    const create=vi.spyOn(SurfaceDraft.prototype,'createRecipe').mockReturnValueOnce(pendingRecipe)
    const pending=t.session.prepareHistoryRecipe()
    t.invalidate(); release({version:2} as never)
    await expect(pending).rejects.toThrow('source changed')
    expect(t.session.getPanelState().busy).toBe(false)
    create.mockRestore()
    await t.session.dispose('cancelled')
  })

  it('invalidates a history lock when the host revokes its CAD source', async()=>{
    const t=await setup(); await selectFace(t)
    const create=vi.spyOn(SurfaceDraft.prototype,'createRecipe').mockResolvedValueOnce({version:2} as never)
    const prepared=await t.session.prepareHistoryRecipe()
    const held=t.session.freezeHistory(prepared)
    expect(held.isCurrent()).toBe(true)
    t.invalidate()
    expect(held.isCurrent()).toBe(false)
    held.release()
    create.mockRestore()
    await t.session.dispose('cancelled')
  })

  it('releases a history lock if a listener throws before the host receives it', async()=>{
    const t=await setup(); await selectFace(t)
    const create=vi.spyOn(SurfaceDraft.prototype,'createRecipe').mockResolvedValueOnce({version:2} as never)
    const prepared=await t.session.prepareHistoryRecipe()
    const unsubscribe=t.session.subscribe(()=>{
      if(t.session.getPanelState().busy) throw Error('subscriber failure')
    })
    expect(()=>t.session.freezeHistory(prepared)).toThrow('subscriber failure')
    unsubscribe()
    expect(t.session.getPanelState().busy).toBe(false)
    expect(t.session.isHistoryRecipeStampCurrent(prepared)).toBe(true)
    expect(()=>t.session.selectPoints([12],false)).not.toThrow()
    create.mockRestore()
    await t.session.dispose('cancelled')
  })
  it('starts by moving a point along the normal of a rotated surface', async()=>{
    const t=await setup(), net=plane()
    net.poles=net.poles.map(([u,v]):Point=>[0,u,v])
    await selectFace(t,net)
    expect(t.session.getPanelState().dragMode).toBe('local')
    expect(t.session.getPanelState().axis).toBe(2)
    t.session.selectPoints([12],false);t.session.moveSelected(.25)
    expect(t.session.getPanelState().net!.poles[12]).toEqual([.25,2,2])
    t.session.undo()
    expect(t.session.getPanelState().net!.poles[12]).toEqual([0,2,2])
    await t.session.dispose('cancelled')
  })

  it('stretches along the selected local direction on a rotated surface', async()=>{
    const t=await setup(), net=plane()
    net.poles=net.poles.map(([u,v]):Point=>[0,u,v])
    await selectFace(t,net)
    t.session.setContinuity('G0');t.session.setAxis(0);t.session.selectPoints([6],false)
    t.session.stretchSelected(1.2)
    expect(t.session.getPanelState().net!.poles[6][0]).toBeCloseTo(0)
    expect(t.session.getPanelState().net!.poles[6][1]).toBeCloseTo(.8)
    expect(t.session.getPanelState().net!.poles[6][2]).toBeCloseTo(1)
    t.session.undo()
    expect(t.session.getPanelState().net!.poles[6]).toEqual([0,1,1])
    t.session.redo()
    expect(t.session.getPanelState().net!.poles[6][1]).toBeCloseTo(.8)
    await t.session.dispose('cancelled')
  })

  it('stretches a curved surface along its local tangent and preserves locked poles', async()=>{
    const t=await setup(), net=plane()
    net.poles=net.poles.map(([u,v]):Point=>[u,v,.1*u*u])
    await selectFace(t,net)
    t.session.setContinuity('G0');t.session.selectPoints([7],false);t.session.lockSelected(true)
    t.session.selectPoints([6],false);t.session.setAxis(0)
    t.session.stretchSelected(1.2)
    const result=t.session.getPanelState().net!
    // Independent derivative of this cubic B-spline at pole 6's Greville
    // parameter: dZ/dX = 12/65. The centre is the mean of all 25 poles.
    const expectedX=1-(.2*71*65)/4369, expectedZ=.1-(.2*71*12)/4369
    expect(result.poles[6][0]).toBeCloseTo(expectedX, 8)
    expect(result.poles[6][1]).toBeCloseTo(1, 8)
    expect(result.poles[6][2]).toBeCloseTo(expectedZ, 8)
    expect(result.poles[7]).toEqual(net.poles[7])
    t.session.undo();expect(t.session.getPanelState().net!.poles[6]).toEqual(net.poles[6])
    await t.session.dispose('cancelled')
  })

  it('preserves a changed draft if switching faces is cancelled, and switches only after confirmation', async()=>{
    const t=await setup();await selectFace(t)
    t.session.selectPoints([12],false);t.session.moveSelected(.2)
    const before=structuredClone(t.session.getPanelState().net!.poles)
    const decline=vi.fn((_message:string)=>false)
    await expect(t.session.requestFaceSelection(1,decline)).rejects.toThrow('Attendi la verifica CAD')
    expect(decline).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(90)
    t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    await t.session.requestFaceSelection(1,decline)
    expect(decline).toHaveBeenCalledOnce()
    expect(t.session.getPanelState().face).toBe(0)
    expect(t.session.getPanelState().net!.poles).toEqual(before)
    const accept=vi.fn(()=>true), pending=t.session.requestFaceSelection(1,accept)
    const request=t.worker.sent.at(-1)!
    expect(request.action).toBe('select')
    t.worker.reply(request.id,plane());await pending
    expect(accept).toHaveBeenCalledOnce()
    expect(t.session.getPanelState().face).toBe(1)
    await t.session.dispose('cancelled')
  })

  it('keeps the current draft and undo history if loading the new face fails', async()=>{
    const t=await setup();await selectFace(t)
    t.session.selectPoints([12],false);t.session.moveSelected(.2)
    await vi.advanceTimersByTimeAsync(90)
    t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    const before=structuredClone(t.session.getPanelState().net!.poles)
    const pending=t.session.requestFaceSelection(1,()=>true)
    const request=t.worker.sent.at(-1)!
    expect(request.action).toBe('select')
    expect(t.session.getPanelState().net!.poles).toEqual(before)
    t.worker.fail(request.id,'Caricamento non riuscito')
    await expect(pending).rejects.toThrow('Caricamento non riuscito')
    expect(t.session.getPanelState().face).toBe(0)
    expect(t.session.getPanelState().net!.poles).toEqual(before)
    expect(t.session.getPanelState().canUndo).toBe(true)
    t.session.undo()
    expect(t.session.getPanelState().net!.poles[12][2]).toBe(0)
    await t.session.dispose('cancelled')
  })

  it('discards draft notes only after confirmation and successful face loading', async()=>{
    const t=await setup({annotated:true});await selectFace(t)
    await addNote(t,'Nota da conservare',.5)
    const decline=vi.fn((_message:string)=>false)
    await t.session.requestFaceSelection(1,decline)
    expect(decline).toHaveBeenCalledOnce()
    expect(decline.mock.calls[0][0]).toMatch(/note/)
    expect(t.session.getPanelState().notes).toMatchObject([{text:'Nota da conservare'}])
    expect(t.session.getPanelState().face).toBe(0)
    const failed=t.session.requestFaceSelection(1,()=>true), request=t.worker.sent.at(-1)!
    expect(request.action).toBe('select')
    t.worker.fail(request.id,'Caricamento non riuscito')
    await expect(failed).rejects.toThrow('Caricamento non riuscito')
    expect(t.session.getPanelState().notes).toMatchObject([{text:'Nota da conservare'}])
    expect(t.session.getPanelState().face).toBe(0)
    const accepted=t.session.requestFaceSelection(1,()=>true), next=t.worker.sent.at(-1)!
    t.worker.reply(next.id,plane());await accepted
    expect(t.session.getPanelState().face).toBe(1)
    expect(t.session.getPanelState().notes).toHaveLength(0)
    await t.session.dispose('cancelled')
  })

  it('retains draft notes if the CAD source changes while another face loads', async()=>{
    const t=await setup({annotated:true});await selectFace(t)
    await addNote(t,'Nota da conservare',.5)
    const pending=t.session.requestFaceSelection(1,()=>true), request=t.worker.sent.at(-1)!
    t.invalidate()
    t.worker.reply(request.id,plane())
    await expect(pending).rejects.toThrow()
    expect(t.session.getPanelState().notes).toMatchObject([{text:'Nota da conservare'}])
    expect(t.session.getPanelState().face).toBe(0)
    await t.session.dispose('cancelled')
  })

  it('ignores a failed stale note resolution after a note is removed', async()=>{
    const t=await setup({annotated:true});await selectFace(t)
    const removed=await addNote(t,'Da rimuovere',.25)
    const remaining=await addNote(t,'Da conservare',.75)
    t.session.selectPoints([12],false);t.session.moveSelected(.2)
    await vi.advanceTimersByTimeAsync(90)
    t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    const original=t.worker.sent.filter(request=>request.action==='noteResolve')
    expect(original).toHaveLength(2)
    t.session.removeNote(removed)
    t.worker.fail(original[0].id,'errore obsoleto');await flush()
    const retried=t.worker.sent.filter(request=>request.action==='noteResolve')
    expect(retried).toHaveLength(3)
    expect(t.session.getPanelState().noteResolutionError).toBe(false)
    t.worker.reply(retried[2].id,{at:[.75,2,4],normal:[0,0,1]});await flush()
    t.worker.reply(original[1].id,{at:[99,99,99],normal:[0,0,1]});await flush()
    expect(t.session.getPanelState().notes).toMatchObject([{id:remaining,text:'Da conservare',at:[.75,2,4]}])
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    expect(t.session.getPanelState().message).toBeNull()
    await t.session.dispose('cancelled')
  })

  it('keeps a failed note and retries only when requested', async()=>{
    const t=await setup({annotated:true});await selectFace(t)
    await addNote(t,'Da conservare',.5)
    t.session.selectPoints([12],false);t.session.moveSelected(.2)
    await vi.advanceTimersByTimeAsync(90)
    t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    const failed=t.worker.sent.at(-1)!
    expect(failed.action).toBe('noteResolve')
    t.worker.fail(failed.id,'nota temporaneamente non disponibile');await flush()
    expect(t.session.getPanelState().noteResolutionError).toBe(true)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    const count=t.worker.sent.length, history=t.session.getSnapshot().historyRevision
    t.session.setSnap(false);await flush()
    expect(t.worker.sent).toHaveLength(count)
    t.session.retryNoteResolution()
    const retried=t.worker.sent.at(-1)!
    expect(retried.action).toBe('noteResolve')
    expect(retried.id).not.toBe(failed.id)
    t.worker.reply(retried.id,{at:[.5,2,4],normal:[0,0,1]});await flush()
    expect(t.session.getPanelState().noteResolutionError).toBe(false)
    expect(t.session.getPanelState().notes).toMatchObject([{text:'Da conservare',at:[.5,2,4]}])
    expect(t.session.getSnapshot()).toMatchObject({historyRevision:history,validation:{kind:'valid'}})
    await t.session.dispose('cancelled')
  })

  it('prepares a modified STEP solid and a Zebra note on a real reversed face', async()=>{
    vi.useFakeTimers()
    const editor=await SurfaceEditorKernel.load(), k=editor.kernel, box=k.makeBox(20,30,10)
    let imported:ReturnType<typeof k.importStep> | null=null, faces:ReturnType<typeof k.getSubShapes>=[]
    let session:WorkspaceSurfaceSession | undefined
    try {
      const source=k.exportStep(box), sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
      const sourceBytes=new TextEncoder().encode(source), hash=sha(sourceBytes), abort=new AbortController()
      imported=k.importStep(source);faces=k.getSubShapes(imported,'face')
      const index=faces.findIndex(face=>k.shapeOrientation(face)==='reversed')
      expect(index).toBeGreaterThanOrEqual(0)
      const face=faces[index], bounds=k.uvBounds(face), u=(bounds.uMin+bounds.uMax)/2, v=(bounds.vMin+bounds.vMax)/2
      const p=k.pointOnSurface(face,u,v), seed:[number,number,number]=[p.x,p.y,p.z]
      const outward=[p.x-10,p.y-15,p.z-5], length=Math.hypot(...outward)
      class KernelWorker extends FakeWorker {
        constructor(private readonly target: SurfaceEditorKernel = editor) { super() }
        postMessage(message: Msg) {
          this.sent.push(message)
          void Promise.resolve().then(async()=>{
            try {
              const m=message as Msg & {step:string;face:number;continuity:'G0'|'G1';freeBoundary:boolean;previewRevision:number;point:Point;bodyId:string;recipe:unknown;lockedPoles:number[];anchor:Parameters<SurfaceEditorKernel['resolveAnchor']>[0]}
              const e=this.target
              const value=m.action==='open' ? e.open(m.step) : m.action==='select' ? e.select(m.face) :
                m.action==='evaluate' ? e.evaluate(m.net!,m.continuity,!!m.exportStep,m.freeBoundary) :
                m.action==='createRecipe' ? await e.createRecipe(m.net!,m.continuity,m.lockedPoles,m.bodyId,m.freeBoundary) :
                m.action==='restoreRecipe' ? await e.restoreRecipe(m.step,m.recipe,m.bodyId) :
                m.action==='replayRecipe' ? await e.replayRecipe(m.step,m.recipe,m.bodyId) :
                m.action==='notePick' ? e.anchorFromPick(m.point,m.previewRevision) :
                m.action==='noteResolve' ? e.resolveAnchor(m.anchor,m.previewRevision) :
                m.action==='finalFaceWitness' ? e.finalFaceWitness(m.previewRevision) : (()=>{throw Error(`unexpected worker action: ${m.action}`)})()
              this.reply(m.id,value)
            } catch(error) { this.onmessage?.({data:{id:message.id,error:String((error as Error).message)}} as MessageEvent<unknown>) }
          })
        }
      }
      const worker=new KernelWorker(), runtime=new SurfaceRuntime(()=>worker as unknown as Worker)
      const sourceBinding={documentEpoch:'doc',sourceEpoch:1,bodyId:1,bodyKey:'box',buildVersion:1,kernelGeneration:1,
        frameRevision:1,stepSha256:hash,units:'mm',coordinateFrame:'part'}
      const context={apiVersion:1,sessionId:'real-annotated',source:sourceBinding,step:sourceBytes,
        capabilities:{apiVersion:1,enabled:true,annotationVersion:1,commitKinds:['cad-copy','annotated-cad-copy']},
        signal:abort.signal,assertSourceCurrent:()=>{},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
      session=await createWorkspaceSurfaceSession(context as never,vi.fn() as never,{runtime,sha256:async bytes=>sha(bytes)})
      await session.chooseFace(index)
      await vi.advanceTimersByTimeAsync(90);await flush()
      expect(session.getSnapshot().validation.kind).toBe('valid')
      session.selectAllFree(); session.moveSelected(.1)
      await vi.advanceTimersByTimeAsync(90);await flush()
      expect(session.getSnapshot().validation.kind).toBe('valid')
      const recipe=await session.prepareHistoryRecipe()
      expect(recipe.recipe.source.bodyId).toBe('box')
      expect(recipe.recipe.faceIndex).toBe(index)
      const replay=await editor.replayRecipe(source,recipe.recipe,'box')
      const netBeforeReplay=session.getPanelState().net?.poles.map(point=>[...point])
      const replayEditor=new SurfaceEditorKernel(k), replayWorker=new KernelWorker(replayEditor)
      try {
        const independent=await replaySurfaceHistory({bodyKey:'box',stepSha256:sha(context.step),step:context.step,assertCurrent:()=>{}},
          JSON.parse(JSON.stringify(recipe.recipe)),undefined,()=>replayWorker as unknown as Worker)
        expect(independent.valid).toBe(true)
        expect(independent.step).toBeTruthy()
        const independentSolid=k.importStep(independent.step)
        try {
          expect(k.isValid(independentSolid)).toBe(true)
          expect(k.getVolume(independentSolid)).toBeCloseTo(replay.volume,7)
          const shapes=k.getSubShapes(independentSolid,'solid')
          try { expect(shapes).toHaveLength(1) } finally { shapes.forEach(shape=>k.release(shape)) }
        } finally { k.release(independentSolid) }
        expect(replayWorker.terminate).toHaveBeenCalledOnce()
        expect(session.getPanelState().net?.poles).toEqual(netBeforeReplay)
      } finally { replayEditor.dispose() }
      const staleEditor=new SurfaceEditorKernel(k), staleWorker=new KernelWorker(staleEditor)
      try {
        let checks=0
        await expect(replaySurfaceHistory({bodyKey:'box',stepSha256:hash,step:context.step,
          assertCurrent:()=>{if(++checks===3)throw Error('source changed')}},recipe.recipe,
          undefined,()=>staleWorker as unknown as Worker)).rejects.toThrow('source changed')
        expect(staleWorker.terminate).toHaveBeenCalledOnce()
        expect(session.getPanelState().net?.poles).toEqual(netBeforeReplay)
      } finally { staleEditor.dispose() }
      expect(replay.valid).toBe(true)
      expect(Math.abs(replay.volume - k.getVolume(box))).toBeGreaterThan(.001)
      await vi.advanceTimersByTimeAsync(90);await flush()
      expect(session.getSnapshot().validation.kind).toBe('valid')
      expect(session.isHistoryRecipeStampCurrent(recipe)).toBe(true)
      expect(session.isHistoryRecipeStampCurrent({...recipe})).toBe(false)
      const originalFace=recipe.recipe.faceIndex
      recipe.recipe.faceIndex=(originalFace+1)%faces.length
      expect(session.isHistoryRecipeStampCurrent(recipe)).toBe(false)
      recipe.recipe.faceIndex=originalFace
      expect(session.isHistoryRecipeStampCurrent(recipe)).toBe(true)
      await expect(session.restoreHistoryRecipe(recipe.recipe)).rejects.toThrow('nuova sessione vuota')
      const restoredEditor=new SurfaceEditorKernel(k), restoredWorker=new KernelWorker(restoredEditor)
      const restoredRuntime=new SurfaceRuntime(()=>restoredWorker as unknown as Worker)
      const restoredContext={...context,sessionId:'restored-session'}
      let restored:WorkspaceSurfaceSession | undefined
      try {
        restored=await createWorkspaceSurfaceSession(restoredContext as never,vi.fn() as never,{runtime:restoredRuntime,sha256:async bytes=>sha(bytes)})
        await expect(restored.waitRestoredHistoryReady()).rejects.toThrow('Nessuna ricetta')
        const wrongBody=JSON.parse(JSON.stringify(recipe.recipe))
        wrongBody.source.bodyId='another-body'
        await expect(restored.restoreHistoryRecipe(wrongBody)).rejects.toThrow('altro corpo CAD')
        expect(restored.getPanelState().face).toBe(-1)
        await restored.restoreHistoryRecipe(JSON.parse(JSON.stringify(recipe.recipe)))
        const cancelled=new AbortController();cancelled.abort()
        await expect(restored.waitRestoredHistoryReady(cancelled.signal)).rejects.toMatchObject({name:'AbortError'})
        const ready=restored.waitRestoredHistoryReady()
        await vi.advanceTimersByTimeAsync(90);await flush()
        await expect(ready).resolves.toBeUndefined()
        expect(restored.getPanelState().face).toBe(index)
        expect(restored.getPanelState().net?.poles).toEqual(session.getPanelState().net?.poles)
        expect(restored.getSnapshot().validation.kind).toBe('valid')
        expect(restored.isHistoryRecipeStampCurrent(recipe)).toBe(false)
        const revision=restored.getViewState().preview?.previewRevision
        if(revision===undefined)throw Error('restored preview missing revision')
        const picked=restoredEditor.anchorFromPick(seed,revision)
        const savedNote={id:'note-1',text:'Controlla la faccia',faceIndex:index,u:picked.anchor.u,v:picked.anchor.v}
        const noteAbort=new AbortController(), originalPost=restoredWorker.postMessage.bind(restoredWorker)
        restoredWorker.postMessage=(message:Msg)=>{
          if(message.action==='finalFaceWitness')noteAbort.abort()
          originalPost(message)
        }
        await expect(restored.restoreHistoryNotes([savedNote],noteAbort.signal)).rejects.toMatchObject({name:'AbortError'})
        expect(restored.getPanelState().notes).toHaveLength(0)
        restoredWorker.postMessage=originalPost;await flush()
        await expect(restored.restoreHistoryNotes([savedNote,{...savedNote,id:'bad',u:1e9}])).rejects.toThrow()
        expect(restored.getPanelState().notes).toHaveLength(0)
        await restored.restoreHistoryNotes([savedNote])
        expect(restored.getPanelState().notes).toHaveLength(1)
        expect(restored.getPanelState().notes[0]).toMatchObject({id:'note-1',text:'Controlla la faccia'})
        expect(restored.getPanelState().notes[0].at).toEqual(picked.at)
        restored.selectAllFree();restored.moveSelected(.2)
        await vi.advanceTimersByTimeAsync(90);await flush()
        expect(restored.getSnapshot().validation.kind).toBe('valid')
        expect(restored.getPanelState().notes[0].text).toBe('Controlla la faccia')
        expect(restored.getPanelState().notes[0].at).not.toEqual(picked.at)
      } finally { if(restored)await restored.dispose('cancelled');restoredEditor.dispose() }
      const changedEditor=new SurfaceEditorKernel(k),changedWorker=new KernelWorker(changedEditor)
      const changedRuntime=new SurfaceRuntime(()=>changedWorker as unknown as Worker)
      let changed:WorkspaceSurfaceSession | undefined
      try {
        changed=await createWorkspaceSurfaceSession({...context,sessionId:'changed-restore'} as never,vi.fn() as never,
          {runtime:changedRuntime,sha256:async bytes=>sha(bytes)})
        await changed.restoreHistoryRecipe(JSON.parse(JSON.stringify(recipe.recipe)))
        const waiting=changed.waitRestoredHistoryReady()
        const rejection=expect(waiting).rejects.toThrow('superficie è cambiata')
        changed.selectPoints([12],false)
        await rejection
      } finally { if(changed)await changed.dispose('cancelled');changedEditor.dispose() }
      const closedEditor=new SurfaceEditorKernel(k),closedWorker=new KernelWorker(closedEditor)
      const closedRuntime=new SurfaceRuntime(()=>closedWorker as unknown as Worker)
      let closed:WorkspaceSurfaceSession | undefined
      try {
        closed=await createWorkspaceSurfaceSession({...context,sessionId:'closed-restore'} as never,vi.fn() as never,
          {runtime:closedRuntime,sha256:async bytes=>sha(bytes)})
        await closed.restoreHistoryRecipe(JSON.parse(JSON.stringify(recipe.recipe)))
        const waiting=closed.waitRestoredHistoryReady()
        const rejection=expect(waiting).rejects.toMatchObject({name:'AbortError'})
        await closed.dispose('cancelled')
        await rejection
      } finally { if(closed)await closed.dispose('cancelled');closedEditor.dispose() }
      const failedEditor=new SurfaceEditorKernel(k), failedWorker=new KernelWorker(failedEditor)
      const failedRuntime=new SurfaceRuntime(()=>failedWorker as unknown as Worker), fatal=vi.fn()
      const failedContext={...context,sessionId:'failed-restore',reportFatal:fatal}
      let failed:WorkspaceSurfaceSession | undefined
      try {
        failed=await createWorkspaceSurfaceSession(failedContext as never,vi.fn() as never,{runtime:failedRuntime,sha256:async bytes=>sha(bytes)})
        const corrupted=JSON.parse(JSON.stringify(recipe.recipe))
        corrupted.baseNetSha256='0'.repeat(64)
        await expect(failed.restoreHistoryRecipe(corrupted)).rejects.toThrow()
        expect(fatal).toHaveBeenCalledOnce()
        expect(failedRuntime.active).toBe(false)
        expect(session.getSnapshot().validation.kind).toBe('valid')
      } finally { if(failed)await failed.dispose('cancelled');failedEditor.dispose() }
      session.setStripes({orientation:'horizontal',width:3,color:'#5288b2'})
      session.setPlacingNote(true);await session.placeNote(seed)
      const note=session.getPanelState().notes[0]
      session.setNoteText(note.id,'Controlla la faccia inversa')
      expect(session.isHistoryRecipeStampCurrent(recipe)).toBe(false)
      await expect(session.prepareHistoryRecipe()).rejects.toThrow('senza note')
      const annotated=await session.prepareAnnotatedHistory()
      expect(annotated.notes).toHaveLength(1)
      expect(annotated.notes[0]).toMatchObject({id:note.id,text:'Controlla la faccia inversa',faceIndex:index})
      await vi.advanceTimersByTimeAsync(90);await flush()
      expect(session.isAnnotatedHistoryStampCurrent(annotated)).toBe(true)
      const heldHistory=session.freezeHistory(annotated)
      expect(heldHistory.isCurrent()).toBe(true)
      expect(()=>session!.setNoteText(note.id,'Altra nota')).toThrow('congelata')
      annotated.recipe.faceIndex=(index+1)%faces.length
      expect(heldHistory.isCurrent()).toBe(false)
      annotated.recipe.faceIndex=index
      expect(heldHistory.isCurrent()).toBe(true)
      heldHistory.release()
      expect(heldHistory.isCurrent()).toBe(false)
      expect(session.isAnnotatedHistoryStampCurrent({...annotated})).toBe(false)
      annotated.recipe.faceIndex=(annotated.recipe.faceIndex+1)%faces.length
      expect(session.isAnnotatedHistoryStampCurrent(annotated)).toBe(false)
      annotated.recipe.faceIndex=index
      expect(session.isAnnotatedHistoryStampCurrent(annotated)).toBe(true)
      const annotatedEditor=new SurfaceEditorKernel(k), annotatedWorker=new KernelWorker(annotatedEditor)
      const annotatedRuntime=new SurfaceRuntime(()=>annotatedWorker as unknown as Worker)
      let reopened:WorkspaceSurfaceSession | undefined
      try {
        reopened=await createWorkspaceSurfaceSession({...context,sessionId:'annotated-reopen'} as never,vi.fn() as never,
          {runtime:annotatedRuntime,sha256:async bytes=>sha(bytes)})
        await reopened.restoreHistoryRecipe(JSON.parse(JSON.stringify(annotated.recipe)))
        await vi.advanceTimersByTimeAsync(90);await flush()
        await reopened.restoreHistoryNotes(JSON.parse(JSON.stringify(annotated.notes)))
        expect(reopened.getPanelState().notes[0]).toMatchObject({id:note.id,text:'Controlla la faccia inversa'})
        expect(reopened.getPanelState().notes[0].at).toEqual(note.at)
      } finally { if(reopened)await reopened.dispose('cancelled');annotatedEditor.dispose() }
      const bundleEditor=new SurfaceEditorKernel(k),bundleWorker=new KernelWorker(bundleEditor)
      const bundleRuntime=new SurfaceRuntime(()=>bundleWorker as unknown as Worker),bundleFatal=vi.fn()
      let bundleSession:WorkspaceSurfaceSession | undefined
      try {
        bundleSession=await createWorkspaceSurfaceSession({...context,sessionId:'bundle-reopen',reportFatal:bundleFatal} as never,
          vi.fn() as never,{runtime:bundleRuntime,sha256:async bytes=>sha(bytes)})
        const operation=bundleSession.restoreHistoryBundle({recipe:annotated.recipe,notes:annotated.notes})
        let settled=false;void operation.then(()=>{settled=true},()=>{settled=true})
        for(let i=0;i<20&&!settled;i++){await flush();await vi.advanceTimersByTimeAsync(90)}
        expect(settled).toBe(true);await operation
        expect(bundleSession.getSnapshot().validation.kind).toBe('valid')
        expect(bundleSession.getPanelState().notes[0]).toMatchObject({id:note.id,text:'Controlla la faccia inversa'})
        expect(bundleFatal).not.toHaveBeenCalled()
      } finally { if(bundleSession)await bundleSession.dispose('cancelled');bundleEditor.dispose() }
      const rejectedEditor=new SurfaceEditorKernel(k),rejectedWorker=new KernelWorker(rejectedEditor)
      const rejectedRuntime=new SurfaceRuntime(()=>rejectedWorker as unknown as Worker),rejectedFatal=vi.fn()
      let rejectedSession:WorkspaceSurfaceSession | undefined
      try {
        rejectedSession=await createWorkspaceSurfaceSession({...context,sessionId:'bundle-reject',reportFatal:rejectedFatal} as never,
          vi.fn() as never,{runtime:rejectedRuntime,sha256:async bytes=>sha(bytes)})
        const operation=rejectedSession.restoreHistoryBundle({recipe:annotated.recipe,notes:[{...annotated.notes[0],u:1e9}]})
        const rejection=expect(operation).rejects.toThrow()
        let settled=false;void operation.then(()=>{settled=true},()=>{settled=true})
        for(let i=0;i<20&&!settled;i++){await flush();await vi.advanceTimersByTimeAsync(90)}
        expect(settled).toBe(true);await rejection
        expect(rejectedFatal).toHaveBeenCalledOnce()
        expect(rejectedRuntime.active).toBe(false)
        expect(session.getSnapshot().validation.kind).toBe('valid')
      } finally { if(rejectedSession)await rejectedSession.dispose('cancelled');rejectedEditor.dispose() }
      await vi.advanceTimersByTimeAsync(90);await flush()
      session.setNoteText(note.id,'Testo cambiato')
      expect(session.isAnnotatedHistoryStampCurrent(annotated)).toBe(false)
      session.setNoteText(note.id,'Controlla la faccia inversa')
      session.selectAllFree();expect(session.getPanelState().selected.length).toBeGreaterThan(0)
      session.moveSelected(.2)
      expect(session.isAnnotatedHistoryStampCurrent(annotated)).toBe(false)
      await vi.advanceTimersByTimeAsync(90);await flush()
      expect(session.getSnapshot().validation.kind).toBe('valid')
      expect(session.getViewState().stripes).toMatchObject({orientation:'horizontal'})
      const state=session.getSnapshot()
      if(state.validation.kind!=='valid')throw Error('annotated preview not valid')
      const ticket={annotationVersion:1,operationId:'real-annotated',mode:'annotated-cad-copy',source:sourceBinding,
        stamp:state.validation.stamp,notesRevision:state.notesRevision}
      const release=session.freezeAnnotated(ticket as never)
      const result=await session.prepareAnnotatedApply(ticket as never,new AbortController().signal)
      const saved=k.importStep(new TextDecoder().decode(result.step)), witness=k.fromBREP(result.witnesses[0].brep)
      try {
        expect(k.isValid(saved)).toBe(true)
        const solids=k.getSubShapes(saved,'solid')
        try {expect(solids).toHaveLength(1)} finally {solids.forEach(s=>k.release(s))}
        expect(result.witnesses[0].finalStepSha256).toBe(sha(result.step))
        expect(result.witnesses[0].brepSha256).toBe(sha(new TextEncoder().encode(result.witnesses[0].brep)))
        expect(result.notes).toHaveLength(1)
        const target=result.notes[0].target as {sourceUV:readonly [number,number];resolvedAt:readonly number[];orientedNormal:readonly number[]}
        const q=k.pointOnSurface(witness,...target.sourceUV)
        expect(Math.hypot(q.x-target.resolvedAt[0],q.y-target.resolvedAt[1],q.z-target.resolvedAt[2])).toBeLessThan(1e-7)
        expect(target.orientedNormal.reduce((sum,n,i)=>sum+n*outward[i]/length,0)).toBeGreaterThan(.99)
        expect(result.notes[0].text).toBe('Controlla la faccia inversa')
        expect(sourceBytes).toEqual(new TextEncoder().encode(source))
      } finally {k.release(witness);k.release(saved)}
      release()
    } finally {
      if(session)await session.dispose('cancelled')
      faces.forEach(face=>k.release(face));if(imported!==null)k.release(imported)
      k.release(box);editor.dispose()
    }
  },60000)

  it('prepares every annotated note from the final CAD evaluation without publishing the draft', async()=>{
    const t=await setup({annotated:true});await selectFace(t)
    const first=await addNote(t,'Controlla il bordo',.25)
    const second=await addNote(t,'Verifica raccordo',.75)
    const value=annotatedTicket(t), before=t.session.getSnapshot()
    expect(value.notesRevision).toBe(4)
    const release=t.session.freezeAnnotated(value as never)
    expect(()=>t.session.setNoteText(first,'non consentito')).toThrow('congelata')
    expect(()=>t.session.removeNote(second)).toThrow('congelata')
    expect(()=>t.session.undo()).toThrow('congelata')
    const preparing=t.session.prepareAnnotatedApply(value as never,new AbortController().signal)
    await expect(t.session.prepareAnnotatedApply(value as never,new AbortController().signal)).rejects.toThrow('già in preparazione')
    let request=t.worker.sent.at(-1)!
    expect(request).toMatchObject({action:'evaluate',exportStep:true})
    t.worker.reply(request.id,{...preview(2),step:'FINAL STEP'});await flush()
    request=t.worker.sent.at(-1)!
    expect(request.action).toBe('finalFaceWitness')
    t.worker.reply(request.id,{face:0,selectionRevision:1,previewRevision:2,faceBrep:'FINAL BREP'});await flush()
    request=t.worker.sent.at(-1)!
    expect(request.action).toBe('noteResolve')
    t.worker.reply(request.id,{at:[.25,2,4],normal:[0,0,1]});await flush()
    request=t.worker.sent.at(-1)!
    expect(request.action).toBe('noteResolve')
    t.worker.reply(request.id,{at:[.75,2,4],normal:[0,0,1]});await flush()
    const output=await preparing
    const sha=(text:string)=>createHash('sha256').update(text).digest('hex')
    expect(output).toMatchObject({kind:'annotated-cad-copy',annotationVersion:1,operationId:value.operationId,
      notesRevision:value.notesRevision,units:'mm',coordinateFrame:'part',source:value.source,stamp:value.stamp,
      witnesses:[{kind:'occt-face-brep',brep:'FINAL BREP',brepSha256:sha('FINAL BREP'),finalStepSha256:sha('FINAL STEP'),stamp:value.stamp}],
      notes:[{draftId:first,text:'Controlla il bordo',target:{sourceUV:[.25,.5],resolvedAt:[.25,2,4],orientedNormal:[0,0,1],resolvedStamp:value.stamp}},
        {draftId:second,text:'Verifica raccordo',target:{sourceUV:[.75,.5],resolvedAt:[.75,2,4],orientedNormal:[0,0,1],resolvedStamp:value.stamp}}]})
    expect(new TextDecoder().decode(output.step)).toBe('FINAL STEP')
    expect(t.session.getSnapshot()).toMatchObject({draftNoteCount:2,notesRevision:value.notesRevision,historyRevision:before.historyRevision,
      validation:{kind:'valid',stamp:value.stamp}})
    expect(t.context.step).toEqual(new Uint8Array([1,2,3]))
    release()
    expect(t.session.getSnapshot().draftNoteCount).toBe(2)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    await t.session.dispose('cancelled')
  })

  it('requires a capable host, complete text, and a matching note revision', async()=>{
    const old=await setup();await selectFace(old)
    expect(()=>old.session.freezeAnnotated({} as never)).toThrow('non supporta')
    await old.session.dispose('cancelled')
    const t=await setup({annotated:true});await selectFace(t)
    const id=await addNote(t,'',.5)
    expect(t.session.getSnapshot().validation.kind).toBe('invalid')
    expect(()=>t.session.freezeAnnotated({} as never)).toThrow('Completa')
    t.session.setNoteText(id,'Nota valida')
    const value=annotatedTicket(t)
    expect(()=>t.session.freezeAnnotated({...value,notesRevision:value.notesRevision-1} as never)).toThrow('ticket')
    const release=t.session.freezeAnnotated(value as never);release()
    await t.session.dispose('cancelled')
  })

  it('does not offer annotated publication for a disabled or incompatible host', async()=>{
    const t=await setup({annotated:true});await selectFace(t)
    const capability=t.context.capabilities as {apiVersion:number;enabled:boolean;annotationVersion?:number;commitKinds:string[]}
    capability.enabled=false
    expect(()=>t.session.freezeAnnotated({} as never)).toThrow('non supporta')
    capability.enabled=true;capability.apiVersion=2
    expect(()=>t.session.freezeAnnotated({} as never)).toThrow('non supporta')
    capability.apiVersion=1;capability.commitKinds=[]
    expect(()=>t.session.freezeAnnotated({} as never)).toThrow('non supporta')
    await t.session.dispose('cancelled')
  })

  it('rejects a final note failure without returning a partial package or losing either note', async()=>{
    const t=await setup({annotated:true});await selectFace(t)
    await addNote(t,'Prima',.25);await addNote(t,'Seconda',.75)
    const value=annotatedTicket(t), release=t.session.freezeAnnotated(value as never)
    const preparing=t.session.prepareAnnotatedApply(value as never,new AbortController().signal)
    const rejected=expect(preparing).rejects.toThrow('nota fuori dalla faccia')
    let request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,{...preview(2),step:'FINAL STEP'});await flush()
    request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,{face:0,selectionRevision:1,previewRevision:2,faceBrep:'FINAL BREP'});await flush()
    request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,{at:[.25,2,4],normal:[0,0,1]});await flush()
    request=t.worker.sent.at(-1)!
    t.worker.fail(request.id,'nota fuori dalla faccia')
    await rejected
    release()
    expect(t.session.getPanelState().notes.map(note=>note.text)).toEqual(['Prima','Seconda'])
    expect(t.session.getSnapshot().draftNoteCount).toBe(2)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    await t.session.dispose('cancelled')
  })

  it('refuses an annotated result if the source changes while the witness is pending', async()=>{
    const t=await setup({annotated:true});await selectFace(t)
    await addNote(t,'Da conservare',.5)
    const value=annotatedTicket(t), release=t.session.freezeAnnotated(value as never)
    const preparing=t.session.prepareAnnotatedApply(value as never,new AbortController().signal)
    const rejected=expect(preparing).rejects.toThrow('source changed')
    let request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,{...preview(2),step:'FINAL STEP'});await flush()
    request=t.worker.sent.at(-1)!
    expect(request.action).toBe('finalFaceWitness')
    t.invalidate()
    t.worker.reply(request.id,{face:0,selectionRevision:1,previewRevision:2,faceBrep:'FINAL BREP'})
    await rejected
    release()
    expect(t.session.getPanelState().notes.map(note=>note.text)).toEqual(['Da conservare'])
    expect(t.context.step).toEqual(new Uint8Array([1,2,3]))
    await t.session.dispose('source-invalid')
  })

  it('rejects an invalid final normal instead of publishing an ambiguous note', async()=>{
    const t=await setup({annotated:true});await selectFace(t)
    await addNote(t,'Da conservare',.5)
    const value=annotatedTicket(t), release=t.session.freezeAnnotated(value as never)
    const preparing=t.session.prepareAnnotatedApply(value as never,new AbortController().signal)
    const rejected=expect(preparing).rejects.toThrow('normale finale')
    let request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,{...preview(2),step:'FINAL STEP'});await flush()
    request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,{face:0,selectionRevision:1,previewRevision:2,faceBrep:'FINAL BREP'});await flush()
    request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,{at:[.5,2,4],normal:[0,0,0]})
    await rejected
    release()
    expect(t.session.getPanelState().notes.map(note=>note.text)).toEqual(['Da conservare'])
    await t.session.dispose('cancelled')
  })

  it('loads a verified source and prepares exactly the frozen validated CAD copy', async()=>{
    const t=await setup();await selectFace(t)
    const valid=ticket(t)
    const release=t.session.freeze(valid as never)
    expect(()=>t.session.setSnap(false)).toThrow('congelata')
    expect(()=>t.session.setSelectionMode('points')).toThrow('congelata')
    expect(()=>t.session.beginPoleGesture()).toThrow('congelata')
    expect(()=>t.session.setPlacingNote(true)).toThrow('congelata')
    expect(()=>t.session.reportViewError('x')).toThrow('congelata')
    expect(()=>t.session.finishPoleGesture(null)).toThrow('congelata')
    expect(()=>t.session.undo()).toThrow('congelata')
    await expect(t.session.chooseFace(0)).rejects.toThrow('congelata')
    const preparing=t.session.prepareApply(valid as never,new AbortController().signal)
    expect(t.worker.sent.at(-1)).toMatchObject({action:'evaluate',exportStep:true})
    const duplicate=t.session.prepareApply(valid as never,new AbortController().signal)
    await expect(duplicate).rejects.toThrow('già in preparazione')
    t.worker.reply(t.worker.sent.at(-1)!.id,{...preview(2),step:'TEST STEP'})
    const output=await preparing
    expect(output).toMatchObject({kind:'cad-copy',operationId:'op-1',units:'mm',coordinateFrame:'part',draftNoteCount:0})
    expect(new TextDecoder().decode(output.step)).toBe('TEST STEP')
    expect(t.session.getSnapshot().validation).toEqual({kind:'valid',stamp:valid.stamp})
    release();t.session.setSnap(false)
    await t.session.dispose('cancelled')
    expect(t.runtime.active).toBe(false)
    expect(t.worker.terminate).toHaveBeenCalledTimes(1)
    expect(t.session.getSnapshot().validation.kind).toBe('none')
  })

  it('rejects stale tickets and cancels pointer capture before leaving a gesture', async()=>{
    const t=await setup();await selectFace(t)
    const stale=ticket(t)
    t.session.setSnap(false)
    expect(()=>t.session.freeze(stale as never)).toThrow('ticket')
    t.session.attach({} as never)
    t.session.selectPoints([12],false)
    expect(t.session.beginPoleGesture()).toBe(true)
    t.session.previewPoles(changedPoles(t.session))
    expect(t.session.getSnapshot().gesture).toBe('pole')
    expect(()=>t.session.freeze(ticket(t) as never)).toThrow()
    expect(()=>t.session.setContinuity('G0')).toThrow('trascinamento')
    expect(t.session.cancelGesture()).toBe(true)
    expect(t.layer.cancelGesture).toHaveBeenCalledTimes(1)
    expect(t.session.getSnapshot().gesture).toBe('idle')
    expect(t.session.getPanelState().net?.poles[12][2]).toBe(0)
    await t.session.dispose('cancelled')
    expect(t.layer.dispose).toHaveBeenCalledTimes(1)
  })

  it('rejects an abort and a changed source after awaiting STEP export', async()=>{
    const t=await setup();await selectFace(t)
    const first=ticket(t), release=t.session.freeze(first as never)
    const signal=new AbortController()
    const preparing=t.session.prepareApply(first as never,signal.signal)
    const rejected=expect(preparing).rejects.toThrow('annullata')
    signal.abort()
    t.worker.reply(t.worker.sent.at(-1)!.id,{...preview(2),step:'TEST STEP'})
    await rejected
    release()
    const second=ticket(t), releaseSecond=t.session.freeze(second as never)
    const preparingAgain=t.session.prepareApply(second as never,new AbortController().signal)
    const sourceRejected=expect(preparingAgain).rejects.toThrow('source changed')
    t.invalidate()
    t.worker.reply(t.worker.sent.at(-1)!.id,{...preview(3),step:'TEST STEP'})
    await sourceRejected
    releaseSecond()
    await t.session.dispose('source-invalid')
  })

  it('exports a validated pole draft locally and rejects changes while its worker result is pending', async()=>{
    const t=await setup();await selectFace(t)
    t.session.selectPoints([12],false)
    t.session.moveSelected(.2)
    await vi.advanceTimersByTimeAsync(90)
    let request=t.worker.sent.at(-1)!
    expect(request.action).toBe('evaluate')
    t.worker.reply(request.id,preview(2));await flush()
    expect(t.session.getPanelState().canExportStep).toBe(true)
    const exporting=t.session.exportStep()
    request=t.worker.sent.at(-1)!
    expect(request).toMatchObject({action:'evaluate',exportStep:true})
    expect(t.session.getPanelState().busy).toBe(true)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    expect(()=>t.session.setSnap(false)).toThrow('occupata')
    expect(()=>t.session.freeze(ticket(t) as never)).toThrow()
    t.worker.reply(request.id,{...preview(3),step:'POLE DRAFT STEP'})
    await expect(exporting).resolves.toEqual({name:'superficie-modificata.step',step:'POLE DRAFT STEP'})
    expect(t.session.getPanelState().busy).toBe(false)
    expect(t.session.getPanelState().canExportStep).toBe(true)
    expect(t.context.step).toEqual(new Uint8Array([1,2,3]))
    expect(t.session.getPanelState().net?.poles[12][2]).toBe(.2)
    await t.session.dispose('cancelled')
  })

  it('refuses STEP export while notes exist without removing or reanchoring them', async()=>{
    const t=await setup();await selectFace(t)
    t.session.setPlacingNote(true)
    const placing=t.session.placeNote([0,0,0]), pick=t.worker.sent.at(-1)!
    t.worker.reply(pick.id,{anchor:{face:0,selectionRevision:1,u:.5,v:.5},at:[1,2,3],normal:[0,0,1]})
    await placing
    const id=t.session.getPanelState().notes[0].id
    t.session.setNoteText(id,'Annotazione da conservare')
    const count=t.worker.sent.length
    await expect(t.session.exportStep()).rejects.toThrow('non vengono incluse nello STEP')
    expect(t.worker.sent).toHaveLength(count)
    expect(t.session.getPanelState().notes).toMatchObject([{id,text:'Annotazione da conservare',at:[1,2,3]}])
    expect(t.session.getPanelState().canExportStep).toBe(false)
    await t.session.dispose('cancelled')
  })

  it('rejects an old prepare even if a fresh freeze uses the same ticket', async()=>{
    const t=await setup();await selectFace(t)
    const value=ticket(t), release=t.session.freeze(value as never)
    const preparing=t.session.prepareApply(value as never,new AbortController().signal)
    const rejected=expect(preparing).rejects.toThrow('congelata')
    release()
    const releaseAgain=t.session.freeze(value as never)
    t.worker.reply(t.worker.sent.at(-1)!.id,{...preview(2),step:'TEST STEP'})
    await rejected
    releaseAgain()
    await t.session.dispose('cancelled')
  })

  it('keeps host Apply disabled while placing a note and while its CAD pick is pending', async()=>{
    const t=await setup();await selectFace(t)
    const before=ticket(t)
    t.session.setPlacingNote(true)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    expect(()=>t.session.freeze(before as never)).toThrow()
    t.session.setPlacingNote(false)
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    const afterDisarm=ticket(t)
    t.session.setPlacingNote(true)
    const placing=t.session.placeNote([0,0,0])
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    expect(()=>t.session.freeze(afterDisarm as never)).toThrow()
    t.worker.reply(t.worker.sent.at(-1)!.id,{anchor:{face:0,selectionRevision:1,u:.5,v:.5},at:[1,2,3],normal:[0,0,1]})
    await placing
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    expect(t.session.getSnapshot().draftNoteCount).toBe(1)
    expect(()=>t.session.freeze(ticket(t) as never)).toThrow('note')
    await t.session.dispose('cancelled')
  })

  it('stores notes in the draft, exposes verified pins and blocks cad-copy Apply', async()=>{
    const t=await setup();await selectFace(t)
    t.session.setPlacingNote(true)
    const placing=t.session.placeNote([0,0,0])
    const request=t.worker.sent.at(-1)!
    expect(request.action).toBe('notePick')
    t.worker.reply(request.id,{anchor:{face:0,selectionRevision:1,u:.5,v:.5},at:[1,2,3],normal:[0,0,1]})
    await placing
    expect(t.session.getViewState().notePins).toEqual([[1,2,3]])
    expect(t.session.getSnapshot().draftNoteCount).toBe(1)
    const id=t.session.getPanelState().notes[0].id
    t.session.setNoteText(id,'Controlla il bordo')
    expect(()=>t.session.freeze(ticket(t) as never)).toThrow('note')
    await expect(t.session.chooseFace(1)).rejects.toThrow('note')
    t.session.removeNote(id)
    expect(t.session.getSnapshot().draftNoteCount).toBe(0)
    const release=t.session.freeze(ticket(t) as never);release()
    await t.session.dispose('cancelled')
  })

  it('retains notes but hides stale pins until their anchors resolve on the new CAD preview', async()=>{
    const t=await setup();await selectFace(t)
    const placing=t.session.placeNote([0,0,0])
    t.worker.reply(t.worker.sent.at(-1)!.id,{anchor:{face:0,selectionRevision:1,u:.5,v:.5},at:[1,2,3],normal:[0,0,1]})
    await placing
    t.session.selectPoints([12],false);t.session.beginPoleGesture()
    const poles=changedPoles(t.session)
    t.session.previewPoles(poles);t.session.finishPoleGesture(poles)
    expect(t.session.getViewState().notePins).toEqual([])
    expect(t.session.getSnapshot().draftNoteCount).toBe(1)
    await vi.advanceTimersByTimeAsync(90)
    t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    expect(t.worker.sent.at(-1)?.action).toBe('noteResolve')
    t.worker.reply(t.worker.sent.at(-1)!.id,{at:[1,2,4],normal:[0,0,1]});await flush()
    expect(t.session.getViewState().notePins).toEqual([[1,2,4]])
    expect(t.session.getSnapshot().draftNoteCount).toBe(1)
    await t.session.dispose('cancelled')
  })

  it('edits one free pole, respects manual locks, and restores geometry with undo and redo', async()=>{
    const t=await setup();await selectFace(t)
    t.session.selectAllFree()
    expect(t.session.getPanelState().selected).toEqual([12])
    t.session.lockSelected(true)
    expect(()=>t.session.moveSelected(.1)).toThrow('punto libero')
    t.session.lockSelected(false)
    t.session.moveSelected(.1)
    expect(t.session.getPanelState().net?.poles[12][2]).toBeCloseTo(.1)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    await vi.advanceTimersByTimeAsync(90)
    t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    t.session.undo()
    expect(t.session.getPanelState().net?.poles[12][2]).toBe(0)
    t.session.redo()
    expect(t.session.getPanelState().net?.poles[12][2]).toBeCloseTo(.1)
    t.session.clearSelection()
    expect(t.session.getPanelState().selected).toEqual([])
    await t.session.dispose('cancelled')
  })

  it('terminates the session and rejects a pending export when the host aborts', async()=>{
    const t=await setup();await selectFace(t)
    const value=ticket(t);t.session.freeze(value as never)
    const preparing=t.session.prepareApply(value as never,new AbortController().signal)
    const rejected=expect(preparing).rejects.toThrow('Editor chiuso')
    t.abort.abort()
    await rejected
    expect(t.runtime.active).toBe(false)
    expect(t.session.getSnapshot().validation.kind).toBe('none')
    await t.session.dispose('cancelled')
  })

  it('preserves a dirty draft unless switching faces is explicitly confirmed', async()=>{
    const t=await setup();await selectFace(t)
    t.session.selectPoints([12],false)
    t.session.moveSelected(.2)
    expect(t.session.getSnapshot().dirty).toBe(true)
    const net=t.session.getPanelState().net
    await t.session.chooseFace(0)
    expect(t.session.getPanelState().net).toBe(net)
    await expect(t.session.chooseFace(1)).rejects.toThrow('conferma')
    expect(t.session.getPanelState().net).toBe(net)
    expect(t.session.getPanelState().face).toBe(0)
    await expect(t.session.chooseFace(1,true)).rejects.toThrow('Attendi la verifica CAD')
    await vi.advanceTimersByTimeAsync(90)
    t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    const switching=t.session.chooseFace(1,true)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    expect(t.session.getPanelState().net).toBe(net)
    t.worker.reply(t.worker.sent.at(-1)!.id,plane())
    await switching
    expect(t.session.getPanelState().face).toBe(1)
    expect(t.session.getPanelState().net?.poles[12][2]).toBe(0)
    await t.session.dispose('cancelled')
  })

  it('rejects reentrant freeze while a geometry mutation is scheduling its preview', async()=>{
    const t=await setup();await selectFace(t)
    t.session.selectPoints([12],false)
    const value=ticket(t)
    let refused=false
    const stop=t.runtime.previews.subscribe(()=>{
      try { t.session.freeze(value as never) } catch { refused=true }
    })
    t.session.moveSelected(.1)
    stop()
    expect(refused).toBe(true)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    await t.session.dispose('cancelled')
  })

  it('allows pointer release without a CAD mutation after host revocation', async()=>{
    const t=await setup();await selectFace(t)
    t.session.selectPoints([12],false)
    expect(t.session.beginPoleGesture()).toBe(true)
    t.abort.abort()
    expect(()=>t.session.finishPoleGesture(null)).not.toThrow()
    expect(t.runtime.active).toBe(false)
    expect(t.session.getSnapshot()).toMatchObject({gesture:'idle',validation:{kind:'none'}})
    await t.session.dispose('cancelled')
  })

  it('moves a symmetric pair numerically, preserves undo and blocks symmetry settings during freeze', async()=>{
    const t=await setup();await selectFace(t)
    t.session.setContinuity('G0')
    t.session.setMirrorAxis(0);t.session.setMirrorOffset(2);t.session.setSymmetry(true)
    t.session.selectPoints([6],false)
    expect(t.session.getPanelState()).toMatchObject({symmetry:true,mirrorAxis:0,mirrorOffset:2,symmetryBlocked:false})
    expect(t.session.getPanelState().symmetryPartners?.[6]).toBe(16)
    expect(t.session.getViewState().symmetryPartners?.[16]).toBe(6)
    t.session.moveSelected(.2)
    expect(t.session.getPanelState().net?.poles[6][2]).toBeCloseTo(.2)
    expect(t.session.getPanelState().net?.poles[16][2]).toBeCloseTo(.2)
    t.session.undo()
    expect(t.session.getPanelState().net?.poles[6][2]).toBe(0)
    expect(t.session.getPanelState().net?.poles[16][2]).toBe(0)
    t.session.redo()
    await vi.advanceTimersByTimeAsync(90)
    t.worker.reply(t.worker.sent.at(-1)!.id,preview(2));await flush()
    const release=t.session.freeze(ticket(t) as never)
    expect(()=>t.session.setSymmetry(false)).toThrow('congelata')
    expect(()=>t.session.setMirrorAxis(1)).toThrow('congelata')
    expect(()=>t.session.setMirrorOffset(3)).toThrow('congelata')
    expect(()=>t.session.projectSelectedToMirrorPlane()).toThrow('congelata')
    expect(()=>t.session.setTransparency(.5)).toThrow('congelata')
    release()
    t.session.setTransparency(.5)
    expect(t.session.getPanelState().transparency).toBe(.5)
    expect(t.session.getViewState().transparency).toBe(.5)
    expect(()=>t.session.setTransparency(1)).toThrow('Trasparenza')
    await t.session.dispose('cancelled')
  })

  it('mirrors gesture preview and commit, and restores both poles on cancellation', async()=>{
    const t=await setup();await selectFace(t)
    t.session.setContinuity('G0');t.session.setMirrorOffset(2);t.session.setSymmetry(true)
    t.session.selectPoints([6],false)
    expect(t.session.beginPoleGesture()).toBe(true)
    const poles=structuredClone(t.session.getPanelState().net!.poles);poles[6][2]=.3
    t.session.previewPoles(poles)
    expect(t.session.getPanelState().net?.poles[6][2]).toBeCloseTo(.3)
    expect(t.session.getPanelState().net?.poles[16][2]).toBeCloseTo(.3)
    expect(()=>t.session.setMirrorOffset(1)).toThrow('trascinamento')
    t.session.finishPoleGesture(null)
    expect(t.session.getPanelState().net?.poles[6][2]).toBe(0)
    expect(t.session.getPanelState().net?.poles[16][2]).toBe(0)
    expect(t.session.beginPoleGesture()).toBe(true)
    t.session.previewPoles(poles);t.session.finishPoleGesture(poles)
    expect(t.session.getPanelState().net?.poles[16][2]).toBeCloseTo(.3)
    t.session.undo()
    expect(t.session.getPanelState().net?.poles[6][2]).toBe(0)
    expect(t.session.getPanelState().net?.poles[16][2]).toBe(0)
    t.session.redo()
    expect(t.session.getPanelState().net?.poles[16][2]).toBeCloseTo(.3)
    await t.session.dispose('cancelled')
  })

  it('refuses ambiguous or locked mirror partners without modifying the draft', async()=>{
    const t=await setup();await selectFace(t)
    t.session.setContinuity('G0');t.session.setMirrorOffset(2);t.session.setSymmetry(true)
    t.session.selectPoints([16],false);t.session.lockSelected(true);t.session.selectPoints([6],false)
    const before=t.session.getPanelState().net
    expect(t.session.getPanelState().symmetryBlocked).toBe(true)
    expect(()=>t.session.moveSelected(.2)).toThrow('bloccato')
    expect(t.session.getPanelState().net).toBe(before)
    t.session.selectPoints([16],false);t.session.lockSelected(false);t.session.selectPoints([6],false)
    t.session.setMirrorOffset(2.1)
    expect(t.session.getPanelState().symmetryBlocked).toBe(true)
    expect(()=>t.session.moveSelected(.2)).toThrow('assente')
    expect(()=>t.session.setMirrorOffset(Number.NaN)).toThrow()
    expect(()=>t.session.setMirrorAxis(3)).toThrow()
    await t.session.dispose('cancelled')
  })

  it('mirrors smoothing, flattening and stretching; projection affects selected free poles only', async()=>{
    const t=await setup();await selectFace(t)
    t.session.setContinuity('G0');t.session.setMirrorOffset(2);t.session.setSymmetry(true)
    t.session.selectPoints([6],false)
    t.session.moveSelected(.2)
    t.session.smoothSelected(1)
    expect(t.session.getPanelState().net?.poles[6][2]).toBeCloseTo(0)
    expect(t.session.getPanelState().net?.poles[16][2]).toBeCloseTo(0)
    t.session.moveSelected(.2);t.session.flattenSelected()
    expect(t.session.getPanelState().net?.poles[6][2]).toBeCloseTo(0)
    expect(t.session.getPanelState().net?.poles[16][2]).toBeCloseTo(0)
    t.session.setAxis(0);t.session.stretchSelected(1.2)
    expect(t.session.getPanelState().net?.poles[6][0]).toBeCloseTo(.8)
    expect(t.session.getPanelState().net?.poles[16][0]).toBeCloseTo(3.2)
    t.session.projectSelectedToMirrorPlane()
    expect(t.session.getPanelState().net?.poles[6][0]).toBe(2)
    expect(t.session.getPanelState().net?.poles[16][0]).toBeCloseTo(3.2)
    expect(t.session.getPanelState().symmetryBlocked).toBe(true)
    expect(()=>t.session.moveSelected(.2)).toThrow()
    t.session.undo()
    expect(t.session.getPanelState().net?.poles[6][0]).toBeCloseTo(.8)
    expect(t.session.getPanelState().symmetryBlocked).toBe(false)
    await t.session.dispose('cancelled')
  })

  it('fails closed when the supplied STEP hash does not match the source binding', async()=>{
    vi.useFakeTimers()
    const worker=new FakeWorker(), runtime=new SurfaceRuntime(()=>worker as unknown as Worker)
    const abort=new AbortController()
    const context={apiVersion:1,sessionId:'s',source:{documentEpoch:'d',sourceEpoch:1,bodyId:1,bodyKey:'b',
      buildVersion:1,kernelGeneration:1,frameRevision:1,stepSha256:'a'.repeat(64),units:'mm',coordinateFrame:'part'},
      step:new Uint8Array([1]),capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},
      signal:abort.signal,assertSourceCurrent:()=>{},own:(f:()=>void)=>f,reportFatal:vi.fn()}
    await expect(createWorkspaceSurfaceSession(context as never,vi.fn() as never,{runtime,sha256:async()=> 'b'.repeat(64)})).rejects.toThrow('non corrisponde')
    expect(worker.sent).toHaveLength(0)
    expect(runtime.active).toBe(false)
  })
})

describe('workspace free-edge strip',()=>{
  it('releases a deferred layer capture on Escape before a pole gesture begins',async()=>{
    const t=await setup({sheet:true});await selectFace(t)
    const request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    const paths=t.session.getViewState().directStrip!.paths
    const before=t.session.getSnapshot()
    t.session.attach({} as never)
    t.layer.cancelGesture.mockReturnValueOnce(true)
    expect(t.session.cancelGesture()).toBe(true)
    expect(t.layer.cancelGesture).toHaveBeenCalledTimes(1)
    expect(t.session.getSnapshot().gesture).toBe('idle')
    expect(t.session.getSnapshot().historyRevision).toBe(before.historyRevision)
    expect(t.session.getSnapshot().dirty).toBe(before.dirty)
    expect(t.session.getViewState().directStrip?.paths).toBe(paths)
    t.layer.cancelGesture.mockReturnValueOnce(false)
    expect(t.session.cancelGesture()).toBe(false)
    const release=t.session.freeze(ticket(t) as never)
    expect(()=>t.session.cancelGesture()).toThrow('congelata')
    release();t.invalidate()
    expect(()=>t.session.cancelGesture()).toThrow('source changed')
    expect(t.layer.cancelGesture).toHaveBeenCalledTimes(2)
    await t.session.dispose('cancelled')
  })

  it('preloads immutable boundaries without blocking or mutating the draft and retains their identity',async()=>{
    const t=await setup({sheet:true});await selectFace(t)
    const request=t.worker.sent.at(-1)!, before=t.session.getSnapshot()
    expect(request.action).toBe('sheetEdges')
    expect(before.validation.kind).toBe('valid')
    expect(t.session.getPanelState().busy).toBe(false)
    t.session.selectPoints([12],false)
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    const direct=t.session.getViewState().directStrip!
    expect(direct).toMatchObject({revision:1,axis:2})
    expect(Object.isFrozen(direct.paths)).toBe(true)
    expect(Object.isFrozen(direct.paths[0])).toBe(true)
    expect(Object.isFrozen(direct.paths[0][0])).toBe(true)
    expect(t.session.getSnapshot().dirty).toBe(false)
    expect(t.session.getSnapshot().historyRevision).toBe(before.historyRevision)
    expect(t.session.getSnapshot().canUndo).toBe(false)
    t.session.setDirectStripAxis(1);t.session.setAxis(0);t.session.setSnap(false)
    expect(t.session.getViewState().directStrip?.paths).toBe(direct.paths)
    expect(t.session.getViewState().directStrip?.axis).toBe(1)
    expect(t.session.getPanelState().directStripAxis).toBe(1)
    expect(t.session.getPanelState().axis).toBe(0)
    await t.session.dispose('cancelled')
  })

  it('promotes the selected direct edge synchronously and Escape returns to poles without history',async()=>{
    const t=await setup({sheet:true});await selectFace(t)
    let request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    const direct=t.session.getViewState().directStrip!, history=t.session.getSnapshot().historyRevision
    t.session.setDirectStripAxis(1)
    const count=t.worker.sent.length
    expect(t.session.beginDirectStripGesture(0,direct.revision+1)).toBe(false)
    expect(t.session.beginDirectStripGesture(-1,direct.revision)).toBe(false)
    expect(t.session.beginDirectStripGesture(0,direct.revision)).toBe(true)
    expect(t.worker.sent).toHaveLength(count)
    expect(t.session.getSnapshot().gesture).toBe('strip')
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    expect(t.session.getViewState().directStrip).toBeNull()
    expect(t.session.getPanelState().strip).toMatchObject({selectedEdge:0,axis:1})
    t.session.previewStripDelta([0,1,0]);await t.session.finishStripGesture(null)
    expect(t.session.getSnapshot().gesture).toBe('idle')
    expect(t.session.getSnapshot().historyRevision).toBe(history)
    expect(t.session.getSnapshot().dirty).toBe(false)
    expect(t.session.getPanelState().strip).toBeNull()
    expect(t.session.getPanelState().directStripAxis).toBe(1)
    request=t.worker.sent.at(-1)!
    expect(request.action).toBe('sheetEdges')
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    expect(t.session.getViewState().directStrip?.axis).toBe(1)
    const cachedCount=t.worker.sent.length
    await t.session.beginStrip()
    expect(t.worker.sent).toHaveLength(cachedCount)
    expect(t.session.getPanelState().strip?.axis).toBe(1)
    t.session.cancelStrip()
    await t.session.dispose('cancelled')
  })

  it('commits direct D through the existing validated strip history',async()=>{
    const t=await setup({sheet:true});await selectFace(t)
    let request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    const direct=t.session.getViewState().directStrip!
    expect(t.session.beginDirectStripGesture(0,direct.revision)).toBe(true)
    t.session.previewStripDelta([0,0,1])
    const finishing=t.session.finishStripGesture([0,0,1]);request=t.worker.sent.at(-1)!
    expect(request.action).toBe('duplicateSheetEdge')
    t.worker.reply(request.id,stripReply(request));await finishing
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    expect(t.session.getPanelState().strip).toMatchObject({hasResult:true,canUndo:true})
    expect(t.session.getSnapshot().dirty).toBe(true)
    t.session.undo();expect(t.session.getPanelState().strip?.canRedo).toBe(true)
    t.session.redo();expect(t.session.getPanelState().strip?.hasResult).toBe(true)
    await t.session.dispose('cancelled')
  })

  it('discards late boundaries after a pole gesture and loads only the newly validated revision',async()=>{
    const t=await setup({sheet:true});await selectFace(t)
    const stale=t.worker.sent.at(-1)!
    t.session.selectPoints([12],false);expect(t.session.beginPoleGesture()).toBe(true)
    t.worker.reply(stale.id,structuredClone(stripPaths));await flush()
    expect(t.session.getViewState().directStrip).toBeNull()
    const poles=changedPoles(t.session);t.session.previewPoles(poles);t.session.finishPoleGesture(poles)
    await vi.advanceTimersByTimeAsync(90)
    let request=t.worker.sent.at(-1)!
    expect(request.action).toBe('evaluate')
    t.worker.reply(request.id,preview(2));await flush()
    request=t.worker.sent.at(-1)!
    expect(request.action).toBe('sheetEdges')
    expect(t.session.beginDirectStripGesture(0,1)).toBe(false)
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    expect(t.session.getViewState().directStrip?.revision).toBe(2)
    expect(t.session.getSnapshot().dirty).toBe(true)
    await t.session.dispose('cancelled')
  })

  it('removes direct edges while placing or holding a note, then reloads after its deletion',async()=>{
    const t=await setup({sheet:true});await selectFace(t)
    let request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    t.session.setDirectStripAxis(0);t.session.setPlacingNote(true)
    expect(t.session.getViewState().directStrip).toBeNull()
    expect(t.session.beginDirectStripGesture(0,1)).toBe(false)
    const placing=t.session.placeNote([0,0,0]);request=t.worker.sent.at(-1)!
    expect(request.action).toBe('notePick')
    t.worker.reply(request.id,{anchor:{face:0,selectionRevision:1,u:.5,v:.5},at:[0,0,0],normal:[0,0,1]});await placing
    expect(t.session.getPanelState().notes).toHaveLength(1)
    expect(t.session.getViewState().directStrip).toBeNull()
    t.session.removeNote(t.session.getPanelState().notes[0].id)
    request=t.worker.sent.at(-1)!
    expect(request.action).toBe('sheetEdges')
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    expect(t.session.getViewState().directStrip?.axis).toBe(0)
    await t.session.dispose('cancelled')
  })

  it('invalidates boundaries on freeze, source revocation and disposal',async()=>{
    const t=await setup({sheet:true});await selectFace(t)
    let request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    const direct=t.session.getViewState().directStrip!, release=t.session.freeze(ticket(t) as never)
    expect(t.session.getViewState().directStrip).toBeNull()
    expect(t.session.beginDirectStripGesture(0,direct.revision)).toBe(false)
    release();request=t.worker.sent.at(-1)!
    expect(request.action).toBe('sheetEdges')
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    expect(t.session.getViewState().directStrip).not.toBeNull()
    t.invalidate()
    expect(t.session.getViewState().directStrip).toBeNull()
    expect(t.session.beginDirectStripGesture(0,direct.revision)).toBe(false)
    await t.session.dispose('source-invalid')
    expect(t.session.getViewState().directStrip).toBeNull()
    const other=await setup({sheet:true});await selectFace(other)
    request=other.worker.sent.at(-1)!
    await other.session.dispose('cancelled')
    other.worker.reply(request.id,structuredClone(stripPaths));await flush()
    expect(other.session.getViewState().directStrip).toBeNull()
  })

  it('reports a failed direct edge read, avoids automatic retry loops, and retries successfully on request',async()=>{
    const t=await setup({sheet:true});await selectFace(t)
    let request=t.worker.sent.at(-1)!
    t.worker.fail(request.id,'edge read failed');await flush()
    expect(t.session.getPanelState().directStripError).toBe('Non è stato possibile caricare i bordi liberi.')
    const count=t.worker.sent.filter(item=>item.action==='sheetEdges').length
    t.session.setSnap(false);t.session.setSnap(true);t.session.setDirectStripAxis(1)
    await flush()
    expect(t.worker.sent.filter(item=>item.action==='sheetEdges')).toHaveLength(count)
    expect(t.session.getPanelState().directStripError).toBe('Non è stato possibile caricare i bordi liberi.')
    const history=t.session.getSnapshot().historyRevision, dirty=t.session.getSnapshot().dirty
    t.session.retryDirectStripEdges()
    expect(t.worker.sent.filter(item=>item.action==='sheetEdges')).toHaveLength(count+1)
    expect(t.session.getSnapshot().historyRevision).toBe(history)
    expect(t.session.getSnapshot().dirty).toBe(dirty)
    request=t.worker.sent.at(-1)!
    expect(request.action).toBe('sheetEdges')
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    expect(t.session.getPanelState().directStripError).toBeNull()
    expect(t.session.getViewState().directStrip?.revision).toBe(1)
    expect(t.worker.sent.filter(item=>item.action==='sheetEdges')).toHaveLength(count+1)
    t.session.selectPoints([12],false);t.session.moveSelected(.2)
    await vi.advanceTimersByTimeAsync(90)
    request=t.worker.sent.at(-1)!
    expect(request.action).toBe('evaluate')
    t.worker.reply(request.id,preview(2));await flush()
    expect(t.worker.sent.filter(item=>item.action==='sheetEdges')).toHaveLength(count+2)
    request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,structuredClone(stripPaths));await flush()
    expect(t.session.getViewState().directStrip?.revision).toBe(2)
    await t.session.dispose('cancelled')
  })

  it('passes a real STEP sheet through session, OCCT extension and frozen export',async()=>{
    vi.useFakeTimers()
    const editor=await SurfaceEditorKernel.load(), k=editor.kernel, box=k.makeBox(20,30,10), faces=k.getSubShapes(box,'face')
    let session:WorkspaceSurfaceSession | undefined
    try {
      const source=k.exportStep(faces[5]), hash='a'.repeat(64), abort=new AbortController()
      class KernelWorker extends FakeWorker {
        postMessage(message: Msg) {
          this.sent.push(message)
          void Promise.resolve().then(()=>{
            try {
              const m=message as Msg & {step:string;face:number;continuity:'G0'|'G1';freeBoundary:boolean;previewRevision:number}
              const value=m.action==='open' ? editor.open(m.step) : m.action==='select' ? editor.select(m.face) :
                m.action==='evaluate' ? editor.evaluate(m.net!,m.continuity,!!m.exportStep,m.freeBoundary) :
                m.action==='sheetEdges' ? editor.sheetEdges(m.previewRevision) :
                m.action==='duplicateSheetEdge' ? editor.duplicateSheetEdge(m.previewRevision,m.edge!,m.delta as Point,
                  (m.previous ?? []) as StripMove[],m.path as Point[]) : (()=>{throw Error('unexpected worker action')})()
              this.reply(m.id,value)
            } catch(error) { this.onmessage?.({data:{id:message.id,error:String((error as Error).message)}} as MessageEvent<unknown>) }
          })
        }
      }
      const worker=new KernelWorker(), runtime=new SurfaceRuntime(()=>worker as unknown as Worker)
      const sourceBinding={documentEpoch:'doc',sourceEpoch:1,bodyId:1,bodyKey:'body',buildVersion:1,kernelGeneration:1,
        frameRevision:1,stepSha256:hash,units:'mm',coordinateFrame:'part'}
      const context={apiVersion:1,sessionId:'real-kernel',source:sourceBinding,step:new TextEncoder().encode(source),
        capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:abort.signal,assertSourceCurrent:()=>{},
        own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
      session=await createWorkspaceSurfaceSession(context as never,vi.fn() as never,{runtime,sha256:async()=>hash})
      await session.chooseFace(0)
      await vi.advanceTimersByTimeAsync(90);await flush()
      expect(session.getSnapshot().validation.kind).toBe('valid')
      await session.beginStrip()
      const edge=session.getPanelState().strip!.paths.findIndex(path=>path.every(p=>Math.abs(p[0]-20)<1e-7))
      expect(edge).toBeGreaterThan(-1)
      session.selectStripEdge(edge);await session.applyStripDelta([5,0,0])
      expect(session.getPanelState().strip?.addedArea).toBeCloseTo(150,7)
      const state=session.getSnapshot()
      if(state.validation.kind!=='valid')throw Error('extension not valid')
      const value={operationId:'real',mode:'cad-copy',source:sourceBinding,stamp:state.validation.stamp}
      const release=session.freeze(value as never)
      const output=await session.prepareApply(value as never,new AbortController().signal)
      const shape=k.importStep(new TextDecoder().decode(output.step)), resultFaces=k.getSubShapes(shape,'face')
      try {
        expect(k.isValid(shape)).toBe(true)
        expect(resultFaces.map(f=>k.getSurfaceArea(f)).sort((a,b)=>a-b)).toEqual([expect.closeTo(150,7),expect.closeTo(600,7)])
      } finally {resultFaces.forEach(f=>k.release(f));k.release(shape)}
      release()
    } finally {
      if(session)await session.dispose('cancelled')
      faces.forEach(f=>k.release(f));k.release(box);editor.dispose()
    }
  })

  it('requires a single open face and a valid preview',async()=>{
    const solid=await setup();await selectFace(solid)
    expect(solid.session.getPanelState().canBeginStrip).toBe(false)
    await expect(solid.session.beginStrip()).rejects.toThrow('superficie aperta')
    await solid.session.dispose('cancelled')
    const t=await setup({sheet:true});await selectFace(t)
    expect(t.session.getPanelState().canBeginStrip).toBe(true)
    t.session.setPlacingNote(true)
    await expect(t.session.beginStrip()).rejects.toThrow('note')
    t.session.setPlacingNote(false)
    await t.session.dispose('cancelled')
  })

  it('shares a validated D direction with the panel and holds it fixed during a drag',async()=>{
    const t=await setup({sheet:true});await selectFace(t);await enterStrip(t)
    expect(t.session.getPanelState().strip?.axis).toBe(2)
    expect(t.session.getViewState().strip?.axis).toBe(2)
    t.session.setStripAxis(1)
    expect(t.session.getPanelState().strip?.axis).toBe(1)
    expect(t.session.getViewState().strip?.axis).toBe(1)
    expect(()=>t.session.setStripAxis(7 as 0)).toThrow('Direzione')
    expect(t.session.getViewState().strip?.axis).toBe(1)
    expect(t.session.beginStripGesture(0)).toBe(true)
    expect(()=>t.session.setStripAxis(0)).toThrow('trascinamento')
    await t.session.finishStripGesture(null)
    t.session.setStripAxis(0)
    expect(t.session.getViewState().strip?.axis).toBe(0)
    await t.session.dispose('cancelled')
  })

  it('exports the exact validated extension with freeze and immutable inputs',async()=>{
    const t=await setup({sheet:true});await selectFace(t);await enterStrip(t)
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    expect(t.session.getViewState().net).toBeNull()
    expect(()=>t.session.moveSelected(1)).toThrow('bordo')
    await expect(t.session.chooseFace(0,true)).rejects.toThrow('bordo')
    t.session.selectStripEdge(0)
    const delta:[number,number,number]=[0,0,1]
    const pending=t.session.applyStripDelta(delta), request=t.worker.sent.at(-1)!
    expect(request.action).toBe('duplicateSheetEdge')
    delta[2]=9
    expect(request.delta).toEqual([0,0,1])
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    t.worker.reply(request.id,stripReply(request));await pending
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    expect(t.session.getSnapshot().dirty).toBe(true)
    expect(t.session.getPanelState().strip).toMatchObject({hasResult:true,canUndo:true,selectedEdge:-1,addedArea:1})
    const workerCount=t.worker.sent.length
    await expect(t.session.exportStep()).resolves.toEqual({name:'superficie-modificata.step',step:'EXTENDED STEP 1'})
    expect(t.worker.sent).toHaveLength(workerCount)
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    const value=ticket(t), release=t.session.freeze(value as never), count=t.worker.sent.length
    expect(()=>t.session.cancelStrip(true)).toThrow('congelata')
    expect(()=>t.session.undo()).toThrow('congelata')
    const result=await t.session.prepareApply(value as never,new AbortController().signal)
    expect(new TextDecoder().decode(result.step)).toBe('EXTENDED STEP 1')
    expect(t.worker.sent).toHaveLength(count)
    release()
    expect(()=>t.session.cancelStrip()).toThrow('conferma')
    t.session.cancelStrip(true)
    expect(t.session.getPanelState().strip).toBeNull()
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    await t.session.dispose('cancelled')
  })

  it('keeps a separate strip history and requires confirmation even after undo',async()=>{
    const t=await setup({sheet:true});await selectFace(t);await enterStrip(t)
    t.session.selectStripEdge(0)
    let pending=t.session.applyStripDelta([0,0,1]), request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,stripReply(request));await pending
    t.session.selectStripEdge(1)
    pending=t.session.applyStripDelta([1,0,0]);request=t.worker.sent.at(-1)!
    expect(request.previous).toHaveLength(1)
    t.worker.reply(request.id,stripReply(request));await pending
    expect(t.session.getPanelState().strip?.totalArea).toBe(6)
    t.session.undo();expect(t.session.getPanelState().strip?.totalArea).toBe(5)
    t.session.undo()
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    expect(t.session.getSnapshot().dirty).toBe(true)
    expect(t.session.getSnapshot().canRedo).toBe(true)
    expect(()=>t.session.cancelStrip()).toThrow('conferma')
    t.session.redo();expect(t.session.getPanelState().strip?.totalArea).toBe(5)
    t.session.redo();expect(t.session.getPanelState().strip?.totalArea).toBe(6)
    t.session.cancelStrip(true)
    expect(t.session.getSnapshot().canUndo).toBe(false)
    await t.session.dispose('cancelled')
  })

  it('rejects invalid or late results without discarding previous work',async()=>{
    const t=await setup({sheet:true});await selectFace(t)
    let pending=t.session.beginStrip(), request=t.worker.sent.at(-1)!
    const cancelled=expect(pending).rejects.toThrow('annullata')
    t.session.cancelStrip();t.worker.reply(request.id,stripPaths);await cancelled
    expect(t.session.getPanelState().strip).toBeNull()
    await enterStrip(t);t.session.selectStripEdge(0)
    pending=t.session.applyStripDelta([0,0,1]);request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,stripReply(request));await pending
    t.session.selectStripEdge(1)
    pending=t.session.applyStripDelta([1,0,0]);request=t.worker.sent.at(-1)!
    const bad=expect(pending).rejects.toThrow('valida')
    t.worker.reply(request.id,stripReply(request,{preview:{...preview(1),valid:false}}));await bad
    expect(t.session.getSnapshot().validation.kind).toBe('invalid')
    expect(t.session.getPanelState().strip?.totalArea).toBe(5)
    t.session.selectStripEdge(1)
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    pending=t.session.applyStripDelta([1,0,0]);request=t.worker.sent.at(-1)!
    const late=expect(pending).rejects.toThrow('annullata')
    expect(()=>t.session.cancelStrip()).toThrow('conferma')
    t.session.cancelStrip(true);t.worker.reply(request.id,stripReply(request));await late
    expect(t.session.getPanelState().strip).toBeNull()
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    await t.session.dispose('cancelled')
  })

  it('blocks Apply during a gesture and does not briefly unfreeze on release',async()=>{
    const t=await setup({sheet:true});await selectFace(t);await enterStrip(t)
    t.session.selectStripEdge(0)
    let pending=t.session.applyStripDelta([0,0,1]), request=t.worker.sent.at(-1)!
    t.worker.reply(request.id,stripReply(request));await pending
    const old=ticket(t), states:string[]=[]
    const unsubscribe=t.session.subscribe(()=>states.push(t.session.getSnapshot().validation.kind))
    t.session.attach({} as never)
    expect(t.session.beginStripGesture(1)).toBe(true)
    t.session.previewStripDelta([1,0,0])
    expect(t.session.getPanelState().strip?.delta).toEqual([1,0,0])
    expect(t.session.getSnapshot().validation.kind).toBe('pending')
    expect(()=>t.session.freeze(old as never)).toThrow()
    states.length=0
    pending=t.session.finishStripGesture([1,0,0]);request=t.worker.sent.at(-1)!
    expect(states).not.toContain('valid')
    t.worker.reply(request.id,stripReply(request));await pending
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    expect(t.session.beginStripGesture(1)).toBe(true)
    expect(t.session.cancelGesture()).toBe(true)
    expect(t.layer.cancelGesture).toHaveBeenCalled()
    expect(t.session.getSnapshot().gesture).toBe('idle')
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    unsubscribe();await t.session.dispose('cancelled')
  })

  it('rejects a changed edge history and invalidates work after disposal',async()=>{
    const t=await setup({sheet:true});await selectFace(t);await enterStrip(t);t.session.selectStripEdge(0)
    let pending=t.session.applyStripDelta([0,0,1]), request=t.worker.sent.at(-1)!
    const mismatched=stripReply(request)
    mismatched.moves[0].path=[[100,100,100],[101,100,100]]
    const invalid=expect(pending).rejects.toThrow('non corrispondente')
    t.worker.reply(request.id,mismatched);await invalid
    expect(t.session.getPanelState().strip?.hasResult).toBe(false)
    expect(t.session.getSnapshot().validation.kind).toBe('invalid')
    t.session.selectStripEdge(0)
    pending=t.session.applyStripDelta([0,0,1]);request=t.worker.sent.at(-1)!
    const disposed=expect(pending).rejects.toThrow('annullata')
    await t.session.dispose('cancelled');t.worker.reply(request.id,stripReply(request));await disposed
    expect(t.session.getSnapshot().validation.kind).toBe('none')
    expect(t.session.getPanelState().strip).toBeNull()
  })

  it('does not adopt a result after the source changes, and respects abort at export',async()=>{
    const t=await setup({sheet:true});await selectFace(t);await enterStrip(t);t.session.selectStripEdge(0)
    const pending=t.session.applyStripDelta([0,0,1]), request=t.worker.sent.at(-1)!
    const rejected=expect(pending).rejects.toThrow('source changed')
    t.invalidate();t.worker.reply(request.id,stripReply(request));await rejected
    expect(t.session.getPanelState().strip?.hasResult).toBe(false)
    expect(()=>t.session.freeze({} as never)).toThrow('source changed')
    await t.session.dispose('source-invalid')
    const other=await setup({sheet:true});await selectFace(other);await enterStrip(other);other.session.selectStripEdge(0)
    const extend=other.session.applyStripDelta([0,0,1]), req=other.worker.sent.at(-1)!
    other.worker.reply(req.id,stripReply(req));await extend
    const value=ticket(other),release=other.session.freeze(value as never), abort=new AbortController();abort.abort()
    await expect(other.session.prepareApply(value as never,abort.signal)).rejects.toThrow('annullata')
    release();await other.session.dispose('cancelled')
  })
})

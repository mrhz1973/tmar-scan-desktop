// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Net, Point } from '../brep'
import { SurfaceEditorKernel } from '../editorKernel'
import type { StripMove } from '../sheetExtension'
import { SurfaceRuntime } from '../surfaceRuntime'
import { createWorkspaceSurfaceSession, type WorkspaceSurfaceSession } from '../workspaceSession'

type Msg = { id: number; action: string; exportStep?: boolean; net?: Net; edge?:number; delta?:number[]; path?:number[][]; previous?:Array<{edge:number;delta:number[];path:number[][]}> }
class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  sent: Msg[] = []
  postMessage(message: Msg) { this.sent.push(message) }
  terminate = vi.fn()
  reply(id: number, result: unknown) { this.onmessage?.({ data: { id, result } } as MessageEvent<unknown>) }
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
async function setup(options: {sheet?:boolean} = {}) {
  vi.useFakeTimers()
  const worker = new FakeWorker(), runtime = new SurfaceRuntime(() => worker as unknown as Worker)
  const abort = new AbortController(), hash = 'a'.repeat(64)
  let sourceCurrent = true
  const binding = { documentEpoch:'doc-1',sourceEpoch:3,bodyId:4,bodyKey:'body-key',
    buildVersion:5,kernelGeneration:6,frameRevision:7,stepSha256:hash,units:'mm',coordinateFrame:'part' }
  const owned = new Set<() => void>()
  const context = { apiVersion:1,sessionId:'session-1',source:binding,step:new Uint8Array([1,2,3]),
    capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:abort.signal,
    assertSourceCurrent:()=>{if(!sourceCurrent)throw Error('source changed')},
    own:(fn:()=>void)=>{let active=true;const once=()=>{if(active){active=false;owned.delete(once);fn()}};owned.add(once);return once},
    reportFatal:vi.fn() }
  let owner: WorkspaceSurfaceSession
  const layer = { cancelGesture:vi.fn(()=>{ if(owner.getSnapshot().gesture === 'pole') owner.finishPoleGesture(null); return true }),dispose:vi.fn() }
  const factory = vi.fn((_view: unknown, controller: WorkspaceSurfaceSession)=>{owner=controller;return layer})
  const creating = createWorkspaceSurfaceSession(context as never,factory as never,{runtime,sha256:async()=>hash})
  await flush()
  expect(worker.sent[0]?.action).toBe('open')
  const faces = options.sheet ? [{...info,openSheet:true,freeBoundary:true}] : [info,{...info,index:1}]
  worker.reply(worker.sent[0].id,{faces,preview:{...preview(0),faceMeshes:faces.map(()=>({}))}})
  const session = await creating
  return { worker, runtime, abort, binding, context, session, layer, owned, invalidate:()=>{sourceCurrent=false} }
}
async function selectFace(test: Awaited<ReturnType<typeof setup>>) {
  const choosing = test.session.chooseFace(0)
  expect(test.worker.sent.at(-1)?.action).toBe('select')
  test.worker.reply(test.worker.sent.at(-1)!.id,plane())
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

describe('WorkspaceSurfaceSession',()=>{
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
    const switching=t.session.chooseFace(1,true)
    expect(t.session.getSnapshot().validation.kind).toBe('none')
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

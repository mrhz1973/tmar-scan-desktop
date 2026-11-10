// SPDX-License-Identifier: AGPL-3.0-only
// Real workspace controller with controlled worker; no host/camera qualification.
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { Net } from '../brep'
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
async function setup(options: {sheet?:boolean;annotated?:boolean} = {}) {
  vi.useFakeTimers()
  const worker = new FakeWorker(), runtime = new SurfaceRuntime(() => worker as unknown as Worker)
  const abort = new AbortController(), hash = 'a'.repeat(64)
  let sourceCurrent = true
  const binding = { documentEpoch:'doc-1',sourceEpoch:3,bodyId:4,bodyKey:'body-key',
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
  const faces = options.sheet ? [{...info,openSheet:true,freeBoundary:true}] : [info,{...info,index:1}]
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

afterEach(() => vi.useRealTimers())
it('hands the layer exactly the current frozen session stamp across selection, draft edits and undo/redo', async () => {
  const t = await setup()
  const stamps: unknown[] = []
  const check = () => {
    const current = t.session.getSnapshot().current
    expect(t.session.getViewState().reticleStamp).toBe(current)
    expect(Object.isFrozen(current)).toBe(true)
    expect(current.sessionId).toBe(t.context.sessionId)
    expect(current.sourceEpoch).toBe(t.binding.sourceEpoch)
    stamps.push(current)
    return current
  }
  try {
    const initial = check()
    expect(t.session.getViewState().net).toBeNull()
    await selectFace(t)
    const selected = check()
    expect(selected.selectionEpoch).toBeGreaterThan(initial.selectionEpoch)
    t.session.selectPoints([12], false); check()
    t.session.setAxis(2); check()
    expect(t.session.beginPoleGesture()).toBe(true)
    const poles = structuredClone(t.session.getPanelState().net!.poles)
    poles[12][2] = .1
    t.session.previewPoles(poles)
    const dragging = check()
    expect(dragging.draftEpoch).toBeGreaterThan(selected.draftEpoch)
    t.session.finishPoleGesture(poles)
    const committed = check()
    expect(t.session.getViewState().net!.poles[12][2]).toBe(.1)
    t.session.undo()
    const undone = check()
    expect(undone.draftEpoch).toBeGreaterThan(committed.draftEpoch)
    expect(t.session.getViewState().net!.poles[12][2]).toBe(0)
    t.session.redo(); check()
    expect(t.session.getViewState().net!.poles[12][2]).toBe(.1)
    t.session.setShowNet(false); check()
    expect(stamps.length).toBeGreaterThan(7)
  } finally { await t.session.dispose('cancelled') }
})

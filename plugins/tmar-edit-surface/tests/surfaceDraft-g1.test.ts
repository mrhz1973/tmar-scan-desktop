// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Net } from '../brep'
import type { G1PlaneResult, G1PublishedPlaneResult } from '../editorKernel'
import type { G1SupportCandidate } from '../g1SupportTopology'
import { proposePlaneTangency, validatePlaneTangencyResult, type PlaneTangencyRequest } from '../planeTangency'
import { SurfaceDraft } from '../surfaceDraft'
import { SurfaceRuntime } from '../surfaceRuntime'
import { SurfaceHistory } from '../surfaceHistory'

function plane(): Net {
  const poles: Net['poles'] = []
  for (let u=0;u<5;u++) for (let v=0;v<5;v++) poles.push([u,v,0])
  return { nu:5,nv:5,du:3,dv:3,poles,weights:poles.map(()=>1),rational:[0,0],
    ku:[0,.5,1],kv:[0,.5,1],mu:[4,1,4],mv:[4,1,4] }
}
const choice: G1SupportCandidate = {
  id:'source:0:2:1',stamp:{sourceId:'frozen-source',sourceRevision:0,selectionRevision:2,faceIndex:1},
  supportFaceIndex:0,edgeIndex:0,side:'uMin',lengthMm:4,plane:{origin:[0,0,0],normal:[0,0,1]},
}
const preview = (revision?: number) => ({ valid:true,mesh:{} as G1PlaneResult['preview']['mesh'],faceMeshes:[],
  volume:0,maxBoundaryError:0,minimumNormalDot:1,...(revision===undefined?{}:{previewRevision:revision}) })
function result(base:Net,lockedPoles:number[]=[]):G1PlaneResult {
  const request:PlaneTangencyRequest={net:base,edge:'U0',plane:{point:[0,0,0],normal:[0,0,1]},
    lockIndices:lockedPoles,preserveTangentEdges:['U1','V0','V1'],distanceTolerance:1e-8}
  const proposal=proposePlaneTangency(request)
  return {net:proposal.net,changedIndices:proposal.changedIndices,choice:structuredClone(choice),stamp:{...choice.stamp},
    revisions:{edit:1,preview:1,anchorSelection:1},validation:validatePlaneTangencyResult(request,proposal.net),preview:preview()}
}
function published(output:G1PlaneResult,revision=2,net=output.net):G1PublishedPlaneResult {
  return {...output,net:structuredClone(net),constraintId:42,preview:{...preview(),previewRevision:revision}}
}
class FakeWorker {
  onmessage:((event:MessageEvent<unknown>)=>void)|null=null
  onerror=null
  onmessageerror=null
  sent: {id:number;action:string;net?:Net;constraintId?:number;lockedPoles?:number[];exportStep?:boolean;selection?:unknown}[]=[]
  postMessage(message:typeof this.sent[number]) {this.sent.push(message)}
  terminate() {}
  reply(value:unknown,id=this.sent.at(-1)!.id) {this.onmessage?.({data:{id,result:value}} as MessageEvent<unknown>)}
  reject(error:string) {this.onmessage?.({data:{id:this.sent.at(-1)!.id,error}} as MessageEvent<unknown>)}
}
async function flush(){for(let i=0;i<8;i++) await Promise.resolve()}
async function setup(locks:number[]=[]) {
  vi.useFakeTimers()
  const worker=new FakeWorker(),runtime=new SurfaceRuntime(()=>worker as unknown as Worker),draft=new SurfaceDraft(runtime)
  const net=plane();net.poles[7][2]=.25
  draft.install(net,{face:1,continuity:'G0',trimLocks:[0],hiddenPoles:[1],originalNet:plane()})
  await vi.advanceTimersByTimeAsync(90);worker.reply(preview(1));await flush()
  if(locks.length) draft.setLocks(locks)
  return {worker,runtime,draft,finish:()=>{draft.dispose();runtime.dispose()}}
}
type Context=Awaited<ReturnType<typeof setup>>
async function propose(c:Context) {
  const output=result(c.draft.getSnapshot().net!)
  const pending=c.draft.applyPlaneTangency(choice)
  c.worker.reply(output);await flush()
  expect(c.worker.sent.at(-1)?.action).toBe('publishG1PlaneTangency')
  return {output,pending}
}
async function apply(c:Context) {
  const {output,pending}=await propose(c)
  c.worker.reply(published(output));await pending
  return output
}
async function evaluate(c:Context,output:G1PlaneResult,revision:number,net=c.draft.getSnapshot().net!) {
  await vi.advanceTimersByTimeAsync(90)
  expect(c.worker.sent.at(-1)).toMatchObject({action:'evaluateG1PlaneTangency',constraintId:42})
  c.worker.reply(published(output,revision,net));await flush()
}
const moved=(net:Net,id:number,z:number)=>{const n=structuredClone(net);n.poles[id][2]=z;return n}
afterEach(()=>vi.useRealTimers())

describe('published protected G1 draft transaction',()=>{
  it('publishes a real preview witness and stores immutable base/reference/constraint in undo/redo history',async()=>{
    const c=await setup(),before=c.draft.getSnapshot(),output=await apply(c),after=c.draft.getSnapshot()
    expect(after.net?.poles[7][2]).toBe(0)
    expect(after.planeTangency).toMatchObject({constraintId:42,baseNet:before.net,referenceNet:output.net,lockedPoles:[0,1]})
    expect(Object.isFrozen(after.planeTangency?.referenceNet.poles[7])).toBe(true)
    expect(Object.isFrozen(after.planeTangency?.choice.plane.normal)).toBe(true)
    expect(after.preview?.previewRevision).toBe(2);expect(after.validNet).toBe(after.net)
    expect(after.calculating).toBe(false)
    expect(c.worker.sent.map(m=>m.action)).toEqual(['evaluate','proposeG1PlaneTangency','publishG1PlaneTangency'])
    expect(c.draft.undo()).toBe(true)
    expect(c.draft.getSnapshot().planeTangency).toBeNull();expect(c.draft.getSnapshot().validNet).toBeNull()
    expect(c.draft.getSnapshot().preview).toBeNull()
    await vi.advanceTimersByTimeAsync(90);expect(c.worker.sent.at(-1)?.action).toBe('evaluate')
    c.worker.reply(preview(3));await flush()
    expect(c.draft.redo()).toBe(true)
    expect(c.draft.getSnapshot().planeTangency).toBe(after.planeTangency)
    expect(c.draft.getSnapshot().preview).toBeNull()
    await evaluate(c,output,4)
    expect(c.draft.getSnapshot().validNet).toBe(after.net);expect(c.draft.getSnapshot().preview?.previewRevision).toBe(4)
    c.finish()
  })
  it('allows deep edits but keeps the accepted double border and initial locks, including undo/redo',async()=>{
    const c=await setup(),output=await apply(c),accepted=c.draft.getSnapshot()
    const changed=moved(accepted.net!,12,.2)
    c.draft.preview(changed)
    expect(c.draft.getSnapshot().validNet).toBeNull()
    expect(()=>c.draft.preview(moved(changed,7,.1))).toThrow('protetto')
    expect(()=>c.draft.preview(moved(changed,6,.1))).toThrow('protetto')
    await evaluate(c,output,3,changed)
    expect(c.draft.getSnapshot().preview?.previewRevision).toBe(3)
    c.draft.commit();const committed=c.draft.getSnapshot()
    expect(committed.validNet).toBe(committed.net)
    expect(committed.planeTangency).toBe(accepted.planeTangency)
    c.draft.undo();expect(c.draft.getSnapshot().net).toBe(accepted.net)
    expect(c.draft.getSnapshot().validNet).toBeNull()
    await evaluate(c,output,4)
    c.draft.redo();expect(c.draft.getSnapshot().net).toBe(committed.net)
    await evaluate(c,output,5)
    expect(c.draft.getSnapshot().net?.poles[12][2]).toBe(.2)
    expect(c.draft.getSnapshot().preview?.previewRevision).toBe(5)
    c.finish()
  })
  it('does not alter snapshot/history/witness after proposal rejection or malformed coefficients',async()=>{
    const c=await setup(),before=c.draft.getSnapshot(),frame=c.runtime.history.current
    let pending=c.draft.applyPlaneTangency(choice),checked=expect(pending).rejects.toThrow('incompatibile')
    expect(c.worker.sent.at(-1)?.lockedPoles).toEqual([0,1]);expect(c.draft.getSnapshot()).toBe(before)
    c.worker.reject('Blocco incompatibile');await checked
    expect(c.draft.getSnapshot()).toBe(before);expect(c.runtime.history.current).toBe(frame)
    pending=c.draft.applyPlaneTangency(choice);checked=expect(pending).rejects.toThrow('protetto')
    const forged=result(before.net!);forged.net.poles[12][2]=2
    c.worker.reply(forged);await checked
    expect(c.draft.getSnapshot()).toBe(before);expect(c.runtime.history.current).toBe(frame)
    expect(c.worker.sent.every(m=>m.action!=='publishG1PlaneTangency')).toBe(true)
    c.finish()
  })
  it('keeps initial manual/trim/hidden locks and rejects forged movement or newly added deep locks',async()=>{
    const rejected=await setup([7]),before=rejected.draft.getSnapshot()
    const pending=rejected.draft.applyPlaneTangency(choice),checked=expect(pending).rejects.toThrow('protetto')
    expect(rejected.worker.sent.at(-1)?.lockedPoles).toEqual([7,0,1])
    rejected.worker.reply(result(before.net!));await checked
    expect(rejected.draft.getSnapshot()).toBe(before);rejected.finish()
    const c=await setup([12]);await apply(c);const accepted=c.draft.getSnapshot()
    expect(()=>c.draft.preview(moved(accepted.net!,12,.2))).toThrow('protetto')
    expect(()=>c.draft.setLocks([])).toThrow('blocchi iniziali')
    c.draft.setLocks([12,6]);expect(c.draft.getSnapshot().validNet).toBe(c.draft.getSnapshot().net)
    c.draft.setLocks([12]);expect(c.draft.getSnapshot().preview?.previewRevision).toBe(2)
    c.finish()
    const deep=await setup();await apply(deep)
    expect(()=>deep.draft.setLocks([12])).toThrow('Nuovi blocchi interni')
    deep.finish()
  })
  it('discards stale read-only proposal replies before publication',async()=>{
    for(const change of ['locks','reset','dispose'] as const) {
      const c=await setup(),output=result(c.draft.getSnapshot().net!)
      const pending=c.draft.applyPlaneTangency(choice),checked=expect(pending).rejects.toThrow(change==='dispose'?'chiuso':'bozza è cambiata')
      const id=c.worker.sent.at(-1)!.id
      if(change==='locks') c.draft.setLocks([12])
      else if(change==='reset') c.draft.reset()
      else c.draft.dispose()
      const after=c.draft.getSnapshot(),frame=c.runtime.history.current
      c.worker.reply(output,id);await checked
      expect(c.draft.getSnapshot()).toBe(after);expect(c.runtime.history.current).toBe(frame)
      expect(c.worker.sent.every(m=>m.action!=='publishG1PlaneTangency')).toBe(true)
      c.finish()
    }
  })
  it('serializes publishing against draft mutations, and leaves history/witness unchanged on publication refusal',async()=>{
    const c=await setup(),before=c.draft.getSnapshot(),frame=c.runtime.history.current
    const {pending}=await propose(c),checked=expect(pending).rejects.toThrow('pubblicazione rifiutata')
    expect(()=>c.draft.reset()).toThrow('Attendi la pubblicazione')
    expect(()=>c.draft.commit()).toThrow('Attendi la pubblicazione')
    expect(()=>c.draft.undo()).toThrow('Attendi la pubblicazione')
    expect(()=>c.draft.setSelection([12])).toThrow('Attendi la pubblicazione')
    c.worker.reject('pubblicazione rifiutata');await checked
    expect(c.draft.getSnapshot()).toBe(before);expect(c.runtime.history.current).toBe(frame)
    c.finish()
  })
  it('invalidates an obsolete witness and restores the prior geometry when a published reply is malformed',async()=>{
    const c=await setup(),before=c.draft.getSnapshot(),frame=c.runtime.history.current
    const {pending,output}=await propose(c),checked=expect(pending).rejects.toThrow('pubblicato')
    c.worker.reply({...published(output),constraintId:NaN});await checked
    expect(c.draft.getSnapshot().net).toBe(before.net);expect(c.runtime.history.current).toBe(frame)
    expect(c.draft.getSnapshot().validNet).toBeNull();expect(c.draft.getSnapshot().preview).toBeNull()
    await vi.advanceTimersByTimeAsync(90)
    expect(c.worker.sent.at(-1)?.action).toBe('evaluate')
    c.worker.reply(preview(3));await flush()
    expect(c.draft.getSnapshot().validNet).toBe(before.net)
    expect(c.draft.getSnapshot().preview?.previewRevision).toBe(3)
    c.finish()
  })
  it('invalidates an obsolete G1 witness when an export reply omits STEP, keeping history intact',async()=>{
    const c=await setup(),output=await apply(c),before=c.draft.getSnapshot(),frame=c.runtime.history.current
    const pending=c.draft.evaluateForExport(),checked=expect(pending).rejects.toThrow('STEP della tangenza non valido')
    c.worker.reply(published(output,3));await checked
    expect(c.draft.getSnapshot().net).toBe(before.net);expect(c.runtime.history.current).toBe(frame)
    expect(c.draft.getSnapshot().validNet).toBeNull();expect(c.draft.getSnapshot().preview).toBeNull()
    await evaluate(c,output,4)
    expect(c.draft.getSnapshot().preview?.previewRevision).toBe(4)
    c.finish()
  })
  it('exports through the published protocol with a real witness and rejects a stale export after geometry changes',async()=>{
    const c=await setup(),output=await apply(c)
    let pending=c.draft.evaluateForExport()
    expect(c.worker.sent.at(-1)).toMatchObject({action:'evaluateG1PlaneTangency',constraintId:42,exportStep:true})
    c.worker.reply({...published(output,3),step:'ISO-10303-21'})
    await expect(pending).resolves.toMatchObject({step:'ISO-10303-21',previewRevision:3})
    expect(c.draft.getSnapshot().preview?.previewRevision).toBe(3)
    c.draft.setLocks([6]);expect(c.draft.getSnapshot().preview?.previewRevision).toBe(3)
    pending=c.draft.evaluateForExport();const checked=expect(pending).rejects.toThrow('bozza è cambiata')
    const id=c.worker.sent.at(-1)!.id
    c.draft.preview(moved(c.draft.getSnapshot().net!,12,.2));const changed=c.draft.getSnapshot()
    c.worker.reply({...published(output,4),step:'ISO-10303-21'},id);await checked
    expect(c.draft.getSnapshot()).toBe(changed);expect(c.draft.getSnapshot().validNet).toBeNull()
    expect(c.draft.getSnapshot().preview?.previewRevision).not.toBe(4)
    c.finish()
  })
  it('does not discard a valid export witness for a selection-only or compatible lock change',async()=>{
    const c=await setup(),output=await apply(c)
    const pending=c.draft.evaluateForExport();c.draft.setSelection([12]);c.draft.setLocks([6])
    c.worker.reply({...published(output,3),step:'STEP'})
    await expect(pending).resolves.toMatchObject({previewRevision:3})
    expect(c.draft.getSnapshot().selected).toEqual([12]);expect(c.draft.getSnapshot().locks).toEqual([6])
    expect(c.draft.getSnapshot().preview?.previewRevision).toBe(3)
    c.finish()
  })
  it('does not validate an older deep preview or a failed current evaluation and never falls back to legacy evaluate',async()=>{
    const c=await setup(),output=await apply(c)
    const first=moved(c.draft.getSnapshot().net!,12,.1),second=moved(first,12,.2)
    c.draft.preview(first);await vi.advanceTimersByTimeAsync(90)
    const oldId=c.worker.sent.at(-1)!.id
    c.draft.preview(second);c.worker.reply(published(output,3,first),oldId);await flush()
    expect(c.draft.getSnapshot().validNet).toBeNull();expect(c.draft.getSnapshot().previewStale).toBe(true)
    expect(c.worker.sent.at(-1)?.net).toEqual(second)
    c.worker.reject('CAD G1 rifiutato');await flush()
    expect(c.draft.getSnapshot().validNet).toBeNull();expect(c.draft.getSnapshot().error).toBe('CAD G1 rifiutato')
    await expect(c.draft.evaluateForExport()).rejects.toThrow('Attendi la verifica')
    expect(c.worker.sent.filter(m=>m.action==='evaluate')).toHaveLength(1)
    c.finish()
  })
  it('keeps refinement/mode/original restoration gated while a constraint is active',async()=>{
    const c=await setup();await apply(c);const before=c.draft.getSnapshot(),frame=c.runtime.history.current
    expect(()=>c.draft.restoreOriginal()).toThrow('Annulla la tangenza')
    expect(()=>c.draft.setContinuity('G1')).toThrow('Annulla la tangenza')
    expect(()=>c.draft.setFreeBoundary(true)).toThrow('Annulla la tangenza')
    await expect(c.draft.refine([{axis:'U',value:.25,count:1}])).rejects.toThrow('Annulla la tangenza')
    expect(c.draft.getSnapshot()).toBe(before);expect(c.runtime.history.current).toBe(frame)
    c.finish()
  })
  it('stores constraint-only history changes and clones the immutable proposal/reference recipe',()=>{
    const history=new SurfaceHistory(),net=plane(),frame={net,locks:[],continuity:'G0' as const,freeBoundary:false}
    history.commit(frame)
    const constraint={constraintId:42,referenceNet:structuredClone(net),baseNet:net,choice:structuredClone(choice),lockedPoles:[0],distanceTolerance:1e-8}
    history.commit({...frame,planeTangency:constraint})
    constraint.choice.plane.normal[2]=2;constraint.baseNet.poles[0][2]=9;constraint.referenceNet.poles[7][2]=8;constraint.lockedPoles.push(7)
    expect(history.current?.planeTangency?.choice.plane.normal).toEqual([0,0,1])
    expect(history.current?.planeTangency?.baseNet.poles[0][2]).toBe(0)
    expect(history.current?.planeTangency?.referenceNet.poles[7][2]).toBe(0)
    expect(history.current?.planeTangency?.lockedPoles).toEqual([0])
    expect(history.step(-1)?.planeTangency).toBeUndefined();expect(history.step(1)?.planeTangency?.constraintId).toBe(42)
  })
})

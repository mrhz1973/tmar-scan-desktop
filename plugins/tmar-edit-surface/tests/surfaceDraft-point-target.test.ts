// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest'
import type { Net } from '../brep'
import { SurfaceDraft } from '../surfaceDraft'
import { SurfaceRuntime } from '../surfaceRuntime'
import {targetSurfacePoint} from '../surfacePointTarget'

class FakeWorker {
  onmessage: ((e: MessageEvent<unknown>) => void) | null = null
  sent: { id:number; action:string; net?:Net; previewRevision?:number }[]=[]
  postMessage(value: typeof this.sent[number]) {this.sent.push(value)}
  terminate() {}
  reply(id:number,result:unknown) {this.onmessage?.({data:{id,result}} as MessageEvent<unknown>)}
  reject(id:number,error:string) {this.onmessage?.({data:{id,error}} as MessageEvent<unknown>)}
}
const plane=():Net=>({nu:5,nv:5,du:3,dv:3,ku:[0,.5,1],kv:[0,.5,1],mu:[4,1,4],mv:[4,1,4],
  poles:Array.from({length:25},(_,i)=>[Math.floor(i/5),i%5,0]),weights:Array(25).fill(1),rational:[0,0]})
const preview=(revision:number)=>({valid:true,previewRevision:revision,mesh:{},faceMeshes:[],volume:1,maxBoundaryError:0,minimumNormalDot:1})
const anchor={face:0,selectionRevision:1,u:.5,v:.5}
const request=()=>({target:[2,2,.1] as [number,number,number],maxPoleDisplacement:10,minInfluence:.01,residualTolerance:1e-10})
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()}
async function setup(options:Parameters<SurfaceDraft['install']>[1]={}) {
  vi.useFakeTimers()
  const worker=new FakeWorker(),runtime=new SurfaceRuntime(()=>worker as unknown as Worker),draft=new SurfaceDraft(runtime)
  draft.install(plane(),{face:0,...options});draft.setSelection([12])
  await vi.advanceTimersByTimeAsync(90);worker.reply(worker.sent.at(-1)!.id,preview(1));await flush()
  return {worker,runtime,draft,close:()=>{draft.dispose();runtime.dispose()}}
}
const resolved={at:[2,2,0],normal:[0,0,1]}
afterEach(()=>vi.useRealTimers())

const multiOptions={maxPoleDisplacement:10,minInfluence:.01,residualTolerance:1e-9}
function batch(net:Net,movable=[12],uvs=[[.3,.4],[.7,.6]]){
  const changed=structuredClone(net);for(const i of movable)changed.poles[i][2]+=.1
  const at=(n:Net,u:number,v:number)=>targetSurfacePoint(n,{...multiOptions,u,v,target:[0,0,0],editablePoles:n.poles.map((_,i)=>i)}).before
  return uvs.map(([u,v])=>({anchor:{...anchor,u,v},target:at(changed,u,v),resolved:{at:at(net,u,v)}}))
}

it.each(['G0','G1'] as const)('checks every simultaneous anchor and derives snapshot permissions with %s protection',async continuity=>{
  const {draft,worker,close}=await setup({continuity,trimLocks:[7],hiddenPoles:[18]})
  draft.setLocks([6]);draft.setSelection([0,6,7,12,13,18,24])
  const before=draft.getSnapshot(),points=batch(before.net!,continuity==='G0'?[12,13]:[12],[[.3,.15],[.7,.85]])
  const pending=draft.targetPointsExperimental(before,points,multiOptions,()=>true)
  for(const p of points){expect(worker.sent.at(-1)?.action).toBe('noteResolve');worker.reply(worker.sent.at(-1)!.id,p.resolved);await flush()}
  const result=await pending
  expect(result.net.poles.flatMap((p,i)=>p.some((x,d)=>x!==before.net!.poles[i][d])?[i]:[])).toEqual(continuity==='G0'?[12,13]:[12])
  expect(draft.getSnapshot().validNet).toBeNull();expect(draft.undo()).toBe(true);expect(draft.getSnapshot().net).toEqual(before.net)
  close()
})

it.each(['reference','selection','face','locks','dispose'] as const)('refuses simultaneous anchors invalidated by %s during the last CAD resolve',async mode=>{
  const {draft,runtime,worker,close}=await setup(),before=draft.getSnapshot(),points=batch(before.net!)
  let current=true
  const pending=draft.targetPointsExperimental(before,points,multiOptions,()=>current).catch(e=>e as Error)
  worker.reply(worker.sent.at(-1)!.id,points[0].resolved);await flush()
  const last=worker.sent.at(-1)!
  if(mode==='reference')current=false
  if(mode==='selection')draft.setSelection([6])
  if(mode==='face')draft.install(plane(),{face:1})
  if(mode==='locks')draft.setLocks([12])
  if(mode==='dispose')draft.dispose()
  const preserved=draft.getSnapshot();worker.reply(last.id,points[1].resolved)
  expect(await pending).toBeInstanceOf(Error);expect(draft.getSnapshot()).toBe(preserved)
  if(mode==='dispose')runtime.dispose();else close()
})

it.each(['trim','mismatch'] as const)('rejects the final simultaneous CAD anchor on %s without a partial commit',async mode=>{
  const {draft,worker,close}=await setup(),before=draft.getSnapshot(),points=batch(before.net!)
  const pending=draft.targetPointsExperimental(before,points,multiOptions,()=>true)
  worker.reply(worker.sent.at(-1)!.id,points[0].resolved);await flush()
  if(mode==='trim')worker.reject(worker.sent.at(-1)!.id,'Punto nel foro.')
  else worker.reply(worker.sent.at(-1)!.id,{at:[0,0,99]})
  await expect(pending).rejects.toThrow(mode==='trim'?/foro/:/non coincide/)
  expect(draft.getSnapshot()).toBe(before);expect(draft.undo()).toBe(false);close()
})

it('keeps a CAD-refused simultaneous candidate invalid and restores it with one Undo',async()=>{
  const {draft,worker,close}=await setup(),before=draft.getSnapshot(),points=batch(before.net!)
  const pending=draft.targetPointsExperimental(before,points,multiOptions,()=>true)
  for(const p of points){worker.reply(worker.sent.at(-1)!.id,p.resolved);await flush()}
  await pending;await vi.advanceTimersByTimeAsync(90);worker.reject(worker.sent.at(-1)!.id,'Corpo CAD non valido.');await flush()
  expect(draft.getSnapshot().validNet).toBeNull();expect(draft.getSnapshot().error).toMatch(/non valido/)
  expect(draft.undo()).toBe(true);expect(draft.getSnapshot().net).toEqual(before.net);expect(draft.undo()).toBe(false);close()
})

it('commits one Undo operation, schedules ordinary CAD validation and does not declare the candidate valid early',async()=>{
  const {draft,worker,close}=await setup(),before=draft.getSnapshot()
  const pending=draft.targetPoint(before,anchor,request()),pick=worker.sent.at(-1)!
  expect(pick.action).toBe('noteResolve');expect(pick.previewRevision).toBe(1)
  expect(draft.getSnapshot()).toBe(before)
  worker.reply(pick.id,resolved);const result=await pending
  expect(result.after[2]).toBeCloseTo(.1,12)
  expect(draft.getSnapshot().net).toEqual(result.net)
  expect(draft.getSnapshot().validNet).toBeNull()
  await vi.advanceTimersByTimeAsync(90)
  expect(worker.sent.at(-1)?.action).toBe('evaluate')
  worker.reply(worker.sent.at(-1)!.id,preview(2));await flush()
  expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
  expect(draft.undo()).toBe(true);expect(draft.getSnapshot().net).toEqual(before.net)
  expect(draft.undo()).toBe(false)
  expect(draft.redo()).toBe(true);expect(draft.getSnapshot().net).toEqual(result.net)
  close()
})

it.each(['G0','G1'] as const)('derives authorized poles from selection, manual/trim/hidden locks and %s rings',async continuity=>{
  const {draft,worker,close}=await setup({continuity,trimLocks:[7],hiddenPoles:[18]})
  draft.setLocks([6]);await vi.advanceTimersByTimeAsync(90)
  worker.reply(worker.sent.at(-1)!.id,preview(2));await flush()
  draft.setSelection([0,6,7,12,13,18,24])
  const before=draft.getSnapshot(),pending=draft.targetPoint(before,anchor,request())
  worker.reply(worker.sent.at(-1)!.id,resolved);const result=await pending
  const changed=result.net.poles.flatMap((p,i)=>p.some((x,d)=>x!==before.net!.poles[i][d])?[i]:[])
  expect(changed).toEqual(continuity==='G0'?[12,13]:[12])
  close()
})

it.each(['undo','face','selection','dispose'] as const)('rejects late resolution after %s without committing a target',async change=>{
  const {draft,runtime,worker,close}=await setup()
  if(change==='undo') {
    const net=structuredClone(draft.getSnapshot().net!);net.poles[12][2]=.2;draft.commit(net)
    await vi.advanceTimersByTimeAsync(90);worker.reply(worker.sent.at(-1)!.id,preview(2));await flush()
  }
  const at=draft.getSnapshot().net!.poles[12][2]/4
  const pending=draft.targetPoint(draft.getSnapshot(),anchor,request()).catch(e=>e as Error),pick=worker.sent.at(-1)!
  if(change==='undo') draft.undo()
  if(change==='face') draft.install(plane(),{face:1})
  if(change==='selection') draft.setSelection([6])
  if(change==='dispose') draft.dispose()
  const preserved=draft.getSnapshot()
  worker.reply(pick.id,{...resolved,at:[2,2,at]})
  expect(await pending).toBeInstanceOf(Error)
  expect(draft.getSnapshot()).toBe(preserved)
  if(change!=='dispose') close();else runtime.dispose()
})

it('refuses stale snapshots, forbidden or weak selection and unverified drafts before requesting CAD',async()=>{
  const {draft,worker,close}=await setup(),original=draft.getSnapshot(),count=worker.sent.length
  draft.setSelection([0])
  await expect(draft.targetPoint(original,anchor,request())).rejects.toThrow(/cambiata/)
  await expect(draft.targetPoint(draft.getSnapshot(),anchor,request())).rejects.toThrow(/liberi/)
  draft.setSelection([12])
  await expect(draft.targetPoint(draft.getSnapshot(),{...anchor,face:99},request())).rejects.toThrow(/faccia/)
  await expect(draft.targetPoint(draft.getSnapshot(),{...anchor,u:0,v:0},request())).rejects.toThrow(/Influenza/)
  expect(worker.sent).toHaveLength(count)
  const net=structuredClone(draft.getSnapshot().net!);net.poles[12][2]=.1;draft.preview(net)
  await expect(draft.targetPoint(draft.getSnapshot(),anchor,request())).rejects.toThrow(/valida/)
  close()
})

it.each(['trim','mismatch'] as const)('retains the original draft/history when CAD rejects the %s anchor',async mode=>{
  const {draft,worker,close}=await setup(),before=draft.getSnapshot()
  const pending=draft.targetPoint(before,anchor,request()),pick=worker.sent.at(-1)!
  if(mode==='trim') worker.reject(pick.id,'Il punto cade dentro un foro.')
  else worker.reply(pick.id,{...resolved,at:[2,2,1]})
  await expect(pending).rejects.toThrow(mode==='trim'?/foro/:/non coincide/)
  expect(draft.getSnapshot()).toBe(before);expect(draft.undo()).toBe(false)
  close()
})

it('keeps a CAD-refused candidate unverified and allows a single Undo to restore the source',async()=>{
  const {draft,worker,close}=await setup(),before=draft.getSnapshot()
  const pending=draft.targetPoint(before,anchor,request())
  worker.reply(worker.sent.at(-1)!.id,resolved);await pending
  await vi.advanceTimersByTimeAsync(90);worker.reject(worker.sent.at(-1)!.id,'Corpo CAD non valido.');await flush()
  expect(draft.getSnapshot().validNet).toBeNull();expect(draft.getSnapshot().error).toMatch(/non valido/)
  expect(draft.undo()).toBe(true);expect(draft.getSnapshot().net).toEqual(before.net)
  expect(draft.undo()).toBe(false)
  close()
})

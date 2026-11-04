// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from 'vitest'

import type { Net } from '../brep'

import { SurfaceDraft } from '../surfaceDraft'

import { SurfaceRuntime } from '../surfaceRuntime'

import { moveSmoothCylinderPole } from '../periodic'



class WorkerStub {

  onmessage: ((event: MessageEvent) => void) | null = null

  sent: { id: number; action: string; session?: number; net: Net }[] = []

  postMessage(message: typeof this.sent[number]) { this.sent.push(message) }

  terminate() {}

  reply(index: number, result: unknown) { this.onmessage?.({data:{id:this.sent[index].id,result}} as MessageEvent) }

}

function cylinder(): Net {

  const poles: Net['poles'] = Array.from({length:30},(_,i)=>[Math.floor(i/5),i%5,0])

  return { nu:6,nv:5,du:2,dv:3,poles,weights:poles.map(()=>1),rational:[0,0],

    periodic:[1,0],ku:[0,2,4,6],mu:[2,2,2,2],kv:[0,10,20],mv:[4,1,4] }

}

function setup() {

  vi.useFakeTimers()

  const worker=new WorkerStub(),runtime=new SurfaceRuntime(()=>worker as unknown as Worker),draft=new SurfaceDraft(runtime)

  draft.installCylinder(cylinder(),7)

  return {worker,runtime,draft}

}

async function flush() { await Promise.resolve();await Promise.resolve();await Promise.resolve() }

afterEach(()=>vi.useRealTimers())



it('routes only cylindrical previews and never validates a provisional mesh',async()=>{

  const {worker,runtime,draft}=setup()

  await vi.advanceTimersByTimeAsync(90)

  expect(worker.sent[0]).toMatchObject({action:'previewCylinder',session:7})

  worker.reply(0,{kind:'provisional',mesh:{}});await flush()

  expect(draft.getSnapshot()).toMatchObject({validNet:null,previewStale:false,calculating:false,preview:null,cylinderPreview:{kind:'provisional'}})

  await expect(draft.evaluateForExport()).rejects.toThrow('dedicata')

  draft.dispose();runtime.dispose()

})



it('couples the centre gesture, protects companion locks, and retains undo/redo',()=>{

  const {draft,runtime}=setup(),base=draft.getSnapshot().net!

  const gesture=structuredClone(base);gesture.poles[17][2]+=.3

  draft.preview(gesture)

  expect(draft.getSnapshot().net).toEqual(moveSmoothCylinderPole(base,[0,0,.3]))

  expect(runtime.history.canUndo).toBe(false)

  draft.commit()

  expect(draft.undo()).toBe(true)

  expect(draft.getSnapshot().net).toEqual(base)

  expect(draft.redo()).toBe(true)

  draft.setLocks([12])

  const next=structuredClone(draft.getSnapshot().net!);next.poles[17][2]+=.2

  expect(()=>draft.preview(next)).toThrow('bloccato')

  expect(()=>draft.setFreeBoundary(true)).toThrow('protetti')

  expect(()=>draft.setContinuity('G0')).toThrow('G1')

  draft.restoreOriginal()

  expect(draft.getSnapshot().net).toEqual(base)

  draft.dispose();runtime.dispose()

})



it('exports only through full cylinder evaluation and refuses changed or replaced candidates',async()=>{

  const {worker,draft,runtime}=setup()

  const pending=draft.evaluateCylinderForExport()

  expect(worker.sent[0]).toMatchObject({action:'evaluateCylinder',session:7})

  worker.reply(0,{mesh:{},step:'STEP'})

  await expect(pending).resolves.toMatchObject({step:'STEP'})

  expect(draft.getSnapshot().validNet).toBeNull()

  const stale=draft.evaluateCylinderForExport(), rejected=expect(stale).rejects.toThrow('bozza è cambiata')

  draft.commit(moveSmoothCylinderPole(draft.getSnapshot().net!,[0,0,.1]))

  worker.reply(1,{mesh:{},step:'OLD'});await rejected

  const replaced=draft.evaluateCylinderForExport(),rejectedReplacement=expect(replaced).rejects.toThrow('bozza è cambiata')

  draft.installCylinder(cylinder(),8)

  worker.reply(2,{mesh:{},step:'OLD'});await rejectedReplacement

  draft.dispose();runtime.dispose()

})



it('drops old cylinder replies on reset and rejects unsupported nets without replacing history',async()=>{

  const {worker,draft,runtime}=setup()

  await vi.advanceTimersByTimeAsync(90)

  expect(()=>draft.installCylinder({...cylinder(),periodic:[0,1]},9)).toThrow()

  expect(draft.getSnapshot().cylinderSession).toBe(7)

  draft.reset();worker.reply(0,{kind:'provisional',mesh:{}});await flush()

  expect(draft.getSnapshot()).toMatchObject({cylinderSession:null,preview:null,net:null,validNet:null})

  draft.dispose();runtime.dispose()

})



it('coalesces moving cylinder gestures and labels obsolete visuals stale',async()=>{
  const {worker,draft,runtime}=setup(),base=draft.getSnapshot().net!
  await vi.advanceTimersByTimeAsync(90)
  draft.preview(moveSmoothCylinderPole(base,[0,0,.1]))
  draft.preview(moveSmoothCylinderPole(base,[0,0,.2]))
  worker.reply(0,{kind:'provisional',mesh:{}});await flush()
  expect(worker.sent).toHaveLength(2)
  expect(worker.sent[1].net).toEqual(moveSmoothCylinderPole(base,[0,0,.2]))
  expect(draft.getSnapshot()).toMatchObject({previewStale:true,validNet:null})
  worker.reply(1,{kind:'provisional',mesh:{},faceMeshes:[{}]});await flush()
  expect(draft.getSnapshot()).toMatchObject({previewStale:false,validNet:null,preview:null,cylinderPreview:{faceMeshes:[{}]}})
  const pending=draft.evaluateCylinderForExport(),rejected=expect(pending).rejects.toThrow('chiuso')
  draft.dispose();worker.reply(2,{mesh:{},step:'OLD'});await rejected
  runtime.dispose()
})

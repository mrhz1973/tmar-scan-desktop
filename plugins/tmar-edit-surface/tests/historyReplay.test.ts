// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { replaySurfaceHistory } from '../historyReplay'

const recipe = () => ({ schema:'tmar.surface-edit',version:2,engine:'occt-wasm-5.7.1/brep-v3',
  units:'mm',coordinateFrame:'imported-step',source:{bodyId:'body',brepSha256:'a'.repeat(64),faceCount:1,solidCount:0},
  faceIndex:0,preparation:'native-nurbs',baseNetSha256:'b'.repeat(64),continuity:'G0',edits:[],lockedPoles:[] })
const adaptiveRecipe = () => ({ ...recipe(), version:8, preparation:'plane-to-bicubic', boundaryMode:'locked',
  refinements:[{axis:'U',value:.5,count:1}],trimPolicy:'circular-fine-v1',lockedValues:[] })
const bytes = new TextEncoder().encode('STEP fixture')
const source = () => ({bodyKey:'body',stepSha256:createHash('sha256').update(bytes).digest('hex'),step:bytes.slice(),assertCurrent:vi.fn()})
class WorkerStub {
  onmessage: ((event: MessageEvent<unknown>)=>void) | null = null
  onerror = null
  onmessageerror = null
  terminate = vi.fn()
  postMessage = vi.fn()
  reply(result:unknown) { const id=this.postMessage.mock.calls[0][0].id; this.onmessage?.({data:{id,result}} as MessageEvent<unknown>) }
}
const waitForRequest = (worker: WorkerStub) => vi.waitFor(
  () => expect(worker.postMessage).toHaveBeenCalledOnce(), { timeout: 2000, interval: 5 })

describe('independent surface history replay',()=>{
  it('uses isolated adaptive replay and rejects invalid adaptive recipes',async()=>{
    const worker=new WorkerStub(),input=source(),saved=adaptiveRecipe()
    const call=replaySurfaceHistory(input,saved,undefined,()=>worker as unknown as Worker)
    await waitForRequest(worker)
    expect(worker.postMessage.mock.calls[0][0].action).toBe('replayAdaptiveLockedRecipe')
    expect(worker.postMessage.mock.calls[0][0].recipe).toEqual(saved)
    worker.reply({valid:true,step:'valid STEP'})
    await expect(call).resolves.toMatchObject({valid:true})
    expect(worker.terminate).toHaveBeenCalledOnce()
    const factory=vi.fn(()=>new WorkerStub() as unknown as Worker)
    await expect(replaySurfaceHistory(input,{...saved,trimPolicy:'legacy'},undefined,factory)).rejects.toThrow()
    expect(factory).not.toHaveBeenCalled()
  })
  it('rejects wrong body, wrong STEP and cancellation before creating a worker',async()=>{
    const factory=vi.fn(()=>new WorkerStub() as unknown as Worker), input=source()
    await expect(replaySurfaceHistory({...input,bodyKey:'other'},recipe(),undefined,factory)).rejects.toThrow('altro corpo')
    await expect(replaySurfaceHistory({...input,stepSha256:'0'.repeat(64)},recipe(),undefined,factory)).rejects.toThrow('STEP non corrisponde')
    const abort=new AbortController();abort.abort()
    await expect(replaySurfaceHistory(input,recipe(),abort.signal,factory)).rejects.toMatchObject({name:'AbortError'})
    expect(factory).not.toHaveBeenCalled()
  })
  it('disposes the worker and rejects malformed output or a revoked source',async()=>{
    const worker=new WorkerStub(), input=source(), call=replaySurfaceHistory(input,recipe(),undefined,()=>worker as unknown as Worker)
    await waitForRequest(worker);worker.reply({valid:false,step:'fake'})
    await expect(call).rejects.toThrow('STEP valido')
    expect(worker.terminate).toHaveBeenCalledOnce()
    const w2=new WorkerStub(), stale=source()
    stale.assertCurrent.mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{}).mockImplementation(()=>{throw Error('source changed')})
    const second=replaySurfaceHistory(stale,recipe(),undefined,()=>w2 as unknown as Worker)
    await waitForRequest(w2);w2.reply({valid:true,step:'fake'})
    await expect(second).rejects.toThrow('source changed')
    expect(w2.terminate).toHaveBeenCalledOnce()
  })
  it('snapshots mutable recipe and source bytes before the asynchronous hash',async()=>{
    const worker=new WorkerStub(), input=source(), saved=recipe()
    const call=replaySurfaceHistory(input,saved,undefined,()=>worker as unknown as Worker)
    saved.source.bodyId='changed';input.step.fill(0)
    await waitForRequest(worker)
    expect(worker.postMessage.mock.calls[0][0].recipe.source.bodyId).toBe('body')
    expect(worker.postMessage.mock.calls[0][0].step).toBe('STEP fixture')
    worker.reply({valid:true,step:'valid STEP'})
    await expect(call).resolves.toMatchObject({valid:true,step:'valid STEP'})
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})

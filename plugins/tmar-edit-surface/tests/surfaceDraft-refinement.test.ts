// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Net } from '../brep'
import { refineClampedNet, type KnotInsertion } from '../refineClampedNet'
import { SurfaceDraft } from '../surfaceDraft'
import { SurfaceRuntime } from '../surfaceRuntime'
import { SurfaceHistory } from '../surfaceHistory'

const insertion: KnotInsertion[] = [{ axis: 'U', value: .25, count: 1 }]
function plane(): Net {
  const poles: Net['poles'] = []
  for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) poles.push([u, v, 0])
  return { nu: 5, nv: 5, du: 3, dv: 3, poles, weights: poles.map(() => 1), rational: [0, 0],
    ku: [0, .5, 1], kv: [0, .5, 1], mu: [4, 1, 4], mv: [4, 1, 4] }
}
class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror = null
  onmessageerror = null
  sent: { id: number; action: string; net?: Net; selection?: { face: number; refinements: KnotInsertion[] }; refinements?: KnotInsertion[] }[] = []
  postMessage(message: typeof this.sent[number]) { this.sent.push(message) }
  terminate() {}
  reply(value: unknown) { this.onmessage?.({ data: { id: this.sent.at(-1)!.id, result: value } } as MessageEvent<unknown>) }
  reject(error: string) { this.onmessage?.({ data: { id: this.sent.at(-1)!.id, error } } as MessageEvent<unknown>) }
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve() }
function setup() {
  vi.useFakeTimers()
  const worker = new FakeWorker(), runtime = new SurfaceRuntime(() => worker as unknown as Worker)
  const draft = new SurfaceDraft(runtime)
  draft.install(plane(), { face: 2, trimLocks: [0], hiddenPoles: [1] })
  const finish = () => { draft.dispose(); runtime.dispose() }
  return { worker, runtime, draft, finish }
}
async function evaluate(worker: FakeWorker) {
  await vi.advanceTimersByTimeAsync(90)
  worker.reply({ valid: true, previewRevision: worker.sent.at(-1)!.id, mesh: {}, faceMeshes: [] })
  await flush()
}
afterEach(() => vi.useRealTimers())

describe('atomic refinement history', () => {
  it('requires the matching worker identity and routes adaptive previews to the adaptive action',async()=>{
    vi.useFakeTimers()
    const worker=new FakeWorker(),runtime=new SurfaceRuntime(()=>worker as unknown as Worker),draft=new SurfaceDraft(runtime)
    const net=refineClampedNet(plane(),insertion)
    const token={face:2,refinements:insertion,trimPolicy:'circular-fine-v1' as const,generation:1,trimLocks:[],hiddenPoles:[]}
    try {
      expect(()=>draft.install(net,{face:2,refinements:insertion,experimentalAdaptiveLocks:true})).toThrow(/worker/)
      expect(()=>draft.install(net,{face:2,refinements:insertion,experimentalAdaptiveLocks:true,adaptiveSelection:{...token,face:3}})).toThrow(/worker/)
      expect(()=>draft.install(net,{face:2,refinements:insertion,trimLocks:[0],experimentalAdaptiveLocks:true,adaptiveSelection:token})).toThrow(/worker/)
      draft.install(net,{face:2,refinements:insertion,experimentalAdaptiveLocks:true,adaptiveSelection:token})
      await evaluate(worker)
      expect(worker.sent.at(-1)?.action).toBe('evaluateAdaptiveExperimental')
      expect(worker.sent.at(-1)?.selection).toEqual(token)
      expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
      expect(()=>draft.setFreeBoundary(true)).toThrow(/protetti/)
      await expect(draft.createRecipe('body')).rejects.toThrow(/adattivo/)
      const saving=draft.createAdaptiveLockedRecipe('body')
      expect(worker.sent.at(-1)?.action).toBe('createAdaptiveLockedRecipe')
      expect(()=>draft.setLocks([12])).toThrow(/ricetta/)
      worker.reject('Salvataggio rifiutato')
      await expect(saving).rejects.toThrow(/rifiutato/)
      expect(draft.getSnapshot().validNet).toBeNull()
      await evaluate(worker)
      expect(worker.sent.at(-1)?.action).toBe('evaluateAdaptiveExperimental')
      expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    } finally {draft.dispose();runtime.dispose()}
  })
  it('retains adaptive lock-at-position history when editing the draft',async()=>{
    vi.useFakeTimers()
    const worker=new FakeWorker(),runtime=new SurfaceRuntime(()=>worker as unknown as Worker),draft=new SurfaceDraft(runtime)
    try {
      draft.install(refineClampedNet(plane(),insertion),{face:2,refinements:insertion,experimentalAdaptiveLocks:true,
        adaptiveSelection:{face:2,refinements:insertion,trimPolicy:'circular-fine-v1',generation:1,trimLocks:[],hiddenPoles:[]}})
      const moved=structuredClone(draft.getSnapshot().net!);moved.poles[12][2]=.2;draft.commit(moved)
      draft.setLocks([12])
      expect(runtime.history.current?.lockSnapshots).toEqual([{index:12,point:moved.poles[12]}])
      const illegal=structuredClone(draft.getSnapshot().net!);illegal.poles[12][2]=.3
      expect(()=>draft.commit(illegal)).toThrow(/bloccato/)
      expect(draft.undo()).toBe(true);expect(runtime.history.current?.lockSnapshots).toEqual([])
      expect(draft.redo()).toBe(true);expect(runtime.history.current?.lockSnapshots).toEqual([{index:12,point:moved.poles[12]}])
      draft.setLocks([]);draft.commit(illegal);draft.setLocks([12])
      expect(runtime.history.current?.lockSnapshots).toEqual([{index:12,point:illegal.poles[12]}])
      const sent=worker.sent.length
      await expect(draft.refine(insertion)).rejects.toThrow(/blocchi manuali/)
      expect(worker.sent).toHaveLength(sent)
    } finally {draft.dispose();runtime.dispose()}
  })
  it('preserves deformation and restores each base, protection map and worker selection on undo/redo', async () => {
    const { worker, runtime, draft, finish } = setup()
    await evaluate(worker)
    const changed = structuredClone(draft.getSnapshot().net!)
    changed.poles[12][2] = .2
    draft.commit(changed)
    await evaluate(worker)
    const before = draft.getSnapshot(), prior = runtime.history.current
    draft.setSelection([12])
    const pending = draft.refine(insertion)
    expect(draft.getSnapshot().net).toBe(before.net)
    expect(runtime.history.current).toBe(prior)
    expect(draft.getSnapshot().validNet).toBeNull()
    expect(() => draft.commit()).toThrow('Attendi il raffinamento')
    const base = refineClampedNet(plane(), insertion)
    worker.reply({ net: base, trimLocks: [0, 29], hiddenPoles: [4] })
    await pending
    const refined = draft.getSnapshot()
    expect(refined.net).toEqual(refineClampedNet(changed, insertion))
    expect(refined.originalNet).toEqual(base)
    expect(refined.selected).toEqual([])
    expect(refined.trimLocks).toEqual([0, 29])
    expect(refined.hiddenPoles).toEqual([4])
    expect(refined.refinements).toEqual(insertion)
    expect(Object.isFrozen(refined.refinements[0])).toBe(true)
    await evaluate(worker)
    expect(worker.sent.at(-1)?.selection).toEqual({ face: 2, refinements: insertion })
    expect(draft.getSnapshot().validNet).toBe(refined.net)
    const exporting = draft.evaluateForExport()
    expect(worker.sent.at(-1)?.selection).toEqual({ face: 2, refinements: insertion })
    worker.reply({ valid: true, previewRevision: 50, step: 'STEP', mesh: {}, faceMeshes: [] })
    await exporting
    expect(draft.undo()).toBe(true)
    expect(draft.getSnapshot().net).toBe(before.net)
    expect(draft.getSnapshot().originalNet).toBe(before.originalNet)
    expect(draft.getSnapshot().trimLocks).toEqual([0])
    expect(draft.getSnapshot().hiddenPoles).toEqual([1])
    expect(draft.getSnapshot().refinements).toEqual([])
    await evaluate(worker)
    expect(worker.sent.at(-1)?.selection).toEqual({ face: 2, refinements: [] })
    expect(draft.redo()).toBe(true)
    expect(draft.getSnapshot().net).toBe(refined.net)
    await evaluate(worker)
    draft.restoreOriginal()
    expect(draft.getSnapshot().net).toEqual(base)
    expect(draft.getSnapshot().refinements).toEqual(insertion)
    finish()
  })

  it('accumulates insertions and discards a refinement redo branch after another committed edit', async () => {
    const { worker, runtime, draft, finish } = setup()
    await evaluate(worker)
    const first = draft.refine(insertion)
    const base = refineClampedNet(plane(), insertion)
    worker.reply({ net: base, trimLocks: [0], hiddenPoles: [] }); await first
    await evaluate(worker)
    const addition: KnotInsertion[] = [{ axis: 'V', value: .75, count: 1 }]
    const second = draft.refine(addition)
    expect(worker.sent.at(-1)?.refinements).toEqual([...insertion, ...addition])
    worker.reply({ net: refineClampedNet(base, addition), trimLocks: [0], hiddenPoles: [] }); await second
    expect(draft.getSnapshot().refinements).toEqual([...insertion, ...addition])
    expect(draft.undo()).toBe(true)
    expect(draft.getSnapshot().refinements).toEqual(insertion)
    draft.setLocks([12])
    expect(runtime.history.canRedo).toBe(false)
    expect(draft.getSnapshot().originalNet).toEqual(base)
    finish()
  })

  it('keeps protection-only edits on the same preparation without another CAD call', async () => {
    const { worker, draft, finish } = setup()
    await evaluate(worker)
    const count = worker.sent.length
    draft.setLocks([12])
    expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    await expect(draft.refine(insertion)).rejects.toThrow('blocchi manuali')
    expect(worker.sent).toHaveLength(count)
    expect(draft.getSnapshot().refinements).toEqual([])
    finish()
  })

  it('rolls worker selection back after refusal without adding or replacing a history frame', async () => {
    const { worker, runtime, draft, finish } = setup()
    await evaluate(worker)
    const prior = runtime.history.current, net = draft.getSnapshot().net
    const pending = draft.refine(insertion)
    const checked = expect(pending).rejects.toThrow('rifiutato')
    worker.reject('rifiutato')
    await flush()
    expect(worker.sent.at(-1)).toMatchObject({ action: 'selectRefined', face: 2, refinements: [] })
    worker.reply({ net: plane(), trimLocks: [0], hiddenPoles: [1] })
    await checked
    expect(runtime.history.current).toBe(prior)
    expect(runtime.history.canUndo).toBe(false)
    expect(draft.getSnapshot().net).toBe(net)
    expect(draft.getSnapshot().validNet).toBeNull()
    await evaluate(worker)
    expect(worker.sent.at(-1)?.selection).toEqual({ face: 2, refinements: [] })
    finish()
  })

  it('refuses remapped trim locks that would silently protect an already deformed pole', async () => {
    const { worker, runtime, draft, finish } = setup()
    await evaluate(worker)
    const changed = structuredClone(draft.getSnapshot().net!)
    changed.poles[12][2] = .2
    draft.commit(changed); await evaluate(worker)
    const previous = runtime.history.current
    const refined = refineClampedNet(changed, insertion)
    const blocked = refined.poles.findIndex(p => p[2] !== 0)
    const pending = draft.refine(insertion), checked = expect(pending).rejects.toThrow('trim')
    worker.reply({ net: refineClampedNet(plane(), insertion), trimLocks: [blocked], hiddenPoles: [] })
    await flush()
    worker.reply({ net: plane(), trimLocks: [0], hiddenPoles: [1] })
    await checked
    expect(runtime.history.current).toBe(previous)
    expect(draft.getSnapshot().trimLocks).toEqual([0])
    finish()
  })

  it('does not commit a late refinement after disposal', async () => {
    const { worker, runtime, draft } = setup()
    await evaluate(worker)
    const pending = draft.refine(insertion), checked = expect(pending).rejects.toThrow('superato')
    draft.dispose()
    worker.reply({ net: refineClampedNet(plane(), insertion), trimLocks: [], hiddenPoles: [] })
    await checked
    expect(runtime.history.current).toBeUndefined()
    expect(draft.getSnapshot().net).toBeNull()
    runtime.dispose()
  })

  it('clones preparation input and records preparation changes even when the net is unchanged', () => {
    const h = new SurfaceHistory()
    const preparation = { face: 0, refinements: insertion, originalNet: plane(), trimLocks: [0], hiddenPoles: [1] }
    h.commit({ net: plane(), locks: [], continuity: 'G1', freeBoundary: false, preparation })
    preparation.trimLocks.push(2)
    expect(h.current?.preparation?.trimLocks).toEqual([0])
    h.commit({ net: plane(), locks: [], continuity: 'G1', freeBoundary: false, preparation })
    expect(h.canUndo).toBe(true)
    expect(h.step(-1)?.preparation?.trimLocks).toEqual([0])
  })
})

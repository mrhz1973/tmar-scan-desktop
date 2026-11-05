// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Net } from '../brep'
import { SurfaceDraft } from '../surfaceDraft'
import { SurfaceRuntime } from '../surfaceRuntime'

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  sent: { id: number; action: string; net: Net }[] = []
  postMessage(message: { id: number; action: string; net: Net }) { this.sent.push(message) }
  terminate = vi.fn()
  reply(id: number, value: unknown) { this.onmessage?.({ data: { id, result: value } } as MessageEvent<unknown>) }
  reject(id: number, error: string) { this.onmessage?.({ data: { id, error } } as MessageEvent<unknown>) }
}
function plane(): Net {
  const poles: Net['poles'] = []
  for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) poles.push([u, v, 0])
  return { nu: 5, nv: 5, du: 3, dv: 3, poles, weights: poles.map(() => 1),
    rational: [0, 0], ku: [0, .5, 1], kv: [0, .5, 1], mu: [4, 1, 4], mv: [4, 1, 4] }
}
function moved(net: Net, index: number, z: number): Net {
  const result = structuredClone(net)
  result.poles[index][2] = z
  return result
}
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
function setup() {
  vi.useFakeTimers()
  const worker = new FakeWorker()
  const runtime = new SurfaceRuntime(() => worker as unknown as Worker)
  const draft = new SurfaceDraft(runtime)
  return { worker, runtime, draft }
}
const cadPreview = (revision: number) => ({ valid: true, previewRevision: revision, mesh: {}, faceMeshes: [],
  volume: 1, maxBoundaryError: 0, minimumNormalDot: 1 })
afterEach(() => vi.useRealTimers())

describe('SurfaceDraft', () => {
  it('keeps periodicity metadata immutable across draft ownership and history', () => {
    const { runtime, draft } = setup()
    const input = { ...plane(), periodic: [0, 0] as [number, number] }
    draft.install(input)
    input.periodic[0] = 1
    const initial = draft.getSnapshot()
    expect(initial.net?.periodic).toEqual([0, 0])
    expect(Object.isFrozen(initial.net?.periodic)).toBe(true)
    expect(Object.isFrozen(initial.originalNet?.periodic)).toBe(true)
    draft.commit(moved(initial.net!, 12, 0.2))
    expect(Object.isFrozen(draft.getSnapshot().net?.periodic)).toBe(true)
    expect(draft.undo()).toBe(true)
    expect(Object.isFrozen(draft.getSnapshot().net?.periodic)).toBe(true)
    expect(draft.redo()).toBe(true)
    expect(Object.isFrozen(draft.getSnapshot().net?.periodic)).toBe(true)
    draft.dispose(); runtime.dispose()
  })

  it('keeps stable immutable snapshots through a panel unsubscribe and protects input ownership', async () => {
    const { worker, runtime, draft } = setup()
    const input = plane(), updates = vi.fn()
    const unsubscribe = draft.subscribe(updates)
    expect(draft.getSnapshot()).toBe(draft.getSnapshot())
    draft.install(input, { trimLocks: [1] })
    expect(updates).toHaveBeenCalled()
    input.poles[12][2] = 45
    expect(draft.getSnapshot().net?.poles[12][2]).toBe(0)
    expect(Object.isFrozen(draft.getSnapshot().net?.poles[12])).toBe(true)
    expect(draft.getSnapshot().net).toBe(runtime.history.current?.net)
    unsubscribe()
    const oldCalls = updates.mock.calls.length
    await vi.advanceTimersByTimeAsync(90)
    worker.reply(worker.sent[0].id, cadPreview(1)); await flush()
    const reopened = draft.getSnapshot()
    expect(updates).toHaveBeenCalledTimes(oldCalls)
    expect(reopened.validNet).toBe(reopened.net)
    expect(reopened.preview?.previewRevision).toBe(1)
    expect(reopened).toBe(draft.getSnapshot())
    draft.dispose(); runtime.dispose()
  })

  it('previews a moving point without history and never validates an older worker reply', async () => {
    const { worker, runtime, draft } = setup()
    draft.install(plane())
    await vi.advanceTimersByTimeAsync(90)
    const oldId = worker.sent[0].id
    const inMotion = moved(draft.getSnapshot().net!, 12, 0.2)
    draft.preview(inMotion)
    inMotion.poles[12][2] = 9
    expect(draft.getSnapshot().net?.poles[12][2]).toBe(0.2)
    expect(runtime.history.canUndo).toBe(false)
    worker.reply(oldId, cadPreview(1)); await flush()
    expect(draft.getSnapshot().validNet).toBeNull()
    expect(draft.getSnapshot().previewStale).toBe(true)
    expect(worker.sent).toHaveLength(2)
    worker.reply(worker.sent[1].id, cadPreview(2)); await flush()
    expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    expect(draft.getSnapshot().previewStale).toBe(false)
    draft.commit()
    expect(runtime.history.canUndo).toBe(true)
    expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    expect(worker.sent).toHaveLength(2)
    expect(draft.undo()).toBe(true)
    expect(draft.getSnapshot().validNet).toBeNull()
    expect(draft.getSnapshot().net?.poles[12][2]).toBe(0)
    expect(draft.redo()).toBe(true)
    expect(draft.getSnapshot().net?.poles[12][2]).toBe(0.2)
    draft.dispose(); runtime.dispose()
  })

  it('coalesces draft updates and ignores stale success and stale failure', async () => {
    const { worker, runtime, draft } = setup()
    draft.install(plane())
    await vi.advanceTimersByTimeAsync(90)
    draft.preview(moved(draft.getSnapshot().net!, 12, 0.1))
    draft.preview(moved(draft.getSnapshot().net!, 12, 0.2))
    worker.reject(worker.sent[0].id, 'errore vecchio'); await flush()
    expect(draft.getSnapshot().error).toBe('')
    expect(worker.sent).toHaveLength(2)
    expect(worker.sent[1].net.poles[12][2]).toBe(0.2)
    worker.reject(worker.sent[1].id, 'errore corrente'); await flush()
    expect(draft.getSnapshot().error).toBe('errore corrente')
    expect(draft.getSnapshot().validNet).toBeNull()
    draft.dispose(); runtime.dispose()
  })

  it('shares runtime history for locks, continuity, undo, redo and protected borders', async () => {
    const { worker, runtime, draft } = setup()
    draft.install(plane(), { continuity: 'G0', trimLocks: [7] })
    await vi.advanceTimersByTimeAsync(90)
    worker.reply(worker.sent[0].id, cadPreview(1)); await flush()
    draft.setSelection([12, 13, 12])
    expect(draft.getSnapshot().selected).toEqual([12, 13])
    draft.setLocks([13, 12, 12])
    expect(draft.getSnapshot().locks).toEqual([12, 13])
    expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    expect(worker.sent).toHaveLength(1)
    expect(() => draft.preview(moved(draft.getSnapshot().net!, 12, 1))).toThrow('bloccato')
    expect(() => draft.preview(moved(draft.getSnapshot().net!, 7, 1))).toThrow('bloccato')
    expect(draft.undo()).toBe(true)
    expect(draft.getSnapshot().locks).toEqual([])
    expect(draft.redo()).toBe(true)
    draft.setLocks([])
    draft.setContinuity('G0')
    draft.commit(moved(draft.getSnapshot().net!, 6, 0.2))
    expect(() => draft.setContinuity('G1')).toThrow('protetto')
    draft.setFreeBoundary(true)
    expect(() => draft.setContinuity('G1')).toThrow('bordi')
    draft.commit(moved(draft.getSnapshot().net!, 0, 0.3))
    expect(() => draft.setFreeBoundary(false)).toThrow('protetto')
    draft.dispose(); runtime.dispose()
  })

  it('drops invalidated work on reset, reinstallation, and disposal without disposing the runtime', async () => {
    const { worker, runtime, draft } = setup()
    draft.install(plane())
    await vi.advanceTimersByTimeAsync(90)
    const stale = worker.sent[0].id
    draft.reset()
    worker.reply(stale, cadPreview(1)); await flush()
    expect(draft.getSnapshot()).toMatchObject({ net: null, preview: null, validNet: null, calculating: false })
    draft.install(plane())
    await vi.advanceTimersByTimeAsync(90)
    const pending = worker.sent[1].id
    const late = worker.onmessage
    draft.dispose()
    expect(runtime.active).toBe(true)
    expect(runtime.history.current).toBeUndefined()
    expect(runtime.previews.getSnapshot().preview).toBeNull()
    late?.({ data: { id: pending, result: cadPreview(2) } } as MessageEvent<unknown>)
    await flush()
    expect(draft.getSnapshot()).toMatchObject({ net: null, preview: null, validNet: null })
    expect(() => draft.install(plane())).toThrow('chiuso')
    expect(worker.terminate).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('restores the original geometry while keeping locks and undo available', () => {
    const { runtime, draft } = setup()
    draft.install(plane())
    draft.commit(moved(draft.getSnapshot().net!, 12, 0.5))
    draft.setLocks([12])
    draft.restoreOriginal()
    expect(draft.getSnapshot().net?.poles[12][2]).toBe(0)
    expect(draft.getSnapshot().locks).toEqual([12])
    expect(draft.undo()).toBe(true)
    expect(draft.getSnapshot().net?.poles[12][2]).toBe(0.5)
    expect(draft.getSnapshot().locks).toEqual([12])
    draft.dispose(); runtime.dispose()
  })

  it('adopts a verified STEP preview revision without scheduling a second authority', async () => {
    const { worker, runtime, draft } = setup()
    draft.install(plane())
    await vi.advanceTimersByTimeAsync(90)
    worker.reply(worker.sent[0].id, cadPreview(1)); await flush()
    const evaluation = draft.evaluateForExport()
    const result = { ...cadPreview(2), step: 'STEP content' }
    worker.reply(worker.sent[1].id, result)
    await expect(evaluation).resolves.toMatchObject({ previewRevision: 2, step: 'STEP content' })
    expect(draft.getSnapshot().preview?.previewRevision).toBe(2)
    expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    draft.setLocks([12])
    expect(draft.getSnapshot().preview?.previewRevision).toBe(2)
    expect(worker.sent).toHaveLength(2)
    draft.dispose(); runtime.dispose()
  })

  it('rejects a late STEP evaluation after the geometric draft changes', async () => {
    const { worker, runtime, draft } = setup()
    draft.install(plane())
    await vi.advanceTimersByTimeAsync(90)
    worker.reply(worker.sent[0].id, cadPreview(1)); await flush()
    const evaluation = draft.evaluateForExport()
    const rejected = expect(evaluation).rejects.toThrow('bozza è cambiata')
    draft.preview(moved(draft.getSnapshot().net!, 12, .3))
    worker.reply(worker.sent[1].id, { ...cadPreview(2), step: 'STEP content' })
    await rejected
    expect(draft.getSnapshot().validNet).toBeNull()
    expect(draft.getSnapshot().preview?.previewRevision).not.toBe(2)
    draft.dispose(); runtime.dispose()
  })

  it('rejects late STEP responses after changing continuity or disposing the session', async () => {
    const { worker, runtime, draft } = setup()
    draft.install(plane())
    await vi.advanceTimersByTimeAsync(90)
    worker.reply(worker.sent[0].id, cadPreview(1)); await flush()
    const modeEvaluation = draft.evaluateForExport()
    const changed = expect(modeEvaluation).rejects.toThrow('bozza è cambiata')
    draft.setContinuity('G0')
    worker.reply(worker.sent[1].id, { ...cadPreview(2), step: 'STEP content' })
    await changed
    expect(draft.getSnapshot().validNet).toBeNull()
    await vi.advanceTimersByTimeAsync(90)
    worker.reply(worker.sent[2].id, cadPreview(3)); await flush()
    const disposedEvaluation = draft.evaluateForExport()
    const disposed = expect(disposedEvaluation).rejects.toThrow('Editor chiuso')
    draft.dispose()
    worker.reply(worker.sent[3].id, { ...cadPreview(4), step: 'STEP content' })
    await disposed
    expect(draft.getSnapshot()).toMatchObject({ net: null, preview: null, validNet: null })
    runtime.dispose()
  })

  it('cannot attach an old face preview after a different face has been installed', async () => {
    const { worker, runtime, draft } = setup()
    draft.install(plane())
    await vi.advanceTimersByTimeAsync(90)
    const oldId = worker.sent[0].id
    draft.reset({ preserveContinuity: true })
    const next = plane(); next.poles[12][2] = 8
    draft.install(next)
    worker.reply(oldId, cadPreview(11)); await flush()
    expect(draft.getSnapshot().preview?.previewRevision).not.toBe(11)
    expect(draft.getSnapshot().validNet).toBeNull()
    expect(worker.sent).toHaveLength(2)
    worker.reply(worker.sent[1].id, cadPreview(12)); await flush()
    expect(draft.getSnapshot().preview?.previewRevision).toBe(12)
    expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    draft.dispose(); runtime.dispose()
  })

  it('prevents two controllers from taking authority over one runtime', () => {
    const { runtime, draft } = setup()
    expect(() => new SurfaceDraft(runtime)).toThrow('già controllata')
    draft.dispose()
    const replacement = new SurfaceDraft(runtime)
    replacement.dispose()
    runtime.dispose()
  })
})

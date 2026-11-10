// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Net } from '../brep'
import { changeSurfaceFace } from '../faceSelection'
import { SurfaceDraft } from '../surfaceDraft'
import { SurfaceRuntime } from '../surfaceRuntime'
import { SurfaceWorkerRequestError } from '../workerClient'

class WorkerStub {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  sent: { id: number; action: string }[] = []
  postMessage(message: { id: number; action: string }) { this.sent.push(message) }
  terminate() {}
  reply(result?: unknown, error?: string) {
    this.onmessage?.({ data: { id: this.sent.at(-1)!.id, result, error } } as MessageEvent)
  }
}
function net(): Net {
  const poles: Net['poles'] = Array.from({ length: 25 }, (_, i) => [Math.floor(i / 5), i % 5, 0])
  return { nu: 5, nv: 5, du: 3, dv: 3, poles, weights: poles.map(() => 1),
    rational: [0, 0], ku: [0, .5, 1], kv: [0, .5, 1], mu: [4, 1, 4], mv: [4, 1, 4] }
}
afterEach(() => vi.useRealTimers())

describe('autonomous dialog face transition', () => {
  it('retains the exact edited draft, history, note text and preview on a CAD refusal; replaces them only after success', async () => {
    vi.useFakeTimers()
    const worker = new WorkerStub(), runtime = new SurfaceRuntime(() => worker as unknown as Worker)
    const draft = new SurfaceDraft(runtime)
    try {
      draft.install(net())
      const edited = structuredClone(draft.getSnapshot().net!)
      edited.poles[12][2] = .2
      draft.commit(edited); draft.setSelection([12]); draft.setLocks([12])
      await vi.advanceTimersByTimeAsync(90)
      worker.reply({ valid: true, previewRevision: 1, mesh: {}, faceMeshes: [], volume: 1, maxBoundaryError: 0, minimumNormalDot: 1 })
      await vi.advanceTimersByTimeAsync(90)
      if (draft.getSnapshot().calculating) {
        worker.reply({ valid: true, previewRevision: 2, mesh: {}, faceMeshes: [], volume: 1, maxBoundaryError: 0, minimumNormalDot: 1 })
        await vi.advanceTimersByTimeAsync(90)
      }
      const before = draft.getSnapshot(), history = runtime.history.current
      const notes = [{ text: 'Nota da conservare', anchor: { u: .5, v: .5 } }]
      let currentNotes = notes, face = 0
      const options = {
        select: () => runtime.worker.ask<Net>({ action: 'select', face: 1 }), current: () => true,
        install: (n: Net) => { draft.install(n); face = 1; currentNotes = [] },
        invalidate: () => { draft.reset(); face = -1 },
      }
      const refused = changeSurfaceFace(options)
      const rejection = expect(refused).rejects.toBeInstanceOf(SurfaceWorkerRequestError)
      // Pending selection has no destructive effect either.
      expect(draft.getSnapshot()).toBe(before); expect(currentNotes).toBe(notes)
      worker.reply(undefined, 'conversione non qualificabile')
      await rejection
      expect(draft.getSnapshot()).toBe(before)
      expect(before.validNet).toBe(before.net)
      expect(before.canUndo).toBe(true)
      expect(runtime.history.current).toBe(history)
      expect(currentNotes).toBe(notes); expect(face).toBe(0)
      const accepted = changeSurfaceFace(options)
      worker.reply(net()); await accepted
      expect(face).toBe(1); expect(currentNotes).toEqual([])
      expect(draft.getSnapshot().canUndo).toBe(false)
      expect(draft.getSnapshot().validNet).toBeNull()
    } finally { draft.dispose(); runtime.dispose() }
  })

  it.each(['transport', 'local install'])('invalidates an uncertain selection after %s failure', async kind => {
    const invalidate = vi.fn(), failure = new Error(kind)
    const install = vi.fn(() => { if (kind === 'local install') throw failure })
    await expect(changeSurfaceFace({
      select: () => kind === 'transport' ? Promise.reject(failure) : Promise.resolve(net()),
      current: () => true, install, invalidate,
    })).rejects.toBe(failure)
    expect(invalidate).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledTimes(kind === 'transport' ? 0 : 1)
  })

  it('does not mistake even a typed local install error for a select refusal', async () => {
    const invalidate = vi.fn(), failure = new SurfaceWorkerRequestError('local')
    await expect(changeSurfaceFace({ select: () => Promise.resolve(net()), current: () => true,
      install: () => { throw failure }, invalidate })).rejects.toBe(failure)
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it.each([true, false])('ignores a superseded response (success=%s)', async success => {
    const install = vi.fn(), invalidate = vi.fn()
    const result = changeSurfaceFace({
      select: () => success ? Promise.resolve(net()) : Promise.reject(new Error('lost')),
      current: () => false, install, invalidate,
    })
    if (success) await result; else await expect(result).rejects.toThrow('lost')
    expect(install).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled()
  })
})

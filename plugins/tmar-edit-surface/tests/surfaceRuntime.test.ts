// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Net } from '../brep'
import { SurfaceRuntime } from '../surfaceRuntime'

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  sent: { id: number; action: string }[] = []
  postMessage(message: { id: number; action: string }) { this.sent.push(message) }
  terminate = vi.fn()
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>) }
}
const net: Net = { nu: 2, nv: 2, du: 1, dv: 1, poles: [[0,0,0],[0,1,0],[1,0,0],[1,1,0]],
  weights: [1,1,1,1], rational: [0,0], ku: [0,1], kv: [0,1], mu: [2,2], mv: [2,2] }
afterEach(() => vi.useRealTimers())

describe('SurfaceRuntime', () => {
  it('retains the worker, draft history and preview when a panel observer detaches', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const runtime = new SurfaceRuntime(() => worker as unknown as Worker)
    runtime.history.commit({ net, locks: [], continuity: 'G1', freeBoundary: false })
    const updates = vi.fn()
    const detach = runtime.previews.subscribe(updates)
    runtime.previews.schedule({ net, continuity: 'G1', freeBoundary: false, epoch: 0 })
    detach()
    await vi.advanceTimersByTimeAsync(90)
    expect(worker.sent).toHaveLength(1)
    expect(worker.sent[0].action).toBe('evaluate')
    worker.reply({ id: worker.sent[0].id, result: { valid: true, volume: 10 } })
    await Promise.resolve(); await Promise.resolve()
    expect(runtime.history.current?.net).toEqual(net)
    expect(runtime.previews.getSnapshot().preview?.value).toMatchObject({ valid: true, volume: 10 })
    expect(runtime.previews.getSnapshot().validRevision).toBe(runtime.previews.getSnapshot().current?.revision)
    expect(worker.terminate).not.toHaveBeenCalled()
    runtime.dispose()
  })
  it('disposes once, rejects pending work and ignores late replies', async () => {
    const worker = new FakeWorker()
    const runtime = new SurfaceRuntime(() => worker as unknown as Worker)
    const pending = runtime.worker.ask({ action: 'select', face: 0 })
    const rejected = expect(pending).rejects.toThrow('Editor chiuso')
    const late = worker.onmessage
    expect(runtime.active).toBe(true)
    runtime.dispose(); runtime.dispose()
    expect(runtime.active).toBe(false)
    await rejected
    late?.({ data: { id: 1, result: 'late' } } as MessageEvent<unknown>)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(runtime.previews.getSnapshot().disposed).toBe(true)
    expect(runtime.history.current).toBeUndefined()
  })
})

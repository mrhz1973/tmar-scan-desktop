// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import { SurfaceWorkerClient } from '../workerClient'

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  sent: { id: number; action: string }[] = []
  postMessage = vi.fn((message: { id: number; action: string }) => { this.sent.push(message) })
  terminate = vi.fn()
  reply(data: unknown): void { this.onmessage?.({ data } as MessageEvent<unknown>) }
  fail(message: string): void { this.onerror?.({ message, preventDefault: () => {} } as ErrorEvent) }
  unreadable(): void { this.onmessageerror?.({} as MessageEvent<unknown>) }
}

function create() {
  const worker = new FakeWorker()
  const factory = vi.fn(() => worker as unknown as Worker)
  return { worker, factory, client: new SurfaceWorkerClient(factory) }
}

describe('SurfaceWorkerClient', () => {
  it('matches out-of-order answers by id and keeps an ordinary CAD error local to its request', async () => {
    const { worker, client } = create()
    const opened = client.ask<string>({ action: 'open', step: 'STEP' })
    const face = client.ask<number>({ action: 'select', face: 4 })
    expect(worker.sent).toEqual([{ id: 1, action: 'open', step: 'STEP' }, { id: 2, action: 'select', face: 4 }])
    worker.reply({ id: 2, result: 42 })
    worker.reply({ id: 999, result: 'unrelated' })
    worker.reply({ id: 1, result: 'opened' })
    await expect(face).resolves.toBe(42)
    await expect(opened).resolves.toBe('opened')

    const bad = client.ask({ action: 'select', face: 9 })
    const next = client.ask<string>({ action: 'open', step: 'other' })
    const rejected = expect(bad).rejects.toThrow('faccia non valida')
    worker.reply({ id: 3, error: 'faccia non valida' })
    worker.reply({ id: 4, result: 'other opened' })
    await rejected
    await expect(next).resolves.toBe('other opened')
    client.dispose()
  })

  it('does not send already-aborted requests and ignores late replies after an abort', async () => {
    const { worker, client } = create()
    const already = new AbortController()
    already.abort()
    await expect(client.ask({ action: 'select', face: 1 }, already.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.sent).toEqual([])

    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const aborted = client.ask({ action: 'select', face: 2 }, controller.signal)
    const rejection = expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    worker.reply({ id: 1, result: 'late' })
    const live = client.ask<string>({ action: 'open', step: 'still alive' })
    worker.reply({ id: 2, result: 'done' })
    await expect(live).resolves.toBe('done')
    client.dispose()
  })

  it('removes an abort listener after a successful reply', async () => {
    const { worker, client } = create()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const answer = client.ask<string>({ action: 'open', step: 'STEP' }, controller.signal)
    worker.reply({ id: 1, result: 'done' })
    await expect(answer).resolves.toBe('done')
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    controller.abort()
    client.dispose()
  })

  it('releases all waiters on worker failure, notifies once, and never restarts implicitly', async () => {
    const { worker, client, factory } = create()
    const onFailure = vi.fn()
    client.onFailure = onFailure
    const a = client.ask({ action: 'open', step: 'one' })
    const b = client.ask({ action: 'select', face: 0 })
    const rejectedA = expect(a).rejects.toThrow('Motore CAD interrotto')
    const rejectedB = expect(b).rejects.toThrow('Motore CAD interrotto')
    const late = worker.onmessage
    worker.fail('test failure')
    await Promise.all([rejectedA, rejectedB])
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure.mock.calls[0][0].message).toContain('test failure')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    late?.({ data: { id: 1, result: 'late' } } as MessageEvent<unknown>)
    await expect(client.ask({ action: 'select', face: 1 })).rejects.toThrow('Motore CAD interrotto')
    client.dispose(); client.dispose()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('treats an unreadable worker message as terminal failure', async () => {
    const { worker, client } = create()
    const onFailure = vi.fn()
    client.onFailure = onFailure
    const answer = client.ask({ action: 'select', face: 0 })
    const rejection = expect(answer).rejects.toThrow('non leggibile')
    worker.unreadable()
    await rejection
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    await expect(client.ask({ action: 'select', face: 1 })).rejects.toThrow('non leggibile')
  })

  it('dispose rejects pending work once without reporting worker failure', async () => {
    const { worker, client } = create()
    const onFailure = vi.fn()
    client.onFailure = onFailure
    const answer = client.ask({ action: 'select', face: 0 })
    const rejection = expect(answer).rejects.toThrow('Editor chiuso')
    client.dispose(); client.dispose()
    await rejection
    await expect(client.ask({ action: 'select', face: 1 })).rejects.toThrow('Editor chiuso')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('cleans up a request when posting fails without killing an otherwise usable worker', async () => {
    const { worker, client } = create()
    worker.postMessage.mockImplementationOnce(() => { throw new Error('clone failed') })
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    await expect(client.ask({ action: 'open', step: 'bad' }, controller.signal)).rejects.toThrow('clone failed')
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    const answer = client.ask<string>({ action: 'open', step: 'good' })
    worker.reply({ id: 2, result: 'done' })
    await expect(answer).resolves.toBe('done')
    expect(worker.terminate).not.toHaveBeenCalled()
    client.dispose()
  })
})

// Keep request payloads discriminated at compile time; do not run invalid calls.
if (false) {
  const client = new SurfaceWorkerClient()
  // @ts-expect-error select needs a face index
  void client.ask({ action: 'select', step: 'wrong' })
  // @ts-expect-error open needs a STEP string
  void client.ask({ action: 'open', face: 1 })
}

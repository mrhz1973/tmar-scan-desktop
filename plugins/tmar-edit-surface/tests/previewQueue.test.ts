// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewQueue } from '../previewQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => vi.useRealTimers())

describe('PreviewQueue', () => {
  it('coalesces drafts behind the first 90 ms timer without starvation', async () => {
    vi.useFakeTimers()
    const evaluate = vi.fn(async (draft: string) => `CAD:${draft}`)
    const queue = new PreviewQueue({ evaluate })

    queue.schedule('a')
    await vi.advanceTimersByTimeAsync(70)
    queue.schedule('b')
    await vi.advanceTimersByTimeAsync(19)
    expect(evaluate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(evaluate).toHaveBeenCalledWith('b')
    expect(queue.getSnapshot().preview?.value).toBe('CAD:b')
    expect(queue.getSnapshot().validRevision).toBe(queue.getSnapshot().current?.revision)
    expect(queue.getSnapshot().calculating).toBe(false)
    queue.schedule('next')
    expect(queue.getSnapshot().preview?.stale).toBe(true)
    expect(queue.getSnapshot().validRevision).toBeNull()
    queue.dispose()
  })

  it('serializes evaluations and evaluates only the latest draft accumulated in flight', async () => {
    vi.useFakeTimers()
    const first = deferred<string>()
    const second = deferred<string>()
    let active = 0
    let maxActive = 0
    const seen: string[] = []
    const evaluate = vi.fn(async (draft: string) => {
      active++
      maxActive = Math.max(maxActive, active)
      seen.push(draft)
      try { return await (draft === 'first' ? first.promise : second.promise) }
      finally { active-- }
    })
    const queue = new PreviewQueue({ evaluate })

    queue.schedule('first')
    await vi.advanceTimersByTimeAsync(90)
    expect(seen).toEqual(['first'])
    queue.schedule('middle')
    queue.schedule('latest')

    first.resolve('preview:first')
    await flush()
    expect(seen).toEqual(['first', 'latest'])
    expect(maxActive).toBe(1)
    expect(queue.getSnapshot().preview).toMatchObject({ value: 'preview:first', stale: true })
    expect(queue.getSnapshot().validRevision).toBeNull()

    second.resolve('preview:latest')
    await flush()
    expect(queue.getSnapshot().preview).toMatchObject({ value: 'preview:latest', stale: false })
    expect(queue.getSnapshot().validRevision).toBe(queue.getSnapshot().current?.revision)
    expect(queue.getSnapshot().calculating).toBe(false)
    queue.dispose()
  })

  it('does not publish stale failures or let a stale success clear a current error', async () => {
    vi.useFakeTimers()
    const old = deferred<string>()
    const current = deferred<string>()
    const queue = new PreviewQueue({
      evaluate: (draft: string) => draft === 'old' ? old.promise : current.promise,
    })

    queue.schedule('old')
    await vi.advanceTimersByTimeAsync(90)
    queue.schedule('current')
    old.reject(new Error('old CAD failure'))
    await flush()
    expect(queue.getSnapshot().error).toBeNull()

    current.reject(new Error('current CAD failure'))
    await flush()
    const currentError = queue.getSnapshot().error
    expect(currentError?.error).toMatchObject({ message: 'current CAD failure' })
    expect(currentError?.identity).toBe('current')

    // Once a newer error is recorded, explicitly deliver an older completion
    // through a separate queue generation and verify it cannot become current.
    const oldCompletion = deferred<string>()
    const freshFailure = deferred<string>()
    const q = new PreviewQueue({ evaluate: (draft: string) => draft === 'a' ? oldCompletion.promise : freshFailure.promise })
    q.schedule('a')
    await vi.advanceTimersByTimeAsync(90)
    q.schedule('b')
    oldCompletion.resolve('stale visual')
    await flush()
    freshFailure.reject(new Error('newer error'))
    await flush()
    const newerError = q.getSnapshot().error
    expect(newerError?.identity).toBe('b')
    expect(q.getSnapshot().preview).toMatchObject({ value: 'stale visual', stale: true })
    expect(q.getSnapshot().error).toBe(newerError)
    queue.dispose()
    q.dispose()
  })

  it('invalidate advances the epoch and ignores pending and in-flight results', async () => {
    vi.useFakeTimers()
    const pending = deferred<string>()
    const evaluate = vi.fn(() => pending.promise)
    const queue = new PreviewQueue({ evaluate })

    queue.schedule('not-started')
    queue.invalidate()
    await vi.advanceTimersByTimeAsync(100)
    expect(evaluate).not.toHaveBeenCalled()
    expect(queue.getSnapshot().epoch).toBe(1)
    expect(queue.getSnapshot().current).toBeNull()

    queue.schedule('in-flight')
    await vi.advanceTimersByTimeAsync(90)
    const previewBefore = queue.getSnapshot().preview
    queue.invalidate()
    expect(queue.getSnapshot().calculating).toBe(false)
    pending.resolve('obsolete CAD')
    await flush()
    expect(queue.getSnapshot().preview).toBe(previewBefore)
    expect(queue.getSnapshot().validRevision).toBeNull()
    expect(queue.getSnapshot().current).toBeNull()
    expect(queue.getSnapshot().calculating).toBe(false)
    queue.dispose()
  })

  it('dispose is idempotent and discards delayed and late worker responses', async () => {
    vi.useFakeTimers()
    const pending = deferred<string>()
    const evaluate = vi.fn(() => pending.promise)
    const queue = new PreviewQueue({ evaluate })
    const listener = vi.fn()
    queue.subscribe(listener)

    queue.schedule('draft')
    queue.dispose()
    const afterDispose = queue.getSnapshot()
    queue.dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(evaluate).not.toHaveBeenCalled()
    expect(queue.getSnapshot()).toBe(afterDispose)
    expect(queue.schedule('ignored')).toBeNull()

    const another = new PreviewQueue({ evaluate: () => pending.promise })
    another.schedule('started')
    await vi.advanceTimersByTimeAsync(90)
    another.dispose()
    pending.resolve('late')
    await flush()
    expect(another.getSnapshot().preview).toBeNull()
    expect(another.getSnapshot().validRevision).toBeNull()
    expect(another.getSnapshot().disposed).toBe(true)
    expect(listener).toHaveBeenCalled()
  })
})

it('can discard the previous preview when changing source documents', async () => {
  vi.useFakeTimers()
  const queue = new PreviewQueue({ evaluate: async (draft: string) => draft })
  queue.schedule('old document')
  await vi.advanceTimersByTimeAsync(90)
  expect(queue.getSnapshot().preview?.value).toBe('old document')
  queue.invalidate({ clearPreview: true })
  expect(queue.getSnapshot().preview).toBeNull()
  expect(queue.getSnapshot().validRevision).toBeNull()
  queue.dispose()
})

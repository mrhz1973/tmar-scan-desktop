// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecoveryStorage } from '../src/app/recoveryStorage'

interface PendingOpen {
  result: IDBDatabase
  error: DOMException | null
  onblocked?: () => void
  onsuccess?: () => void
  onerror?: () => void
}

function setup() {
  const requests: PendingOpen[] = []
  const indexedOpen = vi.fn(() => {
    const request: PendingOpen = { result: undefined as unknown as IDBDatabase, error: null }
    requests.push(request)
    return request
  })
  vi.stubGlobal('indexedDB', { open: indexedOpen })
  const storage = new RecoveryStorage('session-test')
  const connect = () => (storage as unknown as { open: () => Promise<IDBDatabase> }).open()
  return { requests, indexedOpen, storage, connect }
}

afterEach(() => vi.unstubAllGlobals())

describe('local recovery IndexedDB opening', () => {
  it('retries after a blocked request and closes that request if it later succeeds', async () => {
    const { requests, indexedOpen, storage, connect } = setup()
    const first = connect()
    requests[0].onblocked?.()
    await expect(first).rejects.toThrow('blocked by another page')

    const retry = connect()
    expect(indexedOpen).toHaveBeenCalledTimes(2)
    const obsolete = { close: vi.fn() } as unknown as IDBDatabase
    requests[0].result = obsolete
    requests[0].onsuccess?.()
    expect(obsolete.close).toHaveBeenCalledTimes(1)

    const current = { close: vi.fn(), onversionchange: null } as unknown as IDBDatabase
    requests[1].result = current
    requests[1].onsuccess?.()
    await expect(retry).resolves.toBe(current)
    expect(connect()).toBe(retry)
    storage.close()
    await Promise.resolve()
    expect(current.close).toHaveBeenCalledTimes(1)
  })

  it('does not retain a rejected open after an IndexedDB error', async () => {
    const { requests, indexedOpen, storage, connect } = setup()
    const first = connect()
    requests[0].error = new DOMException('storage unavailable', 'UnknownError')
    requests[0].onerror?.()
    await expect(first).rejects.toThrow('storage unavailable')

    const retry = connect()
    expect(indexedOpen).toHaveBeenCalledTimes(2)
    const db = { close: vi.fn(), onversionchange: null } as unknown as IDBDatabase
    requests[1].result = db
    requests[1].onsuccess?.()
    await expect(retry).resolves.toBe(db)
    storage.close()
    await Promise.resolve()
    expect(db.close).toHaveBeenCalledTimes(1)
  })
})

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { ReClient, type ReTransport } from '../core/reClient'
import type { BuiltBody } from '../core/buildTypes'
import type { ReWorkerRequest } from '../core/reService'

function fixture() {
  let generation = 0, release: (() => void) | undefined
  let held = false, wrongBody = false
  const asks: { type: string; limitMs?: number }[] = []
  const body = (): BuiltBody => ({
    id: 1, key: `kernel.${generation}`, name: 'Sheet', faces: 1, surface: true, closed: false,
    volume: 0, triangles: 0, box: null, topology: { faces: [], edges: [] },
    mesh: { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) },
  })
  const transport: ReTransport = {
    onFailure: null, dispose() {},
    async request<T>(raw: { requestId: number }, _transfer: Transferable[], limitMs?: number): Promise<T> {
      const msg = raw as ReWorkerRequest
      asks.push({ type: msg.type, limitMs })
      if (msg.type === 'build') {
        generation++
        const b = body()
        return { type: 'build-ok', requestId: msg.requestId, results: [], bodies: [b], all: [b], steps: { recomputed: 0, restored: 0, played: [] } } as T
      }
      if (msg.type !== 'body-edit-source') throw Error('Unexpected test request')
      const source = { bodyId: wrongBody ? 2 : 1, bodyKey: msg.expectedKey, text: 'test payload', faces: 1, surface: true, closed: false }
      if (held) await new Promise<void>(resolve => { release = resolve })
      return { type: 'body-edit-source-ok', requestId: msg.requestId, source } as T
    },
  }
  const client = new ReClient(transport)
  return { client, asks, hold: () => { held = true }, wrong: () => { wrongBody = true }, release: () => release?.() }
}

describe('editor CAD source response guards', () => {
  it('requires a current body and limits the worker read', async () => {
    const f = fixture()
    await expect(f.client.bodyEditSource(1)).rejects.toThrow(/no current/)
    await f.client.build([], new Map())
    expect(await f.client.bodyEditSource(1)).toMatchObject({ bodyId: 1, bodyKey: 'kernel.1' })
    expect(f.asks.at(-1)).toEqual({ type: 'body-edit-source', limitMs: 300_000 })
  })
  it('refuses a mismatched caller key without asking the worker', async () => {
    const f = fixture(); await f.client.build([], new Map())
    await expect(f.client.bodyEditSource(1, 'old-key')).rejects.toThrow(/changed/)
    expect(f.asks).toHaveLength(1)
  })
  it('refuses an otherwise valid reply overtaken by a build', async () => {
    const f = fixture(); await f.client.build([], new Map()); f.hold()
    const result = expect(f.client.bodyEditSource(1)).rejects.toThrow(/changed while/)
    await f.client.build([], new Map()); f.release(); await result
  })
  it('refuses a response belonging to a different body', async () => {
    const f = fixture(); await f.client.build([], new Map()); f.wrong()
    await expect(f.client.bodyEditSource(1)).rejects.toThrow(/changed while/)
  })
})

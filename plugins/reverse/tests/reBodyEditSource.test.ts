// SPDX-License-Identifier: AGPL-3.0-only
// The real command/session/service/kernel path, with an independent STEP reader.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { refused, run, startHeadless, type Headless } from '../../../tests/commandKit'
import { useHistory } from '../../../src/state/historyStore'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import type { BodyEditSourceResult } from '../app/reBodyEditSource'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import { useNotes } from '../state/noteStore'
import plugin from '../plugin'
import { resetReverse } from './reReset'

let headless: Headless, session: ReverseSession, k: OcctKernel
let sheet: string, solid: string
const stops: (() => void)[] = []
beforeAll(async () => {
  plugin.install?.(); headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  k = await OcctKernel.init()
  const box = k.makeBox(20, 30, 10), faces = k.getSubShapes(box, 'face')
  try {
    solid = k.exportStep(box)
    const top = faces.find(f => { const b = k.getBoundingBox(f); return Math.abs(b.zmin - 10) < 1e-6 && Math.abs(b.zmax - 10) < 1e-6 })!
    sheet = k.exportStep(top)
  } finally { [...faces, box].forEach(h => k.release(h)) }
}, 120_000)
afterAll(() => { stops.forEach(stop => stop()); session.client()?.dispose(); headless.stop(); k[Symbol.dispose]() })
beforeEach(() => { resetReverse(); useNotes.getState().load([]) })
async function importBody(text = sheet) {
  await run('reverse.import.step', { bytes: new TextEncoder().encode(text), name: 'source.step' })
  return useReverse.getState().bodies[0].id
}
const read = (body: number) => run<BodyEditSourceResult>('reverse.body.edit_source', { body })
function measure(source: BodyEditSourceResult) {
  const shape = k.importStep(new TextDecoder().decode(source.file.bytes)), faces = k.getSubShapes(shape, 'face'), solids = k.getSubShapes(shape, 'solid')
  try { return { valid: k.isValid(shape), faces: faces.length, solids: solids.length, area: k.getSurfaceArea(shape), bounds: k.getBoundingBox(shape) } }
  finally { [...faces, ...solids, shape].forEach(h => k.release(h)) }
}

describe('explicit current CAD editor source', () => {
  it('reads a hidden ordinary sheet without changing export policy, features, notes or history', async () => {
    const body = await importBody()
    useReverse.getState().setBodiesVisible([body], false)
    useNotes.getState().load([{ id: 1, text: 'Keep this note', at: [10, 15, 10], on: [{ kind: 'scan' }] }])
    const before = useReverse.getState(), notes = useNotes.getState().notes, history = useHistory.getState()
    expect((await refused('reverse.export.step', { bodies: [body] })).message).toMatch(/no body to write/)
    const source = await read(body), measured = measure(source)
    expect(source.version).toBe(1)
    expect(source.source).toMatchObject({ bodyId: body, kind: 'surface', faces: 1, closed: false, units: 'mm', coordinateFrame: 'part' })
    expect(source.source.bodyKey).toBeTruthy()
    expect(measured).toMatchObject({ valid: true, faces: 1, solids: 0 })
    expect(measured.area).toBeCloseTo(600, 7)
    for (const key of ['features', 'stepFiles', 'parameters', 'hiddenBodies'] as const) expect(useReverse.getState()[key]).toBe(before[key])
    expect(useNotes.getState().notes).toBe(notes)
    expect(useHistory.getState().past).toBe(history.past)
    expect(useHistory.getState().future).toBe(history.future)
    expect((await refused('reverse.export.step', { bodies: [body] })).message).toMatch(/no body to write/)
  }, 60_000)

  it('reads the moved current sheet, not its import file, and refuses an obsolete key/version', async () => {
    const body = await importBody(), old = await read(body)
    await run('reverse.feature.add', { feature: { kind: 'moveBody', bodies: [body], translate: [40, 0, 0] } })
    const source = await read(body), measured = measure(source)
    expect(measured.bounds.xmin).toBeCloseTo(40, 6)
    expect(measured.bounds.xmax).toBeCloseTo(60, 6)
    expect(measured.area).toBeCloseTo(600, 7)
    expect(source.source.bodyKey).not.toBe(old.source.bodyKey)
    expect((await refused('reverse.body.edit_source', { body, expectedKey: old.source.bodyKey })).code).toBe('invalid_state')
    expect((await refused('reverse.body.edit_source', { body, expectedBuildVersion: old.source.buildVersion })).code).toBe('invalid_state')
    const again = await run<BodyEditSourceResult>('reverse.body.edit_source', { body, expectedKey: source.source.bodyKey, expectedBuildVersion: source.source.buildVersion })
    expect(measure(again).bounds.xmin).toBeCloseTo(40, 6)
  }, 60_000)

  it('still reads and generally exports a solid', async () => {
    const body = await importBody(solid), source = await read(body)
    expect(source.source).toMatchObject({ kind: 'solid', closed: true, faces: 6 })
    expect(measure(source)).toMatchObject({ valid: true, faces: 6, solids: 1 })
    const exported = await run<{ file: { bytes: Uint8Array } }>('reverse.export.step', { bodies: [body] })
    expect(exported.file.bytes.length).toBeGreaterThan(100)
  }, 60_000)

  it('requires one existing numeric current body, never all bodies or a name fallback', async () => {
    await importBody()
    expect((await refused('reverse.body.edit_source')).code).toBe('invalid_input')
    expect((await refused('reverse.body.edit_source', { body: 'source' })).code).toBe('invalid_input')
    expect((await refused('reverse.body.edit_source', { body: 999999 })).code).toBe('not_found')
  }, 60_000)

  it('rejects the reply when project CAD resources are replaced during the read', async () => {
    const body = await importBody(), client = session.client()!, original = client.bodyEditSource.bind(client)
    const spy = vi.spyOn(client, 'bodyEditSource').mockImplementationOnce(async (...args) => {
      const source = await original(...args)
      useReverse.setState(s => ({ stepFiles: { ...s.stepFiles } }))
      return source
    })
    try { expect((await refused('reverse.body.edit_source', { body })).code).toBe('invalid_state') }
    finally { spy.mockRestore() }
  }, 60_000)
})

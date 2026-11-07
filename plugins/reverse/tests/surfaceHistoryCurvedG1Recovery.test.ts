// SPDX-License-Identifier: AGPL-3.0-only
// Host-only experiment: genuine curved G1 v6 recipe, independent OCCT replay,
// archive Save/Reopen, then an OFF-SCREEN recovered editor. No public UI.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel } from '../../tmar-edit-surface/editorKernel'
import { replaceSurface, surfaceTable, type Net, type Point } from '../../tmar-edit-surface/brep'
import { refineClampedNet } from '../../tmar-edit-surface/refineClampedNet'
import { useReverse } from '../state/reStore'
import { useNotes } from '../state/noteStore'
import { useShell } from '../../../src/state/shellStore'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { createReverseEditorHost } from '../app/workspaceEditorHost'
import { qualifySurfaceHistory, withFrozenHistoryTransaction, type SurfaceHistoryReplay } from '../app/surfaceEditHistory'
import { prepareHostSurfaceHistoryRecovery } from '../app/surfaceHistoryRecovery'
import { collectReversePart, applyReversePart } from '../app/projectSection'
import { editorSha256 } from '../../../src/plugins/editorLifetime'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'
import plugin from '../plugin'
import type { ImportFeature } from '../core/features'

let headless: Headless, reverseSession: ReverseSession, editor: SurfaceEditorKernel
const stops: (() => void)[] = []
const enc = (s: string) => new TextEncoder().encode(s)

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  reverseSession = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(reverseSession), reverseSession.watch())
  editor = await SurfaceEditorKernel.load()
}, 120000)
afterAll(() => { stops.forEach(stop => stop()); reverseSession?.client()?.dispose(); headless?.stop(); editor?.dispose() })
beforeEach(() => { resetReverse(); useNotes.getState().load([]); useShell.getState().setWorkspace('reverse') })

function curvedSheetFixture() {
  const k = editor.kernel, owned: ShapeHandle[] = []
  const own = (shape: ShapeHandle): ShapeHandle => { owned.push(shape); return shape }
  const build = (start: number, curved: boolean) => {
    const p = [
      { x: start, y: 0, z: 0 }, { x: start + 10, y: 0, z: 0 },
      { x: start + 10, y: 10, z: 0 }, { x: start, y: 10, z: 0 },
    ]
    const outline = own(k.makeWire(p.map((a, i) => own(k.makeLineEdge(a, p[(i + 1) % 4])))))
    const seed = own(k.makeFace(outline)), text = k.toBREP(seed)
    const record = surfaceTable(text).find(item => item.kind === 1)!, b = k.uvBounds(seed)
    const poles: Point[] = [], q = [0, 0, .2, 0, 0], greville = [0, 1 / 6, .5, 5 / 6, 1]
    for (let u = 0; u < 4; u++) for (let v = 0; v < 5; v++)
      poles.push([start + 10 * u / 3, 10 * greville[v], curved ? (10 * u / 3) * q[v] : 0])
    const seedNet: Net = {
      nu: 4, nv: 5, du: 3, dv: 3, poles, weights: poles.map(() => 1), rational: [0, 0],
      ku: [b.uMin, b.uMax], kv: [b.vMin, (b.vMin + b.vMax) / 2, b.vMax], mu: [4, 4], mv: [4, 1, 4],
    }
    const net = refineClampedNet(seedNet, [{ axis: 'U', value: (b.uMin + b.uMax) / 2, count: 1 }])
    const support = own(k.fromBREP(replaceSurface(text, record, net)))
    const border = (ids: number[], axis: 'u' | 'v') => {
      const points = ids.map(i => net.poles[i]), a = points[0], end = points.at(-1)!
      const d = end.map((x, i) => x - a[i]), len = Math.hypot(...d)
      const straight = points.every(point => Math.hypot(...point.map((x, i) =>
        x - a[i] - d[i] / len * point.reduce((s, y, j) => s + (y - a[j]) * d[j] / len, 0))) < 1e-9)
      return straight
        ? own(k.makeLineEdge({ x: a[0], y: a[1], z: a[2] }, { x: end[0], y: end[1], z: end[2] }))
        : own(k.makeBSplineEdge(points.flat(), ids.map(i => net.weights[i]),
          axis === 'u' ? net.ku : net.kv, axis === 'u' ? net.mu : net.mv, 3))
    }
    const wire = own(k.makeWire([
      border([0, 5, 10, 15, 20], 'u'), border([20, 21, 22, 23, 24], 'v'),
      border([24, 19, 14, 9, 4], 'u'), border([4, 3, 2, 1, 0], 'v'),
    ]))
    return own(k.fixShape(own(k.makeFaceOnSurface(support, wire))))
  }
  try {
    const selected = build(0, false), support = build(10, true)
    const p = [
      { x: -10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 }, { x: -10, y: 10, z: 0 },
    ]
    const thirdEdges = p.map((a, i) => own(k.makeLineEdge(a, p[(i + 1) % 4])))
    const third = own(k.makeFace(own(k.makeWire(thirdEdges))))
    const shell = own(k.sew([selected, support, third], 1e-7))
    const step = k.exportStep(shell)
    return { step, release: () => owned.reverse().forEach(shape => k.release(shape)) }
  } catch (error) {
    owned.reverse().forEach(shape => k.release(shape))
    throw error
  }
}

it('recovers a real OCCT compatible-B-spline G1 v6 feature from the saved Reverse archive, off screen', async () => {
  const fixture = curvedSheetFixture()
  try {
    await run('reverse.import.step', { bytes: enc(fixture.step), name: 'curved-g1-upstream.step' })
    const bodyId = useReverse.getState().bodies[0]?.id
    expect(bodyId).toBeDefined()
    const ctrl = new AbortController()
    const source = await createReverseEditorHost().readSource(bodyId!, ctrl.signal)
    const upstream = new TextDecoder().decode(source.step)
    const opened = editor.open(upstream)
    expect(opened.faces).toHaveLength(3)
    const k = editor.kernel, shape = k.importStep(upstream), faces = k.getSubShapes(shape, 'face')
    let selectedFace = -1, supportFace = -1
    try {
      faces.forEach((face, index) => {
        const b = k.uvBounds(face), p = k.pointOnSurface(face, (b.uMin + b.uMax) / 2, (b.vMin + b.vMax) / 2)
        if (p.x > 0 && p.x < 10) selectedFace = index
        if (p.x > 10 && p.z > .1) supportFace = index
      })
    } finally { faces.forEach(f => k.release(f)); k.release(shape) }
    expect(selectedFace).toBeGreaterThanOrEqual(0)
    expect(supportFace).toBeGreaterThanOrEqual(0)
    const net = editor.select(selectedFace)
    const choices = await editor.g1CurvedSupportCandidates()
    const choice = choices.candidates.find(c => c.kind === 'compatible-bspline' && c.supportFaceIndex === supportFace)
    expect(choice).toBeDefined()
    const proposed = await editor.proposeG1CurvedTangency({ net, choice: choice! })
    const published = await editor.publishG1CurvedTangency({
      baseNet: net, net: proposed.net, choice: choice!,
    })
    const moved = structuredClone(published.net)
    moved.poles[12][2] += .08
    const evaluated = await editor.evaluateG1CurvedTangency({
      constraintId: published.constraintId, net: moved, exportStep: true,
    })
    const resultStep = evaluated.step!
    expect(resultStep).toContain('ISO-10303-21')
    const recipe = await editor.createCurvedRecipe(moved, 'G1', [], source.binding.bodyKey, published.constraintId)
    expect(recipe.version).toBe(6)
    expect(recipe.curvedTangency.kind).toBe('compatible-bspline')
    const replay: SurfaceHistoryReplay = async (text, value, key) =>
      (await editor.replayCurvedRecipe(text, value, key)).step!
    const replayed = await replay(upstream, recipe, source.binding.bodyKey, ctrl.signal)
    expect(replayed).toContain('ISO-10303-21')

    const binding = source.binding
    const prepared = { recipe, sessionId: 'curved-host-qa',
      sourceKey: JSON.stringify([binding.documentEpoch, binding.sourceEpoch, binding.bodyId,
        binding.bodyKey, binding.buildVersion, binding.kernelGeneration, binding.frameRevision,
        binding.stepSha256, binding.units, binding.coordinateFrame]),
      selectionEpoch: 1, draftEpoch: 1 }
    const digest = async (s: string) => editorSha256(enc(s))
    const receipt = await withFrozenHistoryTransaction({
      freezeHistory: () => ({ isCurrent: () => true, release: () => {} }),
    }, prepared, async gate => {
      const qualified = await qualifySurfaceHistory({
        source, prepared, resultStep: enc(resultStep), noteCount: 0, replay,
        isStampCurrent: () => { gate.assertCurrent(); return true }, signal: ctrl.signal,
      })
      const staged = await reverseSession.stageEditorCopy(resultStep, 'curved-g1-parametric.step',
        source.assertCurrent, ctrl.signal, undefined, undefined, gate.bindQualified(qualified))
      try { return staged.publish('curved-v6-host-qa', await digest(resultStep)) }
      finally { staged.dispose() }
    })
    expect(receipt.createdBodyIds).toHaveLength(1)
    const stored = useReverse.getState().features.at(-1) as ImportFeature
    expect((stored.surfaceEditHistory as {recipe?:{version?:number}})?.recipe?.version).toBe(6)
    const archive = new Map<string, Uint8Array>()
    const saved = collectReversePart({ addMember: (key, bytes) => archive.set(key, bytes.slice()) })!
    applyReversePart(JSON.parse(JSON.stringify(saved)), { manifest: {} as never, members: archive })
    await reverseSession.settled()
    expect(useReverse.getState().bodies).toHaveLength(2)
    const restoredFeature = useReverse.getState().features.at(-1) as ImportFeature
    let adopted = 0, disposed = 0, validated = false
    const result = await prepareHostSurfaceHistoryRecovery({
      featureId: restoredFeature.id, replay, signal: new AbortController().signal,
      makeFreshSession: async (bytes, key) => {
        expect(new TextDecoder().decode(bytes)).toBe(upstream)
        expect(key).toBe(source.binding.bodyKey)
        return {
          restoreHistoryBundle: async (bundle: {recipe: unknown;notes: unknown}) => {
            expect(bundle.recipe).toEqual(recipe)
            expect(bundle.notes).toEqual([])
            const independent = await SurfaceEditorKernel.load()
            try {
              const replayed = await independent.replayCurvedRecipe(upstream, bundle.recipe, key)
              validated = replayed.step?.includes('ISO-10303-21') ?? false
              adopted++
            } finally { independent.dispose() }
          },
          getSnapshot: () => ({ validation: { kind: validated ? 'valid' : 'invalid' } }),
          getPanelState: () => ({ notes: [] }),
          dispose: async () => { disposed++ },
        }
      },
      awaitValidated: async () => { expect(validated).toBe(true) },
    })
    expect(result.status).toBe('ready')
    expect(adopted).toBe(1)
    if (result.status === 'ready') {
      expect((result.record.recipe as {version:number}).version).toBe(6)
      expect(() => result.assertCurrent()).not.toThrow()
      await result.release()
    }
    expect(disposed).toBe(1)
    const withoutReplay = await prepareHostSurfaceHistoryRecovery({
      featureId: restoredFeature.id, replay: undefined, signal: new AbortController().signal,
      makeFreshSession: async () => { throw Error('Must not create a session') },
      awaitValidated: async () => { throw Error('Must not await preview') },
    })
    expect(withoutReplay.status).toBe('copy-only')
    expect(useReverse.getState().stepFiles[restoredFeature.file.key]).toBe(resultStep)
  } finally { fixture.release() }
}, 120000)

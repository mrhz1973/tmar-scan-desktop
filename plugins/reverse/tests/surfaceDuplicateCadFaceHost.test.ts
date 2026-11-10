// SPDX-License-Identifier: AGPL-3.0-only
// Host-only qualification: plugin-generated detached face is an ordinary CAD
// copy. Source solid, Undo/Redo and native Reverse project archive remain intact.
// Does NOT qualify UI gesture, packaged desktop, or parametric recipe persistence.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../../tmar-edit-surface/editorKernel'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import { useReverse } from '../state/reStore'
import { useShell } from '../../../src/state/shellStore'
import { useNotes } from '../state/noteStore'
import { useHistory, undo, redo } from '../../../src/state/historyStore'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { createReverseEditorHost } from '../app/workspaceEditorHost'
import { collectReversePart, applyReversePart, STEP_MEMBER } from '../app/projectSection'
import { editorSha256 } from '../../../src/plugins/editorLifetime'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'
import type { ImportFeature } from '../core/features'
import plugin from '../plugin'

let headless: Headless, session: ReverseSession, editor: SurfaceEditorKernel
const stops: (() => void)[] = []
const bytes = (text: string) => new TextEncoder().encode(text)

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  editor = await SurfaceEditorKernel.load()
}, 120000)
afterAll(() => { stops.forEach(stop => stop()); session?.client()?.dispose(); headless?.stop(); editor?.dispose() })
beforeEach(() => { resetReverse(); useNotes.getState().load([]); useShell.getState().setWorkspace('reverse') })

describe('host CAD-copy contract for Duplica faccia CAD dd8f3b8', () => {
  it('publishes one detached natural face, undoes, redoes, and retains source and sheet in the saved Reverse section', async () => {
    const k = editor.kernel, box = k.makeBox(20, 30, 10)
    const upstream = k.exportStep(box)
    k.release(box)
    await run('reverse.import.step', { bytes: bytes(upstream), name: 'duplicate-source-box.step' })
    const initial = useReverse.getState()
    expect(initial.bodies).toHaveLength(1)
    const sourceId = initial.bodies[0].id, ctrl = new AbortController()
    const bound = await createReverseEditorHost().readSource(sourceId, ctrl.signal)
    const sourceText = new TextDecoder().decode(bound.step)
    expect(editor.open(sourceText).faces).toHaveLength(6)

    const sourceShape = k.importStep(sourceText), faceHandles = k.getSubShapes(sourceShape, 'face')
    let topIndex = -1
    try {
      topIndex = faceHandles.findIndex(face => {
        const b = k.getBoundingBox(face)
        return Math.abs(b.zmin - 10) < 1e-6 && Math.abs(b.zmax - 10) < 1e-6
      })
      expect(topIndex).toBeGreaterThanOrEqual(0)
    } finally { faceHandles.forEach(face => k.release(face)); k.release(sourceShape) }

    const net = editor.select(topIndex)
    const preview = editor.evaluate(net, 'G1')
    expect(preview.valid).toBe(true)
    expect(preview.previewRevision).toBeDefined()
    const detached = editor.duplicateCadFace(preview.previewRevision!)
    const sheetText = detached.step
    const shape = k.importStep(sheetText), faces = k.getSubShapes(shape, 'face')
    try {
      expect(k.isValid(shape)).toBe(true)
      expect(faces).toHaveLength(1)
      expect(k.subShapeCount(shape, 'solid')).toBe(0)
      expect(k.getSurfaceArea(faces[0])).toBeCloseTo(600, 6)
      expect(k.subShapeCount(faces[0], 'edge')).toBe(4)
      expect(k.subShapeCount(faces[0], 'wire')).toBe(1)
    } finally { faces.forEach(face => k.release(face)); k.release(shape) }

    const oldHistory = useHistory.getState().past.length
    const staged = await session.stageEditorCopy(
      sheetText, 'faccia-duplicata.step', bound.assertCurrent, ctrl.signal
    )
    let receipt
    try { receipt = staged.publish('host-detached-face-qa', await editorSha256(bytes(sheetText))) }
    finally { staged.dispose() }
    expect(receipt.mode).toBe('cad-copy')
    expect(receipt.createdBodyIds).toHaveLength(1)
    const copyId = receipt.createdBodyIds[0]
    expect(useHistory.getState().past.length).toBe(oldHistory + 1)
    const applied = useReverse.getState()
    expect(applied.bodies).toHaveLength(2)
    expect(applied.hiddenBodies).not.toContain(sourceId)
    expect(applied.hiddenBodies).not.toContain(copyId)
    const importFeature = applied.features.at(-1) as ImportFeature
    expect(importFeature.kind).toBe('import')
    expect(importFeature.surfaceEditHistory).toBeUndefined()

    const inspectBody = async (id: number) => {
      const result = await run<{file:{bytes:Uint8Array}}>('reverse.body.edit_source',{body:id})
      const step = new TextDecoder().decode(result.file.bytes)
      const object = k.importStep(step), fs = k.getSubShapes(object, 'face')
      const solids = k.getSubShapes(object,'solid')
      try {
        return {valid:k.isValid(object),faces:fs.length,solids:solids.length,
          area:k.getSurfaceArea(object),volume:k.getVolume(object),step}
      } finally { [...fs,...solids,object].forEach(h=>k.release(h)) }
    }
    const sourceBefore = await inspectBody(sourceId), sheetBefore = await inspectBody(copyId)
    expect(sourceBefore).toMatchObject({valid:true,faces:6,solids:1})
    expect(sourceBefore.volume).toBeCloseTo(6000,6)
    expect(sheetBefore).toMatchObject({valid:true,faces:1,solids:0})
    expect(sheetBefore.area).toBeCloseTo(600,6)

    await undo(); await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(1)
    expect(useReverse.getState().bodies[0].id).toBe(sourceId)
    await redo(); await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(2)
    expect(useReverse.getState().bodies.some(body=>body.id===copyId)).toBe(true)

    const archive = new Map<string, Uint8Array>()
    const snapshot = collectReversePart({ addMember:(key,value)=>archive.set(key,value.slice()) })!
    expect(archive.has(STEP_MEMBER)).toBe(true)
    applyReversePart(JSON.parse(JSON.stringify(snapshot)),{manifest:{} as never,members:archive})
    await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(2)
    const reopenedSource = await inspectBody(sourceId), reopenedCopy = await inspectBody(copyId)
    expect(reopenedSource).toMatchObject({valid:true,faces:6,solids:1})
    expect(reopenedSource.volume).toBeCloseTo(sourceBefore.volume,6)
    expect(reopenedCopy).toMatchObject({valid:true,faces:1,solids:0})
    expect(reopenedCopy.area).toBeCloseTo(sheetBefore.area,6)
    expect(useReverse.getState().features.at(-1)).toMatchObject({kind:'import'})
    expect((useReverse.getState().features.at(-1) as ImportFeature).surfaceEditHistory).toBeUndefined()

    // The archived CAD sheet can be opened by the existing host source
    // binding; it is NOT a restored editable parametrized history recipe.
    const rebind = await createReverseEditorHost().readSource(copyId, new AbortController().signal)
    const openCopy = editor.open(new TextDecoder().decode(rebind.step))
    expect(openCopy.faces).toHaveLength(1)
    expect(openCopy.faces[0]).toMatchObject({reason:null,openSheet:true})
  }, 120000)
})

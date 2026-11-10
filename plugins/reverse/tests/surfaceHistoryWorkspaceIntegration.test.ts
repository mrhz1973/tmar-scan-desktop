// SPDX-License-Identifier: AGPL-3.0-only
// Real workspace controller/locks, independent OCCT replay and actual ZIP bytes.
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Request } from '../../tmar-edit-surface/editor.worker'
import { SurfaceEditorKernel } from '../../tmar-edit-surface/editorKernel'
import { SurfaceRuntime } from '../../tmar-edit-surface/surfaceRuntime'
import { createWorkspaceSurfaceSession, type WorkspaceSurfaceSession } from '../../tmar-edit-surface/workspaceSession'
import { configureWorkspaceEditorHost, registerWorkspaceEditor, registerWorkspaceEditorHistory,
  useWorkspaceEditor, workspaceEditors, type BoundEditorSource, type OwnedEditorViewport, type EditorHistoryReplay } from '../../../src/plugins/workspaceEditors'
import type { WorkspaceEditorContext } from '../../../src/plugins/workspaceEditorTypes'
import { createReverseEditorHost } from '../app/workspaceEditorHost'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { useReverse } from '../state/reStore'
import { useNotes } from '../state/noteStore'
import { useShell } from '../../../src/state/shellStore'
import { useHistory, undo, redo } from '../../../src/state/historyStore'
import { collectProject, prepareProjectState } from '../../../src/app/project'
import { packProject, unpackProject } from '../../../src/core/project/archive'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import { readStoredSurfaceHistory } from '../app/surfaceEditHistory'
import { revalidateAnnotations } from '../app/annotationPersistence'
import { assertArchivedSurfaceHistorySource } from '../app/surfaceHistoryRecovery'
import type { ImportFeature } from '../core/features'
import reversePlugin from '../plugin'

// Exercise the production host with a renderer-only fixture; plugin registration
// otherwise installs its WebGL host before the headless session is available.
vi.mock('../app/workspaceEditorHost', async importOriginal => ({
  ...await importOriginal<typeof import('../app/workspaceEditorHost')>(),
  installReverseEditorHost: () => () => {},
}))

class NativeSurfaceWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror = null
  onmessageerror = null
  private editor = SurfaceEditorKernel.load()
  private chain = Promise.resolve()
  private terminated = false
  terminate = vi.fn(() => {
    if (this.terminated) return
    this.terminated = true
    void this.chain.then(async () => (await this.editor).dispose())
  })
  postMessage(raw: Request) {
    const request = structuredClone(raw)
    this.chain = this.chain.then(async () => {
      if (this.terminated) return
      try {
        const editor = await this.editor
        let result: unknown
        switch (request.action) {
          case 'open': result = editor.open(request.step); break
          case 'select': result = editor.select(request.face); break
          case 'evaluate': result = editor.evaluate(request.net, request.continuity, !!request.exportStep, request.freeBoundary); break
          case 'createRecipe': result = await editor.createRecipe(request.net, request.continuity, request.lockedPoles, request.bodyId, request.freeBoundary); break
          case 'restoreRecipe': result = await editor.restoreRecipe(request.step, request.recipe, request.bodyId); break
          case 'notePick': result = editor.anchorFromPick(request.point, request.previewRevision); break
          case 'noteResolve': result = editor.resolveAnchor(request.anchor, request.previewRevision); break
          case 'finalFaceWitness': result = editor.finalFaceWitness(request.previewRevision); break
          default: throw new Error(`Unsupported native fixture request: ${request.action}`)
        }
        this.onmessage?.({ data: { id: request.id, result } } as MessageEvent)
      } catch (error) { this.onmessage?.({ data: { id: request.id, error: String((error as Error).message) } } as MessageEvent) }
    })
  }
}

const id = 'qa-real-history-workspace'
let headless: Headless, reverse: ReverseSession, fixture: SurfaceEditorKernel, boxStep: string
let releaseHost: () => void, releaseDefinition: () => void, releaseProvider: () => void
const stops: (() => void)[] = [], workers: NativeSurfaceWorker[] = []
const viewportBodies: number[] = [], contexts: WorkspaceEditorContext[] = []
let beforeReplay: (() => void | Promise<void>) | undefined
let replayMismatch = false
const replay: EditorHistoryReplay = async (source, recipe, signal) => {
  await beforeReplay?.()
  source.assertCurrent()
  if (signal?.aborted) throw new Error('Replay aborted')
  const independent = await SurfaceEditorKernel.load()
  try {
    const result = await independent.replayRecipe(new TextDecoder().decode(source.step), recipe, source.bodyKey)
    source.assertCurrent()
    return { valid: result.valid, step: replayMismatch ? boxStep : result.step! }
  } finally { independent.dispose() }
}
const current = () => useWorkspaceEditor.getState().controller as WorkspaceSurfaceSession
async function ready() {
  await vi.waitFor(() => {
    const controller = current()
    expect(controller.getSnapshot().validation.kind).toBe('valid')
    expect(controller.getPanelState().busy).toBe(false)
    expect(controller.getPanelState().calculating).toBe(false)
    expect(controller.getViewState().notePins.length).toBe(controller.getPanelState().notes.length)
  }, { timeout: 15000, interval: 25 })
}
async function edit() {
  await current().chooseFace(0)
  await ready()
  current().selectAllFree(); current().moveSelected(.15)
  await ready()
  expect(useWorkspaceEditor.getState().canPreserveHistory).toBe(true)
}
async function imported() {
  await run('reverse.import.step', { bytes: new TextEncoder().encode(boxStep), name: 'history-fixture.step' })
  return useReverse.getState().bodies[0].id
}
function fakeViewport(source: BoundEditorSource): OwnedEditorViewport {
  source.assertCurrent(); viewportBodies.push(source.binding.bodyId)
  return { view: { onInterruption: () => () => {} } as unknown as OwnedEditorViewport['view'], releaseCapture() {},
    suspendReferenceNotifications: () => () => {}, dispose() {} }
}
beforeAll(async () => {
  reversePlugin.install?.(); headless = await startHeadless()
  reverse = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(reverse), reverse.watch())
  fixture = await SurfaceEditorKernel.load()
  const shape = fixture.kernel.makeBox(20, 30, 10)
  try { boxStep = fixture.kernel.exportStep(shape) } finally { fixture.kernel.release(shape) }
  releaseHost = configureWorkspaceEditorHost({ ...createReverseEditorHost(), viewport: fakeViewport })
  releaseDefinition = registerWorkspaceEditor({ id, apiVersion: 1, workspace: 'reverse', Parameters: () => null,
    createSession: context => {
      contexts.push(context)
      const worker = new NativeSurfaceWorker(); workers.push(worker)
      return createWorkspaceSurfaceSession(context, () => ({ cancelGesture: () => false, dispose() {} }),
        { runtime: new SurfaceRuntime(() => worker as unknown as Worker) })
    },
  })
  releaseProvider = registerWorkspaceEditorHistory(id, { replay, canPrepare: controller =>
    (controller as WorkspaceSurfaceSession).getPanelState().historyRecipeSupported && controller.getSnapshot().dirty })
}, 120000)
beforeEach(() => {
  resetReverse(); useNotes.getState().load([]); useShell.getState().setWorkspace('reverse')
  beforeReplay = undefined; replayMismatch = false; viewportBodies.length = 0; contexts.length = 0
})
afterEach(async () => { await workspaceEditors.cancel(); vi.restoreAllMocks() })
afterAll(() => {
  releaseProvider?.(); releaseDefinition?.(); releaseHost?.(); stops.forEach(stop => stop())
  reverse?.client()?.dispose(); fixture?.dispose(); headless?.stop()
})

it('publishes real history, packs ZIP, restores the actual controller and re-applies under the result viewport lease', async () => {
  const original = await imported()
  await workspaceEditors.open(id, { bodyId: original }); await edit()
  const sourceBytes = contexts[0].step.slice()
  const sourceKey = contexts[0].source.bodyKey
  const controller = current()
  const freeze = vi.spyOn(controller, 'freeze'), historyFreeze = vi.spyOn(controller, 'freezeHistory')
  const receipt = await workspaceEditors.apply()
  expect(freeze).toHaveBeenCalledTimes(1); expect(historyFreeze).toHaveBeenCalledTimes(1)
  expect(useWorkspaceEditor.getState().phase).toBe('closed')
  const savedFeature = useReverse.getState().features.at(-1) as ImportFeature
  const record = readStoredSurfaceHistory(savedFeature.surfaceEditHistory)
  expect(() => assertArchivedSurfaceHistorySource({ record, resultBodyId: receipt.createdBodyIds[0], assertCurrent() {} }, record))
    .toThrow('Provenienza archiviata non verificata')
  expect(record.source.bodyKey).toBe(sourceKey)
  expect(useReverse.getState().stepFiles[record.source.file.key]).toBe(new TextDecoder().decode(sourceBytes))
  const collected = collectProject({ scan: null, reference: null, image: null }, null, '0.9.4')
  const bytes = packProject(collected.manifest, collected.members)
  expect(Array.from(bytes.slice(0, 2))).toEqual([80, 75])
  const unpacked = unpackProject(bytes)
  const restore = prepareProjectState(unpacked.manifest, unpacked.members)
  restore(); await reverse.settled()
  // The headless fixture has no registered UI workspaces; the real browser
  // restores Reverse via its installed plugin registry.
  useShell.getState().setWorkspace('reverse')
  const resultBody = receipt.createdBodyIds[0]
  await workspaceEditors.reopen(id, { bodyId: resultBody }); await ready()
  expect(viewportBodies.at(-1)).toBe(resultBody)
  expect(contexts.at(-1)!.source.bodyKey).toBe(sourceKey)
  expect(contexts.at(-1)!.step).toEqual(sourceBytes)
  current().selectAllFree(); current().moveSelected(.1); await ready()
  const again = await workspaceEditors.apply()
  expect(again.createdBodyIds).toHaveLength(1)
  expect(useReverse.getState().bodies).toHaveLength(3)
  const second = readStoredSurfaceHistory((useReverse.getState().features.at(-1) as ImportFeature).surfaceEditHistory)
  expect(second.source.stepSha256).toBe(record.source.stepSha256)
  expect(second.resultStepSha256).not.toBe(record.resultStepSha256)
  await undo(); await reverse.settled(); expect(useReverse.getState().bodies).toHaveLength(2)
  await redo(); await reverse.settled(); expect(useReverse.getState().bodies).toHaveLength(3)
}, 120000)

it('recovers authentic upstream bytes after the original live body has been removed', async () => {
  const bodyId = await imported(); await workspaceEditors.open(id, { bodyId }); await edit()
  const bytes = contexts[0].step.slice(), key = contexts[0].source.bodyKey
  const receipt = await workspaceEditors.apply()
  useReverse.getState().removeFeature(Math.floor(bodyId)); await reverse.settled()
  expect(useReverse.getState().bodies.map(body => body.id)).toEqual(receipt.createdBodyIds)
  const collected = collectProject({ scan: null, reference: null, image: null }, null, '0.9.4')
  const unpacked = unpackProject(packProject(collected.manifest, collected.members))
  prepareProjectState(unpacked.manifest, unpacked.members)(); await reverse.settled()
  useShell.getState().setWorkspace('reverse')
  await workspaceEditors.reopen(id, { bodyId: receipt.createdBodyIds[0] }); await ready()
  expect(contexts.at(-1)!.step).toEqual(bytes)
  expect(contexts.at(-1)!.source.bodyKey).toBe(key)
  expect(viewportBodies.at(-1)).toBe(receipt.createdBodyIds[0])
  current().selectAllFree(); current().moveSelected(.02); await ready()
  await workspaceEditors.apply()
  expect(useReverse.getState().bodies).toHaveLength(2)
}, 120000)

it('refuses changed note text during the export-to-history handoff without publishing either CAD or notes', async () => {
  const bodyId = await imported(); await workspaceEditors.open(id, { bodyId }); await edit()
  const controller = current(), net = controller.getPanelState().net!
  const center = [0, 1, 2].map(axis => net.poles.reduce((sum, point) => sum + point[axis], 0) / net.poles.length) as [number, number, number]
  controller.setPlacingNote(true); await controller.placeNote(center)
  const noteId = controller.getPanelState().notes[0].id
  controller.setNoteText(noteId, 'Prima del trasferimento'); await ready()
  const originalFreeze = controller.freezeAnnotated.bind(controller)
  vi.spyOn(controller, 'freezeAnnotated').mockImplementation(ticket => {
    const release = originalFreeze(ticket)
    return () => { release(); controller.setNoteText(noteId, 'Testo cambiato durante il trasferimento') }
  })
  const before = useReverse.getState(), notes = useNotes.getState().notes, past = useHistory.getState().past
  await expect(workspaceEditors.apply()).rejects.toThrow(/ricetta/)
  expect(useReverse.getState()).toBe(before)
  expect(useNotes.getState().notes).toBe(notes)
  expect(useHistory.getState().past).toBe(past)
  expect(controller.getPanelState().notes[0].text).toBe('Testo cambiato durante il trasferimento')
}, 120000)

it('saves native notes with history, restores them from ZIP and commits their next revision atomically', async () => {
  const bodyId = await imported(); await workspaceEditors.open(id, { bodyId }); await edit()
  const net = current().getPanelState().net!
  const center = [0, 1, 2].map(axis => net.poles.reduce((sum, point) => sum + point[axis], 0) / net.poles.length) as [number, number, number]
  current().setPlacingNote(true); await current().placeNote(center)
  const draftId = current().getPanelState().notes[0].id
  current().setNoteText(draftId, 'Controlla questa superficie')
  await ready()
  const receipt = await workspaceEditors.apply()
  expect(receipt.mode).toBe('annotated-cad-copy')
  expect(useNotes.getState().notes).toHaveLength(1)
  const collected = collectProject({ scan: null, reference: null, image: null }, null, '0.9.4')
  const unpacked = unpackProject(packProject(collected.manifest, collected.members))
  prepareProjectState(unpacked.manifest, unpacked.members)()
  await reverse.settled(); await revalidateAnnotations()
  useShell.getState().setWorkspace('reverse')
  await workspaceEditors.reopen(id, { bodyId: receipt.createdBodyIds[0] }); await ready()
  expect(current().getPanelState().notes[0]).toMatchObject({ id: draftId, text: 'Controlla questa superficie' })
  current().setNoteText(draftId, 'Controllo aggiornato')
  await ready()
  const beforeBodies = useReverse.getState().bodies.length
  const next = await workspaceEditors.apply()
  expect(next.mode).toBe('annotated-cad-copy')
  expect(useReverse.getState().bodies).toHaveLength(beforeBodies + 1)
  expect(useNotes.getState().notes.map(note => note.text)).toEqual(['Controlla questa superficie', 'Controllo aggiornato'])
  await undo(); await reverse.settled()
  expect(useReverse.getState().bodies).toHaveLength(beforeBodies)
  expect(useNotes.getState().notes.map(note => note.text)).toEqual(['Controlla questa superficie'])
  await redo(); await reverse.settled()
  expect(useReverse.getState().bodies).toHaveLength(beforeBodies + 1)
  expect(useNotes.getState().notes.map(note => note.text)).toEqual(['Controlla questa superficie', 'Controllo aggiornato'])
}, 120000)

it('rejects a re-entrant draft change between the export and history locks without publishing', async () => {
  const bodyId = await imported(); await workspaceEditors.open(id, { bodyId }); await edit()
  const controller = current(), originalFreeze = controller.freeze.bind(controller)
  vi.spyOn(controller, 'freeze').mockImplementation(ticket => {
    const release = originalFreeze(ticket)
    return () => { release(); controller.selectAllFree(); controller.moveSelected(.05) }
  })
  const before = useReverse.getState(), past = useHistory.getState().past
  await expect(workspaceEditors.apply()).rejects.toThrow(/cambiat|ricetta/)
  expect(useReverse.getState()).toBe(before); expect(useHistory.getState().past).toBe(past)
}, 120000)

it('holds the real history lock during replay and rejects a different replay result atomically', async () => {
  const bodyId = await imported(); await workspaceEditors.open(id, { bodyId }); await edit()
  const before = useReverse.getState(), notes = useNotes.getState().notes, past = useHistory.getState().past
  beforeReplay = () => { expect(() => current().moveSelected(.1)).toThrow() }
  replayMismatch = true
  await expect(workspaceEditors.apply()).rejects.toThrow('replay parametrico')
  expect(useReverse.getState()).toBe(before); expect(useNotes.getState().notes).toBe(notes); expect(useHistory.getState().past).toBe(past)
  expect(useWorkspaceEditor.getState().phase).toBe('editing')
  current().selectAllFree(); expect(() => current().moveSelected(.01)).not.toThrow()
}, 120000)

it('refuses a tampered archived recipe and leaves the saved result and notes unchanged', async () => {
  const bodyId = await imported(); await workspaceEditors.open(id, { bodyId }); await edit()
  const receipt = await workspaceEditors.apply()
  const features = useReverse.getState().features
  const last = features.at(-1) as ImportFeature
  const history = structuredClone(last.surfaceEditHistory) as { recipeSha256: string }
  history.recipeSha256 = '0'.repeat(64)
  useReverse.setState({ features: [...features.slice(0, -1), { ...last, surfaceEditHistory: history }] })
  const before = useReverse.getState(), notes = useNotes.getState().notes
  const viewportCount = viewportBodies.length
  await expect(workspaceEditors.reopen(id, { bodyId: receipt.createdBodyIds[0] })).rejects.toThrow()
  expect(useReverse.getState()).toBe(before); expect(useNotes.getState().notes).toBe(notes)
  expect(viewportBodies).toHaveLength(viewportCount)
  expect(useWorkspaceEditor.getState().phase).toBe('closed')
}, 120000)

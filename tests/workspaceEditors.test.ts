// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorLifetime } from '../src/plugins/editorLifetime'
import { EditorReferenceNotifications } from '../src/plugins/editorReferenceNotifications'
import { configureWorkspaceEditorHost, registerWorkspaceEditor, useWorkspaceEditor, workspaceEditors, type WorkspaceEditorHost } from '../src/plugins/workspaceEditors'
import type { EditorSnapshot, EditorViewportLease, PreparedCadCopy, WorkspaceEditorController, WorkspaceEditorContext, SourceBinding } from '../src/plugins/workspaceEditorTypes'

const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const stops: (() => void)[] = []
afterEach(async () => { await workspaceEditors.cancel(); stops.splice(0).reverse().forEach(stop => stop()); vi.restoreAllMocks() })
function fixture() {
  const source: SourceBinding = Object.freeze({ documentEpoch: 'document', sourceEpoch: 1, bodyId: 1, bodyKey: 'body', buildVersion: 1, kernelGeneration: 1, frameRevision: 1, stepSha256: 'hash', units: 'mm', coordinateFrame: 'part' })
  let valid = true, sourceChanged = () => {}, changed = () => {}
  let snapshot!: EditorSnapshot, context!: WorkspaceEditorContext
  const assertCurrent = () => { if (!valid) throw new Error('stale source') }
  const unfreeze = vi.fn(), detach = vi.fn(), release = vi.fn(), dispose = vi.fn(async () => {})
  const published: string[] = []
  const controller: WorkspaceEditorController = {
    getSnapshot: () => snapshot, subscribe: listener => { changed = listener; return () => { changed = () => {} } },
    attach: vi.fn(() => detach), cancelGesture: vi.fn(() => false), undo: vi.fn(), redo: vi.fn(), freeze: vi.fn(() => unfreeze),
    prepareApply: vi.fn<WorkspaceEditorController['prepareApply']>(async ticket => ({ kind: 'cad-copy', operationId: ticket.operationId, source, stamp: ticket.stamp, units: 'mm', coordinateFrame: 'part', name: 'result.step', step: new TextEncoder().encode('ISO-10303-21; fake test artifact'), draftNoteCount: 0 })),
    dispose,
  }
  const publish = vi.fn((operationId: string, artifactSha256: string) => {
    assertCurrent(); published.push(operationId)
    return { operationId, documentEpoch: 'document', artifactSha256, createdBodyIds: [2], historyActionId: operationId, mode: 'cad-copy' as const }
  })
  const stageDispose = vi.fn()
  const references = new EditorReferenceNotifications()
  const adapter: WorkspaceEditorHost = {
    capabilities: { apiVersion: 1, enabled: true, commitKinds: ['cad-copy'] },
    readSource: vi.fn(async () => ({ binding: source, step: new Uint8Array([1,2,3]), assertCurrent,
      subscribe: (listener: () => void) => { sourceChanged = listener; return () => { sourceChanged = () => {} } } })),
    viewport: vi.fn(() => ({ view: {
      onInterruption: () => () => {},
      subscribeReferences: (fn: () => void) => references.subscribe(fn),
      references: () => { assertCurrent(); return [] },
    } as unknown as EditorViewportLease, releaseCapture: release,
      suspendReferenceNotifications: () => references.suspend(), dispose: vi.fn(() => references.dispose()) })),
    stage: vi.fn(async () => ({ publish, dispose: stageDispose })),
  }
  const definition = { id: 'test-editor', apiVersion: 1 as const, workspace: 'reverse' as const, Parameters: () => null,
    createSession: vi.fn(async (ctx: WorkspaceEditorContext) => {
      context = ctx
      const current = { sessionId: ctx.sessionId, sourceEpoch: 1, selectionEpoch: 1, draftEpoch: 1 }
      snapshot = { revision: 1, current, validation: { kind: 'valid', stamp: { ...current, requestId: 1 } }, dirty: true, gesture: 'idle', canUndo: true, canRedo: false, undoLabel: 'edit', redoLabel: null, historyRevision: 1, draftNoteCount: 0, message: null }
      return controller
    }) }
  stops.push(registerWorkspaceEditor(definition), configureWorkspaceEditorHost(adapter))
  const patch = (data: Partial<EditorSnapshot>) => { snapshot = { ...snapshot, ...data }; changed() }
  return { adapter, definition, controller, publish, published, source, unfreeze, stageDispose, detach, release, dispose, patch,
    get snapshot() { return snapshot }, get context() { return context }, invalidate: () => { valid = false; sourceChanged() },
    referenceChanged: (current: boolean) => { valid = current; references.notify() } }
}
describe('workspace editor lifecycle', () => {
  it('owns cleanup once in reverse order even when one throws', () => {
    const life = new EditorLifetime(), order: number[] = []
    life.own(() => { order.push(1) }); const second = life.own(() => { order.push(2); throw Error('cleanup') })
    life.own(() => { order.push(3) }); second(); second(); life.dispose(); life.dispose()
    life.own(() => { order.push(4) })
    expect(order).toEqual([2,3,1,4]); expect(life.errors).toHaveLength(1)
  })
  it('rejects concurrent editors and keeps a single controller', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    await expect(workspaceEditors.open('test-editor', { bodyId: 1 })).rejects.toThrow('corrente')
    expect(f.definition.createSession).toHaveBeenCalledTimes(1)
    expect(useWorkspaceEditor.getState().canApply).toBe(true)
  })
  it('coalesces double Apply, returns a receipt and closes resources exactly once', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    const a = workspaceEditors.apply(), b = workspaceEditors.apply()
    expect(a).toBe(b)
    const receipt = await a
    expect(f.published).toHaveLength(1); expect(receipt.artifactSha256).toHaveLength(64)
    expect(workspaceEditors.receipt(receipt.operationId)).toBe(receipt)
    expect(f.detach).toHaveBeenCalledTimes(1); expect(f.dispose).toHaveBeenCalledTimes(1)
    expect(f.stageDispose).toHaveBeenCalledTimes(1); expect(useWorkspaceEditor.getState().phase).toBe('closed')
  })
  it('blocks pending, invalid, notes and active gesture without a project change', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    for (const patch of [{ gesture: 'pole' as const }, { gesture: 'idle' as const, draftNoteCount: 1 },
      { draftNoteCount: 0, validation: { kind: 'pending' as const, wanted: { ...f.snapshot.current, requestId: 2 } } },
      { validation: { kind: 'invalid' as const, stamp: { ...f.snapshot.current, requestId: 2 }, message: 'bad shape' } }]) {
      f.patch(patch); await expect(workspaceEditors.apply()).rejects.toThrow()
    }
    expect(f.adapter.stage).not.toHaveBeenCalled(); expect(f.published).toEqual([])
  })
  it('rejects a stale validated stamp even if the plugin says valid', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    f.patch({ current: { ...f.snapshot.current, draftEpoch: 2 } })
    expect(useWorkspaceEditor.getState().canApply).toBe(false)
    await expect(workspaceEditors.apply()).rejects.toThrow()
  })
  it('keeps the draft and unfreezes on a failed staging, allowing a retry', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    vi.mocked(f.adapter.stage).mockRejectedValueOnce(new Error('stage failed'))
    await expect(workspaceEditors.apply()).rejects.toThrow('stage failed')
    expect(f.unfreeze).toHaveBeenCalledTimes(1); expect(useWorkspaceEditor.getState().phase).toBe('editing')
    expect(f.publish).not.toHaveBeenCalled()
    await workspaceEditors.apply(); expect(f.publish).toHaveBeenCalledTimes(1)
  })
  it('refuses malformed plugin payloads before staging', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    const original = f.controller.prepareApply
    f.controller.prepareApply = async (ticket, signal) => ({ ...await original(ticket, signal), draftNoteCount: 1 } as unknown as PreparedCadCopy)
    await expect(workspaceEditors.apply()).rejects.toThrow('Pacchetto')
    expect(f.adapter.stage).not.toHaveBeenCalled(); expect(f.unfreeze).toHaveBeenCalled()
  })
  it('rechecks the exact draft after asynchronous staging', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    const original = f.adapter.stage
    f.adapter.stage = async (...args) => { const staged = await original(...args); f.patch({ current: { ...f.snapshot.current, draftEpoch: 2 } }); return staged }
    await expect(workspaceEditors.apply()).rejects.toThrow('bozza')
    expect(f.publish).not.toHaveBeenCalled(); expect(f.stageDispose).toHaveBeenCalled()
  })
  it('cancellation during prepare never publishes late completion', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    const gate = deferred<void>(), original = f.controller.prepareApply
    f.controller.prepareApply = async (...args) => { await gate.promise; return original(...args) }
    const pending = workspaceEditors.apply(); const rejected = expect(pending).rejects.toThrow()
    await workspaceEditors.cancel(); gate.resolve(); await rejected
    expect(f.publish).not.toHaveBeenCalled(); expect(useWorkspaceEditor.getState().phase).toBe('closed')
  })
  it('source invalidation closes and releases input without a project change', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    f.invalidate(); await workspaceEditors.cancel()
    expect(f.dispose).toHaveBeenCalledWith('source-invalid'); expect(f.release).toHaveBeenCalled()
    expect(f.published).toEqual([])
  })
  it('a late create after Cancel disposes the controller and never attaches', async () => {
    const f = fixture(), gate = deferred<void>(), original = f.definition.createSession.getMockImplementation()!
    f.definition.createSession.mockImplementation(async ctx => { const c = await original(ctx); await gate.promise; return c })
    const opening = workspaceEditors.open('test-editor', { bodyId: 1 }); const rejected = expect(opening).rejects.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))
    await workspaceEditors.cancel(); gate.resolve(); await rejected
    expect(f.controller.attach).not.toHaveBeenCalled(); expect(f.dispose).toHaveBeenCalledTimes(1)
  })
  it('failed session construction runs acquired cleanup', async () => {
    const f = fixture(), cleanup = vi.fn()
    f.definition.createSession.mockImplementation(async ctx => { ctx.own(cleanup); throw Error('open failed') })
    await expect(workspaceEditors.open('test-editor', { bodyId: 1 })).rejects.toThrow('open failed')
    expect(cleanup).toHaveBeenCalledTimes(1); expect(useWorkspaceEditor.getState().phase).toBe('closed')
  })
  it('cancellation after staging refuses publication and disposes the staged resource', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    const gate = deferred<void>(), entered = deferred<void>(), original = f.adapter.stage
    f.adapter.stage = async (...args) => { const staged = await original(...args); entered.resolve(); await gate.promise; return staged }
    const pending = workspaceEditors.apply(), refused = expect(pending).rejects.toThrow()
    await entered.promise; await workspaceEditors.cancel(); gate.resolve(); await refused
    expect(f.publish).not.toHaveBeenCalled(); expect(f.stageDispose).toHaveBeenCalledTimes(1)
  })
  it('rechecks source after staging even without an invalidation notification', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    const original = f.adapter.stage
    f.adapter.stage = async (...args) => { const staged = await original(...args); args[0].assertCurrent = () => { throw Error('changed at publication') }; return staged }
    await expect(workspaceEditors.apply()).rejects.toThrow('changed at publication')
    expect(f.publish).not.toHaveBeenCalled(); expect(f.stageDispose).toHaveBeenCalledTimes(1)
  })
  it('rechecks draft after committing observers run, without awaiting before publish', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    const off = useWorkspaceEditor.subscribe(s => { if (s.phase === 'committing') f.patch({ current: { ...f.snapshot.current, draftEpoch: 42 } }) })
    try { await expect(workspaceEditors.apply()).rejects.toThrow('prima della pubblicazione') }
    finally { off() }
    expect(f.publish).not.toHaveBeenCalled(); expect(f.unfreeze).toHaveBeenCalledTimes(1)
  })
  it('reentrant disposal callbacks close the controller only once', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    f.release.mockImplementation(() => { void workspaceEditors.cancel() })
    await workspaceEditors.cancel()
    expect(f.dispose).toHaveBeenCalledTimes(1); expect(f.detach).toHaveBeenCalledTimes(1)
    expect(useWorkspaceEditor.getState().phase).toBe('closed')
  })
  it('a fatal report from a disposed session cannot close the replacement session', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    const old = f.context; await workspaceEditors.cancel()
    await workspaceEditors.open('test-editor', { bodyId: 1 }); const id = useWorkspaceEditor.getState().id
    old.reportFatal('late error'); await Promise.resolve()
    expect(useWorkspaceEditor.getState().id).toBe(id); expect(useWorkspaceEditor.getState().phase).toBe('editing')
    expect(useWorkspaceEditor.getState().error).toBeNull()
  })

})

// A real viewport reference listener can run synchronously from the committed
// store write. It must never re-enter the frozen controller with its OLD source.
describe('workspace Apply reference notification boundary', () => {
  it('does not re-enter old-source reference listeners during successful publication', async () => {
    const f = fixture(), observed = vi.fn()
    f.controller.attach = view => view.subscribeReferences(() => { view.references(); observed() })
    const original = f.publish.getMockImplementation()!
    f.publish.mockImplementation((operationId, hash) => {
      const receipt = original(operationId, hash)
      f.referenceChanged(false) // The source binding is superseded by adoption.
      return receipt
    })
    await workspaceEditors.open('test-editor', { bodyId: 1 })
    await expect(workspaceEditors.apply()).resolves.toMatchObject({ mode: 'cad-copy' })
    expect(observed).not.toHaveBeenCalled()
    expect(f.published).toHaveLength(1)
    expect(useWorkspaceEditor.getState().phase).toBe('closed')
  })
  it('refreshes the restored source exactly once after failed publication, then permits retry', async () => {
    const f = fixture(), observed = vi.fn()
    f.controller.attach = view => view.subscribeReferences(() => { view.references(); observed(useWorkspaceEditor.getState().phase) })
    f.publish.mockImplementationOnce(() => {
      try { f.referenceChanged(false); throw Error('injected publication failure') }
      finally { f.referenceChanged(true) } // Atomic rollback restores the source.
    })
    await workspaceEditors.open('test-editor', { bodyId: 1 })
    await expect(workspaceEditors.apply()).rejects.toThrow('injected publication failure')
    expect(observed).toHaveBeenCalledExactlyOnceWith('editing')
    expect(useWorkspaceEditor.getState().canApply).toBe(true)
    expect(f.unfreeze).toHaveBeenCalledTimes(1)
    await expect(workspaceEditors.apply()).resolves.toMatchObject({ mode: 'cad-copy' })
    expect(f.published).toHaveLength(1)
  })
  it('does not hide a real source replacement immediately before publication', async () => {
    const f = fixture()
    await workspaceEditors.open('test-editor', { bodyId: 1 })
    const stop = useWorkspaceEditor.subscribe(state => { if (state.phase === 'committing') f.invalidate() })
    try {
      await expect(workspaceEditors.apply()).rejects.toThrow('stale source')
      expect(f.publish).not.toHaveBeenCalled()
    } finally { stop() }
  })
})


describe('host-owned Apply display choice', () => {
  it('defaults to hiding the source and freezes the choice before asynchronous Apply', async () => {
    const f=fixture();await workspaceEditors.open('test-editor',{bodyId:1})
    expect(useWorkspaceEditor.getState().hideSourceAfterApply).toBe(true)
    const waiting=deferred<void>(),prepare=f.controller.prepareApply
    f.controller.prepareApply=async(ticket,signal)=>{await waiting.promise;return prepare(ticket,signal)}
    const pending=workspaceEditors.apply()
    expect(workspaceEditors.setHideSourceAfterApply(false)).toBe(false)
    waiting.resolve();await pending
    expect(f.adapter.stage).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.anything(),{hideSourceAfterApply:true})
  })
  it('can retain both bodies without modifying the plugin ticket or geometry package', async () => {
    const f=fixture();await workspaceEditors.open('test-editor',{bodyId:1})
    expect(workspaceEditors.setHideSourceAfterApply(false)).toBe(true)
    expect(useWorkspaceEditor.getState().hideSourceAfterApply).toBe(false)
    await workspaceEditors.apply()
    expect(f.adapter.stage).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({kind:'cad-copy',draftNoteCount:0}),expect.anything(),{hideSourceAfterApply:false})
    expect(workspaceEditors.setHideSourceAfterApply(true)).toBe(false)
  })
  it('does not publish a source visibility change when the user cancels', async () => {
    const f=fixture();await workspaceEditors.open('test-editor',{bodyId:1})
    workspaceEditors.setHideSourceAfterApply(false);await workspaceEditors.cancel()
    expect(f.adapter.stage).not.toHaveBeenCalled();expect(f.publish).not.toHaveBeenCalled()
  })
})

async function enableAnnotatedFixture(f: ReturnType<typeof fixture>) {
  const { editorSha256 } = await import('../src/plugins/editorLifetime')
  f.adapter.capabilities = { apiVersion: 1, enabled: true, annotationVersion: 1, commitKinds: ['cad-copy', 'annotated-cad-copy'] }
  f.controller.freezeAnnotated = vi.fn(() => f.unfreeze)
  f.controller.prepareAnnotatedApply = vi.fn(async ticket => {
    const step = new TextEncoder().encode('ISO-10303-21; mocked manager artifact'), brep = 'mocked manager witness'
    const stepHash = await editorSha256(step), witnessHash = await editorSha256(new TextEncoder().encode(brep))
    return { annotationVersion: 1 as const, kind: 'annotated-cad-copy' as const, operationId: ticket.operationId,
      source: ticket.source, stamp: ticket.stamp, notesRevision: ticket.notesRevision, units: 'mm' as const,
      coordinateFrame: 'part' as const, name: 'manager-annotation.step', step,
      witnesses: [{key:'face',kind:'occt-face-brep' as const,brep,brepSha256:witnessHash,finalStepSha256:stepHash,stamp:ticket.stamp,diagnosticFaceIndex:0}],
      notes: [{draftId:'note',text:'Keep all text',target:{kind:'copy-face' as const,witnessKey:'face',sourceUV:[0,0],resolvedAt:[0,0,0],orientedNormal:[0,0,1],resolvedStamp:ticket.stamp}}],
    } as import('../src/plugins/annotatedCopyTypes').PreparedAnnotatedCopyV1
  })
  f.adapter.stageAnnotated = vi.fn(async () => ({
    publish: (operationId: string, artifactSha256: string) => ({ ...f.publish(operationId, artifactSha256), mode: 'annotated-cad-copy' as const, annotationVersion: 1 as const }),
    dispose: f.stageDispose,
  }))
  f.patch({ draftNoteCount: 1, notesRevision: 7 })
}

describe('annotated workspace contract negotiation', () => {
  it('keeps notes blocked without BOTH host and controller support; no plain-copy fallback', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 })
    f.adapter.capabilities = { apiVersion: 1, enabled: true, annotationVersion: 1, commitKinds: ['cad-copy', 'annotated-cad-copy'] }
    f.patch({ draftNoteCount: 1, notesRevision: 1 })
    expect(useWorkspaceEditor.getState().canApply).toBe(false)
    await expect(workspaceEditors.apply()).rejects.toThrow()
    expect(f.controller.prepareApply).not.toHaveBeenCalled(); expect(f.publish).not.toHaveBeenCalled()
  })
  it('requires explicit annotation version negotiation', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 }); await enableAnnotatedFixture(f)
    f.adapter.capabilities = { apiVersion: 1, enabled: true, commitKinds: ['cad-copy', 'annotated-cad-copy'] }
    f.patch({ revision: 2 }); expect(useWorkspaceEditor.getState().canApply).toBe(false)
  })
  it('rejects a changed notesRevision while preparation is awaiting', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 }); await enableAnnotatedFixture(f)
    const original = f.controller.prepareAnnotatedApply!, gate = deferred<void>(), started = deferred<void>()
    f.controller.prepareAnnotatedApply = async (ticket, signal) => { started.resolve(); await gate.promise; return original(ticket, signal) }
    const pending = workspaceEditors.apply(), refused = expect(pending).rejects.toThrow('bozza')
    await started.promise; f.patch({ notesRevision: 8 }); gate.resolve(); await refused
    expect(f.publish).not.toHaveBeenCalled(); expect(f.unfreeze).toHaveBeenCalledTimes(1)
  })
  it('requires the package to include every draft note', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 }); await enableAnnotatedFixture(f)
    f.patch({ draftNoteCount: 2 })
    await expect(workspaceEditors.apply()).rejects.toThrow('tutte le note')
    expect(f.adapter.stageAnnotated).not.toHaveBeenCalled(); expect(f.publish).not.toHaveBeenCalled()
  })
  it('coalesces annotated double Apply and keeps the display option with its transaction', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 }); await enableAnnotatedFixture(f)
    workspaceEditors.setHideSourceAfterApply(true)
    const a = workspaceEditors.apply(), b = workspaceEditors.apply()
    expect(a).toBe(b); const receipt = await a
    expect(receipt.mode).toBe('annotated-cad-copy'); expect(f.published).toHaveLength(1)
    expect(f.adapter.stageAnnotated).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), { hideSourceAfterApply: true })
    expect(f.controller.prepareApply).not.toHaveBeenCalled()
  })
  it('refuses a prepared annotated result after session cancellation', async () => {
    const f = fixture(); await workspaceEditors.open('test-editor', { bodyId: 1 }); await enableAnnotatedFixture(f)
    const original = f.adapter.stageAnnotated!, gate = deferred<void>(), started = deferred<void>()
    f.adapter.stageAnnotated = async (...args) => { const staged = await original(...args); started.resolve(); await gate.promise; return staged }
    const pending = workspaceEditors.apply(), refused = expect(pending).rejects.toThrow()
    await started.promise; await workspaceEditors.cancel(); gate.resolve(); await refused
    expect(f.publish).not.toHaveBeenCalled(); expect(f.stageDispose).toHaveBeenCalledTimes(1)
  })
})

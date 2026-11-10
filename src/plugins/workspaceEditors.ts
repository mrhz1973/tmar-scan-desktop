// SPDX-License-Identifier: AGPL-3.0-only
// Optional editor host. No dependency on any named plugin or second renderer.
import { create } from 'zustand'
import type { AnnotatedTicketV1 } from './annotatedCopyTypes'
import { validateAnnotatedCopy } from './annotatedCopyValidation'
import { EditorLifetime, abortIfNeeded, editorSha256 } from './editorLifetime'
import type { ApplyTicket, CommitReceipt, DraftStamp, EditorCapabilities, EditorSnapshot, EditorViewportLease, ExitReason, PreparedCadCopy, PreviewStamp, ReticleFrame, SourceBinding, WorkspaceEditorController, WorkspaceEditorDefinition } from './workspaceEditorTypes'
export type * from './workspaceEditorTypes'

export interface BoundEditorSource {
  binding: SourceBinding
  step: Uint8Array
  /** Current displayed result when geometry comes from a verified archive. */
  displayBodyId?: number
  assertCurrent(): void
  subscribe(listener: () => void): () => void
}
export interface OwnedEditorViewport {
  view: EditorViewportLease
  releaseCapture(): void
  /** Optional to preserve compatibility with existing editor adapters. */
  reticleFrame?(): ReticleFrame | null
  onReticleFrameChanged?(listener: () => void): () => void
  /** Host-only explicit action; plugin cannot invoke the camera. */
  frameReticle?(stamp: DraftStamp): boolean
  /** Host-only publication barrier; public editor/controller contract is unchanged. */
  suspendReferenceNotifications(): () => void
  dispose(): void
}
export interface StagedEditorCopy {
  /** Synchronous atomic publication. May fail only with committed state restored. */
  publish(operationId: string, artifactSha256: string): CommitReceipt
  dispose(): void
}
export interface EditorApplyDisplayOptions { readonly hideSourceAfterApply: boolean }
export type EditorHistoryReplay = (source: {
  readonly bodyKey: string; readonly stepSha256: string; readonly step: Uint8Array
  assertCurrent(): void
}, recipe: unknown, signal?: AbortSignal) => Promise<{ valid: boolean; step: string }>
export interface EditorHistoryProvider {
  readonly replay: EditorHistoryReplay
  canPrepare(controller: WorkspaceEditorController): boolean
}
export interface EditorHistoryExport {
  readonly cad?: PreparedCadCopy
  readonly annotated?: Awaited<ReturnType<typeof validateAnnotatedCopy>>
}
export interface PreparedEditorHistory {
  /** Real plugin provenance guard after any serializer-triggered revalidation. */
  assertPreparedCurrent(): void
  /** Rechecks real recipe provenance after export and acquires its history lock. */
  withStaged(exported: EditorHistoryExport, publish: (staged: StagedEditorCopy, hash: string, lockedSnapshot: EditorSnapshot) => Promise<CommitReceipt>): Promise<CommitReceipt>
}
export interface RecoveredEditorSession {
  readonly source: BoundEditorSource
  readonly controller: WorkspaceEditorController
  assertCurrent(): void
  adopt(): void
  release(): Promise<void>
}
export interface WorkspaceEditorHost {
  capabilities: EditorCapabilities
  readSource(bodyId: number, signal: AbortSignal): Promise<BoundEditorSource>
  viewport(source: BoundEditorSource): OwnedEditorViewport
  stage(source: BoundEditorSource, prepared: PreparedCadCopy, signal: AbortSignal, display?: EditorApplyDisplayOptions): Promise<StagedEditorCopy>
  stageAnnotated?(source: BoundEditorSource, prepared: Awaited<ReturnType<typeof validateAnnotatedCopy>>, signal: AbortSignal, display?: EditorApplyDisplayOptions): Promise<StagedEditorCopy>
  prepareHistory?(source: BoundEditorSource, controller: WorkspaceEditorController, replay: EditorHistoryReplay,
    signal: AbortSignal, display?: EditorApplyDisplayOptions): Promise<PreparedEditorHistory>
  recoverHistory?(source: BoundEditorSource, replay: EditorHistoryReplay,
    createSession: (source: BoundEditorSource) => Promise<WorkspaceEditorController>, signal: AbortSignal): Promise<RecoveredEditorSession>
}
export type EditorPhase = 'closed' | 'opening' | 'editing' | 'preparing' | 'committing' | 'closing'
export interface WorkspaceEditorState {
  phase: EditorPhase
  id: string | null
  controller: WorkspaceEditorController | null
  definition: WorkspaceEditorDefinition | null
  snapshot: EditorSnapshot | null
  error: string | null
  canApply: boolean
  canFrameReticle: boolean
  receipt: CommitReceipt | null
  hideSourceAfterApply: boolean
  canPreserveHistory: boolean
  preserveHistory: boolean
}
const CLOSED: WorkspaceEditorState = { phase: 'closed', id: null, controller: null, definition: null, snapshot: null, error: null, canApply: false, canFrameReticle: false, receipt: null, hideSourceAfterApply: true, canPreserveHistory: false, preserveHistory: true }
export const useWorkspaceEditor = create<WorkspaceEditorState>(() => CLOSED)
const definitions = new Map<string, WorkspaceEditorDefinition>()
const historyProviders = new Map<string, EditorHistoryProvider>()
let host: WorkspaceEditorHost | null = null
interface Session {
  id: string; abort: AbortController; life: EditorLifetime; source?: BoundEditorSource
  controller?: WorkspaceEditorController; view?: OwnedEditorViewport; adapter: WorkspaceEditorHost
  closing?: Promise<void>; controllerDisposal?: Promise<void>; apply?: Promise<CommitReceipt>; operationId?: string
  history?: EditorHistoryProvider
}
let active: Session | null = null
const receipts = new Map<string, CommitReceipt>()
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
export const sameDraft = (a: DraftStamp, b: EditorSnapshot['current']): boolean =>
  a.sessionId === b.sessionId && a.sourceEpoch === b.sourceEpoch && a.selectionEpoch === b.selectionEpoch && a.draftEpoch === b.draftEpoch
export const samePreview = (a: PreviewStamp, b: PreviewStamp): boolean => sameDraft(a, b) && a.requestId === b.requestId
const sameSource = (a: SourceBinding, b: SourceBinding) => (Object.keys(b) as (keyof SourceBinding)[]).every(k => a[k] === b[k])

export function registerWorkspaceEditor(definition: WorkspaceEditorDefinition): () => void {
  if (!definition.id || definition.apiVersion !== 1 || definition.workspace !== 'reverse') throw new Error('Unsupported workspace editor definition.')
  if (definitions.has(definition.id)) throw new Error(`Duplicate workspace editor: ${definition.id}`)
  definitions.set(definition.id, definition)
  return () => {
    if (active && useWorkspaceEditor.getState().definition === definition) throw new Error('Close the active editor before unregistering it.')
    definitions.delete(definition.id)
  }
}
/** Composition plugins supply their replay without a core dependency on them. */
export function registerWorkspaceEditorHistory(id: string, provider: EditorHistoryProvider): () => void {
  if (!id || typeof provider.replay !== 'function' || typeof provider.canPrepare !== 'function')
    throw new Error('Provider della cronologia editor non valido.')
  if (historyProviders.has(id)) throw new Error(`Duplicate editor history provider: ${id}`)
  historyProviders.set(id, provider)
  return () => { if (historyProviders.get(id) === provider) historyProviders.delete(id) }
}
export function configureWorkspaceEditorHost(adapter: WorkspaceEditorHost): () => void {
  if (host) throw new Error('A workspace editor host is already installed.')
  host = adapter
  return () => { if (host === adapter) { host = null; void cancel('host-error') } }
}
function assertLive(session: Session): void {
  abortIfNeeded(session.abort.signal)
  if (active !== session) throw new Error('La sessione non è più corrente.')
  session.source?.assertCurrent()
}
function refresh(session: Session): void {
  if (active !== session || session.closing || useWorkspaceEditor.getState().phase === 'committing') return
  try { assertLive(session) } catch (error) {
    useWorkspaceEditor.setState({ error: errorText(error), canApply: false })
    void cancel('source-invalid')
    return
  }
  const snapshot = session.controller?.getSnapshot() ?? null
  const phase = useWorkspaceEditor.getState().phase
  const annotated = !!snapshot && snapshot.draftNoteCount > 0 && Number.isSafeInteger(snapshot.notesRevision) && (snapshot.notesRevision??-1)>=0 &&
    !!session.controller?.prepareAnnotatedApply && !!session.controller?.freezeAnnotated && !!session.adapter.stageAnnotated && session.adapter.capabilities.annotationVersion === 1 && session.adapter.capabilities.commitKinds.includes('annotated-cad-copy')
  const canApply = !!snapshot && phase === 'editing' && snapshot.gesture === 'idle' && (snapshot.draftNoteCount === 0 || annotated) &&
    snapshot.validation.kind === 'valid' && sameDraft(snapshot.validation.stamp, snapshot.current) &&
    snapshot.current.sessionId === session.id && snapshot.current.sourceEpoch === session.source?.binding.sourceEpoch &&
    session.adapter.capabilities.commitKinds.includes('cad-copy')
  const reticle = session.view?.reticleFrame?.() ?? null
  const canFrameReticle = !!snapshot && phase === 'editing' && !session.apply && snapshot.gesture === 'idle' &&
    !!reticle && sameDraft(reticle.stamp, snapshot.current) && !!session.view?.frameReticle
  const canPreserveHistory = !!session.adapter.prepareHistory && !!session.controller &&
    !!session.history?.canPrepare(session.controller)
  useWorkspaceEditor.setState({ snapshot, canApply, canFrameReticle, canPreserveHistory })
}
async function openEditor(id: string, input: { bodyId: number }, recover: boolean): Promise<void> {
  if (active) throw new Error('Concludi prima la modifica corrente.')
  const definition = definitions.get(id), adapter = host
  if (!adapter || !adapter.capabilities.enabled || !definition) throw new Error('Editor integrato non disponibile in questa build.')
  if (!Number.isFinite(input.bodyId) || input.bodyId <= 0) throw new Error('Seleziona un corpo CAD corrente.')
  const history = historyProviders.get(id)
  if (recover && (!history || !adapter.recoverHistory)) throw new Error('Ripresa della modifica non disponibile in questa build.')
  const session: Session = { id: crypto.randomUUID(), abort: new AbortController(), life: new EditorLifetime(), adapter, history }
  active = session
  useWorkspaceEditor.setState({ ...CLOSED, phase: 'opening', id: session.id, definition })
  try {
    session.source = await adapter.readSource(input.bodyId, session.abort.signal)
    assertLive(session)
    const stopInitialSource = session.life.own(session.source.subscribe(() => refresh(session)))
    const viewportSource = session.source
    const createSession = async (source: BoundEditorSource) => {
      session.source = source
      return definition.createSession({
      apiVersion: 1, sessionId: session.id, source: source.binding,
      step: source.step.slice(), capabilities: adapter.capabilities, signal: session.abort.signal,
      assertSourceCurrent: () => assertLive(session), own: cleanup => session.life.own(cleanup),
      reportFatal: message => {
        if (active !== session || session.abort.signal.aborted || session.closing) return
        useWorkspaceEditor.setState({ error: message }); void cancel('host-error')
      },
      })
    }
    let recovered: RecoveredEditorSession | undefined
    let controller: WorkspaceEditorController
    if (recover) {
      recovered = await adapter.recoverHistory!(viewportSource, history!.replay, createSession, session.abort.signal)
      try {
        recovered.assertCurrent(); assertLive(session)
        controller = recovered.controller
        session.source = recovered.source
        recovered.adopt()
        session.controller = controller
      } catch (error) { await recovered.release(); throw error }
    } else controller = await createSession(session.source)
    session.controller = controller
    if (session.source !== viewportSource) {
      stopInitialSource()
      session.life.own(session.source.subscribe(() => refresh(session)))
    }
    try { assertLive(session) } catch (error) { await disposeController(session, 'open-failed'); throw error }
    // The archived upstream geometry and the displayed result have separate identities.
    session.view = adapter.viewport(viewportSource)
    session.life.own(() => session.view?.dispose())
    if (session.view.onReticleFrameChanged)
      session.life.own(session.view.onReticleFrameChanged(() => refresh(session)))
    session.life.own(session.view.view.onInterruption(reason => {
      if (active !== session || session.closing) return
      if (reason === 'blur') cancelGesture()
      else void cancel(reason === 'dispose' ? 'host-error' : 'source-invalid')
    }))
    session.life.own(controller.attach(session.view.view))
    session.life.own(controller.subscribe(() => refresh(session)))
    assertLive(session)
    useWorkspaceEditor.setState({ phase: 'editing', controller })
    refresh(session)
  } catch (error) {
    if (active === session) {
      useWorkspaceEditor.setState({ error: errorText(error) })
      await cancel('open-failed')
    } else session.life.dispose()
    throw error
  }
}
const open = (id: string, input: { bodyId: number }) => openEditor(id, input, false)
const reopen = (id: string, input: { bodyId: number }) => openEditor(id, input, true)
function disposeController(session: Session, reason: ExitReason): Promise<void> {
  if (!session.controller) return Promise.resolve()
  if (!session.controllerDisposal) {
    session.controllerDisposal = Promise.resolve().then(() => session.controller!.dispose(reason))
      .catch(error => { session.life.errors.push(error) })
  }
  return session.controllerDisposal
}
async function closeSession(session: Session, reason: ExitReason): Promise<void> {
  if (session.closing) return session.closing
  // Mark closing before abort/release callbacks can re-enter cancellation.
  let resolve!: () => void
  session.closing = new Promise<void>(done => { resolve = done })
  if (active === session) useWorkspaceEditor.setState({ phase: 'closing', canApply: false, canFrameReticle: false })
  session.abort.abort()
  try { session.view?.releaseCapture() } catch (error) { session.life.errors.push(error) }
  void (async () => {
    try {
      try { session.controller?.cancelGesture() } catch (error) { session.life.errors.push(error) }
      session.life.dispose()
      await disposeController(session, reason)
      if (active !== session) return
      active = null
      const before = useWorkspaceEditor.getState()
      const cleanupError = session.life.errors.length ? `Pulizia editor: ${session.life.errors.map(errorText).join('; ')}` : null
      useWorkspaceEditor.setState({ ...CLOSED, receipt: before.receipt, error: cleanupError ?? before.error })
    } finally { resolve() }
  })()
  return session.closing
}
async function cancel(reason: ExitReason = 'cancelled'): Promise<void> {
  const session = active
  if (!session) return
  if (useWorkspaceEditor.getState().phase === 'committing') throw new Error('La pubblicazione CAD è già in corso.')
  return closeSession(session, reason)
}
function cancelGesture(): boolean {
  if (!active?.controller || useWorkspaceEditor.getState().phase !== 'editing') return false
  const taken = active.controller.cancelGesture()
  if (taken) { active.view?.releaseCapture(); refresh(active) }
  return taken
}
function apply(): Promise<CommitReceipt> {
  const session = active
  if (!session?.controller || !session.source) return Promise.reject(new Error('Nessun editor pronto.'))
  if (session.apply) return session.apply
  refresh(session)
  const state = useWorkspaceEditor.getState()
  if (!state.canApply) return Promise.reject(new Error('Convalida la bozza corrente prima di applicare.'))
  const controller = session.controller, source = session.source
  const display = Object.freeze({ hideSourceAfterApply: state.hideSourceAfterApply })
  const keepHistory = state.preserveHistory && state.canPreserveHistory
  let snapshot = controller.getSnapshot()
  if (snapshot.validation.kind !== 'valid') return Promise.reject(new Error('Geometria non valida.'))
  const common = { operationId: crypto.randomUUID(), source: source.binding, stamp: Object.freeze({ ...snapshot.validation.stamp }) }
  let ticket: ApplyTicket | AnnotatedTicketV1 = Object.freeze(snapshot.draftNoteCount > 0
    ? { ...common, annotationVersion: 1 as const, mode: 'annotated-cad-copy' as const, notesRevision: snapshot.notesRevision! }
    : { ...common, mode: 'cad-copy' as const })
  const assertDraft = () => {
    assertLive(session)
    const current = controller.getSnapshot()
    if (current.validation.kind !== 'valid' || current.gesture !== 'idle' ||
        current.draftNoteCount !== snapshot.draftNoteCount ||
        (ticket.mode === 'annotated-cad-copy' && current.notesRevision !== ticket.notesRevision) ||
        !sameDraft(ticket.stamp, current.current) || !samePreview(current.validation.stamp, ticket.stamp))
      throw new Error('La bozza o le note sono cambiate durante Applica.')
  }
  session.operationId = ticket.operationId
  session.apply = Promise.resolve().then(async () => {
    let unfreeze: (() => void) | undefined, staged: StagedEditorCopy | undefined
    let resumeReferences: (() => void) | undefined
    const publish = async (candidate: StagedEditorCopy, hash: string, lockedSnapshot?: EditorSnapshot): Promise<CommitReceipt> => {
      // Annotated export may refresh native note witnesses before the genuine
      // history lock is taken. Its export ticket remains immutable; publication
      // follows the snapshot bound by that independently checked history lock.
      const expected = lockedSnapshot ?? snapshot
      const assertPublication = () => {
        assertLive(session)
        const current = controller.getSnapshot()
        if (expected.validation.kind !== 'valid' || current.validation.kind !== 'valid' ||
            expected.current.sessionId !== session.id || expected.current.sourceEpoch !== source.binding.sourceEpoch ||
            expected.draftNoteCount !== snapshot.draftNoteCount || current.draftNoteCount !== expected.draftNoteCount ||
            current.gesture !== 'idle' || !sameDraft(expected.current, current.current) ||
            !samePreview(expected.validation.stamp, current.validation.stamp) ||
            (ticket.mode === 'annotated-cad-copy' && current.notesRevision !== expected.notesRevision))
          throw new Error('La bozza o le note sono cambiate prima della pubblicazione.')
      }
      assertPublication()
      resumeReferences = session.view!.suspendReferenceNotifications()
      useWorkspaceEditor.setState({ phase: 'committing', canApply: false })
      // No await between the final lease/stamp checks and atomic publication.
      assertPublication()
      const receipt = candidate.publish(ticket.operationId, hash)
      receipts.set(ticket.operationId, receipt)
      if (receipts.size > 64) receipts.delete(receipts.keys().next().value!)
      useWorkspaceEditor.setState({ receipt })
      unfreeze = undefined
      await closeSession(session, 'applied')
      return receipt
    }
    try {
      assertDraft()
      useWorkspaceEditor.setState({ phase: 'preparing', canApply: false, error: null })
      // Recipe preparation must precede the ordinary export lock.
      const history = keepHistory
        ? await session.adapter.prepareHistory!(source, controller, session.history!.replay, session.abort.signal, display)
        : undefined
      if (history) {
        // Legacy recipe serialization revalidates the same net and its UV notes.
        // The provider must prove that preparation still describes this draft;
        // only then may Apply bind the fresh preview and note revisions.
        assertLive(session); history.assertPreparedCurrent()
        snapshot = controller.getSnapshot()
        if (snapshot.validation.kind !== 'valid') throw new Error('La ricetta non ha una preview convalidata.')
        const preparedTicket = { ...common, stamp: Object.freeze({ ...snapshot.validation.stamp }) }
        ticket = Object.freeze(snapshot.draftNoteCount > 0
          ? { ...preparedTicket, annotationVersion: 1 as const, mode: 'annotated-cad-copy' as const, notesRevision: snapshot.notesRevision! }
          : { ...preparedTicket, mode: 'cad-copy' as const })
      }
      assertDraft()
      unfreeze = ticket.mode === 'cad-copy' ? controller.freeze(ticket) : controller.freezeAnnotated!(ticket)
      let exported: EditorHistoryExport, hash: string
      if (ticket.mode === 'annotated-cad-copy') {
        const supplied = await controller.prepareAnnotatedApply!(ticket, session.abort.signal)
        assertDraft()
        const plan = await validateAnnotatedCopy(supplied, ticket)
        assertDraft()
        if (plan.prepared.notes.length !== snapshot.draftNoteCount) throw new Error('Il pacchetto non conserva tutte le note della bozza.')
        hash = plan.artifactSha256
        exported = { annotated: plan }
      } else {
        const supplied = await controller.prepareApply(ticket, session.abort.signal)
        assertDraft()
        if (supplied.kind !== 'cad-copy' || supplied.operationId !== ticket.operationId || supplied.draftNoteCount !== 0 ||
            supplied.units !== 'mm' || supplied.coordinateFrame !== 'part' || !sameSource(supplied.source, ticket.source) ||
            !samePreview(supplied.stamp, ticket.stamp) || !(supplied.step instanceof Uint8Array) || !supplied.step.byteLength ||
            typeof supplied.name !== 'string' || !supplied.name.trim()) throw new Error('Pacchetto CAD non coerente con la bozza convalidata.')
        const prepared = { ...supplied, source: ticket.source, stamp: ticket.stamp, step: supplied.step.slice() }
        hash = await editorSha256(prepared.step)
        assertDraft()
        exported = { cad: prepared }
      }
      if (history) {
        // freezeHistory verifies the original recipe after export, including
        // any native note-witness refresh triggered by releasing this lock.
        unfreeze()
        unfreeze = undefined
        assertLive(session)
        return await history.withStaged(exported, publish)
      }
      staged = exported.annotated
        ? await session.adapter.stageAnnotated!(source, exported.annotated, session.abort.signal, display)
        : await session.adapter.stage(source, exported.cad!, session.abort.signal, display)
      return await publish(staged, hash)
    } catch (error) {
      if (active === session && !session.abort.signal.aborted) {
        try { unfreeze?.() } catch (cleanup) { session.life.errors.push(cleanup) }
        unfreeze = undefined
        useWorkspaceEditor.setState({ phase: 'editing', error: errorText(error) })
        refresh(session)
      }
      throw error
    } finally {
      try { unfreeze?.() } catch (error) { session.life.errors.push(error) }
      try { staged?.dispose() } catch (error) { session.life.errors.push(error) }
      try { resumeReferences?.() } catch (error) {
        session.life.errors.push(error)
        if (active === session) useWorkspaceEditor.setState({ error: errorText(error) })
      }
      session.apply = undefined
    }
  })
  return session.apply
}
export const workspaceEditors = {
  open, reopen, apply, cancel, cancelGesture,
  setPreserveHistory: (preserveHistory: boolean): boolean => {
    if (!active || active.apply || useWorkspaceEditor.getState().phase !== 'editing' || typeof preserveHistory !== 'boolean') return false
    useWorkspaceEditor.setState({ preserveHistory }); return true
  },
  frameReticle: (): boolean => {
    const session = active
    if (!session?.view || !session.controller || session.apply ||
        useWorkspaceEditor.getState().phase !== 'editing') return false
    try { assertLive(session) } catch { return false }
    const snapshot = session.controller.getSnapshot()
    const reticle = session.view.reticleFrame?.()
    if (!reticle || snapshot.gesture !== 'idle' || !sameDraft(reticle.stamp, snapshot.current)) return false
    return session.view.frameReticle?.(snapshot.current) ?? false
  },
  setHideSourceAfterApply: (hideSourceAfterApply: boolean): boolean => {
    // Capture the display choice before any asynchronous preparation starts.
    if (!active || active.apply || useWorkspaceEditor.getState().phase !== 'editing' || typeof hideSourceAfterApply !== 'boolean') return false
    useWorkspaceEditor.setState({ hideSourceAfterApply }); return true
  },
  capabilities: () => host?.capabilities ?? null,
  active: () => active !== null,
  busy: () => active ? 'Concludi Edit Surface con Applica o Annulla.' : null,
  receipt: (operationId: string) => receipts.get(operationId) ?? null,
  undo: () => { if (active?.controller && useWorkspaceEditor.getState().phase === 'editing' && active.controller.getSnapshot().gesture === 'idle') active.controller.undo() },
  redo: () => { if (active?.controller && useWorkspaceEditor.getState().phase === 'editing' && active.controller.getSnapshot().gesture === 'idle') active.controller.redo() },
}

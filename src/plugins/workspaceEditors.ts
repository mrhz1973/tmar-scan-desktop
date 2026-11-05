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
export interface WorkspaceEditorHost {
  capabilities: EditorCapabilities
  readSource(bodyId: number, signal: AbortSignal): Promise<BoundEditorSource>
  viewport(source: BoundEditorSource): OwnedEditorViewport
  stage(source: BoundEditorSource, prepared: PreparedCadCopy, signal: AbortSignal, display?: EditorApplyDisplayOptions): Promise<StagedEditorCopy>
  stageAnnotated?(source: BoundEditorSource, prepared: Awaited<ReturnType<typeof validateAnnotatedCopy>>, signal: AbortSignal, display?: EditorApplyDisplayOptions): Promise<StagedEditorCopy>
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
}
const CLOSED: WorkspaceEditorState = { phase: 'closed', id: null, controller: null, definition: null, snapshot: null, error: null, canApply: false, canFrameReticle: false, receipt: null, hideSourceAfterApply: true }
export const useWorkspaceEditor = create<WorkspaceEditorState>(() => CLOSED)
const definitions = new Map<string, WorkspaceEditorDefinition>()
let host: WorkspaceEditorHost | null = null
interface Session {
  id: string; abort: AbortController; life: EditorLifetime; source?: BoundEditorSource
  controller?: WorkspaceEditorController; view?: OwnedEditorViewport; adapter: WorkspaceEditorHost
  closing?: Promise<void>; controllerDisposal?: Promise<void>; apply?: Promise<CommitReceipt>; operationId?: string
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
  useWorkspaceEditor.setState({ snapshot, canApply, canFrameReticle })
}
async function open(id: string, input: { bodyId: number }): Promise<void> {
  if (active) throw new Error('Concludi prima la modifica corrente.')
  const definition = definitions.get(id), adapter = host
  if (!adapter || !adapter.capabilities.enabled || !definition) throw new Error('Editor integrato non disponibile in questa build.')
  if (!Number.isFinite(input.bodyId) || input.bodyId <= 0) throw new Error('Seleziona un corpo CAD corrente.')
  const session: Session = { id: crypto.randomUUID(), abort: new AbortController(), life: new EditorLifetime(), adapter }
  active = session
  useWorkspaceEditor.setState({ ...CLOSED, phase: 'opening', id: session.id, definition })
  try {
    session.source = await adapter.readSource(input.bodyId, session.abort.signal)
    assertLive(session)
    session.life.own(session.source.subscribe(() => refresh(session)))
    const controller = await definition.createSession({
      apiVersion: 1, sessionId: session.id, source: session.source.binding,
      step: session.source.step.slice(), capabilities: adapter.capabilities, signal: session.abort.signal,
      assertSourceCurrent: () => assertLive(session), own: cleanup => session.life.own(cleanup),
      reportFatal: message => {
        if (active !== session || session.abort.signal.aborted || session.closing) return
        useWorkspaceEditor.setState({ error: message }); void cancel('host-error')
      },
    })
    session.controller = controller
    try { assertLive(session) } catch (error) { await disposeController(session, 'open-failed'); throw error }
    session.view = adapter.viewport(session.source)
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
  if (session.apply) return session.apply // Double click shares this exact operation.
  refresh(session)
  if (!useWorkspaceEditor.getState().canApply) return Promise.reject(new Error('Convalida la bozza corrente senza note prima di applicare.'))
  const controller = session.controller, source = session.source
  const display = Object.freeze({ hideSourceAfterApply: useWorkspaceEditor.getState().hideSourceAfterApply })
  const snapshot = controller.getSnapshot()
  if (snapshot.validation.kind !== 'valid') return Promise.reject(new Error('Geometria non valida.'))
  const common={operationId:crypto.randomUUID(),source:source.binding,stamp:Object.freeze({...snapshot.validation.stamp})}
  const ticket:ApplyTicket|AnnotatedTicketV1=Object.freeze(snapshot.draftNoteCount>0
    ? {...common,annotationVersion:1 as const,mode:'annotated-cad-copy' as const,notesRevision:snapshot.notesRevision!}
    : {...common,mode:'cad-copy' as const})
  const unchangedNotes=(s:EditorSnapshot)=>s.draftNoteCount===snapshot.draftNoteCount && (ticket.mode==='cad-copy'||s.notesRevision===ticket.notesRevision)
  session.operationId = ticket.operationId
  session.apply = Promise.resolve().then(async () => {
    let unfreeze: (() => void) | undefined, staged: StagedEditorCopy | undefined
    let resumeReferences: (() => void) | undefined
    try {
      assertLive(session)
      unfreeze = ticket.mode==='cad-copy'?controller.freeze(ticket):controller.freezeAnnotated!(ticket)
      useWorkspaceEditor.setState({ phase: 'preparing', canApply: false, error: null })
      let hash:string
      if(ticket.mode==='annotated-cad-copy') {
        const supplied=await controller.prepareAnnotatedApply!(ticket,session.abort.signal)
        assertLive(session)
        const plan=await validateAnnotatedCopy(supplied,ticket)
        assertLive(session)
        if(plan.prepared.notes.length!==snapshot.draftNoteCount)throw new Error('Il pacchetto non conserva tutte le note della bozza.')
        hash=plan.artifactSha256
        staged=await session.adapter.stageAnnotated!(source,plan,session.abort.signal,display)
      } else {
        const supplied = await controller.prepareApply(ticket, session.abort.signal)
        assertLive(session)
        if (supplied.kind !== 'cad-copy' || supplied.operationId !== ticket.operationId || supplied.draftNoteCount !== 0 ||
            supplied.units !== 'mm' || supplied.coordinateFrame !== 'part' || !sameSource(supplied.source, ticket.source) ||
            !samePreview(supplied.stamp, ticket.stamp) || !(supplied.step instanceof Uint8Array) || !supplied.step.byteLength ||
            typeof supplied.name !== 'string' || !supplied.name.trim()) throw new Error('Pacchetto CAD non coerente con la bozza convalidata.')
        const prepared = { ...supplied, source: ticket.source, stamp: ticket.stamp, step: supplied.step.slice() }
        hash = await editorSha256(prepared.step)
        assertLive(session)
        staged = await session.adapter.stage(source, prepared, session.abort.signal, display)
      }
      assertLive(session)
      const current = controller.getSnapshot()
      if (current.validation.kind !== 'valid' || current.gesture !== 'idle' || !unchangedNotes(current) ||
          !sameDraft(ticket.stamp, current.current) || !samePreview(current.validation.stamp, ticket.stamp))
        throw new Error('La bozza è cambiata durante Applica.')
      // The committed store will invalidate this old source lease. Keep its
      // reference callbacks quiet until close, or until rollback restores it.
      // Source/session/stamp checks below remain live throughout publication.
      resumeReferences = session.view!.suspendReferenceNotifications()
      useWorkspaceEditor.setState({ phase: 'committing', canApply: false })
      // No await between final source check and publication.
      assertLive(session)
      const final = controller.getSnapshot()
      if (final.validation.kind !== 'valid' || final.gesture !== 'idle' || !unchangedNotes(final) ||
          !sameDraft(ticket.stamp, final.current) || !samePreview(final.validation.stamp, ticket.stamp))
        throw new Error('La bozza è cambiata prima della pubblicazione.')
      const receipt = staged.publish(ticket.operationId, hash)
      receipts.set(ticket.operationId, receipt)
      if (receipts.size > 64) receipts.delete(receipts.keys().next().value!)
      useWorkspaceEditor.setState({ receipt })
      unfreeze = undefined
      await closeSession(session, 'applied')
      return receipt
    } catch (error) {
      if (active === session && !session.abort.signal.aborted) {
        try { unfreeze?.() } catch (cleanup) { session.life.errors.push(cleanup) }
        useWorkspaceEditor.setState({ phase: 'editing', error: errorText(error) })
        refresh(session)
      }
      throw error
    } finally {
      try { staged?.dispose() } catch (error) { session.life.errors.push(error) }
      // Successful close has disposed the notification queue. After a failed
      // publication, the source is restored and the live draft can refresh.
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
  open, apply, cancel, cancelGesture,
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

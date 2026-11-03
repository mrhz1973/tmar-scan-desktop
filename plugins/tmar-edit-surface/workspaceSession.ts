// SPDX-License-Identifier: AGPL-3.0-only
// @ts-ignore -- optional host types are supplied by ScanRuler's workspace-editor host.
import type { ApplyTicket, DraftStamp, EditorSnapshot, ExitReason, PreparedCadCopy, PreviewStamp, SourceBinding, WorkspaceEditorContext, WorkspaceEditorController } from '../../src/plugins/workspaceEditorTypes'
import { boundaryLocked, type Net, type Point } from './brep'
import type { DraftAnchor, FaceInfo, Preview } from './editorKernel'
import { dragDirection, type DragMode } from './localFrame'
import { selectNetPoints, type NetSelectionMode } from './netSelection'
import { SurfaceDraft, type SurfaceDraftSnapshot } from './surfaceDraft'
import { SurfaceRuntime } from './surfaceRuntime'
import { mirrorEdit, mirrorPartners } from './symmetry'
import type { StripMove } from './sheetExtension'
import type { WorkspaceLayerFactory, WorkspaceSurfaceLayer, WorkspaceSurfaceLayerOwner, WorkspaceSurfaceView, WorkspaceSurfaceViewState, WorkspaceStripeSettings, WorkspaceStripViewState } from './workspaceBridge'

export interface WorkspaceSurfaceNote {
  readonly id: string
  readonly text: string
  readonly at: Point
  readonly normal: Point
  readonly revision: number
}
interface Note extends WorkspaceSurfaceNote { readonly anchor: DraftAnchor }
export interface WorkspaceSurfacePanelState {
  readonly faces: readonly FaceInfo[]
  readonly face: number
  readonly net: Net | null
  readonly selected: readonly number[]
  readonly locked: readonly number[]
  readonly manualLocks: readonly number[]
  readonly continuity: 'G0' | 'G1'
  readonly freeBoundary: boolean
  readonly canFreeBoundary: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly calculating: boolean
  readonly busy: boolean
  readonly message: string | null
  readonly snap: boolean
  readonly snapDistance: number
  readonly dragMode: DragMode
  readonly axis: number
  readonly dragStrength: number
  readonly selectionMode: NetSelectionMode
  readonly showNet: boolean
  readonly stripes: WorkspaceStripeSettings | null
  readonly symmetry: boolean
  readonly mirrorAxis: number
  readonly mirrorOffset: number
  readonly symmetryPartners: readonly number[] | null
  readonly symmetryBlocked: boolean
  readonly transparency: number
  readonly placingNote: boolean
  readonly notes: readonly WorkspaceSurfaceNote[]
  readonly gesture: 'idle' | 'pole' | 'strip'
  readonly canBeginStrip: boolean
  readonly directStripAxis: 0 | 1 | 2
  readonly directStripError: string | null
  readonly canExportStep: boolean
  readonly strip: WorkspaceStripViewState | null
}

interface StripResult {
  readonly step: string
  readonly preview: Preview
  readonly paths: readonly (readonly Point[])[]
  readonly moves: readonly StripMove[]
  readonly addedArea: number
  readonly totalArea: number
  readonly requestId: number
}
interface StripMode {
  readonly baseNet: Net
  readonly basePreviewRevision: number
  readonly initialPaths: readonly (readonly Point[])[]
  frames: (StripResult | null)[]
  at: number
  selectedEdge: number
  axis: 0 | 1 | 2
  delta: Point
  error: string | null
}
interface DirectIdentity { readonly revision:number; readonly selectionEpoch:number; readonly face:number; readonly net:Net }
interface DirectCache extends DirectIdentity { readonly paths:readonly (readonly Point[])[] }
interface DirectPending extends DirectIdentity { readonly controller:AbortController; readonly generation:number; readonly key:string }
type Frozen = { readonly ticketKey: string; readonly operationId: string; readonly stamp: PreviewStamp; readonly source: SourceBinding; readonly stripResult: StripResult | null; preparing: boolean }
type Options = {
  /** Injected only for a controlled worker in tests; the session owns this runtime. */
  runtime?: SurfaceRuntime
  sha256?: (bytes: Uint8Array) => Promise<string>
}
const hashStep = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const stampKey = (stamp: PreviewStamp) => JSON.stringify([stamp.sessionId, stamp.sourceEpoch, stamp.selectionEpoch, stamp.draftEpoch, stamp.requestId])
const sourceKey = (source: SourceBinding) => JSON.stringify([
  source.documentEpoch, source.sourceEpoch, source.bodyId, source.bodyKey, source.buildVersion,
  source.kernelGeneration, source.frameRevision, source.stepSha256, source.units, source.coordinateFrame,
])
const ticketKey = (ticket: ApplyTicket) => JSON.stringify([ticket.operationId, ticket.mode, sourceKey(ticket.source), stampKey(ticket.stamp)])
const finitePoint = (point: readonly number[]) => point.length === 3 && point.every(Number.isFinite)
const pointCopy = (point: readonly number[]): Point => [point[0], point[1], point[2]]
const freezePoint = (point: readonly number[]): Point => Object.freeze(pointCopy(point)) as Point
const sameArray = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i])
const abortIf = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Operazione annullata.', 'AbortError') }
const samePoint = (a: readonly number[], b: readonly number[]) => finitePoint(a) && finitePoint(b) && a.every((v, i) => Math.abs(v - b[i]) < 1e-7)
const samePath = (a: readonly Point[], b: readonly Point[]) => a.length === b.length &&
  (a.every((point, i) => samePoint(point, b[i])) || a.every((point, i) => samePoint(point, b[b.length - 1 - i])))
const freezePaths = (paths: Point[][]): readonly (readonly Point[])[] => {
  if (!Array.isArray(paths) || !paths.length || paths.some(path => !Array.isArray(path) || path.length < 2 || path.some(p => !Array.isArray(p) || !finitePoint(p))))
    throw new Error('Bordi liberi non validi.')
  return Object.freeze(paths.map(path => Object.freeze(path.map(freezePoint))))
}

/**
 * Real CAD draft session. All points are in source-part millimetres. The host
 * owns its canvas and project; this controller owns only its worker, draft,
 * layer and notes. A saved note cannot yet be published as a cad-copy.
 */
export class WorkspaceSurfaceSession implements WorkspaceEditorController, WorkspaceSurfaceLayerOwner {
  private readonly runtime: SurfaceRuntime
  private readonly draft: SurfaceDraft
  private readonly listeners = new Set<() => void>()
  private readonly source: SourceBinding
  private readonly sourceId: string
  private readonly digest: (bytes: Uint8Array) => Promise<string>
  private readonly unsubscribeDraft: () => void
  private readonly releaseOwned: () => void
  private readonly onAbort = () => { this.cleanup() }
  private layer: WorkspaceSurfaceLayer | null = null
  private disposed = false
  private frozen: Frozen | null = null
  private mutating = false
  private busy = false
  private exportGeneration = 0
  private gesture: 'idle' | 'pole' | 'strip' = 'idle'
  private gestureNet: Net | null = null
  private strip: StripMode | null = null
  private stripPending = false
  private stripGeneration = 0
  private stripRequestId = 0
  private stripAbort: AbortController | null = null
  private directStripAxis: 0 | 1 | 2 = 2
  private directCache: DirectCache | null = null
  private directPending: DirectPending | null = null
  private directGeneration = 0
  private directFailedKey: string | null = null
  private directGestureOrigin = false
  private face = -1
  private faces: readonly FaceInfo[] = Object.freeze([])
  private sourcePreview: Preview | null = null
  private selectionEpoch = 0
  private draftEpoch = 0
  private historyRevision = 0
  private revision = 0
  private message: string | null = null
  private snap = true
  private snapDistance = 1
  private dragMode: DragMode = 'axis'
  private axis = 2
  private dragStrength = 1
  private selectionMode: NetSelectionMode = 'auto'
  private showNet = true
  private symmetry = false
  private transparency = 0
  private mirrorAxis = 0
  private mirrorOffset = 0
  private stripes: WorkspaceStripeSettings | null = null
  private placingNote = false
  private notes: readonly Note[] = Object.freeze([])
  private resolvingNotes = false
  private failedNoteRevision: number | null = null
  private symmetryCache: { net: Net; axis: number; offset: number; partners: number[] } | null = null
  private lockCache: { net: Net | null; locks: readonly number[]; trim: readonly number[]; continuity: 'G0' | 'G1'; free: boolean; value: readonly number[] } | null = null
  private pinCache: { notes: readonly Note[]; revision: number | undefined; value: readonly Point[] } | null = null
  private snapshot!: EditorSnapshot
  private panel!: WorkspaceSurfacePanelState
  private viewState!: WorkspaceSurfaceViewState

  private constructor(private readonly context: WorkspaceEditorContext, private readonly layerFactory: WorkspaceLayerFactory, options: Options) {
    this.source = Object.freeze({ ...context.source })
    this.sourceId = sourceKey(this.source)
    this.digest = options.sha256 ?? hashStep
    this.runtime = options.runtime ?? new SurfaceRuntime()
    try { this.draft = new SurfaceDraft(this.runtime) }
    catch (error) { this.runtime.dispose(); throw error }
    this.unsubscribeDraft = this.draft.subscribe(() => {
      if (!this.mutating && !this.disposed) { this.refresh(); this.resolveNotes() }
    })
    try { this.releaseOwned = context.own(() => this.cleanup()) }
    catch (error) { this.unsubscribeDraft(); this.draft.dispose(); this.runtime.dispose(); throw error }
    context.signal.addEventListener('abort', this.onAbort, { once: true })
    if (context.signal.aborted) this.cleanup()
    if (!this.disposed) this.refresh()
  }

  static async create(context: WorkspaceEditorContext, layerFactory: WorkspaceLayerFactory, options: Options = {}): Promise<WorkspaceSurfaceSession> {
    if (context.apiVersion !== 1 || !context.sessionId || !context.capabilities?.enabled ||
        context.capabilities.apiVersion !== 1 || !context.capabilities.commitKinds.includes('cad-copy') ||
        context.source?.units !== 'mm' || context.source.coordinateFrame !== 'part' ||
        !context.source.documentEpoch || !context.source.bodyKey ||
        !Number.isSafeInteger(context.source.bodyId) || context.source.bodyId < 0 ||
        ![context.source.sourceEpoch, context.source.buildVersion, context.source.kernelGeneration, context.source.frameRevision]
          .every((value: number) => Number.isSafeInteger(value) && value >= 0) ||
        !/^[a-f0-9]{64}$/i.test(context.source.stepSha256) ||
        !(context.step instanceof Uint8Array) || !context.step.byteLength)
      throw new Error('Sorgente CAD o contratto host non valido.')
    abortIf(context.signal)
    context.assertSourceCurrent()
    const session = new WorkspaceSurfaceSession(context, layerFactory, options)
    try {
      const bytes = context.step.slice()
      const hash = await session.digest(bytes)
      session.assertLive()
      if (hash.toLowerCase() !== session.source.stepSha256.toLowerCase()) throw new Error('Il contenuto STEP non corrisponde alla sorgente.')
      session.busy = true; session.refresh()
      const result = await session.runtime.worker.ask<{faces: FaceInfo[]; preview: Preview}>(
        { action: 'open', step: new TextDecoder().decode(bytes) }, context.signal)
      session.assertLive()
      if (!Array.isArray(result.faces) || !result.preview || !Array.isArray(result.preview.faceMeshes) ||
          result.preview.faceMeshes.length !== result.faces.length || result.preview.valid !== true)
        throw new Error('Il motore CAD non ha restituito una sorgente valida e le sue facce.')
      session.faces = Object.freeze(result.faces.map((face, index) => {
        if (face.index !== index || !Array.isArray(face.trimLocks) || !Array.isArray(face.hiddenPoles))
          throw new Error('Indice o protezioni delle facce CAD non validi.')
        return Object.freeze({ ...face, trimLocks: Object.freeze([...face.trimLocks]) as unknown as number[],
          hiddenPoles: Object.freeze([...face.hiddenPoles]) as unknown as number[] })
      }))
      session.sourcePreview = result.preview
      session.busy = false
      session.refresh()
      return session
    } catch (error) {
      await session.dispose('open-failed')
      throw error
    }
  }

  getSnapshot = (): EditorSnapshot => this.snapshot
  getPanelState = (): WorkspaceSurfacePanelState => this.panel
  getViewState = (): WorkspaceSurfaceViewState => {
    // Host source revocation can arrive without a draft event. Never hand the
    // layer boundaries that no longer belong to the live source lease.
    if ((this.directCache || this.directPending) &&
        !this.matchesDirect(this.directCache ?? this.directPending, this.directIdentity())) {
      this.clearDirectCache()
    }
    return this.viewState
  }
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  attach(view: WorkspaceSurfaceView): () => void {
    this.assertMutable()
    if (this.layer) throw new Error('La vista di Edit Surface è già collegata.')
    const layer = this.layerFactory(view, this)
    this.layer = layer
    let attached = true
    return () => {
      if (!attached) return
      attached = false
      if (this.layer === layer) this.layer = null
      layer.dispose()
    }
  }

  async chooseFace(index: number, discardChanges = false): Promise<void> {
    this.assertMutable()
    if (this.strip || this.stripPending) throw new Error('Chiudi prima la modifica del bordo.')
    const face = this.faces[index]
    if (!face || !Number.isInteger(index)) throw new Error('Faccia non disponibile.')
    if (face.reason) throw new Error(face.reason)
    if (this.gesture !== 'idle') throw new Error('Termina prima il trascinamento.')
    if (index === this.face && this.draft.getSnapshot().net) return
    if (this.notes.length) throw new Error('Rimuovi le note prima di cambiare faccia.')
    if (this.snapshot.dirty && !discardChanges) throw new Error('La bozza contiene modifiche: conferma prima di cambiare faccia.')
    const previousContinuity = this.draft.getSnapshot().continuity
    this.change(() => {
      this.busy = true; this.selectionEpoch++; this.face = -1; this.message = null
      this.placingNote = false; this.failedNoteRevision = null
      this.draft.reset({ preserveContinuity: true })
    })
    const epoch = this.selectionEpoch
    try {
      const net = await this.runtime.worker.ask<Net>({ action: 'select', face: index }, this.context.signal)
      this.assertLive()
      if (epoch !== this.selectionEpoch) throw new Error('Selezione faccia superata.')
      this.change(() => { this.draft.install(net, { continuity: previousContinuity, trimLocks: face.trimLocks }); this.face = index; this.busy = false }, true)
    } catch (error) {
      if (!this.disposed && epoch === this.selectionEpoch) {
        this.busy = false; this.face = -1; this.message = String((error as Error)?.message ?? error); this.refresh()
      }
      throw error
    }
  }

  selectPoints(ids: readonly number[], additive: boolean): void {
    this.change(() => this.draft.setSelection(selectNetPoints([...this.draft.getSnapshot().selected], [...ids], additive)))
  }
  selectAllFree(): void { this.change(() => { const net = this.requireNet(), locked = new Set(this.viewState.locked); this.draft.setSelection(net.poles.flatMap((_, i) => locked.has(i) ? [] : [i])) }) }
  clearSelection(): void { this.change(() => this.draft.setSelection([])) }
  beginPoleGesture(): boolean {
    this.assertMutable()
    if (this.strip || this.stripPending) throw new Error('Chiudi prima la modifica del bordo.')
    if (this.gesture !== 'idle' || !this.editable().length || !this.draft.getSnapshot().committedNet) return false
    this.change(() => { this.gesture = 'pole'; this.gestureNet = this.draft.getSnapshot().committedNet })
    return true
  }
  previewPoles(poles: Point[]): void {
    this.change(() => {
      if (this.gesture !== 'pole' || !this.gestureNet) throw new Error('Nessun trascinamento attivo.')
      this.draft.preview({ ...this.gestureNet, poles: this.mirroredPoles(this.gestureNet, poles) })
    }, false, true)
  }
  finishPoleGesture(poles: Point[] | null): void {
    // The layer can release a captured pointer while the host revokes the
    // session. Closing discards the gesture; it must not attempt a CAD write.
    if (!poles && (this.disposed || this.context.signal.aborted || !this.runtime.active)) {
      this.gesture = 'idle'; this.gestureNet = null
      return
    }
    this.change(() => {
      if (this.gesture !== 'pole' || !this.gestureNet) return
      const net = this.gestureNet
      try { if (poles) this.draft.commit({ ...net, poles: this.mirroredPoles(net, poles) }); else this.draft.cancelDraft() }
      finally { this.gesture = 'idle'; this.gestureNet = null }
    }, false, true)
  }
  cancelGesture(): boolean {
    // The layer may already hold the pointer while waiting to distinguish a
    // click on the cage from a drag. That capture precedes a pole gesture.
    if (this.disposed || (this.gesture === 'idle' && !this.layer)) return false
    this.assertMutable()
    const hadGesture = this.gesture !== 'idle'
    const layerCancelled = this.layer?.cancelGesture() ?? false // May synchronously finish the controller gesture.
    if (this.gesture === 'pole') this.finishPoleGesture(null)
    else if (this.gesture === 'strip') this.cancelStripGesture()
    return hadGesture || layerCancelled
  }
  undo(): void { this.change(() => { if (this.strip) { if (this.strip.at > 0) { this.strip.at--; this.strip.selectedEdge = -1; this.strip.delta = [0,0,0]; this.strip.error = null; this.message = null; this.historyRevision++ } } else this.draft.undo() }, false, false, true) }
  redo(): void { this.change(() => { if (this.strip) { if (this.strip.at + 1 < this.strip.frames.length) { this.strip.at++; this.strip.selectedEdge = -1; this.strip.delta = [0,0,0]; this.strip.error = null; this.message = null; this.historyRevision++ } } else this.draft.redo() }, false, false, true) }

  /** Begin on one validated open face. Strip history is independent of pole history. */
  async beginStrip(): Promise<void> {
    this.assertMutable()
    if (this.strip || this.stripPending || this.gesture !== 'idle' || this.notes.length || this.placingNote)
      throw new Error('Termina le altre operazioni e rimuovi le note prima di duplicare il bordo.')
    const d = this.draft.getSnapshot(), revision = d.preview?.previewRevision
    if (this.faces.length !== 1 || !this.faces[this.face]?.openSheet || d.preview?.faceMeshes.length !== 1 ||
        !d.net || d.validNet !== d.net || d.calculating || d.previewStale || revision === undefined || this.snapshot.validation.kind !== 'valid')
      throw new Error('Serve una superficie aperta a una sola faccia con anteprima valida.')
    const cached = this.directCache
    if (cached && this.matchesDirect(cached, this.directIdentity())) {
      this.change(() => {
        this.strip = { baseNet:cached.net, basePreviewRevision:cached.revision, initialPaths:cached.paths,
          frames:[null], at:0, selectedEdge:-1, axis:this.directStripAxis, delta:[0,0,0], error:null }
        this.directGestureOrigin = false; this.message = null
      })
      return
    }
    const net = d.net, generation = ++this.stripGeneration, controller = new AbortController()
    this.change(() => { this.stripPending = true; this.stripAbort = controller; this.busy = true; this.message = null })
    try {
      const paths = freezePaths(await this.runtime.worker.ask<Point[][]>({ action:'sheetEdges', previewRevision:revision }, controller.signal))
      this.assertLive()
      const current = this.draft.getSnapshot()
      if (generation !== this.stripGeneration || !this.stripPending || current.net !== net || current.validNet !== net ||
          current.preview?.previewRevision !== revision || this.notes.length || this.placingNote)
        throw new Error('Anteprima del bordo superata.')
      this.change(() => {
        this.strip = { baseNet:net, basePreviewRevision:revision, initialPaths:paths, frames:[null], at:0,
          selectedEdge:-1, axis:this.directStripAxis, delta:[0,0,0], error:null }
        this.directGestureOrigin = false
        this.stripPending = false; this.stripAbort = null; this.busy = false
      }, true, false, true)
    } catch (error) {
      if (!this.disposed && generation === this.stripGeneration) {
        this.stripPending = false; this.stripAbort = null; this.busy = false
        this.message = String((error as Error)?.message ?? error); this.refresh()
      }
      throw error
    }
  }

  /** A discarded history requires explicit confirmation, including redo frames. */
  cancelStrip(discardChanges = false): void {
    this.assertMutable(true)
    if (!this.strip && !this.stripPending) return
    if (this.strip?.frames.some(Boolean) && !discardChanges)
      throw new Error('La bozza del bordo contiene modifiche: conferma prima di scartarla.')
    if (this.gesture === 'strip') this.cancelGesture()
    this.stripGeneration++
    this.stripAbort?.abort()
    this.change(() => { this.strip = null; this.stripPending = false; this.stripAbort = null; this.busy = false; this.directGestureOrigin = false; this.message = null }, true, false, true)
  }

  selectStripEdge(index: number): void {
    this.change(() => {
      const strip = this.requireStrip(), paths = strip.frames[strip.at]?.paths ?? strip.initialPaths
      if (!Number.isInteger(index) || index < 0 || index >= paths.length) throw new Error('Scegli un bordo libero valido.')
      strip.selectedEdge = index; strip.delta = [0,0,0]; strip.error = null; this.message = null
    }, false, false, true)
  }

  setStripAxis(axis: 0 | 1 | 2): void {
    this.change(() => {
      const strip = this.requireStrip()
      if (axis !== 0 && axis !== 1 && axis !== 2) throw new Error('Direzione del bordo non valida.')
      strip.axis = axis; this.directStripAxis = axis
    }, false, false, true)
  }

  /** The direct-handle axis is independent of the pole manipulation axis. */
  setDirectStripAxis(axis: 0 | 1 | 2): void {
    this.change(() => {
      if (axis !== 0 && axis !== 1 && axis !== 2) throw new Error('Direzione del bordo non valida.')
      this.directStripAxis = axis
      if (this.strip) this.strip.axis = axis
    }, false, false, true)
  }

  /** Retry the direct boundary lookup only after an explicit user request. */
  retryDirectStripEdges(): void {
    const identity = this.directIdentity()
    if (!identity || this.directPending || this.directCache) return
    const key = `${identity.selectionEpoch}:${identity.revision}`
    if (this.directFailedKey !== key) return
    this.directFailedKey = null
    this.refresh()
  }

  /** Promote one prevalidated cached edge and start a gesture without awaiting the worker. */
  beginDirectStripGesture(edge: number, revision: number): boolean {
    const cached = this.directCache, current = this.directIdentity()
    // A stale hit cannot cancel the in-flight read for a newer preview.
    if (!cached) {
      if (this.directPending && !this.matchesDirect(this.directPending, current)) this.clearDirectCache()
      return false
    }
    if (!this.matchesDirect(cached, current)) {
      this.clearDirectCache()
      return false
    }
    if (revision !== cached.revision || !Number.isInteger(edge) || edge < 0 || edge >= cached.paths.length) return false
    this.change(() => {
      this.strip = { baseNet:cached.net, basePreviewRevision:cached.revision, initialPaths:cached.paths,
        frames:[null], at:0, selectedEdge:edge, axis:this.directStripAxis, delta:[0,0,0], error:null }
      this.directGestureOrigin = true; this.gesture = 'strip'; this.message = null
    })
    return true
  }

  /** The layer may show the delta immediately; only finish requests CAD validation. */
  beginStripGesture(index: number): boolean {
    this.selectStripEdge(index)
    this.change(() => { this.gesture = 'strip' }, false, false, true)
    return true
  }
  previewStripDelta(delta: Point): void {
    this.change(() => {
      if (this.gesture !== 'strip' || !finitePoint(delta)) throw new Error('Spostamento del bordo non valido.')
      this.requireStrip().delta = pointCopy(delta)
    }, false, true, true)
  }
  async finishStripGesture(delta: Point | null): Promise<void> {
    if (!delta && (this.disposed || this.context.signal.aborted || !this.runtime.active)) { this.gesture = 'idle'; return }
    if (this.gesture !== 'strip') throw new Error('Nessun trascinamento del bordo attivo.')
    if (delta) await this.applyStripDeltaInternal(delta, true)
    else this.cancelStripGesture()
  }

  /** Coordinates are source-part mm; the saved STEP is the validated worker result. */
  async applyStripDelta(delta: Point): Promise<void> {
    return this.applyStripDeltaInternal(delta, false)
  }
  private async applyStripDeltaInternal(delta: Point, fromGesture: boolean): Promise<void> {
    this.assertMutable()
    if (this.gesture !== 'idle' && !(fromGesture && this.gesture === 'strip')) throw new Error('Termina prima il trascinamento.')
    const strip = this.requireStrip(), base = this.draft.getSnapshot(), frame = strip.frames[strip.at]
    const paths = frame?.paths ?? strip.initialPaths, edge = strip.selectedEdge, path = paths[edge]
    if (!path || !Number.isInteger(edge)) throw new Error('Scegli prima un bordo libero.')
    if (!finitePoint(delta) || Math.hypot(...delta) <= 1e-7) throw new Error('Indica uno spostamento del bordo diverso da zero.')
    if (base.net !== strip.baseNet || base.validNet !== strip.baseNet || base.calculating || base.previewStale ||
        base.preview?.previewRevision !== strip.basePreviewRevision || this.notes.length || this.placingNote)
      throw new Error('La superficie di partenza non è più valida.')
    const previous = frame?.moves ?? []
    if (previous.length >= 64) throw new Error('Raggiunto il limite di 64 estensioni per bozza.')
    const copyMove = (move: StripMove): StripMove => ({ edge:move.edge, delta:pointCopy(move.delta), path:move.path.map(pointCopy) })
    const requested = pointCopy(delta), chosenPath = path.map(pointCopy), generation = ++this.stripGeneration, controller = new AbortController(), at = strip.at
    this.change(() => { this.gesture = 'idle'; this.directGestureOrigin = false; this.stripPending = true; this.stripAbort = controller; this.busy = true; strip.error = null; strip.delta = requested; this.message = null }, false, fromGesture, true)
    try {
      const result = await this.runtime.worker.ask<{step:string;preview:Preview;paths:Point[][];moves:StripMove[];addedArea:number;totalArea:number}>({
        action:'duplicateSheetEdge', previewRevision:strip.basePreviewRevision, edge, delta:requested,
        previous:previous.map(copyMove), path:chosenPath,
      }, controller.signal)
      this.assertLive()
      const current = this.draft.getSnapshot()
      if (generation !== this.stripGeneration || this.strip !== strip || !this.stripPending || strip.at !== at ||
          strip.frames[at] !== frame || strip.selectedEdge !== edge || current.net !== strip.baseNet ||
          current.validNet !== strip.baseNet || current.preview?.previewRevision !== strip.basePreviewRevision || this.notes.length || this.placingNote)
        throw new Error('Risultato del bordo superato.')
      if (!result || typeof result.step !== 'string' || !result.step.trim() || !result.preview?.valid ||
          !Array.isArray(result.preview.faceMeshes) || result.preview.faceMeshes.length !== previous.length + 2 ||
          !Number.isFinite(result.addedArea) || result.addedArea <= 1e-8 || !Number.isFinite(result.totalArea) || result.totalArea <= 0 ||
          !Array.isArray(result.moves) || result.moves.length !== previous.length + 1)
        throw new Error('Il motore CAD non ha restituito una superficie estesa valida.')
      const moves = result.moves.map((move, i) => {
        if (!Number.isInteger(move.edge) || move.edge < 0 || !Array.isArray(move.delta) || !finitePoint(move.delta) ||
            !Array.isArray(move.path) || move.path.length < 2 || move.path.some(p => !Array.isArray(p) || !finitePoint(p)))
          throw new Error('Cronologia del bordo non valida.')
        const expected = i < previous.length ? previous[i] : { delta:requested, path:chosenPath }
        if (!samePoint(move.delta, expected.delta) || !samePath(move.path, expected.path)) throw new Error('Cronologia del bordo non corrispondente.')
        return Object.freeze({ edge:move.edge, delta:freezePoint(move.delta), path:Object.freeze(move.path.map(freezePoint)) as unknown as Point[] })
      })
      const validated: StripResult = Object.freeze({ step:result.step, preview:result.preview, paths:freezePaths(result.paths),
        moves:Object.freeze(moves), addedArea:result.addedArea, totalArea:result.totalArea, requestId:++this.stripRequestId })
      this.change(() => {
        strip.frames = [...strip.frames.slice(0, at + 1), validated]; strip.at = at + 1; strip.selectedEdge = -1
        strip.delta = [0,0,0]; strip.error = null; this.stripPending = false; this.stripAbort = null; this.busy = false; this.historyRevision++
      }, true, false, true)
    } catch (error) {
      if (!this.disposed && generation === this.stripGeneration) {
        this.stripPending = false; this.stripAbort = null; this.busy = false
        if (this.strip === strip) strip.error = String((error as Error)?.message ?? error)
        this.message = String((error as Error)?.message ?? error); this.refresh()
      }
      throw error
    }
  }

  setContinuity(value: 'G0' | 'G1'): void { this.change(() => this.draft.setContinuity(value)) }
  setFreeBoundary(value: boolean): void {
    this.change(() => {
      if (value && !this.faces[this.face]?.freeBoundary) throw new Error('Il bordo di questa faccia non è libero.')
      this.draft.setFreeBoundary(value)
    })
  }
  lockSelected(locked: boolean): void {
    this.change(() => {
      const state = this.draft.getSnapshot()
      this.draft.setLocks(locked ? [...state.locks, ...state.selected] : state.locks.filter(i => !state.selected.includes(i)))
    })
  }
  restoreOriginal(): void { this.change(() => this.draft.restoreOriginal()) }
  moveSelected(distance: number): void {
    this.change(() => {
      if (!Number.isFinite(distance)) throw new Error('Distanza non valida.')
      const net = this.requireNet(), ids = this.editable(), direction = ids.length ? dragDirection(net, ids[0], this.dragMode, this.axis) : null
      if (!direction) throw new Error('Seleziona un punto libero e una direzione valida.')
      this.transform(net, ids, p => p.map((x, i) => x + direction[i] * distance) as Point)
    })
  }
  smoothSelected(strength: number): void {
    this.change(() => {
      if (!Number.isFinite(strength) || strength <= 0 || strength > 1) throw new Error('Intensità non valida.')
      const net = this.requireNet(), ids = this.editable()
      this.transform(net, ids, (p, i) => {
        const u = Math.floor(i/net.nv), v = i % net.nv
        const adjacent = [u>0?i-net.nv:-1,u+1<net.nu?i+net.nv:-1,v>0?i-1:-1,v+1<net.nv?i+1:-1].filter(n => n >= 0)
        return p.map((x, d) => x*(1-strength) + adjacent.reduce((sum, n) => sum+net.poles[n][d], 0)/adjacent.length*strength) as Point
      })
    })
  }
  flattenSelected(): void {
    this.change(() => {
      const base = this.draft.getSnapshot().originalNet, net = this.requireNet(), ids = this.editable()
      if (!base) throw new Error('Sorgente CAD assente.')
      const a = base.poles[0], u = base.poles[(base.nu-1)*base.nv].map((v,i)=>v-a[i]), v = base.poles[base.nv-1].map((x,i)=>x-a[i])
      const normal = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]], len = Math.hypot(...normal)
      if (len < 1e-10) throw new Error('I tre angoli non definiscono un piano.')
      this.transform(net, ids, p => {
        const d = p.reduce((sum,x,i)=>sum+(x-a[i])*normal[i]/len,0)
        return p.map((x,i)=>x-d*normal[i]/len) as Point
      })
    })
  }
  stretchSelected(factor: number): void {
    this.change(() => {
      if (!Number.isFinite(factor) || factor <= 0 || factor > 3) throw new Error('Fattore non valido.')
      const net = this.requireNet(), ids = this.editable(), axis = this.axis
      const center = net.poles.reduce((sum,p)=>sum+p[axis],0)/net.poles.length
      this.transform(net, ids, p => p.map((x,i)=>i===axis?center+(x-center)*factor:x) as Point)
    })
  }

  /** Symmetry settings are session-local and are not CAD history entries. */
  setSymmetry(value: boolean): void {
    this.change(() => { if (typeof value !== 'boolean') throw new Error('Simmetria non valida.'); this.symmetry = value })
  }
  setMirrorAxis(value: number): void {
    this.change(() => { if (![0,1,2].includes(value)) throw new Error('Asse di simmetria non valido.'); this.mirrorAxis = value })
  }
  setMirrorOffset(value: number): void {
    this.change(() => { if (!Number.isFinite(value)) throw new Error('Posizione del piano di simmetria non valida.'); this.mirrorOffset = value })
  }
  /** Like the existing editor, this acts on the selected editable poles only. */
  projectSelectedToMirrorPlane(): void {
    this.change(() => {
      if (!this.symmetry) throw new Error('Attiva prima la simmetria.')
      const net = this.requireNet(), selected = new Set(this.editable())
      if (!selected.size) throw new Error('Seleziona un punto libero.')
      const poles = net.poles.map((point, i) => {
        const copy = pointCopy(point)
        if (selected.has(i)) copy[this.mirrorAxis] = this.mirrorOffset
        return copy
      })
      this.draft.commit({ ...net, poles })
    })
  }

  setTransparency(value: number): void {
    this.change(() => { if (!Number.isFinite(value) || value < 0 || value > .9) throw new Error('Trasparenza non valida.'); this.transparency = value }, false, false, true)
  }
  setSnap(value: boolean): void { this.change(() => { this.snap = value }) }
  setSnapDistance(value: number): void { this.change(() => { if (!Number.isFinite(value) || value < .001 || value > 1000) throw new Error('Portata magnete non valida.'); this.snapDistance = value }) }
  setDragMode(value: DragMode): void { this.change(() => { if (!['axis','screen','local'].includes(value)) throw new Error('Modalità non valida.'); this.dragMode = value }) }
  setAxis(value: number): void { this.change(() => { if (![0,1,2].includes(value)) throw new Error('Asse non valido.'); this.axis = value }) }
  setDragStrength(value: number): void { this.change(() => { if (!Number.isFinite(value) || value < .05 || value > 1) throw new Error('Intensità non valida.'); this.dragStrength = value }) }
  setSelectionMode(value: NetSelectionMode): void { this.change(() => { if (!['auto','points','edges','cells','mixed'].includes(value)) throw new Error('Selezione non valida.'); this.selectionMode = value }) }
  setShowNet(value: boolean): void { this.change(() => { this.showNet = value }) }
  setStripes(value: WorkspaceStripeSettings | null): void {
    this.change(() => {
      if (value && (!['horizontal','vertical'].includes(value.orientation) || !Number.isFinite(value.width) ||
          value.width < 1 || value.width > 7 || !/^#[0-9a-f]{6}$/i.test(value.color))) throw new Error('Opzioni Zebra non valide.')
      this.stripes = value ? Object.freeze({ ...value }) : null
    }, false, false, true)
  }
  setPlacingNote(value: boolean): void { this.change(() => { this.placingNote = value }) }
  setNoteText(id: string, text: string): void {
    this.change(() => {
      if (text.length > 2000 || !this.notes.some(note => note.id === id)) throw new Error('Nota non valida.')
      this.notes = Object.freeze(this.notes.map(note => note.id === id ? Object.freeze({ ...note, text }) : note))
    })
  }
  removeNote(id: string): void { this.change(() => { this.notes = Object.freeze(this.notes.filter(note => note.id !== id)) }) }

  async placeNote(point: Point | null): Promise<void> {
    this.assertMutable()
    if (this.strip || this.stripPending) throw new Error('Chiudi prima la modifica del bordo.')
    if (!point || !finitePoint(point)) throw new Error('Clicca sulla faccia CAD.')
    const draft = this.draft.getSnapshot(), revision = draft.preview?.previewRevision
    if (!draft.net || draft.validNet !== draft.net || draft.calculating || revision === undefined)
      throw new Error('Attendi la verifica CAD della faccia.')
    this.change(() => { this.busy = true; this.message = null })
    const epoch = this.selectionEpoch, net = draft.net
    try {
      const pin = await this.runtime.worker.ask<{anchor: DraftAnchor; at: Point; normal: Point}>(
        { action: 'notePick', point: pointCopy(point), previewRevision: revision }, this.context.signal)
      this.assertLive()
      const current = this.draft.getSnapshot()
      if (epoch !== this.selectionEpoch || current.net !== net || current.validNet !== net ||
          current.preview?.previewRevision !== revision || !finitePoint(pin.at) || !finitePoint(pin.normal) ||
          !pin.anchor || pin.anchor.face !== this.face || !Number.isSafeInteger(pin.anchor.selectionRevision) ||
          !Number.isFinite(pin.anchor.u) || !Number.isFinite(pin.anchor.v)) throw new Error('La faccia è cambiata durante la scelta della nota.')
      this.change(() => {
        this.notes = Object.freeze([...this.notes, Object.freeze({ id: crypto.randomUUID(), text: '',
          at: freezePoint(pin.at), normal: freezePoint(pin.normal), anchor: Object.freeze({ ...pin.anchor }), revision })])
        this.placingNote = false; this.busy = false
      }, true)
    } catch (error) {
      if (!this.disposed) { this.busy = false; this.message = String((error as Error)?.message ?? error); this.refresh() }
      throw error
    }
  }
  reportViewError(message: string): void {
    if (this.message === message) return
    this.change(() => { this.message = message }, false, true, true)
  }

  freeze(ticket: ApplyTicket): () => void {
    this.assertLive()
    if (this.frozen || this.mutating || this.busy || this.placingNote || this.gesture !== 'idle' || this.notes.length)
      throw new Error('La bozza non può essere congelata mentre è occupata o contiene note.')
    if (!ticket || ticket.mode !== 'cad-copy' || typeof ticket.operationId !== 'string' || !ticket.operationId.trim() ||
        sourceKey(ticket.source) !== this.sourceId || this.snapshot.validation.kind !== 'valid' ||
        stampKey(ticket.stamp) !== stampKey(this.snapshot.validation.stamp))
      throw new Error('Il ticket non corrisponde alla bozza convalidata.')
    const frozen: Frozen = { ticketKey: ticketKey(ticket), operationId: ticket.operationId,
      source: Object.freeze({ ...this.source }), stamp: Object.freeze({ ...ticket.stamp }),
      stripResult: this.strip?.frames[this.strip.at] ?? null, preparing: false }
    this.frozen = frozen // Set synchronously, before notifying any listener.
    this.refresh()
    return () => { if (this.frozen === frozen) { this.frozen = null; if (!this.disposed) this.refresh() } }
  }

  async prepareApply(ticket: ApplyTicket, signal: AbortSignal): Promise<PreparedCadCopy> {
    const frozen = this.frozen
    if (!frozen || frozen.preparing) throw new Error('La bozza non è congelata o è già in preparazione.')
    this.assertFrozen(ticket, frozen, signal)
    frozen.preparing = true
    try {
      const result = frozen.stripResult ?? await this.draft.evaluateForExport()
      this.assertFrozen(ticket, frozen, signal)
      if (!result.step.trim()) throw new Error('Esportazione STEP vuota.')
      const step = new TextEncoder().encode(result.step)
      this.assertFrozen(ticket, frozen, signal)
      return { kind: 'cad-copy', operationId: frozen.operationId, source: frozen.source, stamp: frozen.stamp,
        units: 'mm', coordinateFrame: 'part', name: 'superficie-modificata.step', step, draftNoteCount: 0 }
    } finally { frozen.preparing = false }
  }

  /** Produce a local STEP download from the current validated draft, without publishing it. */
  async exportStep(): Promise<{ readonly name: string; readonly step: string }> {
    this.assertMutable()
    const initial = this.snapshot.validation
    if (initial.kind !== 'valid' || this.gesture !== 'idle' || this.stripPending || this.placingNote || this.notes.length)
      throw new Error(this.notes.length || this.placingNote
        ? 'Le note restano nella bozza e non vengono incluse nello STEP. Rimuovile prima di esportare.'
        : 'Attendi una preview CAD valida e termina ogni gesto prima di esportare.')

    const stamp = initial.stamp
    const net = this.requireNet()
    const draft = this.draft.getSnapshot()
    const strip = this.strip
    const stripResult = strip?.frames[strip.at] ?? null
    const queue = this.runtime.previews.getSnapshot()
    if (draft.validNet !== net || draft.calculating || draft.previewStale ||
        (!strip && (!draft.preview?.valid || queue.current?.revision !== stamp.requestId || queue.validRevision !== stamp.requestId)) ||
        (strip && (!stripResult || strip.error)))
      throw new Error('La preview CAD non corrisponde alla bozza corrente.')

    const selectionEpoch = this.selectionEpoch, draftEpoch = this.draftEpoch
    const continuity = draft.continuity, freeBoundary = draft.freeBoundary
    const generation = ++this.exportGeneration
    this.busy = true
    this.refresh()
    try {
      const result = stripResult ?? await this.draft.evaluateForExport()
      this.assertLive()
      const after = this.draft.getSnapshot(), currentQueue = this.runtime.previews.getSnapshot()
      if (generation !== this.exportGeneration || this.selectionEpoch !== selectionEpoch || this.draftEpoch !== draftEpoch ||
          this.requireNet() !== net || after.validNet !== net || after.calculating || after.previewStale ||
          after.continuity !== continuity || after.freeBoundary !== freeBoundary || this.strip !== strip ||
          (strip ? (strip.frames[strip.at] !== stripResult || !stripResult) :
            (currentQueue.current?.revision !== stamp.requestId || currentQueue.validRevision !== stamp.requestId)) ||
          this.notes.length || this.placingNote || this.gesture !== 'idle')
        throw new Error('La bozza è cambiata durante l’esportazione STEP.')
      const resultValid = stripResult ? stripResult.preview.valid : (result as Preview).valid
      if (!resultValid || !result.step.trim())
        throw new Error('Il motore CAD non ha restituito uno STEP valido.')
      return { name: 'superficie-modificata.step', step: result.step }
    } finally {
      if (generation === this.exportGeneration && !this.disposed) {
        this.busy = false
        this.refresh()
      }
    }
  }

  async dispose(_reason: ExitReason): Promise<void> { this.releaseOwned() }

  private assertLive(): void {
    if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
    abortIf(this.context.signal)
    if (sourceKey(this.context.source) !== this.sourceId) throw new Error('La sorgente CAD è cambiata.')
    this.context.assertSourceCurrent()
  }
  private assertMutable(allowBusy = false): void {
    this.assertLive()
    if (this.frozen || this.mutating || (!allowBusy && this.busy)) throw new Error('La bozza è occupata o congelata.')
  }
  private assertFrozen(ticket: ApplyTicket, frozen: Frozen, signal: AbortSignal): void {
    abortIf(signal); this.assertLive(); abortIf(signal)
    if (this.frozen !== frozen || ticketKey(ticket) !== frozen.ticketKey || this.notes.length ||
        this.busy || this.gesture !== 'idle' || this.snapshot.validation.kind !== 'valid' ||
        (this.strip?.frames[this.strip.at] ?? null) !== frozen.stripResult || (!!this.strip !== !!frozen.stripResult) ||
        stampKey(this.snapshot.validation.stamp) !== stampKey(frozen.stamp))
      throw new Error('La bozza congelata non corrisponde al ticket.')
  }
  private directIdentity(): DirectIdentity | null {
    const d = this.draft.getSnapshot(), queue = this.runtime.previews.getSnapshot()
    const revision = d.preview?.previewRevision
    if (this.disposed || !this.runtime.active || this.context.signal.aborted || this.mutating || this.frozen || this.busy ||
        this.strip || this.stripPending || this.gesture !== 'idle' || this.notes.length || this.placingNote ||
        this.faces.length !== 1 || !this.faces[this.face]?.openSheet || !d.net || d.validNet !== d.net ||
        d.calculating || d.previewStale || !d.preview?.valid || d.preview.faceMeshes.length !== 1 ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 ||
        !queue.current || queue.validRevision !== queue.current.revision) return null
    try { this.assertLive() } catch { return null }
    return { revision, selectionEpoch:this.selectionEpoch, face:this.face, net:d.net }
  }
  private matchesDirect(a: DirectIdentity | null, b: DirectIdentity | null): boolean {
    return !!a && !!b && a.revision === b.revision && a.selectionEpoch === b.selectionEpoch && a.face === b.face && a.net === b.net
  }
  private clearDirectCache(): void {
    this.directGeneration++
    const pending = this.directPending
    this.directPending = null; this.directCache = null
    pending?.controller.abort()
    if (this.viewState?.directStrip) this.viewState = Object.freeze({ ...this.viewState, directStrip:null })
  }
  /** Read-only and asynchronous: never advances draft or CAD history. */
  private syncDirectCache(): void {
    const identity = this.directIdentity()
    if (this.directPending && !this.matchesDirect(this.directPending, identity)) this.clearDirectCache()
    if (this.directCache && !this.matchesDirect(this.directCache, identity)) this.clearDirectCache()
    if (!identity || this.directCache || this.directPending) return
    const key = `${identity.selectionEpoch}:${identity.revision}`
    if (this.directFailedKey === key) return
    const pending: DirectPending = { ...identity, controller:new AbortController(), generation:++this.directGeneration, key }
    this.directPending = pending
    void this.runtime.worker.ask<Point[][]>({ action:'sheetEdges', previewRevision:identity.revision }, pending.controller.signal)
      .then(raw => {
        if (this.directPending !== pending || pending.generation !== this.directGeneration) return
        const paths = freezePaths(raw)
        if (!this.matchesDirect(pending, this.directIdentity())) { this.clearDirectCache(); return }
        this.directPending = null
        this.directCache = Object.freeze({ ...identity, paths })
        this.refresh()
      }).catch(error => {
        if (this.directPending !== pending || pending.generation !== this.directGeneration) return
        this.directPending = null
        if (!this.disposed && error?.name !== 'AbortError' && this.matchesDirect(pending, this.directIdentity())) {
          this.directFailedKey = pending.key
          this.refresh()
        }
      })
  }
  private requireNet(): Net {
    const net = this.draft.getSnapshot().net
    if (!net) throw new Error('Scegli prima una faccia CAD.')
    return net
  }
  private requireStrip(): StripMode {
    if (!this.strip || this.stripPending) throw new Error('Apri prima la modifica del bordo libero.')
    return this.strip
  }
  private cancelStripGesture(): void {
    this.change(() => {
      if (this.gesture === 'strip') {
        this.gesture = 'idle'
        if (this.directGestureOrigin) this.strip = null
        else if (this.strip) this.strip.delta = [0,0,0]
        this.directGestureOrigin = false
      }
    }, false, true, true)
  }
  private editable(): number[] {
    const selected = this.draft.getSnapshot().selected, locked = new Set(this.viewState.locked)
    return selected.filter(i => !locked.has(i))
  }
  private transform(net: Net, ids: number[], fn: (point: Point, index: number) => Point): void {
    if (!ids.length) throw new Error('Seleziona un punto libero.')
    const selected = new Set(ids)
    const poles = net.poles.map((point,i) => selected.has(i) ? fn(point, i) : pointCopy(point))
    const committed = this.draft.getSnapshot().committedNet
    if (!committed) throw new Error('Sorgente CAD assente.')
    this.draft.commit({ ...committed, poles: this.mirroredPoles(committed, poles) })
  }
  private partners(net: Net | null): number[] | null {
    if (!this.symmetry || !net) return null
    if (!this.symmetryCache || this.symmetryCache.net !== net || this.symmetryCache.axis !== this.mirrorAxis ||
        this.symmetryCache.offset !== this.mirrorOffset) {
      this.symmetryCache = { net, axis: this.mirrorAxis, offset: this.mirrorOffset,
        partners: Object.freeze(mirrorPartners(net.poles, this.mirrorAxis, this.mirrorOffset)) as unknown as number[] }
    }
    return this.symmetryCache.partners
  }
  private mirroredPoles(committed: Net, poles: Point[]): Point[] {
    if (poles.length !== committed.poles.length || poles.some(point => !finitePoint(point)))
      throw new Error('Coordinate dei punti non valide.')
    const partners = this.partners(committed)
    return partners ? mirrorEdit(committed.poles, poles, partners, this.mirrorAxis, this.mirrorOffset, [...this.viewState.locked]) : poles
  }
  private change<T>(fn: () => T, allowBusy = false, allowGesture = false, allowStrip = false): T {
    this.assertMutable(allowBusy)
    if (!allowGesture && this.gesture !== 'idle') throw new Error('Termina prima il trascinamento.')
    if (!allowStrip && (this.strip || this.stripPending)) throw new Error('Chiudi prima la modifica del bordo.')
    this.mutating = true
    const before = this.draft.getSnapshot()
    let applied = false
    try {
      const result = fn()
      applied = true
      return result
    } finally {
      const after = this.draft.getSnapshot()
      if (applied || before !== after) this.draftEpoch++
      if (before.committedNet !== after.committedNet || before.continuity !== after.continuity ||
          before.freeBoundary !== after.freeBoundary || !sameArray(before.locks, after.locks)) this.historyRevision++
      this.mutating = false
      if (!this.disposed) { this.refresh(); this.resolveNotes() }
    }
  }
  private refresh(): void {
    const d: SurfaceDraftSnapshot = this.draft.getSnapshot()
    const current: DraftStamp = Object.freeze({ sessionId: this.context.sessionId, sourceEpoch: this.source.sourceEpoch,
      selectionEpoch: this.selectionEpoch, draftEpoch: this.draftEpoch })
    const queue = this.runtime.previews.getSnapshot()
    const strip = this.strip, stripResult = strip?.frames[strip.at] ?? null
    const stamp: PreviewStamp = Object.freeze({ ...current, requestId: strip ? (stripResult?.requestId ?? 0) : (queue.current?.revision ?? 0) })
    const validation = !d.net ? { kind: 'none' as const } :
      (d.calculating || this.busy || this.placingNote || this.gesture === 'strip') ? { kind: 'pending' as const, wanted: stamp } :
      strip?.error ? { kind: 'invalid' as const, stamp, message: strip.error } :
      strip ? (stripResult ? { kind: 'valid' as const, stamp } : { kind: 'pending' as const, wanted: stamp }) :
      d.validNet === d.net && !d.previewStale && d.preview?.valid && queue.validRevision === queue.current?.revision
        ? { kind: 'valid' as const, stamp } :
        d.error ? { kind: 'invalid' as const, stamp, message: d.error } : { kind: 'pending' as const, wanted: stamp }
    const original = d.originalNet
    const dirty = !!this.notes.length || !!strip?.frames.some(Boolean) || d.canUndo || !!(d.net && d.net !== d.committedNet) ||
      !!(d.net && original && !d.canUndo && JSON.stringify(d.net.poles) !== JSON.stringify(original.poles))
    let cached = this.lockCache
    if (!cached || cached.net !== d.net || cached.locks !== d.locks || cached.trim !== d.trimLocks ||
        cached.continuity !== d.continuity || cached.free !== d.freeBoundary) {
      const locks = new Set([...d.locks, ...d.trimLocks])
      cached = { net: d.net, locks: d.locks, trim: d.trimLocks, continuity: d.continuity, free: d.freeBoundary,
        value: Object.freeze(d.net ? d.net.poles.flatMap((_,i) =>
          locks.has(i) || (!d.freeBoundary && boundaryLocked(d.net!,i,d.continuity)) ? [i] : []) : []) }
      this.lockCache = cached
    }
    const locked = cached.value, face = this.faces[this.face]
    const preview = stripResult?.preview ?? d.preview ?? (!d.net ? this.sourcePreview : null)
    // Positioning a new note blocks Apply but does not invalidate existing
    // anchors verified against the still-current CAD preview.
    const validRevision = d.net && d.validNet === d.net && !d.calculating && !d.previewStale
      ? preview?.previewRevision : undefined
    if (!this.pinCache || this.pinCache.notes !== this.notes || this.pinCache.revision !== validRevision)
      this.pinCache = { notes: this.notes, revision: validRevision,
        value: Object.freeze(this.notes.filter(note => note.revision === validRevision).map(note => note.at)) }
    const notePins = this.pinCache.value
    const symmetryPartners = this.partners(d.committedNet)
    const lockedSet = new Set(locked)
    const symmetryBlocked = !!symmetryPartners && d.selected.some(i =>
      !lockedSet.has(i) && (symmetryPartners[i] < 0 || lockedSet.has(symmetryPartners[i])))
    const message = this.message ?? (strip?.error || d.error || null)
    const canUndo = strip ? strip.at > 0 : d.canUndo, canRedo = strip ? strip.at + 1 < strip.frames.length : d.canRedo
    const stripView: WorkspaceStripViewState | null = strip ? Object.freeze({
      paths: stripResult?.paths ?? strip.initialPaths, selectedEdge:strip.selectedEdge, axis:strip.axis, delta:freezePoint(strip.delta),
      pending:this.stripPending || this.gesture === 'strip', canUndo, canRedo,
      addedArea:stripResult?.addedArea ?? null, totalArea:stripResult?.totalArea ?? null, hasResult:!!stripResult,
    }) : null
    const canBeginStrip = !strip && !this.stripPending && !this.busy && !this.frozen && !this.notes.length && !this.placingNote &&
      this.gesture === 'idle' && this.faces.length === 1 && !!face?.openSheet && d.preview?.faceMeshes.length === 1 &&
      validation.kind === 'valid'
    const canExportStep = !this.disposed && !this.busy && !this.frozen && !this.notes.length && !this.placingNote &&
      this.gesture === 'idle' && !this.stripPending && validation.kind === 'valid' &&
      (!strip || (!!stripResult && !strip.error))
    this.syncDirectCache()
    const directIdentity = this.directIdentity()
    const directStripError = directIdentity && this.directFailedKey === `${directIdentity.selectionEpoch}:${directIdentity.revision}`
      ? 'Non è stato possibile caricare i bordi liberi.' : null
    const directStrip = this.directCache ? Object.freeze({ paths:this.directCache.paths,
      revision:this.directCache.revision, axis:this.directStripAxis }) : null
    this.snapshot = Object.freeze({ revision: ++this.revision, current, dirty, gesture: this.gesture, validation,
      canUndo, canRedo, undoLabel: canUndo ? (strip ? 'Annulla striscia' : 'Annulla modifica superficie') : null,
      redoLabel: canRedo ? (strip ? 'Ripeti striscia' : 'Ripeti modifica superficie') : null, historyRevision: this.historyRevision,
      draftNoteCount: this.notes.length, message })
    this.panel = Object.freeze({ faces: this.faces, face: this.face, net: d.net, selected: d.selected,
      locked, manualLocks: d.locks, continuity: d.continuity, freeBoundary: d.freeBoundary,
      canFreeBoundary: !!face?.freeBoundary, canUndo, canRedo, calculating: d.calculating || this.stripPending,
      busy: this.busy || !!this.frozen, message, snap: this.snap, snapDistance: this.snapDistance,
      dragMode: this.dragMode, axis: this.axis, dragStrength: this.dragStrength, selectionMode: this.selectionMode,
      showNet: this.showNet, stripes: this.stripes, symmetry: this.symmetry, mirrorAxis: this.mirrorAxis,
      mirrorOffset: this.mirrorOffset, symmetryPartners, symmetryBlocked, transparency: this.transparency,
      placingNote: this.placingNote, notes: this.notes, gesture: this.gesture, canBeginStrip, directStripAxis:this.directStripAxis,
      directStripError,
      canExportStep, strip:stripView })
    this.viewState = Object.freeze({ net: strip ? null : d.net, preview, face: stripResult ? -1 : this.face, selected: strip ? [] : d.selected, locked,
      hiddenPoles: face?.hiddenPoles ?? [], selectionMode: this.selectionMode, dragMode: this.dragMode,
      axis: this.axis, dragStrength: this.dragStrength, showNet: this.showNet, snap: this.snap,
      snapDistance: this.snapDistance, busy: this.busy || !!this.frozen, placingNote: this.placingNote,
      stripes: this.stripes, notePins, symmetry: this.symmetry, mirrorAxis: this.mirrorAxis,
      mirrorOffset: this.mirrorOffset, symmetryPartners, symmetryBlocked, transparency: this.transparency, strip:stripView, directStrip })
    for (const listener of this.listeners) listener()
  }
  private resolveNotes(): void {
    const d = this.draft.getSnapshot(), revision = d.preview?.previewRevision
    if (this.disposed || this.frozen || this.resolvingNotes || !d.net || d.validNet !== d.net ||
        d.calculating || revision === undefined || revision === this.failedNoteRevision ||
        !this.notes.some(note => note.revision !== revision)) return
    const notes = this.notes, net = d.net, epoch = this.selectionEpoch
    this.resolvingNotes = true
    void Promise.all(notes.map(async note => note.revision === revision ? note : ({
      ...note, ...await this.runtime.worker.ask<{at: Point; normal: Point}>(
        { action: 'noteResolve', anchor: note.anchor, previewRevision: revision }, this.context.signal), revision,
    }))).then(updated => {
      this.assertLive()
      const current = this.draft.getSnapshot()
      if (this.notes !== notes || epoch !== this.selectionEpoch || current.net !== net || current.validNet !== net ||
          current.preview?.previewRevision !== revision || this.frozen) return
      if (updated.some(note => !finitePoint(note.at) || !finitePoint(note.normal))) throw new Error('Posizione nota non valida.')
      this.notes = Object.freeze(updated.map(note => Object.freeze({ ...note, at: freezePoint(note.at), normal: freezePoint(note.normal) })))
      this.draftEpoch++; this.refresh()
    }).catch(error => {
      if (!this.disposed && this.selectionEpoch === epoch && this.draft.getSnapshot().preview?.previewRevision === revision) {
        this.failedNoteRevision = revision; this.message = String((error as Error)?.message ?? error); this.refresh()
      }
    }).finally(() => {
      this.resolvingNotes = false
      if (!this.disposed) this.resolveNotes()
    })
  }
  private cleanup(): void {
    if (this.disposed) return
    this.disposed = true; this.exportGeneration++; this.frozen = null; this.stripGeneration++; this.stripAbort?.abort()
    this.clearDirectCache(); this.directGestureOrigin = false
    this.strip = null; this.stripPending = false; this.stripAbort = null
    this.context.signal.removeEventListener('abort', this.onAbort)
    let failure: unknown
    try { this.layer?.dispose() } catch (error) { failure = error }
    this.layer = null
    this.unsubscribeDraft()
    try { this.draft.dispose() } catch (error) { failure ??= error }
    try { this.runtime.dispose() } catch (error) { failure ??= error }
    this.notes = Object.freeze([]); this.faces = Object.freeze([]); this.sourcePreview = null; this.symmetryCache = null
    this.face = -1; this.busy = false; this.gesture = 'idle'; this.gestureNet = null
    this.placingNote = false; this.message = 'Editor chiuso.'
    try { this.refresh() } catch (error) { failure ??= error }
    this.listeners.clear()
    if (failure) throw failure
  }
}

export function createWorkspaceSurfaceSession(
  context: WorkspaceEditorContext, createWorkspaceLayer: WorkspaceLayerFactory, options?: Options,
): Promise<WorkspaceSurfaceSession> {
  return WorkspaceSurfaceSession.create(context, createWorkspaceLayer, options)
}

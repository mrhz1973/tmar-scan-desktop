// SPDX-License-Identifier: AGPL-3.0-only
// @ts-ignore -- optional host types are supplied by ScanRuler's workspace-editor host.
import type { ApplyTicket, DraftStamp, EditorSnapshot, ExitReason, PreparedCadCopy, PreviewStamp, SourceBinding, WorkspaceEditorContext, WorkspaceEditorController } from '../../src/plugins/workspaceEditorTypes'
// @ts-ignore -- this optional V1 contract is supplied by annotation-capable hosts.
import type { AnnotatedTicketV1, PreparedAnnotatedCopyV1 } from '../../src/plugins/annotatedCopyTypes'
import { boundaryLocked, type Net, type Point } from './brep'
import type { DraftAnchor, FaceInfo, Preview, G1SupportCandidates, G1CurvedSupportCandidates } from './editorKernel'
import type { G1SupportCandidate } from './g1SupportTopology'
import type { CompatibleCurvedSupportCandidate } from './compatibleCurvedSupportTopology'
import { dragDirection, type DragMode } from './localFrame'
import { selectNetPoints, type NetSelectionMode } from './netSelection'
import { SurfaceDraft, type SurfaceDraftSnapshot } from './surfaceDraft'
import { SurfaceRuntime } from './surfaceRuntime'
import { mirrorEdit, mirrorPartners } from './symmetry'
import type { StripMove } from './sheetExtension'
import type { KnotInsertion } from './refineClampedNet'
import { readRecipe, readCurvedRecipe, type SurfaceEditRecipe, type SurfaceEditRecipeV6 } from './recipe'
import { readAdaptiveLockedRecipe, type AdaptiveLockedRecipe } from './adaptiveLockedRecipe'
import type { AdaptiveSelection } from './editor.worker'
import type { WorkspaceLayerFactory, WorkspaceSurfaceLayer, WorkspaceSurfaceLayerOwner, WorkspaceSurfaceView, WorkspaceSurfaceViewState, WorkspaceStripeSettings, WorkspaceStripViewState } from './workspaceBridge'
import type { WorkspacePointTargetResolver,WorkspacePointTarget,WorkspaceSurfaceTargetPair,WorkspaceSurfacePickKind } from './workspaceBridge'
import { wholeBoundaryIndices, type WholeBoundarySide } from './wholeBoundary'
import type {BoundaryCadCandidate,VerifiedBoundaryPick,BoundaryVisibilityCadResult} from './boundaryVisibilityCad'
import {SurfacePointTargetsCandidateRefusal} from './surfacePointTargetsExperimental'
export type { WholeBoundarySide } from './wholeBoundary'

export interface WorkspaceSurfaceNote {
  readonly id: string
  readonly text: string
  readonly at: Point
  readonly normal: Point
  readonly revision: number
}
export interface PreparedHistoryRecipe {
  readonly recipe: SurfaceEditRecipe | SurfaceEditRecipeV6 | AdaptiveLockedRecipe
  readonly sessionId: string
  readonly sourceKey: string
  readonly selectionEpoch: number
  readonly draftEpoch: number
}
/** Host-owned persisted text/UV; selection revisions never leave a session. */
export interface HistorySurfaceNote {
  readonly id: string
  readonly text: string
  readonly faceIndex: number
  readonly u: number
  readonly v: number
}
export interface PreparedAnnotatedHistory extends PreparedHistoryRecipe {
  readonly notesRevision: number
  readonly notes: readonly HistorySurfaceNote[]
}
/** A synchronous edit lock. The host must still validate and atomically commit. */
export interface HistoryFreeze {
  isCurrent(): boolean
  release(): void
}
interface Note extends WorkspaceSurfaceNote { readonly anchor: DraftAnchor }
export type WorkspaceG1Candidate = (G1SupportCandidate & { readonly kind?: never }) | CompatibleCurvedSupportCandidate
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
  readonly canMoveWholeBoundary: boolean
  readonly wholeBoundaryDrag: WholeBoundarySide | null
  readonly canRefineNet: boolean
  readonly g1Candidates: readonly WorkspaceG1Candidate[]
  readonly g1Choice: string | null
  readonly g1SearchNotice: string | null
  readonly canLoadG1: boolean
  readonly canApplyG1: boolean
  readonly planeTangencyActive: boolean
  readonly curvedTangencyActive: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly calculating: boolean
  readonly busy: boolean
  readonly message: string | null
  readonly snap: boolean
  readonly snapDistance: number
  readonly surfaceTarget: WorkspaceSurfacePickKind | null
  readonly surfaceTargetBatch:readonly WorkspaceSurfaceTargetPair[]|null
  readonly canTargetPoint: boolean
  readonly dragMode: DragMode
  readonly axis: number
  readonly dragStrength: number
  readonly selectionMode: NetSelectionMode
  readonly navigationOnly: boolean
  readonly showNet: boolean
  readonly stripes: WorkspaceStripeSettings | null
  readonly symmetry: boolean
  readonly mirrorAxis: number
  readonly mirrorOffset: number
  readonly symmetryPartners: readonly number[] | null
  readonly symmetryBlocked: boolean
  readonly transparency: number
  readonly placingNote: boolean
  readonly canPlaceNote: boolean
  readonly notes: readonly WorkspaceSurfaceNote[]
  readonly annotatedCopyAvailable: boolean
  readonly noteResolutionError: boolean
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
  readonly baseFaceCount: number
  readonly initialPaths: readonly (readonly Point[])[]
  frames: (StripResult | null)[]
  at: number
  selectedEdge: number
  axis: 0 | 1 | 2
  delta: Point
  error: string | null
}
interface DirectIdentity { readonly revision:number; readonly selectionEpoch:number; readonly face:number; readonly faceCount:number; readonly net:Net }
interface DirectCache extends DirectIdentity { readonly paths:readonly (readonly Point[])[] }
interface DirectPending extends DirectIdentity { readonly controller:AbortController; readonly generation:number; readonly key:string }
type Frozen = { readonly ticketKey: string; readonly operationId: string; readonly stamp: PreviewStamp; readonly source: SourceBinding; readonly stripResult: StripResult | null; readonly notes?: readonly Note[]; readonly notesRevision?: number; preparing: boolean }
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
const ticketKey = (ticket: ApplyTicket | AnnotatedTicketV1) => JSON.stringify([ticket.operationId, ticket.mode, sourceKey(ticket.source), stampKey(ticket.stamp), ticket.mode === 'annotated-cad-copy' ? ticket.notesRevision : null])
const finitePoint = (point: readonly number[] | null | undefined) => !!point && point.length === 3 && Array.from(point).every(Number.isFinite)
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
  private readonly disposedSignal = new AbortController()
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
  private cylinderValidationSerial = 0
  private cylinderValidated: {net:Net;session:number;historyRevision:number;selectionEpoch:number;requestId:number;previewRevision:number;step:string}|null = null
  private gesture: 'idle' | 'pole' | 'strip' = 'idle'
  private gestureNet: Net | null = null
  private wholeBoundaryDrag: {side:WholeBoundarySide;face:number} | null = null
  private wholeBoundaryGesture: readonly number[] | null = null
  private boundaryPickSerial=0
  private readonly boundaryPickReceipts=new WeakMap<VerifiedBoundaryPick,{snapshot:SurfaceDraftSnapshot;serial:number}>()
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
  private restoredHistory: { selectionEpoch:number; draftEpoch:number; net:Net } | null = null
  private readonly historyGuards = new WeakMap<PreparedHistoryRecipe,string>()
  private readonly annotatedHistoryGuards = new WeakMap<PreparedAnnotatedHistory,{net:Net;notes:string;recipe:string}>()
  private faces: readonly FaceInfo[] = Object.freeze([])
  private sourcePreview: Preview | null = null
  private selectionEpoch = 0
  private draftEpoch = 0
  private historyRevision = 0
  private g1Candidates: readonly WorkspaceG1Candidate[] = Object.freeze([])
  private g1Choice: string | null = null
  private g1SearchNotice: string | null = null
  private g1Basis: { selectionEpoch: number; refinements: SurfaceDraftSnapshot['refinements'] } | null = null
  private g1ValidationSerial = 0
  private g1DraftIdentity: { net: Net; constraint: NonNullable<SurfaceDraftSnapshot['planeTangency'] | SurfaceDraftSnapshot['curvedTangency']>; requestId: number } | null = null
  private revision = 0
  private message: string | null = null
  private snap = true
  private snapDistance = 1
  private surfaceTarget: ({snapshot:SurfaceDraftSnapshot;epoch:number} & (
    {kind:'scan'|'cad';budget:number;distance:number;points?:{anchor:DraftAnchor;at:Point;reference:WorkspacePointTarget}[]}
    | {kind:'tangent-plane';points?:never}
  )) | null = null
  private dragMode: DragMode = 'local'
  private axis = 2
  private dragStrength = 1
  private selectionMode: NetSelectionMode = 'auto'
  private navigationOnly = false
  private showNet = true
  private symmetry = false
  private transparency = 0
  private mirrorAxis = 0
  private mirrorOffset = 0
  private stripes: WorkspaceStripeSettings | null = null
  private placingNote = false
  private notes: readonly Note[] = Object.freeze([])
  private notesRevision = 0
  private resolvingNotes = false
  private failedNoteRevision: number | null = null
  private failedNoteSet: readonly Note[] | null = null
  private symmetryCache: { net: Net; axis: number; offset: number; partners: number[] } | null = null
  private lockCache: { net: Net | null; locks: readonly number[]; trim: readonly number[]; continuity: 'G0' | 'G1'; free: boolean;
    tangency: SurfaceDraftSnapshot['planeTangency'] | SurfaceDraftSnapshot['curvedTangency']; value: readonly number[] } | null = null
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
        !Number.isFinite(context.source.bodyId) || context.source.bodyId <= 0 ||
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

  async requestFaceSelection(index: number, confirmDiscard = (message: string) => window.confirm(message)): Promise<void> {
    this.assertMutable()
    const face = this.faces[index]
    if (!face || !Number.isInteger(index)) throw new Error('Faccia non disponibile.')
    if (face.reason && !face.experimentalCylinder && !(face.kind==='plane' && face.reason==='Tutti i poli influenzano un contorno ritagliato.')) throw new Error(face.reason)
    if (index === this.face && this.draft.getSnapshot().net) return
    if (this.draft.getSnapshot().calculating) throw new Error('Attendi la verifica CAD prima di cambiare faccia.')
    const dirty = this.snapshot.dirty
    const prompt = this.notes.length
      ? 'Cambiare faccia e scartare le modifiche e le note in bozza?'
      : 'Cambiare faccia e scartare la modifica corrente?'
    if (dirty && !confirmDiscard(prompt)) return
    await this.chooseFace(index, dirty)
  }

  async chooseFace(index: number, discardChanges = false, adaptiveExperimental = false): Promise<void> {
    this.assertMutable()
    if (this.strip || this.stripPending) throw new Error('Chiudi prima la modifica del bordo.')
    const face = this.faces[index]
    if (!face || !Number.isInteger(index)) throw new Error('Faccia non disponibile.')
    const densePlane=face.kind==='plane' && face.reason==='Tutti i poli influenzano un contorno ritagliato.'
    if (adaptiveExperimental && face.kind !== 'plane') throw new Error('La preparazione adattiva richiede un piano CAD.')
    if (face.reason && !face.experimentalCylinder && !densePlane) throw new Error(face.reason)
    if (this.gesture !== 'idle') throw new Error('Termina prima il trascinamento.')
    if (index === this.face && this.draft.getSnapshot().net &&
        !!this.runtime.history.current?.preparation?.adaptiveSelection === adaptiveExperimental) return
    if (this.notes.length && !discardChanges) throw new Error('La bozza contiene note: conferma prima di cambiare faccia.')
    if (this.snapshot.dirty && !discardChanges) throw new Error('La bozza contiene modifiche: conferma prima di cambiare faccia.')
    if (this.notes.length && (!Number.isSafeInteger(this.notesRevision) || this.notesRevision >= Number.MAX_SAFE_INTEGER))
      throw new Error('Revisione delle note non valida.')
    const currentDraft = this.draft.getSnapshot()
    // Do not let an old queued evaluation run after the worker has selected a
    // different face. Keep the current draft and history until selection succeeds.
    if (currentDraft.calculating) throw new Error('Attendi la verifica CAD prima di cambiare faccia.')
    const previousContinuity = currentDraft.continuity
    this.change(() => {
      this.busy = true; this.message = null
    })
    const epoch = this.selectionEpoch
    // Once dispatched, a lost or aborted worker reply may still have changed
    // its selection, so the prior draft cannot safely remain active.
    const adaptiveSelected = adaptiveExperimental
    try {
      const picked = adaptiveExperimental
        ? {...await this.runtime.worker.ask<{net:Net;selection:AdaptiveSelection}>({action:'selectAdaptiveExperimental',face:index},this.context.signal),session:null}
        : face.experimentalCylinder
        ? await this.runtime.worker.ask<{net:Net;session:number}>({ action:'prepareCylinder', face:index }, this.context.signal)
        : densePlane
          ? {...await this.runtime.worker.ask<{net:Net;refinements:KnotInsertion[];trimLocks:number[];hiddenPoles:number[]}>({action:'selectDenseTrimmedPlane',face:index},this.context.signal),session:null}
          : {net:await this.runtime.worker.ask<Net>({ action:'select', face:index }, this.context.signal),session:null}
      this.assertLive()
      if (epoch !== this.selectionEpoch) throw new Error('Selezione faccia superata.')
      this.change(() => {
        if (picked.session !== null) this.draft.installCylinder(picked.net,picked.session)
        else this.draft.install(picked.net, { continuity: previousContinuity,
          trimLocks: 'selection' in picked ? picked.selection.trimLocks : 'trimLocks' in picked ? picked.trimLocks : face.trimLocks,
          hiddenPoles: 'selection' in picked ? picked.selection.hiddenPoles : 'hiddenPoles' in picked ? picked.hiddenPoles : face.hiddenPoles,
          refinements: 'selection' in picked ? picked.selection.refinements : 'refinements' in picked ? picked.refinements : [], face:index,
          ...('selection' in picked ? {adaptiveSelection:picked.selection,experimentalAdaptiveLocks:true} : {}) })
        if (this.notes.length) { this.advanceNotesRevision(); this.notes = Object.freeze([]) }
        this.selectionEpoch++; this.face = index; this.busy = false
        this.placingNote = false; this.failedNoteRevision = null; this.failedNoteSet = null
        if(picked.session !== null) this.message = 'Cilindro sperimentale: trascina i punti disponibili, poi verifica la geometria CAD prima di aggiungere note o applicare.'
        else if(densePlane) this.message = 'Piano ritagliato preparato con reticolo più fitto; i contorni restano protetti.'
      }, true)
    } catch (error) {
      if (!this.disposed && epoch === this.selectionEpoch) {
        if (adaptiveSelected) {
          try { this.context.reportFatal('Selezione adattiva non verificabile: riapri Edit Surface.') } catch { /* Keep original error. */ }
          try { this.releaseOwned() } catch { /* Keep original error. */ }
          throw error
        }
        this.busy = false; this.message = String((error as Error)?.message ?? error); this.refresh()
      }
      throw error
    }
  }

  selectPoints(ids: readonly number[], additive: boolean): void {
    this.change(() => this.draft.setSelection(selectNetPoints([...this.draft.getSnapshot().selected], [...ids], additive)))
  }
  async refineNet(axis:'U'|'V'|'both'): Promise<void> {
    this.assertMutable()
    if (!['U','V','both'].includes(axis) || !this.panel.canRefineNet) throw new Error('Raffinamento non disponibile: termina le altre operazioni e sblocca i punti manuali.')
    const d=this.draft.getSnapshot(), net=this.requireNet()
    const adaptive=!!this.runtime.history.current?.preparation?.adaptiveSelection
    const plan: {axis:'U'|'V';value:number;count:number}[]=[]
    for(const direction of (axis==='both'?['U','V']:[axis]) as ('U'|'V')[]) {
      const knots=direction==='U'?net.ku:net.kv
      if (adaptive) {
        let widest=0
        for(let i=1;i<knots.length;i++) if(knots[i]-knots[i-1]>knots[widest+1]-knots[widest]) widest=i-1
        const value=knots[widest]+(knots[widest+1]-knots[widest])/2
        if(!(value>knots[widest] && value<knots[widest+1])) throw new Error('Intervallo nodale troppo piccolo da raffinare.')
        plan.push({axis:direction,value,count:1})
        continue
      }
      for(let i=1;i<knots.length;i++) {
        const value=knots[i-1]+(knots[i]-knots[i-1])/2
        if(!(value>knots[i-1] && value<knots[i])) throw new Error('Intervallo nodale troppo piccolo da raffinare.')
        plan.push({axis:direction,value,count:1})
      }
    }
    if(!plan.length || d.refinements.length+plan.length>128) throw new Error('Troppi nodi per il raffinamento.')
    this.busy=true; this.message=null; this.refresh()
    try {
      await this.draft.refine(plan); this.assertLive()
      if(this.draft.getSnapshot().committedNet!==d.committedNet) {this.draftEpoch++;this.historyRevision++}
    }
    catch(error) { if(!this.disposed) this.message=String((error as Error)?.message ?? error); throw error }
    finally { if(!this.disposed) { this.busy=false; this.refresh() } }
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
  setWholeBoundaryDrag(side:WholeBoundarySide|null):void {
    this.change(()=>{
      if(side===null){this.wholeBoundaryDrag=null;return}
      if(!this.panel.canMoveWholeBoundary)throw Error('Attiva i bordi liberi e attendi una singola faccia CAD valida.')
      const ids=wholeBoundaryIndices(this.requireNet(),side),d=this.draft.getSnapshot()
      if(ids.some(i=>d.locks.includes(i)||d.trimLocks.includes(i)||d.hiddenPoles.includes(i)))throw Error('Il bordo contiene un polo bloccato.')
      this.draft.setSelection(ids);this.wholeBoundaryDrag={side,face:this.face}
    })
  }
  beginWholeBoundaryGesture(side:WholeBoundarySide):boolean {
    this.assertMutable()
    if(!this.wholeBoundaryDrag || !this.panel.canMoveWholeBoundary)return false
    const d=this.draft.getSnapshot(),ids=wholeBoundaryIndices(this.requireNet(),side)
    if(ids.some(i=>d.locks.includes(i)||d.trimLocks.includes(i)||d.hiddenPoles.includes(i)))throw Error('Il bordo contiene un polo bloccato.')
    this.change(()=>{
      this.draft.setSelection(ids);this.wholeBoundaryDrag={side,face:this.face}
      this.gesture='pole';this.gestureNet=d.committedNet;this.wholeBoundaryGesture=ids
    })
    return true
  }
  async prepareWholeBoundaryPicks(net:Net,candidates:BoundaryCadCandidate[],origin:Point,parallelDirection?:Point):Promise<readonly VerifiedBoundaryPick[]>{
    this.assertMutable()
    const before=this.draft.getSnapshot(),serial=++this.boundaryPickSerial,revision=before.preview?.previewRevision
    if(!this.wholeBoundaryDrag||!this.panel.canMoveWholeBoundary||before.net!==net||revision===undefined)throw Error('Bozza del bordo non verificabile.')
    const input=structuredClone(candidates)
    const response=await this.runtime.worker.ask<{face:number;previewRevision:number;results:(BoundaryVisibilityCadResult&{side:WholeBoundarySide})[]}>({
      action:'verifyBoundaryVisibility',previewRevision:revision,candidates:input,origin:pointCopy(origin),
      ...(parallelDirection?{parallelDirection:pointCopy(parallelDirection)}:{})},this.context.signal)
    this.assertMutable()
    if(serial!==this.boundaryPickSerial||this.draft.getSnapshot()!==before||!this.wholeBoundaryDrag||!this.panel.canMoveWholeBoundary)
      throw Error('Richiesta del bordo superata da una modifica o annullamento.')
    if(response.face!==this.face||response.previewRevision!==revision||!Array.isArray(response.results)||response.results.length!==input.length)
      throw Error('Risposta CAD del bordo non coerente.')
    const receipts:VerifiedBoundaryPick[]=[]
    response.results.forEach((result,i)=>{
      if(result.side!==input[i].side||result.pickerSegment!==input[i].segment||typeof result.visible!=='boolean')throw Error('Candidato CAD non coerente.')
      if(!result.visible)return
      if(result.reason!=='native-section-and-clear-front'||!finitePoint(result.point)||!Number.isFinite(result.frontDistanceMm)||result.frontDistanceMm!<=1e-6||result.intersectionCount!==1)
        throw Error('Conferma CAD incompleta.')
      const pick=Object.freeze({side:result.side,point:freezePoint(result.point)})
      this.boundaryPickReceipts.set(pick,{snapshot:before,serial});receipts.push(pick)
    })
    return Object.freeze(receipts)
  }
  cancelPreparedWholeBoundaryPicks():void{this.boundaryPickSerial++}
  beginVerifiedWholeBoundaryGesture(pick:VerifiedBoundaryPick):boolean{
    this.assertMutable()
    const receipt=this.boundaryPickReceipts.get(pick);this.boundaryPickReceipts.delete(pick)
    if(!receipt||receipt.serial!==this.boundaryPickSerial||receipt.snapshot!==this.draft.getSnapshot())return false
    this.boundaryPickSerial++
    return this.beginWholeBoundaryGesture(pick.side)
  }
  private checkWholeBoundaryGesture(poles:Point[]):void {
    const ids=this.wholeBoundaryGesture,base=this.gestureNet
    if(!ids || !base)return
    if(poles.length!==base.poles.length || poles.some(p=>!finitePoint(p)))throw Error('Coordinate del bordo non valide.')
    const delta=poles[ids[0]].map((x,d)=>x-base.poles[ids[0]][d])
    if(Math.hypot(...delta)>1000)throw Error('Spostamento del bordo oltre 1000 mm.')
    const selected=new Set(ids)
    for(let i=0;i<poles.length;i++)for(let d=0;d<3;d++){
      const expected=base.poles[i][d]+(selected.has(i)?delta[d]:0)
      if(selected.has(i)?Math.abs(poles[i][d]-expected)>1e-8:poles[i][d]!==base.poles[i][d])
        throw Error('Il trascinamento deve traslare tutto il bordo, senza cambiare altri poli.')
    }
  }
  previewPoles(poles: Point[]): void {
    this.change(() => {
      if (this.gesture !== 'pole' || !this.gestureNet) throw new Error('Nessun trascinamento attivo.')
      this.checkWholeBoundaryGesture(poles)
      this.draft.preview({ ...this.gestureNet, poles: this.mirroredPoles(this.gestureNet, poles) })
    }, false, true)
  }
  finishPoleGesture(poles: Point[] | null): void {
    // The layer can release a captured pointer while the host revokes the
    // session. Closing discards the gesture; it must not attempt a CAD write.
    if (!poles && (this.disposed || this.context.signal.aborted || !this.runtime.active)) {
      this.gesture = 'idle'; this.gestureNet = null; this.wholeBoundaryGesture=null
      return
    }
    this.change(() => {
      if (this.gesture !== 'pole' || !this.gestureNet) return
      const net = this.gestureNet
      try { if (poles) {this.checkWholeBoundaryGesture(poles);this.draft.commit({ ...net, poles: this.mirroredPoles(net, poles) })} else this.draft.cancelDraft() }
      catch(error){if(this.wholeBoundaryGesture)this.draft.cancelDraft();throw error}
      finally { this.gesture = 'idle'; this.gestureNet = null;this.wholeBoundaryGesture=null }
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
  undo(): void { this.change(() => { if (this.strip) { if (this.strip.at > 0) { this.strip.at--; this.strip.selectedEdge = -1; this.strip.delta = [0,0,0]; this.strip.error = null; this.message = null; this.historyRevision++ } } else this.stepDraftHistory(-1) }, false, false, true) }
  redo(): void { this.change(() => { if (this.strip) { if (this.strip.at + 1 < this.strip.frames.length) { this.strip.at++; this.strip.selectedEdge = -1; this.strip.delta = [0,0,0]; this.strip.error = null; this.message = null; this.historyRevision++ } } else this.stepDraftHistory(1) }, false, false, true) }

  private stepDraftHistory(delta:-1|1): void {
    const before=this.draft.getSnapshot(), accepted=delta===-1 ? this.draft.undo() : this.draft.redo()
    if (!accepted || !this.draft.adaptiveHistoryPending) return
    // A change of adaptive basis finishes after this synchronous command returns.
    const unsubscribe=this.draft.subscribe(()=>{
      const now=this.draft.getSnapshot()
      if(this.disposed || now.committedNet!==before.committedNet || !now.calculating) {
        unsubscribe()
        if(!this.disposed && now.committedNet!==before.committedNet) {this.draftEpoch++;this.historyRevision++;this.refresh();this.resolveNotes()}
      }
    })
  }

  /** Begin on a validated open face/shell. Strip history is independent of pole history. */
  async beginStrip(): Promise<void> {
    this.assertMutable()
    if (this.strip || this.stripPending || this.gesture !== 'idle' || this.notes.length || this.placingNote)
      throw new Error('Termina le altre operazioni e rimuovi le note prima di duplicare il bordo.')
    const d = this.draft.getSnapshot(), revision = d.preview?.previewRevision
    const faceCount = this.initialSheetFaceCount(d)
    if (faceCount === null ||
        !d.net || d.validNet !== d.net || d.calculating || d.previewStale || revision === undefined || this.snapshot.validation.kind !== 'valid')
      throw new Error('Serve una superficie aperta con anteprima valida di tutte le facce.')
    const cached = this.directCache
    if (cached && this.matchesDirect(cached, this.directIdentity())) {
      this.change(() => {
        this.strip = { baseNet:cached.net, basePreviewRevision:cached.revision, baseFaceCount:cached.faceCount, initialPaths:cached.paths,
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
          current.preview?.previewRevision !== revision || this.initialSheetFaceCount(current) !== faceCount || this.notes.length || this.placingNote)
        throw new Error('Anteprima del bordo superata.')
      this.change(() => {
        this.strip = { baseNet:net, basePreviewRevision:revision, baseFaceCount:faceCount, initialPaths:paths, frames:[null], at:0,
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
      this.strip = { baseNet:cached.net, basePreviewRevision:cached.revision, baseFaceCount:cached.faceCount, initialPaths:cached.paths,
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
        base.preview?.previewRevision !== strip.basePreviewRevision || this.initialSheetFaceCount(base) !== strip.baseFaceCount || this.notes.length || this.placingNote)
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
          current.validNet !== strip.baseNet || current.preview?.previewRevision !== strip.basePreviewRevision ||
          this.initialSheetFaceCount(current) !== strip.baseFaceCount || this.notes.length || this.placingNote)
        throw new Error('Risultato del bordo superato.')
      if (!result || typeof result.step !== 'string' || !result.step.trim() || !result.preview?.valid ||
          !Array.isArray(result.preview.faceMeshes) || result.preview.faceMeshes.length !== strip.baseFaceCount + previous.length + 1 ||
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

  async loadG1Supports(): Promise<void> {
    this.assertMutable()
    if (!this.panel.canLoadG1) throw new Error('Attendi una bozza CAD valida con bordi protetti prima di caricare i supporti.')
    const before = this.draft.getSnapshot(), epoch = this.selectionEpoch
    this.g1Candidates = Object.freeze([]); this.g1Choice = null; this.g1Basis = null; this.g1SearchNotice = null
    this.busy = true; this.message = null; this.refresh()
    try {
      const lists = await Promise.allSettled([
        this.runtime.worker.ask<G1SupportCandidates>({ action: 'g1SupportCandidates' }, this.context.signal),
        this.runtime.worker.ask<G1CurvedSupportCandidates>({ action: 'g1CurvedSupportCandidates' }, this.context.signal),
      ])
      this.assertLive()
      if (epoch !== this.selectionEpoch || before.refinements !== this.draft.getSnapshot().refinements)
        throw new Error('Elenco dei supporti G1 scaduto.')
      const candidates: WorkspaceG1Candidate[] = []
      let stamp: string | undefined, available = 0
      const unavailable: string[] = []
      const sides = ['uMin', 'uMax', 'vMin', 'vMax']
      for (const [family, outcome] of lists.entries()) {
        // Each topology classifier may explicitly refuse an unsupported selected
        // surface. Keep the other independently certified family available.
        if (outcome.status === 'rejected') { unavailable.push(family === 0 ? 'piani' : 'B-spline compatibili'); continue }
        available++
        const result = outcome.value
        if (!result?.stamp || result.stamp.faceIndex !== this.face || !/^brep-sha256:[a-f0-9]{64}$/i.test(result.stamp.sourceId) ||
            ![result.stamp.sourceRevision, result.stamp.selectionRevision].every(n => Number.isSafeInteger(n) && n >= 0) ||
            !Array.isArray(result.candidates) || result.candidates.length > 4 || (stamp !== undefined && stamp !== JSON.stringify(result.stamp)))
          throw new Error('Elenco dei supporti G1 scaduto o non verificabile.')
        stamp = JSON.stringify(result.stamp)
        for (const value of result.candidates) {
          const candidate = value as WorkspaceG1Candidate
          if (!candidate || typeof candidate.id !== 'string' || !candidate.id || JSON.stringify(candidate.stamp) !== stamp ||
              !Number.isSafeInteger(candidate.supportFaceIndex) || candidate.supportFaceIndex < 0 || candidate.supportFaceIndex >= this.faces.length || candidate.supportFaceIndex === this.face ||
              !Number.isSafeInteger(candidate.edgeIndex) || candidate.edgeIndex < 0 || candidate.edgeIndex > 3 || !sides.includes(candidate.side) ||
              !Number.isFinite(candidate.lengthMm) || candidate.lengthMm <= 0 ||
              (family === 0 ? candidate.kind !== undefined || !('plane' in candidate) ||
                !finitePoint(candidate.plane?.origin) || !finitePoint(candidate.plane?.normal) || Math.abs(Math.hypot(...candidate.plane.normal) - 1) > 1e-6
                : candidate.kind !== 'compatible-bspline' || !sides.includes(candidate.supportSide) || typeof candidate.reverseSupport !== 'boolean'))
            throw new Error('Candidato G1 non verificabile.')
          candidates.push(structuredClone(candidate))
        }
      }
      if (!available) throw new Error('Impossibile completare la ricerca dei supporti G1. Riprova o scegli un’altra faccia.')
      if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw new Error('Scelte dei supporti G1 ambigue.')
      for (const candidate of candidates) {
        Object.freeze(candidate.stamp)
        if (candidate.kind !== 'compatible-bspline') {
          Object.freeze(candidate.plane.origin); Object.freeze(candidate.plane.normal); Object.freeze(candidate.plane)
        }
        Object.freeze(candidate)
      }
      this.g1Candidates = Object.freeze(candidates)
      this.g1Choice = null
      this.g1Basis = { selectionEpoch: epoch, refinements: before.refinements }
      this.g1SearchNotice = unavailable.length ? `Ricerca incompleta: impossibile verificare i supporti ${unavailable.join(' e ')}. I risultati mostrati riguardano solo gli altri supporti verificati.` : null
      this.message = candidates.length ? (available === 2 ? null : 'Disponibili solo i supporti della famiglia certificabile per questa faccia.')
        : 'Nessun bordo naturale con un supporto adiacente compatibile disponibile.'
    } catch (error) {
      if (!this.disposed) this.message = String((error as Error)?.message ?? error)
      throw error
    } finally { if (!this.disposed) { this.busy = false; this.refresh(); this.resolveNotes() } }
  }

  chooseG1Support(id: string): void {
    this.assertMutable()
    if (!this.panel.canLoadG1 || !this.g1Basis || !this.g1Candidates.some(candidate => candidate.id === id))
      throw new Error('Supporto G1 non disponibile: carica di nuovo i supporti.')
    this.g1Choice = id; this.message = null; this.refresh()
  }

  async applyG1(): Promise<void> {
    this.assertMutable()
    const choice = this.g1Candidates.find(candidate => candidate.id === this.g1Choice)
    if (!this.panel.canApplyG1 || !choice) throw new Error('Scegli un supporto G1 e attendi la verifica CAD della bozza.')
    const before = this.draft.getSnapshot()
    this.busy = true; this.message = null; this.refresh()
    try {
      if (choice.kind === 'compatible-bspline') await this.draft.applyCurvedTangency(choice)
      else await this.draft.applyPlaneTangency(choice)
      this.assertLive()
    } catch (error) {
      if (!this.disposed) this.message = String((error as Error)?.message ?? error)
      throw error
    } finally {
      if (!this.disposed) {
        const after = this.draft.getSnapshot()
        if (before.committedNet !== after.committedNet || before.planeTangency !== after.planeTangency || before.curvedTangency !== after.curvedTangency) {
          this.draftEpoch++; this.historyRevision++
        }
        this.busy = false; this.refresh(); this.resolveNotes()
      }
    }
  }

  setContinuity(value: 'G0' | 'G1'): void { this.change(() => this.draft.setContinuity(value)) }
  setFreeBoundary(value: boolean): void {
    this.change(() => {
      if (value && !this.faces[this.face]?.freeBoundary) throw new Error('Il bordo di questa faccia non è libero.')
      this.draft.setFreeBoundary(value)
    })
  }
  /** Translate one entire natural CAD boundary, without creating another face.
   * Positive fixed weights and a clamped basis make the whole rim translate by
   * delta, including its endpoints and the incident adjacent boundary endpoints.
   */
  moveWholeBoundary(side: WholeBoundarySide, delta: Point): void {
    this.change(() => {
      if (!this.panel.canMoveWholeBoundary) throw new Error('Attiva i bordi liberi su una singola faccia naturale CAD valida, senza note, simmetria o vincoli.')
      if (!['U0','U1','V0','V1'].includes(side) || !finitePoint(delta) || Math.hypot(...delta)<=1e-7 || Math.hypot(...delta)>1000)
        throw new Error('Bordo o spostamento non valido (limite 1000 mm).')
      const d=this.draft.getSnapshot(),net=this.requireNet()
      const ids=wholeBoundaryIndices(net,side)
      const locked=new Set([...d.locks,...d.trimLocks,...d.hiddenPoles])
      if(ids.some(i=>locked.has(i))) throw new Error('Il bordo contiene un polo bloccato: nessuno spostamento parziale consentito.')
      const selected=new Set(ids)
      const poles=net.poles.map((p,i)=>selected.has(i)?p.map((x,d)=>x+delta[d]) as Point:pointCopy(p))
      if(poles.some(p=>!finitePoint(p))) throw new Error('Spostamento del bordo non rappresentabile.')
      this.draft.commit({...net,poles})
      this.draft.setSelection(ids)
      this.message='Bordo intero spostato nella bozza. Attendi la verifica CAD; gli estremi modificano anche i bordi adiacenti.'
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
  beginTangentPlane(): void {
    this.change(() => {
      const snapshot = this.draft.getSnapshot()
      if (this.surfaceTarget || !this.panel.canTargetPoint || !Number.isSafeInteger(snapshot.preview?.previewRevision))
        throw new Error('Seleziona poli liberi su una faccia CAD valida, senza simmetria o tangenze aggiunte.')
      this.surfaceTarget = { kind:'tangent-plane', snapshot, epoch:this.selectionEpoch }
      this.message = 'Clicca sulla faccia CAD selezionata per scegliere il piano tangente.'
    })
  }
  async pickTangentPlane(point: Point): Promise<void> {
    this.assertMutable()
    const operation = this.surfaceTarget
    if (operation?.kind !== 'tangent-plane' || !finitePoint(point)) throw new Error('Scegli un punto sulla faccia CAD selezionata.')
    const before = operation.snapshot, revision = before.preview?.previewRevision
    if (!before.net || revision === undefined || this.draft.getSnapshot() !== before)
      throw new Error('La bozza del piano tangente è cambiata.')
    this.busy = true
    this.refresh()
    try {
      const pin = await this.runtime.worker.ask<{anchor:DraftAnchor;at:Point;normal:Point}>({
        action:'notePick', point:pointCopy(point), previewRevision:revision,
      }, this.context.signal)
      this.assertLive()
      if (this.surfaceTarget !== operation || this.draft.getSnapshot() !== before || this.selectionEpoch !== operation.epoch ||
          this.frozen || this.symmetry || !pin || pin.anchor?.face !== this.face || !finitePoint(pin.at) || !finitePoint(pin.normal))
        throw new Error('Il punto CAD o la bozza del piano tangente è cambiato.')
      const length = Math.hypot(...pin.normal)
      if (!Number.isFinite(length) || length < 1e-12) throw new Error('Normale CAD non determinabile nel punto scelto.')
      const normal = pin.normal.map(value => value / length)
      const offset = (pole: Point) => pole.reduce((sum, value, axis) => sum + (value-pin.at[axis])*normal[axis], 0)
      const ids = this.editable().filter(id => !before.hiddenPoles.includes(id))
      if (!ids.length) throw new Error('Seleziona almeno un polo libero.')
      if (ids.every(id => Math.abs(offset(before.net!.poles[id])) <= 1e-9)) {
        this.message = 'I poli selezionati sono già sul piano tangente.'
        return
      }
      this.change(() => {
        this.transform(before.net!, ids, pole => {
          const distance = offset(pole)
          return pole.map((value, axis) => value-distance*normal[axis]) as Point
        })
        this.message = 'Poli proiettati sul piano tangente. Attendi la verifica CAD.'
      }, true)
    } finally {
      if (this.surfaceTarget === operation) this.surfaceTarget = null
      this.busy = false
      if (!this.disposed) { this.refresh(); this.resolveNotes() }
    }
  }
  stretchSelected(factor: number): void {
    this.change(() => {
      if (!Number.isFinite(factor) || factor <= 0 || factor > 3) throw new Error('Fattore non valido.')
      const net = this.requireNet(), ids = this.editable()
      const direction = ids.length ? dragDirection(net, ids[0], this.dragMode, this.axis) : null
      if (!direction) throw new Error('Seleziona un punto libero e una direzione valida.')
      const projection = (p: Point) => p.reduce((sum,x,i)=>sum+x*direction[i],0)
      const center = net.poles.reduce((sum,p)=>sum+projection(p),0)/net.poles.length
      this.transform(net, ids, p => {
        const delta=(projection(p)-center)*(factor-1)
        return p.map((x,i)=>x+direction[i]*delta) as Point
      })
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
  beginSurfaceTarget(kind: 'scan'|'cad', budget: number,multiple=false): void {
    this.change(() => {
      if (!this.panel.canTargetPoint || (kind!=='scan' && kind!=='cad') || !Number.isFinite(budget) || budget<=0 || budget>1000)
        throw new Error('Seleziona poli liberi su una faccia CAD valida, senza simmetria o tangenze aggiunte.')
      this.surfaceTarget={kind,snapshot:this.draft.getSnapshot(),budget,distance:this.snapDistance,epoch:this.selectionEpoch,...(multiple?{points:[]}:{})}
      this.message='Clicca un punto sulla faccia: cercherò il riferimento esterno più vicino lungo la normale CAD.'
    })
  }
  cancelSurfaceTarget(): void {
    if(this.surfaceTarget) {this.surfaceTarget=null;this.message=null;this.refresh()}
  }
  private referenceTarget() {
    const operation = this.surfaceTarget
    return operation?.kind === 'tangent-plane' ? null : operation
  }
  removeSurfaceTarget(index:number):void{
    this.assertMutable()
    const operation=this.surfaceTarget
    if(!operation?.points||!Number.isInteger(index)||index<0||index>=operation.points.length)throw Error('Punto raccolto non disponibile.')
    operation.points=operation.points.filter((_,i)=>i!==index);this.refresh()
  }
  private async collectSurfaceTarget(point:Point,resolve:WorkspacePointTargetResolver):Promise<void>{
    const operation=this.referenceTarget()
    if(!operation?.points||operation.points.length>=8)throw Error('Puoi raccogliere al massimo otto punti.')
    const before=operation.snapshot,revision=before.preview?.previewRevision
    if(revision===undefined)throw Error('Anteprima CAD non disponibile.')
    const current=()=>{
      this.assertLive()
      return this.surfaceTarget===operation&&this.draft.getSnapshot()===before&&this.selectionEpoch===operation.epoch&&
        !this.frozen&&operation.points!.every(p=>p.reference.current())
    }
    this.busy=true;this.refresh()
    try{
      if(!current())throw Error('Bozza o riferimenti raccolti cambiati.')
      const pin=await this.runtime.worker.ask<{anchor:DraftAnchor;at:Point;normal:Point}>({action:'notePick',point:pointCopy(point),previewRevision:revision},this.context.signal)
      if(!current()||!pin||!finitePoint(pin.at)||!finitePoint(pin.normal)||pin.anchor?.face!==this.face)throw Error('Anchor CAD non disponibile per la raccolta.')
      if(operation.points.some(p=>Math.hypot(...p.at.map((x,d)=>x-pin.at[d]))<=1e-7))throw Error('Questo punto CAD è già nella raccolta.')
      const target=resolve(pointCopy(pin.at),pointCopy(pin.normal),operation.distance,operation.kind)
      if(!target||target.kind!==operation.kind||!finitePoint(target.point)||!target.current())throw Error('Nessun riferimento esterno valido per questo punto.')
      if(!current())throw Error('Bozza o riferimenti raccolti cambiati.')
      // Freeze the selected destination; retain its original provenance check.
      operation.points=[...operation.points,{anchor:structuredClone(pin.anchor),at:pointCopy(pin.at),
        reference:{kind:target.kind,label:target.label,point:pointCopy(target.point),current:()=>target.current()}}]
      this.message=`${operation.points.length} punti raccolti. Rivedi le coppie prima di applicare; nessuna geometria modificata.`
    }catch(error){
      try{if(!current()&&this.surfaceTarget===operation)this.surfaceTarget=null}catch{if(this.surfaceTarget===operation)this.surfaceTarget=null}
      throw error
    }finally{this.busy=false;if(!this.disposed)this.refresh()}
  }
  async applySurfaceTargets():Promise<void>{
    this.assertMutable()
    const operation=this.referenceTarget(),points=operation?.points
    if(!operation||!points||points.length<2)throw Error('Raccogli almeno due punti prima di applicare.')
    const current=()=>{
      this.assertLive()
      return this.surfaceTarget===operation&&this.selectionEpoch===operation.epoch&&!this.frozen&&points.every(p=>p.reference.current())
    }
    let retainBatch=false
    this.busy=true;this.refresh()
    try{
      const result=await this.draft.targetPointsExperimental(operation.snapshot,points.map(p=>({anchor:p.anchor,target:p.reference.point})),
        {maxPoleDisplacement:operation.budget,minInfluence:.01,residualTolerance:1e-7},current)
      this.draftEpoch++;this.historyRevision++
      this.message=`${points.length} agganci simultanei: residuo numerico massimo ${Math.max(...result.residuals).toExponential(2)} mm. Attendi la verifica CAD.`
    }catch(error){
      if(error instanceof SurfacePointTargetsCandidateRefusal){
        try{retainBatch=current()&&this.draft.getSnapshot()===operation.snapshot}catch{/* Changed source or revoked reference: discard. */}
      }
      if(retainBatch)this.message='Agganci conservati per la revisione. Nessuna geometria modificata: rimuovi punti o annulla la raccolta.'
      throw error
    }finally{if(!retainBatch)this.surfaceTarget=null;this.busy=false;if(!this.disposed){this.refresh();this.resolveNotes()}}
  }
  async pickSurfaceTarget(point: Point | null, resolve: WorkspacePointTargetResolver): Promise<void> {
    this.assertMutable()
    const operation=this.referenceTarget()
    if(!operation || !point || !finitePoint(point)) throw new Error('Clicca sulla faccia CAD selezionata.')
    if(operation.points)return this.collectSurfaceTarget(point,resolve)
    const before=operation.snapshot,revision=before.preview?.previewRevision
    if(this.draft.getSnapshot()!==before || revision===undefined || this.gesture!=='idle' || this.strip || this.stripPending)
      throw new Error('La bozza del punto superficie è cambiata.')
    this.busy=true;this.refresh()
    try {
      const pin=await this.runtime.worker.ask<{anchor:DraftAnchor;at:Point;normal:Point}>({action:'notePick',point:pointCopy(point),previewRevision:revision},this.context.signal)
      this.assertLive()
      if(this.surfaceTarget!==operation || this.draft.getSnapshot()!==before || this.selectionEpoch!==operation.epoch ||
          !pin || !finitePoint(pin.at) || !finitePoint(pin.normal) || !pin.anchor || pin.anchor.face!==this.face)
        throw new Error('La faccia è cambiata durante la scelta del punto superficie.')
      const target=resolve(pointCopy(pin.at),pointCopy(pin.normal),operation.distance,operation.kind)
      if(!target || target.kind!==operation.kind || !finitePoint(target.point))
        throw new Error('Nessun riferimento esterno del tipo scelto entro la portata, lungo la normale CAD.')
      const current=()=>{
        this.assertLive()
        return this.surfaceTarget===operation && this.selectionEpoch===operation.epoch && !this.frozen && target.current()
      }
      const result=await this.draft.targetPoint(before,pin.anchor,{target:pointCopy(target.point),maxPoleDisplacement:operation.budget,
        minInfluence:.01,residualTolerance:1e-7},current)
      this.draftEpoch++;this.historyRevision++
      this.message=`Punto verso ${target.label}: residuo numerico ${result.residual.toExponential(2)} mm. Attendi la verifica CAD.`
    } finally {
      this.surfaceTarget=null;this.busy=false
      if(!this.disposed) {this.refresh();this.resolveNotes()}
    }
  }
  setSnapDistance(value: number): void { this.change(() => { if (!Number.isFinite(value) || value < .001 || value > 1000) throw new Error('Portata magnete non valida.'); this.snapDistance = value }) }
  /** Experimental batch entry only. No viewport collection UI is mounted.
   * Seeds are part-mm picks; CAD supplies every UV anchor and normal, and the
   * existing resolver must supply a current external scan/CAD reference. */
  async targetSurfacePointsExperimental(kind:'scan'|'cad',budget:number,seeds:readonly Point[],resolve:WorkspacePointTargetResolver):Promise<void>{
    this.assertMutable()
    const input=structuredClone(seeds)
    if(this.surfaceTarget||!Array.isArray(input)||input.length<2||input.length>8||input.some(p=>!finitePoint(p)))
      throw Error('Sono richiesti da due a otto punti superficie e nessun aggancio già attivo.')
    this.beginSurfaceTarget(kind,budget)
    const operation=this.referenceTarget()
    if(!operation)throw Error('Raccolta dei riferimenti non disponibile.')
    const before=operation.snapshot,revision=before.preview!.previewRevision!
    const references:ReturnType<WorkspacePointTargetResolver>[]=[]
    const current=()=>{
      this.assertLive()
      return this.surfaceTarget===operation&&this.selectionEpoch===operation.epoch&&!this.frozen&&references.every(r=>r?.current())
    }
    this.busy=true;this.refresh()
    try{
      const points:{anchor:DraftAnchor;target:Point}[]=[]
      for(const seed of input){
        const pin=await this.runtime.worker.ask<{anchor:DraftAnchor;at:Point;normal:Point}>({action:'notePick',point:pointCopy(seed),previewRevision:revision},this.context.signal)
        if(!current()||this.draft.getSnapshot()!==before||!pin||!finitePoint(pin.at)||!finitePoint(pin.normal)||!pin.anchor||pin.anchor.face!==this.face)
          throw Error('Faccia o riferimenti cambiati durante la scelta dei punti simultanei.')
        const target=resolve(pointCopy(pin.at),pointCopy(pin.normal),operation.distance,kind)
        if(!target||target.kind!==kind||!finitePoint(target.point)||!target.current())throw Error('Riferimento esterno non disponibile per uno dei punti simultanei.')
        references.push(target);points.push({anchor:structuredClone(pin.anchor),target:pointCopy(target.point)})
      }
      const result=await this.draft.targetPointsExperimental(before,points,{maxPoleDisplacement:budget,minInfluence:.01,residualTolerance:1e-7},current)
      this.draftEpoch++;this.historyRevision++
      this.message=`${points.length} punti simultanei: residuo numerico massimo ${Math.max(...result.residuals).toExponential(2)} mm. Attendi la verifica CAD.`
    }finally{
      this.surfaceTarget=null;this.busy=false
      if(!this.disposed){this.refresh();this.resolveNotes()}
    }
  }
  setDragMode(value: DragMode): void { this.change(() => { if (!['axis','screen','local'].includes(value)) throw new Error('Modalità non valida.'); this.dragMode = value }) }
  setAxis(value: number): void { this.change(() => { if (![0,1,2].includes(value)) throw new Error('Asse non valido.'); this.axis = value }) }
  setDragStrength(value: number): void { this.change(() => { if (!Number.isFinite(value) || value < .05 || value > 1) throw new Error('Intensità non valida.'); this.dragStrength = value }) }
  setSelectionMode(value: NetSelectionMode): void { this.change(() => { if (!['auto','points','edges','cells','mixed'].includes(value)) throw new Error('Selezione non valida.'); this.selectionMode = value }) }
  setNavigationOnly(value: boolean): void { this.change(() => { this.navigationOnly = value }, false, false, true) }
  setShowNet(value: boolean): void { this.change(() => { this.showNet = value }) }
  setStripes(value: WorkspaceStripeSettings | null): void {
    this.change(() => {
      if (value && (!['horizontal','vertical'].includes(value.orientation) || !Number.isFinite(value.width) ||
          value.width < 1 || value.width > 7 || !/^#[0-9a-f]{6}$/i.test(value.color))) throw new Error('Opzioni Zebra non valide.')
      this.stripes = value ? Object.freeze({ ...value }) : null
    }, false, false, true)
  }
  setPlacingNote(value: boolean): void { this.change(() => {
    this.surfaceTarget=null
    if(value && this.draft.getSnapshot().cylinderSession!==null && !this.currentValidatedCylinder()) throw new Error('Verifica prima la faccia cilindrica.')
    this.placingNote = value
  }) }
  setNoteText(id: string, text: string): void {
    this.change(() => {
      if (text.length > 2000 || !this.notes.some(note => note.id === id)) throw new Error('Nota non valida.')
      if (this.notes.find(note => note.id === id)?.text === text) return
      this.advanceNotesRevision()
      this.notes = Object.freeze(this.notes.map(note => note.id === id ? Object.freeze({ ...note, text }) : note))
    })
  }
  removeNote(id: string): void { this.change(() => {
    if (!this.notes.some(note => note.id === id)) return
    this.advanceNotesRevision()
    this.notes = Object.freeze(this.notes.filter(note => note.id !== id))
  }) }
  retryNoteResolution(): void {
    this.assertMutable()
    const revision = this.currentValidatedCylinder()?.previewRevision ?? this.draft.getSnapshot().preview?.previewRevision
    if (revision === undefined || revision !== this.failedNoteRevision || this.notes !== this.failedNoteSet) return
    this.failedNoteRevision = null; this.failedNoteSet = null; this.message = null
    this.resolveNotes(); this.refresh()
  }

  async placeNote(point: Point | null): Promise<void> {
    this.assertMutable()
    if (this.strip || this.stripPending) throw new Error('Chiudi prima la modifica del bordo.')
    if (this.notes.length >= 200) throw new Error('Sono consentite al massimo 200 note per questa modifica.')
    if (!point || !finitePoint(point)) throw new Error('Clicca sulla faccia CAD.')
    const draft = this.draft.getSnapshot(), cylinder=this.currentValidatedCylinder(), revision = cylinder?.previewRevision ?? draft.preview?.previewRevision
    if (!draft.net || (!cylinder && draft.validNet !== draft.net) || draft.calculating || revision === undefined)
      throw new Error('Attendi la verifica CAD della faccia.')
    this.change(() => { this.busy = true; this.message = null })
    const epoch = this.selectionEpoch, net = draft.net
    try {
      const pin = await this.runtime.worker.ask<{anchor: DraftAnchor; at: Point; normal: Point}>(
        cylinder ? { action:'cylinderNotePick', session:cylinder.session, point:pointCopy(point), previewRevision:revision }
          : { action: 'notePick', point: pointCopy(point), previewRevision: revision }, this.context.signal)
      this.assertLive()
      const current = this.draft.getSnapshot()
      if (epoch !== this.selectionEpoch || current.net !== net ||
          (cylinder ? this.currentValidatedCylinder()!==cylinder : current.validNet !== net || current.preview?.previewRevision !== revision) || !finitePoint(pin.at) || !finitePoint(pin.normal) ||
          !pin.anchor || pin.anchor.face !== this.face || !Number.isSafeInteger(pin.anchor.selectionRevision) ||
          !Number.isFinite(pin.anchor.u) || !Number.isFinite(pin.anchor.v)) throw new Error('La faccia è cambiata durante la scelta della nota.')
      this.change(() => {
        this.advanceNotesRevision()
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

  /** Prepare the current unannotated net for a future host history feature.
   * This does not publish a feature or change the host project. The caller
   * must still check the source and draft epochs at its own commit boundary. */
  async prepareHistoryRecipe(): Promise<PreparedHistoryRecipe> {
    this.assertMutable()
    const before = this.draft.getSnapshot()
    if (this.gesture !== 'idle' || this.placingNote || this.notes.length || this.strip || this.stripPending ||
        this.snapshot.validation.kind !== 'valid' || !before.net || before.net !== before.committedNet ||
        before.validNet !== before.net || before.calculating || before.cylinderSession !== null)
      throw new Error('Termina le operazioni e verifica la bozza senza note prima di preparare la ricetta.')
    const selectionEpoch = this.selectionEpoch, draftEpoch = this.draftEpoch, net = before.net
    this.busy = true
    this.refresh()
    try {
      const recipe = this.runtime.history.current?.preparation?.adaptiveSelection
        ? await this.draft.createAdaptiveLockedRecipe(this.source.bodyKey)
        : before.curvedTangency
        ? await this.draft.createCurvedRecipe(this.source.bodyKey)
        : await this.draft.createRecipe(this.source.bodyKey)
      this.assertLive()
      if (this.selectionEpoch !== selectionEpoch || this.draftEpoch !== draftEpoch || this.draft.getSnapshot().net !== net ||
          this.notes.length || this.strip || this.gesture !== 'idle')
        throw new Error('La bozza è cambiata durante la preparazione della ricetta.')
      const prepared={ recipe, sessionId: this.context.sessionId, sourceKey: this.sourceId, selectionEpoch, draftEpoch }
      this.historyGuards.set(prepared,JSON.stringify(recipe))
      return prepared
    } finally {
      if (!this.disposed) { this.busy = false; this.refresh(); this.resolveNotes() }
    }
  }

  /** Session-bound freshness and unchanged recipe; host must still replay it. */
  isHistoryRecipeStampCurrent(prepared: PreparedHistoryRecipe): boolean {
    return this.historyRecipeCurrent(prepared, null)
  }
  private historyRecipeCurrent(prepared: PreparedHistoryRecipe, allowedFrozen: Frozen | null): boolean {
    try {
      this.assertLive()
      return !!prepared && this.historyGuards.has(prepared) && this.historyGuards.get(prepared)===JSON.stringify(prepared.recipe) &&
        prepared.sessionId === this.context.sessionId && prepared.sourceKey === this.sourceId &&
        prepared.selectionEpoch === this.selectionEpoch && prepared.draftEpoch === this.draftEpoch &&
        !this.busy && !this.mutating && this.frozen === allowedFrozen && this.gesture === 'idle' && !this.placingNote && !this.notes.length &&
        !this.strip && !this.stripPending && this.snapshot.validation.kind === 'valid'
    } catch { return false }
  }

  /** Produce a recipe plus durable UVs; the host must replay and commit both atomically. */
  async prepareAnnotatedHistory(): Promise<PreparedAnnotatedHistory> {
    this.assertMutable()
    const before=this.draft.getSnapshot(), revision=before.preview?.previewRevision, notes=this.notes
    if (!notes.length || this.gesture!=='idle' || this.placingNote || this.strip || this.stripPending ||
        this.snapshot.validation.kind!=='valid' || !before.net || before.net!==before.committedNet ||
        before.validNet!==before.net || before.calculating || before.cylinderSession!==null || revision===undefined ||
        notes.some(note=>note.revision!==revision || note.anchor.face!==this.face || !note.text.trim() ||
          !Number.isFinite(note.anchor.u) || !Number.isFinite(note.anchor.v)))
      throw new Error('Verifica la superficie e tutte le note prima di preparare la cronologia.')
    const selectionEpoch=this.selectionEpoch,draftEpoch=this.draftEpoch,notesRevision=this.notesRevision,net=before.net
    const savedNotes=Object.freeze(notes.map(note=>Object.freeze({id:note.id,text:note.text,faceIndex:note.anchor.face,u:note.anchor.u,v:note.anchor.v})))
    this.busy=true;this.refresh()
    try {
      const recipe=this.runtime.history.current?.preparation?.adaptiveSelection
        ? await this.draft.createAdaptiveLockedRecipe(this.source.bodyKey)
        : before.curvedTangency ? await this.draft.createCurvedRecipe(this.source.bodyKey) : await this.draft.createRecipe(this.source.bodyKey)
      this.assertLive()
      if (this.selectionEpoch!==selectionEpoch || this.draftEpoch!==draftEpoch || this.notesRevision!==notesRevision ||
          this.notes!==notes || this.draft.getSnapshot().net!==net || this.strip || this.gesture!=='idle')
        throw new Error('Superficie o note cambiate durante la preparazione.')
      const prepared=Object.freeze({recipe,notes:savedNotes,notesRevision,sessionId:this.context.sessionId,sourceKey:this.sourceId,selectionEpoch,draftEpoch})
      this.annotatedHistoryGuards.set(prepared,{net,notes:JSON.stringify(savedNotes),recipe:JSON.stringify(recipe)})
      return prepared
    } finally { if(!this.disposed){this.busy=false;this.refresh();this.resolveNotes()} }
  }

  /** Freshness only; host must independently validate recipe/notes and commit atomically. */
  isAnnotatedHistoryStampCurrent(prepared: PreparedAnnotatedHistory): boolean {
    return this.annotatedHistoryCurrent(prepared, null)
  }
  private annotatedHistoryCurrent(prepared: PreparedAnnotatedHistory, allowedFrozen: Frozen | null): boolean {
    try {
      this.assertLive()
      const d=this.draft.getSnapshot(), revision=d.preview?.previewRevision
      const guard=this.annotatedHistoryGuards.get(prepared)
      const content=this.notes.map(note=>({id:note.id,text:note.text,faceIndex:note.anchor.face,u:note.anchor.u,v:note.anchor.v}))
      return !!prepared && prepared.sessionId===this.context.sessionId && prepared.sourceKey===this.sourceId &&
        !!guard && JSON.stringify(prepared.recipe)===guard.recipe && prepared.selectionEpoch===this.selectionEpoch && d.net===guard.net &&
        JSON.stringify(content)===guard.notes && !!this.notes.length &&
        revision!==undefined && this.notes.every(note=>note.revision===revision) && !this.busy && !this.mutating && this.frozen===allowedFrozen &&
        this.gesture==='idle' && !this.placingNote && !this.strip && !this.stripPending && this.snapshot.validation.kind==='valid'
    } catch { return false }
  }

  /** Freeze a prepared history bundle before the host starts its transaction.
   * The same bundle identity and contents must remain valid at the host's
   * commit boundary. The lock does not authorize or perform publication. */
  freezeHistory(prepared: PreparedHistoryRecipe | PreparedAnnotatedHistory): HistoryFreeze {
    const annotated = this.annotatedHistoryGuards.has(prepared as PreparedAnnotatedHistory)
    const current = (lock: Frozen | null) => annotated
      ? this.annotatedHistoryCurrent(prepared as PreparedAnnotatedHistory, lock)
      : this.historyRecipeCurrent(prepared, lock)
    if (!current(null)) throw new Error('La ricetta non corrisponde alla bozza verificata corrente.')
    const validation = this.snapshot.validation
    if (validation.kind !== 'valid') throw new Error('La bozza CAD non è verificata.')
    const lock: Frozen = { ticketKey:'history-only', operationId:crypto.randomUUID(), source:Object.freeze({ ...this.source }),
      stamp:Object.freeze({ ...validation.stamp }), stripResult:null,
      ...(annotated ? {notes:this.notes, notesRevision:this.notesRevision} : {}), preparing:false }
    this.frozen = lock
    try { this.refresh() }
    catch (error) {
      // A subscriber must not leave an unreleasable lock when notification
      // fails before the host has received the release handle.
      if (this.frozen===lock) this.frozen=null
      if (!this.disposed) { try { this.refresh() } catch { /* Preserve the original error. */ } }
      throw error
    }
    let released = false
    return Object.freeze({
      isCurrent: () => !released && this.frozen===lock && current(lock) &&
        this.snapshot.validation.kind==='valid' && stampKey(this.snapshot.validation.stamp)===stampKey(lock.stamp),
      release: () => {
        if (released) return
        released = true
        if (this.frozen===lock) { this.frozen=null; if (!this.disposed) { this.refresh(); this.resolveNotes() } }
      },
    })
  }

  /** Restore only into a new session, preserving any existing user draft. */
  async restoreHistoryRecipe(value: unknown): Promise<void> {
    this.assertMutable()
    if (this.face >= 0 || this.draft.getSnapshot().net || this.notes.length || this.placingNote ||
        this.strip || this.stripPending || this.gesture !== 'idle')
      throw new Error('Apri una nuova sessione vuota per ripristinare la ricetta.')
    const version = (value as { version?: unknown } | null)?.version
    const recipe = version === 8 ? readAdaptiveLockedRecipe(value) : version === 6 ? readCurvedRecipe(value) : readRecipe(value)
    if (recipe.source.bodyId !== this.source.bodyKey) throw new Error('La ricetta appartiene a un altro corpo CAD.')
    this.busy = true
    this.refresh()
    this.mutating = true
    let workerRestoreStarted = false
    try {
      const bytes = this.context.step.slice()
      const digest = await this.digest(bytes)
      this.assertLive()
      if (digest.toLowerCase() !== this.source.stepSha256.toLowerCase()) throw new Error('Il contenuto STEP non corrisponde alla sorgente.')
      const step = new TextDecoder().decode(bytes)
      workerRestoreStarted = true
      const result = version === 8
        ? await this.draft.restoreAdaptiveLockedRecipe(step, recipe, this.source.bodyKey)
        : version === 6
        ? await this.draft.restoreCurvedRecipe(step, recipe, this.source.bodyKey)
        : await this.draft.restoreRecipe(step, recipe, this.source.bodyKey)
      this.assertLive()
      if (result.preparation.face !== recipe.faceIndex || !this.faces[result.preparation.face] || result.faces.length !== this.faces.length)
        throw new Error('La faccia ripristinata non corrisponde alla sorgente CAD.')
      this.face = result.preparation.face
      this.selectionEpoch++; this.draftEpoch++; this.historyRevision++
      const net = this.draft.getSnapshot().net
      if (!net) throw new Error('Reticolo ripristinato non disponibile.')
      this.restoredHistory = { selectionEpoch:this.selectionEpoch, draftEpoch:this.draftEpoch, net }
    } catch (error) {
      // A failed worker restore may have replaced its internal model. Do not
      // leave a partially adopted session available to the host.
      if (workerRestoreStarted) {
        const message = `Impossibile ripristinare Edit Surface: ${String((error as Error)?.message ?? error)}`
        try { this.context.reportFatal(message) } catch { /* Preserve the original restore error. */ }
        try { this.releaseOwned() } catch { /* Preserve the original restore error. */ }
      }
      throw error
    } finally {
      this.mutating = false
      if (!this.disposed) { this.busy = false; this.refresh(); this.resolveNotes() }
    }
  }

  /** Wait for the fresh CAD preview produced by a restored recipe. The host
   * must still recheck its own source and commit atomically after this wait. */
  waitRestoredHistoryReady(signal?: AbortSignal): Promise<void> {
    this.assertLive()
    const base = this.restoredHistory
    if (!base) return Promise.reject(new Error('Nessuna ricetta ripristinata da verificare.'))
    return new Promise((resolve, reject) => {
      let finished = false, unsubscribe: (() => void) | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        unsubscribe?.(); if (timer !== undefined) clearTimeout(timer)
        signal?.removeEventListener('abort', cancelled)
        this.context.signal.removeEventListener('abort', cancelled)
        this.disposedSignal.signal.removeEventListener('abort', cancelled)
      }
      const finish = (error?: unknown) => {
        if (finished) return
        finished = true; cleanup()
        if (error !== undefined) reject(error); else resolve()
      }
      const cancelled = () => finish(new DOMException('Operazione annullata.', 'AbortError'))
      const check = () => {
        try {
          abortIf(this.context.signal); if (signal) abortIf(signal)
          this.assertLive()
          const draft = this.draft.getSnapshot()
          if (this.restoredHistory!==base || this.selectionEpoch!==base.selectionEpoch ||
              this.draftEpoch!==base.draftEpoch || draft.net!==base.net)
            throw new Error('La superficie è cambiata durante il ripristino.')
          if (this.snapshot.validation.kind==='invalid') throw new Error(this.snapshot.validation.message)
          if (!this.busy && !draft.calculating && draft.validNet===base.net &&
              draft.preview?.previewRevision!==undefined && this.snapshot.validation.kind==='valid') finish()
        } catch (error) { finish(error) }
      }
      unsubscribe = this.subscribe(check)
      signal?.addEventListener('abort', cancelled, { once:true })
      this.context.signal.addEventListener('abort', cancelled, { once:true })
      this.disposedSignal.signal.addEventListener('abort', cancelled, { once:true })
      timer = setTimeout(() => finish(new Error('Tempo di verifica della superficie ripristinata esaurito.')), 60000)
      check()
    })
  }

  /** Restore a host-supplied recipe and its notes as one editor operation.
   * Failure after adopting the recipe closes this fresh session so a partial
   * draft cannot masquerade as the complete saved feature. */
  async restoreHistoryBundle(value: { readonly recipe: unknown; readonly notes: unknown }, signal?: AbortSignal): Promise<void> {
    this.assertLive()
    if (signal) abortIf(signal)
    if (!value || typeof value !== 'object' || !Array.isArray(value.notes)) throw new Error('Pacchetto cronologia non valido.')
    const bundle = structuredClone(value)
    let adopted = false
    try {
      await this.restoreHistoryRecipe(bundle.recipe)
      adopted = true
      await this.waitRestoredHistoryReady(signal)
      if (signal) abortIf(signal)
      await this.restoreHistoryNotes(bundle.notes, signal)
      if (signal) abortIf(signal)
      this.assertLive()
    } catch (error) {
      if (adopted && !this.disposed) {
        try { this.context.reportFatal(`Impossibile ripristinare la superficie e le note: ${String((error as Error)?.message ?? error)}`) }
        catch { /* Preserve the original restore error. */ }
        try { this.releaseOwned() } catch { /* Preserve the original restore error. */ }
      }
      throw error
    }
  }

  /** Rebind notes only after this session restored and validated its recipe.
   * UVs are checked by OCCT on the trimmed face; publish all or none. */
  async restoreHistoryNotes(value: unknown, signal?: AbortSignal): Promise<void> {
    this.assertMutable()
    if (signal) abortIf(signal)
    const base=this.restoredHistory, draft=this.draft.getSnapshot(), revision=draft.preview?.previewRevision
    if (!base || base.selectionEpoch!==this.selectionEpoch || base.draftEpoch!==this.draftEpoch ||
        base.net!==draft.net || draft.validNet!==draft.net || draft.calculating || revision===undefined ||
        this.snapshot.validation.kind!=='valid' || this.notes.length || this.placingNote || this.strip || this.gesture!=='idle')
      throw new Error('Ripristina e verifica prima la modifica CAD senza note.')
    if (!Array.isArray(value) || value.length>200) throw new Error('Elenco note non valido.')
    const input=structuredClone(value) as HistorySurfaceNote[]
    if (input.some(n=>!n || typeof n.id!=='string' || !n.id.trim() || n.id.length>200 ||
        typeof n.text!=='string' || !n.text.trim() || n.text.length>2000 || n.faceIndex!==this.face ||
        !Number.isFinite(n.u) || !Number.isFinite(n.v)) || new Set(input.map(n=>n.id)).size!==input.length)
      throw new Error('Una nota salvata non è valida o appartiene a un’altra faccia.')
    if (!input.length) return
    const linked=new AbortController()
    const cancel=()=>linked.abort()
    this.context.signal.addEventListener('abort',cancel,{once:true})
    signal?.addEventListener('abort',cancel,{once:true})
    if(this.context.signal.aborted || signal?.aborted) cancel()
    const unchanged=()=>{
      abortIf(linked.signal)
      this.assertLive()
      const now=this.draft.getSnapshot()
      if (this.restoredHistory!==base || this.selectionEpoch!==base.selectionEpoch || this.draftEpoch!==base.draftEpoch ||
          now.net!==base.net || now.validNet!==base.net || now.calculating || now.preview?.previewRevision!==revision || this.notes.length)
        throw new Error('La superficie è cambiata durante il ripristino delle note.')
    }
    try {
      this.busy=true;this.refresh()
      const witness=await this.runtime.worker.ask<{face:number;selectionRevision:number;previewRevision:number}>(
        {action:'finalFaceWitness',previewRevision:revision},linked.signal)
      unchanged()
      if (!witness || witness.face!==this.face || witness.previewRevision!==revision || !Number.isSafeInteger(witness.selectionRevision))
        throw new Error('Identità della faccia non valida.')
      const restored:Note[]=[]
      for (const item of input) {
        const anchor={face:this.face,selectionRevision:witness.selectionRevision,u:item.u,v:item.v}
        const point=await this.runtime.worker.ask<{at:Point;normal:Point}>({action:'noteResolve',anchor,previewRevision:revision},linked.signal)
        unchanged()
        if (!finitePoint(point?.at) || !finitePoint(point?.normal) || Math.abs(Math.hypot(...point.normal)-1)>1e-6)
          throw new Error('Posizione della nota non valida.')
        restored.push(Object.freeze({id:item.id,text:item.text,anchor:Object.freeze(anchor),at:freezePoint(point.at),normal:freezePoint(point.normal),revision}))
      }
      this.advanceNotesRevision();this.notes=Object.freeze(restored);this.draftEpoch++;this.restoredHistory=null
    } finally {
      this.context.signal.removeEventListener('abort',cancel);signal?.removeEventListener('abort',cancel)
      if(!this.disposed){this.busy=false;this.refresh();this.resolveNotes()}
    }
  }

  /** Explicit, slower CAD check. A provisional rendering alone cannot Apply. */
  async validateCylinder(): Promise<void> {
    this.assertMutable()
    const draft=this.draft.getSnapshot(),net=draft.net,session=draft.cylinderSession
    if(!net || session===null || draft.calculating || this.gesture!=='idle' || this.placingNote)
      throw new Error('Termina il trascinamento e attendi l’anteprima prima di verificare.')
    const draftEpoch=this.draftEpoch,selectionEpoch=this.selectionEpoch,requestId=++this.cylinderValidationSerial
    this.cylinderValidated=null;this.busy=true;this.message='Verifica CAD del cilindro in corso…';this.refresh()
    try {
      const result=await this.draft.evaluateCylinderForExport()
      this.assertLive()
      const current=this.draft.getSnapshot()
      if(current.net!==net || current.cylinderSession!==session || this.draftEpoch!==draftEpoch ||
         this.selectionEpoch!==selectionEpoch || requestId!==this.cylinderValidationSerial || !result.step.trim())
        throw new Error('La bozza è cambiata durante la verifica CAD.')
      this.cylinderValidated={net,session,historyRevision:this.historyRevision,selectionEpoch,requestId,previewRevision:result.previewRevision,step:result.step}
      this.message='Cilindro verificato con controlli sperimentali: puoi creare una copia CAD.'
    } catch(error) {
      if(!this.disposed) this.message=String((error as Error)?.message ?? error)
      throw error
    } finally {if(!this.disposed){this.busy=false;this.refresh();this.resolveNotes()}}
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

  /** A capable host may publish all resolved notes with the validated CAD copy. */
  freezeAnnotated(ticket: AnnotatedTicketV1): () => void {
    this.assertLive()
    if (!this.supportsAnnotatedCopy()) throw new Error('Il progetto non supporta ancora il salvataggio delle note con la copia CAD.')
    const d = this.draft.getSnapshot(), revision = this.currentValidatedCylinder()?.previewRevision ?? d.preview?.previewRevision
    if (this.frozen || this.mutating || this.busy || this.placingNote || this.gesture !== 'idle' || this.strip || this.stripPending ||
        !this.notes.length || this.notes.length > 200 || revision === undefined ||
        this.notes.some(note => !note.text.trim() || note.revision !== revision))
      throw new Error('Completa e attendi la verifica di tutte le note prima di applicare.')
    if (!ticket || ticket.annotationVersion !== 1 || ticket.mode !== 'annotated-cad-copy' ||
        typeof ticket.operationId !== 'string' || !ticket.operationId.trim() || !ticket.source || !ticket.stamp ||
        ticket.notesRevision !== this.notesRevision || sourceKey(ticket.source) !== this.sourceId ||
        this.snapshot.validation.kind !== 'valid' || stampKey(ticket.stamp) !== stampKey(this.snapshot.validation.stamp))
      throw new Error('Il ticket annotato non corrisponde alla bozza convalidata.')
    const frozen: Frozen = { ticketKey: ticketKey(ticket), operationId: ticket.operationId,
      source: Object.freeze({ ...this.source }), stamp: Object.freeze({ ...ticket.stamp }), stripResult: null,
      notes: this.notes, notesRevision: this.notesRevision, preparing: false }
    this.frozen = frozen
    this.refresh()
    return () => {
      if (this.frozen === frozen) {
        this.frozen = null
        if (!this.disposed) { this.refresh(); this.resolveNotes() }
      }
    }
  }

  async prepareApply(ticket: ApplyTicket, signal: AbortSignal): Promise<PreparedCadCopy> {
    const frozen = this.frozen
    if (!frozen || frozen.preparing) throw new Error('La bozza non è congelata o è già in preparazione.')
    this.assertFrozen(ticket, frozen, signal)
    frozen.preparing = true
    try {
      const cylinder = this.currentValidatedCylinder()
      const result = cylinder ? {step:cylinder.step} : frozen.stripResult ?? await this.draft.evaluateForExport()
      this.assertFrozen(ticket, frozen, signal)
      if (!result.step.trim()) throw new Error('Esportazione STEP vuota.')
      const step = new TextEncoder().encode(result.step)
      this.assertFrozen(ticket, frozen, signal)
      return { kind: 'cad-copy', operationId: frozen.operationId, source: frozen.source, stamp: frozen.stamp,
        units: 'mm', coordinateFrame: 'part', name: 'superficie-modificata.step', step, draftNoteCount: 0 }
    } finally { frozen.preparing = false }
  }

  /** Prepare a single-face witness and every note against the final STEP evaluation. */
  async prepareAnnotatedApply(ticket: AnnotatedTicketV1, signal: AbortSignal): Promise<PreparedAnnotatedCopyV1> {
    const frozen = this.frozen
    if (!frozen || !frozen.notes || frozen.preparing) throw new Error('La bozza annotata non è congelata o è già in preparazione.')
    this.assertFrozenAnnotated(ticket, frozen, signal)
    frozen.preparing = true
    try {
      const cylinder=this.currentValidatedCylinder()
      const result = cylinder ? {step:cylinder.step,previewRevision:cylinder.previewRevision} : await this.draft.evaluateForExport()
      this.assertFrozenAnnotated(ticket, frozen, signal)
      if (!result.step.trim() || result.step.charCodeAt(0) === 0xfeff || !Number.isSafeInteger(result.previewRevision))
        throw new Error('Esportazione STEP annotata non valida.')
      const step = new TextEncoder().encode(result.step)
      if (!step.length || step.length > 128_000_000) throw new Error('Dimensione STEP annotato non valida.')
      const witness = await this.runtime.worker.ask<{face:number;selectionRevision:number;previewRevision:number;faceBrep:string}>(
        cylinder ? {action:'cylinderFaceWitness',session:cylinder.session,previewRevision:result.previewRevision}
          : { action: 'finalFaceWitness', previewRevision: result.previewRevision }, signal)
      this.assertFrozenAnnotated(ticket, frozen, signal)
      if (!witness || witness.face !== this.face || witness.previewRevision !== result.previewRevision ||
          !Number.isSafeInteger(witness.selectionRevision) || typeof witness.faceBrep !== 'string' ||
          !witness.faceBrep.trim() || witness.faceBrep.length > 16_000_000)
        throw new Error('Faccia finale non verificabile: le note restano nella bozza.')
      const key = 'final-face', notes: Array<{draftId:string;text:string;target:{kind:'copy-face';witnessKey:string;sourceUV:[number,number];resolvedAt:Point;orientedNormal:Point;resolvedStamp:PreviewStamp}}> = []
      for (const note of frozen.notes) {
        if (note.anchor.face !== witness.face || note.anchor.selectionRevision !== witness.selectionRevision ||
            !Number.isFinite(note.anchor.u) || !Number.isFinite(note.anchor.v) || !note.text.trim())
          throw new Error('Una nota non appartiene alla faccia finale.')
        const resolved = await this.runtime.worker.ask<{at:Point;normal:Point}>(
          cylinder ? {action:'cylinderNoteResolve',session:cylinder.session,anchor:note.anchor,previewRevision:result.previewRevision}
            : { action: 'noteResolve', anchor: note.anchor, previewRevision: result.previewRevision }, signal)
        this.assertFrozenAnnotated(ticket, frozen, signal)
        if (!finitePoint(resolved?.at) || !finitePoint(resolved?.normal) || Math.abs(Math.hypot(...resolved.normal) - 1) > 1e-6)
          throw new Error('Posizione o normale finale della nota non valida.')
        notes.push({ draftId: note.id, text: note.text, target: { kind:'copy-face', witnessKey:key,
          sourceUV:[note.anchor.u,note.anchor.v], resolvedAt:pointCopy(resolved.at), orientedNormal:pointCopy(resolved.normal), resolvedStamp:frozen.stamp } })
      }
      if (notes.length !== frozen.notes.length) throw new Error('Non tutte le note sono state preparate.')
      const stepHash = await this.digest(step)
      this.assertFrozenAnnotated(ticket, frozen, signal)
      const brepHash = await this.digest(new TextEncoder().encode(witness.faceBrep))
      this.assertFrozenAnnotated(ticket, frozen, signal)
      if (!/^[a-f0-9]{64}$/i.test(stepHash) || !/^[a-f0-9]{64}$/i.test(brepHash)) throw new Error('Hash della copia annotata non valido.')
      return { annotationVersion:1, kind:'annotated-cad-copy', operationId:frozen.operationId,
        source:frozen.source, stamp:frozen.stamp, notesRevision:frozen.notesRevision!, units:'mm', coordinateFrame:'part',
        name:'superficie-modificata.step', step, witnesses:[{ key, kind:'occt-face-brep', brep:witness.faceBrep,
          brepSha256:brepHash.toLowerCase(), finalStepSha256:stepHash.toLowerCase(), stamp:frozen.stamp, diagnosticFaceIndex:witness.face }],
        notes:notes as [typeof notes[number], ...typeof notes[number][]] }
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

    const cylinder=this.currentValidatedCylinder()
    if(cylinder) {
      this.assertLive()
      if(this.currentValidatedCylinder()!==cylinder || !cylinder.step.trim()) throw new Error('La bozza cilindrica è cambiata.')
      return {name:'superficie-modificata.step',step:cylinder.step}
    }
    const stamp = initial.stamp
    const net = this.requireNet()
    const draft = this.draft.getSnapshot()
    const tangency = draft.planeTangency ?? draft.curvedTangency
    const strip = this.strip
    const stripResult = strip?.frames[strip.at] ?? null
    const queue = this.runtime.previews.getSnapshot()
    if (draft.validNet !== net || draft.calculating || draft.previewStale ||
        (!strip && (!draft.preview?.valid || (tangency
          ? this.g1DraftIdentity?.requestId !== stamp.requestId
          : queue.current?.revision !== stamp.requestId || queue.validRevision !== stamp.requestId))) ||
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
          after.continuity !== continuity || after.freeBoundary !== freeBoundary || after.planeTangency !== draft.planeTangency ||
          after.curvedTangency !== draft.curvedTangency || this.strip !== strip ||
          (strip ? (strip.frames[strip.at] !== stripResult || !stripResult) :
            (tangency ? this.g1DraftIdentity?.requestId !== stamp.requestId :
              currentQueue.current?.revision !== stamp.requestId || currentQueue.validRevision !== stamp.requestId)) ||
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
  private currentValidatedCylinder() {
    const value=this.cylinderValidated,draft=this.draft.getSnapshot()
    return value && draft.net===value.net && draft.cylinderSession===value.session &&
      this.historyRevision===value.historyRevision && this.selectionEpoch===value.selectionEpoch ? value : null
  }
  private assertMutable(allowBusy = false): void {
    this.assertLive()
    if (this.frozen || this.mutating || (!allowBusy && this.busy)) throw new Error('La bozza è occupata o congelata.')
  }
  private supportsAnnotatedCopy(): boolean {
    const capabilities = this.context.capabilities as { apiVersion?: number; enabled?: boolean; annotationVersion?: number; commitKinds?: readonly string[] }
    return capabilities.apiVersion === 1 && capabilities.enabled === true && capabilities.annotationVersion === 1 &&
      Array.isArray(capabilities.commitKinds) && capabilities.commitKinds.includes('annotated-cad-copy')
  }
  private advanceNotesRevision(): void {
    if (!Number.isSafeInteger(this.notesRevision) || this.notesRevision >= Number.MAX_SAFE_INTEGER)
      throw new Error('Revisione delle note non valida.')
    this.notesRevision++
  }
  private assertFrozen(ticket: ApplyTicket, frozen: Frozen, signal: AbortSignal): void {
    abortIf(signal); this.assertLive(); abortIf(signal)
    if (this.frozen !== frozen || ticketKey(ticket) !== frozen.ticketKey || this.notes.length ||
        this.busy || this.gesture !== 'idle' || this.snapshot.validation.kind !== 'valid' ||
        (this.strip?.frames[this.strip.at] ?? null) !== frozen.stripResult || (!!this.strip !== !!frozen.stripResult) ||
        stampKey(this.snapshot.validation.stamp) !== stampKey(frozen.stamp))
      throw new Error('La bozza congelata non corrisponde al ticket.')
  }
  private assertFrozenAnnotated(ticket: AnnotatedTicketV1, frozen: Frozen, signal: AbortSignal): void {
    abortIf(signal); this.assertLive(); abortIf(signal)
    if (!ticket || ticket.annotationVersion !== 1 || ticket.mode !== 'annotated-cad-copy' || !ticket.source || !ticket.stamp ||
        this.frozen !== frozen || !frozen.notes || frozen.notes !== this.notes || this.notesRevision !== frozen.notesRevision ||
        ticket.notesRevision !== frozen.notesRevision || ticketKey(ticket) !== frozen.ticketKey || this.busy || this.placingNote ||
        this.gesture !== 'idle' || this.strip || this.stripPending || this.snapshot.validation.kind !== 'valid' ||
        stampKey(this.snapshot.validation.stamp) !== stampKey(frozen.stamp))
      throw new Error('La bozza annotata congelata non corrisponde al ticket.')
  }
  /** The CAD source must be an open face/shell, and the whole base must be present. */
  private initialSheetFaceCount(d: SurfaceDraftSnapshot): number | null {
    if (d.planeTangency || d.curvedTangency || d.cylinderSession !== null || !this.faces.length || !this.faces[this.face]?.openSheet ||
        this.faces.some(face => !face.openSheet) || !Array.isArray(d.preview?.faceMeshes) ||
        d.preview.faceMeshes.length !== this.faces.length) return null
    return this.faces.length
  }
  private directIdentity(): DirectIdentity | null {
    const d = this.draft.getSnapshot(), queue = this.runtime.previews.getSnapshot()
    const revision = d.preview?.previewRevision, faceCount = this.initialSheetFaceCount(d)
    if (this.disposed || !this.runtime.active || this.context.signal.aborted || this.mutating || this.frozen || this.busy ||
        this.strip || this.stripPending || this.gesture !== 'idle' || this.notes.length || this.placingNote ||
        faceCount === null || !d.net || d.validNet !== d.net ||
        d.calculating || d.previewStale || !d.preview?.valid ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 ||
        !queue.current || queue.validRevision !== queue.current.revision) return null
    try { this.assertLive() } catch { return null }
    return { revision, selectionEpoch:this.selectionEpoch, face:this.face, faceCount, net:d.net }
  }
  private matchesDirect(a: DirectIdentity | null, b: DirectIdentity | null): boolean {
    return !!a && !!b && a.revision === b.revision && a.selectionEpoch === b.selectionEpoch && a.face === b.face && a.faceCount === b.faceCount && a.net === b.net
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
          before.freeBoundary !== after.freeBoundary || before.planeTangency !== after.planeTangency || before.curvedTangency !== after.curvedTangency ||
          !sameArray(before.locks, after.locks)) this.historyRevision++
      this.mutating = false
      if (!this.disposed) { this.refresh(); this.resolveNotes() }
    }
  }
  private refresh(): void {
    const d: SurfaceDraftSnapshot = this.draft.getSnapshot()
    if(this.wholeBoundaryDrag && (this.wholeBoundaryDrag.face!==this.face || !d.freeBoundary || this.symmetry || this.notes.length || this.placingNote || this.surfaceTarget ||
      d.planeTangency || d.curvedTangency || d.cylinderSession!==null || this.strip))this.wholeBoundaryDrag=null
    if(this.surfaceTarget && (this.surfaceTarget.snapshot!==d || this.symmetry)) this.surfaceTarget=null
    const tangency = d.planeTangency ?? d.curvedTangency
    if (this.g1Basis && (this.g1Basis.selectionEpoch !== this.selectionEpoch || this.g1Basis.refinements !== d.refinements)) {
      this.g1Candidates = Object.freeze([]); this.g1Choice = null; this.g1Basis = null; this.g1SearchNotice = null
    }
    // The logical G1 draft token stays stable when export republishes the same
    // geometry with a new CAD note witness. A frozen Apply ticket uses this token.
    if (tangency && d.net) {
      if (this.g1DraftIdentity?.net !== d.net || this.g1DraftIdentity.constraint !== tangency)
        this.g1DraftIdentity = { net: d.net, constraint: tangency, requestId: ++this.g1ValidationSerial }
    } else this.g1DraftIdentity = null
    const current: DraftStamp = Object.freeze({ sessionId: this.context.sessionId, sourceEpoch: this.source.sourceEpoch,
      selectionEpoch: this.selectionEpoch, draftEpoch: this.draftEpoch })
    const queue = this.runtime.previews.getSnapshot()
    const strip = this.strip, stripResult = strip?.frames[strip.at] ?? null
    const cylinder=this.currentValidatedCylinder()
    const stamp: PreviewStamp = Object.freeze({ ...current, requestId: strip ? (stripResult?.requestId ?? 0) : (d.cylinderSession!==null ? (cylinder?.requestId ?? 0) : tangency ? (this.g1DraftIdentity?.requestId ?? 0) : (queue.current?.revision ?? 0)) })
    const geometryValidation = !d.net ? { kind: 'none' as const } :
      (d.calculating || this.busy || this.placingNote || this.surfaceTarget || this.gesture === 'strip') ? { kind: 'pending' as const, wanted: stamp } :
      strip?.error ? { kind: 'invalid' as const, stamp, message: strip.error } :
      strip ? (stripResult ? { kind: 'valid' as const, stamp } : { kind: 'pending' as const, wanted: stamp }) :
      d.cylinderSession!==null ? (cylinder ? {kind:'valid' as const,stamp} : {kind:'pending' as const,wanted:stamp}) :
      d.validNet === d.net && !d.previewStale && d.preview?.valid &&
        (tangency ? Number.isSafeInteger(d.preview.previewRevision) && d.preview.previewRevision! > 0 :
          !!queue.current && queue.validRevision === queue.current.revision)
        ? { kind: 'valid' as const, stamp } :
        d.error ? { kind: 'invalid' as const, stamp, message: d.error } : { kind: 'pending' as const, wanted: stamp }
    const annotatedCopyAvailable = this.supportsAnnotatedCopy()
    const checkNotes = annotatedCopyAvailable && this.notes.length > 0 && !this.frozen?.notes
    const noteMessage = checkNotes && this.notes.some(note => !note.text.trim()) ? 'Scrivi il testo di tutte le note prima di applicare.' : null
    const noteRevision=cylinder?.previewRevision ?? d.preview?.previewRevision
    const notesPending = checkNotes && this.notes.some(note => note.revision !== noteRevision)
    const noteResolutionError = noteRevision !== undefined && this.failedNoteRevision === noteRevision &&
      this.failedNoteSet === this.notes
    const validation = geometryValidation.kind !== 'valid' ? geometryValidation : noteMessage
      ? { kind: 'invalid' as const, stamp, message: noteMessage }
      : notesPending ? { kind: 'pending' as const, wanted: stamp } : geometryValidation
    const original = d.originalNet
    const dirty = !!this.notes.length || !!strip?.frames.some(Boolean) || d.canUndo || !!(d.net && d.net !== d.committedNet) ||
      !!(d.net && original && !d.canUndo && JSON.stringify(d.net.poles) !== JSON.stringify(original.poles))
    let cached = this.lockCache
    if (!cached || cached.net !== d.net || cached.locks !== d.locks || cached.trim !== d.trimLocks ||
        cached.continuity !== d.continuity || cached.free !== d.freeBoundary || cached.tangency !== tangency) {
      const locks = new Set([...d.locks, ...d.trimLocks, ...(tangency?.lockedPoles ?? [])])
      cached = { net: d.net, locks: d.locks, trim: d.trimLocks, continuity: d.continuity, free: d.freeBoundary,
        tangency,
        value: Object.freeze(d.net ? d.net.poles.flatMap((_,i) =>
          locks.has(i) || (d.cylinderSession !== null ? !(Math.floor(i/d.net!.nv) === 3 && i%d.net!.nv >= 2 && i%d.net!.nv <= d.net!.nv-3) : (!d.freeBoundary && boundaryLocked(d.net!,i,tangency ? 'G1' : d.continuity))) ? [i] : []) : []) }
      this.lockCache = cached
    }
    const locked = cached.value, face = this.faces[this.face]
    const preview = stripResult?.preview ?? d.preview ?? (!d.net ? this.sourcePreview : null)
    // Positioning a new note blocks Apply but does not invalidate existing
    // anchors verified against the still-current CAD preview.
    const validRevision = cylinder?.previewRevision ?? (d.net && d.validNet === d.net && !d.calculating && !d.previewStale
      ? preview?.previewRevision : undefined)
    if (!this.pinCache || this.pinCache.notes !== this.notes || this.pinCache.revision !== validRevision)
      this.pinCache = { notes: this.notes, revision: validRevision,
        value: Object.freeze(this.notes.filter(note => note.revision === validRevision).map(note => note.at)) }
    const notePins = this.pinCache.value
    const symmetryPartners = this.partners(d.committedNet)
    const lockedSet = new Set(locked)
    const symmetryBlocked = !!symmetryPartners && d.selected.some(i =>
      !lockedSet.has(i) && (symmetryPartners[i] < 0 || lockedSet.has(symmetryPartners[i])))
    const message = strip?.error || d.error || this.message || noteMessage || (notesPending ? 'Verifica della posizione delle note in corso…' : null)
    const canUndo = strip ? strip.at > 0 : d.canUndo, canRedo = strip ? strip.at + 1 < strip.frames.length : d.canRedo
    const stripView: WorkspaceStripViewState | null = strip ? Object.freeze({
      paths: stripResult?.paths ?? strip.initialPaths, selectedEdge:strip.selectedEdge, axis:strip.axis, delta:freezePoint(strip.delta),
      pending:this.stripPending || this.gesture === 'strip', canUndo, canRedo,
      addedArea:stripResult?.addedArea ?? null, totalArea:stripResult?.totalArea ?? null, hasResult:!!stripResult,
    }) : null
    const canBeginStrip = !tangency && !strip && !this.stripPending && !this.busy && !this.frozen && !this.notes.length && !this.placingNote &&
      this.gesture === 'idle' && this.initialSheetFaceCount(d) !== null &&
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
      draftNoteCount: this.notes.length, notesRevision:this.notesRevision, message })
    const adaptive = !!this.runtime.history.current?.preparation?.adaptiveSelection
    const canMoveWholeBoundary=!adaptive && !this.disposed && !this.busy && !this.frozen && !this.symmetry && !this.placingNote &&
      !this.surfaceTarget && !this.notes.length && !strip && !this.stripPending && this.gesture==='idle' && this.faces.length===1 &&
      !!face?.freeBoundary && d.freeBoundary && !tangency && d.cylinderSession===null && !!d.net &&
      d.net===d.committedNet && d.validNet===d.net && !d.calculating && !d.previewStale
    const surfaceTargetBatch=this.surfaceTarget?.points?Object.freeze(this.surfaceTarget.points.map(p=>Object.freeze({at:freezePoint(p.at),target:freezePoint(p.reference.point),label:p.reference.label}))):null
    const canTargetPoint=!adaptive && !this.disposed && !this.busy && !this.frozen && !this.placingNote && !strip && !this.stripPending &&
      this.gesture==='idle' && !this.symmetry && !tangency && d.cylinderSession===null && !!d.net && d.net===d.committedNet &&
      d.validNet===d.net && !d.calculating && !d.previewStale && d.selected.some(i=>!locked.includes(i) && !d.hiddenPoles.includes(i))
    const canLoadG1 = !adaptive && !this.disposed && !this.busy && !this.frozen && !this.placingNote && !strip && !this.stripPending &&
      this.gesture === 'idle' && !!d.net && d.net === d.committedNet && d.validNet === d.net &&
      !d.calculating && !d.previewStale && !d.freeBoundary && !tangency && d.cylinderSession === null
    this.panel = Object.freeze({ faces: this.faces, face: this.face, net: d.net, selected: d.selected,
      locked, manualLocks: d.locks, continuity: d.continuity, freeBoundary: d.freeBoundary,
      g1Candidates: this.g1Candidates, g1Choice: this.g1Choice, g1SearchNotice: this.g1SearchNotice, canLoadG1,
      canApplyG1: canLoadG1 && !!this.g1Choice && this.g1Candidates.some(candidate => candidate.id === this.g1Choice),
      planeTangencyActive: !!d.planeTangency,
      curvedTangencyActive: !!d.curvedTangency,
      canFreeBoundary: !adaptive && !!face?.freeBoundary && !tangency, canMoveWholeBoundary, wholeBoundaryDrag:this.wholeBoundaryDrag?.side??null, canRefineNet: !!d.net && !tangency && d.cylinderSession===null && !d.calculating && d.validNet===d.net && d.net===d.committedNet &&
        !d.locks.length && !this.busy && !this.frozen && !this.placingNote && !strip && !this.stripPending && this.gesture==='idle',
      canUndo, canRedo, calculating: d.calculating || this.stripPending,
      busy: this.busy || !!this.frozen, message, snap: this.snap, snapDistance: this.snapDistance,
      surfaceTarget:this.surfaceTarget?.kind ?? null,surfaceTargetBatch,canTargetPoint,
      dragMode: this.dragMode, axis: this.axis, dragStrength: this.dragStrength, selectionMode: this.selectionMode, navigationOnly: this.navigationOnly,
      showNet: this.showNet, stripes: this.stripes, symmetry: this.symmetry, mirrorAxis: this.mirrorAxis,
      mirrorOffset: this.mirrorOffset, symmetryPartners, symmetryBlocked, transparency: this.transparency,
      placingNote: this.placingNote, canPlaceNote:validation.kind==='valid' && this.gesture==='idle' && !this.busy && !this.frozen, notes: this.notes, annotatedCopyAvailable, noteResolutionError, gesture: this.gesture, canBeginStrip, directStripAxis:this.directStripAxis,
      directStripError,
      canExportStep, strip:stripView })
    this.viewState = Object.freeze({ reticleStamp: current, net: strip ? null : d.net, preview, provisionalPreview:d.cylinderPreview?.faceMeshes ? {kind:'provisional' as const,faceMeshes:d.cylinderPreview.faceMeshes} : null, face: stripResult ? -1 : this.face, selected: strip ? [] : d.selected, locked,
      hiddenPoles: d.hiddenPoles, selectionMode: this.selectionMode, navigationOnly: this.navigationOnly, dragMode: this.dragMode,
      wholeBoundaryDrag:this.wholeBoundaryDrag ? {side:this.wholeBoundaryDrag.side,canStart:canMoveWholeBoundary}:null,
      axis: this.axis, dragStrength: this.dragStrength, showNet: this.showNet, snap: this.snap,
      snapDistance: this.snapDistance, busy: this.busy || !!this.frozen, placingNote: this.placingNote,
      surfaceTarget:this.surfaceTarget ? {kind:this.surfaceTarget.kind,sourceBodyId:this.source.bodyId,...(surfaceTargetBatch?{pairs:surfaceTargetBatch}:{})}:null,
      stripes: this.stripes, notePins, symmetry: this.symmetry, mirrorAxis: this.mirrorAxis,
      mirrorOffset: this.mirrorOffset, symmetryPartners, symmetryBlocked, transparency: this.transparency, strip:stripView, directStrip })
    for (const listener of this.listeners) listener()
  }
  private resolveNotes(): void {
    const d = this.draft.getSnapshot(), cylinder=this.currentValidatedCylinder(), revision = cylinder?.previewRevision ?? d.preview?.previewRevision
    if (this.disposed || this.frozen || this.resolvingNotes || !d.net || (!cylinder && d.validNet !== d.net) ||
        d.calculating || revision === undefined || (revision === this.failedNoteRevision && this.notes === this.failedNoteSet) ||
        !this.notes.some(note => note.revision !== revision)) return
    const notes = this.notes, net = d.net, epoch = this.selectionEpoch
    this.resolvingNotes = true
    void Promise.all(notes.map(async note => note.revision === revision ? note : ({
      ...note, ...await this.runtime.worker.ask<{at: Point; normal: Point}>(
        cylinder ? {action:'cylinderNoteResolve',session:cylinder.session,anchor:note.anchor,previewRevision:revision}
          : { action: 'noteResolve', anchor: note.anchor, previewRevision: revision }, this.context.signal), revision,
    }))).then(updated => {
      this.assertLive()
      const current = this.draft.getSnapshot()
      if (this.notes !== notes || epoch !== this.selectionEpoch || current.net !== net ||
          (cylinder ? this.currentValidatedCylinder()!==cylinder : current.validNet !== net || current.preview?.previewRevision !== revision) || this.frozen) return
      if (updated.some(note => !finitePoint(note.at) || !finitePoint(note.normal))) throw new Error('Posizione nota non valida.')
      this.advanceNotesRevision()
      this.failedNoteRevision = null; this.failedNoteSet = null
      this.notes = Object.freeze(updated.map(note => Object.freeze({ ...note, at: freezePoint(note.at), normal: freezePoint(note.normal) })))
      this.draftEpoch++; this.refresh()
    }).catch(error => {
      const current = this.draft.getSnapshot()
      if (!this.disposed && !this.frozen && this.notes === notes && this.selectionEpoch === epoch &&
          current.net === net && !current.calculating && !current.previewStale &&
          (cylinder ? this.currentValidatedCylinder()===cylinder : current.validNet === net && current.preview?.previewRevision === revision)) {
        this.failedNoteRevision = revision; this.failedNoteSet = notes
        this.message = String((error as Error)?.message ?? error); this.refresh()
      }
    }).finally(() => {
      this.resolvingNotes = false
      if (!this.disposed) this.resolveNotes()
    })
  }
  private cleanup(): void {
    if (this.disposed) return
    this.disposed = true; this.disposedSignal.abort(); this.exportGeneration++; this.frozen = null; this.stripGeneration++; this.stripAbort?.abort()
    this.restoredHistory = null
    this.clearDirectCache(); this.directGestureOrigin = false
    this.strip = null; this.stripPending = false; this.stripAbort = null
    this.context.signal.removeEventListener('abort', this.onAbort)
    let failure: unknown
    try { this.layer?.dispose() } catch (error) { failure = error }
    this.layer = null
    this.unsubscribeDraft()
    try { this.draft.dispose() } catch (error) { failure ??= error }
    try { this.runtime.dispose() } catch (error) { failure ??= error }
    this.notes = Object.freeze([]); this.failedNoteSet = null; this.faces = Object.freeze([]); this.sourcePreview = null; this.symmetryCache = null
    this.g1Candidates = Object.freeze([]); this.g1Choice = null; this.g1Basis = null; this.g1SearchNotice = null; this.g1DraftIdentity = null
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

// SPDX-License-Identifier: AGPL-3.0-only
import { assertNet, boundaryLocked, type Net, type Point } from './brep'
import type { Preview, DraftAnchor, G1PlaneResult, G1PublishedPlaneResult, G1CurvedResult, G1PublishedCurvedResult, RecipeRestoreResult, CurvedRecipeRestoreResult } from './editorKernel'
import { readRecipe, readCurvedRecipe, sha256, decodeRecipePoint, type SurfaceEditRecipe, type SurfaceEditRecipeV6 } from './recipe'
import type { EditFrame, SurfacePreparation, SurfacePlaneTangency, SurfaceCurvedTangency } from './surfaceHistory'
import type { PreviewDraft, SurfaceRuntime } from './surfaceRuntime'
import { PreviewQueue } from './previewQueue'
import { assertSmoothCylinderMove, canonicalizeCylinderGesture } from './periodic'
import type { Mesh } from 'occt-wasm'
import { refineClampedNet, type KnotInsertion } from './refineClampedNet'
import type { G1SupportCandidate } from './g1SupportTopology'
import type { CompatibleCurvedSupportCandidate } from './compatibleCurvedSupportTopology'
import type { AdaptiveSelection } from './editor.worker'
import { readAdaptiveLockedRecipe, type AdaptiveLockedRecipe } from './adaptiveLockedRecipe'
import { validatePlaneTangencyResult, validatePlaneTangencyConstraint, type PlaneTangencyRequest, type NaturalEdge } from './planeTangency'
import { targetSurfacePoint, type SurfacePointTarget } from './surfacePointTarget'

export interface CylinderProvisionalPreview { kind: 'provisional'; mesh: Mesh; faceMeshes?: Mesh[] }

export interface SurfaceDraftSnapshot {
  /** Worker-owned experimental cylinder; never qualifies the normal Apply path. */
  readonly cylinderSession: number | null
  readonly cylinderPreview: CylinderProvisionalPreview | null
  /** Source part frame, in millimetres. Treat the returned net and preview as read-only. */
  readonly net: Net | null
  readonly committedNet: Net | null
  readonly originalNet: Net | null
  readonly selected: readonly number[]
  readonly locks: readonly number[]
  readonly trimLocks: readonly number[]
  readonly hiddenPoles: readonly number[]
  readonly refinements: readonly KnotInsertion[]
  readonly planeTangency: SurfacePlaneTangency | null
  readonly curvedTangency: SurfaceCurvedTangency | null
  readonly continuity: 'G0' | 'G1'
  readonly freeBoundary: boolean
  /** The latest visible preview can be older than net. It is borrowed, not copied. */
  readonly preview: Preview | null
  readonly previewStale: boolean
  /** Non-null only when the current geometry passed the latest CAD evaluation. */
  readonly validNet: Net | null
  readonly calculating: boolean
  readonly error: string
  readonly canUndo: boolean
  readonly canRedo: boolean
}

const owners = new WeakMap<SurfaceRuntime, SurfaceDraft>()
const EMPTY: readonly number[] = Object.freeze([])
const NO_REFINEMENTS: readonly KnotInsertion[] = Object.freeze([])

/** Freeze once at ownership boundaries so a stable snapshot cannot be mutated. */
function freezeNet(net: Net): Net {
  for (const pole of net.poles) Object.freeze(pole)
  Object.freeze(net.poles)
  Object.freeze(net.weights); Object.freeze(net.rational)
  if (net.periodic) Object.freeze(net.periodic)
  Object.freeze(net.ku); Object.freeze(net.kv); Object.freeze(net.mu); Object.freeze(net.mv)
  return Object.freeze(net)
}
function frozenIds(ids: readonly number[], count: number): readonly number[] {
  if (Array.from(ids).some(i => !Number.isInteger(i) || i < 0 || i >= count))
    throw new Error('Indice del punto non valido.')
  return Object.freeze([...new Set(ids)])
}
function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}
/** Compare serialized coefficient state without erasing negative zero. */
function sameExact(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false
  const keys = Object.keys(a), other = Object.keys(b)
  return keys.length === other.length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) &&
    sameExact((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

/**
 * The owner keeps this controller for the lifetime of one SurfaceRuntime.
 * Panel remounts must only unsubscribe; they must not recreate or dispose it.
 * This class owns runtime.history and runtime.previews exclusively while alive.
 * It never opens a document, publishes project changes, or owns the runtime.
 */
export class SurfaceDraft {
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private snapshot: SurfaceDraftSnapshot = Object.freeze({
    cylinderSession: null, cylinderPreview: null, net: null, committedNet: null, originalNet: null, selected: EMPTY, locks: EMPTY, trimLocks: EMPTY, continuity: 'G1',
    hiddenPoles: EMPTY, refinements: NO_REFINEMENTS, planeTangency: null, curvedTangency: null, freeBoundary: false, preview: null, previewStale: false, validNet: null,
    calculating: false, error: '', canUndo: false, canRedo: false,
  })
  private base: Net | null = null
  /** Queue identity may be an equivalent frozen draft before history cloned it. */
  private queueNet: Net | null = null
  private epoch = 0
  private exported: { epoch: number; queueRevision: number; value: Preview } | null = null
  private disposed = false
  private refining = false
  private historyTransition = false
  private recipeBusy = false
  private restoreUnverified = false
  private exportRequests = 0
  private proposingPlaneTangency = false
  private publishingPlaneTangency = false
  private planePublished: { epoch: number; net: Net; constraint: SurfacePlaneTangency; value: Pick<G1PublishedPlaneResult, 'preview'> } | null = null
  private readonly planePreviews = new PreviewQueue<{ net: Net; constraint: SurfacePlaneTangency; epoch: number; selection: { face: number; refinements: KnotInsertion[] } }, G1PublishedPlaneResult>({
    evaluate: async draft => {
      const result = await this.runtime.worker.ask<G1PublishedPlaneResult>({
        action: 'evaluateG1PlaneTangency', net: draft.net, constraintId: draft.constraint.constraintId,
        lockedPoles: draft.constraint.lockedPoles, selection: draft.selection,
      })
      this.checkPublishedPlaneResult(result, draft.constraint, draft.net)
      return result
    },
  })
  private readonly unsubscribePlane: () => void
  private proposingCurvedTangency = false
  private publishingCurvedTangency = false
  private curvedPublished: { epoch: number; net: Net; constraint: SurfaceCurvedTangency; value: Pick<G1PublishedCurvedResult, 'preview'> } | null = null
  private readonly curvedPreviews = new PreviewQueue<{ net: Net; constraint: SurfaceCurvedTangency; epoch: number; selection: { face: number; refinements: KnotInsertion[] } }, G1PublishedCurvedResult>({
    evaluate: async draft => {
      const result = await this.runtime.worker.ask<G1PublishedCurvedResult>({ action: 'evaluateG1CurvedTangency', net: draft.net,
        constraintId: draft.constraint.constraintId, lockedPoles: draft.constraint.lockedPoles, selection: draft.selection })
      this.checkPublishedCurvedResult(result, draft.constraint, draft.net)
      return result
    },
  })
  private readonly unsubscribeCurved: () => void
  private readonly cylinderPreviews = new PreviewQueue<PreviewDraft & { session: number }, CylinderProvisionalPreview>({
    evaluate: async draft => {
      const value = await this.runtime.worker.ask<CylinderProvisionalPreview>({
        action: 'previewCylinder', session: draft.session, net: draft.net,
      })
      if (value.kind !== 'provisional' || !value.mesh) throw new Error('Anteprima cilindrica non disponibile.')
      return value
    },
  })
  private readonly unsubscribeCylinder: () => void

  constructor(private readonly runtime: SurfaceRuntime) {
    if (!runtime.active || runtime.previews.getSnapshot().disposed)
      throw new Error('Editor chiuso.')
    if (owners.has(runtime)) throw new Error('La bozza di questa sessione è già controllata.')
    if (runtime.history.current || runtime.previews.getSnapshot().current)
      throw new Error('La sessione contiene già una bozza non acquisita.')
    owners.set(runtime, this)
    this.unsubscribe = runtime.previews.subscribe(this.syncPreview)
    this.unsubscribePlane = this.planePreviews.subscribe(this.syncPreview)
    this.unsubscribeCurved = this.curvedPreviews.subscribe(this.syncPreview)
    this.unsubscribeCylinder = this.cylinderPreviews.subscribe(this.syncPreview)
  }

  getSnapshot = (): SurfaceDraftSnapshot => this.snapshot
  get adaptiveHistoryPending(): boolean { return this.historyTransition }

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Install a worker-selected CAD net. No project or worker selection is performed. */
  install(net: Net, options: { continuity?: 'G0' | 'G1'; trimLocks?: readonly number[]; hiddenPoles?: readonly number[];
    cylinderSession?: number; face?: number; refinements?: readonly KnotInsertion[]; originalNet?: Net; experimentalAdaptiveLocks?: boolean; adaptiveSelection?: AdaptiveSelection } = {}): void {
    this.ensureActive(true)
    const continuity = options.continuity ?? this.snapshot.continuity
    if (continuity !== 'G0' && continuity !== 'G1') throw new Error('Continuità non valida.')
    const cylinderSession = options.cylinderSession ?? null
    if (cylinderSession !== null) {
      if (!Number.isInteger(cylinderSession) || cylinderSession < 0 || continuity !== 'G1')
        throw new Error('Sessione cilindrica non valida.')
      assertSmoothCylinderMove(net, net)
    } else assertNet(net, net, continuity, true)
    const trimLocks = frozenIds(options.trimLocks ?? [], net.poles.length)
    const hiddenPoles = frozenIds(options.hiddenPoles ?? [], net.poles.length)
    if (options.face !== undefined && (!Number.isSafeInteger(options.face) || options.face < 0 || cylinderSession !== null))
      throw new Error('Preparazione della faccia non valida.')
    if (options.refinements?.length && options.face === undefined) throw new Error('Faccia del raffinamento non disponibile.')
    if (options.experimentalAdaptiveLocks !== undefined && typeof options.experimentalAdaptiveLocks !== 'boolean') throw new Error('Modalità blocchi adattivi non valida.')
    if (options.experimentalAdaptiveLocks && (options.face === undefined || !options.refinements?.length || cylinderSession !== null))
      throw new Error('I blocchi adattivi richiedono una faccia raffinata.')
    const adaptive = options.adaptiveSelection
    if (Boolean(options.experimentalAdaptiveLocks) !== Boolean(adaptive) || (adaptive &&
      (adaptive.face !== options.face || adaptive.trimPolicy !== 'circular-fine-v1' ||
       !Number.isSafeInteger(adaptive.generation) || adaptive.generation < 1 ||
       JSON.stringify(adaptive.refinements) !== JSON.stringify(options.refinements) ||
       !sameExact(adaptive.trimLocks, trimLocks) || !sameExact(adaptive.hiddenPoles, hiddenPoles))))
      throw new Error('Selezione adattiva del worker non valida.')
    const base = freezeNet(structuredClone(options.originalNet ?? net))
    if (cylinderSession !== null) assertSmoothCylinderMove(base, net)
    else assertNet(base, net, continuity, true)
    const preparation: SurfacePreparation | undefined = options.face === undefined ? undefined : {
      face: options.face, refinements: structuredClone(options.refinements ?? []) as KnotInsertion[],
      originalNet: base, trimLocks: [...trimLocks], hiddenPoles: [...hiddenPoles],
      ...(adaptive ? { adaptiveSelection: structuredClone(adaptive) } : {}),
    }
    this.invalidate()
    this.restoreUnverified = false
    this.runtime.history.reset()
    this.base = base
    this.queueNet = null
    const frame = this.runtime.history.commit({ net, locks: [], continuity, freeBoundary: false, preparation,
      ...(options.experimentalAdaptiveLocks ? { lockSnapshots: [] } : {}) })
    freezeNet(frame.net)
    this.freezePreparation(frame.preparation)
    this.base = frame.preparation?.originalNet ?? base
    this.update({ cylinderSession, cylinderPreview: null, net: frame.net, committedNet: frame.net, originalNet: this.base, selected: EMPTY, locks: EMPTY, trimLocks,
      hiddenPoles, refinements: frame.preparation?.refinements ?? NO_REFINEMENTS, planeTangency: null, curvedTangency: null,
      continuity, freeBoundary: false, preview: null, previewStale: false,
      validNet: null, calculating: false, error: '', canUndo: false, canRedo: false })
    this.schedule(frame.net)
  }

  /** Install only the net returned by prepareCylinder in this runtime's worker. */
  installCylinder(net: Net, session: number): void {
    this.install(net, { continuity: 'G1', cylinderSession: session })
  }

  /** Experimental v8 save; it does not publish a project or replace its source. */
  async createAdaptiveLockedRecipe(bodyId: string): Promise<AdaptiveLockedRecipe> {
    this.ensureActive()
    const before = this.snapshot, frame = this.runtime.history.current, preparation = frame?.preparation
    const selection = preparation?.adaptiveSelection, epoch = this.epoch
    if (!selection || !preparation || frame?.lockSnapshots === undefined || !before.net ||
        before.net !== before.committedNet || before.validNet !== before.net || before.calculating ||
        before.freeBoundary || before.planeTangency || before.curvedTangency || this.exportRequests ||
        this.proposingPlaneTangency || this.proposingCurvedTangency)
      throw new Error('Termina le operazioni e attendi la verifica CAD della bozza adattiva.')
    const locks = structuredClone(frame.lockSnapshots)
    this.recipeBusy = true
    try {
      const recipe = readAdaptiveLockedRecipe(await this.runtime.worker.ask({ action: 'createAdaptiveLockedRecipe',
        bodyId, net: before.net, continuity: before.continuity, locks, selection }))
      if (this.disposed || !this.runtime.active || this.epoch !== epoch || this.snapshot.net !== before.net ||
          this.runtime.history.current !== frame || recipe.source.bodyId !== bodyId ||
          recipe.faceIndex !== preparation.face || recipe.continuity !== before.continuity ||
          !sameExact(recipe.refinements, preparation.refinements) || !sameExact(recipe.lockedPoles, before.locks) ||
          !sameExact(recipe.lockedValues, locks) ||
          await sha256(JSON.stringify(preparation.originalNet)) !== recipe.baseNetSha256 ||
          !sameExact(this.netFromRecipe(preparation.originalNet, recipe.edits, false), before.net))
        throw new Error('Ricetta adattiva diversa dalla bozza richiesta.')
      if (this.disposed || !this.runtime.active || this.epoch !== epoch || this.runtime.history.current !== frame)
        throw new Error('La bozza è cambiata durante il salvataggio.')
      return recipe
    } finally {
      try {
        if (!this.disposed && this.runtime.active && this.epoch === epoch && this.runtime.history.current === frame) {
          this.invalidate()
          this.update({ preview: null, validNet: null, previewStale: false, calculating: true })
          this.schedule(before.net!)
        }
      } finally { this.recipeBusy = false }
    }
  }

  /** Serialize the actual committed draft; a plane constraint always uses v5. */
  async createRecipe(bodyId: string): Promise<SurfaceEditRecipe> {
    this.ensureActive()
    if (this.runtime.history.current?.preparation?.adaptiveSelection) throw new Error('Usa il salvataggio adattivo dedicato.')
    const before = this.snapshot, preparation = this.runtime.history.current?.preparation
    if (before.curvedTangency) throw new Error('La ricetta del vincolo G1 curvo non è ancora supportata.')
    if (!preparation || !before.net || before.cylinderSession !== null || before.net !== before.committedNet ||
        before.validNet !== before.net || before.calculating || this.proposingPlaneTangency || this.proposingCurvedTangency || this.exportRequests)
      throw new Error('Termina le operazioni e attendi la verifica CAD prima di salvare la ricetta.')
    this.recipeBusy = true
    try {
      const recipe = readRecipe(await this.runtime.worker.ask<SurfaceEditRecipe>({ action: 'createRecipe', bodyId,
        net: before.net, continuity: before.continuity, lockedPoles: [...before.locks], freeBoundary: before.freeBoundary,
        ...(before.planeTangency ? { constraintId: before.planeTangency.constraintId } : {}),
        selection: { face: preparation.face, refinements: preparation.refinements } }))
      if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
      if (recipe.source.bodyId !== bodyId || recipe.faceIndex !== preparation.face || recipe.continuity !== before.continuity ||
          !sameExact(recipe.lockedPoles, [...before.locks]) || (recipe.version === 5) !== !!before.planeTangency ||
          !sameExact(recipe.version === 4 || recipe.version === 5 ? recipe.refinements : [], preparation.refinements) ||
          (recipe.version === 3 || (recipe.version === 4 && recipe.boundaryMode === 'free-natural')) !== before.freeBoundary ||
          await sha256(JSON.stringify(preparation.originalNet)) !== recipe.baseNetSha256 ||
          !sameExact(this.netFromRecipe(preparation.originalNet, recipe.edits, recipe.version === 5), before.net))
        throw new Error('Ricetta CAD diversa dalla bozza richiesta.')
      if (recipe.version === 5 && before.planeTangency) {
        const c = recipe.planeTangency, expected = before.planeTangency
        if (c.supportFaceIndex !== expected.choice.supportFaceIndex || c.edgeIndex !== expected.choice.edgeIndex || c.side !== expected.choice.side ||
            c.distanceTolerance !== expected.distanceTolerance || !sameExact(c.initialLockedPoles, expected.lockedPoles) ||
            !sameExact(this.netFromRecipe(preparation.originalNet, c.proposalBaseEdits, true), expected.baseNet) ||
            !sameExact(this.netFromRecipe(preparation.originalNet, c.acceptedReferenceEdits, true), expected.referenceNet))
          throw new Error('Ricetta del vincolo G1 diversa dalla bozza richiesta.')
      }
      if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
      return recipe
    } finally {
      // Legacy createRecipe evaluates in the live editor. Refresh its witness
      // even after refusal; the G1 serializer itself is strictly read-only.
      try {
        if (!before.planeTangency && !this.disposed && this.runtime.active) {
          this.invalidate()
          this.update({ preview: null, validNet: null, previewStale: false, calculating: true })
          this.schedule(before.net!)
        }
      } finally { this.recipeBusy = false }
    }
  }

  /** Explicit v6 serialization, leaving the current preview/note witness intact. */
  async createCurvedRecipe(bodyId: string): Promise<SurfaceEditRecipeV6> {
    this.ensureActive()
    const before = this.snapshot, preparation = this.runtime.history.current?.preparation, constraint = before.curvedTangency
    if (!constraint || before.planeTangency || !preparation || preparation.refinements.length || !before.net || before.freeBoundary ||
        before.cylinderSession !== null || before.net !== before.committedNet || before.validNet !== before.net || before.calculating ||
        this.proposingPlaneTangency || this.proposingCurvedTangency || this.exportRequests)
      throw new Error('Attendi una bozza G1 B-spline nativa verificata prima di salvare la ricetta.')
    this.recipeBusy = true
    try {
      const recipe = readCurvedRecipe(await this.runtime.worker.ask<SurfaceEditRecipeV6>({ action: 'createCurvedRecipe', bodyId,
        net: before.net, continuity: before.continuity, lockedPoles: [...before.locks], constraintId: constraint.constraintId,
        selection: { face: preparation.face, refinements: preparation.refinements } }))
      if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
      if (recipe.source.bodyId !== bodyId || recipe.source.faceCount !== constraint.faceCount ||
          constraint.choice.stamp.sourceId !== 'brep-sha256:' + recipe.source.brepSha256 || recipe.faceIndex !== preparation.face ||
          recipe.continuity !== before.continuity || !sameExact(recipe.lockedPoles, [...before.locks]) ||
          !sameExact(recipe.refinements, preparation.refinements) || await sha256(JSON.stringify(preparation.originalNet)) !== recipe.baseNetSha256 ||
          !sameExact(this.netFromRecipe(preparation.originalNet, recipe.edits, true), before.net))
        throw new Error('Ricetta G1 B-spline diversa dalla bozza richiesta.')
      this.checkCurvedRecipeConstraint(constraint, recipe, preparation.originalNet)
      if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
      return recipe
    } finally { this.recipeBusy = false }
  }

  /** Replace this draft only after an isolated kernel restore and local checks. */
  async restoreRecipe(step: string, value: unknown, bodyId: string): Promise<RecipeRestoreResult> {
    return this.restoreRecipeCurrent(step, value, bodyId, false)
  }
  /** Opt-in adoption of v6; the legacy restoreRecipe still rejects this format. */
  async restoreCurvedRecipe(step: string, value: unknown, bodyId: string): Promise<CurvedRecipeRestoreResult> {
    return this.restoreRecipeCurrent(step, value, bodyId, true) as Promise<CurvedRecipeRestoreResult>
  }
  /** Experimental v8 restore; a rejected post-dispatch reply invalidates the old witness. */
  async restoreAdaptiveLockedRecipe(step: string, value: unknown, bodyId: string): Promise<RecipeRestoreResult> {
    this.ensureActive(true)
    const recipe = readAdaptiveLockedRecipe(value), before = this.snapshot
    if (recipe.source.bodyId !== bodyId) throw new Error('Corpo della ricetta non corrispondente.')
    if (before.calculating || before.net !== before.committedNet || this.proposingPlaneTangency || this.proposingCurvedTangency || this.exportRequests)
      throw new Error('Termina le operazioni prima di ripristinare la ricetta CAD.')
    const { trimPolicy: _policy, lockedValues: _values, ...common } = recipe
    const legacy = readRecipe({ ...common, version: 4 })
    this.recipeBusy = true
    this.update({ validNet: null, calculating: true, error: '' })
    try {
      const result = structuredClone(await this.runtime.worker.ask<RecipeRestoreResult & { selection: AdaptiveSelection }>({
        action: 'restoreAdaptiveLockedRecipe', step, recipe, bodyId }))
      if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
      await this.checkRestoredRecipe(result, legacy, bodyId)
      const p = result.preparation, selection = result.selection
      if (!selection || selection.face !== p.face || selection.trimPolicy !== recipe.trimPolicy ||
          !Number.isSafeInteger(selection.generation) || selection.generation < 1 ||
          !sameExact(selection.refinements, p.refinements) || !sameExact(selection.trimLocks, p.trimLocks) ||
          !sameExact(selection.hiddenPoles, p.hiddenPoles) || !sameExact(result.lockSnapshots, recipe.lockedValues))
        throw new Error('Protezione adattiva ripristinata non verificabile.')
      // Confirm that the returned identity is the one actually active in the worker.
      const confirmed = await this.runtime.worker.ask<Preview>({ action: 'evaluateAdaptiveExperimental',
        net: result.net, continuity: result.continuity, selection })
      if (this.disposed || !this.runtime.active || confirmed.valid !== true) throw new Error('Anteprima adattiva ripristinata non valida.')
      const callerResult = structuredClone(result)
      this.invalidate()
      this.runtime.history.reset()
      const frame = this.runtime.history.commit({ net: result.net, locks: result.lockedPoles,
        lockSnapshots: result.lockSnapshots, continuity: result.continuity, freeBoundary: false,
        preparation: { ...p, adaptiveSelection: selection } })
      freezeNet(frame.net); this.freezePreparation(frame.preparation)
      this.base = frame.preparation!.originalNet; this.queueNet = frame.net; this.restoreUnverified = false
      this.update({ cylinderSession: null, cylinderPreview: null, net: frame.net, committedNet: frame.net, originalNet: this.base,
        selected: EMPTY, locks: Object.freeze([...frame.locks]), trimLocks: frame.preparation!.trimLocks,
        hiddenPoles: frame.preparation!.hiddenPoles, refinements: frame.preparation!.refinements,
        planeTangency: null, curvedTangency: null, continuity: frame.continuity, freeBoundary: false,
        preview: null, previewStale: false, validNet: null, calculating: true, error: '', canUndo: false, canRedo: false })
      this.schedule(frame.net)
      return callerResult
    } catch (error) {
      if (!this.disposed && this.runtime.active) {
        this.restoreUnverified = true
        this.invalidate()
        this.update({ preview: null, validNet: null, previewStale: false, calculating: false,
          error: 'Ripristino adattivo non verificabile: seleziona di nuovo la faccia o ripristina una ricetta valida.' })
      }
      throw error
    } finally { this.recipeBusy = false }
  }
  private async restoreRecipeCurrent(step: string, value: unknown, bodyId: string, curved: boolean): Promise<RecipeRestoreResult> {
    this.ensureActive(true)
    const recipe = curved ? readCurvedRecipe(value) : readRecipe(value), before = this.snapshot
    if (before.calculating || before.net !== before.committedNet || this.proposingPlaneTangency || this.proposingCurvedTangency || this.exportRequests)
      throw new Error('Termina le operazioni prima di ripristinare la ricetta CAD.')
    this.recipeBusy = true
    this.update({ validNet: null, calculating: true, error: '' })
    let replied = false
    try {
      const reply = await this.runtime.worker.ask<RecipeRestoreResult>({ action: curved ? 'restoreCurvedRecipe' : 'restoreRecipe', step, recipe, bodyId })
      replied = true
      const result = structuredClone(reply)
      if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
      await this.checkRestoredRecipe(result, recipe, bodyId)
      if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
      if (recipe.version === 6) {
        const constraint = result.curvedTangency!, previous = before.curvedTangency ?? before.planeTangency
        if (previous && (constraint.constraintId <= previous.constraintId ||
            constraint.choice.stamp.sourceRevision <= previous.choice.stamp.sourceRevision ||
            constraint.choice.stamp.selectionRevision <= previous.choice.stamp.selectionRevision))
          throw new Error('Identità del vincolo G1 B-spline non rinnovata.')
        // The kernel's v6 result carries the accepted constraint but no proof
        // object. Confirm the new token through its actual persistent evaluator
        // before adopting any preview, geometry or history in this controller.
        const confirmed = structuredClone(await this.runtime.worker.ask<G1PublishedCurvedResult>({ action: 'evaluateG1CurvedTangency',
          net: result.net, constraintId: constraint.constraintId, lockedPoles: result.lockedPoles,
          selection: { face: result.preparation.face, refinements: result.preparation.refinements } }))
        if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
        this.checkPublishedCurvedResult(confirmed, constraint, result.net)
        if (confirmed.preview.previewRevision !== result.preview.previewRevision + 1)
          throw new Error('Witness del ripristino G1 B-spline non rinnovato.')
        result.preview = structuredClone(confirmed.preview)
      }
      const callerResult = structuredClone(result)
      this.invalidate()
      this.runtime.history.reset()
      const frame = this.runtime.history.commit({ net: result.net, locks: result.lockedPoles, continuity: result.continuity,
        freeBoundary: result.freeBoundary, preparation: result.preparation, planeTangency: result.planeTangency, curvedTangency: result.curvedTangency })
      freezeNet(frame.net); this.freezePreparation(frame.preparation); this.freezePlaneTangency(frame.planeTangency); this.freezeCurvedTangency(frame.curvedTangency)
      this.base = frame.preparation!.originalNet; this.queueNet = frame.net; this.restoreUnverified = false
      if (frame.planeTangency) this.planePublished = { epoch: this.epoch, net: frame.net, constraint: frame.planeTangency,
        value: { preview: result.preview } }
      if (frame.curvedTangency) this.curvedPublished = { epoch: this.epoch, net: frame.net, constraint: frame.curvedTangency,
        value: { preview: result.preview } }
      const constrained = !!(frame.planeTangency || frame.curvedTangency)
      this.update({ cylinderSession: null, cylinderPreview: null, net: frame.net, committedNet: frame.net, originalNet: this.base,
        selected: EMPTY, locks: Object.freeze([...frame.locks]), trimLocks: frame.preparation!.trimLocks,
        hiddenPoles: frame.preparation!.hiddenPoles, refinements: frame.preparation!.refinements,
        planeTangency: frame.planeTangency ?? null, curvedTangency: frame.curvedTangency ?? null, continuity: frame.continuity, freeBoundary: frame.freeBoundary,
        preview: constrained ? result.preview : null, previewStale: false,
        validNet: constrained ? frame.net : null, calculating: !constrained, error: '', canUndo: false, canRedo: false })
      if (!constrained) this.schedule(frame.net)
      return callerResult
    } catch (error) {
      if (!this.disposed && this.runtime.active) {
        if (replied) {
          this.restoreUnverified = true
          this.invalidate()
          this.update({ preview: null, validNet: null, previewStale: false, calculating: false,
            error: 'Ripristino CAD non verificabile: ripristina una ricetta valida o seleziona di nuovo la faccia.' })
        } else this.update({ preview: before.preview, validNet: before.validNet, calculating: before.calculating,
          previewStale: before.previewStale, error: before.error })
      }
      throw error
    } finally { this.recipeBusy = false }
  }

  private netFromRecipe(base: Net, edits: SurfaceEditRecipe['edits'], encoded: boolean): Net {
    const net = structuredClone(base)
    for (const edit of edits) {
      if (edit.index >= net.poles.length) throw new Error('Polo della ricetta inesistente.')
      net.poles[edit.index] = encoded ? decodeRecipePoint(edit.point) : [...edit.point] as Point
    }
    return net
  }
  private checkCurvedRecipeConstraint(constraint: SurfaceCurvedTangency, recipe: SurfaceEditRecipeV6, source: Net): void {
    const c = recipe.curvedTangency, choice = constraint?.choice, stamp = choice?.stamp
    if (!constraint || constraint.kind !== 'compatible-bspline' || !Number.isSafeInteger(constraint.constraintId) || constraint.constraintId < 1 ||
        !choice || choice.kind !== 'compatible-bspline' || !stamp || stamp.faceIndex !== recipe.faceIndex ||
        stamp.sourceId !== 'brep-sha256:' + recipe.source.brepSha256 ||
        ![stamp.sourceRevision, stamp.selectionRevision].every(n => Number.isSafeInteger(n) && n > 0) ||
        constraint.faceCount !== recipe.source.faceCount || choice.supportFaceIndex !== c.supportFaceIndex ||
        choice.edgeIndex !== c.edgeIndex || choice.side !== c.side || choice.supportSide !== c.supportSide || choice.reverseSupport !== c.reverseSupport ||
        !Number.isFinite(choice.lengthMm) || choice.lengthMm <= 0 || choice.id !== JSON.stringify([stamp.sourceId, stamp.sourceRevision,
          stamp.selectionRevision, stamp.faceIndex, choice.kind, choice.supportFaceIndex, choice.edgeIndex, choice.side, choice.supportSide, choice.reverseSupport]) ||
        constraint.scale !== c.scale || constraint.distanceTolerance !== c.distanceTolerance || constraint.derivativeTolerance !== c.derivativeTolerance ||
        !sameExact(constraint.lockedPoles, c.initialLockedPoles) ||
        !sameExact(constraint.baseNet, this.netFromRecipe(source, c.proposalBaseEdits, true)) ||
        !sameExact(constraint.referenceNet, this.netFromRecipe(source, c.acceptedReferenceEdits, true)))
      throw new Error('Vincolo G1 B-spline della ricetta non verificabile.')
    this.checkCurvedStructure(source, constraint.baseNet)
    this.checkCurvedStructure(source, constraint.referenceNet)
  }
  private async checkRestoredRecipe(result: RecipeRestoreResult, recipe: SurfaceEditRecipe | SurfaceEditRecipeV6, bodyId: string): Promise<void> {
    const p = result?.preparation
    const refinements = recipe.version === 4 || recipe.version === 5 || recipe.version === 6 ? recipe.refinements : []
    const free = recipe.version === 3 || (recipe.version === 4 && recipe.boundaryMode === 'free-natural')
    if (recipe.source.bodyId !== bodyId || !p || p.face !== recipe.faceIndex || !sameExact(p.refinements, refinements) ||
        !Array.isArray(result.faces) || result.faces.length !== recipe.source.faceCount ||
        Array.from(result.faces).some((face, i) => !face || face.index !== i) || result.preview?.valid !== true || !result.preview.mesh ||
        !Array.isArray(result.preview.faceMeshes) || result.preview.faceMeshes.length !== result.faces.length ||
        !Number.isSafeInteger(result.preview.previewRevision) || result.preview.previewRevision < 1 ||
        result.continuity !== recipe.continuity || result.freeBoundary !== free || !sameExact(result.lockedPoles, recipe.lockedPoles) ||
        !sameExact(this.netFromRecipe(p.originalNet, recipe.edits, recipe.version === 5 || recipe.version === 6), result.net) ||
        await sha256(JSON.stringify(p.originalNet)) !== recipe.baseNetSha256)
      throw new Error('Risposta di ripristino CAD non valida.')
    frozenIds(p.trimLocks, result.net.poles.length); frozenIds(p.hiddenPoles, result.net.poles.length)
    frozenIds(result.lockedPoles, result.net.poles.length)
    const constraint = result.planeTangency
    if (recipe.version === 6) {
      if (constraint || !result.curvedTangency) throw new Error('Vincolo G1 B-spline ripristinato mancante o ambiguo.')
      this.checkCurvedRecipeConstraint(result.curvedTangency, recipe, p.originalNet)
      assertNet(p.originalNet, result.curvedTangency.baseNet, 'G0')
      this.checkCurvedStructure(result.curvedTangency.baseNet, result.curvedTangency.referenceNet)
      for (let i = 0; i < result.net.poles.length; i++) if (!this.curvedProposalEditable(result.net, result.curvedTangency.choice, result.curvedTangency.lockedPoles, i) &&
          !sameExact(result.curvedTangency.referenceNet.poles[i], result.curvedTangency.baseNet.poles[i]))
        throw new Error('Polo protetto della ricetta G1 B-spline modificato.')
      this.checkCurvedEdit(result.net, result.curvedTangency)
    } else if (result.curvedTangency) throw new Error('Vincolo G1 B-spline inatteso nel ripristino legacy.')
    else if (recipe.version === 5) {
      const c = recipe.planeTangency
      if (!constraint || !Number.isSafeInteger(constraint.constraintId) || constraint.constraintId < 1 ||
          constraint.choice.stamp.faceIndex !== p.face || constraint.choice.stamp.sourceId !== 'brep-sha256:' + recipe.source.brepSha256 ||
          constraint.choice.supportFaceIndex !== c.supportFaceIndex || constraint.choice.edgeIndex !== c.edgeIndex || constraint.choice.side !== c.side ||
          constraint.distanceTolerance !== c.distanceTolerance || !sameExact(constraint.lockedPoles, c.initialLockedPoles) ||
          !sameExact(constraint.baseNet, this.netFromRecipe(p.originalNet, c.proposalBaseEdits, true)) ||
          !sameExact(constraint.referenceNet, this.netFromRecipe(p.originalNet, c.acceptedReferenceEdits, true)))
        throw new Error('Vincolo G1 ripristinato non valido.')
      assertNet(p.originalNet, constraint.baseNet, 'G0')
      validatePlaneTangencyResult(this.planeRequest(constraint), constraint.referenceNet)
      this.checkPlaneEdit(result.net, constraint)
    } else {
      if (constraint) throw new Error('Vincolo G1 inatteso nel ripristino legacy.')
      assertNet(p.originalNet, result.net, recipe.continuity, free)
    }
  }

  /** Exact knot insertion preserves the deformed surface and creates one undo step. */
  async refine(insertions: readonly KnotInsertion[]): Promise<void> {
    this.ensureActive()
    this.ensureNoPlaneTangency()
    const before = this.snapshot, previous = this.runtime.history.current, preparation = previous?.preparation
    if (!preparation || before.cylinderSession !== null) throw new Error('Preparazione della faccia non disponibile.')
    if (previous.lockSnapshots !== undefined && !preparation.adaptiveSelection) throw new Error('Raffinamento adattivo non disponibile senza rimappare i blocchi.')
    if (!insertions.length) return
    if (before.locks.length) throw new Error('Rimuovi i blocchi manuali prima di raffinare il reticolo.')
    if (before.net !== before.committedNet || before.validNet !== before.net || before.calculating)
      throw new Error('Attendi la verifica CAD e termina il trascinamento prima di raffinare.')
    if (preparation.adaptiveSelection) return this.refineAdaptive(insertions, previous)
    // Validate and allocate everything possible before changing worker selection.
    const additions = structuredClone(insertions) as KnotInsertion[]
    const net = refineClampedNet(before.net!, additions)
    const base = refineClampedNet(preparation.originalNet, additions)
    assertNet(base, net, before.continuity, before.freeBoundary)
    const refinements = [...preparation.refinements, ...additions]
    const epoch = this.epoch
    this.refining = true
    this.update({ calculating: true, validNet: null, error: '' })
    try {
      const selected = await this.runtime.worker.ask<{ net: Net; trimLocks: number[]; hiddenPoles: number[] }>({
        action: 'selectRefined', face: preparation.face, refinements,
      })
      if (this.disposed || !this.runtime.active || this.epoch !== epoch) throw new Error('Raffinamento superato.')
      if (JSON.stringify(selected.net) !== JSON.stringify(base)) throw new Error('La base raffinata non corrisponde alla preparazione richiesta.')
      const trimLocks = frozenIds(selected.trimLocks, net.poles.length)
      const hiddenPoles = frozenIds(selected.hiddenPoles, net.poles.length)
      if (trimLocks.some(i => net.poles[i].some((x, axis) => x !== base.poles[i][axis])))
        throw new Error('Il raffinamento modificherebbe un punto protetto dal trim.')
      // The worker's locks are rebuilt against the new pole indices. Never carry old ids.
      const frame = this.runtime.history.commit({ net, locks: [], continuity: before.continuity,
        freeBoundary: before.freeBoundary, preparation: {
          face: preparation.face, refinements, originalNet: base, trimLocks: [...trimLocks], hiddenPoles: [...hiddenPoles],
        } })
      this.refining = false
      this.applyFrame(frame, false)
    } catch (error) {
      // selectRefined changes mutable kernel selection. Restore it before allowing
      // another export/recipe, even when the reply itself failed validation.
      if (!this.disposed && this.runtime.active && this.epoch === epoch) {
        try {
          await this.runtime.worker.ask({ action: 'selectRefined', face: preparation.face, refinements: preparation.refinements })
        } catch {
          this.refining = false
          this.update({ calculating: false, validNet: null, error: 'Ripristino CAD fallito. Chiudi e riapri Edit Surface.' })
          throw new Error('Ripristino CAD fallito. Chiudi e riapri Edit Surface.')
        }
        if (!this.disposed && this.runtime.active && this.epoch === epoch) {
          this.refining = false
          this.update({ calculating: false, validNet: null, error: String((error as Error)?.message ?? error) })
          this.schedule(before.net!)
        }
      }
      throw error
    } finally { this.refining = false }
  }

  private async refineAdaptive(insertions: readonly KnotInsertion[], previous: EditFrame): Promise<void> {
    const before=this.snapshot, p=previous.preparation!, selection=p.adaptiveSelection!, epoch=this.epoch
    const additions=structuredClone([...insertions]), net=refineClampedNet(before.net!,additions)
    const base=refineClampedNet(p.originalNet,additions), refinements=[...p.refinements,...additions]
    this.refining=true
    this.update({calculating:true,validNet:null,error:''})
    try {
      const result=await this.runtime.worker.ask<{net:Net;originalNet:Net;refinements:KnotInsertion[];trimLocks:number[];hiddenPoles:number[];selection:AdaptiveSelection}>({
        action:'refineAdaptiveExperimental',net:before.net!,additions,continuity:before.continuity,manualLocks:[...before.locks],selection })
      if (this.disposed || !this.runtime.active || this.epoch!==epoch || this.runtime.history.current!==previous ||
          !sameExact(result.net,net) || !sameExact(result.originalNet,base) || !sameExact(result.refinements,refinements))
        throw new Error('Raffinamento adattivo non verificabile.')
      const frame=this.runtime.history.commitAdaptiveRefinement({net,locks:[],lockSnapshots:[],continuity:before.continuity,
        freeBoundary:false,preparation:{face:p.face,refinements,originalNet:base,trimLocks:result.trimLocks,
          hiddenPoles:result.hiddenPoles,adaptiveSelection:result.selection}},additions)
      this.refining=false
      this.applyFrame(frame,false)
    } catch(error) {
      if (!this.disposed && this.runtime.active) {
        this.restoreUnverified=true;this.invalidate()
        this.update({preview:null,validNet:null,previewStale:false,calculating:false,
          error:'Raffinamento adattivo non verificabile: seleziona di nuovo la faccia.'})
      }
      throw error
    } finally {this.refining=false}
  }

  /** Propose read-only, then publish the verified CAD face and its real note witness.
   * While publishing, mutations wait so the accepted reply cannot overwrite a newer draft. */
  async applyPlaneTangency(choice: G1SupportCandidate, options: { distanceTolerance?: number } = {}): Promise<void> {
    if (this.runtime.history.current?.preparation?.adaptiveSelection) throw new Error('Tangenza non disponibile per la selezione adattiva.')
    this.ensureActive()
    this.ensureNoPlaneTangency()
    const before = this.snapshot, previous = this.runtime.history.current
    const preparation = previous?.preparation
    if (this.proposingPlaneTangency || this.proposingCurvedTangency) throw new Error('Attendi la verifica della tangenza.')
    if (!preparation || before.cylinderSession !== null || before.freeBoundary)
      throw new Error('La tangenza richiede una faccia naturale preparata con bordi protetti.')
    if (before.net !== before.committedNet || before.validNet !== before.net || before.calculating)
      throw new Error('Attendi la verifica CAD e termina il trascinamento prima della tangenza.')
    if (choice.stamp.faceIndex !== preparation.face) throw new Error('Scelta del supporto scaduta.')
    const epoch = this.epoch
    const requested = structuredClone(choice)
    const lockedPoles = [...new Set([...before.locks, ...before.trimLocks, ...before.hiddenPoles])]
    const distanceTolerance = options.distanceTolerance ?? 1e-8
    this.proposingPlaneTangency = true
    let publishedReply = false
    try {
      const result = await this.runtime.worker.ask<G1PlaneResult>({
        action: 'proposeG1PlaneTangency', net: before.net!, choice: requested, lockedPoles, distanceTolerance,
        selection: { face: preparation.face, refinements: preparation.refinements },
      })
      this.ensureActive()
      if (this.epoch !== epoch || this.snapshot !== before || this.runtime.history.current !== previous)
        throw new Error('La bozza è cambiata durante la verifica della tangenza.')
      if (!this.samePlaneChoice(requested, result.choice) ||
          result.revisions?.preview !== before.preview?.previewRevision)
        throw new Error('Scelta del supporto scaduta durante la verifica della tangenza.')
      const isolatedConstraint = { baseNet: before.net!, choice: structuredClone(result.choice), lockedPoles, distanceTolerance }
      this.checkPlaneResult(result, isolatedConstraint)
      this.publishingPlaneTangency = true
      const published = await this.runtime.worker.ask<G1PublishedPlaneResult>({
        action: 'publishG1PlaneTangency', net: result.net, baseNet: before.net!, choice: result.choice,
        lockedPoles, distanceTolerance, selection: { face: preparation.face, refinements: preparation.refinements },
      })
      publishedReply = true
      this.publishingPlaneTangency = false
      this.ensureActive()
      if (this.epoch !== epoch || this.snapshot !== before || this.runtime.history.current !== previous)
        throw new Error('La bozza è cambiata durante la pubblicazione della tangenza.')
      const planeTangency: SurfacePlaneTangency = { ...isolatedConstraint,
        constraintId: published.constraintId, referenceNet: result.net }
      this.checkPublishedPlaneResult(published, planeTangency, result.net)
      const frame = this.runtime.history.commit({ net: result.net, locks: [...before.locks],
        continuity: before.continuity, freeBoundary: before.freeBoundary, preparation, planeTangency })
      this.applyFrame(frame, false, published)
    } catch (error) {
      // A successful publish already advanced the kernel witness. If its reply
      // cannot be adopted, keep geometry/history but never trust the old revision.
      if (publishedReply) this.recoverPlaneWitness(before)
      throw error
    } finally { this.proposingPlaneTangency = false; this.publishingPlaneTangency = false }
  }

  /** Curved G1 owns a separate constraint and preview queue; it never becomes a plane recipe. */
  async applyCurvedTangency(choice: CompatibleCurvedSupportCandidate,
    options: { scale?: number; distanceTolerance?: number; derivativeTolerance?: number } = {}): Promise<void> {
    this.ensureActive()
    if (this.runtime.history.current?.preparation?.adaptiveSelection) throw new Error('Tangenza non disponibile per la selezione adattiva.')
    this.ensureNoPlaneTangency()
    const before = this.snapshot, previous = this.runtime.history.current, preparation = previous?.preparation
    if (this.proposingPlaneTangency || this.proposingCurvedTangency) throw new Error('Attendi la verifica della tangenza.')
    if (!preparation || before.cylinderSession !== null || before.freeBoundary || !before.net ||
        before.net !== before.committedNet || before.validNet !== before.net || before.calculating || !before.preview)
      throw new Error('Attendi la verifica CAD della faccia naturale preparata con bordi protetti.')
    if (choice.kind !== 'compatible-bspline' || choice.stamp.faceIndex !== preparation.face) throw new Error('Scelta del supporto curvo scaduta.')
    const epoch = this.epoch, requested = structuredClone(choice)
    const lockedPoles = [...new Set([...before.locks, ...before.trimLocks, ...before.hiddenPoles])]
    const scale = options.scale ?? 1, distanceTolerance = options.distanceTolerance ?? 1e-8, derivativeTolerance = options.derivativeTolerance ?? 1e-8
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(distanceTolerance) || distanceTolerance <= 0 || distanceTolerance > 1e-6 ||
        !Number.isFinite(derivativeTolerance) || derivativeTolerance <= 0 || derivativeTolerance > 1e-6)
      throw new Error('Scala o tolleranze della tangenza curva non valide.')
    this.proposingCurvedTangency = true
    let publishedReply = false
    try {
      const result = structuredClone(await this.runtime.worker.ask<G1CurvedResult>({ action: 'proposeG1CurvedTangency', net: before.net,
        choice: requested, lockedPoles, scale, distanceTolerance, derivativeTolerance,
        selection: { face: preparation.face, refinements: preparation.refinements } }))
      this.ensureActive()
      if (this.epoch !== epoch || this.snapshot !== before || this.runtime.history.current !== previous)
        throw new Error('La bozza è cambiata durante la verifica della tangenza curva.')
      const isolated = { kind: 'compatible-bspline' as const, baseNet: before.net, choice: requested, lockedPoles,
        scale, distanceTolerance, derivativeTolerance, faceCount: before.preview.faceMeshes.length }
      if (result.revisions?.preview !== before.preview.previewRevision) throw new Error('Anteprima della tangenza curva scaduta.')
      this.checkCurvedResult(result, isolated)
      this.publishingCurvedTangency = true
      const publishedValue = await this.runtime.worker.ask<G1PublishedCurvedResult>({ action: 'publishG1CurvedTangency',
        baseNet: before.net, net: result.net, choice: requested, lockedPoles, scale, distanceTolerance, derivativeTolerance,
        selection: { face: preparation.face, refinements: preparation.refinements } })
      publishedReply = true
      const published = structuredClone(publishedValue)
      this.publishingCurvedTangency = false
      this.ensureActive()
      if (this.epoch !== epoch || this.snapshot !== before || this.runtime.history.current !== previous)
        throw new Error('La bozza è cambiata durante la pubblicazione della tangenza curva.')
      const curvedTangency: SurfaceCurvedTangency = { ...isolated, constraintId: published.constraintId, referenceNet: result.net }
      this.checkPublishedCurvedResult(published, curvedTangency, result.net)
      if (!sameExact(published.revisions, result.revisions) || published.preview.previewRevision !== result.revisions.preview + 1)
        throw new Error('Revisione pubblicata della tangenza curva non valida.')
      const frame = this.runtime.history.commit({ net: result.net, locks: [...before.locks], continuity: before.continuity,
        freeBoundary: false, preparation, curvedTangency })
      this.applyFrame(frame, false, published)
    } catch (error) {
      if (publishedReply) this.recoverCurvedWitness(before)
      throw error
    } finally { this.proposingCurvedTangency = false; this.publishingCurvedTangency = false }
  }

  async evaluateCurvedTangencyForExport(): Promise<G1PublishedCurvedResult & { step: string }> {
    this.ensureActive()
    this.exportRequests++
    try {
      const before = this.snapshot, constraint = before.curvedTangency, selection = this.selectionPayload().selection, epoch = this.epoch
      if (!constraint || !selection || !before.net || before.validNet !== before.net || before.calculating)
        throw new Error('Attendi la verifica CAD della tangenza curva.')
      const reply = await this.runtime.worker.ask<G1PublishedCurvedResult>({ action: 'evaluateG1CurvedTangency',
        constraintId: constraint.constraintId, net: before.net, lockedPoles: constraint.lockedPoles, selection, exportStep: true })
      try {
        const result = structuredClone(reply)
        this.ensureActive()
        if (this.epoch !== epoch || this.snapshot.net !== before.net || this.snapshot.curvedTangency !== constraint ||
            this.snapshot.validNet !== before.net || this.snapshot.calculating)
          throw new Error('La bozza è cambiata durante la valutazione STEP della tangenza curva.')
        this.checkPublishedCurvedResult(result, constraint, before.net)
        if (typeof result.step !== 'string' || !result.step.trim()) throw new Error('STEP della tangenza curva non valido.')
        this.curvedPublished = { epoch, net: before.net, constraint, value: result }
        this.update({ preview: result.preview, previewStale: false })
        return result as G1PublishedCurvedResult & { step: string }
      } catch (error) { this.recoverCurvedWitness(before); throw error }
    } finally { this.exportRequests-- }
  }

  /** Reevaluate the actual G1 net and STEP, then adopt the returned real note witness. */
  async evaluatePlaneTangencyForExport(): Promise<G1PublishedPlaneResult & { step: string }> {
    this.ensureActive()
    this.exportRequests++
    try { return await this.evaluatePlaneTangencyForExportCurrent() }
    finally { this.exportRequests-- }
  }
  private async evaluatePlaneTangencyForExportCurrent(): Promise<G1PublishedPlaneResult & { step: string }> {
    this.ensureActive()
    const before = this.snapshot, constraint = before.planeTangency
    const selection = this.selectionPayload().selection
    if (!constraint || !selection || !before.net) throw new Error('Tangenza piano non disponibile.')
    if (before.validNet !== before.net || before.calculating) throw new Error('Attendi la verifica CAD della tangenza.')
    const epoch = this.epoch
    const result = await this.runtime.worker.ask<G1PublishedPlaneResult>({
      action: 'evaluateG1PlaneTangency', net: before.net, constraintId: constraint.constraintId,
      lockedPoles: constraint.lockedPoles, selection, exportStep: true,
    })
    try {
      this.ensureActive()
      if (this.epoch !== epoch || this.snapshot.net !== before.net || this.snapshot.planeTangency !== constraint ||
          this.snapshot.validNet !== before.net || this.snapshot.calculating)
        throw new Error('La bozza è cambiata durante la valutazione STEP della tangenza.')
      this.checkPublishedPlaneResult(result, constraint, before.net)
      if (typeof result.step !== 'string' || !result.step.length) throw new Error('STEP della tangenza non valido.')
      this.planePublished = { epoch, net: before.net, constraint, value: result }
      this.update({ preview: result.preview, previewStale: false })
      return result as G1PublishedPlaneResult & { step: string }
    } catch (error) {
      this.recoverPlaneWitness(before)
      throw error
    }
  }

  /** Drop the selected face and invalidate in-flight worker replies. */
  reset(options: { preserveContinuity?: boolean } = {}): void {
    this.ensureActive(true)
    this.restoreUnverified = false
    const continuity = options.preserveContinuity ? this.snapshot.continuity : 'G1'
    this.invalidate()
    this.runtime.history.reset()
    this.base = null
    this.queueNet = null
    this.update({ cylinderSession: null, cylinderPreview: null, net: null, committedNet: null, originalNet: null, selected: EMPTY, locks: EMPTY, trimLocks: EMPTY,
      hiddenPoles: EMPTY, refinements: NO_REFINEMENTS, planeTangency: null, curvedTangency: null, continuity, freeBoundary: false, preview: null, previewStale: false,
      validNet: null, calculating: false, error: '', canUndo: false, canRedo: false })
  }

  setSelection(ids: readonly number[]): void {
    this.ensureActive()
    const net = this.requireNet()
    const selected = frozenIds(ids, net.poles.length)
    if (!sameIds(selected, this.snapshot.selected)) this.update({ selected })
  }

  /** Update during drag without adding a history frame or changing the host. */
  preview(net: Net): void {
    this.ensureActive()
    net = this.checkEdit(net)
    const draft = freezeNet(structuredClone(net))
    this.update({ net: draft, validNet: null, calculating: true, error: '' })
    this.schedule(draft)
  }

  /** Commit an edit once, preserving current locks and border settings. */
  commit(net: Net = this.requireNet()): void {
    this.ensureActive()
    const supplied = net
    net = this.checkEdit(net)
    const equivalentToShown = supplied === this.snapshot.net
    const frame = this.runtime.history.commit({ net, locks: [...this.snapshot.locks],
      continuity: this.snapshot.continuity, freeBoundary: this.snapshot.freeBoundary, preparation: this.runtime.history.current?.preparation,
      planeTangency: this.runtime.history.current?.planeTangency, curvedTangency: this.runtime.history.current?.curvedTangency })
    this.applyFrame(frame, equivalentToShown)
  }

  /** Controller-only point targeting. The anchor must belong to the caller's
   * exact validated snapshot; its UV is classified on the current CAD face.
   * Success commits one candidate, then the ordinary CAD queue validates it.
   * It does not mean that the resulting body has already passed CAD validation.
   */
  async targetPoint(expected: SurfaceDraftSnapshot, anchor: DraftAnchor,
    request: Omit<SurfacePointTarget, 'u' | 'v' | 'editablePoles'>): Promise<ReturnType<typeof targetSurfacePoint>> {
    this.ensureActive()
    const before = this.snapshot, preparation = this.runtime.history.current?.preparation
    if (before !== expected) throw new Error('La bozza del punto superficie è cambiata.')
    if (!before.net || before.net !== before.committedNet || before.validNet !== before.net ||
        before.calculating || before.previewStale || !before.preview?.valid ||
        !Number.isSafeInteger(before.preview.previewRevision) || this.exportRequests ||
        this.proposingPlaneTangency || this.proposingCurvedTangency)
      throw new Error('Attendi una bozza CAD valida prima di scegliere il punto superficie.')
    if (before.cylinderSession !== null || before.planeTangency || before.curvedTangency || preparation?.adaptiveSelection)
      throw new Error('Punto superficie non qualificato per questa preparazione o tangenza.')
    if (!preparation || !anchor || anchor.face !== preparation.face || !Number.isSafeInteger(anchor.selectionRevision) ||
        anchor.selectionRevision < 0 || !Number.isFinite(anchor.u) || !Number.isFinite(anchor.v))
      throw new Error('Riferimento del punto superficie non coerente con la faccia.')
    const locked = new Set([...before.locks, ...before.trimLocks, ...before.hiddenPoles])
    const editablePoles = before.selected.filter(i => !locked.has(i) &&
      (before.freeBoundary || !boundaryLocked(before.net!, i, before.continuity)))
    if (!editablePoles.length) throw new Error('Seleziona poli liberi che influenzino il punto superficie.')
    // Own caller inputs before yielding; they may change while CAD resolves UV.
    const picked = structuredClone(anchor), options = structuredClone(request)
    const candidate = targetSurfacePoint(before.net, { ...options, u: picked.u, v: picked.v, editablePoles })
    this.checkEdit(candidate.net)
    const resolved = await this.runtime.worker.ask<{ at: Point; normal: Point }>({ action: 'noteResolve',
      anchor: picked, previewRevision: before.preview.previewRevision! })
    this.ensureActive()
    if (this.snapshot !== before || this.exportRequests || this.proposingPlaneTangency || this.proposingCurvedTangency)
      throw new Error('La bozza del punto superficie è cambiata durante la verifica CAD.')
    if (!resolved || !Array.isArray(resolved.at) || resolved.at.length !== 3 || !resolved.at.every(Number.isFinite) ||
        Math.hypot(...resolved.at.map((x, d) => x - candidate.before[d])) > 1e-7)
      throw new Error('Il punto CAD non coincide con il riferimento della superficie.')
    this.commit(candidate.net)
    return candidate
  }

  /** Restore the source surface even when points have since been manually locked. */
  restoreOriginal(): void {
    this.ensureActive()
    this.ensureNoPlaneTangency()
    if (!this.base) throw new Error('Scegli prima una faccia CAD.')
    const frame = this.runtime.history.commit({ net: this.base, locks: [...this.snapshot.locks],
      continuity: this.snapshot.continuity, freeBoundary: this.snapshot.freeBoundary, preparation: this.runtime.history.current?.preparation,
      planeTangency: this.runtime.history.current?.planeTangency, curvedTangency: this.runtime.history.current?.curvedTangency })
    this.applyFrame(frame, this.base === this.snapshot.net)
  }

  /**
   * Export evaluates again inside the same worker and changes its face revision.
   * Adopt that verified preview only if geometry and queue have not changed.
   */
  async evaluateForExport(): Promise<Preview & { step: string; previewRevision: number }> {
    this.ensureActive()
    this.exportRequests++
    try { return await this.evaluateForExportCurrent() }
    finally { this.exportRequests-- }
  }
  private async evaluateForExportCurrent(): Promise<Preview & { step: string; previewRevision: number }> {
    this.ensureActive()
    if (this.snapshot.curvedTangency) {
      const result = await this.evaluateCurvedTangencyForExport()
      return { ...result.preview, step: result.step }
    }
    if (this.snapshot.planeTangency) {
      const result = await this.evaluatePlaneTangencyForExport()
      return { ...result.preview, step: result.step }
    }
    if (this.snapshot.cylinderSession !== null) throw new Error('Usa la verifica cilindrica dedicata.')
    const snapshot = this.snapshot, net = this.requireNet()
    const current = this.runtime.previews.getSnapshot().current
    if (snapshot.validNet !== net || snapshot.calculating || !current)
      throw new Error('Attendi la verifica CAD della bozza corrente.')
    const epoch = this.epoch
    const adaptive = this.runtime.history.current?.preparation?.adaptiveSelection
    const result = await this.runtime.worker.ask<Preview & { step: string; previewRevision: number }>(adaptive
      ? { action: 'evaluateAdaptiveExperimental', net, continuity: snapshot.continuity, exportStep: true, selection: adaptive }
      : { action: 'evaluate', net, continuity: snapshot.continuity, freeBoundary: snapshot.freeBoundary, exportStep: true, ...this.selectionPayload() })
    this.ensureActive()
    const next = this.snapshot, queue = this.runtime.previews.getSnapshot()
    if (epoch !== this.epoch || next.net !== net || next.validNet !== net || next.calculating ||
        next.continuity !== snapshot.continuity || next.freeBoundary !== snapshot.freeBoundary ||
        queue.current?.revision !== current.revision || queue.validRevision !== current.revision ||
        this.runtime.history.current?.preparation?.adaptiveSelection !== adaptive ||
        result.valid !== true || !Number.isInteger(result.previewRevision) || typeof result.step !== 'string')
      throw new Error('La bozza è cambiata durante la valutazione STEP.')
    this.exported = { epoch, queueRevision: current.revision, value: result }
    this.update({ preview: result, previewStale: false })
    return result
  }

  /** Full experimental cylinder evaluation, kept separate from normal Apply. */
  async evaluateCylinderForExport(): Promise<{ mesh: Mesh; step: string; previewRevision:number }> {
    this.ensureActive()
    this.exportRequests++
    try { return await this.evaluateCylinderForExportCurrent() }
    finally { this.exportRequests-- }
  }
  private async evaluateCylinderForExportCurrent(): Promise<{ mesh: Mesh; step: string; previewRevision:number }> {
    this.ensureActive()
    const snapshot = this.snapshot, net = this.requireNet(), session = snapshot.cylinderSession
    if (session === null) throw new Error('Scegli prima una faccia cilindrica.')
    this.checkEdit(net)
    const epoch = this.epoch
    const value = await this.runtime.worker.ask<{ mesh: Mesh; step: string; previewRevision:number }>({ action: 'evaluateCylinder', session, net })
    this.ensureActive()
    if (epoch !== this.epoch || this.snapshot.net !== net || this.snapshot.cylinderSession !== session ||
        this.snapshot.continuity !== snapshot.continuity || this.snapshot.freeBoundary !== snapshot.freeBoundary)
      throw new Error('La bozza è cambiata durante la valutazione STEP.')
    if (!value.mesh || typeof value.step !== 'string' || !value.step.length || !Number.isSafeInteger(value.previewRevision)) throw new Error('Valutazione cilindrica non valida.')
    return value
  }

  /** Cancel an uncommitted drag and return to the last committed frame. */
  cancelDraft(): void {
    this.ensureActive()
    const frame = this.runtime.history.current
    if (frame) this.applyFrame(frame, false)
  }

  setLocks(ids: readonly number[]): void {
    this.ensureActive()
    const net = this.requireNet()
    const locks = frozenIds(ids, net.poles.length)
    const constraint = this.snapshot.planeTangency ?? this.snapshot.curvedTangency
    if (constraint) {
      if (locks.some(i => !constraint.lockedPoles.includes(i) && !boundaryLocked(net, i, 'G1')))
        throw new Error('Nuovi blocchi interni richiedono una nuova verifica del vincolo G1.')
      const fixedManual = constraint.lockedPoles.filter(i => !this.snapshot.trimLocks.includes(i) && !this.snapshot.hiddenPoles.includes(i))
      if (fixedManual.some(i => !locks.includes(i))) throw new Error('I blocchi iniziali restano protetti fino ad Annulla tangenza.')
    }
    const frame = this.runtime.history.commit({ net, locks: [...locks],
      continuity: this.snapshot.continuity, freeBoundary: this.snapshot.freeBoundary, preparation: this.runtime.history.current?.preparation,
      planeTangency: this.runtime.history.current?.planeTangency, curvedTangency: this.runtime.history.current?.curvedTangency })
    this.applyFrame(frame, true)
  }

  setContinuity(continuity: 'G0' | 'G1'): void {
    this.ensureActive()
    this.ensureNoPlaneTangency()
    const net = this.requireNet()
    if (continuity !== 'G0' && continuity !== 'G1') throw new Error('Continuità non valida.')
    if (this.snapshot.cylinderSession !== null) {
      if (continuity !== 'G1') throw new Error('Il cilindro richiede continuità G1.')
      return
    }
    if (this.snapshot.freeBoundary) throw new Error('Proteggi prima i bordi liberi.')
    assertNet(this.base!, net, continuity)
    const frame = this.runtime.history.commit({ net, locks: [...this.snapshot.locks],
      continuity, freeBoundary: false, preparation: this.runtime.history.current?.preparation })
    this.applyFrame(frame, true)
  }

  /** The host must check FaceInfo.freeBoundary before enabling this option. */
  setFreeBoundary(freeBoundary: boolean): void {
    this.ensureActive()
    if (freeBoundary && this.runtime.history.current?.preparation?.adaptiveSelection) throw new Error('I bordi adattivi devono restare protetti.')
    this.ensureNoPlaneTangency()
    const net = this.requireNet()
    if (this.snapshot.cylinderSession !== null) {
      if (freeBoundary) throw new Error('I bordi cilindrici devono restare protetti.')
      return
    }
    if (!freeBoundary) assertNet(this.base!, net, this.snapshot.continuity)
    const frame = this.runtime.history.commit({ net, locks: [...this.snapshot.locks],
      continuity: this.snapshot.continuity, freeBoundary, preparation: this.runtime.history.current?.preparation })
    this.applyFrame(frame, true)
  }

  undo(): boolean { return this.step(-1) }
  redo(): boolean { return this.step(1) }

  /** Dispose only this controller; the session owner disposes the runtime. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.unsubscribeCylinder()
    this.unsubscribePlane()
    this.unsubscribeCurved()
    this.planePreviews.dispose()
    this.curvedPreviews.dispose()
    this.cylinderPreviews.dispose()
    this.epoch++
    this.runtime.previews.invalidate({ clearPreview: true })
    this.runtime.history.reset()
    this.base = null
    this.queueNet = null
    this.exported = null
    owners.delete(this.runtime)
    this.update({ cylinderSession: null, cylinderPreview: null, net: null, committedNet: null, originalNet: null, selected: EMPTY, locks: EMPTY, trimLocks: EMPTY,
      preview: null, previewStale: false, validNet: null, calculating: false,
      hiddenPoles: EMPTY, refinements: NO_REFINEMENTS, planeTangency: null, curvedTangency: null, error: '', canUndo: false, canRedo: false })
    this.listeners.clear()
  }

  private ensureActive(allowUnverifiedRestore = false): void {
    if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
    if (this.recipeBusy) throw new Error('Attendi il completamento della ricetta CAD.')
    if (this.restoreUnverified && !allowUnverifiedRestore) throw new Error('Ripristino CAD non verificabile: seleziona di nuovo la faccia o ripristina una ricetta valida.')
    if (this.refining) throw new Error('Attendi il raffinamento del reticolo.')
    if (this.publishingPlaneTangency || this.publishingCurvedTangency) throw new Error('Attendi la pubblicazione della tangenza.')
  }
  private requireNet(): Net {
    if (!this.snapshot.net) throw new Error('Scegli prima una faccia CAD.')
    return this.snapshot.net
  }
  private invalidate(): void {
    this.exported = null
    this.planePublished = null
    this.curvedPublished = null
    this.epoch++
    this.runtime.previews.invalidate({ clearPreview: true })
    this.cylinderPreviews.invalidate({ clearPreview: true })
    this.planePreviews.invalidate({ clearPreview: true })
    this.curvedPreviews.invalidate({ clearPreview: true })
  }
  private recoverPlaneWitness(before: SurfaceDraftSnapshot): void {
    if (this.disposed || !this.runtime.active || !before.net || this.snapshot.net !== before.net ||
        this.snapshot.planeTangency !== before.planeTangency || this.snapshot.validNet !== before.net) return
    this.invalidate()
    this.update({ preview: null, previewStale: false, validNet: null, calculating: true, error: '' })
    this.schedule(before.net)
  }
  private recoverCurvedWitness(before: SurfaceDraftSnapshot): void {
    if (this.disposed || !this.runtime.active || !before.net || this.snapshot.net !== before.net ||
        this.snapshot.curvedTangency !== before.curvedTangency || this.snapshot.validNet !== before.net) return
    this.invalidate()
    this.update({ preview: null, previewStale: false, validNet: null, calculating: true, error: '' })
    this.schedule(before.net)
  }
  private ensureNoPlaneTangency(): void {
    if (this.snapshot.planeTangency || this.snapshot.curvedTangency) throw new Error('Annulla la tangenza prima di questa operazione.')
  }
  private checkEdit(candidate: Net): Net {
    const constraint = this.snapshot.planeTangency
    if (constraint) this.checkPlaneEdit(candidate, constraint)
    const curved = this.snapshot.curvedTangency
    if (curved) this.checkCurvedEdit(candidate, curved)
    const base = this.base, frame = this.runtime.history.current
    if (!base || !frame) throw new Error('Scegli prima una faccia CAD.')
    if (this.snapshot.cylinderSession !== null) {
      candidate = canonicalizeCylinderGesture(frame.net, candidate)
      assertSmoothCylinderMove(base, candidate)
    } else if (!constraint && !curved) assertNet(base, candidate, this.snapshot.continuity, this.snapshot.freeBoundary)
    for (const i of [...this.snapshot.locks, ...this.snapshot.trimLocks]) {
      if (candidate.poles[i].some((value, axis) => value !== frame.net.poles[i][axis]))
        throw new Error('Un punto bloccato è stato modificato.')
    }
    return candidate
  }
  private step(delta: -1 | 1): boolean {
    this.ensureActive()
    const previous=this.runtime.history.current, target=this.runtime.history.peek(delta)
    const active=previous?.preparation?.adaptiveSelection, historical=target?.preparation?.adaptiveSelection
    if (target && active && historical && !sameExact(active,historical)) {
      void this.stepAdaptive(delta,previous!,target)
      return true
    }
    const frame = this.runtime.history.step(delta)
    if (!frame) return false
    this.applyFrame(frame, false)
    return true
  }
  private async stepAdaptive(delta: -1 | 1, previous: EditFrame, target: EditFrame): Promise<void> {
    const p=target.preparation!, active=previous.preparation!.adaptiveSelection!, epoch=this.epoch
    this.refining=true;this.historyTransition=true
    this.update({calculating:true,validNet:null,canUndo:false,canRedo:false,error:''})
    try {
      const result=await this.runtime.worker.ask<{net:Net;selection:AdaptiveSelection}>({action:'reactivateAdaptiveExperimental',
        refinements:p.refinements,expectedNet:p.originalNet,expectedTrimLocks:p.trimLocks,expectedHiddenPoles:p.hiddenPoles,selection:active})
      if (this.disposed || !this.runtime.active || this.epoch!==epoch || this.runtime.history.current!==previous ||
          this.runtime.history.peek(delta)!==target || !sameExact(result.net,p.originalNet)) throw new Error('Cronologia adattiva superata.')
      const checked=await this.runtime.worker.ask<Preview>({action:'evaluateAdaptiveExperimental',net:target.net,
        continuity:target.continuity,selection:result.selection})
      if (this.disposed || !this.runtime.active || this.epoch!==epoch || this.runtime.history.current!==previous ||
          this.runtime.history.peek(delta)!==target || checked.valid!==true) throw new Error('Cronologia adattiva non verificabile.')
      const frame=this.runtime.history.stepAdaptive(delta,result.selection)
      this.refining=false
      this.applyFrame(frame,false)
    } catch {
      if (!this.disposed && this.runtime.active) {
        this.restoreUnverified=true;this.invalidate()
        this.update({preview:null,validNet:null,previewStale:false,calculating:false,canUndo:false,canRedo:false,
          error:'Cronologia adattiva non verificabile: seleziona di nuovo la faccia.'})
      }
    } finally {this.refining=false;this.historyTransition=false}
  }
  private applyFrame(frame: EditFrame, equivalentToShown: boolean, published?: G1PublishedPlaneResult | G1PublishedCurvedResult): void {
    const previous = this.snapshot
    freezeNet(frame.net)
    this.freezePreparation(frame.preparation)
    this.freezePlaneTangency(frame.planeTangency)
    this.freezeCurvedTangency(frame.curvedTangency)
    const changedPlaneTangency = previous.planeTangency !== (frame.planeTangency ?? null) ||
      previous.curvedTangency !== (frame.curvedTangency ?? null)
    if (changedPlaneTangency) this.invalidate()
    const changedPreparation = this.runtime.history.current?.preparation !== undefined &&
      this.base !== frame.preparation?.originalNet
    if (frame.preparation) this.base = frame.preparation.originalNet
    const sameGeometry = previous.net === frame.net || equivalentToShown
    const sameMode = previous.continuity === frame.continuity && previous.freeBoundary === frame.freeBoundary
    const requiresPreview = !sameGeometry || !sameMode || changedPreparation || changedPlaneTangency
    const locks = Object.freeze([...frame.locks])
    this.update({ net: frame.net, committedNet: frame.net, locks, planeTangency: frame.planeTangency ?? null,
      curvedTangency: frame.curvedTangency ?? null, continuity: frame.continuity, freeBoundary: frame.freeBoundary,
      ...(frame.preparation ? { originalNet: frame.preparation.originalNet,
        trimLocks: frame.preparation.trimLocks, hiddenPoles: frame.preparation.hiddenPoles,
        refinements: frame.preparation.refinements } : {}),
      ...(changedPreparation ? { selected: EMPTY } : {}),
      ...(changedPlaneTangency ? { preview: null, previewStale: false } : {}),
      validNet: requiresPreview ? null : previous.validNet ? frame.net : null,
      calculating: requiresPreview ? true : previous.calculating,
      error: requiresPreview ? '' : previous.error,
      canUndo: this.runtime.history.canUndo, canRedo: this.runtime.history.canRedo })
    if (published && frame.curvedTangency) {
      this.curvedPublished = { epoch: this.epoch, net: frame.net, constraint: frame.curvedTangency, value: published }
      this.update({ preview: published.preview, previewStale: false, validNet: frame.net, calculating: false, error: '' })
    } else if (published && frame.planeTangency) {
      this.planePublished = { epoch: this.epoch, net: frame.net, constraint: frame.planeTangency, value: published }
      this.update({ preview: published.preview, previewStale: false, validNet: frame.net, calculating: false, error: '' })
    } else if (requiresPreview) this.schedule(frame.net)
    else {
      if (this.planePublished?.net === previous.net) this.planePublished.net = frame.net
      if (this.curvedPublished?.net === previous.net) this.curvedPublished.net = frame.net
      this.syncPreview()
    }
  }
  private schedule(net: Net): void {
    this.exported = null
    this.planePublished = null
    this.curvedPublished = null
    this.queueNet = net
    const curvedTangency = this.snapshot.curvedTangency
    if (curvedTangency) {
      const selection = this.selectionPayload().selection
      const revision = selection && this.curvedPreviews.schedule({ net, constraint: curvedTangency, epoch: this.epoch, selection })
      if (!revision) this.update({ validNet: null, calculating: false, error: 'Preparazione della tangenza curva non disponibile.' })
      return
    }
    const planeTangency = this.snapshot.planeTangency
    if (planeTangency) {
      const selection = this.selectionPayload().selection
      const revision = selection && this.planePreviews.schedule({ net, constraint: planeTangency, epoch: this.epoch, selection })
      if (!revision) this.update({ validNet: null, calculating: false, error: 'Preparazione della tangenza non disponibile.' })
      return
    }
    const cylinderSession = this.snapshot.cylinderSession
    const payload = { net, continuity: this.snapshot.continuity, freeBoundary: this.snapshot.freeBoundary, epoch: this.epoch }
    const revision = cylinderSession !== null
      ? this.cylinderPreviews.schedule({ ...payload, session: cylinderSession })
      : this.runtime.previews.schedule({
      net, continuity: this.snapshot.continuity, freeBoundary: this.snapshot.freeBoundary, epoch: this.epoch,
      ...(this.runtime.history.current?.preparation?.adaptiveSelection
        ? { adaptiveSelection: this.runtime.history.current.preparation.adaptiveSelection }
        : this.selectionPayload()),
    })
    if (revision === null) this.update({ validNet: null, calculating: false, error: 'Anteprima CAD non disponibile.' })
  }
  private syncPreview = (): void => {
    if (this.disposed) return
    if (this.recipeBusy || this.restoreUnverified) return
    if (this.refining) return
    if (this.snapshot.curvedTangency) {
      const published = this.curvedPublished
      if (published && published.epoch === this.epoch && published.net === this.snapshot.net &&
          published.constraint === this.snapshot.curvedTangency) {
        this.update({ preview: published.value.preview, cylinderPreview: null, validNet: this.runtime.active ? this.snapshot.net : null,
          calculating: false, previewStale: false, error: this.runtime.active ? '' : 'Editor chiuso.' })
        return
      }
      const queue = this.curvedPreviews.getSnapshot(), current = queue.current
      const matches = !!current && current.draft.epoch === this.epoch && current.draft.net === this.queueNet &&
        current.draft.constraint === this.snapshot.curvedTangency
      const visible = queue.preview?.identity.epoch === this.epoch &&
        queue.preview.identity.constraint === this.snapshot.curvedTangency ? queue.preview : null
      const valid = this.runtime.active && matches && queue.validRevision === current?.revision &&
        visible?.revision === current?.revision && visible.value.preview.valid === true
      this.update({ preview: visible?.value.preview ?? null, cylinderPreview: null,
        validNet: valid ? this.snapshot.net : null, previewStale: !!visible && (!valid || visible.stale),
        calculating: this.runtime.active && queue.calculating,
        error: !this.runtime.active ? 'Editor chiuso.' : matches && queue.error?.revision === current?.revision
          ? String((queue.error.error as Error)?.message ?? queue.error.error) : '' })
      return
    }
    if (this.snapshot.planeTangency) {
      const published = this.planePublished
      if (published && published.epoch === this.epoch && published.net === this.snapshot.net &&
          published.constraint === this.snapshot.planeTangency) {
        this.update({ preview: published.value.preview, cylinderPreview: null, validNet: this.runtime.active ? this.snapshot.net : null,
          calculating: false, previewStale: false, error: this.runtime.active ? '' : 'Editor chiuso.' })
        return
      }
      const queue = this.planePreviews.getSnapshot(), current = queue.current
      const matches = !!current && current.draft.epoch === this.epoch && current.draft.net === this.queueNet &&
        current.draft.constraint === this.snapshot.planeTangency
      const visible = queue.preview?.identity.epoch === this.epoch &&
        queue.preview.identity.constraint === this.snapshot.planeTangency ? queue.preview : null
      const valid = this.runtime.active && matches && queue.validRevision === current?.revision &&
        visible?.revision === current?.revision && visible.value.preview.valid === true
      this.update({ preview: visible?.value.preview ?? null, cylinderPreview: null,
        validNet: valid ? this.snapshot.net : null, previewStale: !!visible && (!valid || visible.stale),
        calculating: this.runtime.active && queue.calculating,
        error: !this.runtime.active ? 'Editor chiuso.' : matches && queue.error?.revision === current?.revision
          ? String((queue.error.error as Error)?.message ?? queue.error.error) : '' })
      return
    }
    if (this.snapshot.cylinderSession !== null) {
      const queue = this.cylinderPreviews.getSnapshot(), current = queue.current
      const matches = !!current && current.draft.epoch === this.epoch && current.draft.net === this.queueNet &&
        current.draft.session === this.snapshot.cylinderSession
      const visible = queue.preview?.identity.epoch === this.epoch ? queue.preview : null
      this.update({ preview: null, cylinderPreview: visible?.value ?? null, validNet: null,
        previewStale: !!visible && (visible.stale || !matches || visible.revision !== current?.revision),
        calculating: this.runtime.active && queue.calculating,
        error: !this.runtime.active ? 'Editor chiuso.' : matches && queue.error?.revision === current?.revision
          ? String((queue.error.error as Error)?.message ?? queue.error.error) : '' })
      return
    }
    const queue = this.runtime.previews.getSnapshot(), current = queue.current
    const matches = (job: PreviewDraft) => job.epoch === this.epoch &&
      job.continuity === this.snapshot.continuity && job.freeBoundary === this.snapshot.freeBoundary &&
      job.adaptiveSelection === this.runtime.history.current?.preparation?.adaptiveSelection
    const currentMatches = !!current && matches(current.draft) && current.draft.net === this.queueNet
    const visible = queue.preview && matches(queue.preview.identity) ? queue.preview : null
    const valid = this.runtime.active && currentMatches && queue.validRevision === current?.revision &&
      visible?.revision === current?.revision && visible.value.valid === true
    const error = currentMatches && queue.error?.revision === current?.revision
      ? String((queue.error.error as Error)?.message ?? queue.error.error) : ''
    const exported = valid && this.exported?.epoch === this.epoch &&
      this.exported.queueRevision === current?.revision ? this.exported.value : null
    this.update({ preview: exported ?? visible?.value ?? null,
      cylinderPreview: null,
      previewStale: !!visible && (!valid || visible.stale),
      validNet: valid ? this.snapshot.net : null, calculating: this.runtime.active && queue.calculating,
      error: this.runtime.active ? error : 'Editor chiuso.' })
  }
  private selectionPayload(): { selection?: { face: number; refinements: KnotInsertion[] } } {
    const preparation = this.runtime.history.current?.preparation
    return preparation ? { selection: { face: preparation.face, refinements: preparation.refinements } } : {}
  }
  private checkCurvedStructure(base: Net, net: Net): void {
    assertNet(base, net, 'G0', true)
    if (!sameExact({ ...base, poles: [] }, { ...net, poles: [] }) ||
        Array.from(net.poles).some(p => !Array.isArray(p) || p.length !== 3 || Array.from(p).some(x => !Number.isFinite(x))))
      throw new Error('Reticolo della tangenza curva non valido o struttura modificata.')
  }
  private curvedProposalEditable(net: Net, choice: CompatibleCurvedSupportCandidate, locks: readonly number[], id: number): boolean {
    const u = Math.floor(id / net.nv), v = id % net.nv
    const distances = { uMin: u, uMax: net.nu - 1 - u, vMin: v, vMax: net.nv - 1 - v }
    return distances[choice.side] === 1 && !locks.includes(id) &&
      (Object.keys(distances) as (keyof typeof distances)[]).every(side => side === choice.side || distances[side] >= 2)
  }
  private checkCurvedProof(result: G1CurvedResult, constraint: Omit<SurfaceCurvedTangency, 'constraintId' | 'referenceNet'>,
    protectedCount: number): void {
    const v = result?.validation, preview = result?.preview, choice = constraint.choice
    const along = choice.side === 'uMin' || choice.side === 'uMax' ? result.net.nv : result.net.nu
    const pairCount = (along - 1) * along
    if (!result || !sameExact(choice, result.choice) || !sameExact(result.stamp, choice.stamp) ||
        choice.kind !== 'compatible-bspline' || preview?.valid !== true || !preview.mesh || !Array.isArray(preview.faceMeshes) ||
        Array.from(preview.faceMeshes).some(mesh => !mesh) ||
        ![preview.volume, preview.maxBoundaryError, preview.minimumNormalDot].every(Number.isFinite) ||
        preview.maxBoundaryError < 0 || preview.maxBoundaryError > 1e-6 || preview.minimumNormalDot < 0.05 ||
        preview.faceMeshes.length !== constraint.faceCount || constraint.faceCount <= Math.max(choice.stamp.faceIndex, choice.supportFaceIndex) ||
        !result.revisions || ![result.revisions.edit, result.revisions.preview, result.revisions.anchorSelection].every(n => Number.isSafeInteger(n) && n >= 0) ||
        v?.globalG1Certified !== false || v.edgeRegularity !== 'outward-rounded-coefficient-hull-proof' ||
        v.checkedDerivativePairs !== pairCount || v.protectedPoleCount !== protectedCount ||
        ![v.minSupportNormalMagnitudeBound, v.minSelectedNormalMagnitudeBound].every(n => Number.isFinite(n) && n > 0) ||
        ![v.maxDerivativeCoefficientResidual, v.maxStraightnessResidual, v.maxNormalSinBound].every(n => Number.isFinite(n) && n >= 0) ||
        v.maxDerivativeCoefficientResidual > constraint.derivativeTolerance || v.maxStraightnessResidual > constraint.distanceTolerance || v.maxNormalSinBound > 1e-7)
      throw new Error('Risposta CAD della tangenza curva non verificabile.')
  }
  private checkCurvedResult(result: G1CurvedResult, constraint: Omit<SurfaceCurvedTangency, 'constraintId' | 'referenceNet'>): void {
    if (!result?.net || result.preview?.previewRevision !== undefined) throw new Error('Proposta curva non isolata.')
    this.checkCurvedStructure(constraint.baseNet, result.net)
    const protectedIds = result.net.poles.flatMap((_, i) => this.curvedProposalEditable(result.net, constraint.choice, constraint.lockedPoles, i) ? [] : [i])
    for (const id of protectedIds) if (!sameExact(result.net.poles[id], constraint.baseNet.poles[id]))
      throw new Error('Polo protetto modificato dalla proposta curva.')
    const changed = result.net.poles.flatMap((p, i) => sameExact(p, constraint.baseNet.poles[i]) ? [] : [i])
    if (!sameExact(changed, result.changedIndices)) throw new Error('Modifiche della proposta curva non verificabili.')
    this.checkCurvedProof(result, constraint, protectedIds.length)
  }
  private checkCurvedEdit(net: Net, constraint: SurfaceCurvedTangency): number[] {
    if (constraint.kind !== 'compatible-bspline') throw new Error('Vincolo curvo non valido.')
    this.checkCurvedStructure(constraint.referenceNet, net)
    const ids = net.poles.flatMap((_, i) => boundaryLocked(net, i, 'G1') || constraint.lockedPoles.includes(i) ? [i] : [])
    for (const id of ids) if (!sameExact(net.poles[id], constraint.referenceNet.poles[id]))
      throw new Error('Un punto protetto dal vincolo G1 curvo è stato modificato.')
    return ids
  }
  private checkPublishedCurvedResult(result: G1PublishedCurvedResult, constraint: SurfaceCurvedTangency, expected: Net): void {
    if (!result || result.constraintKind !== 'compatible-bspline' || !Number.isSafeInteger(result.constraintId) || result.constraintId < 1 ||
        result.constraintId !== constraint.constraintId || !sameExact(result.net, expected) ||
        !Number.isSafeInteger(result.preview?.previewRevision) || result.preview.previewRevision < 1 ||
        result.preview.previewRevision !== result.revisions?.preview + 1)
      throw new Error('Risultato pubblicato della tangenza curva non valido.')
    const protectedIds = this.checkCurvedEdit(result.net, constraint)
    // Initial publication reports the proposal's protections; later evaluation
    // reports the accepted double ring. Both must be certified by the kernel.
    const proposalProtected = result.net.poles.filter((_, i) => !this.curvedProposalEditable(result.net, constraint.choice, constraint.lockedPoles, i)).length
    const count = result.validation?.protectedPoleCount
    if (count !== protectedIds.length && count !== proposalProtected) throw new Error('Protezioni della tangenza curva non valide.')
    this.checkCurvedProof(result, constraint, count)
  }
  private freezeCurvedTangency(constraint?: SurfaceCurvedTangency): void {
    if (!constraint) return
    freezeNet(constraint.baseNet); freezeNet(constraint.referenceNet)
    Object.freeze(constraint.lockedPoles)
    Object.freeze(constraint.choice.stamp); Object.freeze(constraint.choice); Object.freeze(constraint)
  }
  private samePlaneChoice(a: G1SupportCandidate, b?: G1SupportCandidate): boolean {
    return !!b && a.id === b.id && a.side === b.side && a.edgeIndex === b.edgeIndex &&
      a.supportFaceIndex === b.supportFaceIndex && JSON.stringify(a.stamp) === JSON.stringify(b.stamp)
  }
  private checkPlaneResult(result: G1PlaneResult, constraint: Omit<SurfacePlaneTangency, 'constraintId' | 'referenceNet'>, expected?: Net): void {
    if (!result || !this.samePlaneChoice(constraint.choice, result.choice) ||
        JSON.stringify(result.stamp) !== JSON.stringify(constraint.choice.stamp) ||
        result.preview?.valid !== true || !result.preview.mesh || !Array.isArray(result.preview.faceMeshes) ||
        result.preview.previewRevision !== undefined || result.validation?.globalG1Certified !== false ||
        result.validation.edgeRegularity !== 'outward-rounded-interval-proof' ||
        (expected && JSON.stringify(result.net) !== JSON.stringify(expected)))
      throw new Error('Risultato CAD della tangenza non valido.')
    const edge = ({ uMin: 'U0', uMax: 'U1', vMin: 'V0', vMax: 'V1' } as const)[constraint.choice.side]
    const request: PlaneTangencyRequest = { net: constraint.baseNet, edge,
      plane: { point: constraint.choice.plane.origin, normal: constraint.choice.plane.normal },
      lockIndices: constraint.lockedPoles, distanceTolerance: constraint.distanceTolerance,
      preserveTangentEdges: (['U0', 'U1', 'V0', 'V1'] as NaturalEdge[]).filter(e => e !== edge) }
    validatePlaneTangencyResult(request, result.net)
  }
  private planeRequest(constraint: Omit<SurfacePlaneTangency, 'constraintId' | 'referenceNet'>): PlaneTangencyRequest {
    const edge = ({ uMin: 'U0', uMax: 'U1', vMin: 'V0', vMax: 'V1' } as const)[constraint.choice.side]
    return { net: constraint.baseNet, edge,
      plane: { point: constraint.choice.plane.origin, normal: constraint.choice.plane.normal },
      lockIndices: constraint.lockedPoles, distanceTolerance: constraint.distanceTolerance,
      preserveTangentEdges: (['U0', 'U1', 'V0', 'V1'] as NaturalEdge[]).filter(e => e !== edge) }
  }
  private checkPlaneEdit(net: Net, constraint: SurfacePlaneTangency): void {
    assertNet(constraint.referenceNet, net, 'G1')
    for (const i of net.poles.flatMap((_, i) => boundaryLocked(net, i, 'G1') || constraint.lockedPoles.includes(i) ? [i] : [])) {
      if (net.poles[i].some((x,d) => !Object.is(x, constraint.referenceNet.poles[i][d])))
        throw new Error('Un punto protetto dal vincolo G1 è stato modificato.')
    }
    validatePlaneTangencyConstraint(this.planeRequest(constraint), net)
  }
  private checkPublishedPlaneResult(result: G1PublishedPlaneResult, constraint: SurfacePlaneTangency, expected: Net): void {
    if (!result || !Number.isSafeInteger(result.constraintId) || result.constraintId < 1 ||
        result.constraintId !== constraint.constraintId || !this.samePlaneChoice(constraint.choice, result.choice) ||
        JSON.stringify(result.stamp) !== JSON.stringify(constraint.choice.stamp) || result.preview?.valid !== true ||
        !result.preview.mesh || !Array.isArray(result.preview.faceMeshes) ||
        !Number.isSafeInteger(result.preview.previewRevision) || result.preview.previewRevision < 1 ||
        result.validation?.globalG1Certified !== false || result.validation.edgeRegularity !== 'outward-rounded-interval-proof' ||
        JSON.stringify(result.net) !== JSON.stringify(expected))
      throw new Error('Risultato CAD pubblicato della tangenza non valido.')
    this.checkPlaneEdit(result.net, constraint)
  }
  private freezePlaneTangency(constraint?: SurfacePlaneTangency): void {
    if (!constraint) return
    freezeNet(constraint.baseNet)
    freezeNet(constraint.referenceNet)
    Object.freeze(constraint.lockedPoles)
    Object.freeze(constraint.choice.stamp)
    Object.freeze(constraint.choice.plane.origin)
    Object.freeze(constraint.choice.plane.normal)
    Object.freeze(constraint.choice.plane)
    Object.freeze(constraint.choice)
    Object.freeze(constraint)
  }
  private freezePreparation(preparation?: SurfacePreparation): void {
    if (!preparation) return
    freezeNet(preparation.originalNet)
    if (preparation.adaptiveSelection) {
      for (const insertion of preparation.adaptiveSelection.refinements) Object.freeze(insertion)
      Object.freeze(preparation.adaptiveSelection.refinements)
      Object.freeze(preparation.adaptiveSelection.trimLocks)
      Object.freeze(preparation.adaptiveSelection.hiddenPoles)
      Object.freeze(preparation.adaptiveSelection)
    }
    for (const insertion of preparation.refinements) Object.freeze(insertion)
    Object.freeze(preparation.refinements)
    Object.freeze(preparation.trimLocks)
    Object.freeze(preparation.hiddenPoles)
    Object.freeze(preparation)
  }
  private update(change: Partial<SurfaceDraftSnapshot>): void {
    if (Object.keys(change).every(key =>
      Object.is(this.snapshot[key as keyof SurfaceDraftSnapshot], change[key as keyof SurfaceDraftSnapshot]))) return
    this.snapshot = Object.freeze({ ...this.snapshot, ...change })
    for (const listener of this.listeners) listener()
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
import { assertNet, boundaryLocked, type Net } from './brep'
import type { Preview, G1PlaneResult, G1PublishedPlaneResult } from './editorKernel'
import type { EditFrame, SurfacePreparation, SurfacePlaneTangency } from './surfaceHistory'
import type { PreviewDraft, SurfaceRuntime } from './surfaceRuntime'
import { PreviewQueue } from './previewQueue'
import { assertSmoothCylinderMove, canonicalizeCylinderGesture } from './periodic'
import type { Mesh } from 'occt-wasm'
import { refineClampedNet, type KnotInsertion } from './refineClampedNet'
import type { G1SupportCandidate } from './g1SupportTopology'
import { validatePlaneTangencyResult, validatePlaneTangencyConstraint, type PlaneTangencyRequest, type NaturalEdge } from './planeTangency'

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
  if (ids.some(i => !Number.isInteger(i) || i < 0 || i >= count))
    throw new Error('Indice del punto non valido.')
  return Object.freeze([...new Set(ids)])
}
function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
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
    hiddenPoles: EMPTY, refinements: NO_REFINEMENTS, planeTangency: null, freeBoundary: false, preview: null, previewStale: false, validNet: null,
    calculating: false, error: '', canUndo: false, canRedo: false,
  })
  private base: Net | null = null
  /** Queue identity may be an equivalent frozen draft before history cloned it. */
  private queueNet: Net | null = null
  private epoch = 0
  private exported: { epoch: number; queueRevision: number; value: Preview } | null = null
  private disposed = false
  private refining = false
  private proposingPlaneTangency = false
  private publishingPlaneTangency = false
  private planePublished: { epoch: number; net: Net; constraint: SurfacePlaneTangency; value: G1PublishedPlaneResult } | null = null
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
    this.unsubscribeCylinder = this.cylinderPreviews.subscribe(this.syncPreview)
  }

  getSnapshot = (): SurfaceDraftSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Install a worker-selected CAD net. No project or worker selection is performed. */
  install(net: Net, options: { continuity?: 'G0' | 'G1'; trimLocks?: readonly number[]; hiddenPoles?: readonly number[];
    cylinderSession?: number; face?: number; refinements?: readonly KnotInsertion[]; originalNet?: Net } = {}): void {
    this.ensureActive()
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
    const base = freezeNet(structuredClone(options.originalNet ?? net))
    if (cylinderSession !== null) assertSmoothCylinderMove(base, net)
    else assertNet(base, net, continuity, true)
    const preparation: SurfacePreparation | undefined = options.face === undefined ? undefined : {
      face: options.face, refinements: structuredClone(options.refinements ?? []) as KnotInsertion[],
      originalNet: base, trimLocks: [...trimLocks], hiddenPoles: [...hiddenPoles],
    }
    this.invalidate()
    this.runtime.history.reset()
    this.base = base
    this.queueNet = null
    const frame = this.runtime.history.commit({ net, locks: [], continuity, freeBoundary: false, preparation })
    freezeNet(frame.net)
    this.freezePreparation(frame.preparation)
    this.base = frame.preparation?.originalNet ?? base
    this.update({ cylinderSession, cylinderPreview: null, net: frame.net, committedNet: frame.net, originalNet: this.base, selected: EMPTY, locks: EMPTY, trimLocks,
      hiddenPoles, refinements: frame.preparation?.refinements ?? NO_REFINEMENTS, planeTangency: null,
      continuity, freeBoundary: false, preview: null, previewStale: false,
      validNet: null, calculating: false, error: '', canUndo: false, canRedo: false })
    this.schedule(frame.net)
  }

  /** Install only the net returned by prepareCylinder in this runtime's worker. */
  installCylinder(net: Net, session: number): void {
    this.install(net, { continuity: 'G1', cylinderSession: session })
  }

  /** Exact knot insertion preserves the deformed surface and creates one undo step. */
  async refine(insertions: readonly KnotInsertion[]): Promise<void> {
    this.ensureActive()
    this.ensureNoPlaneTangency()
    const before = this.snapshot, previous = this.runtime.history.current, preparation = previous?.preparation
    if (!preparation || before.cylinderSession !== null) throw new Error('Preparazione della faccia non disponibile.')
    if (!insertions.length) return
    if (before.locks.length) throw new Error('Rimuovi i blocchi manuali prima di raffinare il reticolo.')
    if (before.net !== before.committedNet || before.validNet !== before.net || before.calculating)
      throw new Error('Attendi la verifica CAD e termina il trascinamento prima di raffinare.')
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

  /** Propose read-only, then publish the verified CAD face and its real note witness.
   * While publishing, mutations wait so the accepted reply cannot overwrite a newer draft. */
  async applyPlaneTangency(choice: G1SupportCandidate, options: { distanceTolerance?: number } = {}): Promise<void> {
    this.ensureActive()
    this.ensureNoPlaneTangency()
    const before = this.snapshot, previous = this.runtime.history.current
    const preparation = previous?.preparation
    if (this.proposingPlaneTangency) throw new Error('Attendi la verifica della tangenza.')
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

  /** Reevaluate the actual G1 net and STEP, then adopt the returned real note witness. */
  async evaluatePlaneTangencyForExport(): Promise<G1PublishedPlaneResult & { step: string }> {
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
    this.ensureActive()
    const continuity = options.preserveContinuity ? this.snapshot.continuity : 'G1'
    this.invalidate()
    this.runtime.history.reset()
    this.base = null
    this.queueNet = null
    this.update({ cylinderSession: null, cylinderPreview: null, net: null, committedNet: null, originalNet: null, selected: EMPTY, locks: EMPTY, trimLocks: EMPTY,
      hiddenPoles: EMPTY, refinements: NO_REFINEMENTS, planeTangency: null, continuity, freeBoundary: false, preview: null, previewStale: false,
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
      planeTangency: this.runtime.history.current?.planeTangency })
    this.applyFrame(frame, equivalentToShown)
  }

  /** Restore the source surface even when points have since been manually locked. */
  restoreOriginal(): void {
    this.ensureActive()
    this.ensureNoPlaneTangency()
    if (!this.base) throw new Error('Scegli prima una faccia CAD.')
    const frame = this.runtime.history.commit({ net: this.base, locks: [...this.snapshot.locks],
      continuity: this.snapshot.continuity, freeBoundary: this.snapshot.freeBoundary, preparation: this.runtime.history.current?.preparation,
      planeTangency: this.runtime.history.current?.planeTangency })
    this.applyFrame(frame, this.base === this.snapshot.net)
  }

  /**
   * Export evaluates again inside the same worker and changes its face revision.
   * Adopt that verified preview only if geometry and queue have not changed.
   */
  async evaluateForExport(): Promise<Preview & { step: string; previewRevision: number }> {
    this.ensureActive()
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
    const result = await this.runtime.worker.ask<Preview & { step: string; previewRevision: number }>({
      action: 'evaluate', net, continuity: snapshot.continuity, freeBoundary: snapshot.freeBoundary, exportStep: true,
      ...this.selectionPayload(),
    })
    this.ensureActive()
    const next = this.snapshot, queue = this.runtime.previews.getSnapshot()
    if (epoch !== this.epoch || next.net !== net || next.validNet !== net || next.calculating ||
        next.continuity !== snapshot.continuity || next.freeBoundary !== snapshot.freeBoundary ||
        queue.current?.revision !== current.revision || queue.validRevision !== current.revision ||
        result.valid !== true || !Number.isInteger(result.previewRevision) || typeof result.step !== 'string')
      throw new Error('La bozza è cambiata durante la valutazione STEP.')
    this.exported = { epoch, queueRevision: current.revision, value: result }
    this.update({ preview: result, previewStale: false })
    return result
  }

  /** Full experimental cylinder evaluation, kept separate from normal Apply. */
  async evaluateCylinderForExport(): Promise<{ mesh: Mesh; step: string; previewRevision:number }> {
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
    const constraint = this.snapshot.planeTangency
    if (constraint) {
      if (locks.some(i => !constraint.lockedPoles.includes(i) && !boundaryLocked(net, i, 'G1')))
        throw new Error('Nuovi blocchi interni richiedono una nuova verifica del vincolo G1.')
      const fixedManual = constraint.lockedPoles.filter(i => !this.snapshot.trimLocks.includes(i) && !this.snapshot.hiddenPoles.includes(i))
      if (fixedManual.some(i => !locks.includes(i))) throw new Error('I blocchi iniziali restano protetti fino ad Annulla tangenza.')
    }
    const frame = this.runtime.history.commit({ net, locks: [...locks],
      continuity: this.snapshot.continuity, freeBoundary: this.snapshot.freeBoundary, preparation: this.runtime.history.current?.preparation,
      planeTangency: this.runtime.history.current?.planeTangency })
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
    this.planePreviews.dispose()
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
      hiddenPoles: EMPTY, refinements: NO_REFINEMENTS, planeTangency: null, error: '', canUndo: false, canRedo: false })
    this.listeners.clear()
  }

  private ensureActive(): void {
    if (this.disposed || !this.runtime.active) throw new Error('Editor chiuso.')
    if (this.refining) throw new Error('Attendi il raffinamento del reticolo.')
    if (this.publishingPlaneTangency) throw new Error('Attendi la pubblicazione della tangenza.')
  }
  private requireNet(): Net {
    if (!this.snapshot.net) throw new Error('Scegli prima una faccia CAD.')
    return this.snapshot.net
  }
  private invalidate(): void {
    this.exported = null
    this.planePublished = null
    this.epoch++
    this.runtime.previews.invalidate({ clearPreview: true })
    this.cylinderPreviews.invalidate({ clearPreview: true })
    this.planePreviews.invalidate({ clearPreview: true })
  }
  private recoverPlaneWitness(before: SurfaceDraftSnapshot): void {
    if (this.disposed || !this.runtime.active || !before.net || this.snapshot.net !== before.net ||
        this.snapshot.planeTangency !== before.planeTangency || this.snapshot.validNet !== before.net) return
    this.invalidate()
    this.update({ preview: null, previewStale: false, validNet: null, calculating: true, error: '' })
    this.schedule(before.net)
  }
  private ensureNoPlaneTangency(): void {
    if (this.snapshot.planeTangency) throw new Error('Annulla la tangenza prima di questa operazione.')
  }
  private checkEdit(candidate: Net): Net {
    const constraint = this.snapshot.planeTangency
    if (constraint) this.checkPlaneEdit(candidate, constraint)
    const base = this.base, frame = this.runtime.history.current
    if (!base || !frame) throw new Error('Scegli prima una faccia CAD.')
    if (this.snapshot.cylinderSession !== null) {
      candidate = canonicalizeCylinderGesture(frame.net, candidate)
      assertSmoothCylinderMove(base, candidate)
    } else if (!constraint) assertNet(base, candidate, this.snapshot.continuity, this.snapshot.freeBoundary)
    for (const i of [...this.snapshot.locks, ...this.snapshot.trimLocks]) {
      if (candidate.poles[i].some((value, axis) => value !== frame.net.poles[i][axis]))
        throw new Error('Un punto bloccato è stato modificato.')
    }
    return candidate
  }
  private step(delta: -1 | 1): boolean {
    this.ensureActive()
    const frame = this.runtime.history.step(delta)
    if (!frame) return false
    this.applyFrame(frame, false)
    return true
  }
  private applyFrame(frame: EditFrame, equivalentToShown: boolean, published?: G1PublishedPlaneResult): void {
    const previous = this.snapshot
    freezeNet(frame.net)
    this.freezePreparation(frame.preparation)
    this.freezePlaneTangency(frame.planeTangency)
    const changedPlaneTangency = previous.planeTangency !== (frame.planeTangency ?? null)
    if (changedPlaneTangency) this.invalidate()
    const changedPreparation = this.runtime.history.current?.preparation !== undefined &&
      this.base !== frame.preparation?.originalNet
    if (frame.preparation) this.base = frame.preparation.originalNet
    const sameGeometry = previous.net === frame.net || equivalentToShown
    const sameMode = previous.continuity === frame.continuity && previous.freeBoundary === frame.freeBoundary
    const requiresPreview = !sameGeometry || !sameMode || changedPreparation || changedPlaneTangency
    const locks = Object.freeze([...frame.locks])
    this.update({ net: frame.net, committedNet: frame.net, locks, planeTangency: frame.planeTangency ?? null, continuity: frame.continuity, freeBoundary: frame.freeBoundary,
      ...(frame.preparation ? { originalNet: frame.preparation.originalNet,
        trimLocks: frame.preparation.trimLocks, hiddenPoles: frame.preparation.hiddenPoles,
        refinements: frame.preparation.refinements } : {}),
      ...(changedPreparation ? { selected: EMPTY } : {}),
      ...(changedPlaneTangency ? { preview: null, previewStale: false } : {}),
      validNet: requiresPreview ? null : previous.validNet ? frame.net : null,
      calculating: requiresPreview ? true : previous.calculating,
      error: requiresPreview ? '' : previous.error,
      canUndo: this.runtime.history.canUndo, canRedo: this.runtime.history.canRedo })
    if (published && frame.planeTangency) {
      this.planePublished = { epoch: this.epoch, net: frame.net, constraint: frame.planeTangency, value: published }
      this.update({ preview: published.preview, previewStale: false, validNet: frame.net, calculating: false, error: '' })
    } else if (requiresPreview) this.schedule(frame.net)
    else {
      if (this.planePublished?.net === previous.net) this.planePublished.net = frame.net
      this.syncPreview()
    }
  }
  private schedule(net: Net): void {
    this.exported = null
    this.planePublished = null
    this.queueNet = net
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
      ...this.selectionPayload(),
    })
    if (revision === null) this.update({ validNet: null, calculating: false, error: 'Anteprima CAD non disponibile.' })
  }
  private syncPreview = (): void => {
    if (this.disposed) return
    if (this.refining) return
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
      job.continuity === this.snapshot.continuity && job.freeBoundary === this.snapshot.freeBoundary
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

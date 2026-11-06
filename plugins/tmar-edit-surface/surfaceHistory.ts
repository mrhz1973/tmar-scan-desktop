// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import type { KnotInsertion } from './refineClampedNet'
import type { G1SupportCandidate } from './g1SupportTopology'
import type { CompatibleCurvedSupportCandidate } from './compatibleCurvedSupportTopology'
import { updateAdaptiveLocks, validateAdaptiveLocks, type AdaptiveLocks } from './adaptiveLockSnapshot'

export interface SurfaceCurvedTangency {
  kind: 'compatible-bspline'
  constraintId: number
  referenceNet: Net
  baseNet: Net
  choice: CompatibleCurvedSupportCandidate
  lockedPoles: number[]
  scale: number
  distanceTolerance: number
  derivativeTolerance: number
  faceCount: number
}

function sameExact(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false
  const keys = Object.keys(a), other = Object.keys(b)
  return keys.length === other.length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) &&
    sameExact((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

/** Exact proposal base and immutable constraint; never a legacy G1 border mode. */
export interface SurfacePlaneTangency {
  constraintId: number
  /** Accepted proposal; double border and initial locks are fixed to this net. */
  referenceNet: Net
  baseNet: Net
  choice: G1SupportCandidate
  lockedPoles: number[]
  distanceTolerance: number
}

/** Worker selection and index-dependent protections belonging to one net layout. */
export interface SurfacePreparation {
  face: number
  refinements: KnotInsertion[]
  originalNet: Net
  trimLocks: number[]
  hiddenPoles: number[]
}

/** One committed state of the editable surface, independent of its panel. */
export interface EditFrame {
  net: Net
  locks: number[]
  /** Present only for the opt-in adaptive lock-at-position contract. */
  lockSnapshots?: AdaptiveLocks
  continuity: 'G0' | 'G1'
  freeBoundary: boolean
  preparation?: SurfacePreparation
  planeTangency?: SurfacePlaneTangency
  curvedTangency?: SurfaceCurvedTangency
}

/** Local geometry/protection history. Strip editing retains its own history. */
export class SurfaceHistory {
  private frames: EditFrame[] = []
  private cursor = -1
  constructor(private readonly limit = 60) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Limite cronologia non valido.')
  }
  get current(): EditFrame | undefined { return this.frames[this.cursor] }
  get canUndo(): boolean { return this.cursor > 0 }
  get canRedo(): boolean { return this.cursor >= 0 && this.cursor < this.frames.length - 1 }

  reset(): void { this.frames = []; this.cursor = -1 }

  commit(frame: EditFrame): EditFrame {
    if (frame.planeTangency && frame.curvedTangency) throw new Error('Vincoli di tangenza incompatibili nella stessa bozza.')
    const previous = this.current
    // Reuse an unchanged net: changing locks alone must not trigger CAD evaluation.
    const net = previous && (previous.curvedTangency || frame.curvedTangency
      ? sameExact(previous.net, frame.net) : JSON.stringify(previous.net) === JSON.stringify(frame.net))
      ? previous.net : structuredClone(frame.net)
    const samePreparation = previous?.preparation === frame.preparation ||
      JSON.stringify(previous?.preparation) === JSON.stringify(frame.preparation)
    const samePlaneTangency = previous?.planeTangency === frame.planeTangency ||
      JSON.stringify(previous?.planeTangency) === JSON.stringify(frame.planeTangency)
    const sameCurvedTangency = sameExact(previous?.curvedTangency, frame.curvedTangency)
    if (previous?.lockSnapshots !== undefined && !samePreparation)
      throw new Error('La preparazione adattiva non può cambiare senza rimappare esplicitamente i blocchi.')
    const priorLocks = samePreparation ? previous?.lockSnapshots : undefined
    let lockSnapshots: AdaptiveLocks | undefined
    if (frame.lockSnapshots !== undefined || priorLocks !== undefined) {
      lockSnapshots = updateAdaptiveLocks(net, priorLocks ?? [], frame.locks)
      if (frame.lockSnapshots !== undefined) {
        validateAdaptiveLocks(net, frame.lockSnapshots)
        if (!sameExact(lockSnapshots, frame.lockSnapshots)) throw new Error('Riferimenti dei punti bloccati non coerenti.')
      }
    }
    const next: EditFrame = {
      net, locks: [...new Set(frame.locks)].sort((a, b) => a - b),
      continuity: frame.continuity, freeBoundary: frame.freeBoundary,
      ...(frame.planeTangency ? { planeTangency: previous?.planeTangency && samePlaneTangency
        ? previous.planeTangency : structuredClone(frame.planeTangency) } : {}),
      ...(frame.curvedTangency ? { curvedTangency: previous?.curvedTangency && sameCurvedTangency
        ? previous.curvedTangency : structuredClone(frame.curvedTangency) } : {}),
      ...(frame.preparation ? { preparation: previous?.preparation && samePreparation
        ? previous.preparation : structuredClone(frame.preparation) } : {}),
      ...(lockSnapshots !== undefined ? { lockSnapshots } : {}),
    }
    if (!previous || previous.net !== next.net || JSON.stringify(previous.locks) !== JSON.stringify(next.locks) ||
        previous.continuity !== next.continuity || previous.freeBoundary !== next.freeBoundary ||
        !samePreparation || !samePlaneTangency || !sameCurvedTangency || !sameExact(previous.lockSnapshots,next.lockSnapshots)) {
      this.frames = this.frames.slice(0, this.cursor + 1)
      this.frames.push(next)
      if (this.frames.length > this.limit) this.frames.shift()
      this.cursor = this.frames.length - 1
    }
    return next
  }

  step(delta: number): EditFrame | null {
    if (delta !== -1 && delta !== 1) return null
    const next = this.cursor + delta
    if (next < 0 || next >= this.frames.length) return null
    this.cursor = next
    return this.frames[next]
  }
}

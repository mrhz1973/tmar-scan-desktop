// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import type { DragFrame } from './dragFrame'

/** CSS-pixel threshold: merely clicking or moving less than this does not edit. */
export const SURFACE_DRAG_THRESHOLD_PX = 4

export interface SurfacePointer {
  readonly pointerId: number
  readonly clientX: number
  readonly clientY: number
  readonly altKey?: boolean
  /** False disables the optional resolver for this event, as does Alt. */
  readonly snapEnabled?: boolean
}

/** A null result means no snap target: retain the raw, scaled delta. */
export type SurfaceDeltaResolver = (delta: Readonly<Point>, pointer: Readonly<SurfacePointer>) => Point | null

export type SurfaceGestureResult =
  | { readonly kind: 'ignored' | 'unchanged' | 'invalid' }
  | { readonly kind: 'preview' | 'commit'; readonly poles: Point[]; readonly delta: Point }
  | { readonly kind: 'restore'; readonly poles: Point[] }

export interface SurfaceGesture {
  move(pointer: SurfacePointer): SurfaceGestureResult
  up(pointer: SurfacePointer): SurfaceGestureResult
  /** With no argument, cancel the captured gesture (e.g. Escape). */
  cancel(pointerId?: number): SurfaceGestureResult
  /** Defensive copy, in part-frame mm; null until a valid drag sample. */
  lastDelta(): Point | null
}

export interface SurfaceGestureInput {
  readonly frame: DragFrame
  readonly poles: readonly Point[]
  /** Caller supplies only editable, unlocked poles. Duplicates are ignored. */
  readonly selected: readonly number[]
  readonly start: SurfacePointer
  readonly strength: number
  readonly resolveDelta?: SurfaceDeltaResolver
}

const finitePoint = (p: readonly number[]): p is Point => p.length === 3 && p.every(Number.isFinite)
const copyPoint = (p: readonly number[]): Point => [p[0], p[1], p[2]]
const validPointer = (p: SurfacePointer) => Number.isInteger(p.pointerId) && Number.isFinite(p.clientX) && Number.isFinite(p.clientY)
const ignored = (): SurfaceGestureResult => ({ kind: 'ignored' })

/** One gesture, independent of renderer and host. The caller is responsible for
 * pointer capture/release, invalidating stale CAD work, and applying outcomes. */
export function createSurfaceGesture(input: SurfaceGestureInput): SurfaceGesture | null {
  if (!validPointer(input.start) || !Number.isFinite(input.strength) || input.strength < 0 ||
      !input.poles.length || !input.poles.every(finitePoint) || !input.selected.length ||
      input.selected.some(i => !Number.isInteger(i) || i < 0 || i >= input.poles.length)) return null
  const initial = input.poles.map(copyPoint)
  const selected = [...new Set(input.selected)]
  const pointerId = input.start.pointerId, startX = input.start.clientX, startY = input.start.clientY
  const strength = input.strength, frame = input.frame, resolveDelta = input.resolveDelta
  let started = false, previewed = false, ended = false, last: Point | null = null

  const hasCrossedThreshold = (p: SurfacePointer) =>
    Math.hypot(p.clientX - startX, p.clientY - startY) >= SURFACE_DRAG_THRESHOLD_PX
  const updatedPoles = (delta: Point): Point[] | null => {
    const next = initial.map(copyPoint)
    for (const i of selected) next[i] = [initial[i][0] + delta[0], initial[i][1] + delta[1], initial[i][2] + delta[2]]
    return next.every(finitePoint) ? next : null
  }
  const sample = (p: SurfacePointer): Point | null => {
    if (!validPointer(p)) return null
    let raw: Point | null
    try { raw = frame.deltaAt(p.clientX, p.clientY) } catch { return null }
    if (!raw || !finitePoint(raw)) return null
    const delta: Point = [raw[0] * strength, raw[1] * strength, raw[2] * strength]
    if (!finitePoint(delta)) return null
    if (!resolveDelta || p.altKey || p.snapEnabled === false) return delta
    try {
      // Do not let a resolver accidentally mutate stored input or delta state.
      const resolved = resolveDelta(copyPoint(delta), { ...p })
      if (resolved === null) return delta
      return finitePoint(resolved) ? copyPoint(resolved) : null
    } catch {
      return null
    }
  }
  const fromLast = (): SurfaceGestureResult => {
    if (!last || Math.hypot(...last) <= 1e-12) {
      return previewed ? { kind: 'restore', poles: initial.map(copyPoint) } : { kind: 'unchanged' }
    }
    const poles = updatedPoles(last)
    return poles ? { kind: 'commit', poles, delta: copyPoint(last) } : { kind: 'invalid' }
  }
  return {
    move(p) {
      if (ended || p.pointerId !== pointerId) return ignored()
      if (!validPointer(p)) return { kind: 'invalid' }
      if (!started && !hasCrossedThreshold(p)) return ignored()
      started = true
      const delta = sample(p), poles = delta ? updatedPoles(delta) : null
      if (!delta || !poles) return { kind: 'invalid' }
      last = copyPoint(delta); previewed = true
      return { kind: 'preview', poles, delta: copyPoint(delta) }
    },
    up(p) {
      if (ended || p.pointerId !== pointerId) return ignored()
      // A captured release is terminal even if its coordinates are unusable.
      const valid = validPointer(p)
      if (!started && (!valid || !hasCrossedThreshold(p))) { ended = true; return { kind: 'unchanged' } }
      started = true
      if (valid) {
        const delta = sample(p)
        if (delta && updatedPoles(delta)) last = copyPoint(delta)
      }
      ended = true
      return fromLast()
    },
    cancel(id) {
      if (ended || (id !== undefined && id !== pointerId)) return ignored()
      ended = true
      return previewed ? { kind: 'restore', poles: initial.map(copyPoint) } : { kind: 'unchanged' }
    },
    lastDelta() { return last ? copyPoint(last) : null },
  }
}

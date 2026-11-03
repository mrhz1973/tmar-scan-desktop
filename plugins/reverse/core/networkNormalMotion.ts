// SPDX-License-Identifier: AGPL-3.0-only
// Pure foundation, not a registered Patch Network mode. No scan/store/CAD mutation.
// Keep the on-scan anchor separate from the deliberate part-space offset. The
// caller must apply the offset AFTER scan topology/mapping, before coupled fitting.
export type NormalVec3 = readonly [number, number, number]
export type NormalVec2 = readonly [number, number]
export interface CentreOffset {
  readonly version: 1
  readonly units: 'mm'
  readonly coordinateFrame: 'part'
  readonly anchor: NormalVec3
  readonly direction: NormalVec3
  readonly distance: number
}
export interface PartRay { readonly origin: NormalVec3; readonly direction: NormalVec3 }
export interface NormalPointer {
  readonly pointerId: number
  readonly screen: NormalVec2 // CSS pixels, not framebuffer pixels.
  readonly ray: PartRay // Already transformed from world into the part frame.
  readonly viewKey: string // Changes on camera/projection/viewport/frame changes.
}
export interface CentreNormalDrag {
  readonly before: CentreOffset
  readonly start: NormalPointer
  readonly startAxisParameter: number
  readonly activated: boolean
  readonly thresholdPx: number
  readonly maxAbsDistance: number
}
export type NormalDragSample =
  | { readonly kind: 'ignored' | 'idle'; readonly drag: CentreNormalDrag }
  | { readonly kind: 'rejected'; readonly reason: string; readonly drag: CentreNormalDrag }
  | { readonly kind: 'moved'; readonly drag: CentreNormalDrag; readonly offset: CentreOffset; readonly point: NormalVec3 }

const finite = (n: number, what: string): number => {
  if (!Number.isFinite(n)) throw new Error(`${what} must be finite.`)
  return n
}
const vector = (p: readonly number[], what: string): NormalVec3 => {
  if (p.length !== 3 || !p.every(Number.isFinite)) throw new Error(`${what} must have three finite coordinates.`)
  return Object.freeze([p[0], p[1], p[2]]) as NormalVec3
}
const unit = (p: NormalVec3): NormalVec3 => {
  vector(p, 'Direction')
  const length = Math.hypot(...p)
  if (!(length > 1e-12) || !Number.isFinite(length)) throw new Error('Direction is degenerate.')
  return vector(p.map(x => x / length), 'Unit direction')
}
const dot = (a: NormalVec3, b: NormalVec3) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
const subtract = (a: NormalVec3, b: NormalVec3): NormalVec3 => vector(a.map((x, i) => x-b[i]), 'Difference')

export function createCentreOffset(anchor: NormalVec3, direction: NormalVec3, distance = 0): CentreOffset {
  const value: CentreOffset = Object.freeze({ version: 1, units: 'mm', coordinateFrame: 'part',
    anchor: vector(anchor, 'Anchor'), direction: unit(direction), distance: finite(distance, 'Distance') })
  centreOffsetPoint(value) // Reject finite inputs whose result overflows.
  return value
}
export function centreOffsetPoint(offset: CentreOffset): NormalVec3 {
  return vector(offset.anchor.map((x, i) => x + offset.direction[i]*offset.distance), 'Offset point')
}
export function setCentreOffsetDistance(offset: CentreOffset, distance: number): CentreOffset {
  const value = Object.freeze({ ...offset, distance: finite(distance, 'Distance') })
  centreOffsetPoint(value)
  return value
}
/** Deliberate tangential re-anchoring keeps height. Reset-to-scan is a separate action. */
export function reanchorCentreOffset(offset: CentreOffset, anchor: NormalVec3, normal: NormalVec3): CentreOffset {
  return createCentreOffset(anchor, normal, offset.distance)
}
/** Strict versioned persistence parser. Not wired into the project's schema yet. */
export function readCentreOffset(raw: unknown): CentreOffset {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid centre offset.')
  const r = raw as Record<string, unknown>
  const keys = ['version', 'units', 'coordinateFrame', 'anchor', 'direction', 'distance']
  if (Object.keys(r).length !== keys.length || Object.keys(r).some(k => !keys.includes(k)) ||
      r.version !== 1 || r.units !== 'mm' || r.coordinateFrame !== 'part' ||
      !Array.isArray(r.anchor) || !Array.isArray(r.direction) || typeof r.distance !== 'number')
    throw new Error('Unsupported or incomplete centre-offset schema.')
  const anchor = vector(r.anchor, 'Anchor'), direction = vector(r.direction, 'Direction')
  if (Math.abs(Math.hypot(...direction)-1) > 1e-12) throw new Error('Stored direction must be unit length.')
  const offset: CentreOffset = Object.freeze({ version: 1, units: 'mm', coordinateFrame: 'part', anchor, direction, distance: finite(r.distance, 'Distance') })
  centreOffsetPoint(offset)
  return offset
}

/** Closest approach of a part-space pointer ray to the fixed normal line.
 * Works with orthographic or perspective rays, without moving the camera.
 * Near-parallel sight lines are refused: use a numeric distance or rotate view. */
export function normalAxisParameter(offset: CentreOffset, ray: PartRay): number {
  const origin = vector(ray.origin, 'Ray origin'), d = unit(ray.direction), n = offset.direction
  const a = dot(n, d), denominator = 1 - a*a
  if (!(denominator >= 1e-4)) throw new Error('Normal axis is too close to the viewing direction; rotate the view or enter a distance.')
  const w = subtract(offset.anchor, origin)
  return finite((a*dot(d, w)-dot(n, w))/denominator, 'Axis parameter')
}
function ownPointer(pointer: NormalPointer): NormalPointer {
  if (!Number.isSafeInteger(pointer.pointerId) || pointer.pointerId < 0 || !pointer.viewKey ||
      pointer.screen.length !== 2 || !pointer.screen.every(Number.isFinite)) throw new Error('Invalid pointer sample.')
  return Object.freeze({ pointerId: pointer.pointerId, viewKey: pointer.viewKey,
    screen: Object.freeze([...pointer.screen]) as NormalVec2,
    ray: Object.freeze({ origin: vector(pointer.ray.origin, 'Ray origin'), direction: unit(pointer.ray.direction) }) })
}
export function beginCentreNormalDrag(before: CentreOffset, pointer: NormalPointer,
  options: { maxAbsDistance: number; thresholdPx?: number }): CentreNormalDrag {
  const stable = readCentreOffset(before), start = ownPointer(pointer)
  const thresholdPx = finite(options.thresholdPx ?? 4, 'Drag threshold')
  const maxAbsDistance = finite(options.maxAbsDistance, 'Distance limit')
  if (thresholdPx < 0 || maxAbsDistance <= 0 || Math.abs(before.distance) > maxAbsDistance)
    throw new Error('Invalid drag threshold or distance limit.')
  return Object.freeze({ before: stable, start, startAxisParameter: normalAxisParameter(stable, start.ray),
    activated: false, thresholdPx, maxAbsDistance })
}
export function sampleCentreNormalDrag(drag: CentreNormalDrag, sample: NormalPointer): NormalDragSample {
  if (sample.pointerId !== drag.start.pointerId) return { kind: 'ignored', drag }
  if (sample.viewKey !== drag.start.viewKey) return { kind: 'rejected', reason: 'View/frame changed; cancel this gesture.', drag }
  try {
    const now = ownPointer(sample)
    if (!drag.activated && Math.hypot(now.screen[0]-drag.start.screen[0], now.screen[1]-drag.start.screen[1]) <= drag.thresholdPx)
      return { kind: 'idle', drag }
    const distance = drag.before.distance + normalAxisParameter(drag.before, now.ray) - drag.startAxisParameter
    if (!Number.isFinite(distance) || Math.abs(distance) > drag.maxAbsDistance)
      return { kind: 'rejected', reason: 'Requested distance exceeds the explicit edit limit.', drag }
    const offset = setCentreOffsetDistance(drag.before, distance)
    return { kind: 'moved', drag: drag.activated ? drag : Object.freeze({ ...drag, activated: true }), offset, point: centreOffsetPoint(offset) }
  } catch (error) {
    return { kind: 'rejected', reason: error instanceof Error ? error.message : String(error), drag }
  }
}
/** The owner restores this value on Esc/cancel; no history is committed here. */
export const cancelCentreNormalDrag = (drag: CentreNormalDrag): CentreOffset => drag.before

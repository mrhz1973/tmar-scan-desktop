// SPDX-License-Identifier: AGPL-3.0-only
// Scan anchors define topology. Explicit part-frame offsets define fitting targets.
import type { Vec3 } from '../../../src/core/types'
import type { NetworkCurve, NetworkFeature } from './features'
import type { CurvePoints, CurveTrace } from './networkCurve'
import { createCentreOffset, readCentreOffset, type CentreOffset } from './networkNormalMotion'

export type NetworkPointRef = { kind: 'node'; id: number } | { kind: 'grip'; curve: number; index: number } | { kind: 'centre'; cell: number }
export type NetworkPointMode = 'scan' | 'normal' | 'x' | 'y' | 'z'
export type PointNetwork = Pick<NetworkFeature, 'nodes' | 'curves' | 'cells'>
export const pointKey = (p: NetworkPointRef): string => p.kind === 'node' ? `node:${p.id}` : p.kind === 'grip' ? `grip:${p.curve}:${p.index}` : `centre:${p.cell}`
export function parsePointKey(key: string): NetworkPointRef | null {
  const m = /^(node|grip|centre):(\d+)(?::(\d+))?$/.exec(key)
  if (!m || !Number.isSafeInteger(Number(m[2])) || (m[3] && !Number.isSafeInteger(Number(m[3])))) return null
  if (m[1] === 'grip') return m[3] === undefined ? null : { kind: 'grip', curve: Number(m[2]), index: Number(m[3]) }
  if (m[3] !== undefined) return null
  return m[1] === 'node' ? { kind: 'node', id: Number(m[2]) } : { kind: 'centre', cell: Number(m[2]) }
}
export function pointOffset(d: PointNetwork, p: NetworkPointRef): CentreOffset | undefined {
  return p.kind === 'node' ? d.nodes.find(n => n.id === p.id)?.offset : p.kind === 'grip' ? d.curves.find(c => c.id === p.curve)?.viaOffsets?.[p.index] ?? undefined : d.cells[p.cell]?.centreOffset
}
export function pointAnchor(d: PointNetwork, p: NetworkPointRef): Vec3 | undefined {
  return p.kind === 'node' ? d.nodes.find(n => n.id === p.id)?.at : p.kind === 'grip' ? d.curves.find(c => c.id === p.curve)?.via[p.index] : d.cells[p.cell]?.centre
}
export function offsetDelta(o?: CentreOffset | null): Vec3 {
  return o ? o.direction.map(x => x * o.distance) as Vec3 : [0, 0, 0]
}
export const nonzeroOffset = (o?: CentreOffset | null): boolean => !!o && o.distance !== 0
export function displayedPoint(anchor: Vec3, o?: CentreOffset | null): Vec3 {
  const delta = offsetDelta(o)
  return anchor.map((v, i) => v + delta[i]) as Vec3
}
/** Re-encoding an arbitrary 3D delta avoids jumps when the selected axis changes. */
export function offsetFromDelta(anchor: Vec3, delta: Vec3): CentreOffset {
  if (!delta.every(Number.isFinite)) throw Error('Spostamento non finito.')
  const length = Math.hypot(...delta)
  return createCentreOffset(anchor, length > 1e-12 ? delta : [0, 0, 1], length > 1e-12 ? length : 0)
}
export function pointProtected(d: PointNetwork, p: NetworkPointRef): boolean {
  if (p.kind === 'centre') return false
  if (p.kind === 'grip') { const c = d.curves.find(c => c.id === p.curve); return !!(c?.along || c?.side) }
  return !!d.nodes.find(n => n.id === p.id)?.on || d.curves.some(c => (c.from === p.id || c.to === p.id) && !!(c.along || c.side))
}
export function assertPointOffset(o: unknown, anchor: Vec3): CentreOffset {
  const value = readCentreOffset(o)
  if (Math.hypot(...anchor.map((x, i) => x - value.anchor[i])) > 1e-7) throw Error('Ancora e spostamento del punto non corrispondono.')
  return value
}
export function validatePointOffsets(d: PointNetwork): void {
  for (const n of d.nodes) if (n.offset) {
    assertPointOffset(n.offset, n.at)
    if (nonzeroOffset(n.offset) && pointProtected(d, { kind: 'node', id: n.id })) throw Error('Un nodo vincolato al CAD non può essere spostato fuori dal vincolo.')
  }
  for (const c of d.curves) if (c.viaOffsets) {
    if (c.viaOffsets.length !== c.via.length) throw Error('Spostamenti e punti della curva hanno lunghezze diverse.')
    c.viaOffsets.forEach((o, i) => {
      if (!o) return
      assertPointOffset(o, c.via[i])
      if (nonzeroOffset(o) && (c.along || c.side)) throw Error('Una curva vincolata al CAD non può essere spostata fuori dal vincolo.')
    })
  }
}
export function curveHasOffsets(d: PointNetwork, c: NetworkCurve): boolean {
  return nonzeroOffset(d.nodes.find(n => n.id === c.from)?.offset) || nonzeroOffset(d.nodes.find(n => n.id === c.to)?.offset) || !!c.viaOffsets?.some(nonzeroOffset)
}
export function networkHasOffsets(d: PointNetwork): boolean {
  return d.nodes.some(n => nonzeroOffset(n.offset)) || d.curves.some(c => c.viaOffsets?.some(nonzeroOffset)) || d.cells.some(c => nonzeroOffset(c.centreOffset))
}
export function curvePoints(points: Float32Array): CurvePoints {
  const n = points.length / 3, at = new Float64Array(n)
  for (let i = 1; i < n; i++) at[i] = at[i - 1] + Math.hypot(points[i*3]-points[i*3-3], points[i*3+1]-points[i*3-2], points[i*3+2]-points[i*3-1])
  return { points, at, length: at[n - 1] ?? 0 }
}
export const blendDelta = (a: Vec3, b: Vec3, t: number): Vec3 => {
  const x = Math.max(0, Math.min(1, t)), w = x*x*x*(10+x*(-15+6*x))
  return a.map((v, i) => v + (b[i] - v)*w) as Vec3
}
/** Same sample indices as the scan trace; incidence/topology data are untouched. */
export function offsetTrace(trace: CurveTrace, offsets: readonly (CentreOffset | null | undefined)[]): CurvePoints | undefined {
  if (!offsets.some(nonzeroOffset)) return undefined
  if (offsets.length !== trace.grips.length) throw Error('La traccia non conserva tutti i punti della curva: spostamento rifiutato.')
  const points = trace.points.slice(), delta = offsets.map(offsetDelta)
  for (let run = 0; run + 1 < trace.grips.length; run++) {
    const a = trace.grips[run], b = trace.grips[run+1], length = trace.at[b]-trace.at[a]
    if (b <= a || !(length > 0)) throw Error('Tratto degenere: spostamento 3D rifiutato.')
    for (let j = a; j <= b; j++) {
      const shift = blendDelta(delta[run], delta[run+1], (trace.at[j]-trace.at[a])/length)
      // Assign from the original; a shared grip is never offset twice.
      for (let k = 0; k < 3; k++) points[j*3+k] = trace.points[j*3+k] + shift[k]
    }
  }
  return curvePoints(points)
}
export function sliceFitPoints(p: CurvePoints, from: number, to: number): CurvePoints {
  return curvePoints(p.points.slice(from*3, (to+1)*3))
}

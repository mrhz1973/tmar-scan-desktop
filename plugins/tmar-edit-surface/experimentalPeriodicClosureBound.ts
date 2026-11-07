// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { type Net } from './brep'
import { exclusiveFaceSurface } from './exclusiveSurface'
import { add, divide, l1, mul, scalar, sub, type I, type V } from './tangencyCoefficientIntervals'

type Homogeneous = [I, I, I, I]

function expandedU(net: Net) {
  const { du, nu, ku, mu } = net
  const period = ku.at(-1)! - ku[0], pad = du + 1 - mu[0]
  const central = ku.flatMap((knot, i) => Array<number>(mu[i]).fill(knot))
  const left = central.slice(nu - pad, nu).map(knot => knot - period)
  const right = central.slice(mu[0], mu[0] + pad).map(knot => knot + period)
  if (!(period > 0) || !Number.isFinite(period) || pad < 1 ||
      left.length !== pad || right.length !== pad ||
      !(left.at(-1)! < ku[0] && right[0] > ku.at(-1)!) ||
      [...left, ...right].some(knot => !Number.isFinite(knot)))
    throw new Error('Nodi U di estensione periodica non validi.')
  return [...left, ...central, ...right]
}

function boundary(net: Net, knots: number[], span: number, u: number): Homogeneous[] {
  const { du, nu, nv, weights, poles } = net
  const first = span - du
  // All columns share the U blend factors. Outward rounding encloses exact
  // arithmetic on the expanded binary64 knot vector.
  const blends = Array.from({ length: du }, (_, step) => {
    const r = step + 1
    return Array.from({ length: du - step }, (_, offset) => {
      const j = du - offset, lo = knots[first + j], hi = knots[first + j + du - r + 1]
      if (!(lo < hi && lo <= u && u <= hi)) throw new Error('Intervallo di valutazione U non valido.')
      if (u === lo) return [scalar(1), scalar(0)] as const
      if (u === hi) return [scalar(0), scalar(1)] as const
      const width = sub(scalar(hi), scalar(lo))
      return [divide(sub(scalar(hi), scalar(u)), width), divide(sub(scalar(u), scalar(lo)), width)] as const
    })
  })
  return Array.from({ length: nv }, (_, v) => {
    const work = Array.from({ length: du + 1 }, (_, j): Homogeneous => {
      const i = ((first + j) % nu) * nv + v
      const w = scalar(weights[i])
      return [...poles[i].map(x => mul(scalar(x), w)) as V, w]
    })
    for (const step of blends) for (const [offset, [a, b]] of step.entries()) {
      const j = du - offset
      if (b[1] === 0) work[j] = work[j - 1]
      else if (a[1] !== 0)
        work[j] = work[j].map((value, d) => add(mul(a, work[j - 1][d]), mul(b, value))) as Homogeneous
    }
    return work[du]
  })
}

function spanGap(first: Homogeneous[], last: Homogeneous[]) {
  const minA = Math.min(...first.map(h => h[3][0])), minB = Math.min(...last.map(h => h[3][0]))
  const delta = first.map((a, i) => a.map((value, d) => sub(value, last[i][d])) as Homogeneous)
  const deltaH = Math.max(...delta.map(h => l1(h.slice(0, 3) as V)))
  const deltaW = Math.max(...delta.map(h => Math.max(Math.abs(h[3][0]), Math.abs(h[3][1]))))
  const maxB = Math.max(...last.map(h => l1(h.slice(0, 3) as V)))
  // The common V basis is a nonnegative partition of unity. Each field is
  // in the hull of its active coefficients. Use
  // HA/WA - HB/WB = (HA-HB)/WA + (HB/WB)*(WB-WA)/WA.
  const correction = mul(divide(scalar(maxB), scalar(minB)), scalar(deltaW))
  return divide(add(scalar(deltaH), correction), scalar(minA))[1]
}

/** Bounds the natural U seam in the read-back coefficient model for every
 * real V in the natural V domain. The bound does not enclose OCCT D0. */
export function boundExperimentalPeriodicClosure(k: OcctKernel, face: ShapeHandle) {
  if (k.getShapeType(face) !== 'face') throw new Error('Serve una sola faccia OCCT.')
  const brep = k.toBREP(face), net = exclusiveFaceSurface(brep, brep, 1).periodicNet
  if (!net || net.periodic?.[0] !== 1 || net.periodic[1] !== 0 ||
      net.mu[0] !== net.mu.at(-1) || net.nu <= net.du ||
      net.mu.some(m => m > net.du) || net.mu.slice(0, -1).reduce((a, b) => a + b, 0) !== net.nu ||
      net.mv[0] !== net.dv + 1 || net.mv.at(-1) !== net.dv + 1 || net.nv <= net.dv ||
      net.mv.slice(1, -1).some(m => m > net.dv) || net.mv.reduce((a, b) => a + b, 0) !== net.nv + net.dv + 1 ||
      [net.ku, net.kv].some(knots => knots.some((knot, i) => i > 0 && !(knot > knots[i - 1]))))
    throw new Error('Serve un supporto B-spline periodico U, con V non periodico e clamped.')

  const knots = expandedU(net), lastSpan = net.du + net.nu - net.mu[0]
  const first = boundary(net, knots, net.du, net.ku[0])
  const last = boundary(net, knots, lastSpan, net.ku.at(-1)!)
  let start = 0, maxCoefficientModelPositionGap = 0
  for (let i = 0; i < net.kv.length - 1; i++) {
    if (i > 0) start += net.mv[i]
    const end = start + net.dv + 1
    maxCoefficientModelPositionGap = Math.max(maxCoefficientModelPositionGap,
      spanGap(first.slice(start, end), last.slice(start, end)))
  }
  return { evidenceScope: 'occt-brep-rounded-u-knot-coefficient-model' as const,
    maxCoefficientModelPositionGap, checkedVSpans: net.kv.length - 1, globalOcctClosureCertified: false as const }
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel } from 'occt-wasm'
import type { Net, Point } from './brep'
import { readFullPeriod } from './experimentalPeriodicCurveWitness'

const fail = (reason: string): never => { throw new Error(`Raffinamento periodico U rifiutato: ${reason}`) }

function everyDense<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): boolean {
  if (!Array.isArray(values)) return false
  for (let i = 0; i < values.length; i++) {
    if (!Object.hasOwn(values, i) || !predicate(values[i], i)) return false
  }
  return true
}

const equal = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && everyDense(a, (x, i) => Object.hasOwn(b, i) && x === b[i])

const validKnots = (knots: readonly number[]) =>
  knots.length >= 2 && everyDense(knots, (x, i) => Number.isFinite(x) && (i === 0 || x > knots[i - 1])) &&
  Number.isFinite(knots.at(-1)! - knots[0])

const validWeights = (weights: readonly number[]) =>
  everyDense(weights, w => Number.isFinite(w) && w > 0)

export function validateExperimentalPeriodicSurfaceU(net: Net): void {
  const { nu, nv, du, dv, ku, kv, mu, mv, poles, weights, rational, periodic } = net
  if (!periodic || !equal(periodic, [1, 0]) ||
      !Number.isInteger(du) || du < 1 || du > 25 || !Number.isInteger(dv) || dv < 1 || dv > 25 ||
      !Number.isInteger(nu) || nu < 2 || nu > 500 ||
      !Number.isInteger(nv) || nv <= dv || nv > 500 || nu * nv > 25_000 ||
      ku.length > 256 || !validKnots(ku) || ku.length !== mu.length ||
      !everyDense(mu, m => Number.isInteger(m) && m >= 1 && m <= du) || mu[0] !== mu.at(-1) ||
      mu.slice(0, -1).reduce((sum, m) => sum + m, 0) !== nu ||
      !validKnots(kv) || kv.length !== mv.length ||
      !everyDense(mv, (m, i) => i === 0 || i === mv.length - 1 ? m === dv + 1 : Number.isInteger(m) && m >= 1 && m <= dv) ||
      mv.reduce((sum, m) => sum + m, 0) !== nv + dv + 1 ||
      rational.length !== 2 || !everyDense(rational, r => r === 0 || r === 1) ||
      poles.length !== nu * nv || weights.length !== poles.length ||
      !everyDense(poles, p => Array.isArray(p) && p.length === 3 && everyDense(p, Number.isFinite)) ||
      !validWeights(weights) ||
      (!rational.some(Boolean) && weights.some(w => w !== 1)))
    fail('reticolo U periodico o V clamped non valido')
  // OCCT can read such periodic bases but change the support on insertion.
  if (nu <= du) fail('il numero di poli U deve superare il grado U')
}

/**
 * Put two nets on a common U basis by inserting interior knots in their U
 * control curves. The caller supplies the common phase and orientation.
 * Degree, interval and cut multiplicity must already agree. Each net must
 * have more U poles than its U degree. V remains local to each net. The
 * resulting coefficients are subject to OCCT rounding;
 * the operation gives no bound on geometric deviation or topology validity.
 */
export function refineExperimentalPeriodicSurfaceU(kernel: OcctKernel, left: Net, right: Net) {
  validateExperimentalPeriodicSurfaceU(left)
  validateExperimentalPeriodicSurfaceU(right)
  if (left.du !== right.du || left.ku[0] !== right.ku[0] ||
      left.ku.at(-1) !== right.ku.at(-1) || left.mu[0] !== right.mu[0])
    fail('grado, intervallo o molteplicità alla cucitura U diversa')

  const target = new Map<number, number>()
  for (const net of [left, right]) for (const [i, knot] of net.ku.entries())
    target.set(knot, Math.max(target.get(knot) ?? 0, net.mu[i]))
  const knots = [...target.keys()].sort((a, b) => a - b)
  const multiplicities = knots.map(knot => target.get(knot)!)
  const nu = multiplicities.slice(0, -1).reduce((sum, m) => sum + m, 0)
  if (knots.length > 256 || nu > 500 || nu * Math.max(left.nv, right.nv) > 25_000)
    fail('base comune oltre il limite')

  function refine(net: Net): Net {
    const source = new Map(net.ku.map((knot, i) => [knot, net.mu[i]]))
    const insertions = knots.map((knot, i) => ({ knot, count: multiplicities[i] - (source.get(knot) ?? 0) }))
      .filter(({ count }) => count > 0)
    if (!insertions.length) return structuredClone(net)

    const poles: Point[] = new Array(nu * net.nv)
    const weights: number[] = new Array(poles.length)
    for (let v = 0; v < net.nv; v++) {
      const indices = Array.from({ length: net.nu }, (_, u) => u * net.nv + v)
      const sourcePoles = indices.flatMap(i => net.poles[i])
      const sourceWeights = indices.map(i => net.weights[i])
      // OCCT discards constant curve weights. Keep that common factor per V
      // row, because neighboring rows may have different constant weights.
      const rationalCurve = sourceWeights.some(w => w !== sourceWeights[0])
      const curveWeights = rationalCurve ? sourceWeights : []
      let curve = kernel.makeBSplineEdge(sourcePoles, curveWeights, net.ku, net.mu, net.du, true)
      try {
        const before = readFullPeriod(kernel, curve)
        if (before.degree !== net.du || !equal(before.knots, net.ku) || !equal(before.multiplicities, net.mu) ||
            !equal(before.poles, sourcePoles) || !equal(before.weights, curveWeights))
          fail('coefficienti sorgente della riga U alterati dal kernel')
        for (const { knot, count } of insertions) {
          const next = kernel.curveKnotInsert(curve, knot, count)
          const previous = curve
          curve = next
          if (previous !== next) kernel.release(previous)
        }
        const after = readFullPeriod(kernel, curve)
        // OCCT may merge nearly coincident knots. Require the exact plan.
        if (after.degree !== net.du || !equal(after.knots, knots) ||
            !equal(after.multiplicities, multiplicities) || after.poles.length !== nu * 3 ||
            !everyDense(after.poles, Number.isFinite) || after.rational !== rationalCurve || !validWeights(after.weights))
          fail('la riga U non conserva la base richiesta e la rappresentazione dei pesi')
        for (let u = 0; u < nu; u++) {
          const i = u * net.nv + v, j = u * 3
          poles[i] = [after.poles[j], after.poles[j + 1], after.poles[j + 2]]
          weights[i] = rationalCurve ? after.weights[u] : sourceWeights[0]
        }
      } finally {
        kernel.release(curve)
      }
    }
    return { ...structuredClone(net), nu, poles, weights, ku: [...knots], mu: [...multiplicities] }
  }

  return { left: refine(left), right: refine(right) }
}

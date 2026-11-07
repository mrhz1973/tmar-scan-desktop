// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { add, difference, divide, dot, l1, mul, scalar, sub, vector, type I } from './tangencyCoefficientIntervals'

const fail = (reason: string): never => { throw new Error(`Regolarità fascia periodica rifiutata: ${reason}`) }
const midpoint = (a: I, b: I): I => add(mul(scalar(0.5), a), mul(scalar(0.5), b))
type Quadratic = [I, I, I]

function boundXYTangent(net: Net) {
  const { du, nu, ku, mu, nv } = net
  const period = sub(scalar(ku.at(-1)!), scalar(ku[0]))
  // Each derivative knot width is positive and at most one period because
  // the periodic sequence has nu > du distinct pole indices per period.
  const minFactor = divide(scalar(du), period)[0]
  if (!(minFactor > 0)) fail('scala U non comprovabilmente positiva')
  const horizontal = net.poles.filter((_, i) => i % nv === 0).map(([x, y]): Point => [x, y, 0])
  const edges = horizontal.map((point, i) => difference(horizontal[(i + 1) % nu], point))
  let minXYTangentNorm = Infinity, start = 0
  for (let span = 0; span < ku.length - 1; span++) {
    if (span > 0) start += mu[span]
    const active = Array.from({ length: du }, (_, j) => edges[(start + j) % nu])
    const scale = Math.max(...active.flat(2).map(Math.abs))
    if (!(scale > 0)) fail(`tangente XY non comprovata nella campata U ${span}`)
    // Any finite nonzero direction works if every active edge has a
    // positive certified projection. The scaled average is only a witness.
    const direction = ([0, 1] as const).map(axis => active.reduce((sum, edge) => {
      const [lo, hi] = edge[axis]
      return sum + 0.5 * (lo / scale + hi / scale)
    }, 0))
    const witness: Point = [direction[0], direction[1], 0]
    const minProjection = Math.min(...active.map(edge => dot(edge, witness)[0]))
    if (!(minProjection > 0)) fail(`tangente XY non comprovata nella campata U ${span}`)
    const normLower = divide(mul(scalar(minProjection), scalar(minFactor)), scalar(l1(vector(witness))))[0]
    if (!(normLower > 0)) fail(`limite della tangente XY non rappresentabile nella campata U ${span}`)
    minXYTangentNorm = Math.min(minXYTangentNorm, normLower)
  }
  return minXYTangentNorm
}

// The derivative of a cubic is a quadratic on the knot vector with the
// first and last knot removed. 'end' is the span index on that vector.
function evaluateQuadratic(knots: number[], coefficients: I[], end: number, fraction: 0 | 0.5 | 1): I {
  const work = coefficients.slice(end - 2, end + 1)
  const left = knots[end], right = knots[end + 1]
  for (let r = 1; r <= 2; r++) for (let j = 2; j >= r; j--) {
    const index = end - 2 + j
    const lo = knots[index], hi = knots[index + 3 - r]
    const width = sub(scalar(hi), scalar(lo))
    const offsets = (a: number, b: number) => a === b ? scalar(0) : sub(scalar(a), scalar(b))
    const numerator = (a: I, b: I) => fraction === 0 ? a : fraction === 1 ? b : midpoint(a, b)
    const alpha = divide(numerator(offsets(left, lo), offsets(right, lo)), width)
    const beta = divide(numerator(offsets(hi, left), offsets(hi, right)), width)
    work[j] = add(mul(beta, work[j - 1]), mul(alpha, work[j]))
  }
  return work[2]
}

function boundQuadratic(controls: Quadratic, u: number, v: number) {
  const pending = [{ controls, depth: 0 }]
  let lower = Infinity, subdivisions = 0
  for (let i = 0; i < pending.length; i++) {
    const { controls: [a, b, c], depth } = pending[i]
    const min = Math.min(a[0], b[0], c[0])
    if (min > 0) {
      lower = Math.min(lower, min)
      continue
    }
    if (a[1] <= 0 || c[1] <= 0) fail(`derivata V non positiva comprovata alla colonna ${u}, campata ${v}`)
    if (depth === 12) fail(`positività della derivata V non comprovata alla colonna ${u}, campata ${v}`)
    const ab = midpoint(a, b), bc = midpoint(b, c), middle = midpoint(ab, bc)
    pending.push({ controls: [a, ab, middle], depth: depth + 1 }, { controls: [middle, bc, c], depth: depth + 1 })
    subdivisions++
  }
  return { lower, subdivisions }
}

/**
 * Sufficient continuous orientation and regularity check for the restricted
 * coefficient model S(U,V)=(X(U),Y(U),Z(U,V)). Unit weights and C1 bases
 * are required. Each horizontal U tangent is bounded away from zero and
 * every U control column has strictly positive V height derivative.
 * The normal therefore points along (Y'(U),-X'(U),0) everywhere.
 *
 * Hull bounds and a finite subdivision budget may decline valid strips.
 * Other U columns can keep the surface derivative positive where a
 * particular column fails the positivity condition.
 * General periodic strips, including those whose XY coordinates vary with
 * V, need a separate method. This does not qualify OCCT evaluation, trim
 * or seam topology, global injectivity, contact, or volume.
 */
export function boundExperimentalPeriodicHeightStripRegularity(net: Net) {
  validateExperimentalPeriodicSurfaceU(net)
  const { nu, nv, dv, du, kv, mv, mu, poles, weights } = net
  if (dv !== 3 || (nv !== 4 && nv !== 9) || weights.some(w => w !== 1) ||
      mu.some(m => m >= du) || mv.slice(1, -1).some(m => m >= dv))
    fail('serve una fascia periodica C1 cubica in V, con quattro o nove file e pesi unitari')
  if (poles.some(([x, y], i) => {
    const [x0, y0] = poles[i - i % nv]
    return x !== x0 || y !== y0
  })) fail('la proiezione XY deve essere indipendente da V')

  const minXYTangentNorm = boundXYTangent(net)
  const knots = kv.flatMap((knot, i) => Array<number>(mv[i]).fill(knot)).slice(1, -1)
  const factors = Array.from({ length: nv - 1 }, (_, i) =>
    divide(scalar(3), sub(scalar(knots[i + 3]), scalar(knots[i]))))
  let minVHeightDerivative = Infinity, subdivisions = 0
  for (let u = 0; u < nu; u++) {
    const height = (v: number) => scalar(poles[u * nv + v][2])
    const coefficients = factors.map((factor, i) => mul(factor, sub(height(i + 1), height(i))))
    let end = 2
    for (let v = 0; v < kv.length - 1; v++) {
      if (v > 0) end += mv[v]
      const a = evaluateQuadratic(knots, coefficients, end, 0)
      const b = evaluateQuadratic(knots, coefficients, end, 0.5)
      const c = evaluateQuadratic(knots, coefficients, end, 1)
      const result = boundQuadratic([a, sub(mul(scalar(2), b), midpoint(a, c)), c], u, v)
      minVHeightDerivative = Math.min(minVHeightDerivative, result.lower)
      subdivisions += result.subdivisions
    }
  }
  // U is a nonnegative partition of unity, so the column lower bound also
  // holds for the whole surface. The normal norm is the product below.
  const minNormalNorm = mul(scalar(minXYTangentNorm), scalar(minVHeightDerivative))[0]
  if (!(minNormalNorm > 0)) fail('limite della normale non rappresentabile')
  return { minXYTangentNorm, minVHeightDerivative, minNormalNorm, subdivisions,
    checkedUSpans: net.ku.length - 1, checkedVSpans: kv.length - 1, checkedVColumnSpans: nu * (kv.length - 1),
    evidenceScope: 'unit-weight-periodic-height-strip-coefficient-model' as const }
}

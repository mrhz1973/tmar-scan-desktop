// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import type { ExperimentalPolynomialBSpline } from './experimentalClampedBSplineTrim'
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'
import { add, l1, scalar, sub, times, type I, type V } from './tangencyCoefficientIntervals'

const fail = (reason: string): never => { throw new Error(`Confronto affine curve periodiche rifiutato: ${reason}`) }
const maxExactBits = 8192
type Fraction = { numerator: bigint; denominator: bigint }
type Blend = { alpha: I; beta: I }
const delta = (a: number, b: number): I => a === b ? scalar(0) : sub(scalar(a), scalar(b))
const addVectors = (a: V, b: V): V => a.map((x, axis) => add(x, b[axis])) as V

function everyDense<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): boolean {
  if (!Array.isArray(values)) return false
  for (let i = 0; i < values.length; i++) {
    if (!Object.hasOwn(values, i) || !predicate(values[i], i)) return false
  }
  return true
}

function validate(curve: ExperimentalPolynomialBSpline, periodic: boolean) {
  if (!curve || !Number.isInteger(curve.degree) || curve.degree < 1 || curve.degree > 3 ||
      (periodic ? curve.periodic !== true : curve.periodic !== undefined && curve.periodic !== false) ||
      (curve.rational !== undefined && curve.rational !== false) ||
      !Array.isArray(curve.poles) || curve.poles.length <= curve.degree || curve.poles.length > (periodic ? 512 : 513) ||
      !everyDense(curve.poles, p => Array.isArray(p) && p.length === 3 && everyDense(p, Number.isFinite)) ||
      !Array.isArray(curve.knots) || curve.knots.length < 2 || curve.knots.length > 514 ||
      !everyDense(curve.knots, (k, i) => Number.isFinite(k) && (i === 0 || k > curve.knots[i - 1])) ||
      !Array.isArray(curve.multiplicities) || curve.multiplicities.length !== curve.knots.length ||
      !everyDense(curve.multiplicities, (m, i) => i === 0 || i === curve.knots.length - 1
        ? m === curve.degree + (periodic ? 0 : 1) : Number.isInteger(m) && m >= 1 && m <= curve.degree) ||
      (curve.weights !== undefined && (!Array.isArray(curve.weights) ||
        (curve.weights.length !== 0 && curve.weights.length !== curve.poles.length) ||
        !everyDense(curve.weights, w => w === 1))))
    fail(periodic ? 'curva polinomiale periodica a cucitura satura non valida' : 'curva polinomiale clamped non valida')
  const count = curve.multiplicities.reduce((sum, m) => sum + m, 0)
  if (periodic ? count - curve.degree !== curve.poles.length : count !== curve.poles.length + curve.degree + 1)
    fail('numero di poli e molteplicità incompatibili')
}

/**
 * Exact representation identity on the closed domain only. A clamped
 * polynomial curve whose last pole is exactly its first pole can use a
 * saturated periodic seam: remove only that duplicate final pole and one
 * copy of each endpoint knot. Interior knots/poles are retained unchanged.
 * Local de Boor denominators agree after the endpoint index shift; on the
 * last span the periodic wrap supplies the identical first pole. This
 * makes no statement about derivatives, G1 or native CAD reconstruction.
 */
export function canonicalizeExperimentalClosedClampedCurve(input: ExperimentalPolynomialBSpline) {
  validate(input, false)
  const first = input.poles[0], last = input.poles.at(-1)!
  if (first.some((coordinate, axis) => !Object.is(coordinate, last[axis]))) fail('polo finale non esattamente uguale al primo')
  if (input.poles.length - 1 <= input.degree) fail('poli periodici insufficienti dopo la rimozione del duplicato')
  const multiplicities = [...input.multiplicities]
  multiplicities[0]--; multiplicities[multiplicities.length - 1]--
  const curve: ExperimentalPolynomialBSpline = { degree: input.degree, knots: [...input.knots], multiplicities,
    poles: input.poles.slice(0, -1).map(p => [...p] as Point), periodic: true, rational: false,
    weights: Array<number>(input.poles.length - 1).fill(1) }
  validate(curve, true)
  return { status: 'canonicalized' as const, curve, exactRepresentationIdentity: true as const,
    evidenceScope: 'closed-clamped-to-periodic-coefficient-model' as const, nativeCadCertified: false as const }
}

function budget(...values: bigint[]) {
  for (const value of values) {
    if ((value < 0n ? -value : value).toString(2).length > maxExactBits) fail('budget aritmetico esatto superato')
  }
}

function compare(a: Fraction, b: Fraction) {
  const left = a.numerator * b.denominator, right = b.numerator * a.denominator
  budget(left, right)
  return left < right ? -1 : left > right ? 1 : 0
}

// Enclose an exact positive blend fraction without rounding its parameter
// or inverting a possibly subnormal native knot span in floating point.
function fractionInterval(numerator: bigint, denominator: bigint): I {
  if (denominator <= 0n || numerator < 0n || numerator > denominator) fail('fattore affine esatto fuori intervallo')
  if (numerator === 0n) return scalar(0)
  if (numerator === denominator) return scalar(1)
  const units = numerator << 1074n
  budget(units, denominator)
  const shift = Math.max(0, (units / denominator).toString(2).length - 53)
  const divisor = denominator << BigInt(shift)
  budget(divisor)
  const lower = units / divisor, upper = lower + (units % divisor === 0n ? 0n : 1n)
  const scale = 2 ** (shift - 1074)
  const out: I = [Number(lower) * scale, Number(upper) * scale]
  if (!out.every(Number.isFinite) || out[0] < 0 || out[1] > 1 || out[0] > out[1])
    fail('fattore affine non rappresentabile')
  return out
}

function encodeFraction(value: Fraction) {
  let a = value.numerator, b = value.denominator
  while (b !== 0n) [a, b] = [b, a % b]
  return { numerator: (value.numerator / a).toString(), denominator: (value.denominator / a).toString() }
}

function prepare(curve: ExperimentalPolynomialBSpline) {
  const first = binary64Units(curve.knots[0])
  const knots = curve.knots.map(knot => binary64Units(knot) - first)
  const period = knots.at(-1)!
  const flat = knots.slice(0, -1).flatMap((knot, i) => Array<bigint>(curve.multiplicities[i]).fill(knot))
  const count = flat.length
  const wrap = (index: number) => ((index % count) + count) % count
  const extended = (index: number) => flat[wrap(index)] + BigInt(Math.floor(index / count)) * period
  const normalized = knots.map(numerator => ({ numerator, denominator: period }))
  return { curve, knots, period, normalized, axis(span: number, domain: readonly [Fraction, Fraction]) {
    if (compare(domain[0], normalized[span]) < 0 || compare(domain[1], normalized[span + 1]) > 0)
      fail('cella comune fuori dalla campata nativa')
    const end = curve.multiplicities.slice(0, span + 1).reduce((sum, m) => sum + m, 0) - 1
    const steps = Array.from({ length: curve.degree }, (_, step) => {
      const order = step + 1
      return Array.from({ length: curve.degree - step }, (_, offset) => {
        const j = curve.degree - offset, lo = extended(end - curve.degree + j)
        const hi = extended(end - curve.degree + j + curve.degree - order + 1)
        const blendAt = ({ numerator, denominator }: Fraction): Blend => {
          const left = numerator * period - lo * denominator
          const width = (hi - lo) * denominator
          budget(left, width)
          return { alpha: fractionInterval(left, width), beta: fractionInterval(width - left, width) }
        }
        return { j, left: blendAt(domain[0]), right: blendAt(domain[1]) }
      })
    })
    const start = end - curve.degree + 1
    const indices = Array.from({ length: curve.degree + 1 }, (_, i) => wrap(start + i))
    return { indices, steps }
  } }
}

function affineBlend(a: V, b: V, { alpha, beta }: Blend): V {
  if (alpha[1] === 0) return a
  if (beta[1] === 0) return b
  return addVectors(times(a, beta), times(b, alpha))
}

type PreparedCurve = ReturnType<typeof prepare>
type CurveAxis = ReturnType<PreparedCurve['axis']>

function restrict(prepared: PreparedCurve, axis: CurveAxis, origin: Point) {
  const work = axis.indices.map(index => [prepared.curve.poles[index].map((x, d) => delta(x, origin[d])) as V])
  for (const step of axis.steps) for (const { j, left, right } of step) {
    const a = work[j - 1], b = work[j], degree = a.length
    // Multiplication of a degree-(r-1) Bernstein field by a linear blend
    // uses its endpoint values and exact combinatorial ratios i/r.
    work[j] = Array.from({ length: degree + 1 }, (_, i) => {
      if (i === 0) return affineBlend(a[0], b[0], left)
      if (i === degree) return affineBlend(a[i - 1], b[i - 1], right)
      return addVectors(times(affineBlend(a[i], b[i], left), fractionInterval(BigInt(degree - i), BigInt(degree))),
        times(affineBlend(a[i - 1], b[i - 1], right), fractionInterval(BigInt(i), BigInt(degree))))
    })
  }
  return work.at(-1)!
}

/**
 * Continuous bound for C(a+s*(b-a)) versus D(c+s*(d-c)), 0 <= s <= 1.
 * Every native knot is normalized as an exact ratio of binary64 integer
 * differences. The common partition compares those ratios exactly; no
 * rounded affine knot map is substituted for the intended correspondence.
 * Both polynomial curves are periodic with saturated seams, equal degree
 * up to three, equal pole counts and equal multiplicities. Native knot
 * values and natural parameter domains may differ.
 *
 * On each common cell both interval control fields use the same normalized
 * Bernstein basis. Its nonnegative partition of unity and an outward L1
 * coefficient hull bound Euclidean position difference on the whole closed
 * cell. This does not infer phase or orientation, compare derivatives/G1,
 * validate pcurves/topology or enclose native CAD evaluation. A caller
 * claiming identity parameter correspondence must also check equal domains.
 */
export function boundExperimentalPeriodicCurveAffineDifference(
  original: ExperimentalPolynomialBSpline, candidate: ExperimentalPolynomialBSpline, maxCells = 4096,
) {
  validate(original, true); validate(candidate, true)
  if (original.degree !== candidate.degree || original.poles.length !== candidate.poles.length ||
      original.multiplicities.length !== candidate.multiplicities.length ||
      original.multiplicities.some((m, i) => m !== candidate.multiplicities[i]))
    fail('grado, numero di poli o molteplicità differenti')
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 16_384) fail('budget celle non valido')
  const a = prepare(original), b = prepare(candidate)
  const merged = [...a.normalized, ...b.normalized].sort(compare)
  const partition = merged.filter((value, i) => i === 0 || compare(value, merged[i - 1]) !== 0)
  const requiredCells = partition.length - 1
  if (requiredCells > maxCells) fail('partizione comune oltre il budget celle')
  let originalSpan = 0, candidateSpan = 0, checkedCells = 0, maximumCurveDifferenceUpper = 0
  let worstCell: { cell: number; originalSpan: number; candidateSpan: number; upperBound: number } | undefined
  for (let cell = 0; cell < requiredCells; cell++) {
    const domain = [partition[cell], partition[cell + 1]] as const
    while (originalSpan + 1 < a.normalized.length - 1 && compare(a.normalized[originalSpan + 1], domain[0]) <= 0) originalSpan++
    while (candidateSpan + 1 < b.normalized.length - 1 && compare(b.normalized[candidateSpan + 1], domain[0]) <= 0) candidateSpan++
    const originalAxis = a.axis(originalSpan, domain), candidateAxis = b.axis(candidateSpan, domain)
    const origin: Point = [...original.poles[originalAxis.indices[0]]]
    const left = restrict(a, originalAxis, origin), right = restrict(b, candidateAxis, origin)
    let upperBound = 0
    for (const [i, point] of left.entries()) {
      const difference = point.map((interval, axis) => sub(right[i][axis], interval)) as V
      upperBound = Math.max(upperBound, l1(difference))
    }
    checkedCells++
    if (!worstCell || upperBound > maximumCurveDifferenceUpper) {
      maximumCurveDifferenceUpper = upperBound
      worstCell = { cell, originalSpan, candidateSpan, upperBound }
    }
  }
  if (!worstCell || checkedCells !== requiredCells || !Number.isFinite(maximumCurveDifferenceUpper))
    fail('copertura della partizione comune incompleta')
  return { status: 'bounded' as const, maximumCurveDifferenceUpper, checkedCells,
    checkedControlPairs: checkedCells * (original.degree + 1), maxCells, maxExactBits, worstCell,
    originalDomain: [original.knots[0], original.knots.at(-1)!] as const,
    candidateDomain: [candidate.knots[0], candidate.knots.at(-1)!] as const,
    normalizedPartition: partition.map(encodeFraction),
    correspondence: 'exact-positive-affine-full-domain' as const,
    boundMethod: 'exact-rational-partition-bernstein-interval-l1-hull' as const,
    evidenceScope: 'periodic-polynomial-curve-coefficient-model' as const, nativeCadCertified: false as const }
}

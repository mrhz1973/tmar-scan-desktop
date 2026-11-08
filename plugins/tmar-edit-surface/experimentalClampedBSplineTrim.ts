// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'

export interface ExperimentalPolynomialBSpline {
  degree: number
  knots: readonly number[]
  multiplicities: readonly number[]
  poles: readonly (readonly [number, number, number])[]
  periodic?: boolean
  rational?: boolean
  weights?: readonly number[]
}

type Rational = { numerator: bigint; denominator: bigint }
type ExactPoint = [Rational, Rational, Rational]
const axes = [0, 1, 2] as const
const abs = (n: bigint) => n < 0n ? -n : n
const zero: Rational = { numerator: 0n, denominator: 1n }
const bitLength = (n: bigint) => abs(n).toString(2).length

function reduce(numerator: bigint, denominator: bigint): Rational {
  if (numerator === 0n) return zero
  if (denominator <= 0n) throw Error('invalid-exact-arithmetic')
  let a = abs(numerator), b = denominator
  while (b !== 0n) [a, b] = [b, a % b]
  const n = numerator / a, d = denominator / a
  if (Math.max(bitLength(n), bitLength(d)) > 32768) throw Error('arithmetic-budget')
  return { numerator: n, denominator: d }
}

function blend(a: Rational, b: Rational, offset: bigint, width: bigint) {
  if (offset === 0n || (a.numerator === b.numerator && a.denominator === b.denominator)) return a
  if (offset === width) return b
  return reduce((width - offset) * a.numerator * b.denominator + offset * b.numerator * a.denominator,
    width * a.denominator * b.denominator)
}

function insertBoundary(flat: number[], points: ExactPoint[], degree: number, knot: number) {
  let end = flat.length - 1
  while (flat[end] > knot) end--
  const start = flat.indexOf(knot)
  let count = start === -1 ? 0 : end - start + 1
  const u = binary64Units(knot)
  while (count <= degree) {
    // One Boehm insertion. The last occurrence of a knot is its span
    // index, including when it is the original active right endpoint.
    const unchanged = end - degree, blended = end - count
    const refined = points.slice(0, unchanged + 1)
    for (let i = unchanged + 1; i <= blended; i++) {
      const left = binary64Units(flat[i]), width = binary64Units(flat[i + degree]) - left, offset = u - left
      if (width <= 0n || offset < 0n || offset > width) throw Error('invalid-exact-arithmetic')
      refined.push(axes.map(axis => blend(points[i - 1][axis], points[i][axis], offset, width)) as ExactPoint)
    }
    refined.push(...points.slice(blended))
    flat.splice(end + 1, 0, knot)
    points = refined
    end++
    count++
  }
  return points
}

// Coefficients are rational in units of 2^-1074. Quantize the magnitude
// in the correct binade before converting the at-most-53-bit significand.
function roundBinary64(value: Rational, outward = false) {
  const a = abs(value.numerator), b = value.denominator
  const shift = Math.max(0, bitLength(a / b) - 53), divisor = b << BigInt(shift)
  let integer = a / divisor
  const remainder = a % divisor
  if (outward ? remainder !== 0n : remainder * 2n > divisor || (remainder * 2n === divisor && integer % 2n !== 0n)) integer++
  const magnitude = Number(integer) * 2 ** (shift - 1074)
  if (!Number.isFinite(magnitude)) throw Error('unrepresentable-bound')
  return value.numerator < 0n ? -magnitude : magnitude
}

function valid(input: ExperimentalPolynomialBSpline) {
  if (!input || !Number.isInteger(input.degree) || input.degree < 1 || input.degree > 5 ||
      (input.periodic !== undefined && input.periodic !== false) || (input.rational !== undefined && input.rational !== false) ||
      !Array.isArray(input.poles) || input.poles.length <= input.degree || input.poles.length > 512 ||
      !Array.isArray(input.knots) || input.knots.length < 2 || input.knots.length > 518 ||
      !Array.isArray(input.multiplicities) || input.multiplicities.length !== input.knots.length) return false
  const { knots, multiplicities, poles, weights, degree } = input
  return Array.from(knots).every((k, i) => Number.isFinite(k) && (i === 0 || k > knots[i - 1])) &&
    Array.from(multiplicities).every(m => Number.isInteger(m) && m >= 1 && m <= degree + 1) &&
    multiplicities.reduce((sum, m) => sum + m, 0) === poles.length + degree + 1 &&
    Array.from(poles).every(p => Array.isArray(p) && p.length === 3 && Array.from(p).every(Number.isFinite)) &&
    (weights === undefined || (Array.isArray(weights) && (weights.length === 0 || weights.length === poles.length) &&
      Array.from(weights).every(w => w === 1)))
}

/**
 * Restrict a nonperiodic polynomial B-spline to its active domain [U_p,U_n],
 * where n counts control points, or to a supplied subinterval. Both endpoints
 * are clamped. Interior knots
 * and multiplicities are retained exactly, including arbitrarily close knots.
 * At a discontinuous cut the endpoint denotes the retained one-sided limit.
 *
 * Insertion uses exact rationals on the input binary64 values. The only
 * rounding is emission of the new poles. A hull of outward L1 coefficient
 * errors bounds Euclidean error at every matching parameter. A zero bound
 * means the exact result is representable in binary64. This says nothing
 * about curve evaluation, pcurves, closure, or CAD tolerances.
 */
export function clampExperimentalPolynomialBSpline(input: ExperimentalPolynomialBSpline, range?: readonly [number, number]) {
  const stop = (reason: 'invalid-input' | 'invalid-range' | 'arithmetic-budget' | 'unrepresentable-bound' | 'invalid-exact-arithmetic') =>
    ({ status: 'inconclusive' as const, reason })
  if (!valid(input)) return stop('invalid-input')
  const { degree, knots, multiplicities, poles } = input
  const flat = knots.flatMap((knot, i) => Array<number>(multiplicities[i]).fill(knot))
  const start = flat[degree], end = flat[poles.length]
  if (range !== undefined && (!Array.isArray(range) || range.length !== 2)) return stop('invalid-range')
  const [first, last] = range ?? [start, end]
  if (!Number.isFinite(first) || !Number.isFinite(last) || !(first >= start && last <= end && first < last)) return stop('invalid-range')
  try {
    let exact = poles.map(p => axes.map(i => ({ numerator: binary64Units(p[i]), denominator: 1n })) as ExactPoint)
    exact = insertBoundary(flat, exact, degree, first)
    exact = insertBoundary(flat, exact, degree, last)
    const left = flat.indexOf(first), right = flat.indexOf(last)
    const trimmedKnots: number[] = [], trimmedMultiplicities: number[] = []
    for (const knot of flat.slice(left, right + degree + 1)) {
      if (knot === trimmedKnots.at(-1)) trimmedMultiplicities[trimmedMultiplicities.length - 1]++
      else { trimmedKnots.push(knot); trimmedMultiplicities.push(1) }
    }
    let maximumCurveErrorUpper = 0
    const trimmedPoles = exact.slice(left, right).map(p => {
      let error = zero
      const point = p.map(value => {
        const rounded = roundBinary64(value), { numerator: n, denominator: d } = value
        const delta = abs(n - binary64Units(rounded) * d)
        if (delta !== 0n) error = reduce(error.numerator * d + delta * error.denominator, error.denominator * d)
        return rounded
      }) as Point
      maximumCurveErrorUpper = Math.max(maximumCurveErrorUpper, roundBinary64(error, true))
      return point
    })
    return { status: 'converted' as const, curve: { degree, knots: trimmedKnots, multiplicities: trimmedMultiplicities, poles: trimmedPoles },
      maximumCurveErrorUpper, exactInBinary64: maximumCurveErrorUpper === 0 }
  } catch (error) {
    if (error instanceof Error && (error.message === 'arithmetic-budget' || error.message === 'unrepresentable-bound')) return stop(error.message)
    return stop('invalid-exact-arithmetic')
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Point } from '../brep'
import type { ExperimentalPolynomialBSpline } from '../experimentalClampedBSplineTrim'
import { boundExperimentalPeriodicCurveAffineDifference, canonicalizeExperimentalClosedClampedCurve } from '../experimentalPeriodicCurveAffineDifference'

function curve(poles: Point[], degree: number, knots: number[], multiplicities: number[]): ExperimentalPolynomialBSpline {
  return { poles, degree, knots, multiplicities, periodic: true, rational: false, weights: poles.map(() => 1) }
}
const linear = (knots = [0, 1, 2]) => curve([[0, 0, 0], [2, 0, 0]], 1, knots, [1, 1, 1])
const cubic = (knots = [0, 1, 2]) => curve([[0, 0, 0], [1, 0, 0], [2, 0, 0],
  [3, 0, 0], [2, 0, 0], [1, 0, 0]], 3, knots, [3, 3, 3])

it('compares the exact affine correspondence with nonzero origins and a non-dyadic normalized knot', () => {
  const original = cubic([10, 13, 19]), candidate = cubic([-5, -3, 1])
  const before = structuredClone({ original, candidate })
  const result = boundExperimentalPeriodicCurveAffineDifference(original, candidate)
  expect(result.maximumCurveDifferenceUpper).toBeGreaterThanOrEqual(0)
  expect(result.maximumCurveDifferenceUpper).toBeLessThan(1e-11)
  expect(result.normalizedPartition).toEqual([
    { numerator: '0', denominator: '1' }, { numerator: '1', denominator: '3' }, { numerator: '1', denominator: '1' },
  ])
  expect(result).toMatchObject({ checkedCells: 2, checkedControlPairs: 8,
    originalDomain: [10, 19], candidateDomain: [-5, 1],
    correspondence: 'exact-positive-affine-full-domain', nativeCadCertified: false })
  expect({ original, candidate }).toEqual(before)
})

it('retains exact normalized fractions that round to the same binary64 number', () => {
  // 6004799503160661 / 2^54 is the binary64 approximation below exact 1/3.
  // Both divisions round to the same Number; the common partition must
  // retain both exact rationals and their intervening real cell.
  const denominator = 18014398509481984, numerator = 6004799503160661
  expect(numerator / denominator).toBe(1 / 3)
  const result = boundExperimentalPeriodicCurveAffineDifference(linear([0, 1, 3]), linear([0, numerator, denominator]))
  expect(result.checkedCells).toBe(3)
  expect(result.normalizedPartition).toEqual([
    { numerator: '0', denominator: '1' },
    { numerator: '6004799503160661', denominator: '18014398509481984' },
    { numerator: '1', denominator: '3' }, { numerator: '1', denominator: '1' },
  ])
  expect(result.maximumCurveDifferenceUpper).toBeGreaterThan(0)
  expect(result.maximumCurveDifferenceUpper).toBeLessThan(1e-11)
})

it('bounds the analytic knot-only drift of a periodic linear triangle', () => {
  const result = boundExperimentalPeriodicCurveAffineDifference(linear(), linear([0, 1.5, 2]))
  // At u=1.5 the two x values are 1 and 2, and every common piece is linear.
  expect(result.maximumCurveDifferenceUpper).toBeGreaterThanOrEqual(1)
  expect(result.maximumCurveDifferenceUpper).toBeLessThan(1 + 1e-12)
  expect(result.checkedCells).toBe(3)
})

it('detects cubic knot-only drift with an unsaturated interior knot', () => {
  const poles: Point[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [4, 0, 0]]
  const original = curve(poles, 3, [0, 1, 2], [3, 1, 3])
  const candidate = curve(poles, 3, [0, 0.5, 2], [3, 1, 3])
  const result = boundExperimentalPeriodicCurveAffineDifference(original, candidate)
  // On the first span, the final cubic Bezier control is 4*(middle/2)^2
  // and the other three are zero. At u=.5 the source is 1/8 and the
  // candidate is 1/4, giving an exact positional difference of 1/8.
  expect(result.maximumCurveDifferenceUpper).toBeGreaterThanOrEqual(0.125)
  expect(result.maximumCurveDifferenceUpper).toBeLessThan(4 + 1e-11)
  expect(result.checkedCells).toBe(3)
})

it('covers the last wrapped cubic span and retains one-ULP parameter cells', () => {
  const original = cubic(), candidate = structuredClone(original)
  const poles = candidate.poles.map(p => [...p] as Point)
  poles[0][0] += 5
  const changed = boundExperimentalPeriodicCurveAffineDifference(original, { ...candidate, poles })
  // Same basis, one pole changed by 5: the hull bound is sharp at both
  // natural endpoints, including the last span's wrapped first pole.
  expect(changed.maximumCurveDifferenceUpper).toBeGreaterThanOrEqual(5)
  expect(changed.maximumCurveDifferenceUpper).toBeLessThan(5 + 1e-11)
  const micro = boundExperimentalPeriodicCurveAffineDifference(original, cubic([0, 1 + Number.EPSILON, 2]))
  expect(micro.checkedCells).toBe(3)
  expect(micro.maximumCurveDifferenceUpper).toBeGreaterThan(0)
  expect(micro.maximumCurveDifferenceUpper).toBeLessThan(1e-11)
})

it('handles subnormal native spans with exact ratios instead of floating reciprocal widths', () => {
  const result = boundExperimentalPeriodicCurveAffineDifference(
    linear([0, Number.MIN_VALUE, 1]), linear([0, 2 * Number.MIN_VALUE, 1]))
  // At u=MIN_VALUE the first triangle is at x=2 and the second at x=1.
  expect(result.maximumCurveDifferenceUpper).toBeGreaterThanOrEqual(1)
  expect(result.maximumCurveDifferenceUpper).toBeLessThan(1 + 1e-12)
  expect(result.checkedCells).toBe(3)
})

it('canonicalizes only the exact duplicate final pole of a closed clamped curve', () => {
  const periodic = cubic(), duplicate: Point = [...periodic.poles[0]]
  const clamped: ExperimentalPolynomialBSpline = { ...periodic, periodic: false,
    poles: [...periodic.poles, duplicate], weights: Array<number>(7).fill(1), multiplicities: [4, 3, 4] }
  const before = structuredClone(clamped)
  const result = canonicalizeExperimentalClosedClampedCurve(clamped)
  expect(result.curve).toEqual(periodic)
  expect(result).toMatchObject({ status: 'canonicalized', exactRepresentationIdentity: true, nativeCadCertified: false })
  expect(clamped).toEqual(before)
  const open = { ...clamped, poles: [...clamped.poles.slice(0, -1), [Number.EPSILON, 0, 0] as Point] }
  expect(() => canonicalizeExperimentalClosedClampedCurve(open)).toThrow(/polo finale/)
  expect(() => canonicalizeExperimentalClosedClampedCurve({ ...clamped, multiplicities: [3, 3, 3] }))
    .toThrow(/clamped non valida/)
  expect(() => canonicalizeExperimentalClosedClampedCurve({ ...clamped, multiplicities: [4, 4, 4] }))
    .toThrow(/clamped non valida/)
  expect(() => canonicalizeExperimentalClosedClampedCurve({ ...clamped, rational: true }))
    .toThrow(/clamped non valida/)
})

it('declines incompatible bases, malformed coefficients, rational weights and excess budgets', () => {
  const original = cubic(), candidate = cubic([0, 1.25, 2])
  expect(() => boundExperimentalPeriodicCurveAffineDifference(original, { ...candidate, periodic: false }))
    .toThrow(/periodica/)
  expect(() => boundExperimentalPeriodicCurveAffineDifference(original, { ...candidate, rational: true }))
    .toThrow(/periodica/)
  expect(() => boundExperimentalPeriodicCurveAffineDifference(original, { ...candidate, weights: [2, 1, 1, 1, 1, 1] }))
    .toThrow(/periodica/)
  expect(() => boundExperimentalPeriodicCurveAffineDifference(original, curve([[0, 0, 0], [0, 0, 0],
    [0, 0, 0], [4, 0, 0]], 3, [0, 1, 2], [3, 1, 3]))).toThrow(/differenti/)
  const missing = candidate.poles.map(p => [...p] as Point); delete missing[0]
  expect(() => boundExperimentalPeriodicCurveAffineDifference(original, { ...candidate, poles: missing }))
    .toThrow(/periodica/)
  const nonfinite = candidate.poles.map(p => [...p] as Point); nonfinite[0][0] = Infinity
  expect(() => boundExperimentalPeriodicCurveAffineDifference(original, { ...candidate, poles: nonfinite }))
    .toThrow(/periodica/)
  expect(() => boundExperimentalPeriodicCurveAffineDifference(original, { ...candidate, knots: [0, NaN, 2] }))
    .toThrow(/periodica/)
  expect(() => boundExperimentalPeriodicCurveAffineDifference(original, candidate, 2)).toThrow(/oltre il budget/)
  expect(() => boundExperimentalPeriodicCurveAffineDifference(original, candidate, 0)).toThrow(/budget celle non valido/)
})

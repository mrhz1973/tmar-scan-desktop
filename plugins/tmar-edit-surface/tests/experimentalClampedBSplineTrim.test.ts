// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Point } from '../brep'
import { clampExperimentalPolynomialBSpline, type ExperimentalPolynomialBSpline } from '../experimentalClampedBSplineTrim'

// Independent Cox–de Boor basis evaluation on the original and clamped
// knot sequences. At the right endpoint use the retained left limit.
function evaluate(curve: ExperimentalPolynomialBSpline, t: number) {
  const flat = curve.knots.flatMap((k, i) => Array<number>(curve.multiplicities[i]).fill(k))
  const end = flat[curve.poles.length]
  let basis = flat.slice(1).map((right, i) => Number(t === end ? flat[i] < t && t <= right : flat[i] <= t && t < right))
  for (let d = 1; d <= curve.degree; d++) basis = basis.slice(0, -1).map((a, i) => {
    const left = flat[i + d] - flat[i], right = flat[i + d + 1] - flat[i + 1]
    return (left ? (t - flat[i]) / left * a : 0) + (right ? (flat[i + d + 1] - t) / right * basis[i + 1] : 0)
  })
  return [0, 1, 2].map(axis => curve.poles.reduce((sum, p, i) => sum + p[axis] * basis[i], 0))
}

const line: ExperimentalPolynomialBSpline = { degree: 1, knots: [0, 1, 4, 5], multiplicities: [1, 1, 1, 1], poles: [[0, 0, 0], [1, 0, 0]] }

it('clamps a cubic closed interval with simple exterior and saturated interior knots exactly', () => {
  const next = 2 + 2 ** -51
  const poles: Point[] = [[3, 2, 1], [1, 3, 1], [2, 5, 3], [3, 4, 2], [5, 5, 5], [8, 4, 3],
    [9, 2, 5], [6, 1, 4], [6, 2, 1], [3, 2, 1]]
  const input = { degree: 3, knots: [-3, 0, 2, next, 5, 8], multiplicities: [1, 3, 3, 3, 3, 1], poles }
  const before = structuredClone(input)
  const result = clampExperimentalPolynomialBSpline(input)
  if (result.status !== 'converted') throw Error(result.reason)
  expect(result.curve).toEqual({ degree: 3, knots: [0, 2, next, 5], multiplicities: [4, 3, 3, 4], poles })
  expect(result.maximumCurveErrorUpper).toBe(0)
  expect(result.exactInBinary64).toBe(true)
  for (const t of [0, 0.25, 1, 2, next, 3, 4.75, 5]) expect(evaluate(result.curve, t)).toEqual(evaluate(input, t))
  expect(input).toEqual(before)
})

it('inserts both nonclamped endpoints of a uniform quadratic before stripping exterior knots', () => {
  const input: ExperimentalPolynomialBSpline = { degree: 2, knots: [0, 1, 2, 3, 4, 5, 6, 7], multiplicities: Array(8).fill(1),
    poles: [[0, 0, 0], [2, 4, 0], [4, 2, 2], [6, 4, 0], [8, 0, 0]] }
  const result = clampExperimentalPolynomialBSpline(input)
  if (result.status !== 'converted') throw Error(result.reason)
  expect(result.curve).toEqual({ degree: 2, knots: [2, 3, 4, 5], multiplicities: [3, 1, 1, 3],
    poles: [[1, 2, 0], [2, 4, 0], [4, 2, 2], [6, 4, 0], [7, 2, 0]] })
  expect(result.exactInBinary64).toBe(true)
  for (let i = 0; i <= 24; i++) expect(evaluate(result.curve, 2 + i / 8)).toEqual(evaluate(input, 2 + i / 8))
})

it('bounds binary64 rounding when an interior restriction yields thirds', () => {
  const result = clampExperimentalPolynomialBSpline(line, [2, 3])
  if (result.status !== 'converted') throw Error(result.reason)
  expect(result.curve).toEqual({ degree: 1, knots: [2, 3], multiplicities: [2, 2], poles: [[1 / 3, 0, 0], [2 / 3, 0, 0]] })
  // 2/3 rounds down by exactly 2^-53/3, twice the error at 1/3.
  expect(result.maximumCurveErrorUpper).toBeGreaterThan(2 ** -53 / 3)
  expect(result.maximumCurveErrorUpper).toBeLessThan(2 ** -54)
  expect(result.exactInBinary64).toBe(false)
  const tiny = clampExperimentalPolynomialBSpline({ ...line, knots: [0, 1, 3, 4], poles: [[0, 0, 0], [Number.MIN_VALUE, 0, 0]] }, [2, 3])
  expect(tiny).toMatchObject({ status: 'converted', maximumCurveErrorUpper: Number.MIN_VALUE, exactInBinary64: false,
    curve: { poles: [[0, 0, 0], [Number.MIN_VALUE, 0, 0]] } })
})

it('retains the correct one-sided endpoint at a fully repeated cut', () => {
  const input: ExperimentalPolynomialBSpline = { degree: 2, knots: [0, 1, 2], multiplicities: [3, 3, 3],
    poles: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [10, 0, 0], [11, 0, 0], [12, 0, 0]] }
  expect(clampExperimentalPolynomialBSpline(input, [0, 1])).toMatchObject({ status: 'converted', exactInBinary64: true,
    curve: { knots: [0, 1], multiplicities: [3, 3], poles: input.poles.slice(0, 3) } })
  expect(clampExperimentalPolynomialBSpline(input, [1, 2])).toMatchObject({ status: 'converted', exactInBinary64: true,
    curve: { knots: [1, 2], multiplicities: [3, 3], poles: input.poles.slice(3) } })
})

it('refuses data outside its nonperiodic polynomial contract and invalid intervals', () => {
  for (const input of [{ ...line, periodic: true }, { ...line, rational: true }, { ...line, weights: [1, 2] },
    { ...line, knots: [0, 1, 1, 5] }, { ...line, multiplicities: [1, 1, 2, 1] }, { ...line, poles: Array<Point>(2) }])
    expect(clampExperimentalPolynomialBSpline(input)).toEqual({ status: 'inconclusive', reason: 'invalid-input' })
  for (const range of [[0, 3], [2, 5], [2, 2], [2, Infinity]] as const)
    expect(clampExperimentalPolynomialBSpline(line, range)).toEqual({ status: 'inconclusive', reason: 'invalid-range' })
})

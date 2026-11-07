// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Point } from '../brep'
import { prepareExperimentalPeriodicUBasis } from '../experimentalPeriodicUBasis'
import { fitExperimentalPeriodicUVectorSamples,
  fitExperimentalPeriodicUVectorSamplesWithFixedFirst } from '../experimentalPeriodicUVectorFit'

const fitFixed = fitExperimentalPeriodicUVectorSamplesWithFixedFirst

it('eliminates the fixed column and fits the free coefficient instead of overwriting after a solve', () => {
  const knots = [0, 1, 3], multiplicities = [1, 1, 1]
  const fixed: Point = [1, -0, 0]
  const samples = [
    { parameter: 0, value: [1, 0, 0] as Point },
    { parameter: 1, value: [4, 0, 0] as Point },
    { parameter: 0.5, value: [10, 0, 0] as Point },
  ]
  const before = structuredClone({ knots, multiplicities, samples, fixed })
  const unconstrained = fitExperimentalPeriodicUVectorSamples(1, knots, multiplicities, samples)
  expect(unconstrained.coefficients.map(point => point[0])).toEqual([expect.closeTo(3.5, 12), expect.closeTo(6.5, 12)])

  const result = fitFixed(1, knots, multiplicities, samples, fixed)
  expect(result.fixedCoefficientIndex).toBe(0)
  expect(result.coefficients[0]).toEqual(fixed)
  expect(result.coefficients[0]).not.toBe(fixed)
  expect(result.rank).toBe(1)
  // After elimination, the free column is [0,1,1/2] and the X RHS
  // is [0,4,19/2]. The exact constrained minimizer is 7.
  expect(result.coefficients[1]).toEqual([expect.closeTo(7, 12), 0, 0])
  expect(result.residuals).toEqual([0, expect.closeTo(3, 12), expect.closeTo(6, 12)])
  expect(result.maxSampleResidual).toBeCloseTo(6, 12)
  expect(result.rmsSampleResidual).toBeCloseTo(Math.sqrt(15), 12)
  const overwritten = unconstrained.coefficients[1][0]
  const overwriteError = (overwritten - 4) ** 2 + ((1 + overwritten) / 2 - 10) ** 2
  expect(result.residuals.reduce((sum, value) => sum + value ** 2, 0)).toBeLessThan(overwriteError)
  expect({ knots, multiplicities, samples, fixed }).toEqual(before)
})

it('scales after elimination and leaves an incompatible fixed seam observation in the residual', () => {
  const fixed: Point = [1e300, -0, 2]
  const samples = [
    { parameter: 0, value: [1e300, 0, 3] as Point },
    { parameter: 1, value: [1e-300, 0, -3] as Point },
  ]
  const result = fitFixed(1, [0, 1, 3], [1, 1, 1], samples, fixed)
  expect(result.coefficients[0]).toEqual(fixed)
  expect(result.coefficients[1][0] / 1e-300).toBeCloseTo(1, 12)
  expect(result.coefficients[1][1]).toBe(0)
  expect(result.residuals[0]).toBe(1)
  expect(result.residuals[1]).toBeLessThan(1e-12)
})

it('fixes the saturated seam coefficient for a target on a nonnested U basis', () => {
  const knots = [0, 1, 2, 3, 4], multiplicities = [2, 1, 1, 1, 2]
  // The review target has knots [0,0.5,2,3,4] and Z coefficients
  // [1,1,2,1,1]. Evaluate 1 + N analytically for N's knots [0,0.5,2,3].
  const target = (u: number) => 1 + (u < 0.5 ? u * u : u < 2 ?
    u * (2 - u) / 3 + 4 * (3 - u) * (u - 0.5) / 15 : u < 3 ? 2 * (3 - u) ** 2 / 5 : 0)
  const samples = Array.from({ length: 33 }, (_, i) => ({
    parameter: i / 8, value: [0, 0, target(i / 8)] as Point,
  }))
  const unconstrained = fitExperimentalPeriodicUVectorSamples(2, knots, multiplicities, samples)
  expect(unconstrained.coefficients[0][2]).toBeCloseTo(0.9669414339201139, 12)
  const result = fitFixed(2, knots, multiplicities, samples, [0, 0, 1])
  expect(result.coefficients[0]).toEqual([0, 0, 1])
  expect(result.rank).toBe(4)
  expect(result.residuals[0]).toBe(0)
  expect(result.residuals.at(-1)).toBe(0)

  const basis = prepareExperimentalPeriodicUBasis(2, knots, multiplicities)
  const valueAt = (coefficients: Point[], u: number) => {
    const { indices, values } = basis.evaluate(u)
    return indices.reduce((sum, index, j) => sum + values[j] * coefficients[index][2], 0)
  }
  const overwritten: Point[] = [[0, 0, 1], ...unconstrained.coefficients.slice(1)]
  const overwriteError = samples.reduce((sum, sample) =>
    sum + (valueAt(overwritten, sample.parameter) - sample.value[2]) ** 2, 0)
  expect(result.residuals.reduce((sum, value) => sum + value ** 2, 0)).toBeLessThan(overwriteError)
  const holdout = 45 / 32
  expect(samples.some(sample => sample.parameter === holdout)).toBe(false)
  expect(Math.abs(valueAt(result.coefficients, holdout) - target(holdout))).toBeGreaterThan(1e-3)
})

it('accepts one observation for one free column and refuses deficient or unresolved rank', () => {
  const fixed: Point = [2, 0, 1], sample = (parameter: number) => ({ parameter, value: [1, 0, 3] as Point })
  expect(fitFixed(1, [0, 1, 3], [1, 1, 1], [sample(1)], fixed)).toMatchObject({
    rank: 1, coefficients: [fixed, [1, 0, 3]], residuals: [0],
  })
  expect(() => fitFixed(1, [0, 1, 2, 3], [1, 1, 1, 1], [sample(1)], fixed)).toThrow(/campioni insufficienti/)
  expect(() => fitFixed(1, [0, 1, 3], [1, 1, 1], [sample(0), sample(3)], fixed)).toThrow(/rango numerico/)
  expect(() => fitFixed(1, [0, 1, 2, 3], [1, 1, 1, 1], [sample(1), sample(3 - 2 ** -51)], fixed))
    .toThrow(/rango numerico/)
})

it('rejects invalid fixed coefficients and unrepresentable elimination', () => {
  const fit = (samples: { parameter: number; value: Point }[], fixed: Point) =>
    fitFixed(1, [0, 1, 3], [1, 1, 1], samples, fixed)
  expect(() => fit([{ parameter: 1, value: [1, 0, 0] }], [NaN, 0, 0])).toThrow(/U0 fissato non valido/)
  const sparse: Point = [0, 0, 0]
  delete (sparse as number[])[1]
  expect(() => fit([{ parameter: 1, value: [1, 0, 0] }], sparse)).toThrow(/U0 fissato non valido/)
  expect(() => fit([{ parameter: 0, value: [Number.MAX_VALUE, 0, 0] }], [-Number.MAX_VALUE, 0, 0]))
    .toThrow(/sottrazione del coefficiente U0/)
  expect(() => fit([{ parameter: 0.5, value: [0, 0, 0] }], [Number.MIN_VALUE, 0, 0]))
    .toThrow(/sottrazione del coefficiente U0/)
})

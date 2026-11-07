// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Point } from '../brep'
import { prepareExperimentalPeriodicUBasis } from '../experimentalPeriodicUBasis'
import { fitExperimentalPeriodicUVectorSamples } from '../experimentalPeriodicUVectorFit'

it('recovers cubic coefficients on a nonuniform basis with repeated knots and a periodic seam', () => {
  const knots = [-3, -1, 0.5, 4, 7]
  const multiplicities = [2, 1, 2, 1, 2]
  const expected: Point[] = [[3, 1, -2], [0, -2, 4], [7, 0, 1], [-5, 4, 2], [2, 7, -1], [9, -3, 6]]
  const basis = prepareExperimentalPeriodicUBasis(3, knots, multiplicities)
  const parameters = knots.slice(0, -1).flatMap((a, i) => {
    const width = knots[i + 1] - a
    return [a, a + width / 8, a + width / 2, a + 7 * width / 8]
  })
  parameters.push(7, 7 - 2 ** -20, -3 + 2 ** -20)
  const samples = parameters.map(parameter => {
    const { indices, values } = basis.evaluate(parameter)
    const value = [0, 1, 2].map(axis => indices.reduce((sum, i, j) => sum + values[j] * expected[i][axis], 0)) as Point
    return { parameter, value }
  })
  const before = structuredClone({ knots, multiplicities, samples })

  const result = fitExperimentalPeriodicUVectorSamples(3, knots, multiplicities, samples)
  expect(result.rank).toBe(expected.length)
  expect(result.sampleCount).toBe(samples.length)
  expect(result.pivotRatio).toBeGreaterThan(0.1)
  expect(result.maxSampleResidual).toBeLessThan(1e-12)
  expect(result.rmsSampleResidual).toBeLessThan(1e-12)
  expect(result.evidenceScope).toBe('sampled-residual-only')
  for (const [i, point] of expected.entries()) {
    for (const [axis, coordinate] of point.entries()) expect(result.coefficients[i][axis]).toBeCloseTo(coordinate, 11)
  }
  expect({ knots, multiplicities, samples }).toEqual(before)
})

it('treats conflicting seam samples as separate observations and reports their residuals', () => {
  const result = fitExperimentalPeriodicUVectorSamples(1, [0, 1, 4, 5], [1, 1, 1, 1], [
    { parameter: 0, value: [0, 0, 0] },
    { parameter: 1, value: [1, 2, 3] },
    { parameter: 4, value: [7, 8, 9] },
    { parameter: 5, value: [4, -2, 0] },
    { parameter: 0.5, value: [1.5, 0.5, 1.5] },
  ])
  expect(result.coefficients[0][0]).toBeCloseTo(2, 13)
  expect(result.coefficients[0][1]).toBeCloseTo(-1, 13)
  expect(result.maxSampleResidual).toBeCloseTo(Math.sqrt(5), 13)
  expect(result.rmsSampleResidual).toBeCloseTo(Math.sqrt(2), 13)
  expect(result.residuals[0]).toBeCloseTo(Math.sqrt(5), 13)
  expect(result.residuals[3]).toBeCloseTo(Math.sqrt(5), 13)
  for (const index of [1, 2, 4]) expect(result.residuals[index]).toBeLessThan(1e-13)
})

it('scales the three vector coordinates independently without losing tiny coordinates', () => {
  const result = fitExperimentalPeriodicUVectorSamples(1, [0, 1, 3], [1, 1, 1], [
    { parameter: 0, value: [2e300, -2e-300, 0] },
    { parameter: 1, value: [-4e300, 4e-300, 0] },
    { parameter: 0.5, value: [-1e300, 1e-300, 0] },
  ])
  expect(result.coefficients[0][0] / 1e300).toBeCloseTo(2, 13)
  expect(result.coefficients[0][1] / 1e-300).toBeCloseTo(-2, 13)
  expect(result.coefficients[1][0] / 1e300).toBeCloseTo(-4, 13)
  expect(result.coefficients[1][1] / 1e-300).toBeCloseTo(4, 13)
  expect(result.coefficients.map(point => point[2])).toEqual([0, 0])
  expect(result.maxSampleResidual / 1e300).toBeLessThan(1e-13)
  expect(() => fitExperimentalPeriodicUVectorSamples(1, [0, 1, 3], [1, 1, 1], [
    { parameter: 0, value: [1e300, 0, 0] },
    { parameter: 1, value: [1e-300, 0, 0] },
  ])).toThrow(/scala dei campioni non rappresentabile/)
})

it('rejects missing samples, deficient rank and numerical rank loss', () => {
  const fit = (parameters: number[]) => fitExperimentalPeriodicUVectorSamples(1, [0, 1, 3], [1, 1, 1],
    parameters.map(parameter => ({ parameter, value: [1, 2, 3] })))
  expect(() => fit([0])).toThrow(/campioni insufficienti/)
  expect(() => fit([0, 3, 0])).toThrow(/rango numerico insufficiente/)
  expect(() => fit([0, Number.EPSILON])).toThrow(/rango numerico insufficiente/)
})

it('rejects nonfinite, sparse or out-of-period samples', () => {
  const valid = { parameter: 1, value: [1, 2, 3] as Point }
  const sparse = [1, 2, 3] as Point
  delete (sparse as number[])[1]
  const fit = (parameter: number, value: Point) => fitExperimentalPeriodicUVectorSamples(1, [0, 1, 3], [1, 1, 1],
    [valid, { parameter, value }])
  expect(() => fit(0, sparse)).toThrow(/campione non finito o incompleto/)
  expect(() => fit(0, [0, Infinity, 0])).toThrow(/campione non finito o incompleto/)
  expect(() => fit(NaN, valid.value)).toThrow(/campione non finito o incompleto/)
  expect(() => fit(4, valid.value)).toThrow(/parametro fuori periodo/)
  expect(() => fitExperimentalPeriodicUVectorSamples(1, [0, 1, 3], [1, 1, 1], null as never))
    .toThrow(/devono essere array/)
  expect(() => fitExperimentalPeriodicUVectorSamples(1, {} as never, [1, 1, 1], [valid]))
    .toThrow(/devono essere array/)
})

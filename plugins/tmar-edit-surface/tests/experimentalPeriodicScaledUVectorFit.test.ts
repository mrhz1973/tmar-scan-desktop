// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Point } from '../brep'
import { fitExperimentalPeriodicUVectorSamplesWithFixedFirst as fitOriginal,
  fitExperimentalPeriodicUVectorSamplesWithScaledFreeColumns as fitScaled } from '../experimentalPeriodicUVectorFit'

const knots = [0, 1, 2, 4], multiplicities = [2, 1, 1, 2]
const sample = (parameter: number, x: number, y = 0, z = 0) => ({ parameter, value: [x, y, z] as Point })
const fixed: Point = [0, -0, 0]

function weaklyObservedSamples(step: number) {
  // In the first span N3 vanishes. On the second, N3(u)=(u−1)^2/3.
  return [0, 0.25, 0.5, 0.75, 1, 1 + step, 1 + 2 * step, 1 + 3 * step, 4]
    .map(u => sample(u, u > 1 && u < 2 ? 2 * (u - 1) ** 2 / 3 : 0))
}

it('separates weak raw support from the scaled pivots on a nonuniform U basis', () => {
  const samples = weaklyObservedSamples(2 ** -14)
  const before = structuredClone({ samples, knots, multiplicities, fixed })
  const original = fitOriginal(2, knots, multiplicities, samples, fixed)
  const scaled = fitScaled(2, knots, multiplicities, samples, fixed)
  expect(scaled.rank).toBe(3)
  expect(scaled.coefficients[0]).toEqual(fixed)
  expect(scaled.coefficients[0]).not.toBe(fixed)
  expect(scaled).not.toHaveProperty('pivotRatio')
  expect(original.pivotRatio).toBeLessThan(1e-7)
  expect(scaled.scaledPivotRatio).toBeGreaterThan(0.1)
  const weights = samples.map(({ value }) => value[0] / 2)
  expect(scaled.rawColumnNorms.min).toBeCloseTo(Math.hypot(...weights), 18)
  expect(scaled.rawColumnNorms.minOverMax).toBeLessThan(1e-7)
  expect(scaled.rawColumnNorms.minRmsWeight).toBeCloseTo(Math.hypot(...weights) / 3, 18)
  expect(scaled.coefficients[3][0]).toBeCloseTo(2, 12)
  expect(original.coefficients[3][0]).toBeCloseTo(2, 12)
  expect(scaled.maxSampleResidual).toBeLessThan(1e-21)
  expect(original.maxSampleResidual).toBeLessThan(1e-21)
  expect({ samples, knots, multiplicities, fixed }).toEqual(before)
})

it('recovers the analytical coefficient on a synthetic scale that defeats the original pivot test', () => {
  const samples = weaklyObservedSamples(2 ** -28)
  expect(() => fitOriginal(2, knots, multiplicities, samples, fixed)).toThrow(/rango numerico/)
  const scaled = fitScaled(2, knots, multiplicities, samples, fixed)
  expect(scaled.coefficients[3][0]).toBeCloseTo(2, 12)
  expect(scaled.rawColumnNorms.min).toBeLessThan(1e-15)
  expect(scaled.maxSampleResidual).toBeLessThan(1e-30)
})

it('exposes low absolute support even when both relative ratios are one', () => {
  const u = 2 ** -42
  const result = fitScaled(1, [0, 0.5, 1], [1, 1, 1], [sample(0, 0), sample(u, 8 * u), sample(1, 0)], fixed)
  expect(result.coefficients[1][0]).toBeCloseTo(4, 12)
  expect(result.scaledPivotRatio).toBe(1)
  expect(result.rawColumnNorms).toEqual({ min: 2 * u, max: 2 * u, minOverMax: 1, minRmsWeight: 2 * u / Math.sqrt(3) })
})

it('rejects an unobserved column and dependent nonzero columns after scaling', () => {
  const onlyFirstSpan = [sample(0.25, 1), sample(0.5, 2), sample(0.75, 3)]
  expect(() => fitScaled(2, knots, multiplicities, onlyFirstSpan, fixed)).toThrow(/colonna libera nulla/)
  const identical = [sample(1.5, 1), sample(1.5, 2), sample(1.5, 3)]
  expect(() => fitOriginal(2, knots, multiplicities, identical, fixed)).toThrow(/rango numerico/)
  expect(() => fitScaled(2, knots, multiplicities, identical, fixed)).toThrow(/rango numerico/)
})

it('still reports a small scaled pivot ratio for correlated columns with similar raw support', () => {
  const samples = Array.from({ length: 7 }, (_, i) => sample(1.5 + (i - 3) * 2 ** -13, 1))
  const result = fitScaled(2, knots, multiplicities, samples, fixed)
  expect(result.rank).toBe(3)
  expect(result.rawColumnNorms.minOverMax).toBeGreaterThan(0.1)
  expect(result.scaledPivotRatio).toBeLessThan(1e-6)
  expect(result.maxSampleResidual).toBeLessThan(1e-12)
})

it('recomputes the constrained residual on original samples and their original axis scales', () => {
  const samples = [sample(0, 1, 0, 1e200), sample(1, 4, 0, 0), sample(0.5, 10, 0, 0)]
  const result = fitScaled(1, [0, 1, 3], [1, 1, 1], samples, [1, -0, 0])
  // The free X coefficient solves [0, 1, 1/2] · x ≈ [0, 4, 19/2].
  expect(result.coefficients[1]).toEqual([expect.closeTo(7, 12), 0, 0])
  expect(result.residuals).toEqual([1e200, expect.closeTo(3, 12), expect.closeTo(6, 12)])
  expect(result.maxSampleResidual).toBe(1e200)
  expect(result.rmsSampleResidual / 1e200).toBeCloseTo(1 / Math.sqrt(3), 15)
})

it('combines extreme exponents and refuses unrepresentable elimination, normalization and coefficients', () => {
  const fit = (samples: ReturnType<typeof sample>[], first = fixed) => fitScaled(1, [0, 0.5, 1], [1, 1, 1], samples, first)
  const tiny = Number.MIN_VALUE
  expect(fit([sample(tiny, 2 * tiny)]).coefficients[1][0]).toBe(1)
  expect(() => fit([sample(tiny, Number.MAX_VALUE)])).toThrow(/coefficiente de-equilibrato/)
  expect(() => fit([sample(0.5, tiny), sample(0.5, 0), sample(0.5, 0)])).toThrow(/coefficiente de-equilibrato/)
  expect(() => fit([sample(0.25, tiny), sample(0.5, Number.MAX_VALUE)])).toThrow(/equilibratura non rappresentabile/)
  expect(() => fit([sample(0, Number.MAX_VALUE)], [-Number.MAX_VALUE, 0, 0])).toThrow(/sottrazione del coefficiente U0/)
})

it('refuses a round-trippable subnormal input before a reflector can erase it', () => {
  const u = 2 ** -100
  const samples = [sample(u, 0), sample(u, 0), sample(u, 0), sample(u, 2 ** -51), sample(2, 2 ** 1023)]
  // Four rows observe only U1 with weight 2^-100. Their mean X divided
  // by that weight is 2^47. The isolated U2 row sets the RHS scale, so the
  // only nonzero normalized U1 observation is MIN_VALUE.
  expect(() => fitScaled(1, [0, 1, 2, 3], [1, 1, 1, 1], samples, fixed)).toThrow(/ingresso equilibrato subnormale/)
})

it('refuses underflow in a reflector product even when both normalized factors are normal', () => {
  const samples = [sample(2 ** -500, 0), sample(2 ** -600, 2), sample(2, 2 ** 1023)]
  // The two U1 weights are in ratio 2^-100 and the normalized nonzero
  // U1 observation is 2^-1022. Their product underflows inside the QR.
  expect(() => fitScaled(1, [0, 1, 2, 3], [1, 1, 1, 1], samples, fixed)).toThrow(/termine QR equilibrato/)
})

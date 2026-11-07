// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { mapPeriodicKnotsAffineRounded } from '../experimentalPeriodicAffineKnotMap'
import { generateExperimentalPeriodicIndependentSamples } from '../experimentalPeriodicIndependentSamples'
import { prepareExperimentalPeriodicUBasis } from '../experimentalPeriodicUBasis'
import { certifyExperimentalPeriodicUFitCoefficients } from '../experimentalPeriodicUFitCertificate'
import { boundExperimentalPeriodicUObservationGram } from '../experimentalPeriodicUObservationGram'
import { fitExperimentalPeriodicUVectorSamplesWithFixedFirst,
  fitExperimentalPeriodicUVectorSamplesWithScaledFreeColumns } from '../experimentalPeriodicUVectorFit'
import type { Point } from '../brep'

const simple = { degree: 1, knots: [0, 1, 3], multiplicities: [1, 1, 1],
  parameters: [0, 0.5, 1, 3], maxRows: 16, maxFreeColumns: 2 }

it('encloses the inverse norm and smallest eigenvalue for an exact one-column observation design', () => {
  // Removing U0 leaves weights [0, 1/2, 1, 0], so G=[5/4].
  const result = boundExperimentalPeriodicUObservationGram(simple)
  expect(result.status).toBe('certified-full-rank')
  if (result.status !== 'certified-full-rank') throw new Error(result.reason)
  expect(result.size).toEqual({ rows: 4, freeColumns: 1 })
  expect(result.inverseInfinityNormUpper).toBeGreaterThanOrEqual(0.8)
  expect(result.inverseInfinityNormUpper).toBeLessThan(0.800000000001)
  expect(result.minimumEigenvalueLower).toBeLessThanOrEqual(1.25)
  expect(result.minimumEigenvalueLower).toBeGreaterThan(1.249999999999)
})

it('returns no bounds for deficient, invalid or over-budget observations', () => {
  const correlated = { degree: 2, knots: [0, 1, 2, 4], multiplicities: [2, 1, 1, 2],
    parameters: [1.5, 1.5, 1.5], maxRows: 16, maxFreeColumns: 3 }
  const deficient = boundExperimentalPeriodicUObservationGram(correlated)
  expect(deficient.status).toBe('inconclusive')
  expect(deficient).not.toHaveProperty('inverseInfinityNormUpper')
  expect(boundExperimentalPeriodicUObservationGram({ ...correlated, parameters: [1.5] })).toMatchObject({
    status: 'inconclusive', reason: 'insufficient-observations',
  })
  expect(boundExperimentalPeriodicUObservationGram({ ...simple, parameters: [0, Number.NaN] })).toMatchObject({
    status: 'inconclusive', reason: 'invalid-input',
  })
  expect(boundExperimentalPeriodicUObservationGram({ ...simple, maxRows: 3 })).toMatchObject({
    status: 'inconclusive', reason: 'work-budget',
  })
  expect(boundExperimentalPeriodicUObservationGram({ ...correlated, maxFreeColumns: 2 })).toMatchObject({
    status: 'inconclusive', reason: 'work-budget',
  })
})

it('distinguishes a full-rank weak observation from a small coefficient error', () => {
  const u = 2 ** -100
  const result = boundExperimentalPeriodicUObservationGram({
    degree: 1, knots: [0, 1, 2, 3], multiplicities: [1, 1, 1, 1],
    parameters: [u, u, u, u, 2], maxRows: 5, maxFreeColumns: 2,
  })
  if (result.status !== 'certified-full-rank') throw new Error(result.reason)
  // G=diag(2^-198,1). Ignoring one observation of size 2^-51 in
  // the first column gives a normal-equation residual of 2^-151 but
  // a coefficient error of 2^47. Rank alone does not accept the fit.
  expect(result.minimumEigenvalueLower).toBeLessThanOrEqual(2 ** -198)
  expect(result.inverseInfinityNormUpper * 2 ** -151).toBeGreaterThanOrEqual(2 ** 47)
})

it('certifies 237/95-span synthetic observations even though the scaled QR refuses a subnormal fill-in', () => {
  const count = 237, degree = 3
  const knots = Array.from({ length: count + 1 }, (_, i) => 250 * (i / count))
  const multiplicities = [degree, ...Array<number>(count - 1).fill(1), degree]
  const supportKnots = Array.from({ length: 96 }, (_, i) => 3 + 17 * (i / 95) ** 2)
  const grids = generateExperimentalPeriodicIndependentSamples({
    edgePeriod: [0, 5], lateral: { knots, uAtEdgeEnds: [0, 250] },
    support: { knots: supportKnots, uAtEdgeEnds: [3, 20] },
    training: { perSpan: 3, minimumInterior: 10 }, holdout: { perSpan: 2, minimumInterior: 8 },
    searchDepth: 6, maxAttempts: 16_384,
  })
  if (grids.status !== 'generated') throw new Error(grids.reason)
  const parameters = mapPeriodicKnotsAffineRounded(grids.training, 0, 250).knots.slice(0, -1)
  const result = boundExperimentalPeriodicUObservationGram({
    degree, knots, multiplicities, parameters, maxRows: 1000, maxFreeColumns: 250,
  })
  if (result.status !== 'certified-full-rank') throw new Error(result.reason)
  expect(result.size).toEqual({ rows: 741, freeColumns: 238 })
  expect(result.inverseResidualUpper).toBeLessThan(1e-12)
  expect(result.inverseInfinityNormUpper).toBeLessThan(24)
  expect(result.minimumEigenvalueLower).toBeGreaterThan(1 / 24)

  const fixed: Point = [0, 0, 0]
  const zeroSamples = parameters.map(parameter => ({ parameter, value: fixed }))
  expect(() => fitExperimentalPeriodicUVectorSamplesWithScaledFreeColumns(degree, knots, multiplicities, zeroSamples, fixed))
    .toThrow(/termine QR equilibrato/)

  const basis = prepareExperimentalPeriodicUBasis(degree, knots, multiplicities)
  const coefficients = [2, 119, 237], factors = [2, 0.5, 4]
  const samples = parameters.map(parameter => {
    const { indices, values } = basis.evaluate(parameter)
    // A single power-of-two product per component yields exact observations
    // of the chosen coefficient vectors in this binary64 design.
    const value = coefficients.map((index, axis) => {
      const weight = values[indices.indexOf(index)] ?? 0
      const observation = weight * factors[axis]
      if (observation / factors[axis] !== weight) throw new Error('Nonexact synthetic observation')
      return observation
    }) as Point
    return { parameter, value }
  })
  expect(() => fitExperimentalPeriodicUVectorSamplesWithScaledFreeColumns(degree, knots, multiplicities, samples, fixed))
    .toThrow(/termine QR equilibrato/)
  const legacy = fitExperimentalPeriodicUVectorSamplesWithFixedFirst(degree, knots, multiplicities, samples, fixed)
  expect(legacy.maxSampleResidual).toBeLessThan(1e-13)
  for (const [axis, index] of coefficients.entries())
    expect(legacy.coefficients[index][axis]).toBeCloseTo(factors[axis], 13)

  const certificate = certifyExperimentalPeriodicUFitCoefficients({
    degree, knots, multiplicities, samples, fixedFirst: fixed, coefficients: legacy.coefficients,
    maxCoefficientError: [1e-12, 1e-12, 1e-12], maxRows: 1000, maxFreeColumns: 250,
  })
  if (certificate.status !== 'certified') throw new Error(certificate.reason)
  for (const [axis, index] of coefficients.entries())
    expect(certificate.coefficientErrorInfinityUpper[axis]).toBeGreaterThanOrEqual(Math.abs(legacy.coefficients[index][axis] - factors[axis]))
})

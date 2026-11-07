// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Point } from '../brep'
import { certifyExperimentalPeriodicUFitCoefficients,
  type ExperimentalPeriodicUFitCertificateRequest } from '../experimentalPeriodicUFitCertificate'
import { fitExperimentalPeriodicUVectorSamplesWithFixedFirst } from '../experimentalPeriodicUVectorFit'

const zero: Point = [0, 0, 0]
const sample = (parameter: number, x: number) => ({ parameter, value: [x, 0, 0] as Point })

function fixture(): ExperimentalPeriodicUFitCertificateRequest {
  const fixedFirst: Point = [2, -0, 4], free: Point = [6, 2, -8]
  return {
    degree: 1, knots: [0, 1, 3], multiplicities: [1, 1, 1],
    samples: [
      { parameter: 0, value: fixedFirst }, { parameter: 0.5, value: [4, 1, -2] },
      { parameter: 1, value: free }, { parameter: 3, value: fixedFirst },
    ],
    fixedFirst, coefficients: [fixedFirst, free], maxCoefficientError: [1e-12, 1e-12, 1e-12],
    maxRows: 16, maxFreeColumns: 4,
  }
}

function inconclusiveWithBound(result: ReturnType<typeof certifyExperimentalPeriodicUFitCoefficients>) {
  if (result.status !== 'inconclusive' || result.reason !== 'coefficient-error-not-certified')
    throw new Error(`Expected a coefficient error bound above tolerance: ${JSON.stringify(result)}`)
  return result
}

it('certifies an exact multiaxis fixed-U0 fit without mutating any input', () => {
  const request = fixture(), before = structuredClone(request)
  const result = certifyExperimentalPeriodicUFitCoefficients(request)
  expect(result.status).toBe('certified')
  if (result.status !== 'certified') throw new Error(result.reason)
  expect(result.gram.status).toBe('certified-full-rank')
  for (const bound of result.coefficientErrorInfinityUpper) expect(bound).toBeLessThan(1e-12)
  expect(request).toEqual(before)

  const endpoints = certifyExperimentalPeriodicUFitCoefficients({ ...request,
    samples: request.samples.filter(({ parameter }) => parameter !== 0.5), maxCoefficientError: zero,
  })
  expect(endpoints).toMatchObject({ status: 'certified', coefficientErrorInfinityUpper: zero })
})

it('bounds a deliberate coefficient perturbation around an inconsistent least-squares problem', () => {
  // After eliminating fixed X=1, the free weights are [0,1,1/2], and
  // the RHS is [0,4,19/2]. The unique minimizer is X=7.
  const request: ExperimentalPeriodicUFitCertificateRequest = { ...fixture(),
    fixedFirst: [1, 0, 0], samples: [sample(0, 1), sample(1, 4), sample(0.5, 10)],
    coefficients: [[1, 0, 0], [7.125, 0, 0]], maxCoefficientError: [0.12, 0, 0],
  }
  const rejected = inconclusiveWithBound(certifyExperimentalPeriodicUFitCoefficients(request))
  expect(rejected.coefficientErrorInfinityUpper[0]).toBeGreaterThanOrEqual(0.125)
  expect(rejected.coefficientErrorInfinityUpper[0]).toBeLessThan(0.126)
  expect(rejected.normalResidualInfinityUpper[0]).toBeGreaterThanOrEqual(5 / 32)
  expect(certifyExperimentalPeriodicUFitCoefficients({ ...request, maxCoefficientError: [0.13, 0, 0] }).status).toBe('certified')
})

it('rejects a weakly observed coefficient error despite a small training residual and full rank', () => {
  const u = 2 ** -100
  const request: ExperimentalPeriodicUFitCertificateRequest = { ...fixture(),
    knots: [0, 1, 2, 3], multiplicities: [1, 1, 1, 1],
    samples: [sample(u, 0), sample(u, 0), sample(u, 0), sample(u, 2 ** -51), sample(2, 0)],
    fixedFirst: zero, coefficients: [zero, zero, zero], maxCoefficientError: [1, 0, 0],
  }
  const result = inconclusiveWithBound(certifyExperimentalPeriodicUFitCoefficients(request))
  // G=diag(2^-198,1), g=(2^-151,0). The true coefficient error is 2^47.
  expect(result).toMatchObject({ status: 'inconclusive', reason: 'coefficient-error-not-certified',
    gram: { status: 'certified-full-rank' },
  })
  expect(result.coefficientErrorInfinityUpper[0]).toBeGreaterThanOrEqual(2 ** 47)
  expect(result.coefficientErrorInfinityUpper[0]).toBeLessThan(2 ** 48)
})

it('includes loss in the solver’s rounded elimination of the fixed coefficient', () => {
  const fixedFirst: Point = [2 ** 53 + 2, 0, 0]
  const samples = [sample(0.25, 6_755_399_441_055_746)]
  const request = { ...fixture(), fixedFirst, samples, coefficients: [fixedFirst, zero], maxCoefficientError: [1, 0, 0] as Point }
  const legacy = fitExperimentalPeriodicUVectorSamplesWithFixedFirst(1, request.knots, request.multiplicities, samples, fixedFirst)
  expect(Math.abs(legacy.coefficients[1][0])).toBe(0)
  // The binary64 product .75*fixed rounds to the observation, but the
  // exact product ends in .5. Thus b=+.5 and the exact free coefficient is 2.
  const result = inconclusiveWithBound(certifyExperimentalPeriodicUFitCoefficients(request))
  expect(result.coefficientErrorInfinityUpper[0]).toBeGreaterThanOrEqual(2)
})

it('encloses a positive underflow and refuses overflow in the residual or final bound', () => {
  const request = { ...fixture(), fixedFirst: zero, coefficients: [zero, zero], maxCoefficientError: zero }
  // g = MIN_VALUE/2, which would round to zero without an enclosure.
  const tiny = inconclusiveWithBound(certifyExperimentalPeriodicUFitCoefficients({
    ...request, samples: [sample(0.5, Number.MIN_VALUE), sample(1, 0)],
  }))
  expect(tiny.coefficientErrorInfinityUpper[0]).toBeGreaterThanOrEqual(Number.MIN_VALUE)

  // Weight 2^-500 times observation 2^-600 gives g=2^-1100. The
  // Gram inverse magnifies this underflow to a true error of 2^-100.
  const amplified = inconclusiveWithBound(certifyExperimentalPeriodicUFitCoefficients({ ...request,
    knots: [0, 0.5, 1], samples: [sample(2 ** -501, 2 ** -600)], maxCoefficientError: [2 ** -101, 0, 0],
  }))
  expect(amplified.normalResidualInfinityUpper[0]).toBeGreaterThanOrEqual(Number.MIN_VALUE)
  expect(amplified.coefficientErrorInfinityUpper[0]).toBeGreaterThanOrEqual(2 ** -100)

  const residual = certifyExperimentalPeriodicUFitCoefficients({ ...request,
    samples: [sample(1, Number.MAX_VALUE)], coefficients: [zero, [-Number.MAX_VALUE, 0, 0]],
  })
  const bound = certifyExperimentalPeriodicUFitCoefficients({ ...request, samples: [sample(2 ** -100, 1e300)] })
  for (const result of [residual, bound]) {
    expect(result).toMatchObject({ status: 'inconclusive', reason: 'interval-arithmetic-refused' })
    expect(result).not.toHaveProperty('coefficientErrorInfinityUpper')
  }
})

it('requires full rank, fixed U0 and finite dense data within the specified work limits', () => {
  const request = fixture()
  expect(certifyExperimentalPeriodicUFitCoefficients({ ...request, samples: [sample(0, 1), sample(3, 1)] })).toMatchObject({
    status: 'inconclusive', reason: 'observation-gram-inconclusive',
  })
  expect(certifyExperimentalPeriodicUFitCoefficients({ ...request, fixedFirst: [2, 0, 4] })).toMatchObject({
    status: 'inconclusive', reason: 'fixed-coefficient-mismatch',
  })
  expect(certifyExperimentalPeriodicUFitCoefficients({ ...request, maxRows: 3 })).toMatchObject({
    status: 'inconclusive', reason: 'work-budget',
  })
  for (const malformed of [
    { ...request, maxCoefficientError: [Infinity, 0, 0] as Point },
    { ...request, maxCoefficientError: [-1, 0, 0] as Point },
    { ...request, coefficients: [request.fixedFirst] },
    { ...request, samples: [request.samples[0], , request.samples[2]] as typeof request.samples },
  ]) {
    expect(certifyExperimentalPeriodicUFitCoefficients(malformed)).toMatchObject({ status: 'inconclusive', reason: 'invalid-input' })
  }
})

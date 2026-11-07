// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { measureExperimentalPeriodicQuinticSide, measureExperimentalPeriodicQuinticSideCertifiedFit,
  measureExperimentalPeriodicQuinticSideScaled, type ExperimentalPeriodicQuinticCertifiedFitBudgets,
  type ExperimentalPeriodicQuinticScaledBudgets,
  type ExperimentalPeriodicQuinticSideDiagnosticRequest } from '../experimentalPeriodicQuinticSideDiagnostic'

// Exact first-span insertion at 1/2 in the saturated quadratic U basis,
// followed by reversal about the same seam.
function refineReverse([a, b, c, d]: Point[]): Point[] {
  return [a, d, c, b.map((x, i) => (3 * x + c[i]) / 4) as Point,
    a.map((x, i) => (x + b[i]) / 2) as Point]
}

function fixture(nextToSeamTarget = 5, supportVWidth = 2): ExperimentalPeriodicQuinticSideDiagnosticRequest {
  const ring: Point[] = [[0, 0, 0], [1, 2 ** -35, 0], [2, 2, 0], [-2, 0, 0]]
  const kv = [0, 2, 5, 7, 9, 12, 16, 20], mv = [6, 1, 1, 1, 1, 1, 1, 6]
  const full = kv.flatMap((knot, i) => Array<number>(mv[i]).fill(knot))
  const heights = Array.from({ length: 12 }, (_, i) => full.slice(i + 1, i + 6).reduce((sum, knot) => sum + knot, 0))
  const lateral: Net = {
    du: 2, dv: 5, nu: 4, nv: 12, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 4], mu: [2, 1, 1, 2], kv, mv,
    poles: ring.flatMap(([x, y]) => heights.map((z): Point => [x, y, z])),
    weights: Array<number>(48).fill(1),
  }
  const border = refineReverse(ring)
  const target = refineReverse([[0, 0, 5], [0, 0, nextToSeamTarget], [0, 1, 8], [0, 0, 5]])
  const support: Net = {
    ...lateral, nu: 5, nv: 2, dv: 1, ku: [20, 24, 26, 27, 28], mu: [2, 1, 1, 1, 2],
    kv: [0, supportVWidth], mv: [2, 2], weights: Array<number>(10).fill(1),
    poles: border.flatMap((point, u): Point[] =>
      [point.map((x, axis) => x - supportVWidth * target[u][axis]) as Point, point]),
  }
  return {
    lateral: { net: lateral, edge: 'V0', uAtEdgeEnds: [0, 4] },
    support: { net: support, edge: 'V1', uAtEdgeEnds: [28, 20] },
    edgePeriod: [0, 4], lambda: 1,
    training: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4],
    holdout: [0, 0.125, 0.375, 0.625, 0.875, 1.125, 1.625, 2.25, 2.75, 3.25, 3.75, 4],
    budgets: {
      sampledPositionGap: 1e-12, seamDerivativeGap: 1e-9, minimumPivotRatio: 0.1,
      trainingDerivativeResidual: 1e-11, holdoutDerivativeResidual: 1e-11,
      storageDerivativeResidual: 1e-11, secondDerivativeChange: 1e-11, displacement: 6,
      minimumSampledNormalNorm: 0.1, jointNormalChord: 1e-10,
    },
  }
}

it('uses the fixed seam coefficient and measures the stored lateral proposal on disjoint holdout', () => {
  const request = fixture(), before = structuredClone(request)
  const result = measureExperimentalPeriodicQuinticSide(request)
  if (result.status !== 'diagnostic-only') throw new Error(`${result.phase}: ${result.reason}`)
  expect(request).toEqual(before)
  expect(result.evidence.fit).toMatchObject({ fixedFirst: [0, 0, 5], freeRank: 3, expectedFreeRank: 3 })
  expect(result.evidence.trainingCount).toBe(11)
  expect(result.evidence.holdoutInteriorCount).toBe(10)
  expect(result.evidence.sourceSeam?.maxDerivativeDifferenceBound).toBe(2 ** -34)
  expect(result.evidence.supportSeam?.status).toBe('within-tolerance')
  expect(result.evidence.candidateSeam?.status).toBe('within-tolerance')
  expect(result.evidence.maxStoredHoldoutResidual!.value).toBeLessThan(1e-11)
  expect(result.evidence.originalJointNormalChord!.value).toBeGreaterThan(0.01)
  expect(result.evidence.candidateJointNormalChord!.value).toBeLessThan(1e-10)
  expect(result.evidence.minimumCandidateNormalDot!.value).toBeGreaterThan(1 - 1e-12)
  expect(result.evidence.proposal!.maxPositionDisplacementBound).toBeCloseTo(5.6, 10)
  for (const [i, point] of result.candidate.poles.entries()) {
    if (i < 12 || (i % 12 !== 1 && i % 12 !== 2)) expect(point).toEqual(request.lateral.net.poles[i])
  }
})

it('uses the inward U0 derivative when the mobile border is V1', () => {
  const request = fixture(), net = request.lateral.net
  const first = net.kv[0], last = net.kv.at(-1)!
  net.kv = net.kv.map(knot => first + last - knot).reverse()
  net.mv.reverse()
  net.poles = Array.from({ length: net.nu }, (_, u) => net.poles.slice(u * net.nv, (u + 1) * net.nv).reverse()).flat()
  request.lateral.edge = 'V1'
  const result = measureExperimentalPeriodicQuinticSide(request)
  if (result.status !== 'diagnostic-only') throw new Error(`${result.phase}: ${result.reason}`)
  expect(result.evidence.fit?.fixedFirst).toEqual([0, 0, 5])
  expect(result.evidence.maxStoredHoldoutResidual!.value).toBeLessThan(1e-11)
  expect(result.evidence.candidateJointNormalChord!.value).toBeLessThan(1e-10)
  for (const [i, point] of result.candidate.poles.entries()) {
    if (i < 12 || (i % 12 !== 9 && i % 12 !== 10)) expect(point).toEqual(net.poles[i])
  }
})

it('refuses a position mismatch and a holdout overlap with their sampled location', () => {
  const mismatch = fixture()
  mismatch.support.net.poles[4][0] += 0.25
  mismatch.support.net.poles[5][0] += 0.25
  const gap = measureExperimentalPeriodicQuinticSide(mismatch)
  expect(gap).toMatchObject({ status: 'declined', phase: 'sampling', reason: expect.stringMatching(/gap campionato/) })
  if (gap.status === 'diagnostic-only') throw new Error('Expected sampled mismatch refusal')
  expect(gap.location?.t).toBeGreaterThan(0)
  expect('candidate' in gap).toBe(false)

  const overlap = measureExperimentalPeriodicQuinticSide({ ...fixture(), holdout: [0, 0.25, 4] })
  expect(overlap).toMatchObject({ status: 'declined', phase: 'sampling', location: { t: 0.25 },
    reason: expect.stringMatching(/sovrapposto/) })
})

it('declines insufficient free rank, a strict pivot gate and a holdout residual over budget', () => {
  const request = fixture()
  const rank = measureExperimentalPeriodicQuinticSide({ ...request, training: [0, 0.5, 4] })
  expect(rank).toMatchObject({ status: 'declined', phase: 'fit', reason: expect.stringMatching(/rango/) })
  const pivot = measureExperimentalPeriodicQuinticSide({ ...request, budgets: { ...request.budgets, minimumPivotRatio: 1 } })
  expect(pivot).toMatchObject({ status: 'declined', phase: 'fit', reason: expect.stringMatching(/pivot/) })
  expect(pivot.evidence.fit!.pivotRatio).toBeLessThan(1)

  // Change the support field in a degree of freedom created by knot
  // insertion. The protected border positions remain exactly the same.
  request.support.net.poles[6][2] -= 2
  request.budgets.trainingDerivativeResidual = 1
  request.budgets.holdoutDerivativeResidual = 1e-4
  const holdout = measureExperimentalPeriodicQuinticSide(request)
  expect(holdout).toMatchObject({ status: 'declined', phase: 'fit', reason: expect.stringMatching(/residuo holdout/) })
  expect(holdout.evidence.maxFittedHoldoutResidual!.value).toBeGreaterThan(1e-4)
  expect('candidate' in holdout).toBe(false)
})

it('withholds candidates on source or stored seam uncertainty and on displacement or lock stops', () => {
  const request = fixture()
  const source = measureExperimentalPeriodicQuinticSide({ ...request, budgets: { ...request.budgets, seamDerivativeGap: 0 } })
  expect(source).toMatchObject({ status: 'inconclusive', phase: 'source-seam' })
  // A short fixed V interval keeps its surface seam gap small even for
  // a target derivative field that can enlarge the mobile seam gap.
  const stored = measureExperimentalPeriodicQuinticSide(fixture(6, 2 ** -35))
  expect(stored).toMatchObject({ status: 'inconclusive', phase: 'candidate-seam' })
  const displacement = measureExperimentalPeriodicQuinticSide({ ...request, budgets: { ...request.budgets, displacement: 1 } })
  expect(displacement).toMatchObject({ status: 'inconclusive', phase: 'proposal', reason: expect.stringMatching(/spostamento/) })
  const lock = measureExperimentalPeriodicQuinticSide({ ...request, lockIndices: [26] })
  expect(lock).toMatchObject({ status: 'declined', phase: 'proposal', reason: expect.stringMatching(/bloccato 26/) })
  for (const result of [source, stored, displacement, lock]) expect('candidate' in result).toBe(false)
})

it('declines an unproved fixed-support seam before fitting', () => {
  const request = fixture()
  request.support.net.poles[2][0] += 0.25
  const result = measureExperimentalPeriodicQuinticSide(request)
  expect(result).toMatchObject({
    status: 'inconclusive', phase: 'support-seam', reason: 'bound-exceeds-tolerance',
    evidence: { sourceSeam: { status: 'within-tolerance' }, supportSeam: { status: 'inconclusive' } },
  })
  expect(result.evidence.fit).toBeUndefined()
  expect('candidate' in result).toBe(false)
})

function scaledFixture(): ExperimentalPeriodicQuinticSideDiagnosticRequest<ExperimentalPeriodicQuinticScaledBudgets> {
  const request = fixture()
  const { minimumPivotRatio: _minimumPivotRatio, ...budgets } = request.budgets
  return { ...request, budgets: { ...budgets,
    minimumRawColumnRmsWeight: 1e-3, minimumRawColumnNormRatio: 0.1, minimumScaledPivotRatio: 0.1,
    storedHoldoutDerivativeResidual: 1e-11,
  } }
}

it('keeps the raw absolute and relative support gates distinct even with healthy scaled pivots', () => {
  const request = scaledFixture(), step = 2 ** -14
  request.training = [0, 0.25, 0.5, 0.75, 1, 1 + step, 1 + 2 * step, 1 + 3 * step, 4]
  const rms = measureExperimentalPeriodicQuinticSideScaled(request)
  expect(rms).toMatchObject({ status: 'declined', phase: 'fit', reasonCode: 'raw-column-rms-below-budget' })
  expect(rms.evidence.fit!.scaledPivotRatio).toBeGreaterThan(0.1)
  expect(rms.evidence.fit!.rawColumnNorms.minRmsWeight).toBeLessThan(1e-8)

  request.budgets.minimumRawColumnRmsWeight = 1e-20
  const ratio = measureExperimentalPeriodicQuinticSideScaled(request)
  expect(ratio).toMatchObject({ status: 'declined', phase: 'fit', reasonCode: 'raw-column-norm-ratio-below-budget' })
  expect(ratio.evidence.fit!.rawColumnNorms.minOverMax).toBeLessThan(1e-7)
  for (const result of [rms, ratio]) expect(result).not.toHaveProperty('candidate')
})

it('uses the scaled pivot gate for correlated columns with enough raw support and stops on solver errors', () => {
  const request = scaledFixture()
  request.training = [0, ...Array.from({ length: 7 }, (_, i) => 1.5 + (i - 3) * 2 ** -13), 4]
  const correlated = measureExperimentalPeriodicQuinticSideScaled(request)
  expect(correlated).toMatchObject({ status: 'declined', phase: 'fit', reasonCode: 'scaled-pivot-ratio-below-budget' })
  expect(correlated.evidence.fit!.rawColumnNorms.minOverMax).toBeGreaterThan(0.1)
  expect(correlated.evidence.fit!.scaledPivotRatio).toBeLessThan(1e-6)

  request.training = [0, 0.25, 0.5, 0.75, 4]
  const unobserved = measureExperimentalPeriodicQuinticSideScaled(request)
  expect(unobserved).toMatchObject({ status: 'declined', phase: 'fit', reasonCode: 'fit-refused' })
  expect(unobserved.evidence.fit).toBeUndefined()
  for (const result of [correlated, unobserved]) expect(result).not.toHaveProperty('candidate')
})

it('checks training, fitted holdout and stored holdout against separate thresholds', () => {
  const request = scaledFixture()
  // This variation changes the support field in its refined U basis while
  // keeping the protected boundary positions exactly the same. Explicit
  // synthetic seam and displacement limits isolate the residual gates.
  request.support.net.poles[6][2] -= 2 ** -8
  request.budgets.seamDerivativeGap = 1 / 8
  request.budgets.displacement = 12
  request.budgets.storedHoldoutDerivativeResidual = 1e-9
  const training = measureExperimentalPeriodicQuinticSideScaled(request)
  expect(training).toMatchObject({ status: 'declined', phase: 'fit', reasonCode: 'training-residual-exceeds-budget' })

  request.budgets.trainingDerivativeResidual = 1
  const fitted = measureExperimentalPeriodicQuinticSideScaled(request)
  expect(fitted).toMatchObject({ status: 'declined', phase: 'fit', reasonCode: 'fitted-holdout-residual-exceeds-budget' })

  request.budgets.holdoutDerivativeResidual = 1
  const stored = measureExperimentalPeriodicQuinticSideScaled(request)
  expect(stored, JSON.stringify(stored.evidence.candidateSeam)).toMatchObject({
    status: 'declined', phase: 'holdout', reasonCode: 'stored-holdout-residual-exceeds-budget',
  })
  expect(stored.evidence.proposal).toBeDefined()
  expect(stored.evidence.maxFittedHoldoutResidual!.value).toBeLessThan(1)
  expect(stored.evidence.maxStoredHoldoutResidual!.value).toBeGreaterThan(1e-9)
  expect(stored.evidence.maxStoredHoldoutResidual!.at.seamSide).toBeUndefined()
  for (const result of [training, fitted, stored]) expect(result).not.toHaveProperty('candidate')
})

it('refuses missing or coercible fit thresholds while keeping the original threshold validation', () => {
  const request = scaledFixture()
  for (const key of ['minimumRawColumnRmsWeight', 'minimumRawColumnNormRatio', 'minimumScaledPivotRatio',
    'storedHoldoutDerivativeResidual'] as const) {
    const result = measureExperimentalPeriodicQuinticSideScaled({ ...request,
      budgets: { ...request.budgets, [key]: undefined as unknown as number },
    })
    expect(result).toMatchObject({ status: 'declined', phase: 'preflight', reasonCode: 'invalid-input' })
    expect(result).not.toHaveProperty('candidate')
  }
  const legacy = fixture()
  legacy.budgets.minimumPivotRatio = '0.1' as unknown as number
  expect(measureExperimentalPeriodicQuinticSide(legacy)).toMatchObject({ status: 'declined', phase: 'preflight', reasonCode: 'invalid-input' })
})

function certifiedFixture(): ExperimentalPeriodicQuinticSideDiagnosticRequest<ExperimentalPeriodicQuinticCertifiedFitBudgets> {
  const request = fixture()
  const { minimumPivotRatio: _minimumPivotRatio, ...budgets } = request.budgets
  return { ...request, budgets: { ...budgets, storedHoldoutDerivativeResidual: budgets.holdoutDerivativeResidual,
    coefficientCertificate: { maxCoefficientError: [1e-10, 1e-10, 1e-10], maxRows: 64, maxFreeColumns: 8,
      maximumInverseGramInfinityNorm: 100 },
  } }
}

it('uses a rigorous Gram admission gate in the distinct certified path and keeps the legacy pivot gate', () => {
  const training = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 4]
  const legacy = fixture()
  legacy.training = training
  legacy.budgets.minimumPivotRatio = 0.25
  const refused = measureExperimentalPeriodicQuinticSide(legacy)
  expect(refused).toMatchObject({ status: 'declined', phase: 'fit', reasonCode: 'pivot-ratio-below-budget' })
  expect(refused.evidence).not.toHaveProperty('fitCertificate')

  const request = certifiedFixture()
  request.training = training
  request.budgets.coefficientCertificate.maximumInverseGramInfinityNorm = 1000
  const certified = measureExperimentalPeriodicQuinticSideCertifiedFit(request)
  expect(certified).toMatchObject({ status: 'diagnostic-only', evidence: { fitCertificate: { status: 'certified' } } })
  expect(certified.evidence.fit?.pivotRatio).toBe(refused.evidence.fit?.pivotRatio)
})

it('refuses a full-rank weak design even if its sampled coefficient error is certified', () => {
  const request = certifiedFixture(), step = 2 ** -8
  request.training = [0, 0.25, 0.5, 0.75, 1, 1 + step, 1 + 2 * step, 1 + 3 * step, 4]
  request.budgets.holdoutDerivativeResidual = 1e-4
  request.budgets.coefficientCertificate.maxCoefficientError = [1e-3, 1e-3, 1e-3]
  const result = measureExperimentalPeriodicQuinticSideCertifiedFit(request)
  expect(result).toMatchObject({ status: 'inconclusive', phase: 'fit-certificate', reasonCode: 'inverse-gram-norm-not-certified',
    evidence: { fit: { freeRank: 3, expectedFreeRank: 3 }, fitCertificate: { status: 'certified' } },
  })
  const certificate = result.evidence.fitCertificate
  if (certificate?.status !== 'certified') throw new Error(JSON.stringify(result))
  expect(certificate.gram.inverseInfinityNormUpper).toBeGreaterThan(1e6)
  expect(result.evidence).not.toHaveProperty('proposal')
  expect(result).not.toHaveProperty('candidate')
})

it('still refuses a stored holdout mismatch after certifying the sampled fit', () => {
  const request = certifiedFixture()
  request.support.net.poles[6][2] -= 2 ** -8
  request.budgets.seamDerivativeGap = 1 / 8
  request.budgets.displacement = 12
  request.budgets.trainingDerivativeResidual = 1
  request.budgets.holdoutDerivativeResidual = 1
  request.budgets.storedHoldoutDerivativeResidual = 1e-9
  const result = measureExperimentalPeriodicQuinticSideCertifiedFit(request)
  expect(result).toMatchObject({ status: 'declined', phase: 'holdout', reasonCode: 'stored-holdout-residual-exceeds-budget',
    evidence: { fitCertificate: { status: 'certified' }, candidateSeam: { status: 'within-tolerance' } },
  })
  expect(result).not.toHaveProperty('candidate')
})

it('requires a finite Gram threshold and withholds proposals when the certificate work cap is insufficient', () => {
  const request = certifiedFixture()
  request.budgets.coefficientCertificate.maximumInverseGramInfinityNorm = Infinity
  expect(measureExperimentalPeriodicQuinticSideCertifiedFit(request)).toMatchObject({ status: 'declined', phase: 'preflight' })
  request.budgets.coefficientCertificate.maximumInverseGramInfinityNorm = 100
  request.budgets.coefficientCertificate.maxRows = 1
  const bounded = measureExperimentalPeriodicQuinticSideCertifiedFit(request)
  expect(bounded).toMatchObject({ status: 'inconclusive', phase: 'fit-certificate',
    evidence: { fitCertificate: { status: 'inconclusive', reason: 'work-budget' } },
  })
  expect(bounded.evidence).not.toHaveProperty('proposal')
  expect(bounded).not.toHaveProperty('candidate')
})

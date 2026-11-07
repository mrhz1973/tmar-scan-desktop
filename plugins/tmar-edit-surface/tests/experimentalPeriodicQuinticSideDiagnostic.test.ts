// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { measureExperimentalPeriodicQuinticSide,
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

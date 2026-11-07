// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { measureExperimentalAlmostC1NineRow,
  type ExperimentalAlmostC1NineRowRequest } from '../experimentalPeriodicAlmostC1NineRow'
import { checkExperimentalPeriodicSeamC1 } from '../experimentalPeriodicSeamC1'
import { refineLinearPeriodicV } from '../periodic'

function fixture(): ExperimentalAlmostC1NineRowRequest {
  const ring = [[0, 0], [2, 2 ** -34], [4, 4], [-4, 4], [-4, 0]]
  const source: Net = {
    du: 3, dv: 1, nu: 5, nv: 2, periodic: [1, 0], rational: [0, 0],
    ku: [0, 2, 5, 9], mu: [3, 1, 1, 3], kv: [0, 6], mv: [2, 2],
    poles: ring.flatMap(([x, y]) => [[x, y, 0], [x, y, 18]] as Point[]), weights: Array<number>(10).fill(1),
  }
  const common = {
    stripUAtEdgeEnds: [0, 9] as const, edgePeriod: [0, 9] as const,
    training: [0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9], holdout: [0, 0.25, 1.25, 2.5, 4.5, 5.5, 8.5, 9], lambda: 1,
  }
  const lower: Net = {
    ...source, ku: [20, 24, 30, 38], kv: [0, 2],
    poles: ring.flatMap(([x, y]) => [[x, y, -12], [x, y, 0]] as Point[]),
  }
  const reversed = [0, 4, 3, 2, 1].map(index => ring[index])
  const upper: Net = {
    ...source, ku: [-12, 0, 9, 15], kv: [0, 4],
    poles: reversed.flatMap(([x, y]) => [[x, y, 18], [x, y, 46]] as Point[]),
  }
  return {
    source, joints: [
      { ...common, support: { net: lower, edge: 'V1', uAtEdgeEnds: [20, 38] } },
      { ...common, support: { net: upper, edge: 'V0', uAtEdgeEnds: [15, -12] } },
    ],
    budgets: {
      refinementPosition: 1e-12, candidateDisplacement: 2, seamDerivativeGap: 1e-9,
      sampledPosition: 1e-12, trainingDerivativeResidual: 1e-11, holdoutDerivativeResidual: 1e-11,
      storageDerivativeResidual: 1e-11, minimumSampledNormalNorm: 0.1,
      jointNormalChord: 1e-10, interiorNormalChord: 1e-10,
    },
    interiorVFractions: [0.125, 0.5, 0.875],
  }
}

it('reports diagnostics on a structural C0 seam with different domains and opposite traversal', () => {
  const request = fixture(), before = structuredClone(request)
  const result = measureExperimentalAlmostC1NineRow(request)
  expect(request).toEqual(before)
  expect(result).toMatchObject({ status: 'diagnostic-only', evidenceScope: 'coefficient-diagnostics-only' })
  if (result.status !== 'diagnostic-only') throw new Error(`${result.phase}: ${result.reason}`)

  expect(result.evidence.seams.map(item => item.role)).toEqual(['source', 'support-V0', 'support-V1', 'refined', 'candidate'])
  expect(result.evidence.seams.every(item => item.result.status === 'within-tolerance')).toBe(true)
  expect(checkExperimentalPeriodicSeamC1(result.candidate).c1AtUSeam).toBe(false)
  const refined = refineLinearPeriodicV(request.source, 9)
  for (const [i, point] of result.candidate.poles.entries()) {
    if (i % 9 !== 1 && i % 9 !== 7) expect(point).toEqual(refined.poles[i])
  }
  expect(result.evidence.displacement!.maxBoundaryPositionError).toBe(0)
  expect(result.evidence.displacement!.maxPositionError).toBeLessThan(2)
  expect(result.evidence.interiorNormalChord!.value).toBeLessThan(1e-10)
  expect(result.evidence.holdoutCoverage).toEqual({
    fitResidual: 'interior-only',
    gap: 'interior-and-seam',
    storedResidual: 'interior-and-both-seam-sides',
    jointNormalChord: 'interior-and-both-seam-sides',
  })
  for (const edge of ['V0', 'V1'] as const) {
    const report = result.evidence.joints[edge]
    expect(report.rank).toBe(5)
    expect(report.trainingCount).toBe(10)
    expect(report.holdoutCount).toBe(6)
    expect(report.storedHoldoutResidual!.value).toBeLessThan(1e-11)
    expect(report.candidateJointNormalChord!.value).toBeLessThan(1e-10)
  }
})

it('reports the location of a sampled border mismatch and preserves the source', () => {
  const request = fixture()
  const net = request.joints[0].support.net
  net.poles[4][1] += 0.25
  net.poles[5][1] += 0.25
  const before = structuredClone(request)
  const result = measureExperimentalAlmostC1NineRow(request)
  expect(result).toMatchObject({ status: 'declined', phase: 'sampling', location: { joint: 'V0' } })
  if (result.status === 'diagnostic-only') throw new Error('Expected refusal')
  expect(result.reason).toMatch(/distanza campionata/)
  expect(result.location.t).toBeGreaterThan(0)
  expect(result.evidence.joints.V0.trainingGap!.value).toBeGreaterThan(request.budgets.sampledPosition)
  expect(request).toEqual(before)
  expect('candidate' in result).toBe(false)
})

it('declines insufficient fit rank and leaves the continuous seam bound inconclusive when over budget', () => {
  const request = fixture(), [lower, upper] = request.joints
  const rank = measureExperimentalAlmostC1NineRow({ ...request, joints: [{ ...lower, training: [0, 2, 9] }, upper] })
  expect(rank).toMatchObject({ status: 'declined', phase: 'fit', location: { joint: 'V0' }, reason: expect.stringMatching(/rango/) })
  expect('candidate' in rank).toBe(false)
  const seam = measureExperimentalAlmostC1NineRow({ ...request, budgets: { ...request.budgets, seamDerivativeGap: 0 } })
  expect(seam).toMatchObject({ status: 'inconclusive', phase: 'seam', location: { role: 'source' } })
  expect(seam.evidence.seams[0].result.maxDerivativeDifferenceBound).toBe(3 * 2 ** -35)
  expect('candidate' in seam).toBe(false)
})

it('declines a holdout observation already present in the mapped training set', () => {
  const request = fixture(), [lower, upper] = request.joints
  const result = measureExperimentalAlmostC1NineRow({ ...request, joints: [{ ...lower, holdout: [0, 0.5, 9] }, upper] })
  expect(result).toMatchObject({ status: 'declined', phase: 'sampling', location: { joint: 'V0', t: 0.5 },
    reason: expect.stringMatching(/holdout sovrapposto/) })
})

it('declines an incompatible locked derivative without returning a candidate', () => {
  const request = { ...fixture(), lockIndices: [1] }, before = structuredClone(request)
  const result = measureExperimentalAlmostC1NineRow(request)
  expect(result).toMatchObject({ status: 'declined', phase: 'proposal', location: { role: 'candidate' },
    reason: expect.stringMatching(/polo bloccato 1/) })
  expect(request).toEqual(before)
  expect('candidate' in result).toBe(false)
})

it('declines sampled interior reversal even when the chord budget allows the maximum chord', () => {
  const request = fixture()
  const lower = request.joints[0].support.net
  // Across the lower support's V interval of width 2, these poles give the
  // strip a target of (0,3,24) at V0. At v=3/4 the exact height derivative
  // is -165/64, opposite to the source's +3. The lateral derivative keeps
  // the normal chord strictly below 2 even though the normal dot is negative.
  for (let i = 0; i < lower.poles.length; i += 2) {
    lower.poles[i][1] -= 6
    lower.poles[i][2] = -48
  }
  request.joints = [{ ...request.joints[0], holdout: [0, 0.25, 9] }, { ...request.joints[1], holdout: [0, 0.25, 9] }]
  request.budgets.candidateDisplacement = 9
  request.budgets.interiorNormalChord = 2
  const result = measureExperimentalAlmostC1NineRow(request)

  expect(result).toMatchObject({ status: 'declined', phase: 'interior', location: { v: 0.75 },
    reason: expect.stringMatching(/prodotto scalare.*non positivo/) })
  expect(result.evidence.interiorNormalChord!.value).toBeGreaterThan(Math.SQRT2)
  expect(result.evidence.interiorNormalChord!.value).toBeLessThan(2)
  expect('candidate' in result).toBe(false)
})

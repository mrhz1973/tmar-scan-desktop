// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeExperimentalPeriodicAlmostC1QuinticSide,
  proposeExperimentalPeriodicQuinticSide } from '../experimentalPeriodicQuinticSide'
import { checkExperimentalPeriodicSeamC1 } from '../experimentalPeriodicSeamC1'

function fixture() {
  const kv = [0, 2, 5, 7, 9, 12, 16, 20], mv = [6, 1, 1, 1, 1, 1, 1, 6]
  const full = kv.flatMap((knot, i) => Array<number>(mv[i]).fill(knot))
  const heights = Array.from({ length: 12 }, (_, i) => full.slice(i + 1, i + 6).reduce((sum, knot) => sum + knot, 0))
  const ring = [[0, 0], [2, 2 ** -34], [4, 4], [-4, 4], [-4, 0]]
  const net: Net = {
    du: 3, dv: 5, nu: 5, nv: 12, periodic: [1, 0], rational: [0, 0],
    ku: [0, 2, 5, 9], mu: [3, 1, 1, 3], kv, mv,
    poles: ring.flatMap(([x, y]) => heights.map((z): Point => [x, y, z])),
    weights: Array<number>(60).fill(1),
  }
  return { net, edge: 'V0' as const,
    targetInward: [5, 5, 10, 10, 5].map((z): Point => [0, 0, z]),
    derivativeTolerance: 1e-11, secondDerivativeTolerance: 1e-11, seamDerivativeTolerance: 1e-9 }
}

it('keeps a nonzero saturated seam gap within its budget before and after the quintic proposal', () => {
  const request = fixture(), before = structuredClone(request)
  expect(() => proposeExperimentalPeriodicQuinticSide(request)).toThrow(/U strutturalmente C1/)
  const result = proposeExperimentalPeriodicAlmostC1QuinticSide(request)
  expect(result.status).toBe('coefficient-proposal')
  if (result.status !== 'coefficient-proposal') throw new Error('Expected coefficient proposal')

  expect(result.before.maxDerivativeDifferenceBound).toBe(3 * 2 ** -35)
  expect(result.after.maxDerivativeDifferenceBound).toBe(3 * 2 ** -35)
  expect(checkExperimentalPeriodicSeamC1(result.proposal.net).c1AtUSeam).toBe(false)
  expect(result.proposal.changedIndices).toEqual([25, 26, 37, 38])
  expect(result.proposal.net.poles.slice(0, 12)).toEqual(request.net.poles.slice(0, 12))
  expect(result.proposal.maxDerivativeResidualBound).toBeLessThan(request.derivativeTolerance)
  expect(result.proposal.maxSecondDerivativeChangeBound).toBeLessThan(request.secondDerivativeTolerance)
  for (const [i, point] of result.proposal.net.poles.entries()) {
    const row = i % 12
    if (row !== 1 && row !== 2) expect(point).toEqual(request.net.poles[i])
  }
  expect(request).toEqual(before)
})

it('does not propose rows when the source gap already exceeds the tolerance or has no finite bound', () => {
  const request = fixture()
  const exceeded = proposeExperimentalPeriodicAlmostC1QuinticSide({ ...request, seamDerivativeTolerance: 0, lockIndices: [25] })
  expect(exceeded).toMatchObject({ status: 'inconclusive', phase: 'source-seam',
    before: { reason: 'bound-exceeds-tolerance' } })
  expect('proposal' in exceeded).toBe(false)

  request.net.poles[12][0] = Number.MAX_VALUE
  const overflow = proposeExperimentalPeriodicAlmostC1QuinticSide(request)
  expect(overflow).toMatchObject({ status: 'inconclusive', phase: 'source-seam',
    before: { reason: 'unrepresentable-bound', maxDerivativeDifferenceBound: null } })
  expect('proposal' in overflow).toBe(false)
})

it('withholds a proposal whose stored derivative changes enlarge the seam gap', () => {
  const request = fixture()
  request.targetInward[1][2] = 6
  const before = structuredClone(request)
  const result = proposeExperimentalPeriodicAlmostC1QuinticSide(request)
  expect(result).toMatchObject({ status: 'inconclusive', phase: 'candidate-seam',
    before: { status: 'within-tolerance' }, after: { reason: 'bound-exceeds-tolerance' } })
  expect('proposal' in result).toBe(false)
  expect(request).toEqual(before)
})

it('retains lock refusals and rejects unsupported seam inputs', () => {
  const request = fixture()
  expect(() => proposeExperimentalPeriodicAlmostC1QuinticSide({ ...request, lockIndices: [25] }))
    .toThrow(/prima derivata.*bloccato 25/)
  expect(() => proposeExperimentalPeriodicAlmostC1QuinticSide({ ...request, lockIndices: [26] }))
    .toThrow(/seconda derivata.*bloccato 26/)
  expect(() => proposeExperimentalPeriodicAlmostC1QuinticSide({ ...request, seamDerivativeTolerance: Infinity }))
    .toThrow(/tolleranza assoluta/)
  const net = { ...request.net, mu: [2, 2, 1, 2] }
  expect(() => proposeExperimentalPeriodicAlmostC1QuinticSide({ ...request, net })).toThrow(/molteplicità U/)
  const creased = { ...request.net, nu: 7, mu: [3, 3, 1, 3],
    poles: [...request.net.poles, ...request.net.poles.slice(0, 24)], weights: Array<number>(84).fill(1) }
  expect(() => proposeExperimentalPeriodicAlmostC1QuinticSide({ ...request, net: creased })).toThrow(/nodi U interni/)
  request.targetInward[0][2] = 10
  expect(() => proposeExperimentalPeriodicAlmostC1QuinticSide(request)).toThrow(/prima derivata.*bloccato 1/)
})

// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from '../experimentalPeriodicOneSidedSurfaceDerivatives'
import { proposeExperimentalPeriodicAlmostC1QuinticSide } from '../experimentalPeriodicQuinticSide'
import { sampleExperimentalPeriodicTransverseDerivatives } from '../experimentalPeriodicTransverseSamples'
import { fitExperimentalPeriodicUVectorSamples } from '../experimentalPeriodicUVectorFit'

const training = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4]
const holdout = [0, 0.125, 0.375, 0.625, 0.875, 1.125, 1.625, 2.25, 2.75, 3.25, 3.75, 4]
const tolerance = 1e-11
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// Exact insertion at 1/2 in the first span of the quadratic periodic
// source, whose seam has multiplicity two. Then reverse U about that seam.
function refinedReversed([a, b, c, d]: Point[]): Point[] {
  const first = a.map((x, axis) => (x + b[axis]) / 2) as Point
  const second = b.map((x, axis) => (3 * x + c[axis]) / 4) as Point
  return [a, d, c, second, first]
}

function fixture(targetZ: number[]) {
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
  const border = refinedReversed(ring)
  const field = refinedReversed(targetZ.map((z): Point => [0, 0, z]))
  const support: Net = {
    ...lateral, nu: 5, nv: 2, dv: 1, ku: [20, 24, 26, 27, 28], mu: [2, 1, 1, 1, 2],
    kv: [0, 2], mv: [2, 2], weights: Array<number>(10).fill(1),
    poles: border.flatMap(([x, y], u): Point[] => [[x, y, -2 * field[u][2]], [x, y, 0]]),
  }
  const sampler = {
    strip: { net: lateral, edge: 'V0', uAtEdgeEnds: [0, 4] },
    support: { net: support, edge: 'V1', uAtEdgeEnds: [28, 20] },
    edgePeriod: [0, 4], lambda: 1, positionTolerance: 1e-12,
  } as const
  return { lateral, support, sampler }
}

function fittedProposalInput(target: number[]) {
  const { lateral, support, sampler } = fixture(target)
  const sampled = sampleExperimentalPeriodicTransverseDerivatives({ ...sampler, edgeParameters: training })
  expect(sampled.maxSampledGap).toBeLessThan(sampler.positionTolerance)
  const fit = fitExperimentalPeriodicUVectorSamples(lateral.du, lateral.ku, lateral.mu, sampled.samples.slice(0, -1))
  expect(fit.rank).toBe(lateral.nu)
  expect(fit.maxSampleResidual).toBeLessThan(tolerance)
  expect(fit.coefficients.map(point => point[2])).toEqual(target.map(z => expect.closeTo(z, 11)))
  // Supply the unmodified unconstrained fit so the proposal can refuse
  // targets incompatible with its seam position or derivative budget.
  const request = { net: lateral, edge: 'V0' as const, targetInward: fit.coefficients,
    derivativeTolerance: tolerance, secondDerivativeTolerance: tolerance, seamDerivativeTolerance: 1e-9 }
  return { lateral, support, sampler, request }
}

it('uses a compatible fit from a different U basis and verifies stored derivatives and oriented normals on holdout', () => {
  const { lateral, support, sampler, request } = fittedProposalInput([5, 5, 8, 5])
  const before = structuredClone({ lateral, support, request })
  const result = proposeExperimentalPeriodicAlmostC1QuinticSide(request)
  expect(result.status).toBe('coefficient-proposal')
  if (result.status !== 'coefficient-proposal') throw new Error('Expected coefficient proposal')
  const { net: candidate, maxPositionDisplacementBound } = result.proposal
  expect(result.before.maxDerivativeDifferenceBound).toBe(2 ** -34)
  expect(result.after.maxDerivativeDifferenceBound).toBeLessThan(request.seamDerivativeTolerance)
  expect(result.proposal.maxSecondDerivativeChangeBound).toBeLessThan(tolerance)
  expect(candidate.poles.slice(0, lateral.nv)).toEqual(lateral.poles.slice(0, lateral.nv))
  for (const [i, point] of candidate.poles.entries()) {
    const row = i % lateral.nv
    if (row !== 1 && row !== 2) expect(point).toEqual(lateral.poles[i])
    expect(distance(point, lateral.poles[i])).toBeLessThanOrEqual(maxPositionDisplacementBound)
  }
  expect(maxPositionDisplacementBound).toBeCloseTo(4.2, 10)
  expect({ lateral, support, request }).toEqual(before)

  expect(holdout.slice(1, -1).every(t => !training.includes(t))).toBe(true)
  const observed = sampleExperimentalPeriodicTransverseDerivatives({
    ...sampler, strip: { ...sampler.strip, net: candidate }, edgeParameters: holdout,
  })
  expect(observed.maxSampledGap).toBeLessThan(sampler.positionTolerance)
  const actual = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(candidate)
  const neighbor = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(support)
  const check = (u: number, v: number, side?: 'left' | 'right') => {
    const a = actual.evaluate(u, 0, { u: side })
    const b = neighbor.evaluate(v, 2, { u: side === undefined ? undefined : side === 'left' ? 'right' : 'left' })
    // In this fixture increasing V has the same physical direction on
    // both faces. The reversed U correspondence negates the raw normal.
    expect(distance(a.dv, b.dv)).toBeLessThan(tolerance)
    const lengthA = Math.hypot(...a.normal), lengthB = Math.hypot(...b.normal)
    expect(Math.min(lengthA, lengthB)).toBeGreaterThan(0.1)
    const dot = a.normal.reduce((sum, x, axis) => sum - (x / lengthA) * (b.normal[axis] / lengthB), 0)
    expect(dot).toBeGreaterThan(1 - 1e-12)
  }
  for (const sample of observed.samples.slice(1, -1)) check(sample.parameter, sample.supportParameter)
  for (const side of ['left', 'right'] as const) check(0, 28, side)
})

it('retains a low-residual fit that is incompatible with the U0 lock as a refusal', () => {
  const { request } = fittedProposalInput([6, 5, 8, 5])
  const before = structuredClone(request)
  expect(() => proposeExperimentalPeriodicAlmostC1QuinticSide(request)).toThrow(/prima derivata.*bloccato 1/)
  expect(request).toEqual(before)
})

it('withholds a low-residual fit that respects U0 but changes the stored seam jump', () => {
  const { request } = fittedProposalInput([5, 6, 8, 5])
  const result = proposeExperimentalPeriodicAlmostC1QuinticSide(request)
  expect(result).toMatchObject({ status: 'inconclusive', phase: 'candidate-seam',
    before: { status: 'within-tolerance' }, after: { reason: 'bound-exceeds-tolerance' } })
  expect('proposal' in result).toBe(false)
})

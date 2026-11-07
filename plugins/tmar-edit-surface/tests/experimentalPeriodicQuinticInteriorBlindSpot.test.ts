// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from '../experimentalPeriodicOneSidedSurfaceDerivatives'
import { measureExperimentalPeriodicQuinticSide,
  type ExperimentalPeriodicQuinticSideDiagnosticRequest } from '../experimentalPeriodicQuinticSideDiagnostic'
import { add, divide, mul, scalar, sub } from '../tangencyCoefficientIntervals'

function fixture(): ExperimentalPeriodicQuinticSideDiagnosticRequest {
  const ring = [[0, 0], [1, 2 ** -35], [2, 2], [-2, 0]]
  const kv = [0, 1, 2, 3, 128], mv = [6, 1, 1, 1, 6]
  const full = kv.flatMap((knot, i) => Array<number>(mv[i]).fill(knot))
  const heights = Array.from({ length: 9 }, (_, i) => full.slice(i + 1, i + 6).reduce((sum, knot) => sum + knot, 0))
  const lateral: Net = {
    du: 2, dv: 5, nu: 4, nv: 9, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 4], mu: [2, 1, 1, 2], kv, mv,
    poles: ring.flatMap(([x, y]) => heights.map((z): Point => [x, y, z])),
    weights: Array<number>(36).fill(1),
  }
  const support: Net = {
    ...lateral, dv: 1, nv: 2, ku: [10, 12, 14, 18], kv: [0, 1], mv: [2, 2],
    poles: ring.flatMap(([x, y], u): Point[] => [[x, y, u === 2 ? -45 : -5], [x, y, 0]]),
    weights: Array<number>(8).fill(1),
  }
  return {
    lateral: { net: lateral, edge: 'V0', uAtEdgeEnds: [0, 4] },
    support: { net: support, edge: 'V1', uAtEdgeEnds: [10, 18] },
    edgePeriod: [0, 4], lambda: 1,
    training: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4],
    holdout: [0, 0.125, 0.375, 0.625, 0.875, 1.125, 1.625, 2.25, 2.75, 3.25, 3.75, 4],
    budgets: {
      sampledPositionGap: 1e-12, seamDerivativeGap: 1e-9, minimumPivotRatio: 0.1,
      trainingDerivativeResidual: 1e-10, holdoutDerivativeResidual: 1e-10,
      storageDerivativeResidual: 1e-10, secondDerivativeChange: 1e-10, displacement: 30,
      minimumSampledNormalNorm: 0.1, jointNormalChord: 1e-10,
    },
  }
}

function heightDerivativeAtWitness(net: Net) {
  // At U=1 the two nonzero quadratic basis values are 1/2 on indices
  // 1 and 2. At V=1, Cox-de Boor on the reduced quartic knot vector gives
  // weights 1/8 and 37/72 for derivative controls 1 and 2. The remaining
  // weight 13/36 is on untouched derivative controls, all exactly 5.
  let derivative = divide(scalar(65), scalar(36))
  for (const u of [1, 2]) {
    const z = (v: number) => scalar(net.poles[u * net.nv + v][2])
    const d1 = divide(mul(scalar(5), sub(z(2), z(1))), scalar(2))
    const d2 = divide(mul(scalar(5), sub(z(3), z(2))), scalar(3))
    derivative = add(derivative, divide(d1, scalar(16)))
    derivative = add(derivative, divide(mul(scalar(37), d2), scalar(144)))
  }
  return derivative
}

const dot = (a: Point, b: Point) => a.reduce((sum, x, i) => sum + x * b[i], 0)

it('passes the sampled quintic joint but proves an interior normal inversion before the coarse V grid', () => {
  const request = fixture(), original = request.lateral.net
  const result = measureExperimentalPeriodicQuinticSide(request)
  if (result.status !== 'diagnostic-only') throw new Error(`${result.phase}: ${result.reason}`)
  expect(result.evidence.candidateSeam?.status).toBe('within-tolerance')
  expect(result.evidence.maxStoredHoldoutResidual!.value).toBeLessThan(request.budgets.holdoutDerivativeResidual)
  expect(result.evidence.minimumCandidateNormalDot!.value).toBeGreaterThan(1 - 1e-12)
  expect(result.evidence.proposal!.maxSecondDerivativeChangeBound).toBeLessThan(request.budgets.secondDerivativeChange)
  for (const [i, point] of result.candidate.poles.entries()) {
    expect(point.slice(0, 2)).toEqual(original.poles[i].slice(0, 2))
    if (i < 9 || (i % 9 !== 1 && i % 9 !== 2)) expect(point).toEqual(original.poles[i])
  }

  const before = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(original)
  const after = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(result.candidate)
  // Both moved V basis functions vanish beyond V=3, before the first
  // coarse fraction. This grid cannot see the localized change at any U.
  for (const u of [1, ...request.holdout.slice(1, -1)]) for (const fraction of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    const v = 128 * fraction
    expect(after.evaluate(u, v).dv[2]).toBeCloseTo(5, 12)
    expect(dot(before.evaluate(u, v).normal, after.evaluate(u, v).normal)).toBeGreaterThan(0)
  }

  // With fixed XY and nonzero tangent (1, 2-2^-35) at U=1, the sign of
  // dZ/dV decides normal orientation. The interval uses the stored poles.
  const [, upper] = heightDerivativeAtWitness(result.candidate)
  expect(upper).toBeCloseTo(-25 / 9, 11)
  expect(upper).toBeLessThan(-2.7)
  expect(dot(before.evaluate(1, 1).normal, after.evaluate(1, 1).normal)).toBeLessThan(0)
})

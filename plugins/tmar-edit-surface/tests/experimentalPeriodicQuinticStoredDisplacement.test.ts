// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalPeriodicQuinticStoredDisplacement } from '../experimentalPeriodicQuinticStoredDisplacement'

function fixture(kv = [0, 0.05], mv = [6, 6]): Net {
  const nv = mv.reduce((sum, m) => sum + m, 0) - 6
  const ring = [[0, 0], [1, 0], [2, 2], [-2, 0]]
  return { du: 2, dv: 5, nu: 4, nv, periodic: [1, 0], rational: [0, 0], ku: [0, 1, 2, 4], mu: [2, 1, 1, 2],
    kv, mv, weights: Array<number>(4 * nv).fill(1), poles: ring.flatMap(([x, y]) => Array.from({ length: nv }, (): Point => [x, y, 0])) }
}

const budget = { maximumSurfaceDisplacement: 0.05, maxDepth: 8, maxPieces: 128 }

it.each(['Bezier', 'V0-multiple', 'V1-multiple'])('proves surface cap 0.05 with second-row pole displacement 0.10 in %s', shape => {
  const original = shape === 'Bezier' ? fixture() : fixture([0, 0.05, 0.125, 0.175], [6, 3, 3, 6])
  const candidate = structuredClone(original)
  const [first, second] = shape === 'V1-multiple' ? [original.nv - 2, original.nv - 3] : [1, 2]
  for (let u = 0; u < original.nu; u++) {
    candidate.poles[u * original.nv + first][2] = 0.05
    candidate.poles[u * original.nv + second][2] = 0.10
  }
  const before = structuredClone({ original, candidate })
  const hull = boundExperimentalPeriodicQuinticStoredDisplacement(original, candidate, { ...budget, maxDepth: 0 })
  expect(hull).toMatchObject({ status: 'inconclusive', reason: 'surface-displacement-unverified' })
  const result = boundExperimentalPeriodicQuinticStoredDisplacement(original, candidate, budget)
  if (result.status !== 'within-surface-budget') throw new Error(JSON.stringify(result))
  // With multiplicity three at the first interior knot, both basis
  // functions are supported on the first inward span. In its local t,
  // B1^5+2 B2^5=5t(1−t)^3(1+3t), maximized at t=1/3.
  const maximum = (80 / 81) * 0.05
  expect(result.maximumSurfaceDisplacementUpper).toBeGreaterThanOrEqual(maximum)
  expect(result.maximumSurfaceDisplacementUpper).toBeLessThanOrEqual(0.05)
  expect(result.maximumPoleDisplacementUpper).toBeGreaterThanOrEqual(0.10)
  expect(result.work.maximumDepthUsed).toBeGreaterThan(0)
  expect({ original, candidate }).toEqual(before)
})

it('checks later V spans and withholds a full bound when the cap or piece budget cannot be proved', () => {
  const original = fixture([0, 0.05, 0.1], [6, 1, 6]), candidate = structuredClone(original)
  candidate.poles.at(-1)![2] = 0.10
  const exceeds = boundExperimentalPeriodicQuinticStoredDisplacement(original, candidate, budget)
  expect(exceeds).toMatchObject({ status: 'inconclusive', reason: 'surface-displacement-unverified', at: { vSpan: 1 } })
  expect(exceeds).not.toHaveProperty('maximumSurfaceDisplacementUpper')
  expect(boundExperimentalPeriodicQuinticStoredDisplacement(original, candidate, { ...budget, maxPieces: 4 }))
    .toMatchObject({ status: 'inconclusive', reason: 'piece-budget' })
})

it('encloses vector norms and accepts exact zero only for matching bases and displacement', () => {
  const original = fixture(), candidate = structuredClone(original)
  expect(boundExperimentalPeriodicQuinticStoredDisplacement(original, candidate, { ...budget, maximumSurfaceDisplacement: 0 }))
    .toMatchObject({ status: 'within-surface-budget', maximumSurfaceDisplacementUpper: 0 })
  candidate.poles = candidate.poles.map(([x, y, z]): Point => [x + 0.03, y + 0.04, z])
  const result = boundExperimentalPeriodicQuinticStoredDisplacement(original, candidate, { ...budget, maximumSurfaceDisplacement: 0.051 })
  if (result.status !== 'within-surface-budget') throw new Error(JSON.stringify(result))
  expect(result.maximumSurfaceDisplacementUpper).toBeGreaterThanOrEqual(0.05)
  expect(result.maximumSurfaceDisplacementUpper).toBeLessThan(0.051)
  candidate.ku = [0, 1, 3, 4]
  expect(boundExperimentalPeriodicQuinticStoredDisplacement(original, candidate, budget)).toMatchObject({ status: 'inconclusive' })
})

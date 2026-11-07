// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { experimentalCoefficientChangeWithinCap, solveExperimentalPeriodicMobileSeamConstrained } from '../experimentalPeriodicMobileSeamConstrained'
import { solveExperimentalPeriodicMobileSeamLeastSquares } from '../experimentalPeriodicMobileSeamLeastSquares'

const rows = [
  { entries: [{ column: 0, weight: 1 }], value: 5 * 229 / 64 },
  { entries: [{ column: 3, weight: 1 }], value: 5 * 105 / 64 },
  { entries: [{ column: 0, weight: 1 }, { column: 3, weight: 1 }], value: 0 },
]
const objective = (x: number, y: number) => (rows[0].value - x) ** 2 / 2 + (rows[1].value - y) ** 2 / 2 + (x + y) ** 2 / 2 +
  (x * x + y * y + ((x + y) / 2) ** 2) / 8
const budget = { penalty: 1, maxIterations: 512, maxFactorUpdates: 1000, relativeGapTolerance: 1e-12, relativeSplitTolerance: 1e-10 }

it('finds a feasible optimum at cap 5 where the unconstrained optimum would be rejected', () => {
  const before = structuredClone(rows), cap = 5, ridge = 1 / 4, residualBudget = 13
  const free = solveExperimentalPeriodicMobileSeamLeastSquares(rows, 2, 0.5, 0.5, ridge, 128, 1e-12, 1000)
  if (free.status !== 'solved') throw new Error(free.reason)
  expect(free.changes[0]).toBeGreaterThan(cap)
  const fitted = solveExperimentalPeriodicMobileSeamConstrained(rows, 2, 0.5, 0.5, ridge, cap, budget)
  if (fitted.status !== 'solved') throw new Error(JSON.stringify(fitted))
  // H has diagonal 37/16 and off-diagonal 17/16. At (5, 5/4) its
  // gradient is (-5, 0), so the active-ball KKT conditions hold.
  expect(fitted.changes[0]).toBeCloseTo(5, 10)
  expect(fitted.changes[3]).toBeCloseTo(1.25, 9)
  expect(fitted.evidence.objective).toBeCloseTo(objective(5, 1.25), 10)
  expect(fitted.evidence.objective).toBeLessThan(objective(5, free.changes[3]))
  expect(fitted.evidence.maxSampleResidual).toBeLessThan(residualBudget)
  expect(experimentalCoefficientChangeWithinCap([0, 0, 0], [fitted.changes[0], 0, 0], cap)).toBe(true)
  expect(experimentalCoefficientChangeWithinCap([0, 0, 0], [(fitted.changes[0] + fitted.changes[3]) / 2, 0, 0], cap)).toBe(true)
  expect(rows).toEqual(before)
})

it('enforces the Euclidean ball and refuses iteration exhaustion without a trial result', () => {
  const diagonal = [
    { entries: [{ column: 0, weight: 0.6 }, { column: 1, weight: 0.8 }], value: 10 },
    // This observation cancels the seam-ridge gradient on the other pole
    // at the known optimum (3,4,0) for the first pole and zero for the second.
    { entries: [{ column: 3, weight: 0.6 }, { column: 4, weight: 0.8 }], value: 5 / 16 },
  ]
  const result = solveExperimentalPeriodicMobileSeamConstrained(diagonal, 2, 0.5, 0.5, 1 / 4, 5, budget)
  if (result.status !== 'solved') throw new Error(JSON.stringify(result))
  expect(result.changes[0]).toBeCloseTo(3, 7)
  expect(result.changes[1]).toBeCloseTo(4, 7)
  expect(experimentalCoefficientChangeWithinCap([0, 0, 0], [result.changes[0], result.changes[1], 0], 5)).toBe(true)
  const bounded = solveExperimentalPeriodicMobileSeamConstrained(rows, 2, 0.5, 0.5, 0.25, 5, { ...budget, maxIterations: 1 })
  expect(bounded).toMatchObject({ status: 'inconclusive', reason: 'iteration-budget', evidence: { iterations: 1 } })
  expect(bounded).not.toHaveProperty('changes')
  const factorBounded = solveExperimentalPeriodicMobileSeamConstrained(rows, 2, 0.5, 0.5, 0.25, 5, { ...budget, maxFactorUpdates: 1 })
  expect(factorBounded).toMatchObject({ status: 'inconclusive', reason: 'factor-budget', evidence: { iterations: 0 } })
  expect(factorBounded).not.toHaveProperty('changes')
  expect(solveExperimentalPeriodicMobileSeamConstrained([{ entries: [{ column: 0, weight: 1 }], value: 1e-170 }],
    2, 0.5, 0.5, 0.25, 1e-170, budget)).toMatchObject({ status: 'inconclusive', reason: 'arithmetic-refused' })
})

it('proves the cap on represented coefficient differences even when a float norm rounds to the boundary', () => {
  expect(experimentalCoefficientChangeWithinCap([0, 0, 0], [3, 4, 0], 5)).toBe(true)
  expect(Math.hypot(3, 4, Number.MIN_VALUE)).toBe(5)
  expect(experimentalCoefficientChangeWithinCap([0, 0, 0], [3, 4, Number.MIN_VALUE], 5)).toBe(false)
  expect(experimentalCoefficientChangeWithinCap([-(2 ** 53), 0, 0], [5, 0, 0], 2 ** 53 + 4)).toBe(false)
})

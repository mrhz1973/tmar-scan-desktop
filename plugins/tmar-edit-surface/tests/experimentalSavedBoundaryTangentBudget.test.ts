// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalSavedBoundaryTangentBudget } from '../experimentalSavedBoundaryTangentBudget'

function cylinder(): Net {
  const k = 0.5522847498307936
  const xy = [[1, 0], [1, k], [k, 1], [0, 1], [-k, 1], [-1, k],
    [-1, 0], [-1, -k], [-k, -1], [0, -1], [k, -1], [1, -k]]
  return { du: 3, dv: 5, nu: 12, nv: 6, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [3, 3, 3, 3, 3], kv: [0, 1], mv: [6, 6],
    poles: xy.flatMap(([x, y]) => Array.from({ length: 6 }, (_, v): Point => [x, y, v / 5])),
    weights: Array<number>(72).fill(1) }
}

it('certifies the unchanged Euclidean budget when the conservative L1 control bound exceeds it', () => {
  const a = cylinder(), b = structuredClone(a)
  // The first-span tangent perturbation has controls ±(3/8,3/8,3/8),0:
  // its L1 hull is9/8>1, while its Euclidean squared hull is27/64<1.
  for (let coordinate = 0; coordinate < 3; coordinate++) b.poles[1 * 6 + 5][coordinate] += 1 / 32
  const frozen = structuredClone({ a, b })
  const result = boundExperimentalSavedBoundaryTangentBudget(a, b, 'V-max', 1)
  expect(result.classification).toBe('within-unchanged-euclidean-tangent-budget')
  expect(result.maximumSquaredTangentDifferenceUpper).toBeGreaterThanOrEqual(27 / 64)
  expect(result.maximumSquaredTangentDifferenceUpper).toBeLessThan(27 / 64 + 1e-9)
  expect(result.checkedWitnessPoints).toBe(0)
  expect(result.previousReceiptAmended).toBe(false)
  expect(result.nativeCadCertified).toBe(false)
  expect(result.tubeAccepted).toBe(false)
  expect({ a, b }).toEqual(frozen)
})

it('certifies a true Euclidean violation using the sum of squared component lower bounds', () => {
  const a = cylinder(), b = structuredClone(a)
  // Each coordinate of the endpoint tangent difference is3/4<1, but the
  // Euclidean norm squared is27/16>1. A single-component witness misses it.
  for (let coordinate = 0; coordinate < 3; coordinate++) b.poles[1 * 6 + 5][coordinate] += 1 / 16
  const result = boundExperimentalSavedBoundaryTangentBudget(a, b, 'V-max', 1)
  expect(result.classification).toBe('outside-unchanged-euclidean-tangent-budget')
  expect(result.violatingWitness?.squaredNormLower).toBeGreaterThan(1)
  expect(result.violatingWitness?.squaredNormLower).toBeLessThanOrEqual(27 / 16)
  expect(result.checkedWitnessPoints).toBeGreaterThan(0)
})

it('preserves a one-ULP union cell while deriving on the original native spans', () => {
  const a = cylinder(), b = structuredClone(a)
  b.ku[1] = 1 + Number.EPSILON
  const result = boundExperimentalSavedBoundaryTangentBudget(a, b, 'V-max', 1e-6)
  expect(result.partition).toContain(1)
  expect(result.partition).toContain(1 + Number.EPSILON)
  expect(result.checkedCells).toBe(5)
  expect(result.maximumSquaredTangentDifferenceUpper).toBeLessThan(1e-18)
  expect(result.classification).toBe('within-unchanged-euclidean-tangent-budget')
})

it('reports an unresolved enclosure instead of inferring violation from an insufficient upper bound', () => {
  const a = cylinder()
  const result = boundExperimentalSavedBoundaryTangentBudget(a, a, 'V-min', 1e-20)
  expect(result.classification).toBe('inconclusive')
  expect(result.maximumSquaredTangentDifferenceUpper).toBeGreaterThan(result.squaredBudget[1])
  expect(result.violatingWitness).toBeUndefined()
})

it('rejects changed parameter domains, invalid budgets and unsupported coefficient models', () => {
  const a = cylinder(), b = structuredClone(a)
  b.ku = b.ku.map(u => 2 * u)
  expect(() => boundExperimentalSavedBoundaryTangentBudget(a, b, 'V-max', 1)).toThrow(/domini naturali diversi/)
  expect(() => boundExperimentalSavedBoundaryTangentBudget(a, a, 'V-max', 0)).toThrow(/budget tangente/)
  expect(() => boundExperimentalSavedBoundaryTangentBudget(a, a, 'V-max', Number.MIN_VALUE)).toThrow(/quadrato del budget/)
  expect(() => boundExperimentalSavedBoundaryTangentBudget(a, a, 'V-max', 1, 3)).toThrow(/partizione comune/)
  const rational = structuredClone(a)
  rational.rational = [1, 0]
  expect(() => boundExperimentalSavedBoundaryTangentBudget(a, rational, 'V-max', 1)).toThrow(/polinomiale/)
})

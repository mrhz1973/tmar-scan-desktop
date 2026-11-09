// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalSavedBoundaryDifferential, type ExperimentalSavedBoundary } from '../experimentalSavedPairDifferential'

// Four independent cubic circle-approximation pieces. Internal knots and
// the periodic seam are saturated deliberately: their derivatives must be
// treated on the closure of each own piece, without assuming seam C1.
function cylinder(): Net {
  const k = 0.5522847498307936
  const xy = [[1, 0], [1, k], [k, 1], [0, 1], [-k, 1], [-1, k],
    [-1, 0], [-1, -k], [-k, -1], [0, -1], [k, -1], [1, -k]]
  return { du: 3, dv: 5, nu: 12, nv: 6, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [3, 3, 3, 3, 3], kv: [0, 1], mv: [6, 6],
    poles: xy.flatMap(([x, y]) => Array.from({ length: 6 }, (_, v): Point => [x, y, v / 5])),
    weights: Array<number>(72).fill(1) }
}

const boundary = (net: Net, side: ExperimentalSavedBoundary['side'] = 'V-min', normalSign: 1 | -1 = 1): ExperimentalSavedBoundary =>
  ({ net, side, normalSign })
const options = { maximumNormalSine: 1e-6 }

it('compares normalized tangents under different U periods and keeps original V derivative units', () => {
  const a = cylinder(), b = structuredClone(a)
  b.ku = b.ku.map(u => 7 * u)
  b.kv = [0, 2]
  const frozen = structuredClone({ a, b })
  const result = boundExperimentalSavedBoundaryDifferential(boundary(a), boundary(b, 'V-max'), options)
  expect(result.classification).toBe('within-declared-normal-budget')
  expect(result.normalizedTangentDifferenceUpper).toBeLessThan(1e-10)
  expect(result.increasingVDerivativeDifferenceUpper).toBeGreaterThanOrEqual(0.5)
  expect(result.increasingVDerivativeDifferenceUpper).toBeLessThan(0.500000001)
  expect(result.minimumTangentNormLower).toBeGreaterThan(0)
  expect(result.minimumNormalNormLower).toBeGreaterThan(0)
  expect(result.minimumNormalDotLower).toBeGreaterThan(0)
  expect(result.boundaryRegularityCertified).toBe(true)
  expect(result.regularityUnresolvedLeaves).toBe(0)
  expect(result.normalSineUpper).toBeLessThan(1e-6)
  expect(result.first.inwardTransverseSign).toBe(1)
  expect(result.second.inwardTransverseSign).toBe(-1)
  expect(result.seamEndpointContract).toBe('separate-one-sided-0-plus-and-1-minus')
  expect(result.exactG1Certified).toBe(false)
  expect(result.nativeCadCertified).toBe(false)
  expect({ a, b }).toEqual(frozen)
})

it('retains an almost coincident normalized knot without amplifying the derivative uncertainty by its tiny cell', () => {
  const a = cylinder(), b = structuredClone(a)
  b.ku[1] = 1 + Number.EPSILON
  const result = boundExperimentalSavedBoundaryDifferential(boundary(a), boundary(b), options)
  expect(result.checkedCells).toBe(5)
  expect(result.normalizedPartition).toHaveLength(6)
  expect(result.normalizedTangentDifferenceUpper).toBeLessThan(1e-9)
  expect(result.increasingVDerivativeDifferenceUpper).toBeLessThan(1e-9)
  expect(result.classification).toBe('within-declared-normal-budget')
})

it('detects a genuine transverse tilt by a certified one-sided witness', () => {
  const a = cylinder(), b = structuredClone(a)
  for (let u = 0; u < b.nu; u++) for (let v = 0; v < b.nv; v++) b.poles[u * b.nv + v][0] += 0.5 * v / 5
  const result = boundExperimentalSavedBoundaryDifferential(boundary(a), boundary(b), options)
  expect(result.classification).toBe('outside-declared-normal-budget')
  expect(result.witness?.reason).toBe('normal-sine-budget-exceeded')
  expect(result.normalizedTangentDifferenceUpper).toBeLessThan(1e-10)
  expect(result.increasingVDerivativeDifferenceUpper).toBeGreaterThan(0.49)
  expect(result.normalSineUpper).toBeGreaterThan(1e-6)
})

it('keeps the sign of the oriented normal independent from a positive affine parameter map', () => {
  const a = cylinder()
  const result = boundExperimentalSavedBoundaryDifferential(boundary(a), boundary(a, 'V-min', -1), options)
  expect(result.classification).toBe('outside-declared-normal-budget')
  expect(result.witness?.reason).toBe('negative-oriented-normal-dot')
  expect(result.normalizedTangentDifferenceUpper).toBeLessThan(1e-10)
})

it('does not certify a collapsed strip or quietly spend an unbounded subdivision budget', () => {
  const a = cylinder()
  for (const p of a.poles) p[2] = 0
  const result = boundExperimentalSavedBoundaryDifferential(boundary(a), boundary(a), { ...options, maxDepth: 0 })
  expect(result.classification).toBe('inconclusive')
  expect(result.minimumNormalNormLower).toBe(0)
  expect(result.normalSineUpper).toBeNull()
  expect(result.unresolvedLeaves).toBe(4)
  expect(result.regularityUnresolvedLeaves).toBe(4)
  expect(result.boundaryRegularityCertified).toBe(false)
  expect(result.checkedLeaves).toBe(4)
})

it('rejects malformed orientation, rational data and invalid evidence budgets', () => {
  const a = cylinder(), b = structuredClone(a)
  expect(() => boundExperimentalSavedBoundaryDifferential({ ...boundary(a), normalSign: 0 as 1 }, boundary(a), options)).toThrow(/segno/)
  b.rational = [1, 0]
  expect(() => boundExperimentalSavedBoundaryDifferential(boundary(a), boundary(b), options)).toThrow(/polinomiale/)
  expect(() => boundExperimentalSavedBoundaryDifferential(boundary(a), boundary(a), { maximumNormalSine: 1 })).toThrow(/budget seno/)
  expect(() => boundExperimentalSavedBoundaryDifferential(boundary(a), boundary(a), { ...options, maxCells: 3 })).toThrow(/partizione/)
  expect(() => boundExperimentalSavedBoundaryDifferential(boundary(a), boundary(a), { ...options, maxDepth: 13 })).toThrow(/budget di suddivisione/)
})

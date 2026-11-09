// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { extractExperimentalPeriodicQuinticCommonCell } from '../experimentalPeriodicQuinticBernsteinCells'
import { boundExperimentalPeriodicSupportDifference } from '../experimentalPeriodicSupportDifference'

function net(rows: readonly Point[], degree: number, ku: number[], mu: number[]): Net {
  return { du: degree, dv: 5, nu: rows.length, nv: 6, periodic: [1, 0], rational: [0, 0],
    ku, mu, kv: [0, 1], mv: [6, 6], weights: Array<number>(rows.length * 6).fill(1),
    poles: rows.flatMap(([x, y, z]) => Array.from({ length: 6 }, (_, v): Point => [x, y, z + v])) }
}

const linear = (middle = 1) => net([[0, 0, 0], [2, 0, 0]], 1, [0, middle, 2], [1, 1, 1])
const cubic = (middle = 1) => net([[0, 0, 0], [1, 0, 0], [2, 0, 0],
  [3, 0, 0], [2, 0, 0], [1, 0, 0]], 3, [0, middle, 2], [3, 3, 3])

it('encloses the analytic knot-only difference despite identical poles', () => {
  const original = linear(), candidate = linear(1.5)
  expect(candidate.poles).toEqual(original.poles)
  const result = boundExperimentalPeriodicSupportDifference(original, candidate)
  // Both curves are triangular: the maximum occurs at u=1.5, where the
  // original is x=1 and candidate x=2. V contributes the same field 5V.
  expect(result.positionDifferenceUpperBound).toBeGreaterThanOrEqual(1)
  expect(result.positionDifferenceUpperBound).toBeLessThan(1 + 1e-11)
  expect(result.uPartition).toEqual([0, 1, 1.5, 2])
  expect(result).toMatchObject({ status: 'bounded', checkedCells: 3, checkedControlPairs: 36,
    uCells: 3, vCells: 1, correspondence: 'identity-uv', nativeCadCertified: false })
})

it('covers both periodic cubic pieces with their own basis on the common cells', () => {
  const original = cubic(), candidate = cubic(1.25)
  const before = structuredClone({ original, candidate })
  const result = boundExperimentalPeriodicSupportDifference(original, candidate)
  // Saturated cubic pieces have collinear equally spaced controls, hence
  // the exact field is triangular. At u=1.25 the gap is 3 - 2.25 = .75.
  expect(result.positionDifferenceUpperBound).toBeGreaterThanOrEqual(0.75)
  expect(result.positionDifferenceUpperBound).toBeLessThan(0.75 + 1e-11)
  expect(result.uDomain).toEqual([0, 2])
  expect(result.uPartition).toEqual([0, 1, 1.25, 2])
  expect({ original, candidate }).toEqual(before)
})

it('detects knot-only drift on an unsaturated interior quadratic basis', () => {
  const rows: Point[] = [[0, 0, 0], [2, 1, 0], [3, 4, 0], [-1, 3, 0]]
  const original = net(rows, 2, [0, 1, 2, 4], [2, 1, 1, 2])
  const candidate = net(rows, 2, [0, 0.5, 2, 4], [2, 1, 1, 2])
  const result = boundExperimentalPeriodicSupportDifference(original, candidate)
  // Independent quadratic endpoint/derivative formulas at u=.5 give
  // (1.625,1.125) versus (2.25,1.75): the L1 difference is exactly 1.25.
  expect(result.positionDifferenceUpperBound).toBeGreaterThanOrEqual(1.25)
  expect(result.positionDifferenceUpperBound).toBeLessThan(10)
  expect(result.uPartition).toEqual([0, 0.5, 1, 2, 4])
})

it('bounds an exact common translation and encloses identical models near zero', () => {
  const original = cubic(), candidate = structuredClone(original)
  for (const point of candidate.poles) { point[0] += 5; point[1] += 7; point[2] += 11 }
  const moved = boundExperimentalPeriodicSupportDifference(original, candidate)
  expect(moved.positionDifferenceUpperBound).toBeGreaterThanOrEqual(23)
  expect(moved.positionDifferenceUpperBound).toBeLessThan(23 + 1e-10)
  const identical = boundExperimentalPeriodicSupportDifference(original, original)
  expect(identical.positionDifferenceUpperBound).toBeGreaterThanOrEqual(0)
  expect(identical.positionDifferenceUpperBound).toBeLessThan(1e-10)
})

it('retains a one-ULP common microcell without dividing by its width', () => {
  const shifted = 1 + Number.EPSILON
  const result = boundExperimentalPeriodicSupportDifference(cubic(), cubic(shifted))
  expect(result.uPartition).toEqual([0, 1, shifted, 2])
  expect(result.checkedCells).toBe(3)
  expect(result.positionDifferenceUpperBound).toBeGreaterThan(0)
  expect(result.positionDifferenceUpperBound).toBeLessThan(1e-10)
})

it('covers all repeated-knot V spans together with the changed U basis', () => {
  const withRepeatedV = (source: Net): Net => ({ ...source, nv: 12,
    kv: [0, 0.25, 0.75, 1], mv: [6, 3, 3, 6], weights: Array<number>(source.nu * 12).fill(1),
    poles: Array.from({ length: source.nu }, (_, u) => Array.from({ length: 12 }, (_, v): Point =>
      [source.poles[u * 6][0], 0, v])).flat() })
  const original = withRepeatedV(cubic()), candidate = withRepeatedV(cubic(1.25))
  for (const point of candidate.poles) point[2] += 2
  const result = boundExperimentalPeriodicSupportDifference(original, candidate)
  // The common V field cancels, apart from the exact translation by 2.
  // Its L1 sum with the analytic .75 U error is therefore exactly 2.75.
  expect(result).toMatchObject({ uCells: 3, vCells: 3, checkedCells: 9 })
  expect(result.positionDifferenceUpperBound).toBeGreaterThanOrEqual(2.75)
  expect(result.positionDifferenceUpperBound).toBeLessThan(2.75 + 1e-10)
})

it('declines incompatible domains, rational inputs, missing coefficients and excess budgets', () => {
  const original = cubic(), candidate = cubic(1.25)
  const domain = structuredClone(candidate); domain.ku[2] = 3
  expect(() => boundExperimentalPeriodicSupportDifference(original, domain)).toThrow(/dominio U/)
  const vBasis = structuredClone(candidate); vBasis.kv[1] = 2
  expect(() => boundExperimentalPeriodicSupportDifference(original, vBasis)).toThrow(/base V/)
  const rational = structuredClone(candidate); rational.rational = [1, 0]
  expect(() => boundExperimentalPeriodicSupportDifference(original, rational)).toThrow(/supporti polinomiali/)
  const multiplicities = net([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]],
    3, [0, 1.25, 2], [3, 1, 3])
  expect(() => boundExperimentalPeriodicSupportDifference(original, multiplicities)).toThrow(/molteplicità U/)
  const missing = structuredClone(candidate); delete missing.poles[0]
  expect(() => boundExperimentalPeriodicSupportDifference(original, missing)).toThrow(/non valido/)
  const nonfinite = structuredClone(candidate); nonfinite.poles[0][0] = NaN
  expect(() => boundExperimentalPeriodicSupportDifference(original, nonfinite)).toThrow(/non valido/)
  expect(() => boundExperimentalPeriodicSupportDifference(original, candidate, 2)).toThrow(/oltre il budget/)
  expect(() => boundExperimentalPeriodicSupportDifference(original, candidate, 16_385)).toThrow(/budget celle non valido/)
})

it('refuses a declared common cell that crosses either native knot span', () => {
  const original = cubic(), candidate = cubic(1.25)
  expect(() => extractExperimentalPeriodicQuinticCommonCell(original, candidate, 0, 0, 0, [0.5, 1.1]))
    .toThrow(/fuori dalla campata U nativa/)
  expect(() => extractExperimentalPeriodicQuinticCommonCell(original, candidate, 1, 0, 0, [1, 1]))
    .toThrow(/dominio della cella comune non valido/)
})

// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundPeriodicLinearVRefinement } from '../experimentalPeriodicLinearVRefinementBound'
import { boundExperimentalPeriodicLocalizedVDisplacement } from '../experimentalPeriodicLocalizedVDisplacement'
import { refineLinearPeriodicV } from '../periodic'

const ring = [[0, 0], [8, 0], [8, 8], [0, 8]]

function linearNet(kv: number[], height: number): Net {
  return {
    nu: 4, nv: 2, du: 3, dv: 1, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv, mv: [2, 2],
    poles: ring.flatMap(([x, y]): Point[] => [[x, y, 0], [x, y, height]]),
    weights: Array<number>(8).fill(1),
  }
}

function exactBaseline(knots: number[]) {
  const last = knots.at(-1)!, source = linearNet([0, last], 3 * last)
  const extended = [0, 0, 0, ...knots, last, last, last]
  const heights = Array.from({ length: 9 }, (_, i) => extended[i + 1] + extended[i + 2] + extended[i + 3])
  const refined: Net = { ...source, nv: 9, dv: 3, kv: knots, mv: [4, 1, 1, 1, 1, 1, 4],
    poles: ring.flatMap(([x, y]) => heights.map((z): Point => [x, y, z])), weights: Array<number>(36).fill(1) }
  return { source, refined }
}

function moved(refined: Net, lower: number, upper: number) {
  const candidate = structuredClone(refined)
  for (let u = 0; u < refined.nu; u++) {
    candidate.poles[u * 9 + 1][2] += lower
    candidate.poles[u * 9 + 7][2] += upper
  }
  return candidate
}

function analyticMaximum(beta: number) {
  // Solve the derivative of 3x + b*x² + c*x³ on the first span. The
  // second span decreases from the common value at x=1.
  const b = -6 + 3 * beta, c = 3 - 3 * beta + beta ** 2
  const x = (-b - Math.sqrt(b ** 2 - 9 * c)) / (3 * c)
  return 3 * x + b * x ** 2 + c * x ** 3
}

it('strictly tightens the legacy bound for disjoint moved rows on a uniform V basis', () => {
  const { source, refined } = exactBaseline([0, 1, 2, 3, 4, 5, 6])
  const candidate = moved(refined, 1, -1)
  const before = structuredClone({ source, refined, candidate })
  const result = boundExperimentalPeriodicLocalizedVDisplacement(source, refined, candidate)
  const exactMaximum = analyticMaximum(0.5)

  expect(result.legacyPositionBound).toBeGreaterThanOrEqual(1)
  expect(result.maxPositionError).toBeGreaterThanOrEqual(exactMaximum)
  expect(result.maxPositionError).toBeLessThan(exactMaximum + 1e-4)
  expect(result.maxBoundaryPositionError).toBe(0)
  expect(result.lowerBasisUpper).toBe(result.upperBasisUpper)
  expect({ source, refined, candidate }).toEqual(before)
})

it('bounds each end independently on a nonuniform V basis', () => {
  const { source, refined } = exactBaseline([0, 1, 2, 3, 4, 8, 9])
  const result = boundExperimentalPeriodicLocalizedVDisplacement(source, refined, moved(refined, -1, 2))
  const left = analyticMaximum(0.5), right = analyticMaximum(0.8)
  expect(result.lowerBasisUpper).toBeGreaterThanOrEqual(left)
  expect(result.upperBasisUpper).toBeGreaterThanOrEqual(right)
  expect(result.upperBasisUpper).toBeLessThan(right + 1e-4)
  expect(result.maxPositionError).toBeGreaterThanOrEqual(2 * right)
  expect(result.maxPositionError).toBeLessThan(2 * right + 2e-4)
  expect(result.legacyPositionBound).toBeGreaterThanOrEqual(2)
})

it('retains the baseline error when stored V knots are rounded', () => {
  const origin = 2 ** 50, source = linearNet([origin, origin + 4], 48)
  const refined = refineLinearPeriodicV(source, 9)
  const legacy = boundPeriodicLinearVRefinement(source, refined)
  const result = boundExperimentalPeriodicLocalizedVDisplacement(source, refined, structuredClone(refined))
  expect(legacy.maxPositionError).toBeGreaterThan(0.3)
  expect(result).toMatchObject({
    maxPositionError: legacy.maxPositionError, refinementPositionBound: legacy.maxPositionError,
    maxLocalizedDisplacement: 0,
  })
})

it('declines a protected-row change, a different V basis and nonunit weights', () => {
  const { source, refined } = exactBaseline([0, 1, 2, 3, 4, 5, 6])
  const candidate = moved(refined, 1, 1)
  candidate.poles[2][2] += 1
  expect(() => boundExperimentalPeriodicLocalizedVDisplacement(source, refined, candidate)).toThrow(/polo protetto/)
  expect(() => boundExperimentalPeriodicLocalizedVDisplacement(source, refined, { ...candidate, kv: [0, 0.75, 2, 3, 4, 5, 6] }))
    .toThrow(/stessa base V/)
  candidate.rational = [1, 0]
  candidate.weights[0] = 2
  expect(() => boundExperimentalPeriodicLocalizedVDisplacement(source, refined, candidate)).toThrow(/pesi unitari/)
})

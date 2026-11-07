// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundPeriodicLinearVRefinement } from '../experimentalPeriodicLinearVRefinementBound'
import { refineLinearPeriodicV } from '../periodic'

function linearNet(kv = [0, 1]): Net {
  const xy = [[0, 0], [8, 0], [8, 8], [0, 8]]
  return {
    nu: 4, nv: 2, du: 3, dv: 1, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv, mv: [2, 2],
    poles: xy.flatMap(([x, y]): Point[] => [[x, y, 0], [x, y, 48]]),
    weights: Array<number>(8).fill(1),
  }
}

it('uses the stored V knots, including rounding at a large parameter origin', () => {
  const first = 2 ** 50
  const source = linearNet([first, first + 4])
  const refined = refineLinearPeriodicV(source, 9)
  expect(refined.kv.map(knot => knot - first)).toEqual([0, 0.75, 1.25, 2, 2.75, 3.25, 4])
  const before = structuredClone({ source, refined })

  const result = boundPeriodicLinearVRefinement(source, refined)

  // Because the Z increment is 48 and the interval width is 4, each exact
  // cubic Z coefficient is the sum of the three knot offsets in quarters.
  const exactZ = [0, 3, 8, 16, 24, 32, 40, 45, 48]
  const exactMax = Math.max(...refined.poles.map(([, , z], i) => Math.abs(z - exactZ[i % 9])))
  expect(exactMax).toBeGreaterThan(0.3)
  expect(result.maxPositionError).toBeGreaterThanOrEqual(exactMax)
  expect(result.maxPositionError).toBeLessThan(exactMax + 1e-11)
  expect(result.maxBoundaryPositionError).toBe(0)
  expect(result.checkedPoles).toBe(36)
  expect({ source, refined }).toEqual(before)
})

it('bounds cubic Bézier degree elevation and distinguishes interior and border drift', () => {
  const source = linearNet()
  const refined: Net = {
    ...source, nv: 4, dv: 3, mv: [4, 4], weights: Array<number>(16).fill(1),
    poles: source.poles.filter((_, i) => i % 2 === 0)
      .flatMap(([x, y]) => [0, 16, 32, 48].map((z): Point => [x, y, z])),
  }

  expect(boundPeriodicLinearVRefinement(source, refined).maxPositionError).toBeLessThan(1e-12)
  refined.poles[1][0] += 0.25
  refined.poles[1][1] -= 0.5
  refined.poles[3][2] += 0.125

  const result = boundPeriodicLinearVRefinement(source, refined)
  expect(result.maxPositionError).toBeGreaterThanOrEqual(0.75)
  expect(result.maxPositionError).toBeLessThan(0.75 + 1e-12)
  expect(result.maxBoundaryPositionError).toBeGreaterThanOrEqual(0.125)
  expect(result.maxBoundaryPositionError).toBeLessThan(0.125 + 1e-12)
})

it('rejects changed bases, nonunit weights, unsupported row counts and missing data', () => {
  const source = linearNet()
  const refined = refineLinearPeriodicV(source, 9)
  const wrongU = { ...refined, ku: [0, 0.5, 2, 3, 4] }
  const wrongV = { ...refined, kv: [...refined.kv.slice(0, -1), 2] }
  const weighted = structuredClone(refined)
  weighted.rational = [1, 0]
  weighted.weights[0] = 0.5
  const sparse = structuredClone(refined)
  delete sparse.poles[0]

  expect(() => boundPeriodicLinearVRefinement(source, wrongU)).toThrow(/base U e gli estremi V/)
  expect(() => boundPeriodicLinearVRefinement(source, wrongV)).toThrow(/base U e gli estremi V/)
  expect(() => boundPeriodicLinearVRefinement(source, weighted)).toThrow(/pesi unitari/)
  expect(() => boundPeriodicLinearVRefinement(source, refineLinearPeriodicV(source, 5))).toThrow(/file cubiche/)
  expect(() => boundPeriodicLinearVRefinement(source, sparse)).toThrow(/reticolo/)
})

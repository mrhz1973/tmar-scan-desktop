// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalPeriodicHeightStripRegularity } from '../experimentalPeriodicHeightStripRegularity'
import { proposeExperimentalPeriodicNineRowStrip } from '../experimentalPeriodicNineRowStrip'

function makeStrip(heights: number[], kv: number[], mv: number[]): Net {
  return {
    nu: 4, nv: heights.length, du: 2, dv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv, mv,
    poles: [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      .flatMap(([x, y], u) => heights.map((z): Point => [x, y, z + u])),
    weights: Array<number>(4 * heights.length).fill(1),
  }
}

it('certifies positive normal orientation on the localized nine-row proposal', () => {
  const net = makeStrip([0, 1, 3, 6, 9, 12, 15, 17, 18], [0, 1, 2, 3, 4, 5, 6], [4, 1, 1, 1, 1, 1, 4])
  const proposal = proposeExperimentalPeriodicNineRowStrip({
    net,
    targetInwardV0: Array.from({ length: 4 }, (): Point => [0, 0, 12]),
    targetInwardV1: Array.from({ length: 4 }, (): Point => [0, 0, -12]),
    derivativeTolerance: 1e-12,
  })

  const result = boundExperimentalPeriodicHeightStripRegularity(proposal.net)
  expect(result).toMatchObject({ checkedUSpans: 4, checkedVSpans: 6, checkedVColumnSpans: 24 })
  expect(result.subdivisions).toBeGreaterThan(0)
  expect(result.minXYTangentNorm).toBeGreaterThan(0)
  expect(result.minXYTangentNorm).toBeLessThanOrEqual(Math.SQRT2)
  // The first-span derivative is 12 - 27t + (63/4)t², with
  // analytic minimum 3/7 at t=6/7. The other spans are no lower.
  expect(result.minVHeightDerivative).toBeGreaterThan(0.1)
  expect(result.minVHeightDerivative).toBeLessThanOrEqual(3 / 7)
  expect(result.minNormalNorm).toBeGreaterThan(0)
  expect(result.minNormalNorm).toBeLessThanOrEqual(Math.SQRT2 * 3 / 7)
})

it('handles repeated interior V knots and verifies every nonempty span', () => {
  const net = makeStrip([0, 1, 2, 5, 9, 13, 16, 17, 18], [0, 1, 3, 5, 6], [4, 2, 1, 2, 4])
  const result = boundExperimentalPeriodicHeightStripRegularity(net)

  // These heights are three times the cubic Greville abscissae, so the
  // exact derivative is 3 throughout, despite the repeated knots.
  expect(result).toMatchObject({ checkedUSpans: 4, checkedVSpans: 4, checkedVColumnSpans: 16, subdivisions: 0 })
  expect(result.minVHeightDerivative).toBeLessThanOrEqual(3)
  expect(result.minVHeightDerivative).toBeGreaterThan(3 - 1e-12)
})

it('proves a nonpositive derivative between the five previously sampled V fractions', () => {
  const net = makeStrip([0, 24, -952, 37_072], [0, 1], [4, 4])
  // Same analytic blind spot as experimentalPeriodicStripSamplingBlindSpot.
  const derivative = (v: number) => 3 * ((200 * v - 5) ** 2 - 1)
  expect([0.05, 0.25, 0.5, 0.75, 0.95].every(v => derivative(v) > 0)).toBe(true)
  expect(derivative(1 / 40)).toBe(-3)
  expect(() => boundExperimentalPeriodicHeightStripRegularity(net))
    .toThrow(/derivata V non positiva comprovata alla colonna 0, campata 0/)
})

it('declines a strip outside the height model and a vanishing horizontal tangent', () => {
  const net = makeStrip([0, 1, 2, 3], [0, 1], [4, 4])
  net.poles[1][0] += 0.25
  expect(() => boundExperimentalPeriodicHeightStripRegularity(net))
    .toThrow(/proiezione XY deve essere indipendente/)
  for (const point of net.poles) [point[0], point[1]] = [0, 0]
  expect(() => boundExperimentalPeriodicHeightStripRegularity(net))
    .toThrow(/tangente XY non comprovata/)
})

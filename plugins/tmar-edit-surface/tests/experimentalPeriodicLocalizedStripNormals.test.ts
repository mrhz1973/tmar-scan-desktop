// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeExperimentalPeriodicBezierStrip } from '../experimentalPeriodicBezierStrip'
import { proposeExperimentalPeriodicNineRowStrip } from '../experimentalPeriodicNineRowStrip'

function makeStrip(heights: number[], kv: number[], mv: number[]): Net {
  return {
    nu: 4, nv: heights.length, du: 2, dv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv, mv,
    poles: [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      .flatMap(([x, y]) => heights.map((z): Point => [x, y, z])),
    weights: Array<number>(4 * heights.length).fill(1),
  }
}

function derivativeHeights(net: Net): number[] {
  const full = net.kv.flatMap((knot, i) => Array<number>(net.mv[i]).fill(knot))
  return Array.from({ length: net.nv - 1 }, (_, i) =>
    3 * (net.poles[i + 1][2] - net.poles[i][2]) / (full[i + 4] - full[i + 1]))
}

function expectProductSurface(net: Net, original: Net, heights: number[]) {
  expect({ ...net, poles: original.poles }).toEqual(original)
  for (const [i, point] of net.poles.entries()) {
    expect(point).toEqual([original.poles[i][0], original.poles[i][1], heights[i % net.nv]])
  }
}

it('preserves the normal orientation with nine V rows for tangents that invert it with four rows', () => {
  const four = makeStrip([0, 6, 12, 18], [0, 6], [4, 4])
  const nine = makeStrip([0, 1, 3, 6, 9, 12, 15, 17, 18], [0, 1, 2, 3, 4, 5, 6], [4, 1, 1, 1, 1, 1, 4])
  const request = {
    targetInwardV0: Array.from({ length: 4 }, (): Point => [0, 0, 12]),
    targetInwardV1: Array.from({ length: 4 }, (): Point => [0, 0, -12]),
    derivativeTolerance: 1e-12,
  }
  const short = proposeExperimentalPeriodicBezierStrip({ ...request, net: four })
  expectProductSurface(short.net, four, [0, 24, -6, 18])
  const bezier = derivativeHeights(short.net)
  expect(bezier).toEqual([12, -15, 12])
  // In both models S(U,V) = (X(U), Y(U), z(V)). The U tangent on each
  // span interpolates two orthogonal square edges of length 2, so it is
  // nonzero. The normal has the original orientation exactly when z' > 0.
  // At the center the three quadratic Bernstein weights are 1/4, 1/2, 1/4.
  expect((bezier[0] + 2 * bezier[1] + bezier[2]) / 4).toBe(-1.5)

  expect(derivativeHeights(nine)).toEqual(Array<number>(8).fill(3))
  const localized = proposeExperimentalPeriodicNineRowStrip({ ...request, net: nine })
  expectProductSurface(localized.net, nine, [0, 4, 3, 6, 9, 12, 15, 14, 18])
  expect(localized.changedIndices.slice().sort((a, b) => a - b)).toEqual([1, 7, 10, 16, 19, 25, 28, 34])
  const derivative = derivativeHeights(localized.net)
  expect(derivative).toEqual([12, -1.5, 3, 3, 3, 3, -1.5, 12])
  expect(derivative).toEqual(derivative.slice().reverse())

  // The first unit span has weights (1-t)^2, 2t-3t²/2 and t²/2.
  // Its derivative polynomial attains its minimum at the interior vertex.
  const [d0, d1, d2] = derivative
  const linear = 2 * (d1 - d0), quadratic = d0 - 1.5 * d1 + 0.5 * d2
  const vertex = -linear / (2 * quadratic)
  expect(quadratic).toBeGreaterThan(0)
  expect(vertex).toBeCloseTo(6 / 7, 13)
  const firstSpanMinimum = d0 - linear ** 2 / (4 * quadratic)
  expect(firstSpanMinimum).toBeCloseTo(3 / 7, 13)

  // In the second span the only nonconstant contribution is d1, whose
  // basis weight ranges from 0 to 1/2. The central spans have all weights
  // on coefficient value 3. Symmetry supplies the other two spans.
  const secondSpanMinimum = Math.min(d2, (d1 + d2) / 2)
  expect(secondSpanMinimum).toBe(0.75)
  expect(Math.min(firstSpanMinimum, secondSpanMinimum, ...derivative.slice(2, 6))).toBeGreaterThan(0)
})

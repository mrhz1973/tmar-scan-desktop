// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeExperimentalPeriodicBezierStrip } from '../experimentalPeriodicBezierStrip'

it('misses an analytic normal reversal when checking only the five interior V fractions', () => {
  const height = 37_072
  const xy = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  const strip: Net = {
    nu: 4, nv: 4, du: 2, dv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv: [0, 1], mv: [4, 4],
    poles: xy.flatMap(([x, y]) => [0, height / 3, 2 * height / 3, height].map((z): Point => [x, y, z])),
    weights: Array<number>(16).fill(1),
  }

  // z(v) = 40000v³ - 3000v² + 72v, with the same endpoints as the linear strip.
  const derivative = (v: number) => 3 * ((200 * v - 5) ** 2 - 1)
  const request = {
    net: strip,
    targetInwardV0: xy.map((): Point => [0, 0, derivative(0)]),
    targetInwardV1: xy.map((): Point => [0, 0, -derivative(1)]),
    derivativeTolerance: 1e-8,
  }
  const proposal = proposeExperimentalPeriodicBezierStrip(request)
  for (const { maxEditableDerivativeResidualBound } of proposal.validation)
    expect(maxEditableDerivativeResidualBound).toBeLessThan(request.derivativeTolerance)
  expect(proposal.net.poles).toEqual(
    xy.flatMap(([x, y]) => [0, 24, -952, height].map(z => [x, y, z])),
  )

  const [a, b, c, d] = proposal.net.poles.slice(0, 4).map(point => point[2])
  const bezierDerivative = (v: number) =>
    3 * ((b - a) * (1 - v) ** 2 + 2 * (c - b) * v * (1 - v) + (d - c) * v ** 2)
  // The quadratic U tangent interpolates two orthogonal square edges per
  // span. It stays nonzero, so the dot with the original normal has the
  // sign of z'(v) on this product surface.
  for (const v of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    expect(bezierDerivative(v)).toBeCloseTo(derivative(v), 9)
    expect(bezierDerivative(v)).toBeGreaterThan(0)
  }
  expect(derivative(1 / 40)).toBe(-3)
  expect(bezierDerivative(1 / 40)).toBeCloseTo(-3, 12)
})

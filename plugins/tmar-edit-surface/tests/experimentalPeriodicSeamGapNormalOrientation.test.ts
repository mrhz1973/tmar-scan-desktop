// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from '../experimentalPeriodicOneSidedSurfaceDerivatives'
import { checkExperimentalPeriodicSeamC1 } from '../experimentalPeriodicSeamC1'
import { boundExperimentalPeriodicSeamDerivativeGap } from '../experimentalPeriodicSeamDerivativeGap'

function strip(incomingX: number, outgoingX: number): Net {
  return {
    du: 3, dv: 1, nu: 5, nv: 2, periodic: [1, 0], rational: [0, 0],
    ku: [0, 3, 5, 8], mu: [3, 1, 1, 3], kv: [0, 1], mv: [2, 2],
    poles: [[0, 0], [outgoingX, 0], [1, 1], [-1, 1], [-incomingX, 0]]
      .flatMap(([x, y]) => [0, 1].map((v): Point => [x, y, v])),
    weights: Array<number>(10).fill(1),
  }
}

function seamNormals(net: Net) {
  const evaluate = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(net).evaluate
  return [evaluate(0, 0.5, { u: 'left' }).normal, evaluate(0, 0.5, { u: 'right' }).normal]
}

it('separates a small absolute U derivative gap from orientation and geometric tangency', () => {
  // Each U end span has width 3 and degree 3. The seam is (0,0,V),
  // so the exact normal fields are (0,-incomingX,0) and
  // (0,-outgoingX,0), constant for all V. The evaluator cross-checks
  // the analytic fields at a single parameter.
  for (const epsilon of [2 ** -40, 2 ** -400, 2 ** -1000]) {
    const net = strip(epsilon, -epsilon)
    expect(boundExperimentalPeriodicSeamDerivativeGap(net, 4 * epsilon)).toMatchObject({
      status: 'within-tolerance', maxDerivativeDifferenceBound: 2 * epsilon,
    })
    expect(checkExperimentalPeriodicSeamC1(net).c1AtUSeam).toBe(false)
    const [left, right] = seamNormals(net)
    expect(left[1]).toBe(-epsilon)
    expect(right[1]).toBe(epsilon)
    expect(Math.hypot(...left)).toBe(epsilon)
    expect(Math.hypot(...right)).toBe(epsilon)
    // Normalize before multiplying so the dot does not underflow.
    expect((left[1] / Math.hypot(...left)) * (right[1] / Math.hypot(...right))).toBe(-1)
  }

  // With positive derivative ratio 5/2, the common seam is regular and
  // the analytic normals define the same oriented tangent plane.
  const differentSpeeds = strip(2, 5)
  expect(boundExperimentalPeriodicSeamDerivativeGap(differentSpeeds, 1e-9)).toMatchObject({
    status: 'inconclusive', maxDerivativeDifferenceBound: 3,
  })
  expect(checkExperimentalPeriodicSeamC1(differentSpeeds).c1AtUSeam).toBe(false)
  const [left, right] = seamNormals(differentSpeeds)
  expect(left[1]).toBe(-2)
  expect(right[1]).toBe(-5)
  expect(Math.hypot(...left)).toBe(2)
  expect(Math.hypot(...right)).toBe(5)
  expect((left[1] / Math.hypot(...left)) * (right[1] / Math.hypot(...right))).toBe(1)
})

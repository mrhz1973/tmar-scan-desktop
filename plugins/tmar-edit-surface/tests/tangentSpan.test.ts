// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net } from '../brep'
import { formatTangentSpanDisplacement, planTangentSpan } from '../tangentSpan'

const fixture = (): Net => ({
  nu: 3, nv: 3, du: 1, dv: 1, rational: [1, 1],
  ku: [0, .5, 1], kv: [0, .5, 1], mu: [2, 1, 2], mv: [2, 1, 2],
  weights: [1, 1, 1, 1, 2, 1, 1, 1, 1],
  poles: Array.from({length: 9}, (_, i) => [Math.floor(i / 3), i % 3, i === 4 ? .2 : i === 8 ? 1 : 0]),
})

it('requires authorization for each off-plane support pole and leaves poles outside the span alone', () => {
  const net = fixture()
  expect(() => planTangentSpan(net,.25,.25,[0,0,0],[0,0,1],[0,1,3,8])).toThrow(/fuori piano/)
  const plan = planTangentSpan(net,.25,.25,[0,0,0],[0,0,1],[4,8])
  expect(plan.review).toMatchObject({u:[0,.5],v:[0,.5],supportCount:4,movedCount:1})
  expect([...plan.projections]).toEqual([[4,[1,1,0]]])
  expect(net.poles[4]).toEqual([1,1,.2])
})

it('bounds Euclidean movement from the planned poles across the rational surface', () => {
  const net = fixture()
  const plan = planTangentSpan(net, .25, .25, [0, 0, 0], [.6, 0, .8], [3, 4])
  const movements = [...plan.projections].map(([id, pole]) =>
    Math.hypot(...pole.map((coordinate, axis) => coordinate - net.poles[id][axis])))
  const largestMovement = Math.max(...movements)

  expect(plan.review.maxSurfaceDisplacementMm).toBeGreaterThanOrEqual(largestMovement)
  expect(plan.review.maxSurfaceDisplacementMm).toBeCloseTo(.76, 12)
  expect(plan.review.maxPoleDistanceMm).toBeLessThan(1e-8)

  // In the adjacent U span, poles 3 and 4 have rational influences 1/5 and 2/5.
  // Both move in the same direction, so their weighted distances add.
  const adjacentMovement = (movements[0] + 2 * movements[1]) / 5
  expect(adjacentMovement).toBeCloseTo(.424, 12)
  expect(adjacentMovement).toBeLessThan(plan.review.maxSurfaceDisplacementMm)
})

it('reports zero when no pole moves and displays any positive limit rounded upwards', () => {
  const net = fixture()
  net.poles[4] = [1, 1, 0]
  const { review } = planTangentSpan(net, .25, .25, [0, 0, 0], [0, 0, 1], [])

  expect(review.maxSurfaceDisplacementMm).toBe(0)
  expect(formatTangentSpanDisplacement(review.maxSurfaceDisplacementMm)).toBe('0,000')
  expect(formatTangentSpanDisplacement(.09800000000000002)).toBe('0,099')
  expect(formatTangentSpanDisplacement(Number.MIN_VALUE)).toBe('0,001')
})

it('refuses a point exactly on the boundary between UV spans', () => {
  expect(() => planTangentSpan(fixture(),.5,.25,[0,0,0],[0,0,1],[4])).toThrow(/linee dei nodi/)
})

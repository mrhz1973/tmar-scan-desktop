// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net } from '../brep'
import { planTangentSpan } from '../tangentSpan'

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

it('refuses a point exactly on the boundary between UV spans', () => {
  expect(() => planTangentSpan(fixture(),.5,.25,[0,0,0],[0,0,1],[4])).toThrow(/linee dei nodi/)
})

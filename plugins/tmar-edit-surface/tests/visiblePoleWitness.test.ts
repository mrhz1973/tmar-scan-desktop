// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net } from '../brep'
import { visiblePoleWitness } from '../visiblePoleWitness'

const net: Net = { nu: 3, nv: 3, du: 1, dv: 1, ku: [0, 1, 2], kv: [0, 1, 2],
  mu: [2, 1, 2], mv: [2, 1, 2], poles: Array.from({ length: 9 }, () => [0, 0, 0]),
  weights: Array(9).fill(1), rational: [0, 0] }

it('finds a sampled interior point inside the selected pole support', () => {
  const p = visiblePoleWitness(net, 0, (u, v) => u > .4 && v > .4 ? 'in' : 'out')
  expect(p).not.toBeNull()
  expect(p!.u).toBeGreaterThan(.4); expect(p!.u).toBeLessThan(1)
  expect(p!.v).toBeGreaterThan(.4); expect(p!.v).toBeLessThan(1)
})
it('does not claim visibility for points outside support or on the boundary', () => {
  expect(visiblePoleWitness(net, 0, (u, v) => u > 1 || v > 1 ? 'in' : 'on')).toBeNull()
})
it('requires meaningful influence when a minimum is requested', () => {
  expect(visiblePoleWitness(net,0,(u,v)=>u>.9&&v>.9?'in':'out',.01)).toBeNull()
  expect(visiblePoleWitness(net,0,()=> 'in',.1)).not.toBeNull()
})
it('rejects a periodic or invalid rational net before classifying', () => {
  expect(() => visiblePoleWitness({ ...net, periodic: [1, 0] }, 0, () => 'in')).toThrow()
  expect(() => visiblePoleWitness({ ...net, weights: Array(9).fill(0) }, 0, () => 'in')).toThrow()
  expect(() => visiblePoleWitness(net, 9, () => 'in')).toThrow()
})

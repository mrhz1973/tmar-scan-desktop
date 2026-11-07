// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalPeriodicSeamDerivativeGap } from '../experimentalPeriodicSeamDerivativeGap'

function netWith(ku = [0, 2, 5, 9], du = 3, kv = [0, 1], dv = 2): Net {
  const nv = kv.length + dv - 1, nu = du + 2
  const first = ku[1] - ku[0], last = ku[3] - ku[2]
  const columns = [0, first, ...Array<number>(nu - 3).fill(0), -last]
  return {
    du, dv, nu, nv, ku, mu: [du, 1, 1, du], kv, mv: [dv + 1, ...kv.slice(1, -1).map(() => 1), dv + 1],
    periodic: [1, 0], rational: [0, 0],
    poles: columns.flatMap(x => Array.from({ length: nv }, (_, v): Point => [x, 0, v])),
    weights: Array<number>(nu * nv).fill(1),
  }
}

it('rounds a gap near 1e-11 outward by the smallest binary64 amount', () => {
  const net = netWith([0, 3, 7, 12], 2)
  const before = structuredClone(net)
  expect(boundExperimentalPeriodicSeamDerivativeGap(net, 0)).toMatchObject({
    status: 'within-tolerance', maxDerivativeDifferenceBound: 0, checkedVCoefficients: 3,
  })
  expect(net).toEqual(before)
  net.poles[net.nv + 1][0] += 2 ** -36

  const tolerance = 1e-11
  const result = boundExperimentalPeriodicSeamDerivativeGap(net, tolerance)
  expect(result.status).toBe('within-tolerance')
  const upper = result.maxDerivativeDifferenceBound!
  expect(upper).toBeGreaterThan(9e-12)
  expect(upper).toBeLessThan(tolerance)

  // The independent exact oracle is (2 * 2^-36) / 3. Use integer units
  // 2^-100 to check the bound and its immediate predecessor.
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, upper)
  view.setBigUint64(0, view.getBigUint64(0) - 1n)
  const previous = view.getFloat64(0)
  const target = 1n << 65n
  expect(3n * BigInt(upper * 2 ** 100)).toBeGreaterThanOrEqual(target)
  expect(3n * BigInt(previous * 2 ** 100)).toBeLessThan(target)
  expect(boundExperimentalPeriodicSeamDerivativeGap(net, previous).status).toBe('inconclusive')
})

it('retains a nonzero difference when the two native quotients round to the same number', () => {
  const epsilon = Number.EPSILON, net = netWith([0, 1 + epsilon, 2, 3])
  const right = 1 + 2 * epsilon, left = 1 + epsilon
  net.poles[net.nv][0] = right
  net.poles[(net.nu - 1) * net.nv][0] = -left
  expect(right / (1 + epsilon)).toBe(left)

  const result = boundExperimentalPeriodicSeamDerivativeGap(net, 0)
  expect(result.status).toBe('inconclusive')
  // The cross multiplication leaves the magnitude 3ε²/(1+ε).
  expect(result.maxDerivativeDifferenceBound!).toBeGreaterThan(2 * epsilon ** 2)
  expect(result.maxDerivativeDifferenceBound!).toBeLessThanOrEqual(3 * epsilon ** 2)
})

it('rounds a positive subnormal gap upward and handles exact subnormal span widths', () => {
  const unit = Number.MIN_VALUE
  const tinySpans = netWith([0, unit, 2 * unit, 4 * unit])
  expect(boundExperimentalPeriodicSeamDerivativeGap(tinySpans, 0)).toMatchObject({
    status: 'within-tolerance', maxDerivativeDifferenceBound: 0,
  })

  const net = netWith([0, 8, 9, 17])
  net.poles[net.nv][0] = 0
  net.poles[(net.nu - 1) * net.nv][0] = -unit
  // The exact absolute gap is 3/8 of the least positive subnormal.
  expect(boundExperimentalPeriodicSeamDerivativeGap(net, 0)).toMatchObject({
    status: 'inconclusive', maxDerivativeDifferenceBound: unit,
  })
  expect(boundExperimentalPeriodicSeamDerivativeGap(net, unit).status).toBe('within-tolerance')
})

it('cancels overflowing individual derivatives and declines an unrepresentable absolute gap', () => {
  const net = netWith([0, 1, 2, 3])
  const previous = (net.nu - 1) * net.nv
  net.poles[net.nv][0] = 1e308
  net.poles[previous][0] = -1e308
  expect(3 * net.poles[net.nv][0]).toBe(Infinity)
  expect(boundExperimentalPeriodicSeamDerivativeGap(net, 0)).toMatchObject({
    status: 'within-tolerance', maxDerivativeDifferenceBound: 0,
  })

  net.poles[previous][0] = 0
  expect(boundExperimentalPeriodicSeamDerivativeGap(net, Number.MAX_VALUE)).toMatchObject({
    status: 'inconclusive', reason: 'unrepresentable-bound', maxDerivativeDifferenceBound: null,
  })
})

it('bounds a localized V mismatch missed by endpoints and all five former interior samples', () => {
  const net = netWith([0, 2, 5, 9], 3, [0, 1 / 64, 3 / 128, 1 / 32, 1], 1)
  net.poles[net.nv + 2][0] += 2
  net.poles[net.nv + 2][1] -= 2
  // The mismatch vector is (3,-3,0) times the linear hat at knot 3/128.
  const hat = (v: number) => Math.max(0, 1 - 128 * Math.abs(v - 3 / 128))
  expect([0, 0.05, 0.25, 0.5, 0.75, 0.95, 1].every(v => hat(v) === 0)).toBe(true)
  expect(hat(3 / 128)).toBe(1)
  expect(boundExperimentalPeriodicSeamDerivativeGap(net, 1)).toMatchObject({
    status: 'inconclusive', maxDerivativeDifferenceBound: 6, checkedVCoefficients: 5,
  })
})

it('declines invalid tolerances, knots, seam multiplicities and weights', () => {
  const net = netWith()
  expect(() => boundExperimentalPeriodicSeamDerivativeGap(net, Infinity)).toThrow(/tolleranza/)
  expect(() => boundExperimentalPeriodicSeamDerivativeGap(net, -1)).toThrow(/tolleranza/)
  expect(() => boundExperimentalPeriodicSeamDerivativeGap({ ...net, ku: [0, 2, 2, 9] }, 0)).toThrow(/reticolo/)
  expect(() => boundExperimentalPeriodicSeamDerivativeGap({ ...net, mu: [2, 2, 1, 2] }, 0)).toThrow(/molteplicità U/)
  net.rational = [1, 0]
  net.weights[0] = 2
  expect(() => boundExperimentalPeriodicSeamDerivativeGap(net, 0)).toThrow(/pesi unitari/)
})

// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { checkExperimentalPeriodicSeamC1 } from '../experimentalPeriodicSeamC1'

function fixture(lastSpan = 2): Net {
  return {
    du: 3, dv: 2, nu: 5, nv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [0, 2, 5, 5 + lastSpan], mu: [3, 1, 1, 3], kv: [0, 1], mv: [3, 3],
    poles: [0, 2, 6, -6, -lastSpan].flatMap((x, u) =>
      [0, 1, 2].map((v): Point => [x * (v + 1), u === 2 || u === 3 ? 4 : 0, v])),
    weights: Array<number>(15).fill(1),
  }
}

it.each([2, 4])('finds exact C1 at a saturated seam with last span width %s', lastSpan => {
  const net = fixture(lastSpan), before = structuredClone(net)
  // P1-P0 = 2(v+1) and P0-Pprev = lastSpan(v+1) in the X coefficient,
  // so both derivative fields have X coefficients 3, 6 and 9.
  expect(checkExperimentalPeriodicSeamC1(net)).toMatchObject({
    c1AtUSeam: true, checkedVCoefficients: 3, mismatchedVCoefficients: [],
    incomingDerivativeIdenticallyZero: false, outgoingDerivativeIdenticallyZero: false,
  })
  expect(net).toEqual(before)
})

it('detects a one-ULP interior V coefficient change lost by floating subtraction', () => {
  const net = fixture(), v = 1
  const boundary = net.poles[v], next = net.poles[net.nv + v], previous = net.poles[(net.nu - 1) * net.nv + v]
  boundary[0] = -(2 ** 53)
  previous[0] = -(2 ** 54)
  next[0] = 0
  expect(checkExperimentalPeriodicSeamC1(net).c1AtUSeam).toBe(true)

  next[0] = Number.MIN_VALUE // The first binary64 value after zero.
  expect(next[0] - boundary[0]).toBe(boundary[0] - previous[0])
  expect(checkExperimentalPeriodicSeamC1(net)).toMatchObject({
    c1AtUSeam: false, mismatchedVCoefficients: [1],
  })
})

it('distinguishes a zero matching derivative from a one-sided zero derivative', () => {
  const net = fixture(4)
  for (let v = 0; v < net.nv; v++) {
    net.poles[net.nv + v] = [...net.poles[v]]
    net.poles[(net.nu - 1) * net.nv + v] = [...net.poles[v]]
  }
  expect(checkExperimentalPeriodicSeamC1(net)).toMatchObject({
    c1AtUSeam: true, incomingDerivativeIdenticallyZero: true, outgoingDerivativeIdenticallyZero: true,
  })
  net.poles[net.nv][0] = 1
  expect(checkExperimentalPeriodicSeamC1(net)).toMatchObject({
    c1AtUSeam: false, incomingDerivativeIdenticallyZero: true, outgoingDerivativeIdenticallyZero: false,
    mismatchedVCoefficients: [0],
  })
})

it('declines unsupported multiplicities and weights', () => {
  const net = fixture()
  expect(() => checkExperimentalPeriodicSeamC1({ ...net, mu: [2, 2, 1, 2] })).toThrow(/molteplicità U/)
  const creasedV: Net = { ...net, dv: 1, kv: [0, 0.5, 1], mv: [2, 1, 2] }
  expect(() => checkExperimentalPeriodicSeamC1(creasedV)).toThrow(/base V C1/)
  net.rational = [1, 0]
  net.weights[0] = 2
  expect(() => checkExperimentalPeriodicSeamC1(net)).toThrow(/pesi unitari/)
})

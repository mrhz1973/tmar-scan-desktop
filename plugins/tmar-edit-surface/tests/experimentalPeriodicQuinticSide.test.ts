// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeExperimentalPeriodicQuinticSide } from '../experimentalPeriodicQuinticSide'

function side(kv = [0, 2, 5, 7, 9, 12, 16, 20], mv = [6, 1, 1, 1, 1, 1, 1, 6]): Net {
  const full = kv.flatMap((knot, i) => Array<number>(mv[i]).fill(knot))
  const nv = full.length - 6
  // The Greville coefficient of z(V)=5V is the sum of five knots.
  const heights = Array.from({ length: nv }, (_, i) => full.slice(i + 1, i + 6).reduce((sum, knot) => sum + knot, 0))
  return {
    du: 3, dv: 5, nu: 4, nv, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv, mv,
    poles: [[0, 0], [8, 0], [8, 8], [0, 8]].flatMap(([x, y]) => heights.map((z): Point => [x, y, z])),
    weights: Array<number>(4 * nv).fill(1),
  }
}

const simple = side()
const repeated = side([0, 2, 5, 7, 9, 16, 20], [6, 2, 1, 1, 1, 1, 6])
const bezier = side([0, 5], [6, 6])

it.each([
  { net: simple, edge: 'V0' as const, widths: [2, 5] },
  { net: simple, edge: 'V1' as const, widths: [4, 8] },
  { net: repeated, edge: 'V0' as const, widths: [2, 2] },
  { net: bezier, edge: 'V1' as const, widths: [5, 5] },
])('preserves both positions and the opposite derivative at $edge with inward widths $widths',
  ({ net, edge, widths: [firstWidth, secondWidth] }) => {
    const before = structuredClone(net)
    const direction = edge === 'V0' ? 1 : -1
    const border = edge === 'V0' ? 0 : net.nv - 1
    const targets = Array.from({ length: net.nu }, (_, u): Point => [5 * (u % 2), 0, 10 * direction])
    const result = proposeExperimentalPeriodicQuinticSide({
      net, edge, targetInward: targets, derivativeTolerance: 1e-11, secondDerivativeTolerance: 1e-11,
    })

    expect(net).toEqual(before)
    expect({ ...result.net, poles: net.poles }).toEqual(net)
    expect(result.changedIndices).toHaveLength(2 * net.nu)
    for (const [i, point] of result.net.poles.entries()) {
      const v = i % net.nv
      if (v !== border + direction && v !== border + 2 * direction) expect(point).toEqual(net.poles[i])
    }
    for (let u = 0; u < net.nu; u++) {
      const index = u * net.nv + border
      const a = result.net.poles[index], b = result.net.poles[index + direction]
      const c = result.net.poles[index + 2 * direction]
      const first = a.map((x, axis) => 5 * (b[axis] - x) / firstWidth)
      const second = b.map((x, axis) => 5 * (c[axis] - x) / secondWidth)
      expect(first).toEqual(targets[u])
      expect(second).toEqual(targets[u])
    }
    expect(result.maxDerivativeResidualBound).toBeLessThan(1e-11)
    expect(result.maxSecondDerivativeChangeBound).toBeLessThan(1e-11)
    expect(result.maxPositionDisplacementBound).toBeGreaterThanOrEqual(2 * (firstWidth + secondWidth))
    expect(result.maxPositionDisplacementBound).toBeLessThan(2 * (firstWidth + secondWidth) + 1e-11)
  })

it('refuses incompatible locks for either of the two edited rows', () => {
  const net = side(), before = structuredClone(net)
  const request = { net, edge: 'V0' as const, targetInward: Array.from({ length: 4 }, (): Point => [0, 0, 10]),
    derivativeTolerance: 1e-11, secondDerivativeTolerance: 1e-11 }
  expect(() => proposeExperimentalPeriodicQuinticSide({ ...request, lockIndices: [1] })).toThrow(/prima derivata.*bloccato 1/)
  expect(() => proposeExperimentalPeriodicQuinticSide({ ...request, lockIndices: [2] })).toThrow(/seconda derivata.*bloccato 2/)
  expect(net).toEqual(before)
})

it('preserves a nonzero selected-border second derivative', () => {
  const net = side()
  for (let u = 0; u < net.nu; u++) net.poles[u * net.nv + 2][2] += 5
  const second = (n: Net) => {
    const [a, b, c] = n.poles
    return 2 * ((c[2] - b[2]) - 2.5 * (b[2] - a[2]))
  }
  expect(second(net)).toBe(10)
  const result = proposeExperimentalPeriodicQuinticSide({ net, edge: 'V0',
    targetInward: Array.from({ length: 4 }, (): Point => [0, 0, 10]),
    derivativeTolerance: 1e-11, secondDerivativeTolerance: 1e-11 })
  expect(second(result.net)).toBe(10)
  expect(result.maxSecondDerivativeChangeBound).toBeLessThan(1e-11)
})

it('bounds a lost first-derivative displacement at large coordinate scale', () => {
  const net = side()
  for (const point of net.poles) point[0] += 2 ** 53
  const request = { net, edge: 'V0' as const, targetInward: Array.from({ length: 4 }, (): Point => [0.25, 0, 5]),
    derivativeTolerance: 0.3, secondDerivativeTolerance: 1e-11 }
  const result = proposeExperimentalPeriodicQuinticSide(request)
  expect(result.changedIndices).toEqual([])
  expect(result.maxDerivativeResidualBound).toBeGreaterThanOrEqual(0.25)
  expect(result.maxSecondDerivativeChangeBound).toBe(0)
  expect(() => proposeExperimentalPeriodicQuinticSide({ ...request, derivativeTolerance: 0.1 }))
    .toThrow(/residuo numerico prima derivata/)
})

it('declines saturated U seams, bad targets and invalid budgets', () => {
  const net = side()
  const request = { net, edge: 'V0' as const, targetInward: Array.from({ length: 4 }, (): Point => [0, 0, 10]),
    derivativeTolerance: 1e-11, secondDerivativeTolerance: 1e-11 }
  const saturated = { ...net, du: 2, ku: [0, 1, 2, 3], mu: [2, 1, 1, 2] }
  expect(() => proposeExperimentalPeriodicQuinticSide({ ...request, net: saturated })).toThrow(/U strutturalmente C1/)
  expect(() => proposeExperimentalPeriodicQuinticSide({ ...request, targetInward: [] })).toThrow(/derivata entrante/)
  expect(() => proposeExperimentalPeriodicQuinticSide({ ...request, secondDerivativeTolerance: Infinity })).toThrow(/tolleranze/)
})

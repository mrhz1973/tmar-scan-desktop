// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeExperimentalPeriodicBezierStrip } from '../experimentalPeriodicBezierStrip'
import { proposeExperimentalPeriodicClampedStripDerivatives } from '../experimentalPeriodicClampedStripDerivatives'
import { proposeExperimentalPeriodicNineRowStrip } from '../experimentalPeriodicNineRowStrip'

function strip(): Net {
  return {
    nu: 4, nv: 9, du: 3, dv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv: [2, 5, 6, 7, 8, 10, 16], mv: [4, 1, 1, 1, 1, 1, 4],
    poles: [[0, 0], [8, 0], [8, 8], [0, 8]].flatMap(([x, y]) =>
      Array.from({ length: 9 }, (_, v): Point => [x, y, v])),
    weights: Array<number>(36).fill(1),
  }
}

function requestFor(net = strip()) {
  return {
    net,
    targetInwardV0: Array.from({ length: net.nu }, (): Point => [0, 0, 1]),
    targetInwardV1: Array.from({ length: net.nu }, (): Point => [0, 0, -0.5]),
    derivativeTolerance: 1e-12,
  }
}

it.each([
  { kv: [2, 5, 6, 7, 8, 10, 16], mv: [4, 1, 1, 1, 1, 1, 4] },
  { kv: [2, 5, 7, 10, 16], mv: [4, 2, 1, 2, 4] },
])('uses both end span widths and preserves every other row with V multiplicities $mv', ({ kv, mv }) => {
  const net = { ...strip(), kv, mv }
  net.poles[4][0] = -0
  const before = structuredClone(net)
  const request = requestFor(net)
  request.targetInwardV0 = request.targetInwardV0.map((_, u) => [0.25, -0.5, 1 + u / 4])
  request.targetInwardV1 = request.targetInwardV1.map((_, u) => [0, 0.125, -1 - u / 2])
  const proposal = proposeExperimentalPeriodicNineRowStrip(request)

  expect(net).toEqual(before)
  expect({ ...proposal.net, poles: net.poles }).toEqual(net)
  expect(proposal.changedIndices.slice().sort((a, b) => a - b)).toEqual([1, 7, 10, 16, 19, 25, 28, 34])
  for (const [index, point] of proposal.net.poles.entries()) {
    const u = Math.floor(index / 9), v = index % 9
    if (v === 1) {
      const border = net.poles[u * 9]
      // 3 / (5 - 2) = 1 for the inward derivative at V0.
      expect(point.map((x, axis) => x - border[axis])).toEqual(request.targetInwardV0[u])
    } else if (v === 7) {
      const border = net.poles[u * 9 + 8]
      // 3 / (16 - 10) = 1/2 for the inward derivative at V1.
      expect(point.map((x, axis) => (x - border[axis]) / 2)).toEqual(request.targetInwardV1[u])
    } else {
      expect(point).toEqual(net.poles[index])
    }
  }
  expect(proposal.validation.map(result => result.edge)).toEqual(['V0', 'V1'])
  for (const result of proposal.validation) {
    expect(result.maxEditableDerivativeResidualBound).toBeLessThan(1e-12)
    expect(result.maxLockedDerivativeResidualBound).toBe(0)
  }
})

it('preserves compatible locked poles and refuses an incompatible locked end derivative', () => {
  const request = { ...requestFor(), lockIndices: [0, 4, 7] }
  request.targetInwardV0[0][2] = 2
  const result = proposeExperimentalPeriodicNineRowStrip(request)
  expect(result.changedIndices).toEqual([1])
  for (const i of request.lockIndices) expect(result.net.poles[i]).toEqual(request.net.poles[i])
  expect(result.validation[1].maxLockedDerivativeResidualBound).toBeLessThan(1e-12)

  request.targetInwardV1[0][2] = -2
  expect(() => proposeExperimentalPeriodicNineRowStrip(request)).toThrow(/derivata V1.*polo bloccato 7/)
})

it('reports editable numerical residuals separately and rejects unrepresentable V scales', () => {
  const net = strip()
  for (const point of net.poles) point[0] += 2 ** 53
  const request = requestFor(net)
  request.targetInwardV1[0][0] = 0.25
  const result = proposeExperimentalPeriodicNineRowStrip({ ...request, derivativeTolerance: 0.3 })
  expect(result.net.poles[7][0]).toBe(net.poles[8][0])
  expect(result.validation[0].maxEditableDerivativeResidualBound).toBeLessThan(1e-12)
  expect(result.validation[1].maxEditableDerivativeResidualBound).toBeGreaterThanOrEqual(0.25)
  expect(result.validation[1].maxLockedDerivativeResidualBound).toBe(0)
  expect(() => proposeExperimentalPeriodicNineRowStrip(request)).toThrow(/residuo numerico.*V1.*polo 7/)

  net.kv[0] = 0
  net.kv[1] = Number.MIN_VALUE
  expect(() => proposeExperimentalPeriodicNineRowStrip(request)).toThrow(/scala parametrica V non rappresentabile/)
})

it('rejects malformed derivative coefficients, invalid locks and nonunit weights', () => {
  const request = requestFor()
  expect(() => proposeExperimentalPeriodicBezierStrip(request)).toThrow(/fascia cubica Bézier/)
  expect(() => proposeExperimentalPeriodicNineRowStrip({ ...request, targetInwardV1: [] })).toThrow(/derivata V1/)
  expect(() => proposeExperimentalPeriodicNineRowStrip({ ...request, lockIndices: [36] })).toThrow(/indice bloccato/)
  request.net.rational = [1, 0]
  request.net.weights[0] = 2
  expect(() => proposeExperimentalPeriodicNineRowStrip(request)).toThrow(/pesi unitari/)
})

it('rejects unsupported row counts at runtime even for a valid cubic strip', () => {
  const nine = strip()
  const five = { ...nine, nv: 5, kv: [2, 5, 16], mv: [4, 1, 4],
    poles: nine.poles.filter((_, i) => i % 9 < 5), weights: Array<number>(20).fill(1) }
  expect(() => proposeExperimentalPeriodicClampedStripDerivatives(requestFor(five), 5 as unknown as 4))
    .toThrow(/servono quattro o nove file/)
})

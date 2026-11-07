// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeExperimentalPeriodicBezierStrip } from '../experimentalPeriodicBezierStrip'

function strip(): Net {
  return {
    nu: 4, nv: 4, du: 3, dv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv: [3, 9], mv: [4, 4],
    poles: [[0, 0], [8, 0], [8, 8], [0, 8]]
      .flatMap(([x, y]) => [0, 2, 10, 12].map((z): Point => [x, y, z])),
    weights: Array<number>(16).fill(1),
  }
}

function requestFor(net = strip()) {
  return {
    net,
    targetInwardV0: Array.from({ length: net.nu }, (): Point => [0, 0, 1]),
    targetInwardV1: Array.from({ length: net.nu }, (): Point => [0, 0, -1]),
    derivativeTolerance: 1e-12,
  }
}

it('sets opposite inward derivatives at both synthetic joints and preserves the two border curves', () => {
  const net = strip(), original = structuredClone(net)
  const lower = net.poles.filter((_, index) => index % 4 === 0)
  const upper = net.poles.filter((_, index) => index % 4 === 3)
  const lowerAdjacent = lower.map(([x, y], u): Point => [x - 0.5, y, -4 - u])
  const upperAdjacent = upper.map(([x, y, z], u): Point => [x, y + 0.25, z + 5 + u])
  // The neighbors are linear in V with width 2. Their adjacent rows are
  // inside their own surfaces. The strip needs the opposite derivatives.
  const target = (border: Point[], adjacent: Point[]) => border.map((point, u) =>
    point.map((x, axis) => (x - adjacent[u][axis]) / 2) as Point)
  const proposal = proposeExperimentalPeriodicBezierStrip({
    ...requestFor(net), targetInwardV0: target(lower, lowerAdjacent), targetInwardV1: target(upper, upperAdjacent),
  })

  expect(net).toEqual(original)
  expect({ ...proposal.net, poles: net.poles }).toEqual(net)
  expect(proposal.changedIndices.slice().sort((a, b) => a - b)).toEqual([1, 2, 5, 6, 9, 10, 13, 14])
  for (let u = 0; u < net.nu; u++) {
    const [a, b, c, d] = proposal.net.poles.slice(u * 4, u * 4 + 4)
    expect(a).toEqual(lower[u])
    expect(d).toEqual(upper[u])
    expect(b).toEqual(a.map((x, axis) => 2 * x - lowerAdjacent[u][axis]))
    expect(c).toEqual(d.map((x, axis) => 2 * x - upperAdjacent[u][axis]))
  }
  expect(proposal.validation.map(result => result.edge)).toEqual(['V0', 'V1'])
  for (const result of proposal.validation) {
    expect(result.maxEditableDerivativeResidualBound).toBeLessThan(1e-12)
    expect(result.maxLockedDerivativeResidualBound).toBe(0)
  }
})

it('preserves a compatible lock and reports conflicts separately from editable errors', () => {
  const request = { ...requestFor(), lockIndices: [1, 3] }
  request.targetInwardV1[0][2] = -2
  const proposal = proposeExperimentalPeriodicBezierStrip(request)
  expect(proposal.net.poles[1]).toEqual(request.net.poles[1])
  expect(proposal.net.poles[3]).toEqual(request.net.poles[3])
  expect(proposal.changedIndices).toEqual([2])
  expect(proposal.validation[0].maxLockedDerivativeResidualBound).toBeLessThan(1e-12)

  request.targetInwardV0[0][2] = 2
  expect(() => proposeExperimentalPeriodicBezierStrip(request)).toThrow(/derivata V0.*polo bloccato 1/)
})

it('bounds the numerical residual when a translated pole cannot store the requested displacement', () => {
  const net = strip()
  for (const pole of net.poles) pole[0] += 2 ** 53
  const request = requestFor(net)
  request.targetInwardV0[0][0] = 0.25
  const proposal = proposeExperimentalPeriodicBezierStrip({ ...request, derivativeTolerance: 0.3 })
  expect(proposal.net.poles[1][0]).toBe(net.poles[0][0])
  expect(proposal.validation[0].maxEditableDerivativeResidualBound).toBeGreaterThanOrEqual(0.25)
  expect(proposal.validation[0].maxLockedDerivativeResidualBound).toBe(0)
  expect(() => proposeExperimentalPeriodicBezierStrip(request)).toThrow(/residuo numerico.*V0.*polo 1/)
})

it('refuses malformed targets, invalid locks, tolerances and nonunit weights', () => {
  const request = requestFor()
  expect(() => proposeExperimentalPeriodicBezierStrip({ ...request, targetInwardV0: [] })).toThrow(/derivata V0/)
  const sparse = request.targetInwardV1.slice()
  delete sparse[0]
  expect(() => proposeExperimentalPeriodicBezierStrip({ ...request, targetInwardV1: sparse })).toThrow(/derivata V1/)
  expect(() => proposeExperimentalPeriodicBezierStrip({ ...request, lockIndices: [16] })).toThrow(/indice bloccato/)
  expect(() => proposeExperimentalPeriodicBezierStrip({ ...request, derivativeTolerance: NaN })).toThrow(/tolleranza/)
  request.net.rational = [1, 0]
  request.net.weights[0] = 2
  expect(() => proposeExperimentalPeriodicBezierStrip(request)).toThrow(/pesi unitari/)
})

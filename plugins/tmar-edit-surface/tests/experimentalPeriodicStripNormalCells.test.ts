// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalPeriodicStripNormalCells } from '../experimentalPeriodicStripNormalCells'
import { prepareExperimentalPeriodicSurfaceDerivatives } from '../experimentalPeriodicSurfaceDerivatives'

function fixture(heights: number[], kv: number[], mv: number[], nonuniform = false, coupled = false): Net {
  const ku = nonuniform ? [-3, -2.75, -1, 0.125, 0.5, 1.5, 4, 7, 8, 12] : [0, 1, 2, 3, 4]
  const mu = nonuniform ? [2, 1, 1, 2, 1, 1, 2, 1, 1, 2] : [1, 1, 1, 1, 1]
  const nu = mu.slice(0, -1).reduce((sum, m) => sum + m, 0), nv = heights.length
  const ring = nonuniform ? Array.from({ length: nu }, (_, u) => {
    const angle = 2 * Math.PI * u / nu
    return [Math.cos(angle), Math.sin(angle)]
  }) : [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  return {
    nu, nv, du: nonuniform ? 3 : 2, dv: 3, periodic: [1, 0], rational: [0, 0], ku, mu, kv, mv,
    poles: ring.flatMap(([x, y], u) => heights.map((z, v): Point => {
      const t = coupled ? v / (nv - 1) : 0
      return [x * (1 + t / 16) + t / 32, y * (1 + t / 8), z * (1 + t * x / 64) + u / 16]
    })),
    weights: Array<number>(nu * nv).fill(1),
  }
}

it.each([false, true])('bounds coupled polynomial strips with nonuniform double U seam = %s', nonuniform => {
  const net = nonuniform ? fixture([0, 1, 2, 5, 9, 13, 16, 17, 18], [0, 1, 3, 5, 6], [4, 2, 1, 2, 4], true, true) :
    fixture([0, 1, 2, 3], [0, 1], [4, 4], false, true)
  const result = boundExperimentalPeriodicStripNormalCells(net)
  expect(result.checkedCells).toBe((net.ku.length - 1) * (net.kv.length - 1))
  expect(result.checkedDerivativePairs).toBe(result.checkedCells * net.du * (net.dv + 1) * (net.du + 1) * net.dv)
  expect(result.witnesses).toHaveLength(result.checkedCells)
  expect(result.witnesses.some(direction => direction[2] !== 0)).toBe(true)
  expect(result.minWitnessProjection).toBeGreaterThan(0)
  expect(result.minNormalNorm).toBeGreaterThan(0)
  expect(result.evidenceScope).toBe('unit-weight-periodic-cell-normal-coefficient-model')

  const evaluator = prepareExperimentalPeriodicSurfaceDerivatives(net)
  for (const [uSpan, a] of net.ku.slice(0, -1).entries()) for (const [vSpan, b] of net.kv.slice(0, -1).entries()) {
    const direction = result.witnesses[uSpan * (net.kv.length - 1) + vSpan]
    for (const u of [a, (a + net.ku[uSpan + 1]) / 2, net.ku[uSpan + 1]]) {
      for (const v of [b, (b + net.kv[vSpan + 1]) / 2, net.kv[vSpan + 1]]) {
        const { normal } = evaluator.evaluate(u, v)
        const projection = normal.reduce((sum, x, axis) => sum + x * direction[axis], 0)
        expect(projection + 1e-12).toBeGreaterThanOrEqual(result.minWitnessProjection)
        expect(Math.hypot(...normal) + 1e-12).toBeGreaterThanOrEqual(result.minNormalNorm)
      }
    }
  }
})

it('checks a supplied direction and distinguishes local regularity from preserving an original orientation', () => {
  const net = fixture([0, 1, 2, 3], [0, 1], [4, 4])
  const original = boundExperimentalPeriodicStripNormalCells(net)
  expect(boundExperimentalPeriodicStripNormalCells(net, original.witnesses)).toEqual(original)
  const scaled = original.witnesses.map(point => point.map(x => x * 2) as Point)
  expect(boundExperimentalPeriodicStripNormalCells(net, scaled).witnesses).toEqual(scaled)
  const reversed = { ...net, poles: net.poles.map(([x, y, z]): Point => [x, y, -z]) }
  expect(boundExperimentalPeriodicStripNormalCells(reversed).minNormalNorm).toBeGreaterThan(0)
  expect(() => boundExperimentalPeriodicStripNormalCells(reversed, original.witnesses))
    .toThrow(/proiezione normale non comprovabilmente positiva nella cella U0 V0/)
  const wrong = original.witnesses.map((point, i): Point => i === 2 ? point.map(x => -x) as Point : point)
  expect(() => boundExperimentalPeriodicStripNormalCells(net, wrong)).toThrow(/cella U2 V0/)
})

it('refuses a hidden normal inversion between the previous five interior V samples', () => {
  const net = fixture([0, 24, -952, 37_072], [0, 1], [4, 4])
  const exactHeightDerivative = (v: number) => 3 * ((200 * v - 5) ** 2 - 1)
  expect([0.05, 0.25, 0.5, 0.75, 0.95].every(v => exactHeightDerivative(v) > 0)).toBe(true)
  expect(exactHeightDerivative(1 / 40)).toBe(-3)
  expect(() => boundExperimentalPeriodicStripNormalCells(net)).toThrow(/proiezione normale non comprovabilmente positiva/)
})

it('may conservatively refuse a regular strip when a cell coefficient hull includes the opposite direction', () => {
  const net = fixture([0, 4, 3, 6, 9, 12, 15, 14, 18], [0, 1, 2, 3, 4, 5, 6], [4, 1, 1, 1, 1, 1, 4])
  // In this fixture the exact height derivative has minimum 3/7 at 6/7
  // and its reflected point. Its second control coefficient is -1.5.
  expect(() => boundExperimentalPeriodicStripNormalCells(net)).toThrow(/cella U0 V0/)
})

it('refuses bad directions, creases, nonunit weights and an oversized pair count', () => {
  const net = fixture([0, 1, 2, 3], [0, 1], [4, 4])
  expect(() => boundExperimentalPeriodicStripNormalCells(net, [[1, 0, 0]])).toThrow(/numero di vettori/)
  expect(() => boundExperimentalPeriodicStripNormalCells(net, Array<Point>(4).fill([0, 0, 0]))).toThrow(/vettore test nullo/)
  expect(() => boundExperimentalPeriodicStripNormalCells(net, Array<Point>(4))).toThrow(/vettore test non valido/)
  const crease = { ...net, ku: [0, 1, 2, 4], mu: [2, 1, 1, 2] }
  expect(() => boundExperimentalPeriodicStripNormalCells(crease)).toThrow(/continuità C1/)
  const creaseV = fixture([0, 1, 2, 5, 9, 13, 16, 17, 18], [0, 1, 3, 6], [4, 3, 2, 4])
  expect(() => boundExperimentalPeriodicStripNormalCells(creaseV)).toThrow(/continuità C1/)
  const weighted = structuredClone(net)
  weighted.rational = [1, 0]
  weighted.weights[0] = 2
  expect(() => boundExperimentalPeriodicStripNormalCells(weighted)).toThrow(/pesi unitari/)
  const large: Net = {
    ...net, nu: 26, nv: 26, du: 25, dv: 25, ku: Array.from({ length: 27 }, (_, i) => i), mu: Array<number>(27).fill(1),
    mv: [26, 26], poles: Array<Point>(676).fill([0, 0, 0]), weights: Array<number>(676).fill(1),
  }
  expect(() => boundExperimentalPeriodicStripNormalCells(large)).toThrow(/limite di coppie derivate/)
})

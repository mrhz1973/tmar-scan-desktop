// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { sampleExperimentalPeriodicTransverseDerivatives } from '../experimentalPeriodicTransverseSamples'

const xy = [[0, 0], [8, 0], [7, 9], [-2, 6]]
const strip: Net = {
  nu: 4, nv: 4, du: 2, dv: 3, periodic: [1, 0], rational: [0, 0],
  ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv: [0, 6], mv: [4, 4],
  poles: xy.flatMap(([x, y]) => [0, 2, 4, 6].map((z): Point => [x, y, z])),
  weights: Array<number>(16).fill(1),
}

// Exact quadratic insertion at 1/2 on the uniform periodic spline.
function refine(coefficients: Point[]): Point[] {
  const [p, q, r, s] = coefficients
  return [p, p.map((x, axis) => (x + 3 * q[axis]) / 4) as Point,
    q.map((x, axis) => (3 * x + r[axis]) / 4) as Point, r, s]
}

function makeFixture(reverse: boolean) {
  const stripSide = reverse ? 'V1' : 'V0', supportSide = reverse ? 'V0' : 'V1'
  const height = reverse ? 6 : 0
  const boundary = refine(xy.map(([x, y]): Point => [x, y, height]))
  const field = xy.map((_, u): Point => [u - 1, 1 - 0.5 * u, (reverse ? -1 : 1) * (3 + u)])
  const refinedField = refine(field)
  const kv = reverse ? [10, 12, 20] : [0, 3, 7]
  const gapOverDegree = reverse ? 1 : 2
  const order = reverse ? [1, 0, 4, 3, 2] : [0, 1, 2, 3, 4]
  const support: Net = {
    ...strip, nu: 5, dv: 2, kv, mv: [3, 1, 3],
    ku: reverse ? [-7, -4, -1, 2, 3.5, 5] : [20, 21, 22, 24, 26, 28],
    mu: [1, 1, 1, 1, 1, 1], weights: Array<number>(20).fill(1),
    poles: order.flatMap(i => {
      const border = boundary[i]
      const adjacent = border.map((x, axis) => x - gapOverDegree * refinedField[i][axis]) as Point
      return reverse ? [border, adjacent, adjacent, adjacent] : [adjacent, adjacent, adjacent, border]
    }),
  }
  const request = {
    strip: { net: strip, edge: stripSide as 'V0' | 'V1', uAtEdgeEnds: [0, 4] as const },
    support: { net: support, edge: supportSide as 'V0' | 'V1',
      uAtEdgeEnds: reverse ? [5, -7] as const : [20, 28] as const },
    edgePeriod: [-2, 6] as const, edgeParameters: [-2, -1.5, 0, 1, 2.25, 5, 6],
    lambda: 1.5, positionTolerance: 1e-12,
  }
  return { request, field }
}

function exactQuadratic(field: Point[], t: number): Point {
  const u = t === 4 ? 0 : t
  const span = Math.floor(u), s = u - span
  const weights = [(1 - s) ** 2 / 2, 0.5 + s - s * s, s * s / 2]
  return field[0].map((_, axis) => weights.reduce((sum, w, j) =>
    sum + w * field[(span + j) % 4][axis], 0)) as Point
}

it.each([false, true])('samples the two inward signs with a reversed support U map = %s', reverse => {
  const { request, field } = makeFixture(reverse)
  const before = structuredClone(request)
  const result = sampleExperimentalPeriodicTransverseDerivatives(request)

  expect(request).toEqual(before)
  expect(result.maxSampledGap).toBeLessThan(1e-12)
  expect(result.maxStripParameterError).toBe(0)
  expect(result.maxSupportParameterError).toBe(0)
  for (const sample of result.samples) {
    const t = (sample.edgeParameter + 2) / 2
    expect(sample.parameter).toBe(t)
    expect(sample.supportParameter).toBe(reverse ? 5 - 3 * t : 20 + 2 * t)
    const expected = exactQuadratic(field, t)
    sample.value.forEach((x, axis) => expect(x).toBeCloseTo(1.5 * expected[axis], 12))
  }
  expect(result.samples[0].value).toEqual(result.samples.at(-1)!.value)
})

it('rejects reversed correspondence on an asymmetric border, partial maps and unordered samples', () => {
  const { request } = makeFixture(false)
  const wrongDirection = { ...request.support, uAtEdgeEnds: [28, 20] as const }
  expect(() => sampleExperimentalPeriodicTransverseDerivatives({ ...request, support: wrongDirection }))
    .toThrow(/distanza campionata/)
  const partial = { ...request.support, uAtEdgeEnds: [20, 26] as const }
  expect(() => sampleExperimentalPeriodicTransverseDerivatives({ ...request, support: partial }))
    .toThrow(/esattamente un periodo/)
  expect(() => sampleExperimentalPeriodicTransverseDerivatives({ ...request, edgeParameters: [-2, 3, 0, 6] }))
    .toThrow(/non strettamente crescenti/)
})

it('rejects missing endpoints, nonunit weights and invalid scales or tolerances', () => {
  const { request } = makeFixture(true)
  expect(() => sampleExperimentalPeriodicTransverseDerivatives({ ...request, edgeParameters: [0, 1, 6] }))
    .toThrow(/intervallo del bordo/)
  expect(() => sampleExperimentalPeriodicTransverseDerivatives({ ...request, lambda: -1 })).toThrow(/scala positiva/)
  expect(() => sampleExperimentalPeriodicTransverseDerivatives({ ...request, positionTolerance: Infinity }))
    .toThrow(/tolleranza di posizione/)
  request.support.net.rational = [1, 0]
  request.support.net.weights[0] = 2
  expect(() => sampleExperimentalPeriodicTransverseDerivatives(request)).toThrow(/pesi unitari/)
})

it('rejects missing sides and non-array parameter inputs explicitly', () => {
  const { request } = makeFixture(false)
  const run = (changes: object) => sampleExperimentalPeriodicTransverseDerivatives(
    { ...request, ...changes } as Parameters<typeof sampleExperimentalPeriodicTransverseDerivatives>[0],
  )
  expect(() => run({ support: null })).toThrow(/lato o estremi U non validi/)
  expect(() => run({ strip: { ...request.strip, uAtEdgeEnds: null } })).toThrow(/lato o estremi U non validi/)
  expect(() => run({ edgePeriod: null })).toThrow(/campioni e intervallo del bordo non validi/)
  expect(() => run({ edgeParameters: null })).toThrow(/campioni e intervallo del bordo non validi/)
  expect(() => run({ edgeParameters: { 0: -2, 1: 0, 2: 6, length: 3 } }))
    .toThrow(/campioni e intervallo del bordo non validi/)
})

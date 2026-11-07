// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle, type Vec3 } from 'occt-wasm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { readFullPeriod } from '../experimentalPeriodicCurveWitness'
import { recoverPeriodicNonAffineMap } from '../experimentalPeriodicNonAffineMap'

type Point = readonly [number, number, number]
type Span = readonly Point[]

// Same loop as experimentalPeriodicNonAffineCorrespondence.test.ts. The
// recovery receives only the kernel edges, with no supplied warp or phase.
const reference: Span = [[0, 24, 0], [24, 24, 0], [24, 0, 0]]
const slow: Span = [[0, 24, 0], [6, 24, 0], [15, 23, 0], [24, 18, 0], [24, 0, 0]]
const fast: Span = [[0, 24, 0], [18, 24, 0], [23, 15, 0], [24, 6, 0], [24, 0, 0]]
const elevated: Span = [[0, 24, 0], [12, 24, 0], [20, 20, 0], [24, 12, 0], [24, 0, 0]]

function rotateLoop(spans: Span[]): Span[] {
  return spans.map((span, quarter) => span.map(([x, y, z]) => {
    for (let i = 0; i < quarter; i++) [x, y] = [y, -x]
    return [x, y, z]
  }))
}

const aSpans = rotateLoop([reference, reference, reference, reference])
const bSpans = rotateLoop([slow, fast, slow, fast])
const aKnots = [2, 3, 4, 5, 6]
const bKnots = [10, 12, 14, 16, 18]

let kernel: OcctKernel
beforeAll(async () => { kernel = await OcctKernel.init() })
afterAll(() => kernel?.[Symbol.dispose]())

function edge(spans: Span[], knots: number[]) {
  const degree = spans[0].length - 1
  // Fractional dyadic values exercise exact recovery on binary64 data.
  const poles = spans.flatMap(span => span.slice(0, -1).flatMap(([x, y, z]) =>
    [x + 0.125, y - 0.375, z + 0.25]))
  return kernel.makeBSplineEdge(poles, [], knots, knots.map(() => degree), degree, true)
}

function expectCoincident(p: Vec3, q: Vec3) {
  expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-12)
}

function sampleCorrespondence(a: ShapeHandle, b: ShapeHandle, map: ReturnType<typeof recoverPeriodicNonAffineMap>) {
  for (const span of map.spans) {
    const slope = Number(span.m) / Number(span.d)
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      const fraction = slope * t + (1 - slope) * t ** 2
      const p = kernel.curvePointAtParam(a, span.toA[0] + fraction * (span.toA[1] - span.toA[0]))
      const q = kernel.curvePointAtParam(b, span.fromB[0] + t * (span.fromB[1] - span.fromB[0]))
      expectCoincident(p, q)
    }
  }
}

it('derives the four local warps and cross-checks them with OCCT evaluations', () => {
  const a = edge(aSpans, aKnots), b = edge(bSpans, bKnots)
  const before = [readFullPeriod(kernel, a), readFullPeriod(kernel, b)]
  const result = recoverPeriodicNonAffineMap(kernel, a, b)
  expect(result).toMatchObject({ direction: 1, phase: 0, nonAffine: true })
  expect(result.spans.map(({ m, d }) => [m, d])).toEqual([[1n, 2n], [3n, 2n], [1n, 2n], [3n, 2n]])
  expect(result.spans.map(({ toA }) => toA)).toEqual([[2, 3], [3, 4], [4, 5], [5, 6]])
  sampleCorrespondence(a, b, result)
  expect([readFullPeriod(kernel, a), readFullPeriod(kernel, b)]).toEqual(before)
  expect(kernel.isValid(a)).toBe(true)
  expect(kernel.isValid(b)).toBe(true)
})

it('finds a shifted seam with a reversed traversal and unequal span widths', () => {
  const a = edge(aSpans, aKnots)
  const reversed = [1, 0, 3, 2].map(i => bSpans[i].slice().reverse())
  const b = edge(reversed, [10, 11, 13, 17, 19])
  const result = recoverPeriodicNonAffineMap(kernel, a, b)
  expect(result).toMatchObject({ direction: -1, phase: 2, nonAffine: true })
  expect(result.spans).toEqual([
    { fromB: [10, 11], toA: [4, 3], m: 1n, d: 2n },
    { fromB: [11, 13], toA: [3, 2], m: 3n, d: 2n },
    { fromB: [13, 17], toA: [6, 5], m: 1n, d: 2n },
    { fromB: [17, 19], toA: [5, 4], m: 3n, d: 2n },
  ])
  sampleCorrespondence(a, b, result)
  // A crosses its own seam between the second and third B spans. B closes
  // at a different point, which maps to the same interior knot on A.
  expectCoincident(kernel.curvePointAtParam(a, 2), kernel.curvePointAtParam(a, 6))
  expectCoincident(kernel.curvePointAtParam(b, 10), kernel.curvePointAtParam(b, 19))
})

it('rejects an interior shape change with matching endpoints and endpoint derivatives', () => {
  const changed = bSpans.map((span, i) => span.map(([x, y, z], j): Point =>
    [x, y, i === 0 && j === 2 ? z + 2 ** -20 : z]))
  expect(() => recoverPeriodicNonAffineMap(kernel, edge(aSpans, aKnots), edge(changed, bKnots)))
    .toThrow('nessuna identità di composizione')
})

it('uses the end derivative when the reference span starts with a stationary point', () => {
  const stationaryReference: Span = [[0, 24, 0], [0, 24, 0], [24, 0, 0]]
  const stationaryWarped: Span = [[0, 24, 0], [0, 24, 0], [1, 23, 0], [6, 18, 0], [24, 0, 0]]
  const a = edge([stationaryReference, ...aSpans.slice(1)], aKnots)
  const b = edge([stationaryWarped, ...bSpans.slice(1)], bKnots)
  expect(recoverPeriodicNonAffineMap(kernel, a, b).spans[0]).toMatchObject({ m: 1n, d: 2n })
})

it('rejects an exact quadratic composition whose parameter folds back within the span', () => {
  // Composition with phi(t) = 3t - 2t² has negative slope near t = 1.
  const folded: Span = [[0, 24, 0], [36, 24, 0], [20, -12, 0], [24, -12, 0], [24, 0, 0]]
  const a = edge(aSpans, aKnots)
  const b = edge([folded, ...bSpans.slice(1)], bKnots)
  expect(() => recoverPeriodicNonAffineMap(kernel, a, b)).toThrow('nessuna identità di composizione')
})

it('rejects a repeated traversal with multiple exact seam phases', () => {
  const a = edge([...aSpans, ...aSpans], [0, 1, 2, 3, 4, 5, 6, 7, 8])
  const b = edge([...bSpans, ...bSpans], [0, 1, 2, 3, 4, 5, 6, 7, 8])
  expect(() => recoverPeriodicNonAffineMap(kernel, a, b)).toThrow('fase o verso ambiguo')
})

it('distinguishes one affine map from joined linear maps with different slopes', () => {
  const a = edge(aSpans, aKnots)
  const linear = rotateLoop([elevated, elevated, elevated, elevated])
  expect(recoverPeriodicNonAffineMap(kernel, a, edge(linear, bKnots)).nonAffine).toBe(false)
  expect(recoverPeriodicNonAffineMap(kernel, a, edge(linear, [10, 11, 13, 17, 19])).nonAffine).toBe(true)
})

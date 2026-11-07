// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type NurbsCurveData, type Vec3 } from 'occt-wasm'
import { expect, it } from 'vitest'
import { readFullPeriod } from '../experimentalPeriodicCurveWitness'

type Point = readonly [number, number, number]
type Warp = readonly [bigint, bigint]

const referenceSpan: Point[] = [[0, 24, 0], [24, 24, 0], [24, 0, 0]]
const slowStart: Point[] = [[0, 24, 0], [6, 24, 0], [15, 23, 0], [24, 18, 0], [24, 0, 0]]
const fastStart: Point[] = [[0, 24, 0], [18, 24, 0], [23, 15, 0], [24, 6, 0], [24, 0, 0]]
const warps: Warp[] = [[1n, 1n], [3n, -1n], [1n, 1n], [3n, -1n]]

function loopPoles(spans: Point[][]): number[] {
  return spans.flatMap((span, quarter) => span.slice(0, -1).flatMap(([x, y, z]) => {
    for (let i = 0; i < quarter; i++) [x, y] = [y, -x]
    return [x, y, z]
  }))
}

// With multiplicity equal to the degree, the periodic polynomial basis is
// piecewise Bézier. The last control of each span is the first of the next.
function axisControls(data: NurbsCurveData, span: number, axis: number): bigint[] {
  const count = data.poles.length / 3
  return Array.from({ length: data.degree + 1 }, (_, i) =>
    BigInt(data.poles[3 * ((span * data.degree + i) % count) + axis]))
}

function matchesComposition(a: NurbsCurveData, b: NurbsCurveData, span: number, [m, n]: Warp): boolean {
  // phi(t) = (m*t + n*t²)/2 must fix both endpoints and increase everywhere.
  if (m + n !== 2n || m <= 0n || m + 2n * n <= 0n) return false
  return [0, 1, 2].every(axis => {
    const [p, q, r] = axisControls(a, span, axis)
    const a1 = 2n * (q - p), a2 = p - 2n * q + r
    const compositionTimesFour = [
      4n * p, 2n * m * a1, 2n * n * a1 + m * m * a2, 2n * m * n * a2, n * n * a2,
    ]
    const [v, w, x, y, z] = axisControls(b, span, axis)
    const quartic = [
      v, 4n * (w - v), 6n * (x - 2n * w + v),
      4n * (y - 3n * x + 3n * w - v), z - 4n * y + 6n * x - 4n * w + v,
    ]
    return quartic.every((coefficient, i) => 4n * coefficient === compositionTimesFour[i])
  })
}

const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

it('establishes a non-affine monotone correspondence on a synthetic periodic polynomial loop', async () => {
  const kernel = await OcctKernel.init()
  try {
    const aKnots = [2, 3, 4, 5, 6], bKnots = [10, 12, 14, 16, 18]
    const aPoles = loopPoles(warps.map(() => referenceSpan))
    const bPoles = loopPoles([slowStart, fastStart, slowStart, fastStart])
    const aMultiplicity = aKnots.map(() => 2), bMultiplicity = bKnots.map(() => 4)
    const a = kernel.makeBSplineEdge(aPoles, [], aKnots, aMultiplicity, 2, true)
    const b = kernel.makeBSplineEdge(bPoles, [], bKnots, bMultiplicity, 4, true)
    const aData = readFullPeriod(kernel, a), bData = readFullPeriod(kernel, b)
    expect(aData).toMatchObject({ degree: 2, rational: false, knots: aKnots, multiplicities: aMultiplicity, poles: aPoles })
    expect(bData).toMatchObject({ degree: 4, rational: false, knots: bKnots, multiplicities: bMultiplicity, poles: bPoles })
    for (const edge of [a, b]) {
      expect(kernel.isValid(edge)).toBe(true)
      expect(kernel.curveIsClosed(edge)).toBe(true)
    }

    // Identity of power coefficients proves agreement throughout each span.
    // The increasing endpoint-preserving maps concatenate through the seam.
    // All span-width ratios agree, so matching local slopes also match there.
    for (const [span, warp] of warps.entries()) {
      expect(matchesComposition(aData, bData, span, warp)).toBe(true)
      expect(warp[0] + 2n * warp[1]).toBe(warps[(span + 1) % warps.length][0])
      expect(matchesComposition(aData, bData, span, [2n, 0n])).toBe(false)
    }
    expect(matchesComposition(aData, bData, 0, [-1n, 3n])).toBe(false)

    // Perturb only the middle quartic control. Endpoints and endpoint first
    // derivatives are preserved, yet the full-span identity fails.
    const alteredPoles = bPoles.slice()
    alteredPoles[3 * 2 + 2] = 1
    const altered = kernel.makeBSplineEdge(alteredPoles, [], bKnots, bMultiplicity, 4, true)
    expect(matchesComposition(aData, readFullPeriod(kernel, altered), 0, warps[0])).toBe(false)

    // Numerical evaluator cross-check, separate from the coefficient proof.
    for (const [span, [m, n]] of warps.entries()) {
      for (let i = 0; i <= 8; i++) {
        const t = i / 8
        const phi = (Number(m) * t + Number(n) * t * t) / 2
        expect(gap(kernel.curvePointAtParam(a, aKnots[span] + phi),
          kernel.curvePointAtParam(b, bKnots[span] + 2 * t))).toBeLessThan(1e-12)
      }
    }
    expect(gap(kernel.curvePointAtParam(a, 2.5), kernel.curvePointAtParam(b, 11))).toBeGreaterThan(4)
  } finally {
    kernel[Symbol.dispose]()
  }
})

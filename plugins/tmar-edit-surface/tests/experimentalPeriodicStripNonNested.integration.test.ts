// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeExperimentalPeriodicBezierStrip } from '../experimentalPeriodicBezierStrip'
import { sampleExperimentalPeriodicTransverseDerivatives } from '../experimentalPeriodicTransverseSamples'
import { fitExperimentalPeriodicUVectorSamples } from '../experimentalPeriodicUVectorFit'

// Refine the common uniform quadratic border exactly, once per side, at
// different interior knots. This keeps the positions in both spline spaces.
function refinedBorder(span: number): Point[] {
  const border: Point[] = [[0, 0, 0], [8, 0, 0], [7, 9, 0], [-2, 6, 0]]
  const [a, b, c] = border.slice(span, span + 3)
  const blend = (p: Point, q: Point) => p.map((x, axis) => (x + 3 * q[axis]) / 4) as Point
  return [...border.slice(0, span + 1), blend(a, b), blend(c, b), ...border.slice(span + 2)]
}

function supportTargetY(u: number) {
  // Four times the support basis function with local knots [0, 1, 1.5, 2].
  // Its second derivative jumps at 1.5, inside the strip's single [1, 2] span.
  if (u < 1) return 4 * u ** 2 / 1.5
  if (u < 1.5) return 8 * (u * (1.5 - u) / 1.5 + (2 - u) * (u - 1))
  return u < 2 ? 8 * (2 - u) ** 2 : 0
}

function stripDerivativeY(net: Net, u: number) {
  // On [1, 2] the active strip indices are 2, 3 and 4. Derivatives are
  // recovered from the stored Bézier rows with 3 / (3 - 0) = 1.
  const left = (2 - u) ** 2 / 1.5, right = (u - 1) ** 2 / 2
  return [left, 1 - left - right, right].reduce((sum, weight, j) => {
    const borderIndex = (j + 2) * 4
    return sum + weight * (net.poles[borderIndex + 1][1] - net.poles[borderIndex][1])
  }, 0)
}

it('leaves a measurable derivative mismatch across nonnested U bases even when the shared border is preserved', () => {
  const strip: Net = {
    nu: 5, nv: 4, du: 2, dv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [0, 0.5, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1, 1], kv: [0, 3], mv: [4, 4],
    poles: refinedBorder(0).flatMap(([x, y]) => [0, 1, 2, 3].map((z): Point => [x, y, z])),
    weights: Array<number>(20).fill(1),
  }
  const support: Net = {
    ...strip, nv: 2, dv: 1, ku: [0, 1, 1.5, 2, 3, 4], kv: [0, 1], mv: [2, 2],
    poles: refinedBorder(1).flatMap(([x, y], i): Point[] => [[x, y - (i === 2 ? 4 : 0), -1], [x, y, 0]]),
    weights: Array<number>(10).fill(1),
  }
  expect(strip.ku.filter(u => !support.ku.includes(u))).toEqual([0.5])
  expect(support.ku.filter(u => !strip.ku.includes(u))).toEqual([1.5])

  const positionTolerance = 1e-12, derivativeBudget = 0.05
  const training = Array.from({ length: 17 }, (_, i) => i / 4)
  const holdout = [33 / 32, 37 / 32, 43 / 32, 47 / 32, 49 / 32, 53 / 32, 59 / 32, 63 / 32]
  expect(holdout.every(u => !training.includes(u))).toBe(true)
  const request = {
    strip: { net: strip, edge: 'V0', uAtEdgeEnds: [0, 4] },
    support: { net: support, edge: 'V1', uAtEdgeEnds: [0, 4] },
    edgePeriod: [0, 4], edgeParameters: training, lambda: 1, positionTolerance,
  } as const
  const sampled = sampleExperimentalPeriodicTransverseDerivatives(request)
  expect(sampled.maxSampledGap).toBeLessThan(positionTolerance)
  const fit = fitExperimentalPeriodicUVectorSamples(strip.du, strip.ku, strip.mu, sampled.samples)
  expect(fit.rank).toBe(strip.nu)
  expect(fit.maxSampleResidual).toBeGreaterThan(derivativeBudget)

  const proposal = proposeExperimentalPeriodicBezierStrip({
    net: strip, targetInwardV0: fit.coefficients,
    targetInwardV1: Array.from({ length: strip.nu }, (): Point => [0, 0, -1]), derivativeTolerance: 1e-12,
  })
  expect(proposal.validation[0].maxEditableDerivativeResidualBound).toBeLessThan(1e-12)
  for (let u = 0; u < strip.nu; u++) {
    expect(proposal.net.poles[u * 4]).toEqual(strip.poles[u * 4])
    expect(proposal.net.poles[u * 4 + 3]).toEqual(strip.poles[u * 4 + 3])
  }
  const measured = sampleExperimentalPeriodicTransverseDerivatives({
    ...request, strip: { ...request.strip, net: proposal.net }, edgeParameters: [0, ...holdout, 4],
  })
  expect(measured.maxSampledGap).toBeLessThan(positionTolerance)
  for (const sample of measured.samples.slice(1, -1)) {
    expect(sample.value[1]).toBeCloseTo(supportTargetY(sample.parameter), 12)
  }

  // This independent component mismatch lower-bounds the vector residual.
  const holdoutResidual = (net: Net) => Math.max(...holdout.map(u => Math.abs(stripDerivativeY(net, u) - supportTargetY(u))))
  const initial = holdoutResidual(strip), fitted = holdoutResidual(proposal.net)
  expect(fitted).toBeLessThan(initial)
  expect(fitted).toBeGreaterThan(derivativeBudget)
})

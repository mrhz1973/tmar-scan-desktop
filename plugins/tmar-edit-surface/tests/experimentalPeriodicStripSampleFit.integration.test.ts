// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeExperimentalPeriodicBezierStrip } from '../experimentalPeriodicBezierStrip'
import { sampleExperimentalPeriodicTransverseDerivatives } from '../experimentalPeriodicTransverseSamples'
import { fitExperimentalPeriodicUVectorSamples } from '../experimentalPeriodicUVectorFit'

type SampleRequest = Parameters<typeof sampleExperimentalPeriodicTransverseDerivatives>[0]

const training = [0, 0.25, 0.5, 1, 1.25, 1.75, 2, 2.25, 2.75, 3, 3.25, 3.75, 4]
const holdout = [1 / 32, 3 / 8, 15 / 16, 1.5, 2.125, 2.5, 3.5, 127 / 32]
const toEdgeParameter = (u: number) => 2 * u - 2

// Exact quadratic knot insertion at the midpoint of span 0 or 1.
function insertMidpoint(coefficients: Point[], span: number): Point[] {
  const [a, b, c] = coefficients.slice(span, span + 3)
  const blend = (p: Point, q: Point, left: number) =>
    p.map((x, axis) => (left * x + (4 - left) * q[axis]) / 4) as Point
  return [...coefficients.slice(0, span + 1), blend(a, b, 1), blend(b, c, 3), ...coefficients.slice(span + 2)]
}

function fixture() {
  const xy = [[0, 0], [8, 0], [7, 9], [-2, 6]]
  const strip: Net = {
    nu: 4, nv: 4, du: 2, dv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv: [3, 9], mv: [4, 4],
    poles: xy.flatMap(([x, y]) => [0, 2, 4, 6].map((z): Point => [x, y, z])),
    weights: Array<number>(16).fill(1),
  }
  const joint = (upper: boolean) => {
    const span = upper ? 1 : 0, lambda = upper ? 0.75 : 1.5
    const field = xy.map((_, u): Point => upper ? [-u, 0.5 * u, -4 + 0.25 * u] : [u - 1, 1 - 0.5 * u, 3 + u])
    const boundary = insertMidpoint(xy.map(([x, y]): Point => [x, y, upper ? 6 : 0]), span)
    const inward = insertMidpoint(field, span)
    const mappedKnots = [0, 1, 2, 3, 4, span + 0.5].map(u => upper ? 5 - 3 * u : 20 + 2 * u)
      .sort((a, b) => a - b)
    const order = upper ? [1, 0, 4, 3, 2] : [0, 1, 2, 3, 4]
    const vWidth = upper ? 4 : 2
    const support: Net = {
      ...strip, nu: 5, nv: 2, dv: 1, ku: mappedKnots, mu: [1, 1, 1, 1, 1, 1],
      kv: [2, 2 + vWidth], mv: [2, 2], weights: Array<number>(10).fill(1),
      poles: order.flatMap(i => {
        const border = boundary[i]
        const inner = border.map((x, axis) => x - vWidth * inward[i][axis]) as Point
        return upper ? [border, inner] : [inner, border]
      }),
    }
    const request: SampleRequest = {
      strip: { net: strip, edge: upper ? 'V1' : 'V0', uAtEdgeEnds: [0, 4] },
      support: { net: support, edge: upper ? 'V0' : 'V1', uAtEdgeEnds: upper ? [5, -7] : [20, 28] },
      edgePeriod: [-2, 6], edgeParameters: training.map(toEdgeParameter), lambda, positionTolerance: 1e-11,
    }
    return { field, lambda, request }
  }
  return { strip, lower: joint(false), upper: joint(true) }
}

// Independent analytic basis for the uniform periodic quadratic strip. The
// three local weights also evaluate the fields before exact knot insertion.
function evaluateUniformQuadratic(coefficients: Point[], u: number): Point {
  const span = Math.floor(u), t = u - span
  const weights = [(1 - t) ** 2 / 2, 0.5 + t - t * t, t * t / 2]
  return coefficients[0].map((_, axis) => weights.reduce((sum, weight, j) =>
    sum + weight * coefficients[(span + j) % coefficients.length][axis], 0)) as Point
}

function maxHoldoutResidual(net: Net, field: Point[], lambda: number, upper: boolean) {
  const outer = upper ? 3 : 0, inner = upper ? 2 : 1
  const derivatives = Array.from({ length: net.nu }, (_, u) => net.poles[u * 4 + inner]
    .map((x, axis) => (x - net.poles[u * 4 + outer][axis]) / 2) as Point)
  return Math.max(...holdout.map(u => {
    const actual = evaluateUniformQuadratic(derivatives, u)
    const expected = evaluateUniformQuadratic(field, u)
    return Math.hypot(...actual.map((x, axis) => x - lambda * expected[axis]))
  }))
}

function fitJoint(request: SampleRequest) {
  const strip = request.strip.net
  const sampled = sampleExperimentalPeriodicTransverseDerivatives(request)
  const fit = fitExperimentalPeriodicUVectorSamples(strip.du, strip.ku, strip.mu, sampled.samples)
  return { sampled, fit }
}

it('fits both joints in the strip basis and improves independent holdout residuals while preserving both borders', () => {
  const { strip, lower, upper } = fixture()
  const original = structuredClone({ strip, lower, upper })
  expect(holdout.every(u => !training.includes(u))).toBe(true)
  expect(lower.request.support.net.ku).not.toEqual(upper.request.support.net.ku)
  const lowerFit = fitJoint(lower.request), upperFit = fitJoint(upper.request)
  for (const { sampled, fit } of [lowerFit, upperFit]) {
    expect(sampled.maxSampledGap).toBeLessThan(1e-11)
    expect(fit.maxSampleResidual).toBeLessThan(1e-11)
  }

  const proposal = proposeExperimentalPeriodicBezierStrip({
    net: strip, targetInwardV0: lowerFit.fit.coefficients, targetInwardV1: upperFit.fit.coefficients,
    derivativeTolerance: 1e-11,
  })
  expect(proposal.changedIndices).toHaveLength(2 * strip.nu)
  expect({ ...proposal.net, poles: strip.poles }).toEqual(strip)
  for (let u = 0; u < strip.nu; u++) {
    expect(proposal.net.poles[u * 4]).toEqual(strip.poles[u * 4])
    expect(proposal.net.poles[u * 4 + 3]).toEqual(strip.poles[u * 4 + 3])
  }
  for (const [joint, upperSide] of [[lower, false], [upper, true]] as const) {
    expect(maxHoldoutResidual(strip, joint.field, joint.lambda, upperSide)).toBeGreaterThan(1)
    expect(maxHoldoutResidual(proposal.net, joint.field, joint.lambda, upperSide)).toBeLessThan(1e-11)
  }
  expect({ strip, lower, upper }).toEqual(original)
})

it('refuses a displaced support border and sample coverage with deficient rank', () => {
  const { lower, upper } = fixture()
  const supportNet = upper.request.support.net
  supportNet.poles[0][0] += 0.5
  expect(() => fitJoint(upper.request)).toThrow(/distanza campionata/)

  const firstSpanOnly = [0, 0.125, 0.25, 0.5, 0.75, 4].map(toEdgeParameter)
  expect(() => fitJoint({ ...lower.request, edgeParameters: firstSpanOnly })).toThrow(/rango numerico insufficiente/)
})

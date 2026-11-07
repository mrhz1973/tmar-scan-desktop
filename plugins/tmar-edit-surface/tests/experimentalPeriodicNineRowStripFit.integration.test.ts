// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeExperimentalPeriodicNineRowStrip } from '../experimentalPeriodicNineRowStrip'
import { sampleExperimentalPeriodicTransverseDerivatives } from '../experimentalPeriodicTransverseSamples'
import { fitExperimentalPeriodicUVectorSamples } from '../experimentalPeriodicUVectorFit'
import { divide, mul, scalar, sub } from '../tangencyCoefficientIntervals'

const ring: Point[] = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]]
const multiplicities = [1, 1, 1, 1, 1, 1]
const training = Array.from({ length: 17 }, (_, i) => i / 4)
const holdout = [33 / 32, 37 / 32, 43 / 32, 47 / 32, 49 / 32, 53 / 32, 59 / 32, 63 / 32]

function refinedRing(span: number): Point[] {
  // Exact midpoint knot insertion, also for span 2 whose third pole wraps.
  const a = ring[span], b = ring[(span + 1) % 4], c = ring[(span + 2) % 4]
  const blend = (p: Point, q: Point) => p.map((x, axis) => (x + 3 * q[axis]) / 4) as Point
  return [...ring.slice(0, span + 1), blend(a, b), blend(c, b), ...ring.slice(span + 2)]
}

function lowerTarget(u: number) {
  // Closed form on the holdout span [1,2] for the support coefficient
  // with local knots [0,1,1.5,2]. The strip has no knot at 1.5.
  const bump = u < 1.5 ? 2 * (u * (1.5 - u) / 1.5 + (2 - u) * (u - 1)) : 2 * (2 - u) ** 2
  return 12 + bump / 8
}

function stripInwardZ(net: Net, u: number, upper: boolean) {
  // Independent basis on the strip span [1,2]. The first and last V
  // spans are unit width, so the inward derivative factor is 3.
  const left = (2 - u) ** 2 / 1.5, right = (u - 1) ** 2 / 2
  const outer = upper ? 8 : 0, inner = upper ? 7 : 1
  return [left, 1 - left - right, right].reduce((sum, weight, j) => {
    const base = (j + 2) * 9
    return sum + 3 * weight * (net.poles[base + inner][2] - net.poles[base + outer][2])
  }, 0)
}

function maxDerivativePerturbation(net: Net) {
  const reference = [12, -1.5, 3, 3, 3, 3, -1.5, 12]
  const flatV = net.kv.flatMap((v, i) => Array<number>(net.mv[i]).fill(v))
  return Math.max(...Array.from({ length: net.nu }, (_, u) => reference.map((value, v) => {
    const index = u * 9 + v
    const displacement = sub(scalar(net.poles[index + 1][2]), scalar(net.poles[index][2]))
    const width = sub(scalar(flatV[v + 4]), scalar(flatV[v + 1]))
    const [lo, hi] = sub(divide(mul(scalar(3), displacement), width), scalar(value))
    return Math.max(Math.abs(lo), Math.abs(hi))
  })).flat())
}

it('fits both nonnested supports on nine rows, preserves the protected rows and retains normal orientation in this fixture', () => {
  const heights = [0, 1, 3, 6, 9, 12, 15, 17, 18]
  const strip: Net = {
    nu: 5, nv: 9, du: 2, dv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [0, 0.5, 1, 2, 3, 4], mu: multiplicities,
    kv: [0, 1, 2, 3, 4, 5, 6], mv: [4, 1, 1, 1, 1, 1, 4],
    poles: refinedRing(0).flatMap(([x, y]) => heights.map((z): Point => [x, y, z])),
    weights: Array<number>(45).fill(1),
  }
  const joint = (upper: boolean) => {
    const span = upper ? 2 : 1, uOrigin = upper ? 20 : 10, uScale = upper ? 3 : 2
    const vWidth = upper ? 4 : 2
    const supportKnots = [0, 1, 2, 3, 4, span + 0.5].sort((a, b) => a - b)
    const support: Net = {
      ...strip, nv: 2, dv: 1, ku: supportKnots.map(u => uOrigin + uScale * u), kv: [0, vWidth], mv: [2, 2],
      poles: refinedRing(span).flatMap(([x, y], i): Point[] => upper ?
        [[x, y, 18], [x, y, 18 + vWidth * 12]] : [[x, y, -vWidth * (12 + (i === 2 ? 1 / 8 : 0))], [x, y, 0]]),
      weights: Array<number>(10).fill(1),
    }
    expect(strip.ku.filter(u => !supportKnots.includes(u))).toEqual([0.5])
    expect(supportKnots.filter(u => !strip.ku.includes(u))).toEqual([span + 0.5])
    const request: Parameters<typeof sampleExperimentalPeriodicTransverseDerivatives>[0] = {
      strip: { net: strip, edge: upper ? 'V1' : 'V0', uAtEdgeEnds: [0, 4] },
      support: { net: support, edge: upper ? 'V0' : 'V1', uAtEdgeEnds: [uOrigin, uOrigin + 4 * uScale] },
      edgePeriod: [0, 4], edgeParameters: training, lambda: 1, positionTolerance: 1e-12,
    }
    const sampled = sampleExperimentalPeriodicTransverseDerivatives(request)
    expect(sampled.maxSampledGap).toBeLessThan(request.positionTolerance)
    const fit = fitExperimentalPeriodicUVectorSamples(strip.du, strip.ku, strip.mu, sampled.samples)
    expect(fit.rank).toBe(strip.nu)
    return { request, fit }
  }
  const lower = joint(false), upper = joint(true)
  expect(holdout.every(u => !training.includes(u))).toBe(true)
  expect(lower.fit.maxSampleResidual).toBeGreaterThan(1e-3)
  expect(upper.fit.maxSampleResidual).toBeLessThan(1e-11)

  const original = structuredClone(strip)
  const proposal = proposeExperimentalPeriodicNineRowStrip({
    net: strip, targetInwardV0: lower.fit.coefficients, targetInwardV1: upper.fit.coefficients, derivativeTolerance: 1e-11,
  })
  expect(strip).toEqual(original)
  expect({ ...proposal.net, poles: strip.poles }).toEqual(strip)
  for (const [i, point] of proposal.net.poles.entries()) {
    const row = i % 9
    expect(point.slice(0, 2)).toEqual(strip.poles[i].slice(0, 2))
    if (row !== 1 && row !== 7) expect(point).toEqual(strip.poles[i])
  }
  expect(proposal.changedIndices).toHaveLength(2 * strip.nu)

  for (const [isUpper, { request }] of [[false, lower], [true, upper]] as const) {
    const sampled = sampleExperimentalPeriodicTransverseDerivatives({
      ...request, strip: { ...request.strip, net: proposal.net }, edgeParameters: [0, ...holdout, 4],
    })
    expect(sampled.maxSampledGap).toBeLessThan(request.positionTolerance)
    const target = isUpper ? () => -12 : lowerTarget
    for (const sample of sampled.samples.slice(1, -1)) expect(sample.value[2]).toBeCloseTo(target(sample.parameter), 12)
    const residual = (net: Net) => Math.max(...holdout.map(u => Math.abs(stripInwardZ(net, u, isUpper) - target(u))))
    expect(residual(strip)).toBeGreaterThan(8)
    expect(residual(proposal.net)).toBeLessThan(isUpper ? 1e-11 : 0.05)
    if (!isUpper) expect(residual(proposal.net)).toBeGreaterThan(1e-3)
  }

  // With the reference derivative coefficients above, the first unit span
  // has polynomial 12 - 27t + 63t²/4, with minimum 3/7. The next span is
  // bounded below by 3/4, the central spans have derivative 3 and the other
  // end is symmetric. The tensor-product hull bounds the perturbation of
  // dz/dV everywhere. X,Y remain independent of V and their U tangent never
  // vanishes on the rounded square, so positive dz/dV preserves the normal.
  const referenceMinimum = divide(scalar(3), scalar(7))
  expect(sub(referenceMinimum, scalar(maxDerivativePerturbation(proposal.net)))[0]).toBeGreaterThan(0.25)
})

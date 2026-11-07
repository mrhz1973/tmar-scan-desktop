// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundPeriodicLinearVRefinement } from '../experimentalPeriodicLinearVRefinementBound'
import { proposeExperimentalPeriodicNineRowStrip } from '../experimentalPeriodicNineRowStrip'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from '../experimentalPeriodicOneSidedSurfaceDerivatives'
import { checkExperimentalPeriodicSeamC1 } from '../experimentalPeriodicSeamC1'
import { boundExperimentalPeriodicSeamDerivativeGap } from '../experimentalPeriodicSeamDerivativeGap'
import { boundExperimentalPeriodicStripNormalCells } from '../experimentalPeriodicStripNormalCells'
import { prepareExperimentalPeriodicSurfaceDerivatives } from '../experimentalPeriodicSurfaceDerivatives'
import { sampleExperimentalPeriodicTransverseDerivatives } from '../experimentalPeriodicTransverseSamples'
import { fitExperimentalPeriodicUVectorSamples } from '../experimentalPeriodicUVectorFit'
import { refineLinearPeriodicV } from '../periodic'

const training = [0, 0.5, 1, 1.5, 2, 2.75, 3.5, 4.25, 5, 6, 7, 8, 9]
const holdout = [0.125, 1.125, 2.25, 3.25, 4.75, 5.125, 6.125, 8.875]
const seamTolerance = 2 ** -33
const distance = (a: Point, b: Point) => Math.hypot(...a.map((x, i) => x - b[i]))
const unit = (a: Point): Point => a.map(x => x / Math.hypot(...a)) as Point

const bits = new DataView(new ArrayBuffer(8))
function subnormalUnits(value: number): bigint {
  bits.setFloat64(0, value)
  const word = bits.getBigUint64(0), exponent = (word >> 52n) & 0x7ffn
  const fraction = word & ((1n << 52n) - 1n)
  const magnitude = exponent === 0n ? fraction : ((1n << 52n) | fraction) << (exponent - 1n)
  return word >> 63n ? -magnitude : magnitude
}

function exactSampleGapSquared(net: Net, v: number) {
  const knots = net.kv.flatMap((knot, i) => Array<number>(net.mv[i]).fill(knot))
  const span = v === knots.at(-1) ? net.nv - 1 : knots.findIndex((knot, i) => knot <= v && v < knots[i + 1])
  const controls = Array.from({ length: 4 }, (_, i) => {
    const row = span - 3 + i
    const previous = net.poles[(net.nu - 1) * net.nv + row], at = net.poles[row], next = net.poles[net.nv + row]
    // The fixture's first and last U spans have widths 2 and 4.
    // The derivative gap coefficient in subnormal units is this divided by 4.
    return at.map((x, axis) => 3n * (2n * subnormalUnits(next[axis]) - 3n * subnormalUnits(x) + subnormalUnits(previous[axis])))
  })
  // Evaluate the V spline with exact de Boor arithmetic, independently of
  // the coefficient hull. Every V query is an eighth and every knot width
  // in the recurrence is 1, 2 or 3, so each blend has denominator 48.
  const blendDenominator = 48n
  for (let r = 1; r <= 3; r++) for (let j = 3; j >= r; j--) {
    const i = span - 3 + j, lo = knots[i], hi = knots[i + 4 - r]
    const numerator = BigInt(8 * (v - lo)) * blendDenominator, denominator = BigInt(8 * (hi - lo))
    expect(numerator % denominator).toBe(0n)
    const right = numerator / denominator, left = blendDenominator - right
    controls[j] = controls[j].map((x, axis) => left * controls[j - 1][axis] + right * x)
  }
  return { numeratorSquared: controls[3].reduce((sum, x) => sum + x * x, 0n), denominator: 4n * blendDenominator ** 3n }
}

function sourceStrip(): Net {
  const ring = [[0, 0], [2, 2 ** -34], [4, 4], [-4, 4], [-4, 0]]
  return {
    du: 3, dv: 1, nu: 5, nv: 2, periodic: [1, 0], rational: [0, 0],
    ku: [0, 2, 5, 9], mu: [3, 1, 1, 3], kv: [0, 6], mv: [2, 2],
    poles: ring.flatMap(([x, y]) => [[x, y, 0], [x, y, 18]] as Point[]), weights: Array<number>(10).fill(1),
  }
}

function fitJoint(strip: Net, upper: boolean) {
  const origin = upper ? -12 : 20, scale = upper ? 3 : 2, widthV = upper ? 4 : 2
  const slope = upper ? [12, 12, 11.75, 12.125, 12] : [12, 12, 12.25, 11.875, 12]
  const support: Net = {
    ...strip, dv: 1, nv: 2, ku: strip.ku.map(u => origin + scale * u), kv: [0, widthV], mv: [2, 2],
    poles: slope.flatMap((s, u) => {
      const [x, y, z] = strip.poles[u * 9 + (upper ? 8 : 0)]
      return (upper ? [[x, y, z], [x, y, z + widthV * s]] : [[x, y, z - widthV * s], [x, y, z]]) as Point[]
    }),
    weights: Array<number>(10).fill(1),
  }
  const request: Parameters<typeof sampleExperimentalPeriodicTransverseDerivatives>[0] = {
    strip: { net: strip, edge: upper ? 'V1' : 'V0', uAtEdgeEnds: [0, 9] },
    support: { net: support, edge: upper ? 'V0' : 'V1', uAtEdgeEnds: [origin, origin + 9 * scale] },
    edgePeriod: [0, 9], edgeParameters: training, lambda: 1, positionTolerance: 1e-12,
  }
  const samples = sampleExperimentalPeriodicTransverseDerivatives(request)
  expect(samples.maxSampledGap).toBeLessThan(request.positionTolerance)
  const fit = fitExperimentalPeriodicUVectorSamples(strip.du, strip.ku, strip.mu, samples.samples)
  expect(fit.rank).toBe(strip.nu)
  expect(fit.maxSampleResidual).toBeLessThan(1e-11)
  return { request, fit, origin, scale, supportV: upper ? 0 : widthV, stripV: upper ? 6 : 0 }
}

it('runs the nine-row proposal within a seam derivative bound while the exact and structural C1 checks still refuse', () => {
  const source = sourceStrip(), before = structuredClone(source)
  const strip = refineLinearPeriodicV(source, 9)
  const elevation = boundPeriodicLinearVRefinement(source, strip)
  expect(elevation.maxPositionError).toBeLessThan(1e-12)
  expect(elevation.maxBoundaryPositionError).toBe(0)
  // Both exact X slopes are 3. The right Y slope is 3*2^-35 and the left is zero.
  const expectedGap = 3 * 2 ** -35
  for (const net of [source, strip]) {
    expect(boundExperimentalPeriodicSeamDerivativeGap(net, seamTolerance)).toMatchObject({
      status: 'within-tolerance', maxDerivativeDifferenceBound: expectedGap,
    })
  }

  const lower = fitJoint(strip, false), upper = fitJoint(strip, true)
  const proposal = proposeExperimentalPeriodicNineRowStrip({
    net: strip, targetInwardV0: lower.fit.coefficients, targetInwardV1: upper.fit.coefficients, derivativeTolerance: 1e-11,
  })
  expect(source).toEqual(before)
  expect({ ...proposal.net, poles: strip.poles }).toEqual(strip)
  expect(proposal.changedIndices).toHaveLength(2 * strip.nu)
  for (const [i, point] of proposal.net.poles.entries()) {
    const row = i % 9
    if (row !== 1 && row !== 7) expect(point).toEqual(strip.poles[i])
  }

  const gap = boundExperimentalPeriodicSeamDerivativeGap(proposal.net, seamTolerance)
  expect(gap.status).toBe('within-tolerance')
  expect(gap.maxDerivativeDifferenceBound!).toBeGreaterThanOrEqual(expectedGap)
  expect(boundExperimentalPeriodicSeamDerivativeGap(proposal.net, expectedGap / 2).status).toBe('inconclusive')
  expect(checkExperimentalPeriodicSeamC1(proposal.net).c1AtUSeam).toBe(false)
  expect(() => prepareExperimentalPeriodicSurfaceDerivatives(proposal.net)).toThrow(/C1/)
  expect(() => boundExperimentalPeriodicStripNormalCells(proposal.net)).toThrow(/continuità C1/)

  const original = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(source)
  const candidate = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(proposal.net)
  expect(() => candidate.evaluate(0, 2)).toThrow(/lato U richiesto.*C0/)
  for (const v of [0, 0.125, 1, 2.5, 4, 5.875, 6]) {
    const left = candidate.evaluate(0, v, { u: 'left' }), right = candidate.evaluate(0, v, { u: 'right' })
    expect(candidate.evaluate(9, v, { u: 'left' })).toEqual(left)
    expect(candidate.evaluate(9, v, { u: 'right' })).toEqual(right)
    const sampledGap = distance(left.du, right.du)
    expect(sampledGap).toBeGreaterThan(expectedGap * 0.99)
    expect(sampledGap).toBeLessThanOrEqual(gap.maxDerivativeDifferenceBound!)
    const exact = exactSampleGapSquared(proposal.net, v)
    expect(exact.numeratorSquared).toBeGreaterThanOrEqual((subnormalUnits(expectedGap) * exact.denominator) ** 2n)
    expect(exact.numeratorSquared).toBeLessThanOrEqual((subnormalUnits(gap.maxDerivativeDifferenceBound!) * exact.denominator) ** 2n)
    for (const side of ['left', 'right'] as const) {
      const oldNormal = original.evaluate(0, v, { u: side }).normal
      const newNormal = (side === 'left' ? left : right).normal
      expect(Math.hypot(...newNormal)).toBeGreaterThan(0.1)
      expect(distance(unit(oldNormal), unit(newNormal))).toBeLessThan(1e-12)
    }
  }

  expect(holdout.every(u => !training.includes(u))).toBe(true)
  for (const joint of [lower, upper]) {
    const { request, origin, scale, supportV, stripV } = joint
    const check = sampleExperimentalPeriodicTransverseDerivatives({
      ...request, strip: { ...request.strip, net: proposal.net }, edgeParameters: [0, ...holdout, 9],
    })
    expect(check.maxSampledGap).toBeLessThan(request.positionTolerance)
    const support = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(request.support.net)
    // Increasing V points in the same direction on both sides of each
    // joint. Compare derivatives of the stored nets, independently of fit.
    const residual = (u: number, side?: 'left' | 'right') => {
      const choice = side === undefined ? {} : { u: side }
      const target = support.evaluate(origin + scale * u, supportV, choice).dv
      return { before: distance(original.evaluate(u, stripV, choice).dv, target),
        after: distance(candidate.evaluate(u, stripV, choice).dv, target) }
    }
    for (const u of holdout) {
      const { before, after } = residual(u)
      expect(before).toBeGreaterThan(8)
      expect(after).toBeLessThan(1e-11)
    }
    for (const side of ['left', 'right'] as const) expect(residual(0, side).after).toBeLessThan(1e-11)
  }
})

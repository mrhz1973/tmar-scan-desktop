// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { certifyExperimentalDerivativeCoefficientCap } from '../experimentalDerivativeCoefficientCap'

function source(zeroInward = false): Net {
  const nu = 4, nv = 6
  return { nu, nv, du: 3, dv: 5, ku: [0, 1, 2], mu: [3, 1, 3], kv: [0, 5], mv: [6, 6],
    periodic: [1, 0], rational: [0, 0], weights: Array<number>(nu * nv).fill(1),
    poles: Array.from({ length: nu }, (_, u) => Array.from({ length: nv }, (_, v): Point => [u, zeroInward ? 0 : v, 0])).flat() }
}

function targets(net: Net, vector: Point) { return Array.from({ length: net.nu }, (): Point => [...vector]) }

it.each(['V0', 'V1'] as const)('accepts exact Euclidean equality and the explicit inward sign at %s', edge => {
  const original = source(), candidate = structuredClone(original), sign = edge === 'V0' ? 1 : -1
  const boundary = edge === 'V0' ? 0 : original.nv - 1
  const baseInward = targets(original, [0, sign, 0]), targetInward = targets(original, [3, sign + 4, 0])
  for (let u = 0; u < original.nu; u++) {
    const b = u * original.nv + boundary
    candidate.poles[b + sign] = candidate.poles[b].map((x, axis) => x + targetInward[u][axis]) as Point
  }
  const before = structuredClone({ original, candidate, baseInward, targetInward })
  const result = certifyExperimentalDerivativeCoefficientCap({ original, candidate, edge, baseInward, targetInward, maximumChange: 5 })
  expect(result.status).toBe('within-coefficient-cap')
  for (const certificate of [result.targetChange, result.storedChange, result.targetFromExactSourceChange]) {
    expect(certificate.maximum.normInterval).toEqual({ lower: 5, upper: 5 })
    expect(certificate.maximum.exactSquaredMarginToCap).toEqual({ numerator: '0', denominator: '1' })
    expect(certificate.withinCapCount).toBe(4)
    expect(certificate.violatingUIndices).toEqual([])
  }
  expect(result.nativeCadCertified).toBe(false)
  expect({ original, candidate, baseInward, targetInward }).toEqual(before)
})

it('detects an exact excess that a rounded Euclidean norm loses', () => {
  const original = source(true), candidate = structuredClone(original), vector: Point = [5, Number.MIN_VALUE, 0]
  for (let u = 0; u < original.nu; u++) candidate.poles[u * original.nv + 1] = [u + 5, Number.MIN_VALUE, 0]
  expect(Math.hypot(...vector)).toBe(5)
  const result = certifyExperimentalDerivativeCoefficientCap({ original, candidate, edge: 'V0',
    baseInward: targets(original, [0, 0, 0]), targetInward: targets(original, vector), maximumChange: 5 })
  expect(result.status).toBe('coefficient-cap-exceeded')
  for (const certificate of [result.targetChange, result.storedChange]) {
    expect(certificate.exceedingCapCount).toBe(4)
    expect(certificate.maximum.squaredMarginSign).toBe('negative')
    expect(BigInt(certificate.maximum.exactSquaredMarginToCap.numerator)).toBeLessThan(0n)
    expect(certificate.maximum.normInterval.lower).toBe(5)
    expect(certificate.maximum.normInterval.upper).toBeGreaterThan(5)
  }
})

it('keeps a passing target cap separate from stored D1 excess despite a tiny target residual', () => {
  const original = source(true), candidate = structuredClone(original), nextFive = 5 + 2 ** -50
  // Only U0 is beyond the cap. Its D1 target residual is below 1e-9.
  for (let u = 0; u < original.nu; u++) candidate.poles[u * original.nv + 1] = [u + 5, 0, 0]
  candidate.poles[1][0] = nextFive
  expect(nextFive - 5).toBeLessThan(1e-9)
  const result = certifyExperimentalDerivativeCoefficientCap({ original, candidate, edge: 'V0',
    baseInward: targets(original, [0, 0, 0]), targetInward: targets(original, [5, 0, 0]), maximumChange: 5 })
  expect(result.targetChange.status).toBe('within-coefficient-cap')
  expect(result.targetFromExactSourceChange.status).toBe('within-coefficient-cap')
  expect(result.storedChange.status).toBe('coefficient-cap-exceeded')
  expect(result.storedChange.violatingUIndices).toEqual([0])
  expect(result.storedChange.maximum.normInterval).toEqual({ lower: nextFive, upper: nextFive })
  expect(result.status).toBe('coefficient-cap-exceeded')
})

it('forms the knot-span difference exactly instead of accepting a rounded D1 at the limit', () => {
  const original: Net = { nu: 3, nv: 2, du: 1, dv: 1, ku: [0, 1, 2, 3], mu: [1, 1, 1, 1],
    kv: [-0.1, 0.3], mv: [2, 2], periodic: [1, 0], rational: [0, 0], weights: Array<number>(6).fill(1),
    poles: Array.from({ length: 3 }, (_, u): Point[] => [[u, 0, 0], [u, 0, 0]]).flat() }
  const candidate = structuredClone(original)
  for (let u = 0; u < original.nu; u++) candidate.poles[2 * u + 1][1] = 0.4
  expect((1 / (0.3 - -0.1)) * 0.4).toBe(1)
  const result = certifyExperimentalDerivativeCoefficientCap({ original, candidate, edge: 'V0',
    baseInward: targets(original, [0, 0, 0]), targetInward: targets(original, [0, 1, 0]), maximumChange: 1 })
  expect(result.targetChange.status).toBe('within-coefficient-cap')
  expect(result.storedChange.status).toBe('coefficient-cap-exceeded')
  expect(result.storedChange.maximum.normInterval.lower).toBe(1)
  expect(result.storedChange.maximum.normInterval.upper).toBeGreaterThan(1)
  expect(result.storedChange.maximum.squaredMarginSign).toBe('negative')
})

it('does not confuse rigid pole movement with derivative change', () => {
  const original = source(true), candidate = structuredClone(original)
  for (let u = 0; u < original.nu; u++) for (const v of [0, 1]) {
    const i = u * original.nv + v
    candidate.poles[i] = candidate.poles[i].map((x, axis) => x + [9, 10, 11][axis]) as Point
  }
  const result = certifyExperimentalDerivativeCoefficientCap({ original, candidate, edge: 'V0',
    baseInward: targets(original, [0, 0, 0]), targetInward: targets(original, [0, 0, 0]), maximumChange: 0 })
  expect(result.status).toBe('within-coefficient-cap')
  expect(result.storedChange.maximum.normInterval).toEqual({ lower: 0, upper: 0 })
})

it('rejects mismatched bases, rational weights and sparse/nonfinite supplied coefficients', () => {
  const original = source(), candidate = structuredClone(original)
  const request = { original, candidate, edge: 'V0' as const, baseInward: targets(original, [0, 1, 0]),
    targetInward: targets(original, [0, 1, 0]), maximumChange: 5 }
  const changedBasis = structuredClone(candidate); changedBasis.kv[1] = 6
  expect(() => certifyExperimentalDerivativeCoefficientCap({ ...request, candidate: changedBasis })).toThrow(/same-basis/)
  const rational = structuredClone(candidate); rational.rational = [1, 0]; rational.weights[1] = 2
  expect(() => certifyExperimentalDerivativeCoefficientCap({ ...request, candidate: rational })).toThrow(/unit-polynomial/)
  const sparse = [...request.targetInward]; delete sparse[2]
  expect(() => certifyExperimentalDerivativeCoefficientCap({ ...request, targetInward: sparse })).toThrow(/dense-finite/)
  const nonfinite = structuredClone(request.targetInward); nonfinite[0][0] = Infinity
  expect(() => certifyExperimentalDerivativeCoefficientCap({ ...request, targetInward: nonfinite })).toThrow(/dense-finite/)
  expect(() => certifyExperimentalDerivativeCoefficientCap({ ...request, maximumChange: -1 })).toThrow(/nonnegative-cap/)
})

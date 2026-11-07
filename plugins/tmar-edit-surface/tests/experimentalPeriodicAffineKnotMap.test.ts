// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { mapPeriodicKnotsAffineRounded } from '../experimentalPeriodicAffineKnotMap'

it('rounds a dense affine map and reports the least binary64 bound on the exact rational error', () => {
  const knots = Array.from({ length: 235 }, (_, i) => i)
  const result = mapPeriodicKnotsAffineRounded(knots, 0, 1)
  expect(result.knots).toEqual(knots.map(knot => knot / 234))
  expect(result.knots.every((knot, i) => i === 0 || knot > result.knots[i - 1])).toBe(true)

  // Every rounded node in [1/234, 1] is an integer multiple of 2^-60.
  const unitCount = 2n ** 60n
  const absolute = (value: bigint) => value < 0n ? -value : value
  const errorNumerators = result.knots.map((knot, i) =>
    absolute(BigInt(knot * 2 ** 60) * 234n - BigInt(i) * unitCount))
  expect(errorNumerators.filter(error => error !== 0n)).toHaveLength(232)
  const maxError = errorNumerators.reduce((max, error) => error > max ? error : max, 0n)

  // Compare the exact maximum against the returned bound and its predecessor.
  const bits = new DataView(new ArrayBuffer(8))
  bits.setFloat64(0, result.maxParameterError)
  bits.setBigUint64(0, bits.getBigUint64(0) - 1n)
  const predecessor = bits.getFloat64(0)
  const boundNumerator = (value: number) => BigInt(value * 2 ** 120) * 234n
  expect(boundNumerator(result.maxParameterError)).toBeGreaterThanOrEqual(maxError * unitCount)
  expect(boundNumerator(predecessor)).toBeLessThan(maxError * unitCount)
})

it.each([1, -1])('rounds normal half-way values to even at destination sign %s', sign => {
  const ulp = 2 ** -52
  const positive = [1, 1 + 2 * ulp, 1 + 4 * ulp, 1 + 6 * ulp]
  const expected = sign === 1 ? positive : positive.slice().reverse().map(value => -value)
  expect(mapPeriodicKnotsAffineRounded([0, 3, 9, 12], expected[0], expected[3])).toEqual({
    knots: expected,
    maxParameterError: ulp / 2,
  })
})

it('rounds a half-way value across the top of a binade', () => {
  const ulp = 2 ** -53
  expect(mapPeriodicKnotsAffineRounded([0, 3, 8], 1 - 2 * ulp, 1 + 2 * ulp)).toEqual({
    knots: [1 - 2 * ulp, 1, 1 + 2 * ulp],
    maxParameterError: ulp / 2,
  })
})

it('rounds subnormal ties, including signed zero, and rounds their positive error upward', () => {
  const unit = Number.MIN_VALUE
  expect(mapPeriodicKnotsAffineRounded([0, 3, 9, 12], 0, 6 * unit)).toEqual({
    knots: [0, 2 * unit, 4 * unit, 6 * unit],
    maxParameterError: unit,
  })
  expect(mapPeriodicKnotsAffineRounded([0, 3, 8], -2 * unit, 2 * unit)).toEqual({
    knots: [-2 * unit, -0, 2 * unit],
    maxParameterError: unit,
  })
})

it('handles finite endpoints even when subtracting the endpoints would overflow binary64', () => {
  const max = Number.MAX_VALUE
  const knots = [-max, -1, 0, Number.MIN_VALUE, 1, max]
  expect(mapPeriodicKnotsAffineRounded(knots, -max, max)).toEqual({
    knots,
    maxParameterError: 0,
  })
  expect(mapPeriodicKnotsAffineRounded([-max, 0, max], 0, max)).toEqual({
    knots: [0, max / 2, max],
    maxParameterError: 0,
  })
})

it('rejects collisions between interior nodes and with either destination endpoint', () => {
  expect(() => mapPeriodicKnotsAffineRounded([0, 3, 5, 8], 0, 4 * Number.MIN_VALUE)).toThrow(/Collisione/)
  expect(() => mapPeriodicKnotsAffineRounded([0, 1, 3], 1, 1 + Number.EPSILON)).toThrow(/Collisione/)
  expect(() => mapPeriodicKnotsAffineRounded([0, 2, 3], 1, 1 + Number.EPSILON)).toThrow(/Collisione/)
  expect(() => mapPeriodicKnotsAffineRounded([0, 3, 5, 8], -2 * Number.MIN_VALUE, 2 * Number.MIN_VALUE))
    .toThrow(/Collisione/)
})

it('rejects malformed source knots and nonfinite or unordered destination endpoints', () => {
  for (const knots of [[0], [0, 0, 1], [0, 2, 1], [0, NaN, 1], [0, Infinity], Array<number>(2)])
    expect(() => mapPeriodicKnotsAffineRounded(knots, 0, 1)).toThrow(/non valid|non finiti/)
  for (const [first, last] of [[1, 1], [2, 1], [-Infinity, 1], [0, Infinity], [NaN, 1]])
    expect(() => mapPeriodicKnotsAffineRounded([0, 1], first, last)).toThrow(/non valido/)
})

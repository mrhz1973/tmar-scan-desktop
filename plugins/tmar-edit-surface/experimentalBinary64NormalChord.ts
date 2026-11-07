// SPDX-License-Identifier: AGPL-3.0-only
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'

type Vector = readonly [number, number, number]
type IntegerVector = readonly [bigint, bigint, bigint]
const axes = [0, 1, 2] as const
const finite = (v: Vector) => Array.isArray(v) && v.length === 3 && axes.every(i => Number.isFinite(v[i]))
const units = (v: Vector): IntegerVector => [binary64Units(v[0]), binary64Units(v[1]), binary64Units(v[2])]
const cross = ([ax, ay, az]: IntegerVector, [bx, by, bz]: IntegerVector): IntegerVector =>
  [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
const dot = (a: IntegerVector, b: IntegerVector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const twiceUnitSquared = 1n << 2149n

/** Test positive orientation and the unit-normal chord on exact values of finite binary64 jets. */
export function experimentalBinary64NormalChordWithin(aTangent: Vector, aTransverse: Vector,
  bTangent: Vector, bTransverse: Vector, maximumChord: number,
) {
  if (![aTangent, aTransverse, bTangent, bTransverse].every(finite) ||
      !Number.isFinite(maximumChord) || maximumChord < 0 || maximumChord > 2) return false
  // Cross products share the square of the binary64 subnormal unit. It
  // cancels from the exact comparison, even for unrepresentable normals.
  const a = cross(units(aTangent), units(aTransverse)), b = cross(units(bTangent), units(bTransverse))
  const alignment = dot(a, b)
  if (alignment <= 0n) return false
  // Chord <= c iff cos(angle) >= 1 - c²/2. With positive cosine the
  // comparison can be squared whenever the right side is positive.
  const requiredCosineNumerator = twiceUnitSquared - binary64Units(maximumChord) ** 2n
  return requiredCosineNumerator <= 0n ||
    (alignment * twiceUnitSquared) ** 2n >= dot(a, a) * dot(b, b) * requiredCosineNumerator ** 2n
}

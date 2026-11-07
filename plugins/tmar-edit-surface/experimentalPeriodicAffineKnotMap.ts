// SPDX-License-Identifier: AGPL-3.0-only
const bits = new DataView(new ArrayBuffer(8))
const fractionMask = (1n << 52n) - 1n

// Express a finite binary64 number in units of the least positive subnormal.
function knotUnits(knot: number): bigint {
  bits.setFloat64(0, knot)
  const word = bits.getBigUint64(0)
  const exponent = (word >> 52n) & 0x7ffn
  const fraction = word & fractionMask
  const units = exponent === 0n ? fraction : ((1n << 52n) | fraction) << (exponent - 1n)
  return word >> 63n ? -units : units
}

function roundMagnitude(numerator: bigint, denominator: bigint, rounding: 'nearest' | 'up'): number {
  // In this binade, one ULP is 2^shift units. Subnormals use one unit.
  const wholeUnits = numerator / denominator
  const shift = Math.max(0, wholeUnits.toString(2).length - 53)
  const divisor = denominator << BigInt(shift)
  let significand = numerator / divisor
  const remainder = numerator % divisor
  const twiceRemainder = 2n * remainder
  const roundUp = rounding === 'up'
    ? remainder > 0n
    : twiceRemainder > divisor || (twiceRemainder === divisor && significand % 2n === 1n)
  if (roundUp) significand++

  // The significand fits exactly, including a carry into the next binade.
  return Number(significand) * 2 ** (shift - 1074)
}

/**
 * Round the positive affine correspondence between two finite periods to
 * binary64 (nearest, ties to even). The source vector contains distinct knots
 * in increasing order, including both endpoints. A rounded collision fails.
 *
 * maxParameterError bounds the absolute error in destination parameter units.
 * It also bounds the real piecewise-linear interpolant through the rounded
 * nodes over the whole source interval: the difference from the affine map
 * is linear on each source span, so its maximum magnitude is at an endpoint.
 * This bound covers neither floating-point interpolation nor CAD geometry.
 */
export function mapPeriodicKnotsAffineRounded(knots: readonly number[], first: number, last: number): {
  knots: number[]
  maxParameterError: number
} {
  if (knots.length < 2 || !Number.isFinite(first) || !Number.isFinite(last) || !(first < last))
    throw new Error('Intervallo parametrico affine non valido')

  let previous = -Infinity
  const sourceUnits: bigint[] = []
  for (const knot of knots) {
    if (!Number.isFinite(knot) || knot <= previous)
      throw new Error('Nodi affini sorgente non finiti o non strettamente crescenti')
    sourceUnits.push(knotUnits(knot))
    previous = knot
  }

  const from = sourceUnits[0]
  const period = sourceUnits[sourceUnits.length - 1] - from
  const to = knotUnits(first)
  const toPeriod = knotUnits(last) - to
  const mapped = [first]
  let maxErrorNumerator = 0n

  for (let i = 1; i < sourceUnits.length - 1; i++) {
    // The exact target, expressed in subnormal units, is numerator / period.
    const numerator = to * period + (sourceUnits[i] - from) * toPeriod
    const magnitude = roundMagnitude(numerator < 0n ? -numerator : numerator, period, 'nearest')
    const rounded = numerator < 0n ? -magnitude : magnitude
    if (rounded <= mapped[i - 1] || rounded >= last)
      throw new Error(`Collisione di nodi affini arrotondati all'indice ${i}`)
    mapped.push(rounded)

    const delta = knotUnits(rounded) * period - numerator
    const errorNumerator = delta < 0n ? -delta : delta
    if (errorNumerator > maxErrorNumerator) maxErrorNumerator = errorNumerator
  }
  mapped.push(last)

  return {
    knots: mapped,
    maxParameterError: roundMagnitude(maxErrorNumerator, period, 'up'),
  }
}

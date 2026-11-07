// SPDX-License-Identifier: AGPL-3.0-only
import type { NurbsCurveData, OcctKernel, ShapeHandle } from 'occt-wasm'
import { comparePeriodicCurves, readFullPeriod } from './experimentalPeriodicCurveWitness'

const bits = new DataView(new ArrayBuffer(8))
const fractionMask = (1n << 52n) - 1n

// Express a finite binary64 knot as an integer multiple of 2^-1074.
function knotUnits(knot: number): bigint {
  bits.setFloat64(0, knot)
  const word = bits.getBigUint64(0)
  const exponent = (word >> 52n) & 0x7ffn
  const fraction = word & fractionMask
  const units = exponent === 0n ? fraction : ((1n << 52n) | fraction) << (exponent - 1n)
  return word >> 63n ? -units : units
}

const bitLength = (value: bigint): number => value.toString(2).length
const trailingZeroBits = (value: bigint): number => bitLength(value & -value) - 1

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

const fail = (reason: string): never => { throw new Error(`Confronto affine periodico rifiutato: ${reason}`) }

function exactDyadic(value: bigint, exponent: number): number {
  if (value <= 0n) return value === 0n ? 0 : -exactDyadic(-value, exponent)
  const shift = trailingZeroBits(value)
  const significand = value >> BigInt(shift)
  exponent += shift
  if (bitLength(significand) > 53 || exponent < -1074)
    fail('nodi affini non rappresentabili esattamente in binary64')
  const knot = Number(significand) * 2 ** exponent
  if (!Number.isFinite(knot)) fail('nodo affine fuori intervallo')
  return knot
}

/** Positive affine map between full periods, with no rounding of knots. */
export function mapPeriodicKnotsAffineExactly(knots: number[], first: number, last: number): number[] {
  if (knots.length < 2 || ![...knots, first, last].every(Number.isFinite) ||
      knots.some((value, i) => i > 0 && value <= knots[i - 1]) || !(first < last))
    return fail('intervallo parametrico non valido')

  const from = knotUnits(knots[0]), period = knotUnits(knots.at(-1)!) - from
  const to = knotUnits(first), toPeriod = knotUnits(last) - to
  return knots.map((knot, i) => {
    if (i === 0) return first
    if (i === knots.length - 1) return last
    const offset = (knotUnits(knot) - from) * toPeriod
    if (offset % period !== 0n) return fail('nodi affini non rappresentabili esattamente nel dominio di destinazione')
    return exactDyadic(to + offset / period, -1074)
  })
}

function reducePeriod(knots: number[]) {
  const start = knotUnits(knots[0])
  const offsets = knots.map(knot => knotUnits(knot) - start)
  // Reduce the denominator across the whole knot vector, including the seam.
  const divisor = offsets.reduce(gcd, 0n)
  const denominator = offsets.at(-1)! / divisor
  const shift = trailingZeroBits(denominator)
  return {
    numerators: offsets.map(offset => offset / divisor),
    oddDenominator: denominator >> BigInt(shift),
    shift,
  }
}

const equal = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i])

/**
 * Compare two periodic supports under the positive affine correspondence
 * taking first to first and last to last. The seam phase stays fixed.
 * Rebuild both supports in a common zero-origin interval with exact affine
 * knot conversion. An interval in [1, 2) avoids imposing either source's
 * arbitrary parameter magnitude. Reject conversion that would round a knot.
 *
 * Returned knots are in the comparison interval. Distances and coefficient
 * equality describe only the reconstructed, refined nets. OCCT's floating-
 * point transformations have no error bound here. This operation does not
 * establish equivalence of source geometry, edge topology or pcurves.
 * Rational supports require identical weights after refinement.
 */
export function comparePeriodicCurvesAffine(kernel: OcctKernel, edgeA: ShapeHandle, edgeB: ShapeHandle) {
  const a = readFullPeriod(kernel, edgeA)
  const b = readFullPeriod(kernel, edgeB)
  const orientation = kernel.shapeOrientation(edgeA)
  if ((orientation !== 'forward' && orientation !== 'reversed') ||
      orientation !== kernel.shapeOrientation(edgeB))
    fail('orientamento dei bordi incompatibile')

  const left = reducePeriod(a.knots)
  const right = reducePeriod(b.knots)
  // The odd factors must divide the comparison period for every normalized
  // knot to be dyadic. A power of two rescales it without rounding.
  const period = left.oddDenominator / gcd(left.oddDenominator, right.oddDenominator) *
    right.oddDenominator
  const exponent = 1 - bitLength(period)
  const comparisonLast = exactDyadic(period, exponent)
  const commonKnots = (basis: ReturnType<typeof reducePeriod>) => {
    const factor = period / basis.oddDenominator
    return basis.numerators.map(numerator => exactDyadic(numerator * factor, exponent - basis.shift))
  }
  const leftKnots = commonKnots(left)
  const rightKnots = commonKnots(right)
  const copies: ShapeHandle[] = []
  function rebuild(data: NurbsCurveData, knots: number[]): ShapeHandle {
    const copy = kernel.makeBSplineEdge(data.poles, data.weights, knots, data.multiplicities, data.degree, true)
    copies.push(copy)
    const actual = readFullPeriod(kernel, copy)
    if (actual.degree !== data.degree || actual.rational !== data.rational ||
        !equal(actual.knots, knots) || !equal(actual.multiplicities, data.multiplicities) ||
        !equal(actual.weights, data.weights) || !equal(actual.poles, data.poles))
      fail('il kernel ha modificato i coefficienti della copia affine')
    return copy
  }

  try {
    const witness = comparePeriodicCurves(kernel, rebuild(a, leftKnots), rebuild(b, rightKnots))
    return {
      ...witness,
      sourceA: { first: a.knots[0], last: a.knots.at(-1)! },
      sourceB: { first: b.knots[0], last: b.knots.at(-1)! },
      comparison: { first: 0, last: comparisonLast },
    }
  } finally {
    for (const copy of copies) kernel.release(copy)
  }
}

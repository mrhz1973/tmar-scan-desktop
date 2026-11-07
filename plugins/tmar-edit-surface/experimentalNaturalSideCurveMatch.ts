// SPDX-License-Identifier: AGPL-3.0-only
// Experimental coefficient witness only. It does not associate an OCCT Edge
// with a curve record or prove that a topological edge owns this natural side.
import type { Net, Point } from './brep'
import type { NaturalSide } from './g1SupportTopology'
import { refineClampedNet } from './refineClampedNet'
import { compareCurveCoefficients, type CoefficientComparison, type Curve3dRecord } from './experimentalCurveWitness'

export interface NaturalSideCurveMatch {
  side: NaturalSide
  along: 'U' | 'V'
  curve: Curve3dRecord
  comparison: CoefficientComparison
}

const fail = (reason: string): never => { throw new Error(`Confronto lato naturale sperimentale rifiutato: ${reason}`) }

const binary64 = new DataView(new ArrayBuffer(8))

/** Every finite binary64 value is an integer multiple of 2^-1074. */
function knotUnits(knot: number): bigint {
  if (!Number.isFinite(knot)) fail('nodo non finito')
  binary64.setFloat64(0, knot)
  const bits = binary64.getBigUint64(0)
  const exponent = (bits >> 52n) & 2047n
  const fraction = bits & ((1n << 52n) - 1n)
  const units = exponent === 0n ? fraction : ((1n << 52n) | fraction) << (exponent - 1n)
  return bits >> 63n ? -units : units
}

function reverseKnots(knots: number[]): number[] {
  const first = knots[0], last = knots.at(-1)!
  const sum = knotUnits(first) + knotUnits(last)
  const interior = knots.slice(1, -1).reverse().map(knot => {
    const reflected = sum - knotUnits(knot)
    const magnitude = reflected < 0n ? -reflected : reflected
    const shift = Math.max(0, magnitude.toString(2).length - 53)
    const significand = magnitude >> BigInt(shift)
    if ((significand << BigInt(shift)) !== magnitude)
      fail('verso inverso: nodo riflesso non rappresentabile esattamente')
    // The reflection lies within the finite endpoints. With at most 53
    // significant bits, this power-of-two scaling introduces no rounding.
    return Number(reflected < 0n ? -significand : significand) * 2 ** (shift - 1074)
  })
  return [first, ...interior, last]
}

/**
 * Compares a natural side of a clamped surface net with a nonperiodic
 * Curve3dRecord. Direction -1 reverses the side coefficients and reflects the
 * knot basis exactly in the original domain. The caller supplies the parameter
 * direction. This witness does not determine topological ownership.
 */
export function matchNaturalSideCurve(net: Net, side: NaturalSide, curve: Curve3dRecord,
  direction: 1 | -1 = 1): NaturalSideCurveMatch {
  if (direction !== 1 && direction !== -1) fail('verso non valido')
  if (!['uMin', 'uMax', 'vMin', 'vMax'].includes(side)) fail('lato naturale sconosciuto')
  const n = refineClampedNet(net, [])
  const along: 'U' | 'V' = side[0] === 'u' ? 'V' : 'U'
  const fixedIndex = side === 'uMin' || side === 'vMin' ? 0 : (along === 'V' ? n.nu - 1 : n.nv - 1)
  const count = along === 'U' ? n.nu : n.nv
  const poles: Point[] = []
  const weights: number[] = []
  for (let i = 0; i < count; i++) {
    const index = along === 'U' ? i * n.nv + fixedIndex : fixedIndex * n.nv + i
    poles.push([...n.poles[index]])
    weights.push(n.weights[index])
  }
  const record: Curve3dRecord = {
    kind: 7, rational: n.rational[along === 'U' ? 0 : 1] === 1,
    periodic: false, degree: along === 'U' ? n.du : n.dv,
    poles, weights,
    knots: [...(along === 'U' ? n.ku : n.kv)],
    multiplicities: [...(along === 'U' ? n.mu : n.mv)],
    source: 'inline-surface-generator'
  }
  if (direction === -1) {
    record.poles.reverse()
    record.weights.reverse()
    record.knots = reverseKnots(record.knots)
    record.multiplicities.reverse()
  }
  const comparison = compareCurveCoefficients(record, curve)
  return { side, along, curve: record, comparison }
}

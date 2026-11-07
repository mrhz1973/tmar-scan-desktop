// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'

const bits = new DataView(new ArrayBuffer(8))
const fractionMask = (1n << 52n) - 1n
const abs = (value: bigint) => value < 0n ? -value : value

// Work in exact units of the least positive subnormal. Validation ensures
// that knots and coordinates are finite before they reach this function.
export function binary64Units(value: number): bigint {
  bits.setFloat64(0, value)
  const word = bits.getBigUint64(0)
  const exponent = (word >> 52n) & 0x7ffn
  const fraction = word & fractionMask
  const units = exponent === 0n ? fraction : ((1n << 52n) | fraction) << (exponent - 1n)
  return word >> 63n ? -units : units
}

// Upper endpoint of an outward binary64 enclosure of a nonnegative
// rational. Work in subnormal units, then round up in the proper binade.
function upperMagnitude(numerator: bigint, denominator: bigint): number {
  const units = numerator << 1074n
  const shift = Math.max(0, (units / denominator).toString(2).length - 53)
  const divisor = denominator << BigInt(shift)
  const rounded = (units + divisor - 1n) / divisor
  return Number(rounded) * 2 ** (shift - 1074)
}

/**
 * Absolute upper bound on the Euclidean difference of the two one-sided
 * increasing-U derivatives at the natural seam of a unit-weight periodic
 * net with seam multiplicity equal to its degree. Tolerance uses coordinate
 * units per original U unit.
 *
 * At a saturated seam both sides meet at the same boundary row. Clear the
 * two positive span denominators before subtracting the derivatives. This
 * retains cancellation and subnormal differences exactly. The resulting
 * coefficient differences share the V basis. The maximum outward-rounded
 * L1 coefficient magnitude bounds the field norm everywhere in V.
 *
 * Exceeding the tolerance with this upper bound is inconclusive. This is a
 * coefficient-model bound on an absolute difference. Parametric C1,
 * relative error, G1, regularity and OCCT evaluation are separate checks.
 */
export function boundExperimentalPeriodicSeamDerivativeGap(net: Net, tolerance: number) {
  return boundGap(net, tolerance, 'absolute-periodic-seam-derivative-coefficient-bound')
}

/** Bound the change in the signed jump field between two models on the same basis. */
export function boundExperimentalPeriodicSeamJumpChange(original: Net, candidate: Net, tolerance: number) {
  validateExperimentalPeriodicSurfaceU(original)
  if (original.du !== candidate.du || original.dv !== candidate.dv || original.nu !== candidate.nu || original.nv !== candidate.nv ||
      (['ku', 'kv', 'mu', 'mv'] as const).some(key => original[key].length !== candidate[key].length ||
        original[key].some((value, i) => value !== candidate[key][i])) || original.weights.some(w => w !== 1))
    throw new Error('Limite variazione salto alla cucitura: basi polinomiali comuni richieste')
  return boundGap(candidate, tolerance, 'periodic-seam-jump-change-coefficient-bound', original)
}

function boundGap<Scope extends string>(net: Net, tolerance: number, evidenceScope: Scope, original?: Net) {
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error('Limite derivata alla cucitura: tolleranza assoluta finita e non negativa richiesta')
  validateExperimentalPeriodicSurfaceU(net)
  const { du, nu, nv, ku, mu, poles, weights } = net
  if (mu[0] !== du || weights.some(w => w !== 1))
    throw new Error('Limite derivata alla cucitura: richiesti pesi unitari e molteplicità U pari al grado alla cucitura')

  const firstSpan = binary64Units(ku[1]) - binary64Units(ku[0])
  const lastSpan = binary64Units(ku.at(-1)!) - binary64Units(ku.at(-2)!)
  const denominator = firstSpan * lastSpan
  const coordinate = (i: number, axis: number) => binary64Units(poles[i][axis]) -
    (original ? binary64Units(original.poles[i][axis]) : 0n)
  let maxNumerator = 0n
  for (let v = 0; v < nv; v++) {
    let numerator = 0n
    for (const axis of [0, 1, 2] as const) {
      const atSeam = coordinate(v, axis)
      const incoming = atSeam - coordinate((nu - 1) * nv + v, axis)
      const outgoing = coordinate(nv + v, axis) - atSeam
      numerator += abs(outgoing * lastSpan - incoming * firstSpan)
    }
    if (numerator > maxNumerator) maxNumerator = numerator
  }

  const upper = upperMagnitude(BigInt(du) * maxNumerator, denominator)
  if (!Number.isFinite(upper)) return { status: 'inconclusive' as const, reason: 'unrepresentable-bound' as const,
    maxDerivativeDifferenceBound: null, checkedVCoefficients: nv, evidenceScope }
  const result = { maxDerivativeDifferenceBound: upper, checkedVCoefficients: nv, evidenceScope }
  return upper <= tolerance ? { status: 'within-tolerance' as const, ...result } :
    { status: 'inconclusive' as const, reason: 'bound-exceeds-tolerance' as const, ...result }
}

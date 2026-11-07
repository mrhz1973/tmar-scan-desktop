// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'

const bits = new DataView(new ArrayBuffer(8))
const fractionMask = (1n << 52n) - 1n

// The net validator has already established finiteness. Express each
// coefficient and knot exactly in units of the least positive subnormal.
function binary64Units(value: number): bigint {
  bits.setFloat64(0, value)
  const word = bits.getBigUint64(0)
  const exponent = (word >> 52n) & 0x7ffn
  const fraction = word & fractionMask
  const units = exponent === 0n ? fraction : ((1n << 52n) | fraction) << (exponent - 1n)
  return word >> 63n ? -units : units
}

/**
 * Check parametric C1 at the natural U seam of a unit-weight periodic net
 * whose seam multiplicity equals its U degree. The V basis must be C1 in
 * its interior. Both sides of the seam have the same boundary row, so
 * matching the U derivative coefficients also matches the full first jet.
 * The derivatives on both sides are oriented in increasing U.
 *
 * Equality refers to the exact mathematical model of the stored binary64
 * coefficients. It permits zero derivatives. Regularity, G1, other U knots
 * and CAD validity are separate checks.
 */
export function checkExperimentalPeriodicSeamC1(net: Net) {
  validateExperimentalPeriodicSurfaceU(net)
  const { du, dv, nu, nv, ku, mu, mv, poles, weights } = net
  if (mu[0] !== du || weights.some(w => w !== 1) || mv.slice(1, -1).some(m => m >= dv))
    throw new Error('Cucitura periodica: richiesti pesi unitari, molteplicità U pari al grado alla cucitura e base V C1')
  const firstSpan = binary64Units(ku[1]) - binary64Units(ku[0])
  const lastSpan = binary64Units(ku.at(-1)!) - binary64Units(ku.at(-2)!)

  const mismatchedVCoefficients: number[] = []
  let incomingDerivativeIdenticallyZero = true, outgoingDerivativeIdenticallyZero = true
  for (let v = 0; v < nv; v++) {
    const previous = poles[(nu - 1) * nv + v], boundary = poles[v], next = poles[nv + v]
    let mismatch = false
    for (const axis of [0, 1, 2] as const) {
      const atSeam = binary64Units(boundary[axis])
      const incoming = atSeam - binary64Units(previous[axis])
      const outgoing = binary64Units(next[axis]) - atSeam
      if (incoming !== 0n) incomingDerivativeIdenticallyZero = false
      if (outgoing !== 0n) outgoingDerivativeIdenticallyZero = false
      // The common U degree and the binary64 units cancel from the equality
      // p*(P0-Pprev)/lastSpan = p*(Pnext-P0)/firstSpan.
      if (incoming * firstSpan !== outgoing * lastSpan) mismatch = true
    }
    if (mismatch) mismatchedVCoefficients.push(v)
  }

  return { c1AtUSeam: mismatchedVCoefficients.length === 0, checkedVCoefficients: nv, mismatchedVCoefficients,
    incomingDerivativeIdenticallyZero, outgoingDerivativeIdenticallyZero,
    evidenceScope: 'exact-periodic-seam-coefficient-model' as const }
}

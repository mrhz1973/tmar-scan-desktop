// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { mapPeriodicKnotsAffineRounded } from './experimentalPeriodicAffineKnotMap'
import { readFullPeriod } from './experimentalPeriodicCurveWitness'
import { add, difference, divide, l1, mul, scalar, sub } from './tangencyCoefficientIntervals'
import type { Point } from './brep'

/**
 * Bound the Euclidean distance between C(A(t)) and C(L(t)), where C is the
 * full-period polynomial target read from the edge, A is the exact positive
 * affine map and L is the real piecewise-linear interpolant of its rounded
 * source-knot images. Both maps have exactly the target period as their range.
 *
 * Requires at least as many distinct pole indices per period as the degree.
 * The derivative on each open target span is in the convex hull of its
 * active derivative coefficients. Multiplicity at most the degree gives
 * continuity, so the largest span speed bound is also a Lipschitz constant
 * across knots. The bound applies to the mathematical spline defined by
 * the read-back coefficients and to the two real maps. OCCT evaluation,
 * refinement and changes to spline knots require separate error bounds.
 */
export function boundPeriodicAffineMapGeometry(
  kernel: OcctKernel, target: ShapeHandle, sourceKnots: readonly number[],
) {
  const { degree, knots, multiplicities, poles, rational } = readFullPeriod(kernel, target)
  if (rational) throw new Error('Limite affine periodico: serve una curva polinomiale non razionale')
  if (poles.length / 3 < degree) throw new Error('Limite affine periodico: numero di poli inferiore al grado')
  // The full-period reader uses Array.some, which skips holes in arrays.
  for (const coefficients of [knots, multiplicities, poles]) {
    for (const value of coefficients) {
      if (value === undefined) throw new Error('Limite affine periodico: coefficienti mancanti')
    }
  }
  const first = knots[0], last = knots.at(-1)!
  const mapping = mapPeriodicKnotsAffineRounded(sourceKnots, first, last)

  const flat = knots.slice(0, -1).flatMap((knot, i) => Array<number>(multiplicities[i]).fill(knot))
  const count = flat.length
  const wrap = (i: number) => ((i % count) + count) % count
  const pole = (i: number): Point => {
    const offset = 3 * wrap(i)
    return [poles[offset], poles[offset + 1], poles[offset + 2]]
  }
  const width = (lo: number, hi: number) => {
    const a = flat[wrap(lo)], b = flat[wrap(hi)]
    if (Math.floor(lo / count) === Math.floor(hi / count)) return sub(scalar(b), scalar(a))
    // Form a wrapped difference without shifting either knot beyond the
    // natural domain or subtracting two independently rounded extensions.
    return add(sub(scalar(last), scalar(a)), sub(scalar(b), scalar(first)))
  }

  let start = 0, maxTargetSpeedBound = 0
  const checkedTargetSpans = knots.length - 1
  for (let span = 0; span < checkedTargetSpans; span++) {
    if (span > 0) start += multiplicities[span]
    for (let j = 0; j < degree; j++) {
      const i = start + j
      // In the OCCT expanded sequence the first nonempty span ends its
      // left knot at index p and uses poles 0..p. Index p corresponds to
      // multiplicities[0] - 1 in flat. Translate the derivative denominator
      // T[i+p+1] - T[i+1] to that periodic indexing.
      const hi = i + multiplicities[0]
      const a = pole(i), b = pole(i + 1)
      if (a.every((x, axis) => x === b[axis])) continue
      const delta = l1(difference(b, a))
      const speed = divide(mul(scalar(degree), scalar(delta)), width(hi - degree, hi))[1]
      maxTargetSpeedBound = Math.max(maxTargetSpeedBound, speed)
    }
  }
  const maxPositionError = mapping.maxParameterError === 0 || maxTargetSpeedBound === 0 ? 0 :
    mul(scalar(maxTargetSpeedBound), scalar(mapping.maxParameterError))[1]
  return { ...mapping, checkedTargetSpans, maxTargetSpeedBound, maxPositionError,
    evidenceScope: 'target-polynomial-coefficient-model' as const }
}

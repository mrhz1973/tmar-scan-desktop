// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { add, divide, l1, mul, scalar, sub, type I, type V } from './tangencyCoefficientIntervals'

const equal = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i])

const delta = (a: number, b: number): I => a === b ? scalar(0) : sub(scalar(a), scalar(b))

/**
 * Bound the positional error of a unit-weight, linear-V periodic-U net
 * represented as a cubic-V net with four or nine V rows. The two models
 * share the U basis and the natural V interval.
 *
 * Linear precision gives the exact cubic coefficients by interpolating the
 * linear endpoints at the Greville abscissae of the stored V basis. The
 * tensor-product basis is a nonnegative partition of unity, so the maximum
 * L1 coefficient error bounds Euclidean displacement over the whole domain.
 * The same argument on the endpoint rows bounds each natural V border.
 * The calculation concerns the mathematical coefficient models. Kernel
 * evaluation, trims, solids and volume require separate verification.
 */
export function boundPeriodicLinearVRefinement(source: Net, refined: Net) {
  validateExperimentalPeriodicSurfaceU(source)
  validateExperimentalPeriodicSurfaceU(refined)
  if (source.dv !== 1 || source.nv !== 2 || refined.dv !== 3 || (refined.nv !== 4 && refined.nv !== 9))
    throw new Error('Limite raffinamento V: servono due file lineari e quattro o nove file cubiche')
  if (source.weights.some(w => w !== 1) || refined.weights.some(w => w !== 1))
    throw new Error('Limite raffinamento V: richiesti pesi unitari')
  if (source.du !== refined.du || source.nu !== refined.nu ||
      !equal(source.ku, refined.ku) || !equal(source.mu, refined.mu) ||
      source.kv[0] !== refined.kv[0] || source.kv.at(-1) !== refined.kv.at(-1))
    throw new Error('Limite raffinamento V: la base U e gli estremi V devono coincidere')

  const { nv, dv, kv, mv } = refined
  const first = kv[0], last = kv.at(-1)!
  const width = sub(scalar(last), scalar(first))
  const knots = kv.flatMap((knot, i) => {
    const normalized = knot === first ? scalar(0) : knot === last ? scalar(1) :
      divide(sub(scalar(knot), scalar(first)), width)
    return Array<I>(mv[i]).fill(normalized)
  })
  const greville = Array.from({ length: nv }, (_, v) => {
    if (v === 0) return scalar(0)
    if (v === nv - 1) return scalar(1)
    return divide(knots.slice(v + 1, v + 1 + dv).reduce(add), scalar(dv))
  })

  let maxPositionError = 0, maxBoundaryPositionError = 0
  for (let u = 0; u < source.nu; u++) {
    const a = source.poles[2 * u], b = source.poles[2 * u + 1]
    for (const [v, t] of greville.entries()) {
      const actual = refined.poles[u * nv + v]
      const boundary = v === 0 || v === nv - 1
      const error = actual.map((x, axis) => {
        if (v === nv - 1) return delta(x, b[axis])
        const offset = delta(x, a[axis])
        if (v === 0 || a[axis] === b[axis]) return offset
        return sub(offset, mul(t, delta(b[axis], a[axis])))
      }) as V
      const distance = error.every(([lo, hi]) => lo === 0 && hi === 0) ? 0 : l1(error)
      maxPositionError = Math.max(maxPositionError, distance)
      if (boundary) maxBoundaryPositionError = Math.max(maxBoundaryPositionError, distance)
    }
  }
  return { maxPositionError, maxBoundaryPositionError, checkedPoles: refined.poles.length,
    evidenceScope: 'unit-weight-periodic-surface-coefficient-model' as const }
}

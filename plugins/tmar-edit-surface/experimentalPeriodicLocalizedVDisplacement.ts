// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { boundPeriodicLinearVRefinement } from './experimentalPeriodicLinearVRefinementBound'
import { add, difference, divide, l1, mul, scalar, sub, type I } from './tangencyCoefficientIntervals'

const equal = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, i) => value === b[i])
const midpoint = (a: I, b: I): I => add(mul(scalar(0.5), a), mul(scalar(0.5), b))
type Cubic = [I, I, I, I]

function bisectedUpper([a, b, c, d]: Cubic, depth: number): number {
  if (depth === 0) return Math.max(a[1], b[1], c[1], d[1])
  const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d)
  const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), center = midpoint(abc, bcd)
  return Math.max(bisectedUpper([a, ab, abc, center], depth - 1), bisectedUpper([center, bcd, cd, d], depth - 1))
}

function adjacentBasisUpper(edge: number, inner: number, end: number) {
  // beta is the fraction of the two-span support beyond the first span,
  // read inward from the edge. The same formula applies under reflection.
  const delta = (a: number, b: number) => a > b ? sub(scalar(a), scalar(b)) : sub(scalar(b), scalar(a))
  const beta = divide(delta(end, inner), delta(end, edge))
  const betaSquared = mul(beta, beta)
  // Cox-de Boor gives the first span's Bernstein coefficients
  // [0, 1, beta, beta²]. On the next span the basis falls monotonically
  // from beta² to zero. The full B-spline partition also bounds it by 1.
  return Math.min(1, bisectedUpper([scalar(0), scalar(1), beta, betaSquared], 8))
}

/**
 * Tighter absolute displacement bound for a nine-row unit-weight strip
 * when only rows 1 and 7 (zero-based) differ from a refined baseline.
 * Source V is linear and the cubic basis has five simple interior knots.
 * The two moved basis functions have disjoint supports. Each V support
 * weights the U convex hull of the displacements for its own moved row.
 *
 * Add the existing source-to-baseline bound before comparing with the
 * independent source-to-candidate coefficient hull. The smaller result
 * bounds the Euclidean distance everywhere at corresponding parameters.
 * This concerns the mathematical coefficient models. Kernel evaluation,
 * thickness, regularity, trims and solids require separate checks.
 */
export function boundExperimentalPeriodicLocalizedVDisplacement(source: Net, refined: Net, candidate: Net) {
  const refinement = boundPeriodicLinearVRefinement(source, refined)
  const legacy = boundPeriodicLinearVRefinement(source, candidate)
  if (refined.nv !== 9 || !equal(refined.mv, [4, 1, 1, 1, 1, 1, 4]) ||
      !equal(refined.kv, candidate.kv) || !equal(refined.mv, candidate.mv))
    throw new Error('Limite spostamento localizzato: serve la stessa base V cubica a nove file con nodi interni semplici')

  let lowerRowDisplacement = 0, upperRowDisplacement = 0
  for (const [index, pole] of candidate.poles.entries()) {
    const baseline = refined.poles[index]
    if (equal(pole, baseline)) continue
    const row = index % 9
    if (row !== 1 && row !== 7)
      throw new Error(`Limite spostamento localizzato: polo protetto modificato (${index})`)
    const displacement = l1(difference(pole, baseline))
    if (row === 1) lowerRowDisplacement = Math.max(lowerRowDisplacement, displacement)
    else upperRowDisplacement = Math.max(upperRowDisplacement, displacement)
  }

  const knots = refined.kv
  const lowerBasisUpper = adjacentBasisUpper(knots[0], knots[1], knots[2])
  const upperBasisUpper = adjacentBasisUpper(knots[6], knots[5], knots[4])
  const weighted = (norm: number, weight: number) => norm === 0 ? 0 : mul(scalar(norm), scalar(weight))[1]
  const maxLocalizedDisplacement = Math.max(weighted(lowerRowDisplacement, lowerBasisUpper),
    weighted(upperRowDisplacement, upperBasisUpper))
  const localizedTotal = maxLocalizedDisplacement === 0 ? refinement.maxPositionError :
    add(scalar(refinement.maxPositionError), scalar(maxLocalizedDisplacement))[1]
  return {
    maxPositionError: Math.min(legacy.maxPositionError, localizedTotal),
    maxBoundaryPositionError: legacy.maxBoundaryPositionError,
    legacyPositionBound: legacy.maxPositionError,
    refinementPositionBound: refinement.maxPositionError,
    maxLocalizedDisplacement, lowerBasisUpper, upperBasisUpper,
    evidenceScope: 'localized-unit-weight-periodic-coefficient-model' as const,
  }
}

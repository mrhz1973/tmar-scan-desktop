// SPDX-License-Identifier: AGPL-3.0-only
import type { ExperimentalPolynomialBSpline } from './experimentalClampedBSplineTrim'
import { clampExperimentalPolynomialBSpline } from './experimentalClampedBSplineTrim'
import { boundExperimentalPeriodicCurveAffineDifference, canonicalizeExperimentalClosedClampedCurve } from './experimentalPeriodicCurveAffineDifference'
import { add, l1, scalar, sub, type V } from './tangencyCoefficientIntervals'

function fail(reason: string): never { throw Error(`Corrispondenza curve salvate rifiutata: ${reason}`) }
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

/**
 * Identity-parameter correspondence on the original active domain only.
 * The padded source is first clamped by exact rational knot insertion. The
 * emitted binary64 curve has its own reported position-error enclosure;
 * this error is added outward to the separate periodic comparison bound.
 * Only an exactly closed emitted curve can use the existing canonicalizer.
 * Neither periodic closure nor G1 is inferred for the original curve from
 * its rounded emission. No native shape is constructed or evaluated.
 */
export function boundExperimentalPaddedCurveCorrespondence(
  original: ExperimentalPolynomialBSpline, candidate: ExperimentalPolynomialBSpline,
  activeRange: readonly [number, number], maxCells = 4096,
) {
  if (!Array.isArray(activeRange) || activeRange.length !== 2 || !Array.from(activeRange).every(Number.isFinite) ||
      !(activeRange[0] < activeRange[1])) fail('intervallo attivo non valido')
  // Clamp the entire original active interval; a narrower caller-supplied
  // interval must not silently replace the intended identity contract.
  const clamped = clampExperimentalPolynomialBSpline(original)
  if (clamped.status !== 'converted') fail(`clamp ${clamped.reason}`)
  const domain = [clamped.curve.knots[0], clamped.curve.knots.at(-1)!] as const
  if (!same(domain, activeRange)) fail('intervallo diverso dal dominio attivo originale')
  if (!(original.knots[0] < domain[0] || original.knots.at(-1)! > domain[1])) fail('sorgente priva di nodi padded')
  if (!candidate || !Array.isArray(candidate.knots) || candidate.knots.length < 2 ||
      !same([candidate.knots[0], candidate.knots.at(-1)!], domain)) fail('domini diversi per la corrispondenza identita')
  const canonical = canonicalizeExperimentalClosedClampedCurve(clamped.curve)
  const periodicBound = boundExperimentalPeriodicCurveAffineDifference(canonical.curve, candidate, maxCells)
  const clampErrorUpper = clamped.maximumCurveErrorUpper
  const maximumCurveDifferenceUpper = clampErrorUpper === 0 ? periodicBound.maximumCurveDifferenceUpper :
    add(scalar(clampErrorUpper), scalar(periodicBound.maximumCurveDifferenceUpper))[1]
  if (!Number.isFinite(maximumCurveDifferenceUpper)) fail('limite combinato non rappresentabile')
  return { status: 'bounded' as const, maximumCurveDifferenceUpper, clampErrorUpper,
    clampExactInBinary64: clamped.exactInBinary64, periodicComparisonUpper: periodicBound.maximumCurveDifferenceUpper,
    canonicalizationExactRepresentationIdentity: canonical.exactRepresentationIdentity,
    originalActiveDomain: domain, candidateDomain: periodicBound.candidateDomain,
    clampedPoleCount: clamped.curve.poles.length, canonicalPoleCount: canonical.curve.poles.length,
    checkedCells: periodicBound.checkedCells, checkedControlPairs: periodicBound.checkedControlPairs,
    normalizedPartition: periodicBound.normalizedPartition, worstCell: periodicBound.worstCell,
    correspondence: 'identity-original-active-parameter' as const,
    boundMethod: 'own-clamp-error-plus-periodic-bernstein-difference' as const,
    evidenceScope: 'padded-polynomial-curve-coefficient-model' as const,
    nativeCadCertified: false as const, tubeAccepted: false as const }
}

function everyDense<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): boolean {
  if (!Array.isArray(values)) return false
  for (let i = 0; i < values.length; i++) if (!Object.hasOwn(values, i) || !predicate(values[i], i)) return false
  return true
}

function validateQuintic(curve: ExperimentalPolynomialBSpline) {
  if (!curve || curve.degree !== 5 || (curve.periodic !== undefined && curve.periodic !== false) ||
      (curve.rational !== undefined && curve.rational !== false) || !Array.isArray(curve.poles) ||
      curve.poles.length < 6 || curve.poles.length > 512 ||
      !everyDense(curve.poles, p => Array.isArray(p) && p.length === 3 && everyDense(p, Number.isFinite)) ||
      !Array.isArray(curve.knots) || curve.knots.length < 2 || curve.knots.length > 518 ||
      !everyDense(curve.knots, (k, i) => Number.isFinite(k) && (i === 0 || k > curve.knots[i - 1])) ||
      !Array.isArray(curve.multiplicities) || curve.multiplicities.length !== curve.knots.length ||
      !everyDense(curve.multiplicities, (m, i) => i === 0 || i === curve.knots.length - 1 ? m === 6 :
        Number.isInteger(m) && m >= 1 && m <= 5) ||
      curve.multiplicities.reduce((sum, m) => sum + m, 0) !== curve.poles.length + 6 ||
      (curve.weights !== undefined && (!Array.isArray(curve.weights) ||
        (curve.weights.length !== 0 && curve.weights.length !== curve.poles.length) || !everyDense(curve.weights, w => w === 1))))
    fail('curva quintica clamped polinomiale non valida')
}

/**
 * A separate contract for two clamped nonperiodic quintic curves with an
 * identical native knot basis. Nonnegative B-spline basis functions form a
 * partition of unity, so the outward L1 hull of paired pole differences
 * encloses Euclidean position difference on the entire closed domain.
 * Changed knots, weights, multiplicities or parameter maps are rejected;
 * this helper never substitutes a cubic periodic representation.
 */
export function boundExperimentalQuinticSameBasisCurveDifference(
  original: ExperimentalPolynomialBSpline, candidate: ExperimentalPolynomialBSpline,
) {
  validateQuintic(original); validateQuintic(candidate)
  if (original.poles.length !== candidate.poles.length || !same(original.knots, candidate.knots) ||
      !same(original.multiplicities, candidate.multiplicities)) fail('basi quintiche differenti')
  let maximumCurveDifferenceUpper = 0, changedComponents = 0, worstPoleIndex = 0
  for (const [i, point] of original.poles.entries()) {
    const other = candidate.poles[i]
    if (same(point, other)) continue
    const differences = point.map((x, axis) => {
      if (Object.is(x, other[axis])) return scalar(0)
      changedComponents++
      return sub(scalar(other[axis]), scalar(x))
    }) as V
    const upper = l1(differences)
    if (upper > maximumCurveDifferenceUpper) { maximumCurveDifferenceUpper = upper; worstPoleIndex = i }
  }
  if (!Number.isFinite(maximumCurveDifferenceUpper)) fail('limite quintico non rappresentabile')
  return { status: 'bounded' as const, maximumCurveDifferenceUpper, checkedControlPairs: original.poles.length,
    changedComponents, worstPoleIndex, degree: 5 as const,
    domain: [original.knots[0], original.knots.at(-1)!] as const,
    correspondence: 'identity-original-parameter-unchanged-quintic-basis' as const,
    boundMethod: 'nonnegative-bspline-basis-outward-coefficient-l1-hull' as const,
    evidenceScope: 'nonperiodic-quintic-curve-coefficient-model' as const,
    nativeCadCertified: false as const, tubeAccepted: false as const }
}

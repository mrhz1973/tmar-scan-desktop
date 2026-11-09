// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Point } from '../brep'
import { clampExperimentalPolynomialBSpline, type ExperimentalPolynomialBSpline } from '../experimentalClampedBSplineTrim'
import { canonicalizeExperimentalClosedClampedCurve } from '../experimentalPeriodicCurveAffineDifference'
import { boundExperimentalPaddedCurveCorrespondence, boundExperimentalQuinticSameBasisCurveDifference } from '../experimentalSavedPairCurveCorrespondence'

function paddedCubic(): ExperimentalPolynomialBSpline {
  return { degree: 3, periodic: false, rational: false, knots: [-1, 0, 1, 2, 3], multiplicities: [1, 3, 3, 3, 1],
    poles: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [2, 0, 0], [1, 0, 0], [0, 0, 0]], weights: Array<number>(7).fill(1) }
}
function periodicCubic(): ExperimentalPolynomialBSpline {
  return { degree: 3, periodic: true, rational: false, knots: [0, 1, 2], multiplicities: [3, 3, 3],
    poles: paddedCubic().poles.slice(0, -1), weights: Array<number>(6).fill(1) }
}
function quintic(): ExperimentalPolynomialBSpline {
  return { degree: 5, periodic: false, rational: false, knots: [0, 0.05, 0.95, 1], multiplicities: [6, 3, 3, 6],
    poles: Array.from({ length: 12 }, (_, i): Point => [i, i % 2, i / 4]), weights: Array<number>(12).fill(1) }
}

it('uses its own exact clamp before comparing a padded cubic on the original active interval', () => {
  const original = paddedCubic(), candidate = periodicCubic(), before = structuredClone({ original, candidate })
  const result = boundExperimentalPaddedCurveCorrespondence(original, candidate, [0, 2])
  expect(result).toMatchObject({ status: 'bounded', clampErrorUpper: 0, clampExactInBinary64: true,
    clampedPoleCount: 7, canonicalPoleCount: 6, originalActiveDomain: [0, 2], candidateDomain: [0, 2],
    checkedCells: 2, checkedControlPairs: 8, nativeCadCertified: false, tubeAccepted: false })
  expect(result.maximumCurveDifferenceUpper).toBeLessThan(1e-11)
  expect({ original, candidate }).toEqual(before)
})

it('carries a nonzero binary64 clamp emission error outward into the complete comparison', () => {
  // One full period of a uniform cubic with three exterior knots on each
  // side. Its clamped endpoint is (2/3, 1/6, 0), so exact rational insertion
  // cannot be emitted exactly in binary64 even though the curve is closed.
  const original: ExperimentalPolynomialBSpline = { degree: 3, periodic: false,
    knots: [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7], multiplicities: Array<number>(11).fill(1),
    poles: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]] }
  const clamp = clampExperimentalPolynomialBSpline(original)
  expect(clamp.status).toBe('converted')
  if (clamp.status !== 'converted') throw Error('fixture-clamp-failed')
  expect(clamp.maximumCurveErrorUpper).toBeGreaterThan(0)
  const candidate = canonicalizeExperimentalClosedClampedCurve(clamp.curve).curve
  const result = boundExperimentalPaddedCurveCorrespondence(original, candidate, [0, 4])
  expect(result.clampExactInBinary64).toBe(false)
  expect(result.clampErrorUpper).toBe(clamp.maximumCurveErrorUpper)
  expect(result.maximumCurveDifferenceUpper).toBeGreaterThan(result.periodicComparisonUpper)
  expect(result.maximumCurveDifferenceUpper).toBeGreaterThanOrEqual(result.clampErrorUpper + result.periodicComparisonUpper)
})

it('rejects a narrowed active interval and an affine domain substitution in the identity contract', () => {
  expect(() => boundExperimentalPaddedCurveCorrespondence(paddedCubic(), periodicCubic(), [0.5, 2])).toThrow(/dominio attivo/)
  expect(() => boundExperimentalPaddedCurveCorrespondence(paddedCubic(), { ...periodicCubic(), knots: [0, 2, 4] }, [0, 2]))
    .toThrow(/domini diversi/)
  const clamped = { ...paddedCubic(), knots: [0, 1, 2], multiplicities: [4, 3, 4] }
  expect(() => boundExperimentalPaddedCurveCorrespondence(clamped, periodicCubic(), [0, 2])).toThrow(/priva di nodi padded/)
})

it('rejects malformed, rational or not-exactly-closed padded representations', () => {
  expect(() => boundExperimentalPaddedCurveCorrespondence({ ...paddedCubic(), multiplicities: [1, 3, 2, 3, 1] }, periodicCubic(), [0, 2]))
    .toThrow(/clamp invalid-input/)
  expect(() => boundExperimentalPaddedCurveCorrespondence({ ...paddedCubic(), rational: true }, periodicCubic(), [0, 2]))
    .toThrow(/clamp invalid-input/)
  const open = paddedCubic(), poles = open.poles.map(p => [...p] as Point); poles[poles.length - 1][0] = 1
  expect(() => boundExperimentalPaddedCurveCorrespondence({ ...open, poles }, periodicCubic(), [0, 2])).toThrow(/polo finale/)
})

it('returns exact zero for identical quintic coefficients without importing periodic assumptions', () => {
  const original = quintic(), candidate = structuredClone(original), before = structuredClone({ original, candidate })
  expect(boundExperimentalQuinticSameBasisCurveDifference(original, candidate)).toMatchObject({ status: 'bounded',
    degree: 5, maximumCurveDifferenceUpper: 0, checkedControlPairs: 12, changedComponents: 0,
    domain: [0, 1], nativeCadCertified: false, tubeAccepted: false })
  expect({ original, candidate }).toEqual(before)
})

it('encloses constant quintic displacement and the sharp endpoint displacement continuously', () => {
  const original = quintic()
  const translated = { ...original, poles: original.poles.map(([x, y, z]): Point => [x + 1, y - 2, z + 3]) }
  const result = boundExperimentalQuinticSameBasisCurveDifference(original, translated)
  expect(result.maximumCurveDifferenceUpper).toBeGreaterThanOrEqual(6)
  expect(result.maximumCurveDifferenceUpper).toBeLessThan(6 + 1e-12)
  expect(result.changedComponents).toBe(36)
  const poles = original.poles.map(p => [...p] as Point); poles[11][0] += 0.25
  const endpoint = boundExperimentalQuinticSameBasisCurveDifference(original, { ...original, poles })
  expect(endpoint.maximumCurveDifferenceUpper).toBeGreaterThanOrEqual(0.25)
  expect(endpoint.maximumCurveDifferenceUpper).toBeLessThan(0.25 + 1e-13)
  expect(endpoint.worstPoleIndex).toBe(11)
})

it('declines a changed quintic knot basis, multiplicity, degree or periodic/rational representation', () => {
  const original = quintic()
  expect(() => boundExperimentalQuinticSameBasisCurveDifference(original, { ...original, knots: [0, 0.06, 0.95, 1] }))
    .toThrow(/basi quintiche differenti/)
  expect(() => boundExperimentalQuinticSameBasisCurveDifference(original, { ...original, multiplicities: [6, 2, 4, 6] }))
    .toThrow(/basi quintiche differenti/)
  for (const changed of [{ degree: 3 }, { periodic: true }, { rational: true }, { weights: Array<number>(12).fill(2) }])
    expect(() => boundExperimentalQuinticSameBasisCurveDifference(original, { ...original, ...changed })).toThrow(/quintica clamped/)
})

it('declines nonfinite or sparse quintic data instead of skipping missing coefficients', () => {
  const original = quintic(), missing = original.poles.map(p => [...p] as Point); delete missing[3]
  expect(() => boundExperimentalQuinticSameBasisCurveDifference(original, { ...original, poles: missing })).toThrow(/quintica clamped/)
  const nonfinite = original.poles.map(p => [...p] as Point); nonfinite[4][2] = Infinity
  expect(() => boundExperimentalQuinticSameBasisCurveDifference(original, { ...original, poles: nonfinite })).toThrow(/quintica clamped/)
  const knots = [...original.knots]; delete knots[1]
  expect(() => boundExperimentalQuinticSameBasisCurveDifference(original, { ...original, knots })).toThrow(/quintica clamped/)
})

// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import type { ExperimentalCandidateJointBoundary } from './experimentalCandidateJointDifferential'
import { createExperimentalCandidateJointPointEvaluator, measureExperimentalCandidateJointPoint,
  normExperimentalCandidatePointVector, type ExperimentalCandidateSavedWitness } from './experimentalCandidateJointPoint'
import { add, divide, mul, scalar, sub, type I } from './tangencyCoefficientIntervals'

export interface ExperimentalCandidateTargetWitnessRequest {
  lateral: ExperimentalCandidateJointBoundary
  support: ExperimentalCandidateJointBoundary
  /** Native inward D1 coefficients in the lateral's unchanged periodic U basis. */
  targetInward: readonly Point[]
  /** Addresses from the acquired receipt; this diagnostic does not search for witnesses. */
  witnesses: readonly ExperimentalCandidateSavedWitness[]
  maximumNormalChord: number
  /** Euclidean bound for every D1 coefficient relative to this same target field. */
  maximumD1FidelityMmPerV: number
  maxCells?: number
  maxWitnesses?: number
}

function fail(reason: string): never { throw Error(`Candidate target witness refused: ${reason}`) }
const abs = (x: I): I => [x[0] > 0 ? x[0] : x[1] < 0 ? -x[1] : 0, Math.max(Math.abs(x[0]), Math.abs(x[1]))]

/**
 * A local necessary-condition certificate, with the target, boundary tangent,
 * support, parameter maps and inward orientations FIXED.
 *
 * At a point let A=T x Mtarget and ||dM||<=epsilon. The nonnegative U basis
 * partition of unity makes this pointwise bound follow from the same bound
 * on every target-relative D1 coefficient (an L1 bound is also sufficient).
 * Then ||dA||<=||T||epsilon, and for A!=0, A+dA!=0:
 *   ||unit(A+dA)-unit(A)|| <= 2||dA||/||A||.
 * The reverse triangle inequality gives a lower bound on the chord to the
 * fixed support normal. A zero resulting normal fails regularity anyway.
 * Conversely a chord within c requires
 *   ||dM|| >= max(0,chord(target,support)-c)*||A||/(2||T||).
 * All bounds below are outward intervals; equality never certifies exclusion.
 * Not excluded is not a proof of feasibility, a new solve or a whole-join PASS.
 */
function fidelityExclusion(target: ReturnType<typeof measureExperimentalCandidateJointPoint>, tangentNorm: I,
  maximumNormalChord: number, epsilon: number) {
  const chord = target.normalChord, targetNormalNorm = target.normalNorm
  const normalPerturbationUpper = mul(tangentNorm, scalar(epsilon))[1]
  const allAllowedPointPerturbationsRemainRegular = sub(scalar(targetNormalNorm[0]), scalar(normalPerturbationUpper))[0] > 0
  const available = chord !== null && targetNormalNorm[0] > 0 && tangentNorm[0] > 0
  let maximumUnitNormalChangeUpper: number | null = null, anyAdmissibleNormalChordLower: number | null = null
  let necessaryPointwiseD1ChangeLowerMmPerV: number | null = null
  if (available) {
    maximumUnitNormalChangeUpper = Math.min(2, divide(mul(scalar(2), scalar(normalPerturbationUpper)), scalar(targetNormalNorm[0]))[1])
    anyAdmissibleNormalChordLower = Math.max(0, sub(scalar(chord[0]), scalar(maximumUnitNormalChangeUpper))[0])
    const gapLower = Math.max(0, sub(scalar(chord[0]), scalar(maximumNormalChord))[0])
    necessaryPointwiseD1ChangeLowerMmPerV = Math.max(0, divide(mul(scalar(gapLower), scalar(targetNormalNorm[0])),
      mul(scalar(2), scalar(tangentNorm[1])))[0])
  }
  const excluded = anyAdmissibleNormalChordLower !== null && anyAdmissibleNormalChordLower > maximumNormalChord ||
    necessaryPointwiseD1ChangeLowerMmPerV !== null && necessaryPointwiseD1ChangeLowerMmPerV > epsilon
  const residualBall = (x: I | null) => x && abs(add(x, [-epsilon, epsilon]))
  return { classification: excluded ? 'infeasible-with-fixed-target-and-D1-fidelity' as const : 'not-excluded-by-local-bound' as const,
    maximumD1FidelityMmPerV: epsilon, normalPerturbationUpper, maximumUnitNormalChangeUpper,
    anyAdmissibleNormalChordLower, necessaryPointwiseD1ChangeLowerMmPerV, allAllowedPointPerturbationsRemainRegular,
    projectedAbsoluteNormalResidualForD1Ball: residualBall(target.referenceSignedNormalResidualMmPerV),
    supportAbsoluteNormalResidualForD1Ball: residualBall(target.supportSignedNormalResidualMmPerV),
    fixedAssumptions: ['target-inward-coefficient-field', 'lateral-boundary-tangent-and-U-basis', 'support-geometry', 'parameter-correspondence', 'inward-orientations'] as const,
    coefficientToPointImplication: 'nonnegative-periodic-U-basis-partition-of-unity' as const,
    infeasibilityIsNecessaryConditionOnly: true as const, candidateConstructed: false as const }
}

export function diagnoseExperimentalCandidateTargetWitnesses(request: ExperimentalCandidateTargetWitnessRequest) {
  if (!request) fail('missing-request')
  const { lateral, support, targetInward, witnesses, maximumNormalChord, maximumD1FidelityMmPerV,
    maxCells = 4096, maxWitnesses = 8 } = request
  if (!Number.isFinite(maximumNormalChord) || maximumNormalChord <= 0 || maximumNormalChord >= 1 ||
      !Number.isFinite(maximumD1FidelityMmPerV) || maximumD1FidelityMmPerV < 0) fail('invalid-diagnostic-criteria')
  if (!Number.isSafeInteger(maxWitnesses) || maxWitnesses < 1 || maxWitnesses > 8 || !Array.isArray(witnesses) ||
      witnesses.length < 1 || witnesses.length > maxWitnesses) fail('saved-witness-budget')
  for (let i = 0; i < witnesses.length; i++) if (!Object.hasOwn(witnesses, i)) fail('sparse-witness-list')
  const evaluator = createExperimentalCandidateJointPointEvaluator(lateral, support, { targetInward, maxCells, maxPointEvaluations: maxWitnesses })
  const groups = new Map<string, { witness: ExperimentalCandidateSavedWitness; sourceIndices: number[] }>()
  for (const [index, witness] of witnesses.entries()) {
    const address = evaluator.resolveWitness(witness), found = groups.get(address.key)
    if (found) found.sourceIndices.push(index)
    else groups.set(address.key, { witness, sourceIndices: [index] })
  }
  const points = [...groups.values()].map(({ witness, sourceIndices }) => {
    const point = evaluator.evaluateWitness(witness)
    if (!point.lateral.targetInward || !point.lateral.targetMinusStoredInward) fail('missing-target-inward-field')
    const stored = measureExperimentalCandidateJointPoint(point, maximumNormalChord)
    const target = measureExperimentalCandidateJointPoint({ ...point, M: point.lateral.targetInward }, maximumNormalChord)
    const targetMinusStoredInward = point.lateral.targetMinusStoredInward
    const targetMinusStoredInwardNormMmPerV = normExperimentalCandidatePointVector(targetMinusStoredInward)
    const targetStoredPointFidelityClassification = targetMinusStoredInwardNormMmPerV[0] > maximumD1FidelityMmPerV ? 'outside-declared-criterion' as const :
      targetMinusStoredInwardNormMmPerV[1] <= maximumD1FidelityMmPerV ? 'within-declared-criterion' as const : 'inconclusive' as const
    const feasibility = fidelityExclusion(target, normExperimentalCandidatePointVector(point.T), maximumNormalChord, maximumD1FidelityMmPerV)
    return { key: point.key, sourceWitnessIndices: sourceIndices, witnessAddress: { cell: witness.cell, localDomain: [...witness.localDomain], endpoint: witness.endpoint },
      normalizedParameter: point.lateral.normalizedParameter,
      lateral: { uSpan: point.lateral.uSpan, nativeParameter: point.lateral.nativeParameter, edge: point.lateral.edge,
        inwardSign: point.lateral.inwardSign, seamSide: point.lateral.seamSide },
      support: { uSpan: point.support.uSpan, nativeParameter: point.support.nativeParameter, edge: point.support.edge,
        referenceSign: -point.support.inwardSign, seamSide: point.support.seamSide },
      tangentLateral: point.T, tangentSupport: point.supportT, supportReference: point.R,
      targetInward: point.lateral.targetInward, storedInward: point.M,
      targetMinusStoredInward, targetMinusStoredInwardNormMmPerV, targetStoredPointFidelityClassification,
      target, stored, feasibility,
      targetStoredNormalChordDifference: target.normalChord && stored.normalChord ? sub(target.normalChord, stored.normalChord) : null,
      diagnosis: feasibility.classification === 'infeasible-with-fixed-target-and-D1-fidelity'
        ? 'target-field-already-incompatible-at-this-witness-with-fixed-D1-fidelity' as const
        : stored.normalChordClassification === 'outside-declared-criterion' && target.normalChordClassification === 'within-declared-criterion' &&
          targetStoredPointFidelityClassification === 'outside-declared-criterion' ? 'stored-field-departs-from-admissible-target-at-this-witness' as const
          : 'no-exclusive-cause-certified' as const }
  })
  return { status: 'saved-target-witness-diagnostic' as const,
    classification: points.some(p => p.feasibility.classification === 'infeasible-with-fixed-target-and-D1-fidelity')
      ? 'fixed-target-D1-fidelity-incompatible-with-normal-chord' as const : 'no-local-infeasibility-certified' as const,
    criteria: { maximumNormalChord, maximumD1FidelityMmPerV }, budgets: { ...evaluator.budgets, maxWitnesses },
    suppliedWitnessCount: witnesses.length, distinctPointCount: points.length, evaluatedPointCount: evaluator.getPointEvaluationCount(),
    normalizedPartition: evaluator.normalizedPartition, points,
    correspondence: 'exact-positive-affine-original-U-to-common-normalized-s' as const,
    targetConvention: 'supplied-inward-D1-coefficients-in-unchanged-lateral-U-basis' as const,
    suppliedWitnessesOnly: true as const, continuousCoverageClaimed: false as const,
    preparations: 0 as const, solves: 0 as const, candidateModified: false as const,
    nativeCadCertified: false as const, tubeAccepted: false as const }
}

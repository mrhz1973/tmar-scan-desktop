// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { createExperimentalCandidateJointPointEvaluator, evaluateExperimentalCandidateNativeJointPoint,
  measureExperimentalCandidateJointPoint, type ExperimentalCandidateSavedWitness } from '../experimentalCandidateJointPoint'
import { diagnoseExperimentalCandidateTargetWitnesses } from '../experimentalCandidateTargetWitness'
import { scalar, type V } from '../tangencyCoefficientIntervals'

function cylinder(dv: 1 | 5, z0: number, z1: number, periodScale = 1): Net {
  const k = .5522847498307936
  const xy = [[1, 0], [1, k], [k, 1], [0, 1], [-k, 1], [-1, k],
    [-1, 0], [-1, -k], [-k, -1], [0, -1], [k, -1], [1, -k]]
  const nv = dv + 1
  return { du: 3, dv, nu: 12, nv, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4].map(u => u * periodScale), mu: [3, 3, 3, 3, 3], kv: [0, 1], mv: [dv + 1, dv + 1],
    poles: xy.flatMap(([x, y]) => Array.from({ length: nv }, (_, v): Point => [x, y, z0 + (z1 - z0) * v / dv])),
    weights: Array<number>(12 * nv).fill(1) }
}
const witnesses: ExperimentalCandidateSavedWitness[] = [
  { cell: 0, localDomain: [0, .5], endpoint: 1 },
  { cell: 0, localDomain: [.5, 1], endpoint: 0 },
]
function request(targetTilt = .01, storedTilt = .01, maximumD1FidelityMmPerV = 1e-9) {
  const lateral = cylinder(5, -1, 0), support = cylinder(1, 0, 1, 7)
  for (let u = 0; u < lateral.nu; u++) lateral.poles[u * lateral.nv + 4][0] += storedTilt / 5
  return { lateral: { net: lateral, edge: 'V1' as const }, support: { net: support, edge: 'V0' as const },
    targetInward: Array.from({ length: lateral.nu }, (): Point => [targetTilt, 0, -1]), witnesses,
    maximumNormalChord: 1e-4, maximumD1FidelityMmPerV, maxCells: 64, maxWitnesses: 8 }
}

it.each(['V0', 'V1'] as const)('evaluates the new native point contract with explicit increasing maps and inward signs at support %s', edge => {
  const lateral = edge === 'V0' ? cylinder(5, -1, 0) : cylinder(5, 1, 2), support = cylinder(1, 0, 1, 7)
  const lateralEdge = edge === 'V0' ? 'V1' : 'V0', expectedSign = edge === 'V0' ? -1 : 1
  const before = structuredClone({ lateral, support })
  const point = evaluateExperimentalCandidateNativeJointPoint({ net: lateral, edge: lateralEdge }, { net: support, edge },
    { lateralU: .5, supportU: 3.5, lateralSide: 'right', supportSide: 'right' })
  expect(point.lateral.normalizedParameter).toEqual(point.support.normalizedParameter)
  expect(point.lateralInward[2][0]).toBeLessThan(expectedSign + 1e-12)
  expect(point.lateralInward[2][1]).toBeGreaterThan(expectedSign - 1e-12)
  expect(point.supportReference[2][0]).toBeLessThan(expectedSign + 1e-12)
  expect(point.supportReference[2][1]).toBeGreaterThan(expectedSign - 1e-12)
  expect(point.projectedNormalResidualAbs![1]).toBeLessThan(1e-10)
  expect(point.supportNormalResidualAbs![1]).toBeLessThan(1e-10)
  expect(point.correspondence).toBe('explicit-supplied-binary64-native-parameters')
  expect(measureExperimentalCandidateJointPoint(point).normalChordClassification).toBe('within-declared-criterion')
  expect({ lateral, support }).toEqual(before)
})

it('quantifies a target-driven saved witness and excludes every fixed-target D1-faithful local repair', () => {
  const input = request(), before = structuredClone(input)
  const result = diagnoseExperimentalCandidateTargetWitnesses(input), p = result.points[0]
  expect(result.suppliedWitnessCount).toBe(2)
  expect(result.distinctPointCount).toBe(1)
  expect(result.evaluatedPointCount).toBe(1)
  expect(p.sourceWitnessIndices).toEqual([0, 1])
  expect(p.target.normalChord![0]).toBeGreaterThan(1e-4)
  expect(p.stored.normalChord![0]).toBeGreaterThan(1e-4)
  expect(p.targetMinusStoredInwardNormMmPerV[1]).toBeLessThan(1e-9)
  expect(p.targetStoredPointFidelityClassification).toBe('within-declared-criterion')
  expect(p.feasibility.necessaryPointwiseD1ChangeLowerMmPerV).toBeGreaterThan(1e-9)
  expect(p.feasibility.anyAdmissibleNormalChordLower).toBeGreaterThan(1e-4)
  expect(p.feasibility.allAllowedPointPerturbationsRemainRegular).toBe(true)
  expect(result.classification).toBe('fixed-target-D1-fidelity-incompatible-with-normal-chord')
  expect(p.diagnosis).toBe('target-field-already-incompatible-at-this-witness-with-fixed-D1-fidelity')
  expect(result.continuousCoverageClaimed).toBe(false)
  expect(result.candidateModified).toBe(false)
  expect(input).toEqual(before)
})

it('distinguishes a stored inward error from a locally admissible target', () => {
  const result = diagnoseExperimentalCandidateTargetWitnesses(request(0, .01)), p = result.points[0]
  expect(p.target.normalChordClassification).toBe('within-declared-criterion')
  expect(p.stored.normalChordClassification).toBe('outside-declared-criterion')
  expect(p.targetMinusStoredInwardNormMmPerV[0]).toBeGreaterThan(.009)
  expect(p.targetStoredPointFidelityClassification).toBe('outside-declared-criterion')
  expect(p.feasibility.classification).toBe('not-excluded-by-local-bound')
  expect(p.diagnosis).toBe('stored-field-departs-from-admissible-target-at-this-witness')
})

it('does not turn an unexcluded fidelity ball into a feasibility PASS', () => {
  const result = diagnoseExperimentalCandidateTargetWitnesses(request(.01, .01, .1)), p = result.points[0]
  expect(p.target.normalChordClassification).toBe('outside-declared-criterion')
  expect(p.feasibility.classification).toBe('not-excluded-by-local-bound')
  expect(result.classification).toBe('no-local-infeasibility-certified')
  expect(p.feasibility.candidateConstructed).toBe(false)
  expect(result.solves).toBe(0)
  expect(result.nativeCadCertified).toBe(false)
  expect(result.tubeAccepted).toBe(false)
})

it('retains both historical normal residual bases and their maximum', () => {
  const v = (p: Point): V => p.map(scalar) as V
  const measured = measureExperimentalCandidateJointPoint({ T: v([1, 0, 0]), supportT: v([0, 1, 0]), M: v([0, 1, 1]), R: v([0, 0, 1]) })
  expect(measured.referenceAbsoluteNormalResidualMmPerV![0]).toBeGreaterThan(.99)
  expect(measured.referenceAbsoluteNormalResidualMmPerV![1]).toBeGreaterThanOrEqual(1)
  expect(measured.supportAbsoluteNormalResidualMmPerV![1]).toBeLessThan(1e-12)
  expect(measured.historicalMaximumAbsoluteNormalResidualMmPerV![0]).toBeGreaterThan(.99)
  expect(measured.residualIsContinuousAcceptanceGate).toBe(false)
})

it('keeps the two periodic seam limits distinct and refuses a native start with the left side', () => {
  const input = request(0, 0), evaluator = createExperimentalCandidateJointPointEvaluator(input.lateral, input.support)
  const start = evaluator.evaluateNative({ lateralU: 0, supportU: 0, lateralSide: 'right', supportSide: 'right' })
  const end = evaluator.evaluateNative({ lateralU: 4, supportU: 28, lateralSide: 'left', supportSide: 'left' })
  expect(start.lateral.seamSide).toBe('0-plus')
  expect(end.lateral.seamSide).toBe('1-minus')
  expect(start.lateral.normalizedParameter).not.toEqual(end.lateral.normalizedParameter)
  expect(() => evaluator.evaluateNative({ lateralU: 0, supportU: 0, lateralSide: 'left' })).toThrow(/requested-side-outside-domain/)
  const result = diagnoseExperimentalCandidateTargetWitnesses({ ...input, witnesses: [
    { cell: 0, localDomain: [0, 1], endpoint: 0 }, { cell: 3, localDomain: [0, 1], endpoint: 1 },
  ] })
  expect(result.distinctPointCount).toBe(2)
  expect(result.points.map(p => p.lateral.seamSide)).toEqual(['0-plus', '1-minus'])
})

it('refuses malformed target fields, witness addresses and exhausted finite point budgets', () => {
  const input = request(), before = structuredClone(input)
  expect(() => diagnoseExperimentalCandidateTargetWitnesses({ ...input, targetInward: input.targetInward.slice(1) })).toThrow(/dense-finite-target/)
  expect(() => diagnoseExperimentalCandidateTargetWitnesses({ ...input, witnesses: [{ cell: 0, localDomain: [0, .3], endpoint: 1 }] })).toThrow(/depth-12-dyadic/)
  expect(() => diagnoseExperimentalCandidateTargetWitnesses({ ...input, maxWitnesses: 0 })).toThrow(/saved-witness-budget/)
  const evaluator = createExperimentalCandidateJointPointEvaluator(input.lateral, input.support, { maxPointEvaluations: 1 })
  evaluator.evaluateNative({ lateralU: .5, supportU: 3.5 })
  expect(() => evaluator.evaluateNative({ lateralU: .5, supportU: 3.5 })).toThrow(/point-evaluation-budget/)
  expect(input).toEqual(before)
})

it('does not issue a fidelity feasibility certificate from a degenerate target normal', () => {
  const input = request(0, 0)
  input.targetInward = Array.from({ length: input.lateral.net.nu }, (): Point => [0, 1, 0])
  const result = diagnoseExperimentalCandidateTargetWitnesses({ ...input, witnesses: [{ cell: 0, localDomain: [0, 1], endpoint: 0 }] })
  expect(result.points[0].target.normalChord).toBeNull()
  expect(result.points[0].feasibility.classification).toBe('not-excluded-by-local-bound')
  expect(result.points[0].feasibility.necessaryPointwiseD1ChangeLowerMmPerV).toBeNull()
})

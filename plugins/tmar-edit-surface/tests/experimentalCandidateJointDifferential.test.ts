// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalCandidateJointDifferential, type ExperimentalCandidateJointCriteria } from '../experimentalCandidateJointDifferential'

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
const criteria: ExperimentalCandidateJointCriteria = { maximumPositionGapMm: 1e-6, maximumTangentChord: 1e-10,
  maximumNormalChord: 1e-4, minimumNativeTangentNorm: 1e-8, minimumTransverseNorm: 1e-8,
  minimumPositiveScale: .0625, maxCells: 64, maxDepth: 5, maxLeaves: 2048 }

it.each(['V0', 'V1'] as const)('certifies mixed V degree joins at central %s with increasing affine U maps and the correct inward signs', edge => {
  const central = cylinder(1, 0, 1, 7)
  const lateral = edge === 'V0' ? cylinder(5, -1, 0) : cylinder(5, 1, 2)
  const lateralEdge = edge === 'V0' ? 'V1' : 'V0'
  const before = structuredClone({ lateral, central })
  const result = boundExperimentalCandidateJointDifferential({ net: lateral, edge: lateralEdge }, { net: central, edge }, criteria)
  expect(result.classification).toBe('within-declared-joint-criteria')
  for (const metric of Object.values(result.criterionResults)) expect(metric.classification).toBe('within-declared-criterion')
  expect(result.maximumPositionGapUpper).toBeLessThan(1e-9)
  expect(result.minimumNativeTangentNormLower).toBeGreaterThan(1e-8)
  expect(result.minimumTransverseNormLower).toBeGreaterThan(1e-8)
  expect(result.minimumLambdaLower).toBeGreaterThan(.0625)
  expect(result.lateral.inwardSign).toBe(edge === 'V0' ? -1 : 1)
  expect(result.support.referenceSign).toBe(edge === 'V0' ? -1 : 1)
  expect(result.normalResidualIsAcceptanceGate).toBe(false)
  expect(result.nativeCadCertified).toBe(false)
  expect(result.exactG1Certified).toBe(false)
  expect({ lateral, central }).toEqual(before)
})

it('keeps position, tangent and normal criteria independent when only the selected inward derivative tilts', () => {
  const lateral = cylinder(5, -1, 0), central = cylinder(1, 0, 1)
  for (let u = 0; u < lateral.nu; u++) lateral.poles[u * lateral.nv + 4][0] += .04
  const result = boundExperimentalCandidateJointDifferential({ net: lateral, edge: 'V1' }, { net: central, edge: 'V0' }, criteria)
  expect(result.criterionResults.position.classification).toBe('within-declared-criterion')
  expect(result.criterionResults.tangentChord.classification).toBe('within-declared-criterion')
  expect(result.criterionResults.normalChord.classification).toBe('outside-declared-criterion')
  expect(result.criterionResults.normalChord.witnesses[0].reason).toBe('unit-normal-chord-exceeds-budget')
  expect(result.classification).toBe('outside-declared-joint-criteria')
})

it('proves a positive-scale violation even when position and unit normal chords are within budget', () => {
  const lateral = cylinder(5, -.01, 0), central = cylinder(1, 0, 1)
  const result = boundExperimentalCandidateJointDifferential({ net: lateral, edge: 'V1' }, { net: central, edge: 'V0' }, criteria)
  expect(result.criterionResults.position.classification).toBe('within-declared-criterion')
  expect(result.criterionResults.normalChord.classification).toBe('within-declared-criterion')
  expect(result.criterionResults.positiveScale.classification).toBe('outside-declared-criterion')
  expect(result.criterionResults.positiveScale.witnesses[0].reason).toBe('positive-scale-below-floor')
})

it('detects boundary translation independently from its unchanged tangent and normal fields', () => {
  const lateral = cylinder(5, -1, 0), central = cylinder(1, 0, 1)
  for (const p of lateral.poles) p[2] += .001
  const result = boundExperimentalCandidateJointDifferential({ net: lateral, edge: 'V1' }, { net: central, edge: 'V0' }, criteria)
  expect(result.criterionResults.position.classification).toBe('outside-declared-criterion')
  expect(result.criterionResults.tangentChord.classification).toBe('within-declared-criterion')
  expect(result.criterionResults.normalChord.classification).toBe('within-declared-criterion')
})

it('does not replace the native Su norm threshold with the norm of the normalized tangent', () => {
  const lateral = cylinder(5, -1, 0, 1e12), central = cylinder(1, 0, 1, 1e12)
  const result = boundExperimentalCandidateJointDifferential({ net: lateral, edge: 'V1' }, { net: central, edge: 'V0' }, { ...criteria, maxDepth: 0 })
  expect(result.criterionResults.nativeTangentNorm.classification).toBe('inconclusive')
  expect(result.minimumNativeTangentNormLower).toBeLessThan(1e-8)
  expect(result.classification).not.toBe('within-declared-joint-criteria')
})

it('retains nearly coincident normalized knots and refuses malformed budgets without source changes', () => {
  const lateral = cylinder(5, -1, 0), central = cylinder(1, 0, 1)
  central.ku[1] = 1 + Number.EPSILON
  const result = boundExperimentalCandidateJointDifferential({ net: lateral, edge: 'V1' }, { net: central, edge: 'V0' }, criteria)
  expect(result.checkedCells).toBe(5)
  expect(result.maximumPositionGapUpper).toBeLessThan(1e-6)
  expect(result.classification).toBe('within-declared-joint-criteria')
  expect(() => boundExperimentalCandidateJointDifferential({ net: lateral, edge: 'V1' }, { net: central, edge: 'V0' }, { ...criteria, maxDepth: 13 }))
    .toThrow(/subdivision-budget/)
  expect(() => boundExperimentalCandidateJointDifferential({ net: lateral, edge: 'V1' }, { net: central, edge: 'V0' }, { ...criteria, maximumNormalChord: 1 }))
    .toThrow(/invalid-criteria/)
})

it('reports no signed lambda lower bound from a negative numerator hull', () => {
  const lateral = cylinder(5, 1, 0), central = cylinder(1, 0, 1)
  const result = boundExperimentalCandidateJointDifferential({ net: lateral, edge: 'V1' }, { net: central, edge: 'V0' }, criteria)
  expect(result.criterionResults.normalOrientation.classification).toBe('outside-declared-criterion')
  expect(result.criterionResults.positiveScale.classification).toBe('outside-declared-criterion')
  expect(result.minimumLambdaLower).toBeNull()
})

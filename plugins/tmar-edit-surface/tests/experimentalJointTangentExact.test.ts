// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { certifyExperimentalJointTangentExact } from '../experimentalJointTangentExact'

// Four exact straight cubic segments. Their C0 corners deliberately keep
// separate one-sided tangents; no cross-span G1 property is required here.
function square(dv: 1 | 5, scale = 1, origin = 0): Net {
  const xy = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2],
    [3, 3], [2, 3], [1, 3], [0, 3], [0, 2], [0, 1]]
  const nv = dv + 1
  return { du: 3, dv, nu: 12, nv, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4].map(u => origin + scale * u), mu: [3, 3, 3, 3, 3], kv: [0, 1], mv: [dv + 1, dv + 1],
    poles: xy.flatMap(([x, y]) => Array.from({ length: nv }, (_, j): Point => [x, y, j])), weights: Array<number>(12 * nv).fill(1) }
}
const criteria = { maximumTangentChord: 1e-10, minimumNativeTangentNorm: 1e-8, maxCells: 64, maxDepth: 3, maxLeaves: 512 }
const analyze = (left: Net, right: Net, changes = {}) => certifyExperimentalJointTangentExact(
  { net: left, edge: 'V1' }, { net: right, edge: 'V0' }, { ...criteria, ...changes })

it('certifies zero chord across different V degrees and affine U domains, with exact original-U norm floors', () => {
  const left = square(5), right = square(1, 8, 100), before = structuredClone({ left, right })
  const result = analyze(left, right)
  expect(result.classification).toBe('within-declared-tangent-chord')
  expect(result.totalCommonCells).toBe(4)
  expect(result.checkedLeaves).toBe(4)
  expect(result.maximumTangentChordUpper).toBe(0)
  expect(result.minimumNativeTangentNormLower).toEqual([3, 3 / 8])
  expect(result.orientationPrerequisiteEstablished).toBe(true)
  expect(result.nativeFloorPrerequisiteEstablished).toEqual([true, true])
  expect(result.coverageComplete).toBe(true)
  expect(result.otherJointCriteriaRequalified).toBe(false)
  expect(result.nativeCadCertified).toBe(false)
  expect(result.tubeAccepted).toBe(false)
  expect({ left, right }).toEqual(before)
})

it('retains exact cancellation through a simple inserted U knot without requiring a common pole basis', () => {
  const left = square(5), right = square(1)
  const xy = [[0, 0], [.5, 0], [1.5, 0], [2.5, 0], [3, 0], [3, 1], [3, 2],
    [3, 3], [2, 3], [1, 3], [0, 3], [0, 2], [0, 1]]
  right.nu = 13
  right.ku = [0, .5, 1, 2, 3, 4]
  right.mu = [3, 1, 3, 3, 3, 3]
  right.poles = xy.flatMap(([x, y]) => [[x, y, 0], [x, y, 1]] as Point[])
  right.weights = Array<number>(26).fill(1)
  const result = analyze(left, right)
  expect(result.classification).toBe('within-declared-tangent-chord')
  expect(result.totalCommonCells).toBe(5)
  expect(result.maximumTangentChordUpper).toBe(0)
  expect(result.minimumNativeTangentNormLower).toEqual([3, 3])
})

it('certifies a nonzero oriented chord below the unchanged 1e-10 threshold', () => {
  const left = square(5), right = square(1), slope = 2 ** -36
  for (const p of right.poles) {
    const [x, y] = p
    p[0] = x - slope * y; p[1] = slope * x + y
  }
  const result = analyze(left, right)
  expect(result.classification).toBe('within-declared-tangent-chord')
  expect(result.maximumTangentChordUpper).toBe(slope)
  expect(result.maximumTangentChordUpper).toBeLessThan(1e-10)
  expect(result.witnesses).toEqual([])
})

it('produces exact violating witnesses above the chord threshold, without testing position or normal gates', () => {
  const left = square(5), right = square(1), slope = 2 ** -32
  for (const p of right.poles) {
    const [x, y] = p
    p[0] = x - slope * y; p[1] = slope * x + y
  }
  const result = analyze(left, right)
  expect(result.classification).toBe('outside-declared-tangent-chord')
  expect(result.orientationPrerequisiteEstablished).toBe(true)
  expect(result.witnesses.some(w => w.reason === 'negative-exact-chord-margin')).toBe(true)
  expect(result.witnesses.every(w => BigInt(w.exactDot.numerator) > 0n && BigInt(w.exactChordMargin.numerator) < 0n)).toBe(true)
})

it('rejects antiparallel tangents even though their squared cross product is exactly zero', () => {
  const left = square(5), right = square(1)
  for (const p of right.poles) { p[0] = -p[0]; p[1] = -p[1] }
  const result = analyze(left, right)
  expect(result.classification).toBe('outside-declared-tangent-chord')
  expect(result.orientationPrerequisiteEstablished).toBe(false)
  expect(result.witnesses[0].reason).toBe('nonpositive-dot-with-nonzero-tangents')
  expect(BigInt(result.witnesses[0].exactChordMargin.numerator)).toBeGreaterThan(0n)
})

it('keeps a native Su floor failure distinct from a normalized tangent chord certificate', () => {
  const result = analyze(square(5, 1e12), square(1, 1e12))
  expect(result.classification).toBe('within-declared-tangent-chord')
  expect(result.maximumTangentChordUpper).toBe(0)
  expect(result.nativeFloorPrerequisiteEstablished).toEqual([false, false])
  expect(Math.max(...result.minimumNativeTangentNormLower)).toBeLessThan(criteria.minimumNativeTangentNorm)
  expect(result.nativeFloorIsChordAcceptanceThreshold).toBe(false)
})

it('keeps distinct nearly coincident knots and confines selected-cell conclusions to their explicit coverage', () => {
  const left = square(5), right = square(1)
  right.ku[1] = 1 + Number.EPSILON
  const result = analyze(left, right, { selectedCells: [1] })
  expect(result.totalCommonCells).toBe(5)
  expect(result.selectedCells).toEqual([1])
  expect(result.checkedCells).toBe(1)
  expect(result.coverageComplete).toBe(false)
  expect(result.classification).toBe('outside-declared-tangent-chord')
  expect(result.witnesses.every(w => w.cell === 1)).toBe(true)
  expect(result.witnesses[0].reason).toBe('nonpositive-dot-with-nonzero-tangents')
})

it('does not underflow a positive chord threshold whose square is below binary64 range', () => {
  const result = analyze(square(5), square(1), { maximumTangentChord: 2 ** -540 })
  expect(result.classification).toBe('within-declared-tangent-chord')
  expect(result.maximumTangentChordUpper).toBe(0)
  expect(BigInt(result.minimumExactChordMarginCoefficient.numerator)).toBeGreaterThan(0n)
})

it('refuses duplicate targets and exhausted arithmetic budgets without modifying the inputs', () => {
  const left = square(5), right = square(1), before = structuredClone({ left, right })
  expect(() => analyze(left, right, { selectedCells: [0, 0] })).toThrow(/selected-cells/)
  expect(() => analyze(left, right, { maxOperations: 1 })).toThrow(/operation-budget/)
  expect(() => analyze(left, right, { maxDepth: 13 })).toThrow(/proof-budget/)
  expect({ left, right }).toEqual(before)
})

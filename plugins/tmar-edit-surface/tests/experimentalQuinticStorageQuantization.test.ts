// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeExperimentalQuinticStorageQuantization,
  type ExperimentalQuinticStorageQuantizationRequest } from '../experimentalQuinticStorageQuantization'

function fixture(edge: 'V0' | 'V1' = 'V0', originX = 0): ExperimentalQuinticStorageQuantizationRequest {
  const nu = 4, nv = 6
  const original: Net = { nu, nv, du: 3, dv: 5, ku: [0, 1, 2], mu: [3, 1, 3], kv: [0, 5], mv: [6, 6],
    periodic: [1, 0], rational: [0, 0], weights: Array<number>(nu * nv).fill(1),
    poles: Array.from({ length: nu }, (_, u) => Array.from({ length: nv }, (): Point => [originX, u, 0])).flat() }
  const baseInward = Array.from({ length: nu }, (): Point => [0, 0, 0])
  const targetInward = structuredClone(baseInward); targetInward[1] = [5, 0, 0]
  return { original, savedCandidate: structuredClone(original), edge, uIndex: 1, baseInward, targetInward,
    maximumChange: 5, derivativeTolerance: 1e-9, secondDerivativeTolerance: 1e-9,
    search: { maxFirstStepsPerAxis: 4, maxSecondStepsPerAxis: 1, maxTrials: 4096 } }
}

function localIndices(request: ExperimentalQuinticStorageQuantizationRequest) {
  const start = request.uIndex * request.original.nv
  return request.edge === 'V0' ? { first: start + 1, second: start + 2 } :
    { first: start + request.original.nv - 2, second: start + request.original.nv - 3 }
}

function setLocalX(request: ExperimentalQuinticStorageQuantizationRequest, b: number, c: number) {
  const { first, second } = localIndices(request)
  request.savedCandidate.poles[first][0] = b
  request.savedCandidate.poles[second][0] = c
}

it.each(['V0', 'V1'] as const)('proposes a single adjacent stored pole at %s without altering inputs or target', edge => {
  const request = fixture(edge), nextFive = 5 + 2 ** -50
  setLocalX(request, nextFive, 10)
  const frozen = structuredClone(request)
  const result = proposeExperimentalQuinticStorageQuantization(request)
  expect(result.before.targetChange.status).toBe('within-coefficient-cap')
  expect(result.before.storedChange.squaredMarginSign).toBe('negative')
  expect(result.before.targetFidelityD1.status).toBe('within-residual-bound')
  expect(result.status).toBe('local-storage-proposal')
  expect(result.proposal!.first).toEqual([5, 1, 0])
  expect(result.proposal!.second).toEqual([10, 1, 0])
  expect(result.proposal!.patch).toEqual([{ index: localIndices(request).first, row: 'first', before: [nextFive, 1, 0], after: [5, 1, 0] }])
  expect(result.proposal!.evidence.storedChange.exactSquaredMarginToCap).toEqual({ numerator: '0', denominator: '1' })
  expect(result.proposal!.evidence.targetFidelityD1.normInterval).toEqual({ lower: 0, upper: 0 })
  expect(result.proposal!.evidence.sourceChangeD2.normInterval).toEqual({ lower: 0, upper: 0 })
  expect(result.proposal!.firstUlpStepsTowardSource).toEqual([1, 0, 0])
  expect(result).toMatchObject({ candidateMaterialized: false, inputsMutated: false, globalCoefficientCapCertified: false,
    fullRequalificationRequired: true, joint74And75NormalChordCertified: false, nativeGateSatisfied: false })
  expect(request).toEqual(frozen)
  expect(result).not.toHaveProperty('net')
})

it('retains a subnormal cap violation that Math.hypot rounds away, with no epsilon', () => {
  const request = fixture(), { first, second } = localIndices(request)
  request.original.poles[first] = [0, 0, 0]
  request.original.poles[second] = [0, 0, 0]
  request.original.poles[request.uIndex * 6] = [0, 0, 0]
  request.savedCandidate = structuredClone(request.original)
  request.savedCandidate.poles[first] = [3, 4, Number.MIN_VALUE]
  request.savedCandidate.poles[second] = [6, 8, 2 * Number.MIN_VALUE]
  request.targetInward = request.targetInward.map((p, u): Point => u === request.uIndex ? [3, 4, 0] : [...p])
  expect(Math.hypot(3, 4, Number.MIN_VALUE)).toBe(5)
  const result = proposeExperimentalQuinticStorageQuantization(request)
  expect(result.before.storedChange.squaredMarginSign).toBe('negative')
  expect(result.status).toBe('local-storage-proposal')
  expect(result.proposal!.first).toEqual([3, 4, 0])
  expect(result.proposal!.evidence.storedChange.squaredMarginSign).toBe('zero')
})

it('keeps D1 target fidelity independent of a passing cap when the coordinate grid cannot resolve the target', () => {
  const origin = 2 ** 53, request = fixture('V0', origin)
  setLocalX(request, origin + 2, origin + 4)
  request.targetInward = request.targetInward.map((p, u): Point => u === request.uIndex ? [1, 0, 0] : [...p])
  const result = proposeExperimentalQuinticStorageQuantization(request)
  expect(result.before.storedChange.status).toBe('within-coefficient-cap')
  expect(result.before.targetFidelityD1.status).toBe('residual-bound-exceeded')
  expect(result.status).toBe('no-local-storage-proposal')
  expect(result.reason).toBe('finite-neighborhood-exhausted')
  expect(result.search.searchExhaustionDoesNotProveImpossibility).toBe(true)
  expect(result.search.counts.rejectedD1Fidelity).toBeGreaterThan(0)
  expect(result.proposal).toBeNull()
})

it('requires a separate C change when exact D2 is requested, and honors a C lock', () => {
  const request = fixture(), nextFive = 5 + 2 ** -50, { second } = localIndices(request)
  setLocalX(request, nextFive, 2 * nextFive)
  request.secondDerivativeTolerance = 0
  request.search.maxFirstStepsPerAxis = 1
  const locked = proposeExperimentalQuinticStorageQuantization({ ...request, lockIndices: [second] })
  expect(locked.before.sourceChangeD2.normInterval).toEqual({ lower: 0, upper: 0 })
  expect(locked.status).toBe('no-local-storage-proposal')
  expect(locked.search.counts.rejectedD2Change).toBeGreaterThan(0)
  const unlocked = proposeExperimentalQuinticStorageQuantization(request)
  expect(unlocked.status).toBe('local-storage-proposal')
  expect(unlocked.proposal!.patch.map(p => p.row)).toEqual(['first', 'second'])
  expect(unlocked.proposal!.second[0]).toBe(10)
  expect(unlocked.proposal!.evidence.sourceChangeD2.exactL1Norm).toEqual({ numerator: '0', denominator: '1' })
})

it('uses both native endpoint widths for D2 instead of assuming the second row spread is two', () => {
  const request = fixture(), nu = request.original.nu, nv = 7
  request.original = { ...request.original, nv, kv: [0, 5, 15], mv: [6, 1, 6],
    weights: Array<number>(nu * nv).fill(1),
    poles: Array.from({ length: nu }, (_, u) => Array.from({ length: nv }, (): Point => [0, u, 0])).flat() }
  request.savedCandidate = structuredClone(request.original)
  const nextFive = 5 + 2 ** -50
  setLocalX(request, nextFive, 4 * nextFive)
  request.secondDerivativeTolerance = 0
  request.search.maxFirstStepsPerAxis = 1
  const result = proposeExperimentalQuinticStorageQuantization(request)
  expect(result.nativeWidthsExact).toEqual({ h1: { numerator: '5', denominator: '1' }, h2: { numerator: '15', denominator: '1' } })
  expect(result.before.sourceChangeD2.exactL1Norm.numerator).toBe('0')
  expect(result.status).toBe('local-storage-proposal')
  expect(result.proposal!.first[0]).toBe(5)
  expect(result.proposal!.second[0]).toBe(20)
  expect(result.proposal!.evidence.sourceChangeD2.exactL1Norm.numerator).toBe('0')
})

it('forms the native knot width exactly when its rounded subtraction would conceal excess', () => {
  const request = fixture()
  request.original.kv = [-0.1, 0.3]
  request.savedCandidate.kv = [-0.1, 0.3]
  setLocalX(request, 0.4, 0.8)
  expect(5 / (0.3 - -0.1) * 0.4).toBe(5)
  const result = proposeExperimentalQuinticStorageQuantization(request)
  expect(result.before.storedChange.squaredMarginSign).toBe('negative')
  expect(result.before.targetFidelityD1.status).toBe('within-residual-bound')
  expect(result.status).toBe('local-storage-proposal')
  expect(result.proposal!.first[0]).toBeLessThan(0.4)
  expect(result.proposal!.evidence.storedChange.status).toBe('within-coefficient-cap')
})

it('distinguishes bounded search exhaustion from impossibility and does not move C to a distant ideal', () => {
  const request = fixture()
  setLocalX(request, 5 + 2 ** -50, 10)
  const budget = proposeExperimentalQuinticStorageQuantization({ ...request, search: { ...request.search, maxTrials: 1 } })
  expect(budget.reason).toBe('trial-budget-exhausted')
  expect(budget.search.counts.evaluatedPairs).toBe(1)
  expect(budget.proposal).toBeNull()
  const noFirstNeighbors = proposeExperimentalQuinticStorageQuantization({ ...request,
    search: { ...request.search, maxFirstStepsPerAxis: 0 } })
  expect(noFirstNeighbors.reason).toBe('finite-neighborhood-exhausted')
  expect(noFirstNeighbors.search.searchExhaustionDoesNotProveImpossibility).toBe(true)
  setLocalX(request, 5, 0)
  const farC = proposeExperimentalQuinticStorageQuantization({ ...request, search: { ...request.search, maxFirstStepsPerAxis: 0 } })
  expect(farC.status).toBe('no-local-storage-proposal')
  expect(farC.reason).toBe('finite-neighborhood-exhausted')
  expect(farC.proposal).toBeNull()
})

it('does not promote a local patch to a cap certificate for untouched U coefficients', () => {
  const request = fixture()
  setLocalX(request, 5 + 2 ** -50, 10)
  request.savedCandidate.poles[2 * request.original.nv + 1][0] = 100
  request.targetInward = request.targetInward.map((p, u): Point => u === 2 ? [100, 0, 0] : [...p])
  const result = proposeExperimentalQuinticStorageQuantization(request)
  expect(result.status).toBe('local-storage-proposal')
  expect(result.globalCoefficientCapCertified).toBe(false)
  expect(result.uIndex).toBe(1)
  expect(result.proposal!.patch.every(p => Math.floor(p.index / request.original.nv) === 1)).toBe(true)
})

it('refuses a moved boundary, invalid limits/budgets, changed basis and nonfinite local targets', () => {
  const request = fixture(), boundary = request.uIndex * request.original.nv
  const moved = structuredClone(request)
  moved.savedCandidate.poles[boundary][0] = Number.MIN_VALUE
  expect(() => proposeExperimentalQuinticStorageQuantization(moved)).toThrow(/boundary-must-stay-bitwise-fixed/)
  expect(() => proposeExperimentalQuinticStorageQuantization({ ...request, derivativeTolerance: NaN })).toThrow(/limits/)
  expect(() => proposeExperimentalQuinticStorageQuantization({ ...request,
    search: { ...request.search, maxFirstStepsPerAxis: 5 } })).toThrow(/budget/)
  const changedBasis = structuredClone(request); changedBasis.savedCandidate.kv[1] = 6
  expect(() => proposeExperimentalQuinticStorageQuantization(changedBasis)).toThrow(/same-basis/)
  const invalidTarget = structuredClone(request)
  invalidTarget.targetInward = invalidTarget.targetInward.map((p, u): Point => u === request.uIndex ? [Infinity, 0, 0] : [...p])
  expect(() => proposeExperimentalQuinticStorageQuantization(invalidTarget)).toThrow(/local-bundle-coefficients/)
})

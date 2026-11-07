// SPDX-License-Identifier: AGPL-3.0-only
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'
import { add, divide, scalar } from './tangencyCoefficientIntervals'
import { factorExperimentalPeriodicMobileSeamAugmentedQr } from './experimentalPeriodicMobileSeamAugmentedQr'
import type { SparseRow } from './experimentalPeriodicMobileSeamLeastSquares'

type Vector = readonly [number, number, number]
const zero: Vector = [0, 0, 0]
const point = (values: Float64Array, i: number): Vector => [values[i], values[i + 1], values[i + 2]]
const infinityNorm = (values: Float64Array) => values.reduce((max, value) => Math.max(max, Math.abs(value)), 0)

export interface ExperimentalPeriodicMobileSeamAdmmBudget {
  penalty: number
  maxIterations: number
  maxFactorUpdates: number
  relativeSplitTolerance: number
  relativeGapTolerance: number
}

/** Exact Euclidean cap comparison for the two represented binary64 vectors. */
export function experimentalCoefficientChangeWithinCap(before: Vector, after: Vector, cap: number) {
  if (![...before, ...after, cap].every(Number.isFinite) || cap < 0) return false
  const limit = binary64Units(cap)
  return ([0, 1, 2] as const).reduce((sum, axis) => {
    const change = binary64Units(after[axis]) - binary64Units(before[axis])
    return sum + change * change
  }, 0n) <= limit * limit
}

/**
 * ADMM on the sampled ridge objective with Euclidean balls on the free
 * derivative columns. Reuse one augmented QR for every x update. Split
 * residuals use the normalized derivative scale; the dual residual is
 * further divided by max(1, ||Aᵀb||∞) in that scale. The numerical gap is
 * relative to the initial objective and is evaluated on the original
 * sampled objective, including the dependent seam ridge.
 */
export function solveExperimentalPeriodicMobileSeamConstrained(
  rows: readonly SparseRow[], freeColumns: number, previousWeight: number, nextWeight: number,
  ridge: number, cap: number, budget: ExperimentalPeriodicMobileSeamAdmmBudget,
) {
  const size = 3 * freeColumns, last = size - 3
  const evidence: { iterations: number; factorUpdates: number; initialObjective?: number; objective?: number;
    relativeOptimalityGap?: number; primalResidual?: number; dualResidual?: number; maxSampleResidual?: number } =
    { iterations: 0, factorUpdates: 0 }
  const stop = (reason: 'invalid-input' | 'arithmetic-refused' | 'iteration-budget' | 'factor-budget' | 'coefficient-cap-unverified' | 'represented-gap-unverified') =>
    ({ status: 'inconclusive' as const, reason, evidence })
  const invalidRow = (row: SparseRow) => {
    if (!row || !Number.isFinite(row.value) || !Array.isArray(row.entries) || row.entries.length > 18) return true
    const entries: SparseRow['entries'] = row.entries
    return Array.from(entries).some(entry => !entry || !Number.isInteger(entry.column) || entry.column < 0 || entry.column >= size ||
      !Number.isFinite(entry.weight)) || new Set(entries.map(entry => entry.column)).size !== entries.length
  }
  if (!budget || !Number.isInteger(freeColumns) || freeColumns < 2 || freeColumns > 256 || !Array.isArray(rows) ||
      rows.length < 1 || rows.length > 4096 || Array.from(rows).some(invalidRow) ||
      ![previousWeight, nextWeight, ridge, budget.relativeSplitTolerance, budget.relativeGapTolerance]
        .every(x => Number.isFinite(x) && x > 0 && x <= 1) ||
      !Number.isFinite(cap) || cap < 0 || !Number.isFinite(budget.penalty) || budget.penalty <= 0 ||
      !Number.isInteger(budget.maxIterations) || budget.maxIterations < 1 || budget.maxIterations > 8000 ||
      !Number.isInteger(budget.maxFactorUpdates) || budget.maxFactorUpdates < 1 || budget.maxFactorUpdates > 12_000_000)
    return stop('invalid-input')
  const input: readonly SparseRow[] = rows
  const { penalty, maxIterations, maxFactorUpdates, relativeSplitTolerance, relativeGapTolerance } = budget
  try {
    const scale = Math.max(cap, ...input.map(row => Math.abs(row.value))) || 1
    const samples = input.map(({ entries, value }) => ({ entries, value: value / scale }))
    if (samples.some(({ value }, i) => value === 0 && input[i].value !== 0)) return stop('arithmetic-refused')
    const normalizedCap = cap / scale
    const weightSum = add(scalar(previousWeight), scalar(nextWeight))[1]
    // Keep the working balls inside the cap even if the represented seam
    // weights sum to more than one. Final targets are checked exactly.
    const radius = cap === 0 ? 0 : divide(scalar(normalizedCap), scalar(Math.max(1, weightSum)))[0] * (1 - 8 * Number.EPSILON)
    if (!(radius > 0) && cap > 0) return stop('arithmetic-refused')

    const evaluate = (x: Float64Array) => {
      const gradient = x.map(value => ridge * value)
      let objective = gradient.reduce((sum, value, i) => sum + 0.5 * x[i] * value, 0), maxSampleResidual = 0
      for (let axis = 0; axis < 3; axis++) {
        const seam = nextWeight * x[axis] + previousWeight * x[last + axis]
        objective += 0.5 * ridge * seam ** 2
        gradient[axis] += ridge * nextWeight * seam
        gradient[last + axis] += ridge * previousWeight * seam
      }
      for (const { entries, value } of samples) {
        const residual = entries.reduce((sum, { column, weight }) => sum + weight * x[column], -value)
        objective += 0.5 * residual ** 2
        maxSampleResidual = Math.max(maxSampleResidual, Math.abs(residual))
        for (const { column, weight } of entries) gradient[column] += weight * residual
      }
      return { objective, gradient, maxSampleResidual }
    }
    let z = new Float64Array(size)
    const initial = evaluate(z), initialObjective = initial.objective
    if (!Number.isFinite(initialObjective) || !initial.gradient.every(Number.isFinite) ||
        (initialObjective === 0 && samples.some(row => row.value !== 0))) return stop('arithmetic-refused')
    evidence.initialObjective = initialObjective * scale * scale
    if (!Number.isFinite(evidence.initialObjective) || (evidence.initialObjective === 0 && initialObjective !== 0)) return stop('arithmetic-refused')
    const report = (x: Float64Array, evaluated: ReturnType<typeof evaluate>) => {
      let gap = 0
      for (let i = 0; i < size; i += 3) {
        const g = point(evaluated.gradient, i)
        gap += Math.max(0, normalizedCap * Math.hypot(...g) + g[0] * x[i] + g[1] * x[i + 1] + g[2] * x[i + 2])
      }
      evidence.relativeOptimalityGap = initialObjective === 0 && gap === 0 ? 0 : gap / initialObjective
      evidence.objective = evaluated.objective * scale * scale
      evidence.maxSampleResidual = evaluated.maxSampleResidual * scale
      return [evidence.relativeOptimalityGap, evidence.objective, evidence.maxSampleResidual].every(Number.isFinite)
    }
    if (!report(z, initial)) return stop('arithmetic-refused')
    if (evidence.relativeOptimalityGap === 0) {
      if (cap !== 0 && initial.gradient.some(value => value !== 0)) return stop('arithmetic-refused')
      evidence.primalResidual = evidence.dualResidual = 0
      return { status: 'solved' as const, changes: z, evidence }
    }

    // A zero right-hand side is sufficient for this factorization: ADMM
    // uses only Rᵀ/R to solve the varying normal-equation right-hand sides.
    const factor = factorExperimentalPeriodicMobileSeamAugmentedQr(samples.map(({ entries }) => ({ entries, value: 0 })),
      size, 1, previousWeight, nextWeight, ridge, maxFactorUpdates, penalty)
    evidence.factorUpdates = factor.updates
    if (factor.status !== 'factored') return stop(factor.reason)
    const rhs = initial.gradient.map(value => -value), dualScale = Math.max(1, infinityNorm(rhs))
    const dual = new Float64Array(size)
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      evidence.iterations = iteration
      const x = factor.solveNormal(rhs.map((value, i) => value + penalty * (z[i] - dual[i])))
      if (!x) return stop('arithmetic-refused')
      const relaxed = x.map((value, i) => value + 0.6 * (value - z[i]))
      const next = relaxed.map((value, i) => value + dual[i])
      for (let i = 0; i < size; i += 3) {
        const norm = Math.hypot(...point(next, i))
        if (!Number.isFinite(norm)) return stop('arithmetic-refused')
        if (norm > radius) for (let axis = 0; axis < 3; axis++) next[i + axis] *= radius / norm
      }
      let primal = 0, dualResidual = 0
      for (let i = 0; i < size; i++) {
        primal = Math.max(primal, Math.abs(x[i] - next[i]))
        dualResidual = Math.max(dualResidual, Math.abs(next[i] - z[i]))
        dual[i] += relaxed[i] - next[i]
      }
      z = next
      evidence.primalResidual = primal
      evidence.dualResidual = penalty * dualResidual / dualScale
      if (![primal, evidence.dualResidual].every(Number.isFinite)) return stop('arithmetic-refused')
      const splitReady = primal <= relativeSplitTolerance && evidence.dualResidual <= relativeSplitTolerance
      if (!splitReady && iteration !== maxIterations) continue
      if (!report(z, evaluate(z))) return stop('arithmetic-refused')
      if (splitReady && evidence.relativeOptimalityGap! <= relativeGapTolerance) {
        const changes = z.map(value => value * scale)
        for (let i = 0; i < size; i += 3) if (!experimentalCoefficientChangeWithinCap(zero, point(changes, i), cap))
          return stop('coefficient-cap-unverified')
        const atSeam = (axis: number) => nextWeight * changes[axis] + previousWeight * changes[last + axis]
        if (!experimentalCoefficientChangeWithinCap(zero, [atSeam(0), atSeam(1), atSeam(2)], cap))
          return stop('coefficient-cap-unverified')
        const represented = changes.map(value => value / scale)
        if (!report(represented, evaluate(represented))) return stop('arithmetic-refused')
        if (evidence.relativeOptimalityGap! > relativeGapTolerance) return stop('represented-gap-unverified')
        return { status: 'solved' as const, changes, evidence }
      }
    }
    return stop('iteration-budget')
  } catch { return stop('arithmetic-refused') }
}

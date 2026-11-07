// SPDX-License-Identifier: AGPL-3.0-only
import type { SparseRow } from './experimentalPeriodicMobileSeamLeastSquares'

/** Streaming Givens QR of the data rows and the ridge rows, without forming AᵀA. */
export function factorExperimentalPeriodicMobileSeamAugmentedQr(rows: readonly SparseRow[], size: number,
  scale: number, previousWeight: number, nextWeight: number, ridge: number, maxUpdates: number,
  additionalDiagonalRidge = 0,
) {
  const rootRidge = Math.sqrt(ridge)
  const diagonal = new Float64Array(size).fill(Math.sqrt(ridge + additionalDiagonalRidge)), rhs = new Float64Array(size)
  const upper = Array.from({ length: size }, () => new Map<number, number>())
  let updates = 0
  const insert = (row: Map<number, number>, value: number) => {
    // Each nonzero in the incoming row is eliminated against the matching
    // triangular row, keeping fill bounded by the caller's work cap.
    for (let column = 0; column < size && row.size > 0; column++) {
      const entry = row.get(column)
      if (entry === undefined) continue
      row.delete(column)
      const tail = upper[column]
      const rotationColumns = new Set([...tail.keys(), ...row.keys()])
      const work = 1 + rotationColumns.size
      if (work > maxUpdates - updates) return 'factor-budget' as const
      updates += work
      const pivot = Math.hypot(diagonal[column], entry), cosine = diagonal[column] / pivot, sine = entry / pivot
      if (!Number.isFinite(pivot) || !(pivot > 0) || sine === 0) return 'arithmetic-refused' as const
      diagonal[column] = pivot
      for (const j of rotationColumns) {
        const a = tail.get(j) ?? 0, b = row.get(j) ?? 0
        const top = cosine * a + sine * b, bottom = cosine * b - sine * a
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) return 'arithmetic-refused' as const
        if (top === 0) tail.delete(j)
        else tail.set(j, top)
        if (bottom === 0) row.delete(j)
        else row.set(j, bottom)
      }
      const top = cosine * rhs[column] + sine * value
      value = cosine * value - sine * rhs[column]
      if (!Number.isFinite(top) || !Number.isFinite(value)) return 'arithmetic-refused' as const
      rhs[column] = top
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    const next = rootRidge * nextWeight, previous = rootRidge * previousWeight
    if (!(next > 0 && previous > 0)) return { status: 'inconclusive' as const, reason: 'arithmetic-refused' as const, updates }
    const reason = insert(new Map([[axis, next], [size - 3 + axis, previous]]), 0)
    if (reason) return { status: 'inconclusive' as const, reason, updates }
  }
  for (const { entries, value } of rows) {
    const reason = insert(new Map(entries.filter(entry => entry.weight !== 0).map(({ column, weight }) => [column, weight])), value / scale)
    if (reason) return { status: 'inconclusive' as const, reason, updates }
  }
  const solveUpper = (right: Float64Array) => {
    const solution = new Float64Array(size)
    for (let i = size - 1; i >= 0; i--) {
      let value = right[i]
      for (const [j, weight] of upper[i]) value -= weight * solution[j]
      solution[i] = value / diagonal[i]
      if (!Number.isFinite(solution[i]) || (solution[i] === 0 && value !== 0)) return undefined
    }
    return solution
  }
  const solution = solveUpper(rhs)
  if (!solution) return { status: 'inconclusive' as const, reason: 'arithmetic-refused' as const, updates }
  const solveNormal = (right: Float64Array) => {
    if (right.length !== size) return undefined
    const transformed = right.slice()
    for (let i = 0; i < size; i++) {
      const value = transformed[i], divided = value / diagonal[i]
      if (!Number.isFinite(divided) || (divided === 0 && value !== 0)) return undefined
      transformed[i] = divided
      for (const [j, weight] of upper[i]) transformed[j] -= weight * divided
    }
    return solveUpper(transformed)
  }
  return { status: 'factored' as const, solution, solveNormal, updates }
}

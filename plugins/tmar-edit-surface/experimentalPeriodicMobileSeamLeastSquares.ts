// SPDX-License-Identifier: AGPL-3.0-only
export type SparseRow = { entries: readonly { column: number; weight: number }[]; value: number }

const dot = (a: Float64Array, b: Float64Array) => a.reduce((sum, value, i) => sum + value * b[i], 0)
const infinityNorm = (a: Float64Array) => a.reduce((max, value) => Math.max(max, Math.abs(value)), 0)

/** Diagonally preconditioned iteration on the regularized normal equations. */
export function solveExperimentalPeriodicMobileSeamLeastSquares(
  rows: readonly SparseRow[], freeColumns: number, previousWeight: number, nextWeight: number,
  regularization: number, maxIterations: number, relativeTolerance: number,
) {
  const size = 3 * freeColumns, last = size - 3
  const refused = (reason: 'invalid-input' | 'iteration-budget' | 'arithmetic-refused', iterations: number) =>
    ({ status: 'inconclusive' as const, reason, iterations })
  const invalidRow = (row: SparseRow) => {
    if (!row || !Number.isFinite(row.value) || !Array.isArray(row.entries) || row.entries.length > 18) return true
    const entries: SparseRow['entries'] = row.entries
    return Array.from(entries).some(entry => !entry || !Number.isInteger(entry.column) || entry.column < 0 || entry.column >= size ||
      !Number.isFinite(entry.weight)) || new Set(entries.map(entry => entry.column)).size !== entries.length
  }
  if (!Number.isInteger(freeColumns) || freeColumns < 2 || freeColumns > 256 || !Array.isArray(rows) || rows.length === 0 || rows.length > 4096 ||
      ![previousWeight, nextWeight, regularization, relativeTolerance].every(x => Number.isFinite(x) && x > 0 && x <= 1) ||
      !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 512 || Array.from(rows).some(invalidRow))
    return refused('invalid-input', 0)
  const scale = rows.reduce((max, { value }) => Math.max(max, Math.abs(value)), 0)
  if (scale === 0) return { status: 'solved' as const, changes: new Float64Array(size), iterations: 0, relativeStationarityResidual: 0 }
  const rhs = new Float64Array(size), diagonal = new Float64Array(size).fill(regularization)
  for (let axis = 0; axis < 3; axis++) {
    diagonal[axis] += regularization * nextWeight ** 2
    diagonal[last + axis] += regularization * previousWeight ** 2
  }
  for (const { entries, value } of rows) {
    const scaled = value / scale
    if (!Number.isFinite(scaled) || (scaled === 0 && value !== 0)) return refused('arithmetic-refused', 0)
    for (const { column, weight } of entries) {
      const term = weight * scaled
      if (term === 0 && weight !== 0 && scaled !== 0) return refused('arithmetic-refused', 0)
      rhs[column] += term
      diagonal[column] += weight ** 2
    }
  }
  const initialNorm = infinityNorm(rhs)
  if (!Number.isFinite(initialNorm) || !diagonal.every(value => Number.isFinite(value) && value > 0)) return refused('arithmetic-refused', 0)
  if (initialNorm === 0) return { status: 'solved' as const, changes: new Float64Array(size), iterations: 0, relativeStationarityResidual: 0 }

  // The additional ridge row penalizes the dependent U0 change too.
  const apply = (x: Float64Array) => {
    const result = x.map(value => regularization * value)
    for (let axis = 0; axis < 3; axis++) {
      const seam = regularization * (nextWeight * x[axis] + previousWeight * x[last + axis])
      result[axis] += nextWeight * seam
      result[last + axis] += previousWeight * seam
    }
    for (const { entries } of rows) {
      let value = 0
      for (const { column, weight } of entries) value += weight * x[column]
      for (const { column, weight } of entries) result[column] += weight * value
    }
    return result
  }
  const x = new Float64Array(size)
  let residual = rhs.slice(), direction = residual.map((value, i) => value / diagonal[i])
  let product = dot(residual, direction)
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const transformed = apply(direction), denominator = dot(direction, transformed)
    if (!(product > 0) || !(denominator > 0) || !Number.isFinite(product) || !Number.isFinite(denominator))
      return refused('arithmetic-refused', iteration)
    const step = product / denominator
    for (let i = 0; i < size; i++) x[i] += step * direction[i]
    // Recompute the residual on the original operator to avoid declaring
    // convergence from the recursively updated residual alone.
    residual = apply(x).map((value, i) => rhs[i] - value)
    const relativeStationarityResidual = infinityNorm(residual) / initialNorm
    if (!Number.isFinite(relativeStationarityResidual)) return refused('arithmetic-refused', iteration)
    if (relativeStationarityResidual <= relativeTolerance) {
      const changes = x.map(value => value * scale)
      if (!changes.every((value, i) => Number.isFinite(value) && (value !== 0 || x[i] === 0)))
        return refused('arithmetic-refused', iteration)
      const reconstructed = changes.map(value => value / scale)
      const finalResidual = infinityNorm(apply(reconstructed).map((value, i) => rhs[i] - value)) / initialNorm
      if (!(finalResidual <= relativeTolerance)) return refused('arithmetic-refused', iteration)
      return { status: 'solved' as const, changes, iterations: iteration, relativeStationarityResidual: finalResidual }
    }
    const preconditioned = residual.map((value, i) => value / diagonal[i])
    const next = dot(residual, preconditioned), carry = next / product
    direction = preconditioned.map((value, i) => value + carry * direction[i])
    product = next
  }
  return refused('iteration-budget', maxIterations)
}

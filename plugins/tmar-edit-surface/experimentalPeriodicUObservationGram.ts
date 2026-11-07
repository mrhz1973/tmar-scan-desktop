// SPDX-License-Identifier: AGPL-3.0-only
import { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'
import { add, divide, mul, scalar, sub, type I } from './tangencyCoefficientIntervals'

export interface ExperimentalPeriodicUObservationGramRequest {
  degree: number
  knots: readonly number[]
  multiplicities: readonly number[]
  parameters: readonly number[]
  maxRows: number
  maxFreeColumns: number
}

function inverseSeed(gram: (I | undefined)[][]): Float64Array[] | undefined {
  const count = gram.length
  const lower = Array.from({ length: count }, () => new Float64Array(count))
  for (let j = 0; j < count; j++) for (let i = j; i < count; i++) {
    const entry = gram[i][j]
    let value = entry === undefined ? 0 : entry[0] + (entry[1] - entry[0]) / 2
    for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k]
    const factor = i === j ? Math.sqrt(value) : value / lower[j][j]
    if (!Number.isFinite(factor) || (i === j && !(factor > 0))) return undefined
    lower[i][j] = factor
  }
  const inverse: Float64Array[] = []
  for (let i = 0; i < count; i++) {
    const column = new Float64Array(count)
    for (let j = 0; j < count; j++) {
      let value = Number(i === j)
      for (let k = 0; k < j; k++) value -= lower[j][k] * column[k]
      column[j] = value / lower[j][j]
    }
    for (let j = count - 1; j >= 0; j--) {
      let value = column[j]
      for (let k = j + 1; k < count; k++) value -= lower[k][j] * column[k]
      column[j] = value / lower[j][j]
    }
    if (!column.every(Number.isFinite)) return undefined
    // The Gram matrix is symmetric. A column solve gives a row of the
    // inverse seed, whose entries are subsequently treated as exact doubles.
    inverse.push(column)
  }
  return inverse
}

const magnitude = ([low, high]: I) => Math.max(Math.abs(low), Math.abs(high))

/**
 * Certify the observation Gram G=AᵀA of the free columns, with U0 removed.
 * A consists of the binary64 basis values returned by the existing evaluator.
 * The Cholesky solve only proposes C. An outward bound η on ||I−CG||∞
 * below one proves invertibility and ||G⁻¹||∞ ≤ ||C||∞/(1−η). Since G is
 * symmetric positive definite, the reciprocal also bounds λ_min(G) below.
 * From C=(CG)G⁻¹ we also get ||G⁻¹||∞ ≥ ||C||∞/(1+η).
 * This measures the finite sample design. It solves no derivative fit and
 * supplies no bound on the basis evaluation error or between samples.
 */
export function boundExperimentalPeriodicUObservationGram(request: ExperimentalPeriodicUObservationGramRequest) {
  const evidenceScope = 'binary64-periodic-free-column-observation-gram' as const
  const size = { rows: 0, freeColumns: 0 }
  const stop = (reason: 'invalid-input' | 'work-budget' | 'insufficient-observations' |
    'inverse-seed-refused' | 'inverse-not-certified' | 'interval-arithmetic-refused') =>
    ({ status: 'inconclusive' as const, reason, size, evidenceScope })
  if (!request || !Array.isArray(request.knots) || !Array.isArray(request.multiplicities) || !Array.isArray(request.parameters) ||
      !Number.isInteger(request.maxRows) || request.maxRows < 1 || request.maxRows > 4096 ||
      !Number.isInteger(request.maxFreeColumns) || request.maxFreeColumns < 1 || request.maxFreeColumns > 256)
    return stop('invalid-input')
  size.rows = request.parameters.length
  if (size.rows > request.maxRows) return stop('work-budget')
  let basis: ReturnType<typeof prepareExperimentalPeriodicUBasis>
  try { basis = prepareExperimentalPeriodicUBasis(request.degree, request.knots, request.multiplicities) }
  catch { return stop('invalid-input') }
  const count = size.freeColumns = basis.poleCount - 1
  if (count > request.maxFreeColumns) return stop('work-budget')
  if (size.rows < count) return stop('insufficient-observations')

  const gram = Array.from({ length: count }, () => Array<I | undefined>(count))
  for (const u of request.parameters) {
    let active: ReturnType<typeof basis.evaluate>
    try { active = basis.evaluate(u) }
    catch { return stop('invalid-input') }
    try {
      const terms = active.indices.flatMap((i, j) => i > 0 && active.values[j] !== 0 ?
        [{ index: i - 1, value: scalar(active.values[j]) }] : [])
      for (const { index: i, value: x } of terms) for (const { index: j, value: y } of terms) if (i >= j) {
        const term = mul(x, y)
        const previous = gram[i][j]
        const entry = previous === undefined ? term : add(previous, term)
        gram[i][j] = entry
        gram[j][i] = entry
      }
    } catch { return stop('interval-arithmetic-refused') }
  }

  const inverse = inverseSeed(gram)
  if (inverse === undefined) return stop('inverse-seed-refused')
  const sparse = gram.map(row => row.flatMap((entry, index) => entry === undefined ? [] : [{ entry, index }]))
  try {
    let inverseResidualUpper = 0, inverseSeedNormUpper = 0, inverseSeedNormLower = 0
    for (const [i, row] of inverse.entries()) {
      let residualSum = scalar(0), normSum = scalar(0)
      for (const [j, column] of sparse.entries()) {
        let residual = scalar(Number(i === j))
        for (const { index, entry } of column) if (row[index] !== 0)
          residual = sub(residual, mul(scalar(row[index]), entry))
        residualSum = add(residualSum, scalar(magnitude(residual)))
        normSum = add(normSum, scalar(Math.abs(row[j])))
      }
      inverseResidualUpper = Math.max(inverseResidualUpper, residualSum[1])
      inverseSeedNormUpper = Math.max(inverseSeedNormUpper, normSum[1])
      inverseSeedNormLower = Math.max(inverseSeedNormLower, normSum[0])
    }
    if (!(inverseResidualUpper < 1)) return stop('inverse-not-certified')
    const inverseInfinityNormUpper = divide(scalar(inverseSeedNormUpper), sub(scalar(1), scalar(inverseResidualUpper)))[1]
    const minimumEigenvalueLower = divide(scalar(1), scalar(inverseInfinityNormUpper))[0]
    if (!(minimumEigenvalueLower > 0)) return stop('inverse-not-certified')
    let inverseInfinityNormLower = 0
    try { inverseInfinityNormLower = Math.max(0, divide(scalar(inverseSeedNormLower), add(scalar(1), scalar(inverseResidualUpper)))[0]) }
    catch { /* Zero remains a valid lower bound if the optional calculation cannot be enclosed. */ }
    return { status: 'certified-full-rank' as const, size, inverseResidualUpper,
      inverseInfinityNormUpper, inverseInfinityNormLower, minimumEigenvalueLower, evidenceScope }
  } catch { return stop('interval-arithmetic-refused') }
}

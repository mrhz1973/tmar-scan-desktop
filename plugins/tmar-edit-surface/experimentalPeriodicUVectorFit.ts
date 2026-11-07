// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'

interface VectorSample {
  parameter: number
  value: readonly [number, number, number]
}

const fail = (reason: string): never => { throw new Error(`Fit vettoriale periodico U rifiutato: ${reason}`) }
const minimumNormal = 2 ** -1022

function validateFixedFirst(fixedFirst: readonly [number, number, number]) {
  if (!Array.isArray(fixedFirst) || fixedFirst.length !== 3 || !Array.from(fixedFirst).every(Number.isFinite))
    fail('coefficiente U0 fissato non valido')
}

function powerOfTwoExponent(magnitude: number) {
  return Math.min(1023, Math.floor(Math.log2(magnitude)))
}

function normalizeExactly(value: number, scale: number) {
  const scaled = value / scale
  if (!Number.isFinite(scaled) || scaled * scale !== value) fail('equilibratura non rappresentabile')
  // A subnormal input can lose its entire contribution when multiplied by
  // a Householder reflector, even when scaling itself round-trips exactly.
  if (scaled !== 0 && Math.abs(scaled) < minimumNormal) fail('ingresso equilibrato subnormale')
  return scaled
}

function checkEquilibratedTerm(value: number, nonzero: boolean) {
  if (!Number.isFinite(value) || (nonzero && Math.abs(value) < minimumNormal))
    fail('termine QR equilibrato non rappresentabile')
}

function restoreCoefficient(value: number, exponent: number) {
  // Combine both scales before restoring the coefficient. Split exponents
  // outside binary64's range into factors in the same direction.
  let remaining = exponent
  let restored = value
  while (remaining > 1023) {
    restored *= 2 ** 1023
    remaining -= 1023
  }
  while (remaining < -1074) {
    restored *= 2 ** -1022
    remaining += 1022
  }
  restored *= 2 ** remaining
  if (!Number.isFinite(restored) || (restored === 0 && value !== 0)) fail('coefficiente de-equilibrato non rappresentabile')
  return restored
}

/**
 * Unweighted least squares for samples of a vector field over one U period.
 * Repeated parameters are separate observations, including the two names of
 * the seam. Residuals are Euclidean distances at the supplied samples only.
 * The pivot ratio is a diagnostic. It is not a condition number or error bound.
 */
export function fitExperimentalPeriodicUVectorSamples(
  degree: number, knots: readonly number[], multiplicities: readonly number[], samples: readonly VectorSample[],
) {
  return fitPeriodicUVectorSamples(degree, knots, multiplicities, samples).fit
}

/**
 * Constrained fit with coefficient U0 fixed. Remove its column and
 * subtract its contribution from each right-hand side before the QR.
 * Rank and pivot ratio describe only the free columns. Residuals use
 * the reconstructed full coefficients and the original training data.
 * The subtraction, solve and sampled residuals use binary64 arithmetic.
 * Rounding during elimination can obscure a small exact difference.
 */
export function fitExperimentalPeriodicUVectorSamplesWithFixedFirst(
  degree: number, knots: readonly number[], multiplicities: readonly number[], samples: readonly VectorSample[],
  fixedFirst: readonly [number, number, number],
) {
  validateFixedFirst(fixedFirst)
  return { ...fitPeriodicUVectorSamples(degree, knots, multiplicities, samples, fixedFirst).fit, fixedCoefficientIndex: 0 as const }
}

/**
 * Experimental fixed-U0 fit with the remaining columns equilibrated by
 * powers of two selected from their largest entry. This preserves the
 * unweighted objective in exact arithmetic.
 * The scaled pivot ratio uses the equilibrated matrix and cannot substitute
 * for the original pivot ratio. Raw L2 column norms and minimum RMS weight
 * describe sample support before scaling. The ratios can both be one when
 * all free weights are tiny. These diagnostics give neither a condition
 * number nor coefficient or holdout error bounds. Residuals use the original
 * samples. Subnormal normalized inputs and out-of-range QR products or
 * quotients are refused. Elimination and the QR still round in binary64.
 */
export function fitExperimentalPeriodicUVectorSamplesWithScaledFreeColumns(
  degree: number, knots: readonly number[], multiplicities: readonly number[], samples: readonly VectorSample[],
  fixedFirst: readonly [number, number, number],
) {
  validateFixedFirst(fixedFirst)
  const { fit: { pivotRatio: scaledPivotRatio, ...fit }, rawColumnNorms } =
    fitPeriodicUVectorSamples(degree, knots, multiplicities, samples, fixedFirst, true)
  return { ...fit, fixedCoefficientIndex: 0 as const, scaledPivotRatio, rawColumnNorms: rawColumnNorms! }
}

function fitPeriodicUVectorSamples(
  degree: number, knots: readonly number[], multiplicities: readonly number[], samples: readonly VectorSample[],
  fixedFirst?: readonly [number, number, number], scaleFreeColumns = false,
) {
  if (!Array.isArray(knots) || !Array.isArray(multiplicities) || !Array.isArray(samples))
    fail('nodi, molteplicità e campioni devono essere array')
  const basis = prepareExperimentalPeriodicUBasis(degree, knots, multiplicities)
  const firstFree = fixedFirst === undefined ? 0 : 1
  const columns = basis.poleCount - firstFree, rows = samples.length, width = columns + 3
  if (rows < columns) fail('campioni insufficienti per il rango pieno')
  if (rows > 4096 || rows * columns ** 2 > 125_000_000) fail('dimensione del fit oltre il limite sperimentale')

  const scales: Point = [0, 0, 0]
  const active = Array.from(samples, sample => {
    if (!sample || !Number.isFinite(sample.parameter) || !Array.isArray(sample.value) ||
        sample.value.length !== 3 || !Array.from(sample.value).every(Number.isFinite))
      fail('campione non finito o incompleto')
    const local = basis.evaluate(sample.parameter)
    const fixedWeight = fixedFirst === undefined ? 0 : local.values[local.indices.indexOf(0)] ?? 0
    const rightHandSide = fixedFirst === undefined ? sample.value : sample.value.map((value, axis) => {
      const contribution = fixedWeight * fixedFirst[axis]
      const reduced = value - contribution
      if (!Number.isFinite(reduced) || (fixedWeight !== 0 && fixedFirst[axis] !== 0 && contribution === 0))
        fail('sottrazione del coefficiente U0 fissato non rappresentabile')
      return reduced
    })
    for (let axis = 0; axis < 3; axis++) scales[axis] = Math.max(scales[axis], Math.abs(rightHandSide[axis]))
    return { ...local, rightHandSide }
  })

  const rhsExponents = scaleFreeColumns ? scales.map(scale => scale === 0 ? 0 : powerOfTwoExponent(scale)) : undefined
  const matrix = new Float64Array(rows * width)
  for (const [row, { indices, values, rightHandSide }] of active.entries()) {
    for (const [j, index] of indices.entries()) {
      if (index >= firstFree) matrix[row * width + index - firstFree] = values[j]
    }
    for (let axis = 0; axis < 3; axis++) {
      const value = rightHandSide[axis]
      if (value === 0) continue
      const scaled = rhsExponents === undefined ? value / scales[axis] : normalizeExactly(value, 2 ** rhsExponents[axis])
      if (scaled === 0) fail('scala dei campioni non rappresentabile')
      matrix[row * width + columns + axis] = scaled
    }
  }

  let rawColumnNorms: { min: number; max: number; minOverMax: number; minRmsWeight: number } | undefined
  let columnExponents: number[] | undefined
  if (scaleFreeColumns) {
    columnExponents = []
    let min = Infinity, max = 0
    for (let column = 0; column < columns; column++) {
      let magnitude = 0
      for (let row = 0; row < rows; row++) magnitude = Math.max(magnitude, Math.abs(matrix[row * width + column]))
      if (!(magnitude > 0) || !Number.isFinite(magnitude)) fail('rango numerico insufficiente: colonna libera nulla o non finita')
      const exponent = powerOfTwoExponent(magnitude)
      const scale = 2 ** exponent
      columnExponents.push(exponent)
      let squaredNorm = 0
      for (let row = 0; row < rows; row++) {
        const offset = row * width + column
        const value = normalizeExactly(matrix[offset], scale)
        matrix[offset] = value
        squaredNorm += value ** 2
      }
      const norm = Math.sqrt(squaredNorm) * scale
      min = Math.min(min, norm)
      max = Math.max(max, norm)
    }
    rawColumnNorms = { min, max, minOverMax: min / max, minRmsWeight: min / Math.sqrt(rows) }
  }

  // Householder QR with column pivoting. Recompute the trailing column
  // norms to avoid cancellation from subtractive norm updates near rank loss.
  // In the equilibrated path a first pivot of order one keeps squared
  // terms near underflow far below the rank tolerance, even summed over all rows.
  const permutation = Array.from({ length: columns }, (_, i) => i)
  let firstPivot = 0, smallestPivot = Infinity, rankTolerance = 0
  for (let step = 0; step < columns; step++) {
    let pivotColumn = step, largestSquaredNorm = 0
    for (let column = step; column < columns; column++) {
      let squaredNorm = 0
      for (let row = step; row < rows; row++) squaredNorm += matrix[row * width + column] ** 2
      if (squaredNorm > largestSquaredNorm) {
        pivotColumn = column
        largestSquaredNorm = squaredNorm
      }
    }
    const norm = Math.sqrt(largestSquaredNorm)
    if (step === 0) {
      firstPivot = norm
      rankTolerance = Math.max(rows, columns) * Number.EPSILON * firstPivot
    }
    if (!Number.isFinite(norm) || !(norm > rankTolerance)) fail(`rango numerico insufficiente (${step}/${columns})`)
    smallestPivot = Math.min(smallestPivot, norm)

    if (pivotColumn !== step) {
      [permutation[step], permutation[pivotColumn]] = [permutation[pivotColumn], permutation[step]]
      for (let row = 0; row < rows; row++) {
        const a = row * width + step, b = row * width + pivotColumn
        const value = matrix[a]
        matrix[a] = matrix[b]
        matrix[b] = value
      }
    }
    const start = step * width
    const leading = matrix[start + step]
    const diagonal = leading >= 0 ? -norm : norm
    const denominator = leading - diagonal
    const tau = -denominator / diagonal
    for (let row = step + 1; row < rows; row++) {
      const index = row * width + step
      const tail = matrix[index] / denominator
      if (scaleFreeColumns) checkEquilibratedTerm(tail, matrix[index] !== 0)
      matrix[index] = tail
    }
    matrix[start + step] = diagonal

    // Store the reflector tail under the diagonal. Apply it to the remaining
    // basis columns and to the three scaled right-hand sides together.
    for (let column = step + 1; column < width; column++) {
      let product = matrix[start + column]
      for (let row = step + 1; row < rows; row++) {
        const offset = row * width
        const a = matrix[offset + step], b = matrix[offset + column]
        const term = a * b
        if (scaleFreeColumns) checkEquilibratedTerm(term, a !== 0 && b !== 0)
        product += term
      }
      const nonzero = product !== 0
      product *= tau
      if (scaleFreeColumns) checkEquilibratedTerm(product, nonzero)
      matrix[start + column] -= product
      for (let row = step + 1; row < rows; row++) {
        const offset = row * width
        const tail = matrix[offset + step], correction = tail * product
        if (scaleFreeColumns) checkEquilibratedTerm(correction, tail !== 0 && product !== 0)
        matrix[offset + column] -= correction
      }
    }
  }

  const coefficients = Array<Point>(basis.poleCount)
  if (fixedFirst !== undefined) coefficients[0] = [...fixedFirst]
  for (let step = columns - 1; step >= 0; step--) {
    const offset = step * width
    const column = permutation[step]
    const coefficient = Array.from({ length: 3 }, (_, axis) => {
      let value = matrix[offset + columns + axis]
      for (let column = step + 1; column < columns; column++) {
        const a = matrix[offset + column], b = matrix[column * width + columns + axis]
        const term = a * b
        if (scaleFreeColumns) checkEquilibratedTerm(term, a !== 0 && b !== 0)
        value -= term
      }
      const scaled = value / matrix[offset + step]
      matrix[offset + columns + axis] = scaled
      if (columnExponents !== undefined && rhsExponents !== undefined) {
        checkEquilibratedTerm(scaled, value !== 0)
        if (scaled === 0) return 0
        return restoreCoefficient(scaled, rhsExponents[axis] - columnExponents[column])
      }
      return scales[axis] === 0 ? 0 : scaled * scales[axis]
    }) as Point
    if (!coefficient.every(Number.isFinite)) fail('coefficiente non rappresentabile')
    coefficients[column + firstFree] = coefficient
  }

  const residuals = active.map(({ indices, values }, row) => {
    const delta = samples[row].value.map((value, axis) => {
      const fitted = indices.reduce((sum, index, j) => sum + values[j] * coefficients[index][axis], 0)
      return fitted - value
    })
    const residual = Math.hypot(delta[0], delta[1], delta[2])
    if (!Number.isFinite(residual)) fail('residuo campionato non rappresentabile')
    return residual
  })
  const maxSampleResidual = Math.max(...residuals)
  const rmsSampleResidual = maxSampleResidual === 0 ? 0 : maxSampleResidual *
    Math.sqrt(residuals.reduce((sum, residual) => sum + (residual / maxSampleResidual) ** 2, 0) / rows)
  return {
    fit: { coefficients, sampleCount: rows, rank: columns, pivotRatio: smallestPivot / firstPivot,
      residuals, maxSampleResidual, rmsSampleResidual, evidenceScope: 'sampled-residual-only' as const },
    rawColumnNorms,
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'

interface VectorSample {
  parameter: number
  value: readonly [number, number, number]
}

const fail = (reason: string): never => { throw new Error(`Fit vettoriale periodico U rifiutato: ${reason}`) }

/**
 * Unweighted least squares for samples of a vector field over one U period.
 * Repeated parameters are separate observations, including the two names of
 * the seam. Residuals are Euclidean distances at the supplied samples only.
 * The pivot ratio is a diagnostic. It is not a condition number or error bound.
 */
export function fitExperimentalPeriodicUVectorSamples(
  degree: number, knots: readonly number[], multiplicities: readonly number[], samples: readonly VectorSample[],
) {
  return fitPeriodicUVectorSamples(degree, knots, multiplicities, samples)
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
  if (!Array.isArray(fixedFirst) || fixedFirst.length !== 3 || !Array.from(fixedFirst).every(Number.isFinite))
    fail('coefficiente U0 fissato non valido')
  return { ...fitPeriodicUVectorSamples(degree, knots, multiplicities, samples, fixedFirst), fixedCoefficientIndex: 0 as const }
}

function fitPeriodicUVectorSamples(
  degree: number, knots: readonly number[], multiplicities: readonly number[], samples: readonly VectorSample[],
  fixedFirst?: readonly [number, number, number],
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

  const matrix = new Float64Array(rows * width)
  for (const [row, { indices, values, rightHandSide }] of active.entries()) {
    for (const [j, index] of indices.entries()) {
      if (index >= firstFree) matrix[row * width + index - firstFree] = values[j]
    }
    for (let axis = 0; axis < 3; axis++) {
      const value = rightHandSide[axis]
      if (value === 0) continue
      const scaled = value / scales[axis]
      if (scaled === 0) fail('scala dei campioni non rappresentabile')
      matrix[row * width + columns + axis] = scaled
    }
  }

  // Householder QR with column pivoting. Recompute the trailing column
  // norms to avoid cancellation from subtractive norm updates near rank loss.
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
    for (let row = step + 1; row < rows; row++) matrix[row * width + step] /= denominator
    matrix[start + step] = diagonal

    // Store the reflector tail under the diagonal. Apply it to the remaining
    // basis columns and to the three scaled right-hand sides together.
    for (let column = step + 1; column < width; column++) {
      let product = matrix[start + column]
      for (let row = step + 1; row < rows; row++) {
        const offset = row * width
        product += matrix[offset + step] * matrix[offset + column]
      }
      product *= tau
      matrix[start + column] -= product
      for (let row = step + 1; row < rows; row++) {
        const offset = row * width
        matrix[offset + column] -= matrix[offset + step] * product
      }
    }
  }

  const coefficients = Array<Point>(basis.poleCount)
  if (fixedFirst !== undefined) coefficients[0] = [...fixedFirst]
  for (let step = columns - 1; step >= 0; step--) {
    const offset = step * width
    const coefficient = Array.from({ length: 3 }, (_, axis) => {
      let value = matrix[offset + columns + axis]
      for (let column = step + 1; column < columns; column++) {
        value -= matrix[offset + column] * matrix[column * width + columns + axis]
      }
      const scaled = value / matrix[offset + step]
      matrix[offset + columns + axis] = scaled
      return scales[axis] === 0 ? 0 : scaled * scales[axis]
    }) as Point
    if (!coefficient.every(Number.isFinite)) fail('coefficiente non rappresentabile')
    coefficients[permutation[step] + firstFree] = coefficient
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
    coefficients, sampleCount: rows, rank: columns, pivotRatio: smallestPivot / firstPivot,
    residuals, maxSampleResidual, rmsSampleResidual,
    evidenceScope: 'sampled-residual-only' as const,
  }
}

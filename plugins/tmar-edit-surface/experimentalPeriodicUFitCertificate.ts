// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'
import { boundExperimentalPeriodicUObservationGram,
  type ExperimentalPeriodicUObservationGramRequest } from './experimentalPeriodicUObservationGram'
import { add, mul, scalar, sub, type I, type V } from './tangencyCoefficientIntervals'

type Vector = readonly [number, number, number]
type StopReason = 'invalid-input' | 'work-budget' | 'fixed-coefficient-mismatch' |
  'observation-gram-inconclusive' | 'interval-arithmetic-refused' | 'coefficient-error-not-certified'

export interface ExperimentalPeriodicUFitCertificateRequest extends Omit<ExperimentalPeriodicUObservationGramRequest, 'parameters'> {
  samples: readonly { parameter: number; value: Vector }[]
  fixedFirst: Vector
  coefficients: readonly Vector[]
  maxCoefficientError: Vector
}

function copyFiniteVector(input: Vector): Point {
  if (!Array.isArray(input) || input.length !== 3) throw new Error('Vettore non valido')
  const copy = Array.from(input) as Point
  if (!copy.every(Number.isFinite)) throw new Error('Vettore non finito')
  return copy
}

const isZero = ([lo, hi]: I) => lo === 0 && hi === 0
const maximumMagnitude = ([lo, hi]: I) => Math.max(Math.abs(lo), Math.abs(hi))

/**
 * Bound the infinity-norm error over free coefficients separately for each
 * vector component, relative to the unique least-squares minimizer with U0
 * fixed. Basis weights, target samples and proposed coefficients are the
 * exact real values of their binary64 encodings. The RHS reduction by U0 is
 * modeled exactly and enclosed, including any loss in a solver's reduction.
 * The Gram proof uses the same sampled design and is recomputed internally.
 * The normal equations give G(x*−x)=Aᵀ(b−Ax) for each component.
 * A bound over tolerance is inconclusive. It need not be a witnessed error.
 * Its scope is the sampled least-squares problem over these weights.
 */
export function certifyExperimentalPeriodicUFitCoefficients(request: ExperimentalPeriodicUFitCertificateRequest) {
  const evidenceScope = 'binary64-sampled-fixed-u0-least-squares-coefficient-error' as const
  const stop = <Reason extends StopReason>(reason: Reason) =>
    ({ status: 'inconclusive' as const, reason, evidenceScope })
  if (!request || !Array.isArray(request.knots) || !Array.isArray(request.multiplicities) ||
      !Array.isArray(request.samples) || !Array.isArray(request.coefficients) ||
      request.knots.length > 256 || request.multiplicities.length !== request.knots.length ||
      !Number.isInteger(request.maxRows) || request.maxRows < 1 || request.maxRows > 4096 ||
      !Number.isInteger(request.maxFreeColumns) || request.maxFreeColumns < 1 || request.maxFreeColumns > 256)
    return stop('invalid-input')
  if (request.samples.length > request.maxRows || request.coefficients.length > request.maxFreeColumns + 1)
    return stop('work-budget')

  let design: ExperimentalPeriodicUObservationGramRequest, samples: Point[], coefficients: Point[], limits: Point
  try {
    const fixedFirst = copyFiniteVector(request.fixedFirst)
    limits = copyFiniteVector(request.maxCoefficientError)
    if (limits.some(limit => limit < 0)) return stop('invalid-input')
    coefficients = Array.from(request.coefficients, copyFiniteVector)
    if (!coefficients[0]) return stop('invalid-input')
    if (!fixedFirst.every((value, axis) => Object.is(value, coefficients[0][axis]))) return stop('fixed-coefficient-mismatch')
    const parameters: number[] = []
    samples = Array.from(request.samples, sample => {
      const parameter = sample?.parameter
      if (typeof parameter !== 'number' || !Number.isFinite(parameter)) throw new Error('Parametro non valido')
      parameters.push(parameter)
      return copyFiniteVector(sample.value)
    })
    design = { degree: request.degree, knots: Array.from(request.knots), multiplicities: Array.from(request.multiplicities),
      parameters, maxRows: request.maxRows, maxFreeColumns: request.maxFreeColumns }
  } catch { return stop('invalid-input') }

  const gram = boundExperimentalPeriodicUObservationGram(design)
  if (gram.status !== 'certified-full-rank') return { ...stop('observation-gram-inconclusive'), gram }
  if (coefficients.length !== gram.size.freeColumns + 1) return stop('invalid-input')
  try {
    const basis = prepareExperimentalPeriodicUBasis(design.degree, design.knots, design.multiplicities)
    const gradient = Array.from({ length: gram.size.freeColumns }, (): V => [scalar(0), scalar(0), scalar(0)])
    for (const [row, parameter] of design.parameters.entries()) {
      const { indices, values } = basis.evaluate(parameter)
      for (let axis = 0; axis < 3; axis++) {
        let residual = scalar(samples[row][axis])
        for (const [j, index] of indices.entries()) {
          const weight = values[j], value = coefficients[index][axis]
          if (weight === 0 || value === 0) continue
          const fitted = weight === 1 ? scalar(value) : mul(scalar(weight), scalar(value))
          residual = residual[0] === residual[1] && fitted[0] === fitted[1] && residual[0] === fitted[0]
            ? scalar(0) : sub(residual, fitted)
        }
        if (isZero(residual)) continue
        for (const [j, index] of indices.entries()) {
          const weight = values[j]
          if (index === 0 || weight === 0) continue
          const term = weight === 1 ? residual : mul(scalar(weight), residual)
          const entry = gradient[index - 1]
          entry[axis] = isZero(entry[axis]) ? term : add(entry[axis], term)
        }
      }
    }
    const normalResidualInfinityUpper: Point = [0, 0, 0]
    for (const column of gradient) for (let axis = 0; axis < 3; axis++)
      normalResidualInfinityUpper[axis] = Math.max(normalResidualInfinityUpper[axis], maximumMagnitude(column[axis]))
    const coefficientErrorInfinityUpper = normalResidualInfinityUpper.map(bound => bound === 0 ? 0 :
      mul(scalar(gram.inverseInfinityNormUpper), scalar(bound))[1]) as Point
    const evidence = { gram, normalResidualInfinityUpper, coefficientErrorInfinityUpper }
    if (coefficientErrorInfinityUpper.some((bound, axis) => !(bound <= limits[axis])))
      return { ...stop('coefficient-error-not-certified'), ...evidence }
    return { status: 'certified' as const, ...evidence, evidenceScope }
  } catch { return { ...stop('interval-arithmetic-refused'), gram } }
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import { experimentalBinary64NormalChordWithin } from './experimentalBinary64NormalChord'
import { add as intervalAdd, cross as intervalCross, divide as intervalDivide,
  l1, mul as intervalMul, scalar, vector, type V } from './tangencyCoefficientIntervals'

type Vector = readonly [number, number, number]

export interface ExperimentalPeriodicGeometricJointRequest {
  /** Tangents oriented along the same edge traversal by the caller. */
  lateralTangent: Vector
  supportTangent: Vector
  /** Derivatives directed into the respective surfaces. */
  lateralInward: Vector
  supportInward: Vector
  minimumTangentNorm: number
  minimumTransverseNorm: number
  maximumTangentChord: number
  maximumNormalChord: number
  /** Positive scale floor for the hypothetical change, up to the equality scale 1. */
  minimumPositiveScale: number
}

const finiteVector = (v: Vector) => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite)
const norm = (v: Vector) => Math.hypot(...v)
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vector, b: Vector): Point => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
]
const distance = (a: Vector, b: Vector) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const divide = (v: Vector, magnitude: number) => v.map(x => x / magnitude) as Point
const positive = (x: number) => Number.isFinite(x) && x > 0
const chordBudget = (x: number) => Number.isFinite(x) && x >= 0 && x <= 2
const minimumNormal = 2 ** -1022

function scaleExactly(v: Vector) {
  const largest = Math.max(...v.map(Math.abs))
  const scale = largest === 0 ? 1 : 2 ** Math.min(1023, Math.floor(Math.log2(largest)))
  const values = divide(v, scale)
  return values.every((x, axis) => Number.isFinite(x) && x * scale === v[axis])
    ? { values, scale, scaledNorm: norm(values) } : undefined
}

type ScaledVector = NonNullable<ReturnType<typeof scaleExactly>>

function orientedNormal(tangent: ScaledVector, inward: ScaledVector, minimumTransverseNorm: number) {
  // Exact power-of-two scaling preserves collinearity. Normalizing the
  // tangent first can round its coordinates unequally and invent a normal.
  const scaledCross = cross(tangent.values, inward.values), crossNorm = norm(scaledCross)
  const relativePerpendicular = crossNorm / tangent.scaledNorm
  const perpendicular = inward.scale * relativePerpendicular
  if (!Number.isFinite(perpendicular) || perpendicular < minimumTransverseNorm)
    return { status: 'inconclusive' as const, reason: 'degenerate-transverse' as const }
  if (crossNorm < minimumNormal || relativePerpendicular < minimumNormal || perpendicular < minimumNormal)
    return { status: 'inconclusive' as const, reason: 'unrepresentable-diagnostic' as const }
  try {
    const t = vector(tangent.values), r = vector(inward.values)
    const enclosure = intervalCross(t, r)
    const maxComponentLower = Math.max(...enclosure.map(([lo, hi]) => Math.max(lo, -hi, 0)))
    // ||cross||₂ ≥ its largest component, and ||t||₂ ≤ ||t||₁.
    const lower = intervalMul(intervalDivide(scalar(maxComponentLower), scalar(l1(t))), scalar(inward.scale))[0]
    const relativeLower = intervalDivide(scalar(maxComponentLower), intervalMul(scalar(l1(t)), scalar(l1(r))))[0]
    // Leave the direction unresolved if subtraction in the determinant is
    // ill-conditioned even though the restored transverse speed is large.
    if (!(lower >= minimumTransverseNorm) || !(relativeLower >= Math.sqrt(Number.EPSILON)))
      return { status: 'inconclusive' as const, reason: 'unrepresentable-diagnostic' as const }
    return { status: 'normal' as const, unit: divide(scaledCross, crossNorm), perpendicular, enclosure, maxComponentLower }
  } catch { return { status: 'inconclusive' as const, reason: 'unrepresentable-diagnostic' as const } }
}

const dotEnclosure = (a: V, b: V) =>
  a.reduce((sum, value, axis) => intervalAdd(sum, intervalMul(value, b[axis])), scalar(0))

/**
 * Diagnose one pair of corresponding samples on an assumed common edge.
 * Let T be the unit lateral tangent and R be minus the support inward
 * derivative. The decomposition is M=λR+μT+residual·N, with N in the
 * direction T×R. μ and residual use the lateral derivative's units.
 * Compare the actual oriented normals T×M and T_support×R separately.
 *
 * For an exact common tangent, the least pointwise Euclidean change in M
 * under λ≥minimumPositiveScale removes its normal component and raises its
 * in-plane transverse component only if needed. The two distances compare
 * this calculation with setting M=R. The classification separately reports
 * orientation and chord of the supplied derivatives at the sample.
 */
export function diagnoseExperimentalPeriodicGeometricJoint(request: ExperimentalPeriodicGeometricJointRequest) {
  const result = analyzeGeometricJoint(request)
  return result.status === 'sample-diagnostic' ? result.receipt : result
}

/** Opt in to an exact chord proof when the conservative interval upper is too wide. */
export function diagnoseExperimentalPeriodicGeometricJointExactChord(request: ExperimentalPeriodicGeometricJointRequest) {
  const result = analyzeGeometricJoint(request, true)
  return result.status === 'sample-diagnostic' ? result.receipt : result
}

type GeometricJointFailureReason = 'invalid-input' | 'degenerate-tangent' | 'incompatible-tangents' |
  'degenerate-transverse' | 'unrepresentable-diagnostic'
export type ExperimentalPeriodicGeometricJointFailureReason = GeometricJointFailureReason | 'normal-chord-proof'

function analyzeGeometricJoint(request: ExperimentalPeriodicGeometricJointRequest, allowExactChord = false) {
  const evidenceScope = 'pointwise-floating-geometric-joint-diagnostic' as const
  const stop = (reason: GeometricJointFailureReason, proofFailure?: 'normal-chord-proof') =>
    ({ status: 'inconclusive' as const, reason, evidenceScope, ...(proofFailure ? { proofFailure } : {}) })
  if (!request) return stop('invalid-input')
  const { lateralTangent, supportTangent, lateralInward, supportInward, minimumTangentNorm,
    minimumTransverseNorm, maximumTangentChord, maximumNormalChord, minimumPositiveScale } = request
  if (![lateralTangent, supportTangent, lateralInward, supportInward].every(finiteVector) ||
      !positive(minimumTangentNorm) || !positive(minimumTransverseNorm) ||
      !chordBudget(maximumTangentChord) || !chordBudget(maximumNormalChord) ||
      !positive(minimumPositiveScale) || minimumPositiveScale > 1)
    return stop('invalid-input')
  const lateralScale = scaleExactly(lateralTangent), supportScale = scaleExactly(supportTangent)
  if (!lateralScale || !supportScale) return stop('unrepresentable-diagnostic')
  const lateralTangentNorm = lateralScale.scale * lateralScale.scaledNorm, supportTangentNorm = supportScale.scale * supportScale.scaledNorm
  if (![lateralTangentNorm, supportTangentNorm].every(value => Number.isFinite(value) && value >= minimumTangentNorm))
    return stop('degenerate-tangent')
  if (Math.min(lateralTangentNorm, supportTangentNorm) < minimumNormal) return stop('unrepresentable-diagnostic')
  const t = divide(lateralScale.values, lateralScale.scaledNorm), supportT = divide(supportScale.values, supportScale.scaledNorm)
  const tangentChord = distance(t, supportT)
  if (!(dot(t, supportT) > 0) || !(tangentChord <= maximumTangentChord)) return stop('incompatible-tangents')

  const reference = supportInward.map(x => -x) as Point
  const referenceScale = scaleExactly(reference), inwardScale = scaleExactly(lateralInward)
  if (!referenceScale || !inwardScale) return stop('unrepresentable-diagnostic')
  const plane = orientedNormal(lateralScale, referenceScale, minimumTransverseNorm)
  const supportNormal = orientedNormal(supportScale, referenceScale, minimumTransverseNorm)
  const lateralNormal = orientedNormal(lateralScale, inwardScale, minimumTransverseNorm)
  if (plane.status !== 'normal') return stop(plane.reason)
  if (supportNormal.status !== 'normal') return stop(supportNormal.reason)
  if (lateralNormal.status !== 'normal') return stop(lateralNormal.reason)

  const { unit: planeNormal, perpendicular: referencePerpendicular } = plane
  const transverseDirection = cross(planeNormal, t)
  const transverseDirectionNorm = norm(transverseDirection)
  if (!positive(transverseDirectionNorm)) return stop('unrepresentable-diagnostic')
  const derivativeEqualityDistance = distance(lateralInward, reference)
  const equalDerivatives = derivativeEqualityDistance === 0
  const q = divide(transverseDirection, transverseDirectionNorm)
  const lateralPerpendicular = equalDerivatives ? referencePerpendicular : lateralNormal.perpendicular * dot(lateralNormal.unit, planeNormal)
  const lambda = lateralPerpendicular / referencePerpendicular
  const tangentialReference = dot(reference, t), tangentialContribution = lambda * tangentialReference
  const mu = equalDerivatives ? 0 : dot(lateralInward, t) - tangentialContribution
  const signedNormalResidual = equalDerivatives ? 0 : 0 - lateralNormal.perpendicular * dot(lateralNormal.unit, q)
  const floor = minimumPositiveScale * referencePerpendicular
  const minimumDerivativeChange = Math.hypot(signedNormalResidual, Math.max(0, floor - lateralPerpendicular))
  if (![lambda, mu, signedNormalResidual, derivativeEqualityDistance, minimumDerivativeChange].every(Number.isFinite) ||
      !positive(floor) || minimumDerivativeChange > derivativeEqualityDistance || (lambda === 0 && lateralPerpendicular !== 0) ||
      (tangentialContribution === 0 && lambda !== 0 && tangentialReference !== 0)) return stop('unrepresentable-diagnostic')

  const a = lateralNormal.unit, b = supportNormal.unit
  const normalDot = Math.max(-1, Math.min(1, dot(a, b)))
  const normalAngleRadians = Math.atan2(norm(cross(a, b)), normalDot)
  const normalChord = distance(a, b)
  let normalChordProof: 'exact-binary64-jets' | undefined
  let classification: 'orientation-mismatch' | 'oriented-normal-mismatch' | 'within-sampled-normal-budget'
  try {
    const alignedSupport = dotEnclosure(lateralNormal.enclosure, supportNormal.enclosure)
    const alignedProjection = dotEnclosure(lateralNormal.enclosure, plane.enclosure)
    if (alignedSupport[1] < 0 || alignedProjection[1] < 0) classification = 'orientation-mismatch'
    else {
      if (!(lambda > 0 && normalDot > 0 && alignedSupport[0] > 0 && alignedProjection[0] > 0))
        return stop('unrepresentable-diagnostic')
      if (normalChord > maximumNormalChord) classification = 'oriented-normal-mismatch'
      else {
        // For positive orientation, chord ≤ 2 sin(angle). Use raw cross
        // enclosures so uncertainty in the computed unit normals cannot pass.
        const numerator = l1(intervalCross(lateralNormal.enclosure, supportNormal.enclosure))
        const denominator = intervalMul(scalar(lateralNormal.maxComponentLower), scalar(supportNormal.maxComponentLower))
        const upper = intervalMul(scalar(2), intervalDivide(scalar(numerator), denominator))[1]
        if (!(upper <= maximumNormalChord)) {
          if (!allowExactChord || !experimentalBinary64NormalChordWithin(lateralTangent, lateralInward,
            supportTangent, reference, maximumNormalChord)) return stop('unrepresentable-diagnostic', 'normal-chord-proof')
          normalChordProof = 'exact-binary64-jets'
        }
        classification = 'within-sampled-normal-budget'
      }
    }
  } catch { return stop('unrepresentable-diagnostic') }
  const receipt = { status: 'sample-diagnostic' as const, classification, tangentChord, normalChord, normalDot, normalAngleRadians,
    lambda, mu, signedNormalResidual, derivativeEqualityDistance, minimumDerivativeChange, evidenceScope,
    ...(normalChordProof ? { normalChordProof } : {}) }
  return { status: 'sample-diagnostic' as const, receipt, planeNormal, q, lateralPerpendicular, floor,
    lateralNormalEnclosure: lateralNormal.enclosure }
}

/** Form a pointwise target in the reference plane and recheck the stored vector. */
export function projectExperimentalPeriodicGeometricJoint(request: ExperimentalPeriodicGeometricJointRequest, fixed: boolean) {
  const stop = (reason: 'invalid-lock-mode' | 'source-diagnostic-inconclusive' | 'source-orientation-mismatch' |
    'fixed-derivative-incompatible' | 'projected-target-unverified') => ({ status: 'inconclusive' as const, reason })
  if (typeof fixed !== 'boolean') return stop('invalid-lock-mode')
  const source = analyzeGeometricJoint(request)
  if (source.status !== 'sample-diagnostic') return { ...stop('source-diagnostic-inconclusive'), source }
  const before = source.receipt
  if (fixed) {
    if (before.classification !== 'within-sampled-normal-budget' || !(before.lambda >= request.minimumPositiveScale))
      return { ...stop('fixed-derivative-incompatible'), before }
    return { status: 'target' as const, value: [...request.lateralInward] as Point, before, after: before }
  }
  if (before.classification === 'orientation-mismatch') return { ...stop('source-orientation-mismatch'), before }
  const { planeNormal, q, lateralPerpendicular, floor } = source
  const transverseAdjustment = Math.max(0, floor - lateralPerpendicular)
  const value = request.lateralInward.map((component, axis) => {
    const adjustment = -before.signedNormalResidual * planeNormal[axis] + transverseAdjustment * q[axis]
    return adjustment === 0 ? component : component + adjustment
  }) as Point
  const projected = analyzeGeometricJoint({ ...request, lateralInward: value })
  if (projected.status !== 'sample-diagnostic' || projected.receipt.classification !== 'within-sampled-normal-budget' ||
      !(projected.receipt.lambda >= request.minimumPositiveScale)) return { ...stop('projected-target-unverified'), before }
  try {
    if (!(dotEnclosure(source.lateralNormalEnclosure, projected.lateralNormalEnclosure)[0] > 0))
      return { ...stop('projected-target-unverified'), before }
  } catch { return { ...stop('projected-target-unverified'), before } }
  return { status: 'target' as const, value, before, after: projected.receipt }
}

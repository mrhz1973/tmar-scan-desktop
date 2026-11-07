// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import { projectExperimentalPeriodicGeometricJoint, type ExperimentalPeriodicGeometricJointRequest } from './experimentalPeriodicGeometricJoint'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from './experimentalPeriodicOneSidedSurfaceDerivatives'
import { boundExperimentalPeriodicSeamDerivativeGap } from './experimentalPeriodicSeamDerivativeGap'
import { sampleExperimentalPeriodicTransverseDerivatives } from './experimentalPeriodicTransverseSamples'

type Sampler = Parameters<typeof sampleExperimentalPeriodicTransverseDerivatives>[0]
type Sample = ReturnType<typeof sampleExperimentalPeriodicTransverseDerivatives>['samples'][number]
type SeamSide = 'left' | 'right'
type PointBudgets = Omit<ExperimentalPeriodicGeometricJointRequest, 'lateralTangent' | 'supportTangent' | 'lateralInward' | 'supportInward'>

export interface ExperimentalPeriodicGeometricSideTargetsRequest extends Pick<Sampler, 'strip' | 'support' | 'edgePeriod'> {
  training: readonly number[]
  holdout: readonly number[]
  budgets: PointBudgets & { sampledPositionGap: number; seamDerivativeGap: number; maximumNormalResidual: number }
}

const orientationU = (side: Sampler['strip']) => side.uAtEdgeEnds[0] < side.uAtEdgeEnds[1] ? 1 : -1
const orientationV = (side: Sampler['strip']) => side.edge === 'V0' ? 1 : -1
const boundaryV = (side: Sampler['strip']) => side.edge === 'V0' ? side.net.kv[0] : side.net.kv.at(-1)!
const directed = (point: Point, sign: number) => point.map(value => sign * value) as Point
const nativeSide = (side: SeamSide | undefined, sign: number) => side === undefined || sign === 1 ? side : side === 'left' ? 'right' : 'left'
const location = ({ edgeParameter, parameter, supportParameter }: Sample) => ({ edgeParameter, parameter, supportParameter })

/**
 * Sample the closest positive-scale tangent-plane targets under the supplied
 * full-period maps. U0 stays fixed and must already satisfy the pointwise
 * budgets with each of its two seam tangents. Training includes the first
 * seam name once and holdout consists of disjoint interior observations.
 * The scale floor and residual thresholds use the floating diagnostics;
 * positive orientation and the normal chord use the point diagnostic's
 * conservative checks on the evaluated vectors.
 * The targets need an independent fit, stored-coefficient and holdout check,
 * and surface orientation checks before any geometric use.
 */
export function sampleExperimentalPeriodicGeometricSideTargets(request: ExperimentalPeriodicGeometricSideTargetsRequest) {
  const evidenceScope = 'sampled-periodic-geometric-side-targets' as const
  let phase: 'preflight' | 'seam-gap' | 'sampling' | 'locked-seam' | 'projection' = 'preflight'
  const stop = (reason: string, at?: ReturnType<typeof location> & { seamSide?: SeamSide }) =>
    ({ status: 'inconclusive' as const, phase, reason, at, evidenceScope })
  try {
    if (!request?.strip?.net || !request.support?.net || !request.budgets) return stop('invalid-input')
    const { strip, support, budgets, edgePeriod } = request
    if (strip.net === support.net || strip.net.dv !== 5 || strip.net.mu[0] !== strip.net.du ||
        ![strip, support].every(side => side.net.mu.slice(1, -1).every(m => m < side.net.du)) ||
        ![budgets.minimumTangentNorm, budgets.minimumTransverseNorm, budgets.minimumPositiveScale]
          .every(value => Number.isFinite(value) && value > 0) || budgets.minimumPositiveScale > 1 ||
        ![budgets.maximumTangentChord, budgets.maximumNormalChord].every(value => Number.isFinite(value) && value >= 0 && value <= 2) ||
        ![budgets.sampledPositionGap, budgets.seamDerivativeGap, budgets.maximumNormalResidual]
          .every(value => Number.isFinite(value) && value >= 0)) return stop('invalid-input')

    phase = 'seam-gap'
    const sourceSeam = boundExperimentalPeriodicSeamDerivativeGap(strip.net, budgets.seamDerivativeGap)
    if (sourceSeam.status !== 'within-tolerance') return stop('source-seam-unverified')
    if (support.net.mu[0] === support.net.du &&
        boundExperimentalPeriodicSeamDerivativeGap(support.net, budgets.seamDerivativeGap).status !== 'within-tolerance')
      return stop('support-seam-unverified')

    phase = 'sampling'
    // The existing sampler verifies full-period maps, native basis inputs
    // and the positional gap. Its derivative-equality value is discarded.
    const mapping = { strip, support, edgePeriod, lambda: 1, positionTolerance: budgets.sampledPositionGap }
    const train = sampleExperimentalPeriodicTransverseDerivatives({ ...mapping, edgeParameters: request.training }).samples.slice(0, -1)
    const held = sampleExperimentalPeriodicTransverseDerivatives({ ...mapping, edgeParameters: request.holdout }).samples.slice(1, -1)
    const usedLateral = new Set(train.map(sample => sample.parameter)), usedSupport = new Set(train.map(sample => sample.supportParameter))
    const overlap = held.find(sample => usedLateral.has(sample.parameter) || usedSupport.has(sample.supportParameter))
    if (overlap) return stop('mapped-training-holdout-alias', location(overlap))

    const lateral = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(strip.net)
    const neighbor = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(support.net)
    const lateralU = orientationU(strip), supportU = orientationU(support), lateralV = orientationV(strip), supportV = orientationV(support)
    const v = boundaryV(strip), w = boundaryV(support)
    const outer = strip.edge === 'V0' ? 0 : strip.net.nv - 1
    const span = strip.edge === 'V0' ? 0 : strip.net.kv.length - 2
    const scale = 5 / (strip.net.kv[span + 1] - strip.net.kv[span])
    const fixedFirst = strip.net.poles[outer].map((x, axis) => scale * (strip.net.poles[outer + lateralV][axis] - x)) as Point
    const project = (sample: Sample, seamSide?: SeamSide) => {
      const a = lateral.evaluate(sample.parameter, v, { u: nativeSide(seamSide, lateralU) })
      const b = neighbor.evaluate(sample.supportParameter, w, { u: nativeSide(seamSide, supportU) })
      return projectExperimentalPeriodicGeometricJoint({ ...budgets,
        lateralTangent: directed(a.du, lateralU), supportTangent: directed(b.du, supportU),
        lateralInward: seamSide ? fixedFirst : directed(a.dv, lateralV), supportInward: directed(b.dv, supportV),
      }, seamSide !== undefined)
    }
    const acceptable = (projected: Extract<ReturnType<typeof project>, { status: 'target' }>) =>
      Math.abs(projected.after.signedNormalResidual) <= budgets.maximumNormalResidual &&
      Math.abs(projected.after.signedNormalResidual) <= Math.abs(projected.before.signedNormalResidual)

    phase = 'locked-seam'
    for (const seamSide of ['left', 'right'] as const) {
      const projected = project(train[0], seamSide)
      if (projected.status !== 'target' || !acceptable(projected))
        return stop('locked-u0-geometric-target-incompatible', { ...location(train[0]), seamSide })
    }

    phase = 'projection'
    const training = [{ ...location(train[0]), value: fixedFirst }]
    let maxInteriorTrainingSourceNormalResidual = 0, maxInteriorTrainingTargetNormalResidual = 0
    for (const sample of train.slice(1)) {
      const projected = project(sample)
      if (projected.status !== 'target') return stop(projected.reason, location(sample))
      if (!acceptable(projected)) return stop('projected-normal-residual-unverified', location(sample))
      maxInteriorTrainingSourceNormalResidual = Math.max(maxInteriorTrainingSourceNormalResidual, Math.abs(projected.before.signedNormalResidual))
      maxInteriorTrainingTargetNormalResidual = Math.max(maxInteriorTrainingTargetNormalResidual, Math.abs(projected.after.signedNormalResidual))
      training.push({ ...location(sample), value: projected.value })
    }
    return { status: 'targets-only' as const, training, holdout: held.map(location), fixedFirst,
      maxInteriorTrainingSourceNormalResidual, maxInteriorTrainingTargetNormalResidual, evidenceScope }
  } catch { return stop('geometric-target-evaluation-refused') }
}

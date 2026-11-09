// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { createExperimentalCandidateJointPointEvaluator } from './experimentalCandidateJointPoint'
import { mapPeriodicKnotsAffineRounded } from './experimentalPeriodicAffineKnotMap'
import type { I } from './tangencyCoefficientIntervals'

type Boundary = { net: Net; edge: 'V0' | 'V1' }
type Group = 'training' | 'holdout'
type Location = { group: Group; ordinal: number; sourceIndex: number; edgeParameter: number;
  lateralU: number; supportU: number; seamSide: 'left' | 'right' | null }
export interface ExperimentalCandidateHistoricalResidualRequest {
  lateral: Boundary
  support: Boundary
  edgePeriod: readonly [number, number]
  /** Original ordered arrays, including both endpoints. */
  training: readonly number[]
  holdout: readonly number[]
  maximumResidualMmPerV: number
  maxPointEvaluations: number
}
function fail(reason: string): never { throw Error(`Historical residual refused: ${reason}`) }

/**
 * New narrowly scoped evidence on supplied saved coefficient models. Reuses
 * only the original rounded affine parameter mapper, not the old sampling,
 * materialization or full-joint runner. Every point encloses BOTH historical
 * normal residual definitions. Training omits its duplicate end, then names
 * both one-sided seam limits; holdout omits its two endpoints. No claim is
 * transferred from old sampled results, and none extends between points.
 */
export function boundExperimentalCandidateHistoricalResidual(request: ExperimentalCandidateHistoricalResidualRequest) {
  const { lateral, support, edgePeriod, training, holdout, maximumResidualMmPerV, maxPointEvaluations } = request
  if (!Number.isFinite(maximumResidualMmPerV) || maximumResidualMmPerV < 0 || !Number.isSafeInteger(maxPointEvaluations) ||
      maxPointEvaluations < 1 || maxPointEvaluations > 8192 || !Array.isArray(edgePeriod) || edgePeriod.length !== 2 ||
      !edgePeriod.every(Number.isFinite) || !(edgePeriod[0] < edgePeriod[1])) fail('invalid-criteria-or-edge-period')
  for (const values of [training, holdout]) if (!Array.isArray(values) || values.length < 3 || values.length > 4096 ||
      !Object.is(values[0], edgePeriod[0]) || !Object.is(values.at(-1), edgePeriod[1]) ||
      values.some((v, i) => !Number.isFinite(v) || (i > 0 && !(v > values[i - 1])))) fail('original-parameter-set-invalid')
  const expectedPoints = training.length + holdout.length - 2
  if (expectedPoints > maxPointEvaluations) fail('point-budget')
  const first = (b: Boundary) => b.net.ku[0], last = (b: Boundary) => b.net.ku.at(-1)!
  const maps = ([['training', training], ['holdout', holdout]] as const).map(([group, values]) => {
    const a = mapPeriodicKnotsAffineRounded(values, first(lateral), last(lateral))
    const b = mapPeriodicKnotsAffineRounded(values, first(support), last(support))
    return { group, lateralParameters: a.knots, supportParameters: b.knots,
      maxLateralParameterRoundingError: a.maxParameterError, maxSupportParameterRoundingError: b.maxParameterError }
  })
  const trainingLateral = new Set(maps[0].lateralParameters.slice(0, -1))
  const trainingSupport = new Set(maps[0].supportParameters.slice(0, -1))
  for (let i = 1; i < holdout.length - 1; i++) if (trainingLateral.has(maps[1].lateralParameters[i]) ||
    trainingSupport.has(maps[1].supportParameters[i])) fail('mapped-training-holdout-alias')
  const evaluator = createExperimentalCandidateJointPointEvaluator(lateral, support, { maxCells: 4096, maxPointEvaluations })
  const fresh = () => ({ checkedPoints: 0, boundedPoints: 0, certifiedPoints: 0, outsidePoints: 0, inconclusivePoints: 0,
    maximumProjectedResidual: [0, 0] as I, maximumSupportResidual: [0, 0] as I,
    maximumCombinedResidual: [0, 0] as I, largestUpperAt: null as Location | null })
  const groups: Record<Group, ReturnType<typeof fresh>> = { training: fresh(), holdout: fresh() }
  const witnesses: { location: Location; projected: I; support: I; combined: I }[] = []
  const unresolved: { location: Location; reason: string }[] = []
  for (const map of maps) {
    const values = map.group === 'training' ? training : holdout
    const start = map.group === 'training' ? 0 : 1, end = values.length - 1
    const aggregate = groups[map.group]
    for (let index = start; index < end; index++) {
      const seamSides = map.group === 'training' && index === 0 ? ['left', 'right'] as const : [null]
      for (const seamSide of seamSides) {
        const lateralU = seamSide === 'left' ? last(lateral) : map.lateralParameters[index]
        const supportU = seamSide === 'left' ? last(support) : map.supportParameters[index]
        const location: Location = { group: map.group, ordinal: aggregate.checkedPoints + 1, sourceIndex: index,
          edgeParameter: values[index], lateralU, supportU, seamSide }
        aggregate.checkedPoints++
        try {
          const point = evaluator.evaluateNative({ lateralU, supportU,
            ...(seamSide ? { lateralSide: seamSide, supportSide: seamSide } : {}) })
          const projected = point.projectedNormalResidualAbs, central = point.supportNormalResidualAbs, combined = point.maximumNormalResidualAbs
          if (!projected || !central || !combined) throw Error('positive-normal-norm-not-certified')
          aggregate.boundedPoints++
          if (combined[1] > aggregate.maximumCombinedResidual[1]) aggregate.largestUpperAt = location
          for (const [key, interval] of [['maximumProjectedResidual', projected], ['maximumSupportResidual', central],
            ['maximumCombinedResidual', combined]] as const) aggregate[key] = [Math.max(aggregate[key][0], interval[0]), Math.max(aggregate[key][1], interval[1])]
          if (combined[1] <= maximumResidualMmPerV) aggregate.certifiedPoints++
          else if (combined[0] > maximumResidualMmPerV) {
            aggregate.outsidePoints++
            if (witnesses.length < 8) witnesses.push({ location, projected, support: central, combined })
          } else throw Error('residual-interval-straddles-budget')
        } catch (error) {
          aggregate.inconclusivePoints++
          if (unresolved.length < 8) unresolved.push({ location, reason: error instanceof Error ? error.message : String(error) })
        }
      }
    }
  }
  const checkedPoints = groups.training.checkedPoints + groups.holdout.checkedPoints
  const outsidePoints = groups.training.outsidePoints + groups.holdout.outsidePoints
  const inconclusivePoints = groups.training.inconclusivePoints + groups.holdout.inconclusivePoints
  const finishGroup = (g: ReturnType<typeof fresh>) => {
    const boundsComplete = g.boundedPoints === g.checkedPoints
    return { ...g, boundsComplete,
      maximumProjectedResidual: boundsComplete ? g.maximumProjectedResidual : null,
      maximumSupportResidual: boundsComplete ? g.maximumSupportResidual : null,
      maximumCombinedResidual: boundsComplete ? g.maximumCombinedResidual : null,
      diagnosticOnlyPartialMaxima: boundsComplete ? null : { projected: g.maximumProjectedResidual,
        support: g.maximumSupportResidual, combined: g.maximumCombinedResidual } }
  }
  return { status: outsidePoints ? 'outside-historical-sampled-residual-criterion' as const :
    inconclusivePoints || checkedPoints !== expectedPoints ? 'inconclusive' as const : 'within-historical-sampled-residual-criterion' as const,
    maximumResidualMmPerV, expectedPoints, checkedPoints, outsidePoints, inconclusivePoints,
    groups: { training: finishGroup(groups.training), holdout: finishGroup(groups.holdout) }, witnesses, unresolved,
    parameterMappings: maps, coverage: 'supplied-historical-training-and-holdout-points-only' as const,
    parameterRounding: 'existing-exact-positive-affine-nearest-ties-to-even-binary64-mapper' as const,
    seamConvention: 'training-first-point-left-at-Uend-and-right-at-Ustart' as const,
    residualDefinitions: ['abs(M-dot-unit(T-lateral-cross-R))', 'abs(M-dot-unit(T-support-cross-R))'],
    mappingIsIncreasing: true as const, oldPassTransferred: false as const, oldRunnerReplayed: false as const,
    continuousResidualCertified: false as const, nativeCadCertified: false as const, tubeAccepted: false as const }
}

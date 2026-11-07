// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from './experimentalPeriodicOneSidedSurfaceDerivatives'
import { proposeExperimentalPeriodicAlmostC1QuinticSide } from './experimentalPeriodicQuinticSide'
import { boundExperimentalPeriodicSeamDerivativeGap } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { sampleExperimentalPeriodicTransverseDerivatives } from './experimentalPeriodicTransverseSamples'
import { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'
import { fitExperimentalPeriodicUVectorSamplesWithFixedFirst } from './experimentalPeriodicUVectorFit'

type Sampler = Parameters<typeof sampleExperimentalPeriodicTransverseDerivatives>[0]
type Sample = ReturnType<typeof sampleExperimentalPeriodicTransverseDerivatives>['samples'][number]
type Side = 'left' | 'right'
type Phase = 'preflight' | 'source-seam' | 'support-seam' | 'sampling' | 'fit' | 'proposal' | 'candidate-seam' | 'holdout'
type Location = { t: number; lateralU: number; supportU: number; seamSide?: Side }
type Metric = { value: number; at: Location }
const phaseFailures = {
  preflight: 'invalid-input',
  'source-seam': 'source-seam-refused',
  'support-seam': 'support-seam-refused',
  sampling: 'sampling-refused',
  fit: 'fit-refused',
  proposal: 'proposal-refused',
  'candidate-seam': 'candidate-seam-refused',
  holdout: 'holdout-refused',
} as const satisfies Record<Phase, string>
type ReasonCode = typeof phaseFailures[Phase] | 'seam-gap-exceeds-budget' | 'seam-gap-unrepresentable' |
  'training-gap-exceeds-budget' | 'holdout-gap-exceeds-budget' | 'training-holdout-overlap' |
  'mapped-training-holdout-alias' | 'free-rank-deficient' | 'pivot-ratio-below-budget' |
  'training-residual-exceeds-budget' | 'fitted-holdout-residual-exceeds-budget' |
  'displacement-bound-exceeds-budget' | 'stored-holdout-residual-exceeds-budget' | 'joint-normals-refused'

interface Budgets {
  sampledPositionGap: number
  seamDerivativeGap: number
  minimumPivotRatio: number
  trainingDerivativeResidual: number
  holdoutDerivativeResidual: number
  storageDerivativeResidual: number
  secondDerivativeChange: number
  displacement: number
  minimumSampledNormalNorm: number
  jointNormalChord: number
}

export interface ExperimentalPeriodicQuinticSideDiagnosticRequest {
  lateral: Sampler['strip']
  support: Sampler['support']
  edgePeriod: Sampler['edgePeriod']
  training: readonly number[]
  holdout: readonly number[]
  lambda: number
  budgets: Budgets
  lockIndices?: readonly number[]
}

class GateFailure extends Error {
  constructor(message: string, readonly reasonCode?: ReasonCode) { super(message) }
}
const fail = (reason: string, reasonCode?: ReasonCode): never => { throw new GateFailure(reason, reasonCode) }
const seamReasonCode = (reason: 'bound-exceeds-tolerance' | 'unrepresentable-bound'): ReasonCode =>
  reason === 'bound-exceeds-tolerance' ? 'seam-gap-exceeds-budget' : 'seam-gap-unrepresentable'
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const signV = (edge: Sampler['strip']['edge']) => edge === 'V0' ? 1 : -1
const signU = ([a, b]: Sampler['strip']['uAtEdgeEnds']) => a < b ? 1 : -1
const locationOf = (sample: Sample): Location =>
  ({ t: sample.edgeParameter, lateralU: sample.parameter, supportU: sample.supportParameter })
const maximum = (before: Metric | undefined, value: number, at: Location): Metric =>
  before === undefined || value > before.value ? { value, at } : before
const vAt = ({ net, edge }: Sampler['strip']) => edge === 'V0' ? net.kv[0] : net.kv.at(-1)!
const mappedSide = (side: Side, sign: number): Side => sign > 0 ? side : side === 'left' ? 'right' : 'left'

function unit(normal: Point, sign: number, minimum: number): Point {
  const magnitude = Math.hypot(...normal)
  if (!Number.isFinite(magnitude) || magnitude < minimum) fail('norma campionata non rappresentabile o sotto soglia')
  return normal.map(value => sign * (value / magnitude)) as Point
}

function originalFirstDerivative({ net, edge }: Sampler['strip']): Point {
  const first = edge === 'V0' ? 0 : net.nv - 1
  const inner = first + signV(edge)
  const span = edge === 'V0' ? 0 : net.kv.length - 2
  const scale = 5 / (net.kv[span + 1] - net.kv[span])
  const value = net.poles[first].map((x, axis) => scale * (net.poles[inner][axis] - x)) as Point
  if (!(scale > 0) || !Number.isFinite(scale) || !value.every(Number.isFinite))
    fail('derivata U0 originale non rappresentabile')
  return value
}

/**
 * Diagnose one quintic lateral border in the coefficient model. The
 * supplied maps already express the intended affine correspondence.
 * The fit uses a fixed U0 coefficient derived from the original border.
 * Its binary64 approximation is subsequently checked against the fixed
 * stored seam column by the proposal's derivative residual.
 *
 * Gap, residual and normal-chord observations at the joint are sampled.
 * Independent holdout residuals exclude the seam used in training. The
 * stored residual and normal check also cover both seam sides. Bounds
 * on seam derivative gap, storage, D2 and displacement refer to the
 * coefficient model. The support seam is also checked when saturated;
 * each seam budget uses its own native U units. Interior orientation, continuous joint quality,
 * pcurves and CAD validity require separate verification.
 */
export function measureExperimentalPeriodicQuinticSide(request: ExperimentalPeriodicQuinticSideDiagnosticRequest) {
  const evidence: {
    sourceSeam?: ReturnType<typeof boundExperimentalPeriodicSeamDerivativeGap>
    supportSeam?: ReturnType<typeof boundExperimentalPeriodicSeamDerivativeGap> | { status: 'structurally-c1' }
    candidateSeam?: ReturnType<typeof boundExperimentalPeriodicSeamDerivativeGap>
    maxTrainingGap?: Metric; maxHoldoutGap?: Metric
    trainingCount?: number; holdoutInteriorCount?: number
    fit?: { fixedFirst: Point; freeRank: number; expectedFreeRank: number; pivotRatio: number }
    maxTrainingResidual?: Metric; maxFittedHoldoutResidual?: Metric; maxStoredHoldoutResidual?: Metric
    proposal?: { changedIndices: number[]; maxDerivativeResidualBound: number;
      maxSecondDerivativeChangeBound: number; maxPositionDisplacementBound: number }
    originalJointNormalChord?: Metric; candidateJointNormalChord?: Metric; minimumCandidateNormalDot?: Metric
  } = {}
  const evidenceScope = 'quintic-side-coefficient-and-sampled-joint-diagnostics' as const
  let phase: Phase = 'preflight', location: Location | undefined
  const stop = (status: 'declined' | 'inconclusive', reason: string, reasonCode: ReasonCode = phaseFailures[phase]) =>
    ({ status, phase, location, reason, reasonCode, evidence, evidenceScope })
  try {
    if (!request?.lateral?.net || !request.support?.net || !request.budgets) fail('richiesta diagnostica incompleta')
    const { lateral, support, edgePeriod, training, holdout, lambda, budgets, lockIndices } = request
    if (lateral.net.dv !== 5 || (lateral.edge !== 'V0' && lateral.edge !== 'V1')) fail('lato quintico non valido')
    const limits = [budgets.sampledPositionGap, budgets.seamDerivativeGap, budgets.minimumPivotRatio,
      budgets.trainingDerivativeResidual, budgets.holdoutDerivativeResidual, budgets.storageDerivativeResidual,
      budgets.secondDerivativeChange, budgets.displacement, budgets.minimumSampledNormalNorm, budgets.jointNormalChord]
    if (limits.some(value => !Number.isFinite(value) || value < 0) ||
        !(budgets.minimumPivotRatio > 0 && budgets.minimumPivotRatio <= 1) || budgets.jointNormalChord > 2 ||
        budgets.storageDerivativeResidual === 0 || budgets.secondDerivativeChange === 0 || budgets.minimumSampledNormalNorm === 0)
      fail('budget diagnostici non validi')

    phase = 'source-seam'
    const seam = boundExperimentalPeriodicSeamDerivativeGap(lateral.net, budgets.seamDerivativeGap)
    evidence.sourceSeam = seam
    if (seam.status === 'inconclusive') return stop('inconclusive', seam.reason, seamReasonCode(seam.reason))
    if (lateral.net.mu.slice(1, -1).some(m => m >= lateral.net.du))
      fail('richiesti nodi U interni strutturalmente C1 sul lato quintico')

    phase = 'support-seam'
    validateExperimentalPeriodicSurfaceU(support.net)
    if (support.net.weights.some(weight => weight !== 1) || support.net.mu.slice(1, -1).some(m => m >= support.net.du))
      fail('richiesti pesi unitari e nodi U interni strutturalmente C1 sul supporto')
    if (support.net.mu[0] === support.net.du) {
      const fixedSeam = boundExperimentalPeriodicSeamDerivativeGap(support.net, budgets.seamDerivativeGap)
      evidence.supportSeam = fixedSeam
      if (fixedSeam.status === 'inconclusive') return stop('inconclusive', fixedSeam.reason, seamReasonCode(fixedSeam.reason))
    } else evidence.supportSeam = { status: 'structurally-c1' }

    phase = 'sampling'
    const sampler = { strip: lateral, support, edgePeriod, lambda, positionTolerance: Number.MAX_VALUE }
    const trainSamples = sampleExperimentalPeriodicTransverseDerivatives({ ...sampler, edgeParameters: training })
      .samples.slice(0, -1)
    for (const sample of trainSamples)
      evidence.maxTrainingGap = maximum(evidence.maxTrainingGap, sample.sampledGap, locationOf(sample))
    if (evidence.maxTrainingGap!.value > budgets.sampledPositionGap) {
      location = evidence.maxTrainingGap!.at
      fail('gap campionato del fit oltre budget', 'training-gap-exceeds-budget')
    }
    const holdoutSamples = sampleExperimentalPeriodicTransverseDerivatives({ ...sampler, edgeParameters: holdout })
      .samples.slice(0, -1)
    for (const sample of holdoutSamples)
      evidence.maxHoldoutGap = maximum(evidence.maxHoldoutGap, sample.sampledGap, locationOf(sample))
    if (evidence.maxHoldoutGap!.value > budgets.sampledPositionGap) {
      location = evidence.maxHoldoutGap!.at
      fail('gap campionato holdout oltre budget', 'holdout-gap-exceeds-budget')
    }
    const trainedLateral = new Set(trainSamples.map(sample => sample.parameter))
    const trainedSupport = new Set(trainSamples.map(sample => sample.supportParameter))
    const trainedEdge = new Set(trainSamples.map(sample => sample.edgeParameter))
    const interior = holdoutSamples.slice(1)
    for (const sample of interior) if (trainedLateral.has(sample.parameter) || trainedSupport.has(sample.supportParameter)) {
      location = locationOf(sample)
      fail('holdout sovrapposto ai campioni del fit dopo la mappatura',
        trainedEdge.has(sample.edgeParameter) ? 'training-holdout-overlap' : 'mapped-training-holdout-alias')
    }
    evidence.trainingCount = trainSamples.length
    evidence.holdoutInteriorCount = interior.length

    phase = 'fit'
    const fixedFirst = originalFirstDerivative(lateral)
    const { du, ku, mu, nu } = lateral.net
    const fit = fitExperimentalPeriodicUVectorSamplesWithFixedFirst(du, ku, mu, trainSamples, fixedFirst)
    evidence.fit = { fixedFirst, freeRank: fit.rank, expectedFreeRank: nu - 1, pivotRatio: fit.pivotRatio }
    if (fit.rank !== nu - 1) fail('rango libero insufficiente', 'free-rank-deficient')
    if (!(fit.pivotRatio >= budgets.minimumPivotRatio)) fail('rapporto dei pivot sotto budget', 'pivot-ratio-below-budget')
    for (const [i, value] of fit.residuals.entries())
      evidence.maxTrainingResidual = maximum(evidence.maxTrainingResidual, value, locationOf(trainSamples[i]))
    if (evidence.maxTrainingResidual!.value > budgets.trainingDerivativeResidual) {
      location = evidence.maxTrainingResidual!.at
      fail('residuo campionato del fit oltre budget', 'training-residual-exceeds-budget')
    }
    const basis = prepareExperimentalPeriodicUBasis(du, ku, mu)
    for (const sample of interior) {
      const { indices, values } = basis.evaluate(sample.parameter)
      const fitted = sample.value.map((_, axis) => indices.reduce((sum, index, i) =>
        sum + values[i] * fit.coefficients[index][axis], 0)) as Point
      location = locationOf(sample)
      const residual = distance(fitted, sample.value)
      if (!Number.isFinite(residual)) fail('residuo holdout non rappresentabile')
      evidence.maxFittedHoldoutResidual = maximum(evidence.maxFittedHoldoutResidual, residual, location)
    }
    if (evidence.maxFittedHoldoutResidual!.value > budgets.holdoutDerivativeResidual) {
      location = evidence.maxFittedHoldoutResidual!.at
      fail('residuo holdout del fit oltre budget', 'fitted-holdout-residual-exceeds-budget')
    }

    phase = 'proposal'
    location = undefined
    const result = proposeExperimentalPeriodicAlmostC1QuinticSide({
      net: lateral.net, edge: lateral.edge, targetInward: fit.coefficients, lockIndices,
      derivativeTolerance: budgets.storageDerivativeResidual, secondDerivativeTolerance: budgets.secondDerivativeChange,
      seamDerivativeTolerance: budgets.seamDerivativeGap,
    })
    if (result.status === 'inconclusive') {
      phase = result.phase
      if (result.phase === 'candidate-seam') evidence.candidateSeam = result.after
      const reason = result.phase === 'source-seam' ? result.before.reason : result.after.reason
      return stop('inconclusive', reason, seamReasonCode(reason))
    }
    const { net: candidate, changedIndices, maxDerivativeResidualBound, maxSecondDerivativeChangeBound,
      maxPositionDisplacementBound } = result.proposal
    evidence.candidateSeam = result.after
    evidence.proposal = { changedIndices, maxDerivativeResidualBound, maxSecondDerivativeChangeBound, maxPositionDisplacementBound }
    if (maxPositionDisplacementBound > budgets.displacement)
      return stop('inconclusive', 'limite di spostamento oltre budget', 'displacement-bound-exceeds-budget')

    phase = 'holdout'
    // The stored proposal preserves the boundary curve exactly, retaining
    // the sampled gap values. Evaluate its actual derivative and normal.
    const before = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(lateral.net)
    const after = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(candidate)
    const neighbor = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(support.net)
    const lateralU = signU(lateral.uAtEdgeEnds), supportU = signU(support.uAtEdgeEnds)
    const lateralV = signV(lateral.edge), supportV = signV(support.edge)
    const originalV = vAt(lateral), neighborV = vAt(support)
    for (const [i, sample] of holdoutSamples.entries()) {
      const sides: (Side | undefined)[] = i === 0 ? ['left', 'right'] : [undefined]
      for (const side of sides) {
        location = { ...locationOf(sample), seamSide: side }
        const lateralSides = side === undefined ? {} : { u: mappedSide(side, lateralU) }
        const supportSides = side === undefined ? {} : { u: mappedSide(side, supportU) }
        const old = before.evaluate(sample.parameter, originalV, lateralSides)
        const stored = after.evaluate(sample.parameter, originalV, lateralSides)
        const fixed = neighbor.evaluate(sample.supportParameter, neighborV, supportSides)
        const target = fixed.dv.map(value => -lambda * supportV * value) as Point
        const inward = stored.dv.map(value => lateralV * value) as Point
        const residual = distance(inward, target)
        if (!Number.isFinite(residual)) fail('residuo del candidato non rappresentabile')
        evidence.maxStoredHoldoutResidual = maximum(evidence.maxStoredHoldoutResidual, residual, location)
        if (residual > budgets.holdoutDerivativeResidual)
          fail('residuo campionato del candidato oltre budget', 'stored-holdout-residual-exceeds-budget')

        const reference = unit(fixed.normal, -supportU * supportV, budgets.minimumSampledNormalNorm)
        const original = unit(old.normal, lateralU * lateralV, budgets.minimumSampledNormalNorm)
        const proposed = unit(stored.normal, lateralU * lateralV, budgets.minimumSampledNormalNorm)
        const chord = distance(proposed, reference)
        const dot = proposed.reduce((sum, value, axis) => sum + value * reference[axis], 0)
        evidence.originalJointNormalChord = maximum(evidence.originalJointNormalChord, distance(original, reference), location)
        evidence.candidateJointNormalChord = maximum(evidence.candidateJointNormalChord, chord, location)
        if (evidence.minimumCandidateNormalDot === undefined || dot < evidence.minimumCandidateNormalDot.value)
          evidence.minimumCandidateNormalDot = { value: dot, at: location }
        if (!(dot > 0) || chord > budgets.jointNormalChord)
          fail('normali campionate al giunto oltre budget o discordi', 'joint-normals-refused')
      }
    }
    return { status: 'diagnostic-only' as const, evidence, evidenceScope, candidate }
  } catch (error) {
    return stop('declined', error instanceof Error ? error.message : 'diagnostica non completata',
      error instanceof GateFailure ? error.reasonCode : undefined)
  }
}

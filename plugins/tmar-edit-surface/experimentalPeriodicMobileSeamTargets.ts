// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { diagnoseExperimentalPeriodicGeometricJoint, type ExperimentalPeriodicGeometricJointRequest } from './experimentalPeriodicGeometricJoint'
import { solveExperimentalPeriodicMobileSeamLeastSquares, type SparseRow } from './experimentalPeriodicMobileSeamLeastSquares'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from './experimentalPeriodicOneSidedSurfaceDerivatives'
import { boundExperimentalPeriodicSeamDerivativeGap } from './experimentalPeriodicSeamDerivativeGap'
import { sampleExperimentalPeriodicTransverseDerivatives } from './experimentalPeriodicTransverseSamples'
import { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'

type Sampler = Parameters<typeof sampleExperimentalPeriodicTransverseDerivatives>[0]
type Sample = ReturnType<typeof sampleExperimentalPeriodicTransverseDerivatives>['samples'][number]
type SeamSide = 'left' | 'right'
type Edge = 'V0' | 'V1'
type PointBudgets = Omit<ExperimentalPeriodicGeometricJointRequest, 'lateralTangent' | 'supportTangent' | 'lateralInward' | 'supportInward'>
type Location = { edgeParameter: number; seamSide?: SeamSide }

export interface ExperimentalPeriodicMobileSeamTargetsRequest extends Pick<Sampler, 'strip' | 'support' | 'edgePeriod'> {
  training: readonly number[]
  holdout: readonly number[]
  budgets: PointBudgets & {
    sampledPositionGap: number
    seamDerivativeGap: number
    maximumTrainingNormalResidual: number
    maximumHoldoutNormalResidual: number
    maximumCoefficientChange: number
    regularization: number
    maxIterations: number
    relativeStationarityTolerance: number
    maxFreeColumns: number
    /** Select augmented QR with an explicit factorization work cap. */
    augmentedQrMaxUpdates?: number
  }
}

const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const directed = (v: Point, scale: number) => v.map(x => x * scale) as Point
const uSign = ({ uAtEdgeEnds: [a, b] }: Sampler['strip']) => a < b ? 1 : -1
const vSign = (edge: Edge) => edge === 'V0' ? 1 : -1
const edgeV = ({ net, edge }: Sampler['strip']) => edge === 'V0' ? net.kv[0] : net.kv.at(-1)!
const nativeSide = (side: SeamSide | undefined, sign: number) => side === undefined || sign > 0 ? side : side === 'left' ? 'right' : 'left'

/**
 * Fit sampled normal residuals using every free lateral derivative column.
 * U0's change is eliminated as a width-weighted mean of its neighbors.
 * Both one-sided seam observations enter training and are rechecked, while
 * the independent interior holdout uses each surface's native rounded map.
 * Residual limits cover both the central normal objective and the diagnostic
 * plane formed with the lateral tangent when the tangents differ slightly.
 * Scale and normal thresholds veto the evaluated result; this least-squares
 * solve uses no inequality optimization. Returned vectors are unstored
 * targets. Storage, seam-jump exactness, D², movement and interior normals
 * require a separate proposal and verification.
 */
export function solveExperimentalPeriodicMobileSeamTargets(request: ExperimentalPeriodicMobileSeamTargetsRequest) {
  const evidenceScope = 'sampled-mobile-seam-normal-residual-targets' as const
  let phase: 'preflight' | 'seam-gap' | 'sampling' | 'fit' | 'training' | 'holdout' = 'preflight'
  const evidence: { iterations?: number; relativeStationarityResidual?: number; freeColumns?: number;
    convergence?: ReturnType<typeof solveExperimentalPeriodicMobileSeamLeastSquares>['convergence'];
    maximumCoefficientChange?: number; maxTrainingNormalResidual?: number; maxHoldoutNormalResidual?: number;
    checkedTraining?: number; checkedHoldout?: number; minimumScale?: number } = {}
  const stop = (reasonCode: string, at?: Location) => ({ status: 'inconclusive' as const, phase, reasonCode, at, evidence, evidenceScope })
  try {
    if (!request?.strip?.net || !request.support?.net || !request.budgets) return stop('invalid-input')
    const { strip, support, edgePeriod, budgets } = request, { net } = strip
    if (net === support.net || net.dv !== 5 || net.du > 3 || net.mu[0] !== net.du || net.nu < 3 ||
        ![strip, support].every(side => side.net.mu.slice(1, -1).every(m => m < side.net.du)) ||
        ![budgets.sampledPositionGap, budgets.seamDerivativeGap, budgets.maximumTrainingNormalResidual,
          budgets.maximumHoldoutNormalResidual, budgets.maximumCoefficientChange].every(x => Number.isFinite(x) && x >= 0) ||
        ![budgets.regularization, budgets.relativeStationarityTolerance, budgets.minimumPositiveScale].every(x => Number.isFinite(x) && x > 0 && x <= 1) ||
        ![budgets.minimumTangentNorm, budgets.minimumTransverseNorm].every(x => Number.isFinite(x) && x > 0) ||
        ![budgets.maximumTangentChord, budgets.maximumNormalChord].every(x => Number.isFinite(x) && x >= 0 && x <= 2) ||
        !Number.isInteger(budgets.maxIterations) || budgets.maxIterations < 1 || budgets.maxIterations > 512 ||
        !Number.isInteger(budgets.maxFreeColumns) || budgets.maxFreeColumns < 2 || budgets.maxFreeColumns > 256)
      return stop('invalid-input')
    const freeColumns = evidence.freeColumns = net.nu - 1
    if (freeColumns > budgets.maxFreeColumns) return stop('column-budget')

    phase = 'seam-gap'
    if (boundExperimentalPeriodicSeamDerivativeGap(net, budgets.seamDerivativeGap).status !== 'within-tolerance')
      return stop('source-seam-unverified')
    if (support.net.mu[0] === support.net.du &&
        boundExperimentalPeriodicSeamDerivativeGap(support.net, budgets.seamDerivativeGap).status !== 'within-tolerance')
      return stop('support-seam-unverified')

    phase = 'sampling'
    const sampler = { strip, support, edgePeriod, lambda: 1, positionTolerance: budgets.sampledPositionGap }
    const training = sampleExperimentalPeriodicTransverseDerivatives({ ...sampler, edgeParameters: request.training }).samples.slice(0, -1)
    const holdout = sampleExperimentalPeriodicTransverseDerivatives({ ...sampler, edgeParameters: request.holdout }).samples.slice(1, -1)
    const usedLateral = new Set(training.map(s => s.parameter)), usedSupport = new Set(training.map(s => s.supportParameter))
    const alias = holdout.find(s => usedLateral.has(s.parameter) || usedSupport.has(s.supportParameter))
    if (alias) return stop('mapped-training-holdout-alias', { edgeParameter: alias.edgeParameter })
    const basis = prepareExperimentalPeriodicUBasis(net.du, net.ku, net.mu)
    const lateral = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(net)
    const central = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(support.net)
    const lateralU = uSign(strip), supportU = uSign(support), lateralV = vSign(strip.edge), supportV = vSign(support.edge)
    const v = edgeV(strip), w = edgeV(support)
    const forward = net.ku[1] - net.ku[0], backward = net.ku.at(-1)! - net.ku.at(-2)!, spanScale = Math.max(forward, backward)
    const a = forward / spanScale, b = backward / spanScale, previousWeight = a / (a + b), nextWeight = b / (a + b)
    if (!(previousWeight > 0 && nextWeight > 0)) return stop('seam-weights-unrepresentable')
    const sampleJets = (sample: Sample, seamSide?: SeamSide) => {
      const m = lateral.evaluate(sample.parameter, v, { u: nativeSide(seamSide, lateralU) })
      const s = central.evaluate(sample.supportParameter, w, { u: nativeSide(seamSide, supportU) })
      const referenceNormal = directed(s.normal, -supportU * supportV)
      const normalNorm = Math.hypot(...referenceNormal)
      if (!(normalNorm > 0) || !Number.isFinite(normalNorm)) throw new Error('Normale di riferimento non rappresentabile')
      const normal = referenceNormal.map(value => value / normalNorm) as Point
      return { at: { edgeParameter: sample.edgeParameter, seamSide }, weights: basis.evaluate(sample.parameter),
        geometry: { ...budgets, lateralTangent: directed(m.du, lateralU), supportTangent: directed(s.du, supportU),
          lateralInward: directed(m.dv, lateralV), supportInward: directed(s.dv, supportV) }, normal }
    }
    const fittedJets = [sampleJets(training[0], 'left'), sampleJets(training[0], 'right'), ...training.slice(1).map(sample => sampleJets(sample))]
    const heldJets = holdout.map(sample => sampleJets(sample))
    const rows: SparseRow[] = []
    for (const { geometry, normal, weights, at } of fittedJets) {
      const source = diagnoseExperimentalPeriodicGeometricJoint({ ...geometry, maximumNormalChord: 2 })
      if (source.status !== 'sample-diagnostic' || source.classification === 'orientation-mismatch') return stop('source-orientation-unverified', at)
      const reduced = new Map<number, number>()
      const add = (column: number, value: number) => reduced.set(column, (reduced.get(column) ?? 0) + value)
      for (const [j, index] of weights.indices.entries()) {
        const weight = weights.values[j]
        if (index === 0) { add(0, nextWeight * weight); add(freeColumns - 1, previousWeight * weight) }
        else add(index - 1, weight)
      }
      const entries = [...reduced.entries()].flatMap(([column, weight]) => normal.map((component, axis) => ({ column: column * 3 + axis,
        weight: component * weight })))
      const value = -dot(normal, geometry.lateralInward)
      if (!Number.isFinite(value)) return stop('reference-residual-unrepresentable', at)
      rows.push({ entries, value })
    }

    phase = 'fit'
    const fit = solveExperimentalPeriodicMobileSeamLeastSquares(rows, freeColumns, previousWeight, nextWeight,
      budgets.regularization, budgets.maxIterations, budgets.relativeStationarityTolerance, budgets.augmentedQrMaxUpdates)
    evidence.iterations = fit.iterations
    evidence.convergence = fit.convergence
    if (fit.status !== 'solved') return stop(fit.reason)
    evidence.relativeStationarityResidual = fit.relativeStationarityResidual
    const direction = lateralV, edgeRow = strip.edge === 'V0' ? 0 : net.nv - 1
    const vSpan = strip.edge === 'V0' ? 0 : net.kv.length - 2
    const factor = 5 / (net.kv[vSpan + 1] - net.kv[vSpan])
    const coefficients: Point[] = []
    let maximumChange = 0
    for (let u = 0; u < net.nu; u++) {
      const index = u * net.nv + edgeRow, point = net.poles[index]
      const before = point.map((value, axis) => factor * (net.poles[index + direction][axis] - value)) as Point
      const after = before.map((value, axis) => value + (u === 0 ? nextWeight * fit.changes[axis] +
        previousWeight * fit.changes[3 * (freeColumns - 1) + axis] : fit.changes[3 * (u - 1) + axis])) as Point
      if (!after.every(Number.isFinite)) return stop('target-coefficient-unrepresentable')
      maximumChange = Math.max(maximumChange, Math.hypot(...after.map((value, axis) => value - before[axis])))
      coefficients.push(after)
    }
    if (!Number.isFinite(maximumChange)) return stop('target-coefficient-unrepresentable')
    evidence.maximumCoefficientChange = maximumChange
    if (maximumChange > budgets.maximumCoefficientChange) return stop('coefficient-change-beyond-budget')

    for (const [group, observations, tolerance] of [['training', fittedJets, budgets.maximumTrainingNormalResidual],
      ['holdout', heldJets, budgets.maximumHoldoutNormalResidual]] as const) {
      phase = group
      for (const { geometry, normal, weights, at } of observations) {
        const inward = [0, 1, 2].map(axis => weights.indices.reduce((sum, index, j) => sum + weights.values[j] * coefficients[index][axis], 0)) as Point
        const diagnostic = diagnoseExperimentalPeriodicGeometricJoint({ ...geometry, lateralInward: inward })
        if (diagnostic.status !== 'sample-diagnostic') return stop('target-diagnostic-inconclusive', at)
        const residual = Math.max(Math.abs(diagnostic.signedNormalResidual), Math.abs(dot(normal, inward)))
        if (!Number.isFinite(residual)) return stop('target-residual-unrepresentable', at)
        if (group === 'training') {
          evidence.checkedTraining = (evidence.checkedTraining ?? 0) + 1
          evidence.maxTrainingNormalResidual = Math.max(evidence.maxTrainingNormalResidual ?? 0, residual)
        } else {
          evidence.checkedHoldout = (evidence.checkedHoldout ?? 0) + 1
          evidence.maxHoldoutNormalResidual = Math.max(evidence.maxHoldoutNormalResidual ?? 0, residual)
        }
        evidence.minimumScale = Math.min(evidence.minimumScale ?? Infinity, diagnostic.lambda)
        if (diagnostic.classification !== 'within-sampled-normal-budget' || !(diagnostic.lambda >= budgets.minimumPositiveScale) ||
            !(residual <= tolerance)) return stop('target-joint-beyond-budget', at)
      }
    }
    return { status: 'targets-only' as const, coefficients, evidence, evidenceScope }
  } catch { return stop('target-evaluation-refused') }
}

type PairSide = Omit<ExperimentalPeriodicMobileSeamTargetsRequest, 'support'> & { centralUAtEdgeEnds: Sampler['support']['uAtEdgeEnds'] }
export interface ExperimentalPeriodicMobileSeamPairTargetsRequest {
  central: Net
  atCentralV0: PairSide
  atCentralV1: PairSide
}

/** Return both unstored target fields together after both sampled solves. */
export function solveExperimentalPeriodicMobileSeamPairTargets(request: ExperimentalPeriodicMobileSeamPairTargetsRequest) {
  const evidenceScope = 'two-lateral-sampled-mobile-seam-targets' as const
  type SideResult = ReturnType<typeof solveExperimentalPeriodicMobileSeamTargets>
  type Receipt = Omit<Extract<SideResult, { status: 'targets-only' }>, 'coefficients'> |
    Exclude<SideResult, { status: 'targets-only' }> | { status: 'not-run' }
  const receipts: Record<Edge, Receipt> = { V0: { status: 'not-run' }, V1: { status: 'not-run' } }
  if (!request?.central || !request.atCentralV0?.strip?.net || !request.atCentralV1?.strip?.net)
    return { status: 'inconclusive' as const, stop: { reasonCode: 'pair-missing-input' }, receipts, evidenceScope }
  const { central, atCentralV0, atCentralV1 } = request
  if (atCentralV0.strip.net === atCentralV1.strip.net || atCentralV0.strip.net === central || atCentralV1.strip.net === central)
    return { status: 'inconclusive' as const, stop: { reasonCode: 'pair-aliased-input' }, receipts, evidenceScope }
  const run = ({ centralUAtEdgeEnds, ...side }: PairSide, edge: Edge) =>
    solveExperimentalPeriodicMobileSeamTargets({ ...side, support: { net: central, edge, uAtEdgeEnds: centralUAtEdgeEnds } })
  const stopped = (side: Edge, result: Exclude<SideResult, { status: 'targets-only' }>) => {
    receipts[side] = result
    return { status: 'inconclusive' as const, stop: { side, phase: result.phase, reasonCode: result.reasonCode }, receipts, evidenceScope }
  }
  const first = run(atCentralV0, 'V0')
  if (first.status !== 'targets-only') return stopped('V0', first)
  const { coefficients: V0, ...firstReceipt } = first
  receipts.V0 = firstReceipt
  const last = run(atCentralV1, 'V1')
  if (last.status !== 'targets-only') return stopped('V1', last)
  const { coefficients: V1, ...lastReceipt } = last
  receipts.V1 = lastReceipt
  return { status: 'targets-only' as const, targets: { V0, V1 }, receipts, evidenceScope }
}

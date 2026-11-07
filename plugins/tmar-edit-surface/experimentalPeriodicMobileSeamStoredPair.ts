// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { diagnoseExperimentalPeriodicGeometricJoint } from './experimentalPeriodicGeometricJoint'
import { experimentalCoefficientChangeWithinCap } from './experimentalPeriodicMobileSeamConstrained'
import { solveExperimentalPeriodicMobileSeamPairTargets, type ExperimentalPeriodicMobileSeamPairTargetsRequest } from './experimentalPeriodicMobileSeamTargets'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from './experimentalPeriodicOneSidedSurfaceDerivatives'
import { proposeExperimentalPeriodicQuinticFullCoordinatedSeam, proposeExperimentalPeriodicQuinticSurfaceBoundSeam,
  type ExperimentalPeriodicQuinticFullCoordinatedSeamRequest, type ExperimentalPeriodicQuinticSurfaceBoundSeamRequest } from './experimentalPeriodicQuinticSide'
import { boundExperimentalPeriodicSeamDerivativeGap } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { sampleExperimentalPeriodicTransverseDerivatives } from './experimentalPeriodicTransverseSamples'

type Edge = 'V0' | 'V1'
type SeamSide = 'left' | 'right'
type ProposalInput = Pick<ExperimentalPeriodicQuinticFullCoordinatedSeamRequest, 'net' | 'edge' | 'targetInward' | 'seamDerivativeTolerance'>
type Side = ExperimentalPeriodicMobileSeamPairTargetsRequest['atCentralV0'] & {
  storage: Omit<ExperimentalPeriodicQuinticFullCoordinatedSeamRequest, keyof ProposalInput>
}
type JointSide = Pick<Side, 'strip' | 'centralUAtEdgeEnds' | 'edgePeriod' | 'training' | 'holdout'> & {
  budgets: Omit<Side['budgets'], 'regularization' | 'maxIterations' | 'relativeStationarityTolerance' | 'maxFreeColumns' |
    'augmentedQrMaxUpdates' | 'constrainedAdmm'>
}
type SurfaceBoundSide = JointSide & {
  storage: Omit<ExperimentalPeriodicQuinticSurfaceBoundSeamRequest, keyof ProposalInput>
  targetInward: readonly Point[]
}
type Proposal = Extract<ReturnType<typeof proposeExperimentalPeriodicQuinticFullCoordinatedSeam>, { status: 'coefficient-proposal' }>['proposal']
type StorageResult<E> = { status: 'coefficient-proposal'; proposal: Proposal; evidence: E } |
  { status: 'inconclusive'; phase: string; reason: string; evidence: E }

export interface ExperimentalPeriodicMobileSeamStoredPairRequest {
  central: Net
  atCentralV0: Side
  atCentralV1: Side
}

const uSign = ([first, last]: readonly [number, number]) => first < last ? 1 : -1
const vSign = (edge: Edge) => edge === 'V0' ? 1 : -1
const edgeV = (net: Net, edge: Edge) => edge === 'V0' ? net.kv[0] : net.kv.at(-1)!
const directed = (v: Point, scale: number) => v.map(value => value * scale) as Point
const nativeSide = (side: SeamSide | undefined, sign: number) => side === undefined || sign > 0 ? side : side === 'left' ? 'right' : 'left'

function storeSide<S, E>(central: Net, edge: Edge, side: JointSide & { storage: S }, targetInward: readonly Point[],
  propose: (request: S & ProposalInput) => StorageResult<E>,
) {
  const evidence: {
    storage?: E
    storagePhase?: string
    changedIndices?: number[]
    maxDerivativeResidualBound?: number
    maxSecondDerivativeChangeBound?: number
    checkedTraining?: number
    checkedHoldout?: number
    maxTrainingNormalResidual?: number
    maxHoldoutNormalResidual?: number
  } = {}
  let phase: 'storage' | 'stored-training' | 'stored-holdout' = 'storage'
  const stop = (reasonCode: string, at?: { edgeParameter: number; seamSide?: SeamSide }) =>
    ({ status: 'inconclusive' as const, phase, reasonCode, at, evidence })
  try {
    const { strip: original, budgets, storage } = side
    if (!storage) return stop('storage-budget-required')
    const stored = propose({ ...storage, net: original.net, edge: original.edge,
      seamDerivativeTolerance: budgets.seamDerivativeGap, targetInward })
    evidence.storage = stored.evidence
    if (stored.status !== 'coefficient-proposal') {
      evidence.storagePhase = stored.phase
      return stop(stored.reason)
    }
    const candidate = stored.proposal.net
    evidence.changedIndices = stored.proposal.changedIndices
    evidence.maxDerivativeResidualBound = stored.proposal.maxDerivativeResidualBound
    evidence.maxSecondDerivativeChangeBound = stored.proposal.maxSecondDerivativeChangeBound
    const strip = { ...original, net: candidate }, support = { net: central, edge, uAtEdgeEnds: side.centralUAtEdgeEnds }
    const mapping = { strip, support, edgePeriod: side.edgePeriod, lambda: 1, positionTolerance: budgets.sampledPositionGap }
    phase = 'stored-training'
    const training = sampleExperimentalPeriodicTransverseDerivatives({ ...mapping, edgeParameters: side.training }).samples.slice(0, -1)
    phase = 'stored-holdout'
    const holdout = sampleExperimentalPeriodicTransverseDerivatives({ ...mapping, edgeParameters: side.holdout }).samples.slice(1, -1)
    const usedLateral = new Set(training.map(s => s.parameter)), usedSupport = new Set(training.map(s => s.supportParameter))
    const alias = holdout.find(s => usedLateral.has(s.parameter) || usedSupport.has(s.supportParameter))
    if (alias) return stop('mapped-training-holdout-alias', { edgeParameter: alias.edgeParameter })
    const lateral = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(candidate)
    const fixed = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(central)
    const lateralU = uSign(strip.uAtEdgeEnds), supportU = uSign(support.uAtEdgeEnds)
    const lateralV = vSign(strip.edge), supportV = vSign(support.edge)
    for (const [group, samples, tolerance] of [['stored-training', training, budgets.maximumTrainingNormalResidual],
      ['stored-holdout', holdout, budgets.maximumHoldoutNormalResidual]] as const) {
      phase = group
      for (const [index, sample] of samples.entries()) {
        const sides: (SeamSide | undefined)[] = group === 'stored-training' && index === 0 ? ['left', 'right'] : [undefined]
        for (const seamSide of sides) {
          const a = lateral.evaluate(sample.parameter, edgeV(candidate, strip.edge), { u: nativeSide(seamSide, lateralU) })
          const b = fixed.evaluate(sample.supportParameter, edgeV(central, support.edge), { u: nativeSide(seamSide, supportU) })
          const inward = directed(a.dv, lateralV)
          const diagnostic = diagnoseExperimentalPeriodicGeometricJoint({ ...budgets,
            lateralTangent: directed(a.du, lateralU), supportTangent: directed(b.du, supportU),
            lateralInward: inward, supportInward: directed(b.dv, supportV),
          })
          const at = { edgeParameter: sample.edgeParameter, seamSide }
          if (diagnostic.status !== 'sample-diagnostic') return stop('stored-joint-diagnostic-inconclusive', at)
          const normalNorm = Math.hypot(...b.normal)
          if (!(normalNorm > 0) || !Number.isFinite(normalNorm)) return stop('stored-normal-unrepresentable', at)
          const centralResidual = b.normal.reduce((sum, value, axis) => sum + (value / normalNorm) * inward[axis], 0)
          const residual = Math.max(Math.abs(diagnostic.signedNormalResidual), Math.abs(centralResidual))
          if (!Number.isFinite(residual)) return stop('stored-residual-unrepresentable', at)
          if (group === 'stored-training') {
            evidence.checkedTraining = (evidence.checkedTraining ?? 0) + 1
            evidence.maxTrainingNormalResidual = Math.max(evidence.maxTrainingNormalResidual ?? 0, residual)
          } else {
            evidence.checkedHoldout = (evidence.checkedHoldout ?? 0) + 1
            evidence.maxHoldoutNormalResidual = Math.max(evidence.maxHoldoutNormalResidual ?? 0, residual)
          }
          if (diagnostic.classification !== 'within-sampled-normal-budget' || !(diagnostic.lambda >= budgets.minimumPositiveScale) ||
              !(residual <= tolerance)) return stop('stored-joint-beyond-budget', at)
        }
      }
    }
    return { status: 'diagnostic-only' as const, candidate, evidence }
  } catch { return stop('stored-evaluation-refused') }
}

/** Solve both full target fields, store them under the exact seam guard and recheck the actual joint jets. */
export function solveAndStoreExperimentalPeriodicMobileSeamPair(request: ExperimentalPeriodicMobileSeamStoredPairRequest) {
  const evidenceScope = 'two-lateral-mobile-seam-stored-coefficients-and-sampled-joints' as const
  const fitted = solveExperimentalPeriodicMobileSeamPairTargets(request)
  const fitReceipts = fitted.receipts
  const legacyStore = (edge: Edge, side: Side, target: readonly Point[]) =>
    storeSide(request.central, edge, side, target, proposeExperimentalPeriodicQuinticFullCoordinatedSeam)
  type SideResult = ReturnType<typeof legacyStore>
  type Receipt = Omit<Extract<SideResult, { status: 'diagnostic-only' }>, 'candidate'> |
    Exclude<SideResult, { status: 'diagnostic-only' }> | { status: 'not-run' }
  const receipts: Record<Edge, Receipt> = { V0: { status: 'not-run' }, V1: { status: 'not-run' } }
  if (fitted.status !== 'targets-only') return { status: 'inconclusive' as const,
    stop: { stage: 'targets' as const, ...fitted.stop }, fitReceipts, receipts, evidenceScope }
  const stopped = (side: Edge, result: Exclude<SideResult, { status: 'diagnostic-only' }>) => {
    receipts[side] = result
    return { status: 'inconclusive' as const, stop: { side, phase: result.phase, reasonCode: result.reasonCode }, fitReceipts, receipts, evidenceScope }
  }
  const first = legacyStore('V0', request.atCentralV0, fitted.targets.V0)
  if (first.status !== 'diagnostic-only') return stopped('V0', first)
  const { candidate: V0, ...firstReceipt } = first
  receipts.V0 = firstReceipt
  const last = legacyStore('V1', request.atCentralV1, fitted.targets.V1)
  if (last.status !== 'diagnostic-only') return stopped('V1', last)
  const { candidate: V1, ...lastReceipt } = last
  receipts.V1 = lastReceipt
  return { status: 'diagnostic-only' as const, candidates: { V0, V1 }, fitReceipts, receipts, evidenceScope }
}

function validateSurfaceBoundSide(central: Net, side: SurfaceBoundSide) {
  const { budgets, strip: { net, edge }, targetInward } = side
  validateExperimentalPeriodicSurfaceU(net)
  if (central.weights.some(w => w !== 1) || central.mu.slice(1, -1).some(m => m >= central.du) ||
      ![budgets.sampledPositionGap, budgets.seamDerivativeGap, budgets.maximumTrainingNormalResidual,
        budgets.maximumHoldoutNormalResidual, budgets.maximumCoefficientChange].every(x => Number.isFinite(x) && x >= 0) ||
      !(Number.isFinite(budgets.minimumPositiveScale) && budgets.minimumPositiveScale > 0 && budgets.minimumPositiveScale <= 1) ||
      !Array.isArray(targetInward) || targetInward.length !== net.nu || net.dv !== 5 || (edge !== 'V0' && edge !== 'V1'))
    return 'invalid-storage-only-input'
  if (central.mu[0] === central.du && boundExperimentalPeriodicSeamDerivativeGap(central, budgets.seamDerivativeGap).status !== 'within-tolerance')
    return 'support-seam-unverified'
  const direction = vSign(edge), edgeRow = edge === 'V0' ? 0 : net.nv - 1
  const vSpan = edge === 'V0' ? 0 : net.kv.length - 2
  const factor = 5 / (net.kv[vSpan + 1] - net.kv[vSpan])
  for (let u = 0; u < net.nu; u++) {
    const index = u * net.nv + edgeRow
    const before = net.poles[index].map((value, axis) => factor * (net.poles[index + direction][axis] - value)) as Point
    if (!experimentalCoefficientChangeWithinCap(before, targetInward[u], budgets.maximumCoefficientChange)) return 'coefficient-cap-unverified'
  }
}

/** Store externally supplied targets once and verify the stored coefficient models and sampled joint jets. */
export function storeExperimentalPeriodicMobileSeamSurfaceBoundPair(request: {
  central: Net; atCentralV0: SurfaceBoundSide; atCentralV1: SurfaceBoundSide
}) {
  const evidenceScope = 'two-lateral-surface-bound-storage-and-sampled-joints' as const
  const store = (edge: Edge, side: SurfaceBoundSide) =>
    storeSide(request.central, edge, side, side.targetInward, proposeExperimentalPeriodicQuinticSurfaceBoundSeam)
  type SideResult = ReturnType<typeof store>
  type Receipt = Omit<Extract<SideResult, { status: 'diagnostic-only' }>, 'candidate'> |
    Exclude<SideResult, { status: 'diagnostic-only' }> | { status: 'not-run' }
  const receipts: Record<Edge, Receipt> = { V0: { status: 'not-run' }, V1: { status: 'not-run' } }
  const stop = (phase: 'preflight' | 'storage' | 'stored-training' | 'stored-holdout', reasonCode: string, side?: Edge) =>
    ({ status: 'inconclusive' as const, stop: { side, phase, reasonCode }, receipts, evidenceScope })
  let checking: Edge | undefined
  try {
    const { central, atCentralV0, atCentralV1 } = request
    if (new Set([central, atCentralV0.strip.net, atCentralV1.strip.net]).size !== 3)
      return stop('preflight', 'aliased-nets')
    validateExperimentalPeriodicSurfaceU(central)
    const candidates = {} as Record<Edge, Net>
    for (const [edge, side] of [['V0', atCentralV0], ['V1', atCentralV1]] as const) {
      checking = edge
      const refusal = validateSurfaceBoundSide(central, side)
      if (refusal) return stop('preflight', refusal, edge)
      const result = store(edge, side)
      if (result.status !== 'diagnostic-only') {
        receipts[edge] = result
        return stop(result.phase, result.reasonCode, edge)
      }
      const { candidate, ...receipt } = result
      candidates[edge] = candidate
      receipts[edge] = receipt
    }
    return { status: 'diagnostic-only' as const, candidates, receipts, evidenceScope }
  } catch { return stop('preflight', 'invalid-storage-only-input', checking) }
}

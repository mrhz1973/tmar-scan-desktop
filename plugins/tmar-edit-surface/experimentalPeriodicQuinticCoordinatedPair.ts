// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { diagnoseExperimentalPeriodicGeometricJoint, type ExperimentalPeriodicGeometricJointRequest } from './experimentalPeriodicGeometricJoint'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from './experimentalPeriodicOneSidedSurfaceDerivatives'
import { proposeExperimentalPeriodicQuinticCoordinatedSeam, type ExperimentalPeriodicQuinticCoordinatedSeamRequest } from './experimentalPeriodicQuinticSide'
import { boundExperimentalPeriodicSeamDerivativeGap } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { sampleExperimentalPeriodicTransverseDerivatives } from './experimentalPeriodicTransverseSamples'

type Sampler = Parameters<typeof sampleExperimentalPeriodicTransverseDerivatives>[0]
type PointBudgets = Omit<ExperimentalPeriodicGeometricJointRequest, 'lateralTangent' | 'supportTangent' | 'lateralInward' | 'supportInward'>
type Edge = 'V0' | 'V1'
type SeamSide = 'left' | 'right'
type Location = { edgeParameter: number; seamSide?: SeamSide }
type SideRequest = Pick<Sampler, 'edgePeriod'> & {
  lateral: Sampler['strip']
  centralUAtEdgeEnds: Sampler['support']['uAtEdgeEnds']
  verificationParameters: readonly number[]
  move: Omit<ExperimentalPeriodicQuinticCoordinatedSeamRequest, 'net' | 'edge'>
  joint: PointBudgets & { sampledPositionGap: number; maximumNormalResidual: number }
}

export interface ExperimentalPeriodicQuinticCoordinatedPairRequest {
  central: Net
  atCentralV0: SideRequest
  atCentralV1: SideRequest
}

const uSign = (side: Sampler['strip']) => side.uAtEdgeEnds[0] < side.uAtEdgeEnds[1] ? 1 : -1
const vSign = (edge: Edge) => edge === 'V0' ? 1 : -1
const edgeV = ({ net, edge }: Sampler['strip']) => edge === 'V0' ? net.kv[0] : net.kv.at(-1)!
const directed = (v: Point, sign: number) => v.map(value => sign * value) as Point
const nativeSide = (side: SeamSide | undefined, sign: number) =>
  side === undefined || sign > 0 ? side : side === 'left' ? 'right' : 'left'

function measureSide(central: Net, edge: Edge, input: SideRequest) {
  const evidence: {
    supportSeam?: ReturnType<typeof boundExperimentalPeriodicSeamDerivativeGap> | { status: 'structurally-c1' }
    move?: ReturnType<typeof proposeExperimentalPeriodicQuinticCoordinatedSeam>['evidence']
    movePhase?: string
    changedIndices?: number[]
    joint?: { checked: number; maxGap: number; maxNormalChord: number; maxNormalResidual: number; minimumScale: number | null }
  } = {}
  let phase: 'preflight' | 'support-seam' | 'coordinated-move' | 'stored-joint' = 'preflight'
  const stop = (reasonCode: string, at?: Location) => ({ status: 'inconclusive' as const, phase, reasonCode, at, evidence })
  try {
    const { lateral, move, joint } = input
    if (!move || !joint || ![joint.sampledPositionGap, joint.maximumNormalResidual].every(x => Number.isFinite(x) && x >= 0) ||
        ![joint.minimumTangentNorm, joint.minimumTransverseNorm, joint.minimumPositiveScale].every(x => Number.isFinite(x) && x > 0) ||
        joint.minimumPositiveScale > 1 ||
        ![joint.maximumTangentChord, joint.maximumNormalChord].every(x => Number.isFinite(x) && x >= 0 && x <= 2))
      return stop('invalid-side-input')

    phase = 'support-seam'
    validateExperimentalPeriodicSurfaceU(central)
    if (central.weights.some(weight => weight !== 1)) return stop('support-weights-not-unit')
    if (central.mu.slice(1, -1).some(m => m >= central.du)) return stop('support-interior-crease')
    if (central.mu[0] === central.du) {
      const supportSeam = evidence.supportSeam = boundExperimentalPeriodicSeamDerivativeGap(central, move.seamDerivativeTolerance)
      if (supportSeam.status !== 'within-tolerance') return stop('support-seam-unverified')
    } else evidence.supportSeam = { status: 'structurally-c1' }

    phase = 'coordinated-move'
    const proposed = proposeExperimentalPeriodicQuinticCoordinatedSeam({ ...move, net: lateral.net, edge: lateral.edge })
    evidence.move = proposed.evidence
    if (proposed.status !== 'coefficient-proposal') {
      evidence.movePhase = proposed.phase
      return stop(proposed.reason)
    }
    evidence.changedIndices = proposed.proposal.changedIndices

    phase = 'stored-joint'
    const candidate = proposed.proposal.net
    const strip = { ...lateral, net: candidate }, support = { net: central, edge, uAtEdgeEnds: input.centralUAtEdgeEnds }
    // Reuse the positional and full-period mapping checks. The sampler's
    // equal-derivative value is discarded: all checks use the stored jets.
    const mapped = sampleExperimentalPeriodicTransverseDerivatives({ strip, support, edgePeriod: input.edgePeriod,
      edgeParameters: input.verificationParameters, lambda: 1, positionTolerance: joint.sampledPositionGap,
    })
    const lateralJet = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(candidate)
    const supportJet = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(central)
    const jointEvidence: NonNullable<typeof evidence.joint> = evidence.joint = { checked: 0, maxGap: mapped.maxSampledGap, maxNormalChord: 0,
      maxNormalResidual: 0, minimumScale: null }
    for (const [index, sample] of mapped.samples.slice(0, -1).entries()) {
      const sides: (SeamSide | undefined)[] = index === 0 ? ['left', 'right'] : [undefined]
      for (const seamSide of sides) {
        const a = lateralJet.evaluate(sample.parameter, edgeV(strip), { u: nativeSide(seamSide, uSign(strip)) })
        const b = supportJet.evaluate(sample.supportParameter, edgeV(support), { u: nativeSide(seamSide, uSign(support)) })
        const diagnostic = diagnoseExperimentalPeriodicGeometricJoint({ ...joint,
          lateralTangent: directed(a.du, uSign(strip)), supportTangent: directed(b.du, uSign(support)),
          lateralInward: directed(a.dv, vSign(strip.edge)), supportInward: directed(b.dv, vSign(support.edge)),
        })
        const at = { edgeParameter: sample.edgeParameter, seamSide }
        if (diagnostic.status !== 'sample-diagnostic') return stop('stored-joint-diagnostic-inconclusive', at)
        const residual = Math.abs(diagnostic.signedNormalResidual)
        jointEvidence.checked++
        jointEvidence.maxNormalChord = Math.max(jointEvidence.maxNormalChord, diagnostic.normalChord)
        jointEvidence.maxNormalResidual = Math.max(jointEvidence.maxNormalResidual, residual)
        jointEvidence.minimumScale = jointEvidence.minimumScale === null ? diagnostic.lambda : Math.min(jointEvidence.minimumScale, diagnostic.lambda)
        if (diagnostic.classification !== 'within-sampled-normal-budget' || !(diagnostic.lambda >= joint.minimumPositiveScale) ||
            !(residual <= joint.maximumNormalResidual)) return stop('stored-joint-beyond-budget', at)
      }
    }
    return { status: 'diagnostic-only' as const, candidate, evidence }
  } catch { return stop('side-evaluation-refused') }
}

/**
 * Run two independent coordinated seam proposals against the unchanged
 * center, V0 first. Both candidates are exposed together only after both
 * stored joint grids pass. The exact seam jump and full-domain normals
 * are lateral coefficient checks. Joint checks cover the supplied samples
 * and both seam sides; continuous G1, pcurves and topology are separate.
 */
export function measureExperimentalPeriodicQuinticCoordinatedPair(request: ExperimentalPeriodicQuinticCoordinatedPairRequest) {
  type SideResult = ReturnType<typeof measureSide>
  type Receipt = Exclude<SideResult, { status: 'diagnostic-only' }> |
    Omit<Extract<SideResult, { status: 'diagnostic-only' }>, 'candidate'> | { status: 'not-run' }
  const receipts: Record<Edge, Receipt> = { V0: { status: 'not-run' }, V1: { status: 'not-run' } }
  const evidenceScope = 'two-lateral-coordinated-seams-and-sampled-geometric-joints' as const
  const preflight = (reasonCode: 'pair-missing-input' | 'pair-aliased-input') => ({ status: 'inconclusive' as const,
    stop: { phase: 'preflight' as const, reasonCode }, receipts, evidenceScope })
  if (!request?.central || !request.atCentralV0?.lateral?.net || !request.atCentralV1?.lateral?.net) return preflight('pair-missing-input')
  const { central, atCentralV0, atCentralV1 } = request
  const firstNet = atCentralV0.lateral.net, lastNet = atCentralV1.lateral.net
  if (firstNet === lastNet || firstNet === central || lastNet === central) return preflight('pair-aliased-input')
  const stopped = (side: Edge, result: Exclude<SideResult, { status: 'diagnostic-only' }>) => {
    receipts[side] = result
    return { status: 'inconclusive' as const, stop: { side, phase: result.phase, reasonCode: result.reasonCode }, receipts, evidenceScope }
  }
  const first = measureSide(central, 'V0', atCentralV0)
  if (first.status !== 'diagnostic-only') return stopped('V0', first)
  const { candidate: V0, ...firstReceipt } = first
  receipts.V0 = firstReceipt
  const last = measureSide(central, 'V1', atCentralV1)
  if (last.status !== 'diagnostic-only') return stopped('V1', last)
  const { candidate: V1, ...lastReceipt } = last
  receipts.V1 = lastReceipt
  return { status: 'diagnostic-only' as const, candidates: { V0, V1 }, receipts, evidenceScope }
}

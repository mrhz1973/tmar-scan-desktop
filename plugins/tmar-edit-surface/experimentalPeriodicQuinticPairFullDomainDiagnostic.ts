// SPDX-License-Identifier: AGPL-3.0-only
import { generateExperimentalPeriodicIndependentSamples,
  type ExperimentalPeriodicIndependentSamplesRequest } from './experimentalPeriodicIndependentSamples'
import { measureExperimentalPeriodicQuinticPair,
  type ExperimentalPeriodicQuinticPairDiagnosticRequest } from './experimentalPeriodicQuinticPairDiagnostic'
import { boundExperimentalPeriodicQuinticSurfaceNormals } from './experimentalPeriodicQuinticSurfaceNormals'

type PairRequest = ExperimentalPeriodicQuinticPairDiagnosticRequest
type Side = 'V0' | 'V1'
type NormalResult = ReturnType<typeof boundExperimentalPeriodicQuinticSurfaceNormals>
type SampleResult = ReturnType<typeof generateExperimentalPeriodicIndependentSamples>
type PairResult = ReturnType<typeof measureExperimentalPeriodicQuinticPair>
type JointStop = Extract<PairResult, { stop: unknown }>['stop']
type NotRun = { status: 'not-run' }

type SideRequest = Omit<PairRequest['atCentralV0'], 'training' | 'holdout'> & {
  sampleSearch: Pick<ExperimentalPeriodicIndependentSamplesRequest, 'training' | 'holdout' | 'searchDepth' | 'maxAttempts'>
  normalBudget: Parameters<typeof boundExperimentalPeriodicQuinticSurfaceNormals>[2]
}

export interface ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest {
  central: PairRequest['central']
  atCentralV0: SideRequest
  atCentralV1: SideRequest
}

type Stop = { stage: 'preflight'; reasonCode: 'pair-missing-input' | 'pair-aliased-input' } |
  { stage: 'sample-search' | 'surface-normals'; side: Side; reasonCode: string } |
  ({ stage: 'joint-diagnostic' } & JointStop)

/**
 * Generate the two sets of rounded native-U observations independently per
 * joint, run the pair diagnostic against the original center, then compare
 * each stored candidate to its own source in that lateral's native knot cells.
 * Each stage visits V0 before V1. Sample and normal work budgets are per side.
 * Both candidates are returned together only after both full-domain checks.
 *
 * The joint measurements are sampled. The interior proof compares source
 * and candidate normals within each closed polynomial cell, with one-sided
 * seam coverage. It leaves continuous joint quality, cross-cell agreement,
 * global injectivity and CAD validation to separate checks.
 */
export function measureExperimentalPeriodicQuinticPairFullDomain(request: ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest) {
  type SamplingReceipt = Omit<Extract<SampleResult, { status: 'generated' }>, 'training' | 'holdout'> |
    Extract<SampleResult, { status: 'inconclusive' }> | { status: 'declined' }
  const receipts = {
    sampling: { V0: { status: 'not-run' }, V1: { status: 'not-run' } } as Record<Side, SamplingReceipt | NotRun>,
    joint: { V0: { status: 'not-run' }, V1: { status: 'not-run' } } as PairResult['receipts'],
    normals: { V0: { status: 'not-run' }, V1: { status: 'not-run' } } as Record<Side, NormalResult | NotRun>,
  }
  const evidenceScope = 'two-lateral-coefficients-sampled-joints-and-full-domain-normal-comparison' as const
  const stopped = (status: 'declined' | 'inconclusive' | 'nonpositive-witness', stop: Stop) =>
    ({ status, stop, receipts, evidenceScope })
  if (!request?.central || !request.atCentralV0?.lateral?.net || !request.atCentralV1?.lateral?.net)
    return stopped('declined', { stage: 'preflight', reasonCode: 'pair-missing-input' })
  const { central, atCentralV0, atCentralV1 } = request
  const sources = { V0: atCentralV0.lateral.net, V1: atCentralV1.lateral.net }
  if (sources.V0 === sources.V1 || sources.V0 === central || sources.V1 === central)
    return stopped('declined', { stage: 'preflight', reasonCode: 'pair-aliased-input' })

  const prepared: Partial<Record<Side, PairRequest['atCentralV0']>> = {}
  const sides = [['V0', atCentralV0], ['V1', atCentralV1]] as const
  for (const [side, { sampleSearch, normalBudget: _normalBudget, ...input }] of sides) {
    let result: SampleResult
    try {
      result = generateExperimentalPeriodicIndependentSamples({ ...sampleSearch, edgePeriod: input.edgePeriod,
        lateral: { knots: sources[side].ku, uAtEdgeEnds: input.lateral.uAtEdgeEnds },
        support: { knots: central.ku, uAtEdgeEnds: input.centralUAtEdgeEnds },
      })
    } catch {
      receipts.sampling[side] = { status: 'declined' }
      return stopped('declined', { stage: 'sample-search', side, reasonCode: 'sample-search-refused' })
    }
    if (result.status !== 'generated') {
      receipts.sampling[side] = result
      return stopped('inconclusive', { stage: 'sample-search', side, reasonCode: result.reason })
    }
    const { training, holdout, ...receipt } = result
    receipts.sampling[side] = receipt
    prepared[side] = { ...input, training, holdout }
  }
  const joint = measureExperimentalPeriodicQuinticPair({ central, atCentralV0: prepared.V0!, atCentralV1: prepared.V1! })
  receipts.joint = joint.receipts
  if (joint.status !== 'diagnostic-only') return stopped(joint.status, { stage: 'joint-diagnostic', ...joint.stop })

  for (const [side, input] of sides) {
    const comparison = boundExperimentalPeriodicQuinticSurfaceNormals(sources[side], joint.candidates[side], input.normalBudget)
    receipts.normals[side] = comparison
    if (comparison.status === 'nonpositive-witness')
      return stopped('nonpositive-witness', { stage: 'surface-normals', side, reasonCode: 'nonpositive-normal-dot-witness' })
    if (comparison.status !== 'certified-positive')
      return stopped('inconclusive', { stage: 'surface-normals', side, reasonCode: comparison.reason })
  }
  return { status: 'diagnostic-only' as const, receipts, candidates: joint.candidates, evidenceScope }
}

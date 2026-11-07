// SPDX-License-Identifier: AGPL-3.0-only
import { generateExperimentalPeriodicIndependentSamples, generateExperimentalPeriodicObservedSamples,
  type ExperimentalPeriodicIndependentSamplesRequest,
  type ExperimentalPeriodicObservedSamplesRequest } from './experimentalPeriodicIndependentSamples'
import { measureExperimentalPeriodicQuinticPair, measureExperimentalPeriodicQuinticPairCertifiedFit,
  measureExperimentalPeriodicQuinticPairScaled,
  type ExperimentalPeriodicQuinticPairDiagnosticRequest,
  type ExperimentalPeriodicQuinticPairDiagnosticResult } from './experimentalPeriodicQuinticPairDiagnostic'
import type { ExperimentalPeriodicQuinticCertifiedFitBudgets,
  ExperimentalPeriodicQuinticScaledBudgets } from './experimentalPeriodicQuinticSideDiagnostic'
import { boundExperimentalPeriodicQuinticSurfaceNormals } from './experimentalPeriodicQuinticSurfaceNormals'

type DefaultBudgets = ExperimentalPeriodicQuinticPairDiagnosticRequest['atCentralV0']['budgets']
type PairRequest<Limits> = ExperimentalPeriodicQuinticPairDiagnosticRequest<Limits>
type Side = 'V0' | 'V1'
type NormalResult = ReturnType<typeof boundExperimentalPeriodicQuinticSurfaceNormals>
type IndependentSampleResult = ReturnType<typeof generateExperimentalPeriodicIndependentSamples>
type ObservedSampleResult = ReturnType<typeof generateExperimentalPeriodicObservedSamples>
type SampleResult = IndependentSampleResult | ObservedSampleResult
type PairResult<FitEvidence> = ExperimentalPeriodicQuinticPairDiagnosticResult<FitEvidence>
type JointStop = Extract<PairResult<unknown>, { stop: unknown }>['stop']
type NotRun = { status: 'not-run' }

type SampleSearch = Pick<ExperimentalPeriodicIndependentSamplesRequest, 'training' | 'holdout' | 'searchDepth' | 'maxAttempts'>
type ObservedSampleSearch = SampleSearch & {
  observation: Omit<ExperimentalPeriodicObservedSamplesRequest['observation'], 'degree' | 'multiplicities'>
}

type SideRequest<Limits, Search> = Omit<PairRequest<Limits>['atCentralV0'], 'training' | 'holdout'> & {
  sampleSearch: Search
  normalBudget: Parameters<typeof boundExperimentalPeriodicQuinticSurfaceNormals>[2]
}

export interface ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest<Limits = DefaultBudgets, Search = SampleSearch> {
  central: PairRequest<Limits>['central']
  atCentralV0: SideRequest<Limits, Search>
  atCentralV1: SideRequest<Limits, Search>
}

export type ExperimentalPeriodicQuinticPairFullDomainObservedCertifiedFitRequest =
  ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest<ExperimentalPeriodicQuinticCertifiedFitBudgets, ObservedSampleSearch>

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
  return measurePeriodicQuinticPairFullDomain(request, measureExperimentalPeriodicQuinticPair)
}

/**
 * Run the same joint and full-domain checks with the equilibrated solver.
 * Require separate per-side minimum RMS weight, raw norm ratio and scaled
 * pivot ratio, plus separate fitted and stored holdout limits. Those fit
 * diagnostics and holdout observations do not certify the continuous joint.
 */
export function measureExperimentalPeriodicQuinticPairFullDomainScaled(
  request: ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest<ExperimentalPeriodicQuinticScaledBudgets>,
) {
  return measurePeriodicQuinticPairFullDomain(request, measureExperimentalPeriodicQuinticPairScaled)
}

/**
 * Require a sampled least-squares coefficient certificate for each unscaled
 * fit before its proposal. The existing sampled joint and full-domain
 * lateral normal comparisons remain separate checks.
 */
export function measureExperimentalPeriodicQuinticPairFullDomainCertifiedFit(
  request: ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest<ExperimentalPeriodicQuinticCertifiedFitBudgets>,
) {
  return measurePeriodicQuinticPairFullDomain(request, measureExperimentalPeriodicQuinticPairCertifiedFit)
}

/**
 * Select a Gram-certified training grid independently for each lateral,
 * preserving its greedy holdout and span counts. The observation basis is
 * derived from the lateral being fitted. A certified baseline can be retained
 * by the selector. Every selected grid must still pass CertifiedFit and all
 * joint and normal checks before either stored candidate is exposed.
 */
export function measureExperimentalPeriodicQuinticPairFullDomainObservedCertifiedFit(
  request: ExperimentalPeriodicQuinticPairFullDomainObservedCertifiedFitRequest,
) {
  return measurePeriodicQuinticPairFullDomain(request, measureExperimentalPeriodicQuinticPairCertifiedFit,
    (input, search, lateral) => generateExperimentalPeriodicObservedSamples({ ...input,
      observation: { ...search.observation, degree: lateral.du, multiplicities: lateral.mu },
    }))
}

function measurePeriodicQuinticPairFullDomain<Limits, FitEvidence, Search extends SampleSearch>(
  request: ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest<Limits, Search>,
  diagnosePair: (input: PairRequest<Limits>) => PairResult<FitEvidence>,
  selectSamples: (input: ExperimentalPeriodicIndependentSamplesRequest, search: Search, lateral: PairRequest<Limits>['central']) =>
    SampleResult = generateExperimentalPeriodicIndependentSamples,
) {
  type SamplingReceipt = Omit<Extract<IndependentSampleResult, { status: 'generated' }>, 'training' | 'holdout'> & {
    observation?: Extract<ObservedSampleResult, { status: 'generated' }>['observation']
  } |
    Extract<SampleResult, { status: 'inconclusive' }> | { status: 'declined' }
  const receipts = {
    sampling: { V0: { status: 'not-run' }, V1: { status: 'not-run' } } as Record<Side, SamplingReceipt | NotRun>,
    joint: { V0: { status: 'not-run' }, V1: { status: 'not-run' } } as PairResult<FitEvidence>['receipts'],
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

  const prepared: Partial<Record<Side, PairRequest<Limits>['atCentralV0']>> = {}
  const sides = [['V0', atCentralV0], ['V1', atCentralV1]] as const
  for (const [side, { sampleSearch, normalBudget: _normalBudget, ...input }] of sides) {
    let result: SampleResult
    try {
      result = selectSamples({ ...sampleSearch, edgePeriod: input.edgePeriod,
        lateral: { knots: sources[side].ku, uAtEdgeEnds: input.lateral.uAtEdgeEnds },
        support: { knots: central.ku, uAtEdgeEnds: input.centralUAtEdgeEnds },
      }, sampleSearch, sources[side])
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
  const joint = diagnosePair({ central, atCentralV0: prepared.V0!, atCentralV1: prepared.V1! })
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

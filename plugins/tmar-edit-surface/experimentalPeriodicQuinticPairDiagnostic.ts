// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { measureExperimentalPeriodicQuinticSide,
  type ExperimentalPeriodicQuinticSideDiagnosticRequest } from './experimentalPeriodicQuinticSideDiagnostic'

type SideRequest = Omit<ExperimentalPeriodicQuinticSideDiagnosticRequest, 'support'> & {
  centralUAtEdgeEnds: ExperimentalPeriodicQuinticSideDiagnosticRequest['support']['uAtEdgeEnds']
}
type SideResult = ReturnType<typeof measureExperimentalPeriodicQuinticSide>
type SideReceipt = Exclude<SideResult, { status: 'diagnostic-only' }> |
  Omit<Extract<SideResult, { status: 'diagnostic-only' }>, 'candidate'> | { status: 'not-run' }

export interface ExperimentalPeriodicQuinticPairDiagnosticRequest {
  central: Net
  atCentralV0: SideRequest
  atCentralV1: SideRequest
}

/**
 * Diagnose two distinct lateral inputs against the unchanged central net.
 * Each side supplies its own maps, samples and budgets. V0 is evaluated
 * first. The two candidate nets are exposed together after both diagnostics
 * finish; a stop retains only the receipts.
 * The top-level stop contains only stable codes and the selected side.
 * Detailed receipts retain numerical diagnostics for existing callers.
 *
 * The input identities and sampled correspondence are coefficient-level.
 * Continuous joint quality, interior normals, CAD identity, topology and
 * solid validity require separate checks.
 */
export function measureExperimentalPeriodicQuinticPair(request: ExperimentalPeriodicQuinticPairDiagnosticRequest) {
  const receipts: { V0: SideReceipt; V1: SideReceipt } = { V0: { status: 'not-run' }, V1: { status: 'not-run' } }
  const evidenceScope = 'two-lateral-coefficient-and-sampled-joint-diagnostics' as const
  const declineInput = (reason: string, reasonCode: 'pair-missing-input' | 'pair-aliased-input') => ({
    status: 'declined' as const, phase: 'preflight' as const, reason,
    stop: { phase: 'preflight' as const, reasonCode }, receipts, evidenceScope,
  })
  if (!request?.central || !request.atCentralV0?.lateral?.net || !request.atCentralV1?.lateral?.net)
    return declineInput('servono la fascia centrale e i due laterali', 'pair-missing-input')
  const { central, atCentralV0, atCentralV1 } = request
  const firstNet = atCentralV0.lateral.net, lastNet = atCentralV1.lateral.net
  if (firstNet === lastNet || firstNet === central || lastNet === central)
    return declineInput('i laterali e la fascia centrale devono essere ingressi distinti', 'pair-aliased-input')

  const run = ({ centralUAtEdgeEnds, ...side }: SideRequest, edge: 'V0' | 'V1') =>
    measureExperimentalPeriodicQuinticSide({ ...side, support: { net: central, edge, uAtEdgeEnds: centralUAtEdgeEnds } })
  const stopped = (edge: 'V0' | 'V1', result: Exclude<SideResult, { status: 'diagnostic-only' }>) => {
    receipts[edge] = result
    return { status: result.status, phase: result.phase, stoppedAt: edge,
      stop: { phase: result.phase, reasonCode: result.reasonCode, side: edge }, receipts, evidenceScope }
  }

  const first = run(atCentralV0, 'V0')
  if (first.status !== 'diagnostic-only') return stopped('V0', first)
  const { candidate: firstCandidate, ...firstReceipt } = first
  receipts.V0 = firstReceipt

  const last = run(atCentralV1, 'V1')
  if (last.status !== 'diagnostic-only') return stopped('V1', last)
  const { candidate: lastCandidate, ...lastReceipt } = last
  receipts.V1 = lastReceipt
  return { status: 'diagnostic-only' as const, candidates: { V0: firstCandidate, V1: lastCandidate }, receipts, evidenceScope }
}

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
 *
 * The input identities and sampled correspondence are coefficient-level.
 * Continuous joint quality, interior normals, CAD identity, topology and
 * solid validity require separate checks.
 */
export function measureExperimentalPeriodicQuinticPair(request: ExperimentalPeriodicQuinticPairDiagnosticRequest) {
  const receipts: { V0: SideReceipt; V1: SideReceipt } = { V0: { status: 'not-run' }, V1: { status: 'not-run' } }
  const evidenceScope = 'two-lateral-coefficient-and-sampled-joint-diagnostics' as const
  if (!request?.central || !request.atCentralV0?.lateral?.net || !request.atCentralV1?.lateral?.net)
    return { status: 'declined' as const, phase: 'preflight' as const,
      reason: 'servono la fascia centrale e i due laterali', receipts, evidenceScope }
  const { central, atCentralV0, atCentralV1 } = request
  const firstNet = atCentralV0.lateral.net, lastNet = atCentralV1.lateral.net
  if (firstNet === lastNet || firstNet === central || lastNet === central)
    return { status: 'declined' as const, phase: 'preflight' as const,
      reason: 'i laterali e la fascia centrale devono essere ingressi distinti', receipts, evidenceScope }

  const run = ({ centralUAtEdgeEnds, ...side }: SideRequest, edge: 'V0' | 'V1') =>
    measureExperimentalPeriodicQuinticSide({ ...side, support: { net: central, edge, uAtEdgeEnds: centralUAtEdgeEnds } })

  const first = run(atCentralV0, 'V0')
  if (first.status !== 'diagnostic-only') {
    receipts.V0 = first
    return { status: first.status, phase: first.phase, stoppedAt: 'V0' as const, receipts, evidenceScope }
  }
  const { candidate: firstCandidate, ...firstReceipt } = first
  receipts.V0 = firstReceipt

  const last = run(atCentralV1, 'V1')
  if (last.status !== 'diagnostic-only') {
    receipts.V1 = last
    return { status: last.status, phase: last.phase, stoppedAt: 'V1' as const, receipts, evidenceScope }
  }
  const { candidate: lastCandidate, ...lastReceipt } = last
  receipts.V1 = lastReceipt
  return { status: 'diagnostic-only' as const, candidates: { V0: firstCandidate, V1: lastCandidate }, receipts, evidenceScope }
}

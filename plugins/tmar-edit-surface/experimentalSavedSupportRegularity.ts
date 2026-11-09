// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { boundExperimentalBernsteinPatchNormals } from './experimentalBernsteinPatchNormalBound'
import { extractExperimentalPeriodicQuinticBernsteinCell } from './experimentalPeriodicQuinticBernsteinCells'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { divide, mul, scalar, sub } from './tangencyCoefficientIntervals'

const fail = (reason: string): never => { throw Error(`Regolarita supporto salvato rifiutata: ${reason}`) }
interface CellDiagnostic {
  uSpan: number
  vSpan: number
  status: 'inconclusive' | 'nonpositive-witness'
  reason?: string
  localParameter?: readonly [number, number]
  normalDotUpperBound?: number
}

/**
 * Prove nonzero first-order parametric normals on every closed native knot
 * cell of a polynomial U-periodic, V-quintic support. Each extracted patch
 * is compared with itself: a strictly positive lower bound on N dot N
 * proves regularity of that polynomial piece, including its own endpoint
 * limits. This is not a C1/G1 certificate across cells or the periodic seam.
 *
 * The extractor uses normalized cell coordinates (r,q). Thus its normal
 * is (DeltaU * DeltaV) times the native Su cross Sv. Divide its norm lower
 * bound by an outward upper bound on this positive area scale before
 * reporting a native-parameter norm bound. Local and native bounds remain
 * distinct because their parameter units differ.
 *
 * Failed cells do not stop coverage of subsequent cells. At most eight
 * problem details are retained, with exact aggregate counts. A native-cell
 * budget truncates coverage explicitly and can never certify the support.
 * No evaluator, trim, topology, injectivity or whole-Tube claim is made.
 */
export function boundExperimentalSavedSupportRegularity(net: Net, maxNativeCells = 1024, maxDepth = 12) {
  validateExperimentalPeriodicSurfaceU(net)
  if (net.du > 3 || net.dv !== 5 || net.mu[0] !== net.du || net.rational.some(Boolean) || net.weights.some(w => w !== 1))
    fail('richiesti supporto polinomiale, U fino a cubica a cucitura satura e V quintica')
  if (!Number.isInteger(maxNativeCells) || maxNativeCells < 1 || maxNativeCells > 4096) fail('budget celle native non valido')
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 16) fail('profondita Bernstein non valida')

  const uSpans = net.ku.length - 1, vSpans = net.kv.length - 1, expectedNativeCells = uSpans * vSpans
  const required = Math.min(expectedNativeCells, maxNativeCells), problemCells: CellDiagnostic[] = []
  let checkedNativeCells = 0, certifiedNativeCells = 0, inconclusiveNativeCells = 0, nonpositiveNativeCells = 0
  let checkedBernsteinCells = 0, localLower = Infinity, nativeLower = Infinity
  let worstLocalCell: { uSpan: number; vSpan: number; lowerBound: number } | null = null
  let worstNativeCell: { uSpan: number; vSpan: number; lowerBound: number; areaScaleUpper: number } | null = null
  const report = (diagnostic: CellDiagnostic) => {
    if (diagnostic.status === 'nonpositive-witness') nonpositiveNativeCells++
    else inconclusiveNativeCells++
    if (problemCells.length < 8) problemCells.push(diagnostic)
  }
  for (let index = 0; index < required; index++) {
    const uSpan = Math.floor(index / vSpans), vSpan = index % vSpans
    checkedNativeCells++
    try {
      const cell = extractExperimentalPeriodicQuinticBernsteinCell(net, net, uSpan, vSpan)
      const result = boundExperimentalBernsteinPatchNormals(cell.original, cell.original, maxDepth)
      checkedBernsteinCells += result.checkedCells
      if (result.status === 'nonpositive-witness') {
        report({ uSpan, vSpan, status: result.status, localParameter: result.parameter, normalDotUpperBound: result.normalDotUpperBound })
        continue
      }
      if (result.status === 'inconclusive') { report({ uSpan, vSpan, status: result.status, reason: 'bernstein-positivity-unresolved' }); continue }
      const widthU = sub(scalar(cell.uDomain[1]), scalar(cell.uDomain[0]))
      const widthV = sub(scalar(cell.vDomain[1]), scalar(cell.vDomain[0]))
      if (!(widthU[0] > 0 && widthV[0] > 0)) { report({ uSpan, vSpan, status: 'inconclusive', reason: 'native-area-scale-not-positive' }); continue }
      const areaScale = mul(widthU, widthV)
      if (!(areaScale[0] > 0 && Number.isFinite(areaScale[1]))) {
        report({ uSpan, vSpan, status: 'inconclusive', reason: 'native-area-scale-unrepresentable' }); continue
      }
      const native = divide(scalar(result.minCandidateNormalNorm), scalar(areaScale[1]))[0]
      if (!(native > 0 && Number.isFinite(native))) { report({ uSpan, vSpan, status: 'inconclusive', reason: 'native-normal-lower-unrepresentable' }); continue }
      certifiedNativeCells++
      if (result.minCandidateNormalNorm < localLower) {
        localLower = result.minCandidateNormalNorm
        worstLocalCell = { uSpan, vSpan, lowerBound: localLower }
      }
      if (native < nativeLower) {
        nativeLower = native
        worstNativeCell = { uSpan, vSpan, lowerBound: native, areaScaleUpper: areaScale[1] }
      }
    } catch (error) {
      report({ uSpan, vSpan, status: 'inconclusive', reason: error instanceof Error ? error.message : String(error) })
    }
  }
  const coverageComplete = checkedNativeCells === expectedNativeCells
  const regular = coverageComplete && certifiedNativeCells === expectedNativeCells
  const status = regular ? 'regular-on-each-closed-native-cell' as const : nonpositiveNativeCells > 0 ?
    'nonpositive-witness' as const : 'inconclusive' as const
  return { status, coverageComplete, expectedNativeCells, checkedNativeCells, certifiedNativeCells,
    inconclusiveNativeCells, nonpositiveNativeCells, unvisitedNativeCells: expectedNativeCells - checkedNativeCells,
    checkedBernsteinCells, maxNativeCells, maxDepth,
    minLocalNormalNormLower: regular ? localLower : null,
    minNativeNormalNormLower: regular ? nativeLower : null,
    certifiedCellsMinLocalNormalNormLower: certifiedNativeCells > 0 ? localLower : null,
    certifiedCellsMinNativeNormalNormLower: certifiedNativeCells > 0 ? nativeLower : null,
    worstLocalCell, worstNativeCell, problemCells,
    omittedProblemCellCount: inconclusiveNativeCells + nonpositiveNativeCells - problemCells.length,
    budgetExhausted: !coverageComplete,
    localNormalUnits: 'length^2 per normalized-cell-U per normalized-cell-V' as const,
    nativeNormalUnits: 'length^2 per native-U per native-V' as const,
    seamTreatment: 'separate-one-sided-closures-of-native-polynomial-cells' as const,
    crossCellG1Certified: false as const, seamG1Certified: false as const,
    faceOrientationCertified: false as const, nativeCadCertified: false as const, tubeAccepted: false as const,
    evidenceScope: 'full-support-piecewise-polynomial-regularity-coefficient-model' as const }
}

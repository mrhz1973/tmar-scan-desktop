// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { boundExperimentalBernsteinPatchNormals } from './experimentalBernsteinPatchNormalBound'
import { extractExperimentalPeriodicLinearVBernsteinCell,
  extractExperimentalPeriodicQuinticBernsteinCell } from './experimentalPeriodicQuinticBernsteinCells'
import { boundExperimentalPeriodicSeamDerivativeGap,
  boundExperimentalPeriodicSeamJumpChange } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { difference, divide, l1, mul, scalar, sub, times } from './tangencyCoefficientIntervals'

export interface ExperimentalLinearVSeamBudget {
  maximumAbsoluteJump: number
  maximumJumpChange: number
  maximumNormalChord: number
}
export interface ExperimentalSupportOrientationBudget {
  maxNativeCells: number
  maxDepth: number
  maxPatchChecks?: number
  /** Optional separate seam criterion for one clamped linear V span. */
  linearVSeam?: ExperimentalLinearVSeamBudget
}
interface Problem {
  uSpan: number
  vSpan: number
  status: 'inconclusive' | 'nonpositive-witness'
  reason?: string
  localParameter?: readonly [number, number]
  localNormalDotUpper?: number
}
function fail(reason: string): never { throw Error(`Orientazione supporto periodico rifiutata: ${reason}`) }
const equal = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

function linearSeam(original: Net, candidate: Net, nativeNormalLower: number, budget: ExperimentalLinearVSeamBudget) {
  const scope = 'linear-v-periodic-seam-native-derivative-and-normal-coefficients' as const
  const evidence: { sourceJumpUpperMmPerU?: number | null; candidateJumpUpperMmPerU?: number | null;
    jumpChangeUpperMmPerU?: number | null; sharedNativeSvNormUpper?: number; normalChordUpper?: number } = {}
  const stop = (reason: string) => ({ status: 'inconclusive' as const, reason, evidence, evidenceScope: scope })
  if (candidate.dv !== 1 || candidate.nv !== 2 || candidate.kv.length !== 2) return stop('single-linear-v-span-required')
  if (!budget || ![budget.maximumAbsoluteJump, budget.maximumJumpChange, budget.maximumNormalChord]
    .every(x => Number.isFinite(x) && x >= 0) || budget.maximumNormalChord > 1) return stop('invalid-seam-budget')
  if (!(nativeNormalLower > 0 && Number.isFinite(nativeNormalLower))) return stop('full-support-normal-lower-required')
  try {
    const before = boundExperimentalPeriodicSeamDerivativeGap(original, budget.maximumAbsoluteJump)
    const after = boundExperimentalPeriodicSeamDerivativeGap(candidate, budget.maximumAbsoluteJump)
    const change = boundExperimentalPeriodicSeamJumpChange(original, candidate, budget.maximumJumpChange)
    evidence.sourceJumpUpperMmPerU = before.maxDerivativeDifferenceBound
    evidence.candidateJumpUpperMmPerU = after.maxDerivativeDifferenceBound
    evidence.jumpChangeUpperMmPerU = change.maxDerivativeDifferenceBound
    if (before.status !== 'within-tolerance') return stop('source-jump-unverified')
    if (after.status !== 'within-tolerance') return stop('candidate-jump-unverified')
    if (change.status !== 'within-tolerance') return stop('jump-change-unverified')
    const width = sub(scalar(candidate.kv[1]), scalar(candidate.kv[0]))
    const tangent = times(difference(candidate.poles[1], candidate.poles[0]), divide(scalar(1), width))
    const tangentUpper = l1(tangent), gap = after.maxDerivativeDifferenceBound
    // At the saturated U seam both sides share S_v. Therefore
    // N+ - N- = (S_u+ - S_u-) x S_v, in native U/V units.
    const chordUpper = gap === 0 ? 0 : divide(mul(scalar(gap), scalar(tangentUpper)), scalar(nativeNormalLower))[1]
    evidence.sharedNativeSvNormUpper = tangentUpper; evidence.normalChordUpper = chordUpper
    if (chordUpper > budget.maximumNormalChord) return stop('normal-chord-unverified')
    return { status: 'certified' as const, evidence, nativeNormalNormLower: nativeNormalLower,
      normalConvention: 'increasing-native-Su-cross-Sv-on-both-one-sided-U-limits' as const,
      positionIdentity: 'shared-saturated-periodic-column-zero' as const,
      orientedNormalDotPositive: true as const, nativeCadCertified: false as const, evidenceScope: scope }
  } catch (error) { return stop(error instanceof Error ? error.message : String(error)) }
}

/**
 * Positive source/candidate normal dot on every closed native knot cell
 * certifies relative coefficient orientation and regularity of both models.
 * V may be linear or quintic; U has a saturated periodic seam and degree
 * at most three. Each cell keeps its own one-sided closure. It does not
 * establish G1 across cells, trimming, injectivity or a native face's sense.
 *
 * Patch normals use normalized cell coordinates. Norm lower bounds are
 * divided by an outward upper bound of DeltaU*DeltaV before publication in
 * native units. A budget or unresolved cell suppresses full-domain bounds.
 * The optional linear seam result uses this same computed native lower
 * bound, never a caller-supplied bound or a repeated regularity pass.
 */
export function boundExperimentalPeriodicSupportOrientation(original: Net, candidate: Net,
  budget: ExperimentalSupportOrientationBudget) {
  validateExperimentalPeriodicSurfaceU(original); validateExperimentalPeriodicSurfaceU(candidate)
  for (const net of [original, candidate]) if (net.du > 3 || (net.dv !== 1 && net.dv !== 5) || net.mu[0] !== net.du ||
    net.rational.some(Boolean) || net.weights.some(w => w !== 1)) fail('serve base polinomiale U satura e V lineare o quintica')
  if (original.du !== candidate.du || original.dv !== candidate.dv || original.nu !== candidate.nu || original.nv !== candidate.nv ||
    !(['ku', 'kv', 'mu', 'mv'] as const).every(k => equal(original[k], candidate[k]))) fail('basi sorgente e candidato diverse')
  if (!budget) fail('budget non valido')
  const { maxNativeCells, maxDepth, maxPatchChecks = 1_048_576 } = budget
  if (!Number.isInteger(maxNativeCells) || maxNativeCells < 1 || maxNativeCells > 4096 ||
    !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 16 ||
    !Number.isSafeInteger(maxPatchChecks) || maxPatchChecks < 1 || maxPatchChecks > 10_000_000) fail('budget non valido')
  const expectedNativeCells = (original.ku.length - 1) * (original.kv.length - 1)
  const reservedPerCell = Math.min(4096, 2 ** (maxDepth + 1) - 1), problems: Problem[] = []
  const extract = original.dv === 1 ? extractExperimentalPeriodicLinearVBernsteinCell : extractExperimentalPeriodicQuinticBernsteinCell
  let checkedNativeCells = 0, certifiedNativeCells = 0, inconclusiveNativeCells = 0, nonpositiveNativeCells = 0, patchChecks = 0
  let localDotLower = Infinity, localCandidateLower = Infinity, localSourceLower = Infinity
  let nativeCandidateLower = Infinity, nativeSourceLower = Infinity, patchBudgetExhausted = false
  const problem = (p: Problem) => {
    if (p.status === 'nonpositive-witness') nonpositiveNativeCells++; else inconclusiveNativeCells++
    if (problems.length < 8) problems.push(p)
  }
  for (let index = 0; index < Math.min(expectedNativeCells, maxNativeCells); index++) {
    if (maxPatchChecks - patchChecks < reservedPerCell) { patchBudgetExhausted = true; break }
    const uSpan = Math.floor(index / (original.kv.length - 1)), vSpan = index % (original.kv.length - 1)
    checkedNativeCells++
    try {
      const cell = extract(original, candidate, uSpan, vSpan)
      const result = boundExperimentalBernsteinPatchNormals(cell.candidate, cell.original, maxDepth)
      patchChecks += result.checkedCells
      if (result.status === 'nonpositive-witness') {
        problem({ uSpan, vSpan, status: result.status, localParameter: result.parameter, localNormalDotUpper: result.normalDotUpperBound }); continue
      }
      if (result.status === 'inconclusive') { problem({ uSpan, vSpan, status: result.status, reason: 'normal-dot-positivity-unresolved' }); continue }
      const widthU = sub(scalar(cell.uDomain[1]), scalar(cell.uDomain[0]))
      const widthV = sub(scalar(cell.vDomain[1]), scalar(cell.vDomain[0]))
      if (!(widthU[0] > 0 && widthV[0] > 0)) throw Error('native-area-scale-not-positive')
      const area = mul(widthU, widthV)
      if (!(area[0] > 0 && Number.isFinite(area[1]))) throw Error('native-area-scale-unrepresentable')
      const candidateLower = divide(scalar(result.minCandidateNormalNorm), scalar(area[1]))[0]
      const sourceLower = divide(scalar(result.minReferenceNormalNorm), scalar(area[1]))[0]
      if (!(candidateLower > 0 && sourceLower > 0 && Number.isFinite(candidateLower) && Number.isFinite(sourceLower)))
        throw Error('native-normal-lower-unrepresentable')
      certifiedNativeCells++
      localDotLower = Math.min(localDotLower, result.minNormalDot)
      localCandidateLower = Math.min(localCandidateLower, result.minCandidateNormalNorm)
      localSourceLower = Math.min(localSourceLower, result.minReferenceNormalNorm)
      nativeCandidateLower = Math.min(nativeCandidateLower, candidateLower)
      nativeSourceLower = Math.min(nativeSourceLower, sourceLower)
    } catch (error) { problem({ uSpan, vSpan, status: 'inconclusive', reason: error instanceof Error ? error.message : String(error) }) }
  }
  const coverageComplete = checkedNativeCells === expectedNativeCells
  const certified = coverageComplete && certifiedNativeCells === expectedNativeCells
  const linearVSeam = budget.linearVSeam === undefined ? undefined : certified
    ? linearSeam(original, candidate, nativeCandidateLower, budget.linearVSeam)
    : { status: 'inconclusive' as const, reason: 'full-support-orientation-regularity-unverified' }
  return { status: certified ? 'certified-relative-orientation-and-regularity' as const : nonpositiveNativeCells > 0
    ? 'nonpositive-orientation-witness' as const : 'inconclusive' as const,
    expectedNativeCells, checkedNativeCells, certifiedNativeCells, inconclusiveNativeCells, nonpositiveNativeCells,
    coverageComplete, unvisitedNativeCells: expectedNativeCells - checkedNativeCells, patchChecks,
    maxNativeCells, maxDepth, maxPatchChecks, patchBudgetExhausted,
    minLocalNormalDotLower: certified ? localDotLower : null,
    minLocalCandidateNormalNormLower: certified ? localCandidateLower : null,
    minLocalSourceNormalNormLower: certified ? localSourceLower : null,
    minNativeCandidateNormalNormLower: certified ? nativeCandidateLower : null,
    minNativeSourceNormalNormLower: certified ? nativeSourceLower : null,
    problems, omittedProblemCount: inconclusiveNativeCells + nonpositiveNativeCells - problems.length, linearVSeam,
    nativeNormalUnits: 'length^2 per native-U per native-V' as const,
    localNormalUnits: 'length^2 per normalized-cell-U per normalized-cell-V' as const,
    normalConvention: 'increasing-native-Su-cross-Sv-source-and-candidate' as const,
    seamTreatment: 'separate-one-sided-closures-of-each-native-polynomial-cell' as const,
    crossCellG1Certified: false as const, nativeFaceSenseCertified: false as const, nativeCadCertified: false as const, tubeAccepted: false as const,
    evidenceScope: 'full-support-relative-orientation-and-regularity-coefficient-model' as const }
}

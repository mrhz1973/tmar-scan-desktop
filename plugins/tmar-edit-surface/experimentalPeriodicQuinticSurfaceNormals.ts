// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { boundExperimentalBernsteinPatchNormals } from './experimentalBernsteinPatchNormalBound'
import { extractExperimentalPeriodicQuinticBernsteinCell } from './experimentalPeriodicQuinticBernsteinCells'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { add, mul, scalar } from './tangencyCoefficientIntervals'

interface WorkBudget {
  maxCells: number
  maxPatchChecks: number
  maxDepth: number
}

type Domain = readonly [number, number]
type Cell = { uSpan: number; vSpan: number; uDomain: Domain; vDomain: Domain }

function nativeCoordinate(domain: Domain, fraction: number) {
  const [first, last] = domain
  // The fraction is exactly dyadic. The affine representation remains
  // exact even when the native coordinate cannot be enclosed in binary64.
  const affine = { domain, fraction }
  if (fraction === 0) return { ...affine, enclosure: scalar(first) }
  if (fraction === 1) return { ...affine, enclosure: scalar(last) }
  try {
    const enclosure = add(mul(scalar(1 - fraction), scalar(first)), mul(scalar(fraction), scalar(last)))
    return { ...affine, enclosure }
  } catch {
    return { ...affine, enclosure: null }
  }
}

/**
 * Check relative normal orientation and regularity on every closed knot
 * cell of a common-basis unit-weight periodic U/clamped V5 pair. Each
 * seam cell contributes its own one-sided patch. Both patches use the
 * same normalized coordinates, so their normal dot has the native sign.
 * Reported dot magnitudes use cell-local parameter units.
 *
 * The work budget reserves the worst binary subdivision tree before
 * starting a cell. An unproved cell stops the check. The result concerns
 * the two coefficient models and leaves cross-cell normal agreement,
 * topology, global injectivity and CAD evaluation to separate checks.
 */
export function boundExperimentalPeriodicQuinticSurfaceNormals(original: Net, candidate: Net, budget: WorkBudget) {
  const evidenceScope = 'periodic-quintic-full-domain-coefficient-normal-comparison' as const
  const coverage = { uSpans: 0, vSpans: 0, plannedCells: 0, checkedCells: 0, certifiedCells: 0, patchChecks: 0 }
  const stop = (reason: string, cell?: Cell, detail?: string) =>
    ({ status: 'inconclusive' as const, reason, cell, detail, coverage, evidenceScope })
  if (!budget || !Number.isSafeInteger(budget.maxCells) || budget.maxCells < 1 ||
      !Number.isSafeInteger(budget.maxPatchChecks) || budget.maxPatchChecks < 1 ||
      !Number.isInteger(budget.maxDepth) || budget.maxDepth < 0 || budget.maxDepth > 16)
    return stop('invalid-work-budget')
  try {
    validateExperimentalPeriodicSurfaceU(original)
    validateExperimentalPeriodicSurfaceU(candidate)
  } catch (error) {
    return stop('invalid-net', undefined, error instanceof Error ? error.message : undefined)
  }
  coverage.uSpans = original.ku.length - 1
  coverage.vSpans = original.kv.length - 1
  coverage.plannedCells = coverage.uSpans * coverage.vSpans
  if (coverage.plannedCells > budget.maxCells) return stop('knot-cell-budget')
  const reservedPerCell = 2 ** (budget.maxDepth + 1) - 1

  let minimumCellLocalNormalDot = Infinity
  for (let uSpan = 0; uSpan < coverage.uSpans; uSpan++) for (let vSpan = 0; vSpan < coverage.vSpans; vSpan++) {
    const cell: Cell = { uSpan, vSpan, uDomain: [original.ku[uSpan], original.ku[uSpan + 1]],
      vDomain: [original.kv[vSpan], original.kv[vSpan + 1]] }
    if (budget.maxPatchChecks - coverage.patchChecks < reservedPerCell) return stop('patch-check-budget', cell)
    let patch: ReturnType<typeof extractExperimentalPeriodicQuinticBernsteinCell>
    try {
      patch = extractExperimentalPeriodicQuinticBernsteinCell(original, candidate, uSpan, vSpan)
    } catch (error) {
      return stop('cell-extraction-refused', cell, error instanceof Error ? error.message : undefined)
    }
    let proof: ReturnType<typeof boundExperimentalBernsteinPatchNormals>
    try {
      proof = boundExperimentalBernsteinPatchNormals(patch.candidate, patch.original, budget.maxDepth)
    } catch (error) {
      return stop('patch-bound-refused', cell, error instanceof Error ? error.message : undefined)
    }
    coverage.checkedCells++
    coverage.patchChecks += proof.checkedCells
    if (proof.status === 'inconclusive') return stop('patch-inconclusive', cell)
    if (proof.status === 'nonpositive-witness') {
      const [u, v] = proof.parameter
      const uSeamSide = uSpan === 0 && u === 0 ? 'right' as const :
        uSpan === coverage.uSpans - 1 && u === 1 ? 'left' as const : undefined
      return { status: 'nonpositive-witness' as const, cell, localParameter: proof.parameter,
        nativeParameter: { u: nativeCoordinate(cell.uDomain, u), v: nativeCoordinate(cell.vDomain, v), uSeamSide },
        cellLocalNormalDotUpperBound: proof.normalDotUpperBound, coverage, evidenceScope }
    }
    coverage.certifiedCells++
    minimumCellLocalNormalDot = Math.min(minimumCellLocalNormalDot, proof.minNormalDot)
  }
  return { status: 'certified-positive' as const, minimumCellLocalNormalDot, coverage, evidenceScope }
}

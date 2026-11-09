// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { extractExperimentalPeriodicQuinticCommonCell } from './experimentalPeriodicQuinticBernsteinCells'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { l1, sub, type V } from './tangencyCoefficientIntervals'

const fail = (reason: string): never => { throw new Error(`Limite differenza supporti periodici rifiutato: ${reason}`) }

/**
 * Bound ||candidate(u,v) - original(u,v)||_2 on the whole common natural
 * domain, under the caller's identity-UV correspondence. The inputs are
 * polynomial, U-periodic supports with a saturated U seam, degree U <= 3,
 * degree V = 5, the same U multiplicities/pole count and the same clamped
 * V basis. U knot values may differ. Each support retains its own exact
 * binary64 knot vector.
 *
 * The exact union of U knots partitions the domain. On every closed cell,
 * both restricted fields use the same normalized Bernstein basis. For
 * each pair of coefficient enclosures D_ij, positivity and partition of
 * unity give sup ||difference||_2 <= max_ij ||D_ij||_1. Every operation
 * forming the enclosures and L1 bounds uses outward interval arithmetic.
 *
 * This is a continuous positional bound for the coefficient models. It
 * does not certify native CAD evaluation, representation correspondence,
 * pcurves, topology, regularity, derivatives, G1 continuity or solids. It
 * makes no tolerance decision and cannot change an earlier CAD receipt.
 */
export function boundExperimentalPeriodicSupportDifference(original: Net, candidate: Net, maxCells = 4096) {
  validateExperimentalPeriodicSurfaceU(original)
  validateExperimentalPeriodicSurfaceU(candidate)
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 16_384)
    fail('budget celle non valido')
  // Set compares the stored finite numbers exactly: nearby knots remain
  // distinct, with no epsilon merge or fitted correspondence.
  const uPartition = [...new Set([...original.ku, ...candidate.ku])].sort((a, b) => a - b)
  const uCells = uPartition.length - 1, vCells = original.kv.length - 1
  const requiredCells = uCells * vCells
  if (requiredCells > maxCells) fail('partizione comune oltre il budget celle')

  let originalUSpan = 0, candidateUSpan = 0, checkedCells = 0
  let positionDifferenceUpperBound = 0
  let worstCell: { uDomain: [number, number]; vDomain: readonly [number, number];
    originalUSpan: number; candidateUSpan: number; vSpan: number; upperBound: number } | undefined
  for (let uCell = 0; uCell < uCells; uCell++) {
    const first = uPartition[uCell], last = uPartition[uCell + 1]
    while (originalUSpan + 1 < original.ku.length - 1 && original.ku[originalUSpan + 1] <= first) originalUSpan++
    while (candidateUSpan + 1 < candidate.ku.length - 1 && candidate.ku[candidateUSpan + 1] <= first) candidateUSpan++
    for (let vSpan = 0; vSpan < vCells; vSpan++) {
      const cell = extractExperimentalPeriodicQuinticCommonCell(original, candidate,
        originalUSpan, candidateUSpan, vSpan, [first, last])
      let upperBound = 0
      for (const [i, control] of cell.original.controls.entries()) {
        const difference = control.map((interval, axis) => sub(cell.candidate.controls[i][axis], interval)) as V
        upperBound = Math.max(upperBound, l1(difference))
      }
      checkedCells++
      if (!worstCell || upperBound > positionDifferenceUpperBound) {
        positionDifferenceUpperBound = upperBound
        worstCell = { uDomain: cell.uDomain, vDomain: cell.vDomain,
          originalUSpan, candidateUSpan, vSpan, upperBound }
      }
    }
  }
  if (checkedCells !== requiredCells || !worstCell || !Number.isFinite(positionDifferenceUpperBound))
    fail('copertura della partizione comune incompleta')
  return { status: 'bounded' as const, positionDifferenceUpperBound, checkedCells,
    checkedControlPairs: checkedCells * (original.du + 1) * (original.dv + 1),
    uCells, vCells, uPartition, maxCells, worstCell,
    uDomain: [original.ku[0], original.ku.at(-1)!] as const,
    vDomain: [original.kv[0], original.kv.at(-1)!] as const,
    correspondence: 'identity-uv' as const,
    boundMethod: 'common-partition-bernstein-interval-l1-hull' as const,
    evidenceScope: 'periodic-polynomial-support-coefficient-model' as const,
    nativeCadCertified: false as const }
}

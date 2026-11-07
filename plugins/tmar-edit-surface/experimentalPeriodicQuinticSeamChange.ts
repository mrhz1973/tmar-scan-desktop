// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import type { ExperimentalBernsteinSurfacePatch } from './experimentalBernsteinPatchNormalBound'
import { extractExperimentalPeriodicQuinticBernsteinCell } from './experimentalPeriodicQuinticBernsteinCells'
import { boundExperimentalPeriodicSeamDerivativeGap, boundExperimentalPeriodicSeamJumpChange } from './experimentalPeriodicSeamDerivativeGap'
import { add, cross, divide, l1, mul, scalar, sub, times, type I, type V } from './tangencyCoefficientIntervals'

export interface ExperimentalPeriodicQuinticSeamChangeBudget {
  /** Absolute jump bound required on source and candidate, in length per native U. */
  maximumAbsoluteJump: number
  /** Bound on the change of the signed jump field, in length per native U. */
  maximumJumpChange: number
  /** Absolute candidate unit-normal chord, 2 sin(angle / 2), at most one. */
  maximumCandidateNormalChord: number
  maxPieces: number
  maxDepth: number
}

const axes = [0, 1, 2] as const
const equalPoints = (a: I, b: I) => a[0] === a[1] && a[0] === b[0] && b[0] === b[1]
const difference = (a: V, b: V): V => axes.map(i => equalPoints(a[i], b[i]) ? scalar(0) : sub(a[i], b[i])) as V
const hull = (controls: V[]): V => axes.map(i => [Math.min(...controls.map(p => p[i][0])), Math.max(...controls.map(p => p[i][1]))]) as V

function seamDerivatives(patch: ExperimentalBernsteinSurfacePatch, u: 'left' | 'right', width: I) {
  const stride = patch.degreeV + 1
  const boundary = u === 'right' ? 0 : patch.degreeU * stride
  const inward = u === 'right' ? stride : boundary - stride
  const scale = divide(scalar(u === 'right' ? patch.degreeU : -patch.degreeU), width)
  const du = Array.from({ length: stride }, (_, i) =>
    times(difference(patch.controls[inward + i], patch.controls[boundary + i]), scale))
  const dv = Array.from({ length: stride - 1 }, (_, i) =>
    times(difference(patch.controls[boundary + i + 1], patch.controls[boundary + i]), scalar(patch.degreeV)))
  return { du, dv }
}

function bisect(controls: V[]) {
  const left = [controls[0]], right = [controls.at(-1)!]
  let row = controls
  while (row.length > 1) {
    row = row.slice(0, -1).map((a, i) => axes.map(k => {
      const b = row[i + 1][k]
      return equalPoints(a[k], b) ? b : add(mul(a[k], scalar(0.5)), mul(b, scalar(0.5)))
    }) as V)
    left.push(row[0])
    right.push(row.at(-1)!)
  }
  return [left, right.reverse()] as const
}

const normalLower = (du: V, dv: V) => Math.max(...cross(du, dv).map(([lo, hi]) => Math.max(0, lo, -hi)))

/**
 * Independently test the stored seam model. The saturated seam shares one
 * position curve and its V tangent T, so N+−N−=(D+−D−)×T for normals
 * using native U and the same local V. For nonzero normals the chord of
 * their unit vectors is at most ||N+−N−||/min(||N+||,||N−||).
 * Outward derivative hulls and exact jump arithmetic bound those quantities
 * on closed V pieces. At an interior C0 V knot the check covers each V
 * limit separately, with the two U normals compared at the same V limit.
 * Failure to enclose is inconclusive. The candidate
 * chord budget is absolute, even when the source has a nonzero jump. A
 * pass covers neither other joints nor full-domain normals, displacement,
 * G1 equality, trims or CAD topology.
 */
export function boundExperimentalPeriodicQuinticSeamChange(original: Net, candidate: Net, budget: ExperimentalPeriodicQuinticSeamChangeBudget) {
  const work = { checkedPieces: 0, acceptedPieces: 0 }
  const evidence: { sourceJumpUpper?: number; candidateJumpUpper?: number; jumpChangeUpper?: number } = {}
  const stop = (reason: string, vSpan?: number) => ({ status: 'inconclusive' as const, reason, vSpan, work, evidence })
  if (!budget || ![budget.maximumAbsoluteJump, budget.maximumJumpChange, budget.maximumCandidateNormalChord]
    .every(x => Number.isFinite(x) && x >= 0) || budget.maximumCandidateNormalChord > 1 ||
    !Number.isInteger(budget.maxPieces) || budget.maxPieces < 1 || budget.maxPieces > 100_000 ||
    !Number.isInteger(budget.maxDepth) || budget.maxDepth < 0 || budget.maxDepth > 16) return stop('invalid-budget')
  let vSpan: number | undefined
  try {
    const before = boundExperimentalPeriodicSeamDerivativeGap(original, budget.maximumAbsoluteJump)
    if (before.maxDerivativeDifferenceBound !== null) evidence.sourceJumpUpper = before.maxDerivativeDifferenceBound
    if (before.status !== 'within-tolerance') return stop('source-jump-unverified')
    const change = boundExperimentalPeriodicSeamJumpChange(original, candidate, budget.maximumJumpChange)
    if (change.maxDerivativeDifferenceBound !== null) evidence.jumpChangeUpper = change.maxDerivativeDifferenceBound
    if (change.status !== 'within-tolerance') return stop('jump-change-unverified')
    const after = boundExperimentalPeriodicSeamDerivativeGap(candidate, budget.maximumAbsoluteJump)
    if (after.maxDerivativeDifferenceBound !== null) evidence.candidateJumpUpper = after.maxDerivativeDifferenceBound
    if (after.status !== 'within-tolerance') return stop('candidate-jump-unverified')

    const rightWidth = sub(scalar(candidate.ku[1]), scalar(candidate.ku[0]))
    const leftWidth = sub(scalar(candidate.ku.at(-1)!), scalar(candidate.ku.at(-2)!))
    const lastU = candidate.ku.length - 2
    let maximumNormalChordUpper = 0
    for (vSpan = 0; vSpan < candidate.kv.length - 1; vSpan++) {
      const right = seamDerivatives(extractExperimentalPeriodicQuinticBernsteinCell(candidate, candidate, 0, vSpan).candidate, 'right', rightWidth)
      const left = seamDerivatives(extractExperimentalPeriodicQuinticBernsteinCell(candidate, candidate, lastU, vSpan).candidate, 'left', leftWidth)
      // The exact T polynomial is shared by both sides. A single enclosure
      // suffices even though extraction uses different local origins.
      const pending = [{ right: right.du, left: left.du, tangent: right.dv, depth: 0 }]
      while (pending.length) {
        if (work.checkedPieces === budget.maxPieces) return stop('piece-budget', vSpan)
        const piece = pending.pop()!
        work.checkedPieces++
        const tangent = hull(piece.tangent)
        const lower = Math.min(normalLower(hull(piece.right), tangent), normalLower(hull(piece.left), tangent))
        if (lower > 0) {
          const gap = after.maxDerivativeDifferenceBound
          const chordUpper = gap === 0 ? 0 : divide(mul(scalar(gap), scalar(l1(tangent))), scalar(lower))[1]
          if (chordUpper <= budget.maximumCandidateNormalChord) {
            maximumNormalChordUpper = Math.max(maximumNormalChordUpper, chordUpper)
            work.acceptedPieces++
            continue
          }
        }
        if (piece.depth === budget.maxDepth) return stop('seam-normal-chord-unverified', vSpan)
        const rightParts = bisect(piece.right), leftParts = bisect(piece.left), tangents = bisect(piece.tangent)
        for (const i of [0, 1] as const)
          pending.push({ right: rightParts[i], left: leftParts[i], tangent: tangents[i], depth: piece.depth + 1 })
      }
    }
    return { status: 'certified' as const, maximumNormalChordUpper, work, evidence }
  } catch { return stop('seam-bound-refused', vSpan) }
}

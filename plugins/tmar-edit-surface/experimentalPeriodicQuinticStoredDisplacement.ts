// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { extractExperimentalPeriodicQuinticVDifferenceColumns } from './experimentalPeriodicQuinticBernsteinCells'
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'
import { add, mul, scalar, sub, type V } from './tangencyCoefficientIntervals'

export interface ExperimentalPeriodicQuinticDisplacementBudget {
  maximumSurfaceDisplacement: number
  maxPieces: number
  maxDepth: number
}

const bits = new DataView(new ArrayBuffer(8))
function euclideanUpper(vector: V) {
  const maxima = vector.map(([lo, hi]) => Math.max(Math.abs(lo), Math.abs(hi)))
  const squares = maxima.reduce((sum, value) => sum + binary64Units(value) ** 2n, 0n)
  let candidate = Math.hypot(...maxima)
  // Treat hypot as a seed. Check the enclosure against exact binary64
  // squares before using it, including underflow at small magnitudes.
  for (let i = 0; i < 5 && Number.isFinite(candidate); i++) {
    if (binary64Units(candidate) ** 2n >= squares) return candidate
    bits.setFloat64(0, candidate)
    bits.setBigUint64(0, bits.getBigUint64(0) + 1n)
    candidate = bits.getFloat64(0)
  }
  throw new Error('Norma di spostamento non racchiudibile')
}

function bisect(controls: V[]) {
  const left = [controls[0]], right = [controls.at(-1)!]
  let row = controls
  while (row.length > 1) {
    row = row.slice(0, -1).map((a, i) => a.map((x, axis) => {
      const y = row[i + 1][axis]
      return x[0] === x[1] && x[0] === y[0] && y[0] === y[1] ? x :
        add(mul(x, scalar(0.5)), mul(y, scalar(0.5)))
    }) as V)
    left.push(row[0])
    right.push(row.at(-1)!)
  }
  return [left, right.reverse()]
}

/**
 * Bound displacement at corresponding (U,V) on a shared unit-weight basis.
 * The U partition of unity bounds the displacement by the maximum of the
 * V difference curves of its columns. Each curve uses outward Bernstein
 * control hulls on all V spans, optionally subdivided to prove the budget.
 * This concerns correspondence displacement of the stored coefficient
 * models. Wall thickness, trims and CAD evaluation require separate checks.
 */
export function boundExperimentalPeriodicQuinticStoredDisplacement(original: Net, candidate: Net,
  budget: ExperimentalPeriodicQuinticDisplacementBudget,
) {
  const { maximumSeamDisplacementUpper: _maximumSeamDisplacementUpper, ...result } = boundDisplacement(original, candidate, budget)
  return result
}

/** Independently limit the displacement of the shared saturated U0 curve. */
export function boundExperimentalPeriodicQuinticStoredSurfaceAndSeamDisplacement(original: Net, candidate: Net,
  budget: ExperimentalPeriodicQuinticDisplacementBudget, maximumSeamDisplacement: number,
) {
  return boundDisplacement(original, candidate, budget, { maximum: maximumSeamDisplacement })
}

function boundDisplacement(original: Net, candidate: Net, budget: ExperimentalPeriodicQuinticDisplacementBudget,
  seam?: { maximum: number },
) {
  const evidenceScope = 'stored-periodic-quintic-correspondence-displacement' as const
  const work = { checkedPieces: 0, terminalPieces: 0, maximumDepthUsed: 0 }
  let maximumPoleDisplacementUpper: number | undefined
  const stop = (reason: string, at?: { vSpan: number; uColumn: number; depth: number; pieceUpper: number }) =>
    ({ status: 'inconclusive' as const, reason, at, work, maximumPoleDisplacementUpper,
      maximumSeamDisplacementUpper: undefined, evidenceScope })
  if (!budget || !Number.isFinite(budget.maximumSurfaceDisplacement) || budget.maximumSurfaceDisplacement < 0 ||
      (seam && (!Number.isFinite(seam.maximum) || seam.maximum < 0)) ||
      !Number.isInteger(budget.maxPieces) || budget.maxPieces < 1 || budget.maxPieces > 100_000 ||
      !Number.isInteger(budget.maxDepth) || budget.maxDepth < 0 || budget.maxDepth > 16) return stop('invalid-budget')
  try {
    const first = extractExperimentalPeriodicQuinticVDifferenceColumns(original, candidate, 0)
    const spans = original.kv.length - 1
    if (first.length * spans > budget.maxPieces) return stop('piece-budget')
    let poleMaximum = 0
    for (const [i, point] of original.poles.entries()) {
      const difference = point.map((x, axis) => {
        const value = candidate.poles[i][axis]
        return value === x ? scalar(0) : sub(scalar(value), scalar(x))
      }) as V
      poleMaximum = Math.max(poleMaximum, euclideanUpper(difference))
    }
    maximumPoleDisplacementUpper = poleMaximum

    let maximumSurfaceDisplacementUpper = 0, maximumSeamDisplacementUpper = 0
    for (let vSpan = 0; vSpan < spans; vSpan++) {
      const columns = vSpan === 0 ? first : extractExperimentalPeriodicQuinticVDifferenceColumns(original, candidate, vSpan)
      for (const [uColumn, controls] of columns.entries()) {
        const seamLimit = uColumn === 0 && seam ? seam.maximum : Infinity
        const limit = Math.min(budget.maximumSurfaceDisplacement, seamLimit)
        const pending = [{ controls, depth: 0 }]
        while (pending.length) {
          if (work.checkedPieces === budget.maxPieces) return stop('piece-budget')
          const piece = pending.pop()!
          work.checkedPieces++
          work.maximumDepthUsed = Math.max(work.maximumDepthUsed, piece.depth)
          const pieceUpper = Math.max(...piece.controls.map(euclideanUpper))
          if (pieceUpper <= limit) {
            work.terminalPieces++
            maximumSurfaceDisplacementUpper = Math.max(maximumSurfaceDisplacementUpper, pieceUpper)
            if (uColumn === 0) maximumSeamDisplacementUpper = Math.max(maximumSeamDisplacementUpper, pieceUpper)
          } else if (piece.depth === budget.maxDepth) return stop(seamLimit < budget.maximumSurfaceDisplacement
            ? 'seam-displacement-unverified' : 'surface-displacement-unverified', { vSpan, uColumn, depth: piece.depth, pieceUpper })
          else for (const controls of bisect(piece.controls)) pending.push({ controls, depth: piece.depth + 1 })
        }
      }
    }
    return { status: 'within-surface-budget' as const, maximumSurfaceDisplacementUpper, maximumSeamDisplacementUpper,
      maximumPoleDisplacementUpper, work, evidenceScope }
  } catch { return stop('displacement-bound-refused') }
}

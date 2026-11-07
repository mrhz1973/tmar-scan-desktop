// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { difference, divide, l1, mul, scalar, sub, type V } from './tangencyCoefficientIntervals'

export interface ExperimentalPeriodicBezierStripRequest {
  net: Net
  /** One coefficient per U pole, in the same order and basis as the strip. */
  targetInwardV0: readonly Point[]
  targetInwardV1: readonly Point[]
  /** Positive bound in coordinate units per unit of the original V parameter. */
  derivativeTolerance: number
  lockIndices?: readonly number[]
}

const fail = (reason: string): never => { throw new Error(`Fascia periodica Bézier rifiutata: ${reason}`) }
const finitePoint = (point: Point) =>
  Array.isArray(point) && point.length === 3 && Array.from(point).every(Number.isFinite)

/**
 * Propose two independent inward derivatives of a unit-weight cubic Bézier
 * strip. V0 uses +dS/dV and V1 uses -dS/dV. Only the adjacent interior rows
 * are editable. Each residual field shares the strip's U basis, so the
 * maximum L1 residual coefficient bounds its Euclidean norm on the entire
 * edge, including the periodic seam.
 *
 * Editable residuals measure rounding of the proposal relative to the
 * supplied coefficients. Locked residuals may also reflect a target that
 * differs from the fixed derivative. The calculation concerns the supplied
 * coefficient models. Matching these targets alone gives no G1, regularity
 * or CAD guarantee.
 */
export function proposeExperimentalPeriodicBezierStrip(request: ExperimentalPeriodicBezierStripRequest) {
  const { net, targetInwardV0, targetInwardV1, derivativeTolerance, lockIndices = [] } = request
  validateExperimentalPeriodicSurfaceU(net)
  if (net.dv !== 3 || net.nv !== 4 || net.kv.length !== 2 || net.weights.some(w => w !== 1))
    fail('richiesta una fascia cubica Bézier a pesi unitari')
  if (!Number.isFinite(derivativeTolerance) || derivativeTolerance <= 0)
    fail('tolleranza positiva e finita richiesta per le derivate')
  if (!Array.isArray(lockIndices) ||
      Array.from(lockIndices).some(index => !Number.isInteger(index) || index < 0 || index >= net.poles.length))
    fail('indice bloccato non valido')

  const sides = [
    { edge: 'V0', outer: 0, inner: 1, targets: targetInwardV0 },
    { edge: 'V1', outer: 3, inner: 2, targets: targetInwardV1 },
  ] as const
  for (const { edge, targets } of sides) {
    if (!Array.isArray(targets) || targets.length !== net.nu || !Array.from(targets).every(finitePoint))
      fail(`coefficienti della derivata ${edge} non validi`)
  }
  const [first, last] = net.kv
  const step = (last - first) / 3
  if (!(step > 0)) fail('scala parametrica V non rappresentabile')
  const factor = divide(scalar(3), sub(scalar(last), scalar(first)))
  const candidate = structuredClone(net), locks = new Set(lockIndices), changedIndices: number[] = []
  const validation = sides.map(({ edge, outer, inner, targets }) => {
    let maxEditableDerivativeResidualBound = 0, maxLockedDerivativeResidualBound = 0
    for (const [u, target] of targets.entries()) {
      const index = u * net.nv + inner, boundary = net.poles[u * net.nv + outer]
      const locked = locks.has(index)
      if (!locked) {
        const proposed = boundary.map((x, axis) => x + step * target[axis]) as Point
        if (!finitePoint(proposed)) fail(`proposta numericamente non rappresentabile al polo ${index}`)
        if (proposed.some((x, axis) => !Object.is(x, net.poles[index][axis]))) {
          candidate.poles[index] = proposed
          changedIndices.push(index)
        }
      }
      const actual = candidate.poles[index]
      const displacement = difference(actual, boundary)
      const residual = displacement.map((delta, axis) =>
        actual[axis] === boundary[axis] && target[axis] === 0 ? scalar(0) :
          sub(mul(factor, delta), scalar(target[axis]))) as V
      const bound = residual.every(([lo, hi]) => lo === 0 && hi === 0) ? 0 : l1(residual)
      if (locked) {
        if (bound > derivativeTolerance) fail(`residuo della derivata ${edge} non comprovato al polo bloccato ${index}`)
        maxLockedDerivativeResidualBound = Math.max(maxLockedDerivativeResidualBound, bound)
      } else {
        if (bound > derivativeTolerance)
          fail(`limite del residuo numerico della derivata ${edge} al polo ${index} oltre tolleranza`)
        maxEditableDerivativeResidualBound = Math.max(maxEditableDerivativeResidualBound, bound)
      }
    }
    return { edge, maxEditableDerivativeResidualBound, maxLockedDerivativeResidualBound }
  })
  return { net: candidate, changedIndices, validation, evidenceScope: 'input-coefficients-only' as const }
}

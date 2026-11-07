// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { difference, divide, l1, mul, scalar, sub, type V } from './tangencyCoefficientIntervals'

export interface ExperimentalPeriodicClampedStripRequest {
  net: Net
  /** One coefficient per U pole, in the same order and basis as the strip. */
  targetInwardV0: readonly Point[]
  targetInwardV1: readonly Point[]
  /** Positive bound in coordinate units per unit of the original V parameter. */
  derivativeTolerance: number
  lockIndices?: readonly number[]
}

const finitePoint = (point: Point) =>
  Array.isArray(point) && point.length === 3 && Array.from(point).every(Number.isFinite)

export function proposeExperimentalPeriodicClampedStripDerivatives(
  request: ExperimentalPeriodicClampedStripRequest, rows: 4 | 9,
) {
  if (rows !== 4 && rows !== 9) throw new Error('Fascia periodica cubica rifiutata: servono quattro o nove file')
  const label = rows === 4 ? 'Fascia periodica Bézier' : 'Fascia periodica cubica a nove file'
  const fail = (reason: string): never => { throw new Error(`${label} rifiutata: ${reason}`) }
  const { net, targetInwardV0, targetInwardV1, derivativeTolerance, lockIndices = [] } = request
  validateExperimentalPeriodicSurfaceU(net)
  if (net.dv !== 3 || net.nv !== rows || net.weights.some(w => w !== 1) ||
      (rows === 4 ? net.kv.length !== 2 : net.kv.length < 3))
    fail(rows === 4 ? 'richiesta una fascia cubica Bézier a pesi unitari' :
      'richiesta una fascia cubica clamped a nove file, con nodi interni e pesi unitari')
  if (!Number.isFinite(derivativeTolerance) || derivativeTolerance <= 0)
    fail('tolleranza positiva e finita richiesta per le derivate')
  if (!Array.isArray(lockIndices) ||
      Array.from(lockIndices).some(index => !Number.isInteger(index) || index < 0 || index >= net.poles.length))
    fail('indice bloccato non valido')

  const sides = [
    { edge: 'V0', outer: 0, inner: 1, span: 0, targets: targetInwardV0 },
    { edge: 'V1', outer: rows - 1, inner: rows - 2, span: net.kv.length - 2, targets: targetInwardV1 },
  ] as const
  for (const { edge, targets } of sides) {
    if (!Array.isArray(targets) || targets.length !== net.nu || !Array.from(targets).every(finitePoint))
      fail(`coefficienti della derivata ${edge} non validi`)
  }

  const candidate = structuredClone(net), locks = new Set(lockIndices), changedIndices: number[] = []
  const validation = sides.map(({ edge, outer, inner, span, targets }) => {
    // At either clamped end, the inward derivative uses the adjacent row
    // difference and the width of that end's first nonempty knot span.
    const first = net.kv[span], last = net.kv[span + 1]
    const step = (last - first) / 3
    if (!(step > 0)) fail('scala parametrica V non rappresentabile')
    const factor = divide(scalar(3), sub(scalar(last), scalar(first)))
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

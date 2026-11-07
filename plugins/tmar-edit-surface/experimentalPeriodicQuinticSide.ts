// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { boundExperimentalPeriodicSeamDerivativeGap } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { divide, l1, scalar, sub, times, type V } from './tangencyCoefficientIntervals'

interface QuinticSideRequest {
  net: Net
  edge: 'V0' | 'V1'
  /** Coefficients of the inward derivative, in the strip's original U basis. */
  targetInward: readonly Point[]
  derivativeTolerance: number
  secondDerivativeTolerance: number
  lockIndices?: readonly number[]
}

const fail = (reason: string): never => { throw new Error(`Fascia periodica quintica rifiutata: ${reason}`) }
const finitePoint = (point: Point) =>
  Array.isArray(point) && point.length === 3 && Array.from(point).every(Number.isFinite)
const difference = (a: Point, b: Point): V => a.map((x, axis) =>
  x === b[axis] ? scalar(0) : sub(scalar(x), scalar(b[axis]))) as V
const subtract = (a: V, b: V): V => a.map((x, axis) => sub(x, b[axis])) as V
const norm = (value: V) => value.every(([lo, hi]) => lo === 0 && hi === 0) ? 0 : l1(value)

/**
 * Change the first inward derivative at one natural V border of a
 * unit-weight clamped quintic with a structurally C1 periodic U basis,
 * distributing the edit to two inward rows.
 * The additional row preserves the original second derivative at the
 * selected border within the requested numerical bound. Both border rows
 * and the first inward row of the opposite border stay exactly fixed.
 * The second row receives at least twice the first row's intended
 * displacement. The caller can compare the returned bound with its budget.
 * Structurally C0 U seams are outside this prototype.
 *
 * All limits concern the mathematical coefficient model over the full U
 * period. They bound deviations from the requested derivatives and the
 * source surface at corresponding parameters. Regularity, G1, thickness,
 * topology and OCCT evaluation require separate checks.
 */
export function proposeExperimentalPeriodicQuinticSide(request: QuinticSideRequest) {
  validateQuinticSide(request)
  if (request.net.mu.some(m => m >= request.net.du))
    fail('richiesta una base U strutturalmente C1 alla cucitura e ai nodi interni')
  return proposeQuinticRows(request)
}

/**
 * Separate coefficient experiment for a structurally C0 U seam. A bound
 * on the absolute derivative gap is required for the source and for the
 * stored proposal. The full U0 column stays fixed, preserving the seam
 * position in the coefficient model. Pcurves and trims are separate.
 * The tolerance is in coordinate units per native U unit. An accepted gap
 * alone gives no result on exact C1, G1, normal orientation or CAD.
 */
export function proposeExperimentalPeriodicAlmostC1QuinticSide(
  request: QuinticSideRequest & { seamDerivativeTolerance: number },
) {
  validateQuinticSide(request)
  const { net, seamDerivativeTolerance, lockIndices = [] } = request
  if (net.mu.slice(1, -1).some(m => m >= net.du))
    fail('richiesti nodi U interni strutturalmente C1')
  const evidenceScope = 'quintic-side-seam-coefficient-diagnostics' as const
  const before = boundExperimentalPeriodicSeamDerivativeGap(net, seamDerivativeTolerance)
  if (before.status === 'inconclusive')
    return { status: 'inconclusive' as const, phase: 'source-seam' as const, before, evidenceScope }
  if (!Array.isArray(lockIndices)) fail('indice bloccato non valido')
  const seamIndices = Array.from({ length: net.nv }, (_, v) => v)
  const proposal = proposeQuinticRows({ ...request, lockIndices: [...lockIndices, ...seamIndices] })
  if (seamIndices.some(i => net.poles[i].some((x, axis) => !Object.is(x, proposal.net.poles[i][axis]))))
    fail('colonna di posizione della cucitura modificata')
  const after = boundExperimentalPeriodicSeamDerivativeGap(proposal.net, seamDerivativeTolerance)
  if (after.status === 'inconclusive')
    return { status: 'inconclusive' as const, phase: 'candidate-seam' as const, before, after, evidenceScope }
  return { status: 'coefficient-proposal' as const, before, after, proposal, evidenceScope }
}

function validateQuinticSide({ net, edge }: QuinticSideRequest) {
  validateExperimentalPeriodicSurfaceU(net)
  if (net.dv !== 5 || net.weights.some(w => w !== 1) || (edge !== 'V0' && edge !== 'V1'))
    fail('serve una fascia V clamped di grado cinque a pesi unitari e un bordo naturale')
}

function proposeQuinticRows(request: QuinticSideRequest) {
  const { net, edge, targetInward, derivativeTolerance, secondDerivativeTolerance, lockIndices = [] } = request
  if (![derivativeTolerance, secondDerivativeTolerance].every(x => Number.isFinite(x) && x > 0))
    fail('tolleranze delle derivate finite e positive richieste')
  if (!Array.isArray(targetInward) || targetInward.length !== net.nu || !Array.from(targetInward).every(finitePoint))
    fail('coefficienti della derivata entrante non validi')
  if (!Array.isArray(lockIndices) ||
      Array.from(lockIndices).some(i => !Number.isInteger(i) || i < 0 || i >= net.poles.length))
    fail('indice bloccato non valido')

  const knots = net.kv.flatMap((knot, i) => Array<number>(net.mv[i]).fill(knot))
  const direction = edge === 'V0' ? 1 : -1
  const boundaryRow = edge === 'V0' ? 0 : net.nv - 1
  const edgeKnot = edge === 'V0' ? knots[0] : knots.at(-1)!
  const inwardKnot = (index: number) => edge === 'V0' ? knots[index] : knots.at(-1 - index)!
  const width = (index: number) => edge === 'V0' ?
    sub(scalar(inwardKnot(index)), scalar(edgeKnot)) : sub(scalar(edgeKnot), scalar(inwardKnot(index)))
  const firstWidth = width(6), secondWidth = width(7)
  const firstFactor = divide(scalar(5), firstWidth), secondFactor = divide(scalar(5), secondWidth)
  const secondDerivativeFactor = divide(scalar(4), firstWidth)
  const approximateFirstWidth = direction * (inwardKnot(6) - edgeKnot)
  const step = approximateFirstWidth / 5
  const spread = 1 + direction * (inwardKnot(7) - edgeKnot) / approximateFirstWidth
  if (!(step > 0) || !Number.isFinite(spread)) fail('scala V non rappresentabile')

  const candidate = structuredClone(net), locks = new Set(lockIndices), changedIndices: number[] = []
  let maxDerivativeResidualBound = 0, maxSecondDerivativeChangeBound = 0, maxPositionDisplacementBound = 0
  for (const [u, target] of targetInward.entries()) {
    const boundary = u * net.nv + boundaryRow
    const first = boundary + direction, second = first + direction
    const a = net.poles[boundary], b = net.poles[first], c = net.poles[second]
    const nextB = locks.has(first) ? b : a.map((x, axis) => x + step * target[axis]) as Point
    // Make both first-derivative coefficients change by the same amount.
    // Thus their difference, which controls the endpoint second derivative,
    // stays fixed in the exact target construction.
    const nextC = locks.has(second) ? c : c.map((x, axis) => x + spread * (nextB[axis] - b[axis])) as Point
    if (!finitePoint(nextB) || !finitePoint(nextC)) fail(`proposta numerica non rappresentabile alla colonna ${u}`)
    const inward = times(difference(nextB, a), firstFactor)
    const residual = norm(inward.map((x, axis) => sub(x, scalar(target[axis]))) as V)
    if (residual > derivativeTolerance)
      fail(locks.has(first) ? `residuo prima derivata al polo bloccato ${first}` : `residuo numerico prima derivata alla colonna ${u}`)

    const db = difference(nextB, b), dc = difference(nextC, c)
    const movementB = norm(db), movementC = norm(dc)
    const secondDerivativeChange = movementB === 0 && movementC === 0 ? 0 :
      norm(times(subtract(times(subtract(dc, db), secondFactor), times(db, firstFactor)), secondDerivativeFactor))
    if (secondDerivativeChange > secondDerivativeTolerance)
      fail(locks.has(second) ? `variazione seconda derivata al polo bloccato ${second}` :
        `variazione numerica seconda derivata alla colonna ${u}`)

    if (movementB > 0) {
      candidate.poles[first] = nextB
      changedIndices.push(first)
    }
    if (movementC > 0) {
      candidate.poles[second] = nextC
      changedIndices.push(second)
    }
    maxDerivativeResidualBound = Math.max(maxDerivativeResidualBound, residual)
    maxSecondDerivativeChangeBound = Math.max(maxSecondDerivativeChangeBound, secondDerivativeChange)
    maxPositionDisplacementBound = Math.max(maxPositionDisplacementBound, movementB, movementC)
  }
  return { net: candidate, changedIndices, maxDerivativeResidualBound, maxSecondDerivativeChangeBound,
    maxPositionDisplacementBound, evidenceScope: 'unit-weight-periodic-quintic-coefficient-model' as const }
}

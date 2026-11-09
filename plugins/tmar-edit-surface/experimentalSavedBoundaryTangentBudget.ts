// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { extractExperimentalPeriodicQuinticBernsteinCell } from './experimentalPeriodicQuinticBernsteinCells'
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { add, divide, mul, scalar, sub, times, type I, type V } from './tangencyCoefficientIntervals'

const fail = (reason: string): never => { throw Error(`Budget tangente salvata rifiutato: ${reason}`) }
const delta = (a: number, b: number): I => a === b ? scalar(0) : sub(scalar(a), scalar(b))
const vadd = (a: V, b: V): V => a.map((x, i) => add(x, b[i])) as V
const vsub = (a: V, b: V): V => a.map((x, i) => sub(x, b[i])) as V
const maxExactBits = 8192
type Blend = { alpha: I; beta: I }

// The acquired differential helper has the same binary64 ratio contract.
// This targeted analyzer keeps that consumed source unchanged and narrows
// correspondence to identical own U domains and the same natural V side.
function fractionInterval(numerator: bigint, denominator: bigint): I {
  if (denominator <= 0n || numerator < 0n || numerator > denominator) fail('rapporto di restrizione fuori dominio')
  if (numerator === 0n) return scalar(0)
  if (numerator === denominator) return scalar(1)
  const units = numerator << 1074n
  if (Math.max(units.toString(2).length, denominator.toString(2).length) > maxExactBits) fail('budget esatto superato')
  const shift = Math.max(0, (units / denominator).toString(2).length - 53)
  const divisor = denominator << BigInt(shift)
  if (divisor.toString(2).length > maxExactBits) fail('budget esatto superato')
  const lo = units / divisor, hi = lo + (units % divisor === 0n ? 0n : 1n)
  const scale = 2 ** (shift - 1074)
  const result: I = [Number(lo) * scale, Number(hi) * scale]
  if (!result.every(Number.isFinite) || result[0] < 0 || result[1] > 1 || result[0] > result[1])
    fail('rapporto di restrizione non rappresentabile')
  return result
}

function blend(a: V, b: V, ratio: Blend) {
  if (ratio.alpha[1] === 0) return a
  if (ratio.beta[1] === 0) return b
  return vadd(times(a, ratio.beta), times(b, ratio.alpha))
}

function restrict(controls: V[], left: Blend, right: Blend): V[] {
  const degree = controls.length - 1
  return Array.from({ length: degree + 1 }, (_, i) => {
    let work = controls
    for (let step = 0; step < degree; step++) {
      const ratio = step < degree - i ? left : right
      work = work.slice(0, -1).map((value, j) => blend(value, work[j + 1], ratio))
    }
    return work[0]
  })
}

function squaredNormUpper(vector: V): number {
  return vector.reduce((sum, coordinate) => {
    const magnitude = Math.max(Math.abs(coordinate[0]), Math.abs(coordinate[1]))
    return add(sum, mul(scalar(magnitude), scalar(magnitude)))
  }, scalar(0))[1]
}

function squaredNormLower(vector: V): number {
  const lower = vector.reduce((sum, coordinate) => {
    const magnitude = Math.max(0, coordinate[0], -coordinate[1])
    return add(sum, mul(scalar(magnitude), scalar(magnitude)))
  }, scalar(0))[0]
  return Math.max(0, lower)
}

function prepare(net: Net, side: 'V-min' | 'V-max') {
  validateExperimentalPeriodicSurfaceU(net)
  if (net.du !== 3 || net.dv !== 5 || net.mu[0] !== 3 || net.rational.some(Boolean) || net.weights.some(w => w !== 1))
    fail('richiesto supporto polinomiale cubico U periodico saturo e quintico V clamped')
  const period = delta(net.ku.at(-1)!, net.ku[0]), knotUnits = net.ku.map(binary64Units)
  const vSpan = side === 'V-min' ? 0 : net.kv.length - 2, vControl = side === 'V-min' ? 0 : 5
  const cache = new Map<number, V[]>()
  return { fields(span: number, domain: readonly [number, number]): V[] {
    if (domain[0] < net.ku[span] || domain[1] > net.ku[span + 1]) fail('cella fuori campata nativa')
    let controls = cache.get(span)
    if (!controls) {
      const patch = extractExperimentalPeriodicQuinticBernsteinCell(net, net, span, vSpan).original
      // Derive on the native cell BEFORE restricting to a possibly tiny
      // union cell. T is dS/ds for s in the full own normalized U domain.
      const factor = divide(mul(scalar(3), period), delta(net.ku[span + 1], net.ku[span]))
      controls = Array.from({ length: 3 }, (_, i) => times(vsub(patch.controls[(i + 1) * 6 + vControl],
        patch.controls[i * 6 + vControl]), factor))
      cache.set(span, controls)
    }
    const denominator = knotUnits[span + 1] - knotUnits[span]
    const at = (parameter: number): Blend => {
      const numerator = binary64Units(parameter) - knotUnits[span]
      return { alpha: fractionInterval(numerator, denominator), beta: fractionInterval(denominator - numerator, denominator) }
    }
    return restrict(controls, at(domain[0]), at(domain[1]))
  } }
}

/**
 * Targeted continuous Euclidean tangent-drift check for saved pre/post
 * coefficient models on the same natural V side and identical U domain.
 * T(s)=(Umax-Umin)*Su(Umin+s*(Umax-Umin), Vside), with s increasing.
 * The union partition retains exact binary64 knot values. Each native
 * derivative field is restricted using exact rational blend enclosures.
 *
 * The difference is a quadratic Bernstein field on every common cell.
 * Convexity of the Euclidean norm bounds its norm by the largest control
 * norm. We compare outward SQUARED Euclidean control-norm bounds with an
 * interval enclosure of the unchanged squared Euclidean budget, avoiding
 * square-root rounding and avoiding the earlier conservative L1 surrogate.
 * If this upper bound is insufficient, endpoint/midpoint interval values
 * may certify a violation. Otherwise the result remains inconclusive.
 *
 * This is a distinct targeted calculation, not a replay or amendment of a
 * previous differential receipt. It makes no position, normal/G1, global
 * regularity, periodic derivative-agreement or native-CAD claim.
 */
export function boundExperimentalSavedBoundaryTangentBudget(original: Net, candidate: Net,
  side: 'V-min' | 'V-max', tangentBudget: number, maxCells = 1024) {
  if ((side !== 'V-min' && side !== 'V-max') || !Number.isFinite(tangentBudget) || !(tangentBudget > 0))
    fail('lato V o budget tangente non valido')
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 4096) fail('budget celle non valido')
  const a = prepare(original, side), b = prepare(candidate, side)
  if (original.ku[0] !== candidate.ku[0] || original.ku.at(-1) !== candidate.ku.at(-1) ||
      original.kv[0] !== candidate.kv[0] || original.kv.at(-1) !== candidate.kv.at(-1))
    fail('domini naturali diversi: richiesta corrispondenza identità')
  const squaredBudget = mul(scalar(tangentBudget), scalar(tangentBudget))
  if (!(squaredBudget[0] > 0)) fail('quadrato del budget non rappresentabile')
  const partition = [...new Set([...original.ku, ...candidate.ku])].sort((x, y) => x - y)
  const checkedCells = partition.length - 1
  if (checkedCells > maxCells) fail('partizione comune oltre il budget')
  let originalSpan = 0, candidateSpan = 0, maximumSquaredTangentDifferenceUpper = 0
  let violatingWitness: { cell: number; localParameter: 0 | 0.5 | 1; squaredNormLower: number; squaredNormUpper: number } | undefined
  let worstCell: { cell: number; originalSpan: number; candidateSpan: number; upperSquaredNorm: number } | undefined
  let checkedWitnessPoints = 0
  for (let cell = 0; cell < checkedCells; cell++) {
    const domain = [partition[cell], partition[cell + 1]] as const
    while (originalSpan + 1 < original.ku.length - 1 && original.ku[originalSpan + 1] <= domain[0]) originalSpan++
    while (candidateSpan + 1 < candidate.ku.length - 1 && candidate.ku[candidateSpan + 1] <= domain[0]) candidateSpan++
    const left = a.fields(originalSpan, domain), right = b.fields(candidateSpan, domain)
    const difference = left.map((p, i) => vsub(right[i], p))
    const upper = Math.max(...difference.map(squaredNormUpper))
    if (!worstCell || upper > maximumSquaredTangentDifferenceUpper) {
      maximumSquaredTangentDifferenceUpper = upper
      worstCell = { cell, originalSpan, candidateSpan, upperSquaredNorm: upper }
    }
    if (upper > squaredBudget[0]) {
      const half = { alpha: scalar(0.5), beta: scalar(0.5) }
      const middle = blend(blend(difference[0], difference[1], half), blend(difference[1], difference[2], half), half)
      for (const [localParameter, vector] of [[0, difference[0]], [0.5, middle], [1, difference[2]]] as const) {
        checkedWitnessPoints++
        const lower = squaredNormLower(vector)
        if (!violatingWitness && lower > squaredBudget[1]) violatingWitness = {
          cell, localParameter, squaredNormLower: lower, squaredNormUpper: squaredNormUpper(vector),
        }
      }
    }
  }
  if (!worstCell || !Number.isFinite(maximumSquaredTangentDifferenceUpper)) fail('copertura o limite non rappresentabile')
  const classification = maximumSquaredTangentDifferenceUpper <= squaredBudget[0]
    ? 'within-unchanged-euclidean-tangent-budget' as const
    : violatingWitness ? 'outside-unchanged-euclidean-tangent-budget' as const : 'inconclusive' as const
  return { status: 'targeted-tangent-coefficient-bound' as const, classification,
    maximumSquaredTangentDifferenceUpper, squaredBudget, tangentBudget, checkedCells,
    checkedControlPairs: checkedCells * 3, checkedWitnessPoints, violatingWitness, worstCell,
    partition, maxCells, maxExactBits, side, uDomain: [original.ku[0], original.ku.at(-1)!],
    correspondence: 'identity-original-U-and-positive-normalized-s' as const,
    metric: 'euclidean-L2-norm-of-normalized-tangent-difference' as const,
    units: 'squared-mm-per-squared-normalized-U' as const,
    boundMethod: 'exact-common-partition-bernstein-squared-euclidean-control-hull' as const,
    seamEndpointContract: 'separate-one-sided-0-plus-and-1-minus' as const,
    evidenceScope: 'targeted-saved-boundary-tangent-coefficient-model' as const,
    previousReceiptAmended: false as const, exactG1Certified: false as const,
    nativeCadCertified: false as const, tubeAccepted: false as const }
}

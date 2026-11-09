// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { extractExperimentalPeriodicQuinticBernsteinCell } from './experimentalPeriodicQuinticBernsteinCells'
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { add, cross, divide, l1, mul, scalar, sub, times, type I, type V } from './tangencyCoefficientIntervals'

export interface ExperimentalSavedBoundary {
  net: Net
  side: 'V-min' | 'V-max'
  /** Sign applied to T x Sv; this is separate from an edge-use orientation. */
  normalSign: 1 | -1
}

export interface ExperimentalSavedDifferentialOptions {
  /** Dimensionless sine budget, fixed by the caller before the experiment. */
  maximumNormalSine: number
  maxCells?: number
  maxDepth?: number
  maxLeaves?: number
}

type Fraction = { numerator: bigint; denominator: bigint }
type Blend = { alpha: I; beta: I }
type Fields = { tangent: V[]; transverse: V[] }
const fail = (reason: string): never => { throw Error(`Derivate bordo salvato rifiutate: ${reason}`) }
const maxExactBits = 8192
const vadd = (a: V, b: V): V => a.map((x, i) => add(x, b[i])) as V
const vsub = (a: V, b: V): V => a.map((x, i) => sub(x, b[i])) as V
const zero = (): V => [scalar(0), scalar(0), scalar(0)]
const delta = (a: number, b: number): I => a === b ? scalar(0) : sub(scalar(a), scalar(b))
const dot = (a: V, b: V): I => a.reduce((sum, x, i) => add(sum, mul(x, b[i])), scalar(0))

function budget(...values: bigint[]) {
  if (values.some(n => (n < 0n ? -n : n).toString(2).length > maxExactBits)) fail('budget esatto superato')
}

function compare(a: Fraction, b: Fraction) {
  const left = a.numerator * b.denominator, right = b.numerator * a.denominator
  budget(left, right)
  return left < right ? -1 : left > right ? 1 : 0
}

// Same exact binary64-ratio enclosure contract as the acquired affine
// curve helper. Kept local so that the acquired source and tests stay frozen.
function fractionInterval(numerator: bigint, denominator: bigint): I {
  if (denominator <= 0n || numerator < 0n || numerator > denominator) fail('rapporto affine fuori dominio')
  if (numerator === 0n) return scalar(0)
  if (numerator === denominator) return scalar(1)
  const units = numerator << 1074n
  budget(units, denominator)
  const shift = Math.max(0, (units / denominator).toString(2).length - 53)
  const divisor = denominator << BigInt(shift)
  budget(divisor)
  const lo = units / divisor, hi = lo + (units % divisor === 0n ? 0n : 1n)
  const scale = 2 ** (shift - 1074)
  const result: I = [Number(lo) * scale, Number(hi) * scale]
  if (!result.every(Number.isFinite) || result[0] < 0 || result[1] > 1 || result[0] > result[1])
    fail('rapporto affine non rappresentabile')
  return result
}

function encoded(f: Fraction) {
  let a = f.numerator, b = f.denominator
  while (b !== 0n) [a, b] = [b, a % b]
  return { numerator: (f.numerator / a).toString(), denominator: (f.denominator / a).toString() }
}

function blend(a: V, b: V, ratio: Blend) {
  if (ratio.alpha[1] === 0) return a
  if (ratio.beta[1] === 0) return b
  return vadd(times(a, ratio.beta), times(b, ratio.alpha))
}

/** Bernstein blossom with endpoint ratios enclosed independently. */
function restrict(controls: V[], left: Blend, right: Blend): V[] {
  const degree = controls.length - 1
  return Array.from({ length: degree + 1 }, (_, index) => {
    let work = controls
    for (let step = 0; step < degree; step++) {
      const ratio = step < degree - index ? left : right
      work = work.slice(0, -1).map((a, i) => blend(a, work[i + 1], ratio))
    }
    return work[0]
  })
}

function midpointControls(controls: V[]) {
  const half = { alpha: scalar(0.5), beta: scalar(0.5) }
  return [restrict(controls, { alpha: scalar(0), beta: scalar(1) }, half),
    restrict(controls, half, { alpha: scalar(1), beta: scalar(0) })] as const
}

function binomial(n: number, k: number) {
  let answer = 1
  for (let i = 1; i <= k; i++) answer = answer * (n - i + 1) / i
  return answer
}

function product<A, B, C>(a: A[], b: B[], initial: () => C,
  term: (a: A, b: B, weight: I) => C, sum: (a: C, b: C) => C): C[] {
  const p = a.length - 1, q = b.length - 1
  const result = Array.from({ length: p + q + 1 }, initial)
  for (let i = 0; i <= p; i++) for (let j = 0; j <= q; j++) {
    const numerator = binomial(p, i) * binomial(q, j), denominator = binomial(p + q, i + j)
    const weight = numerator === denominator ? scalar(1) : divide(scalar(numerator), scalar(denominator))
    result[i + j] = sum(result[i + j], term(a[i], b[j], weight))
  }
  return result
}

const crossField = (a: V[], b: V[]) => product(a, b, zero, (x, y, w) => times(cross(x, y), w), vadd)
const dotField = (a: V[], b: V[]) => product(a, b, () => scalar(0), (x, y, w) => mul(dot(x, y), w), add)
const maxNorm = (controls: V[]) => Math.max(...controls.map(l1))

// One separated component gives a valid Euclidean norm lower bound on
// the entire cell, without assuming correctly rounded square roots.
function minNorm(controls: V[]) {
  return Math.max(0, ...[0, 1, 2].map(axis => Math.max(Math.min(...controls.map(c => c[axis][0])),
    -Math.max(...controls.map(c => c[axis][1])))))
}

function prepare(boundary: ExperimentalSavedBoundary) {
  if (!boundary || (boundary.side !== 'V-min' && boundary.side !== 'V-max') ||
      (boundary.normalSign !== 1 && boundary.normalSign !== -1)) fail('lato o segno normale non valido')
  const { net } = boundary
  validateExperimentalPeriodicSurfaceU(net)
  if (net.du !== 3 || net.dv !== 5 || net.mu[0] !== 3 || net.rational.some(Boolean) || net.weights.some(w => w !== 1))
    fail('richiesto supporto polinomiale cubico U periodico saturo e quintico V clamped')
  const first = binary64Units(net.ku[0]), knots = net.ku.map(k => binary64Units(k) - first)
  const period = knots.at(-1)!, normalized = knots.map(numerator => ({ numerator, denominator: period }))
  const periodInterval = delta(net.ku.at(-1)!, net.ku[0])
  const vSpan = boundary.side === 'V-min' ? 0 : net.kv.length - 2
  const vWidth = delta(net.kv[vSpan + 1], net.kv[vSpan])
  const cache = new Map<number, Fields>()
  return { boundary, normalized, fields(span: number, domain: readonly [Fraction, Fraction]): Fields {
    if (compare(domain[0], normalized[span]) < 0 || compare(domain[1], normalized[span + 1]) > 0)
      fail('cella normalizzata fuori campata nativa')
    let native = cache.get(span)
    if (!native) {
      const patch = extractExperimentalPeriodicQuinticBernsteinCell(net, net, span, vSpan).original
      const j = boundary.side === 'V-min' ? 0 : 5
      const uFactor = divide(mul(scalar(3), periodInterval), delta(net.ku[span + 1], net.ku[span]))
      const vFactor = divide(scalar(5), vWidth)
      native = {
        tangent: Array.from({ length: 3 }, (_, i) => times(vsub(patch.controls[(i + 1) * 6 + j], patch.controls[i * 6 + j]), uFactor)),
        transverse: Array.from({ length: 4 }, (_, i) => times(vsub(patch.controls[i * 6 + (j === 0 ? 1 : 5)],
          patch.controls[i * 6 + (j === 0 ? 0 : 4)]), vFactor)),
      }
      cache.set(span, native)
    }
    const at = (f: Fraction): Blend => {
      const numerator = f.numerator * period - knots[span] * f.denominator
      const denominator = (knots[span + 1] - knots[span]) * f.denominator
      budget(numerator, denominator)
      return { alpha: fractionInterval(numerator, denominator), beta: fractionInterval(denominator - numerator, denominator) }
    }
    const left = at(domain[0]), right = at(domain[1])
    return { tangent: restrict(native.tangent, left, right), transverse: restrict(native.transverse, left, right) }
  } }
}

type ProofFields = { tangentA: V[]; tangentB: V[]; normalA: V[]; normalB: V[] }
function splitProof(fields: ProofFields) {
  const parts = Object.fromEntries(Object.entries(fields).map(([name, values]) => [name, midpointControls(values)])) as
    Record<keyof ProofFields, readonly [V[], V[]]>
  return [0, 1].map(side => Object.fromEntries(Object.entries(parts).map(([name, values]) => [name, values[side]])) as ProofFields)
}

function inspect(fields: ProofFields) {
  const normalLower = [minNorm(fields.normalA), minNorm(fields.normalB)] as const
  const tangentLower = [minNorm(fields.tangentA), minNorm(fields.tangentB)] as const
  const dotLower = Math.min(...dotField(fields.normalA, fields.normalB).map(x => x[0]))
  const crossUpper = maxNorm(crossField(fields.normalA, fields.normalB))
  const denominator = mul(scalar(normalLower[0]), scalar(normalLower[1]))
  const sineUpper = denominator[0] > 0 ? divide(scalar(crossUpper), denominator)[1] : null
  return { normalLower, tangentLower, dotLower, sineUpper }
}

function endpointWitness(fields: ProofFields, maximumNormalSine: number) {
  for (const endpoint of [0, 1] as const) {
    const a = fields.normalA[endpoint === 0 ? 0 : fields.normalA.length - 1]
    const b = fields.normalB[endpoint === 0 ? 0 : fields.normalB.length - 1]
    const normalDot = dot(a, b)
    if (normalDot[1] < 0) return { endpoint, reason: 'negative-oriented-normal-dot' as const, normalDot }
    const denominator = mul(scalar(l1(a)), scalar(l1(b)))
    if (denominator[0] > 0) {
      const normalSineLower = divide(scalar(minNorm([cross(a, b)])), denominator)[0]
      if (normalSineLower > maximumNormalSine) return {
        endpoint, reason: 'normal-sine-budget-exceeded' as const, normalSineLower, normalDot,
      }
    }
  }
  return undefined
}

/**
 * Differential comparison on two explicitly chosen natural V boundaries.
 * For each own domain [a,b], T(s)=(b-a) Su(a+s(b-a),Vside), 0<=s<=1;
 * the transverse field is Sv in increasing V, with its original V units.
 * N=normalSign*(T x Sv). Edge-use reversal does not change these maps.
 *
 * First differentiate each native Bernstein patch with its native widths.
 * Only then restrict those derivative fields to the exact-rational common
 * normalized partition. No division by a tiny common-cell width occurs.
 * Products retain Bernstein correlation. A separated component bounds each
 * norm from below; normal dot positivity and a sine upper bound establish
 * orientation and tangency within the declared budget on every closed cell.
 * Subdivision is bounded and may remain inconclusive for valid geometry.
 *
 * Endpoint derivatives are one-sided at the saturated periodic seam. This
 * function never identifies s=0+ with s=1-, proves a common positional edge,
 * exact G1, C1, global regularity, injectivity or native CAD arithmetic.
 */
export function boundExperimentalSavedBoundaryDifferential(a: ExperimentalSavedBoundary, b: ExperimentalSavedBoundary,
  options: ExperimentalSavedDifferentialOptions) {
  if (!options || !Number.isFinite(options.maximumNormalSine) || options.maximumNormalSine < 0 || options.maximumNormalSine >= 1)
    fail('budget seno normale non valido')
  const { maximumNormalSine, maxCells = 1024, maxDepth = 8, maxLeaves = 8192 } = options
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 4096 || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 12 ||
      !Number.isInteger(maxLeaves) || maxLeaves < maxCells || maxLeaves > 65536) fail('budget di suddivisione non valido')
  const first = prepare(a), second = prepare(b)
  const merged = [...first.normalized, ...second.normalized].sort(compare)
  const partition = merged.filter((f, i) => i === 0 || compare(f, merged[i - 1]) !== 0)
  const checkedCells = partition.length - 1
  if (checkedCells > maxCells) fail('partizione comune oltre il budget')
  let firstSpan = 0, secondSpan = 0, normalizedTangentDifferenceUpper = 0, increasingVDerivativeDifferenceUpper = 0
  let checkedLeaves = 0, subdivisions = 0, unresolvedLeaves = 0, regularityUnresolvedLeaves = 0, normalSineUpper: number | null = 0
  let minimumTangentNormLower = Infinity, minimumNormalNormLower = Infinity, minimumNormalDotLower = Infinity
  let witness: (NonNullable<ReturnType<typeof endpointWitness>> & { cell: number; localDomain: readonly [number, number] }) | undefined
  for (let cell = 0; cell < checkedCells; cell++) {
    const domain = [partition[cell], partition[cell + 1]] as const
    while (firstSpan + 1 < first.normalized.length - 1 && compare(first.normalized[firstSpan + 1], domain[0]) <= 0) firstSpan++
    while (secondSpan + 1 < second.normalized.length - 1 && compare(second.normalized[secondSpan + 1], domain[0]) <= 0) secondSpan++
    const x = first.fields(firstSpan, domain), y = second.fields(secondSpan, domain)
    normalizedTangentDifferenceUpper = Math.max(normalizedTangentDifferenceUpper, maxNorm(x.tangent.map((v, i) => vsub(v, y.tangent[i]))))
    increasingVDerivativeDifferenceUpper = Math.max(increasingVDerivativeDifferenceUpper, maxNorm(x.transverse.map((v, i) => vsub(v, y.transverse[i]))))
    const initial: ProofFields = { tangentA: x.tangent, tangentB: y.tangent,
      normalA: crossField(x.tangent, x.transverse).map(n => times(n, scalar(a.normalSign))),
      normalB: crossField(y.tangent, y.transverse).map(n => times(n, scalar(b.normalSign))) }
    const pending = [{ fields: initial, depth: 0, local: [0, 1] as readonly [number, number] }]
    while (pending.length) {
      const current = pending.pop()!, bound = inspect(current.fields)
      const found = endpointWitness(current.fields, maximumNormalSine)
      if (!witness && found) witness = { ...found, cell, localDomain: current.local }
      const regular = Math.min(...bound.normalLower, ...bound.tangentLower) > 0
      const accepted = regular && bound.dotLower > 0 && bound.sineUpper !== null && bound.sineUpper <= maximumNormalSine
      // A definite witness settles the classification, but a smaller cell
      // may still be needed to establish its continuous norm lower bounds.
      // Once regularity is enclosed, retain a mismatching cell's upper bound
      // without trying to turn the mismatch into a within-budget result.
      if (!accepted && (!found || !regular) && current.depth < maxDepth && checkedLeaves + pending.length + checkedCells - cell + 1 < maxLeaves) {
        const children = splitProof(current.fields), middle = (current.local[0] + current.local[1]) / 2
        pending.push({ fields: children[0], depth: current.depth + 1, local: [current.local[0], middle] },
          { fields: children[1], depth: current.depth + 1, local: [middle, current.local[1]] })
        subdivisions++
        continue
      }
      checkedLeaves++
      if (!accepted && !found) unresolvedLeaves++
      if (!regular) regularityUnresolvedLeaves++
      minimumTangentNormLower = Math.min(minimumTangentNormLower, ...bound.tangentLower)
      minimumNormalNormLower = Math.min(minimumNormalNormLower, ...bound.normalLower)
      minimumNormalDotLower = Math.min(minimumNormalDotLower, bound.dotLower)
      normalSineUpper = normalSineUpper === null || bound.sineUpper === null ? null : Math.max(normalSineUpper, bound.sineUpper)
    }
  }
  const classification = witness ? 'outside-declared-normal-budget' as const : unresolvedLeaves
    ? 'inconclusive' as const : 'within-declared-normal-budget' as const
  const describe = ({ net, side, normalSign }: ExperimentalSavedBoundary) => ({ side, normalSign,
    uDomain: [net.ku[0], net.ku.at(-1)!], vDomain: [net.kv[0], net.kv.at(-1)!],
    inwardTransverseSign: side === 'V-min' ? 1 : -1, internalUCreaseKnots: net.ku.filter((_, i) => i > 0 && i < net.ku.length - 1 && net.mu[i] === net.du) })
  return { status: 'differential-coefficient-bound' as const, classification, normalizedTangentDifferenceUpper,
    increasingVDerivativeDifferenceUpper, normalSineUpper, minimumTangentNormLower, minimumNormalNormLower,
    minimumNormalDotLower, checkedCells, checkedLeaves, subdivisions, unresolvedLeaves, regularityUnresolvedLeaves, witness,
    unresolvedLeavesScope: 'normal-budget-without-definite-violation' as const,
    boundaryRegularityCertified: regularityUnresolvedLeaves === 0 && minimumTangentNormLower > 0 && minimumNormalNormLower > 0,
    criteria: { maximumNormalSine, strictlyPositiveTangentAndNormal: true, strictlyPositiveOrientedNormalDot: true },
    budget: { maxCells, maxDepth, maxLeaves, maxExactBits }, normalizedPartition: partition.map(encoded),
    first: describe(a), second: describe(b), correspondence: 'exact-positive-affine-normalized-U' as const,
    seamEndpointContract: 'separate-one-sided-0-plus-and-1-minus' as const,
    evidenceScope: 'saved-boundary-differential-coefficient-model' as const,
    exactG1Certified: false as const, nativeCadCertified: false as const, tubeAccepted: false as const }
}

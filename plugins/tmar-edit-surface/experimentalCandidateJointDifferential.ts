// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { extractExperimentalPeriodicLinearVBernsteinCell, extractExperimentalPeriodicQuinticBernsteinCell } from './experimentalPeriodicQuinticBernsteinCells'
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { add, cross, divide, l1, mul, scalar, sub, times, type I, type V } from './tangencyCoefficientIntervals'

export interface ExperimentalCandidateJointBoundary { net: Net; edge: 'V0' | 'V1' }
export interface ExperimentalCandidateJointCriteria {
  maximumPositionGapMm: number
  maximumTangentChord: number
  maximumNormalChord: number
  minimumNativeTangentNorm: number
  minimumTransverseNorm: number
  minimumPositiveScale: number
  maxCells?: number
  maxDepth?: number
  maxLeaves?: number
}

type Fraction = { numerator: bigint; denominator: bigint }
type Blend = { alpha: I; beta: I }
type Fields = { position: V[]; tangent: V[]; inward: V[] }
type Metric = 'position' | 'nativeTangentNorm' | 'transverseNorm' | 'tangentOrientation' | 'tangentChord' |
  'normalOrientation' | 'normalChord' | 'positiveScale'
const metrics: Metric[] = ['position', 'nativeTangentNorm', 'transverseNorm', 'tangentOrientation', 'tangentChord',
  'normalOrientation', 'normalChord', 'positiveScale']
const maxExactBits = 8192
function fail(reason: string): never { throw Error(`Candidate joint differential refused: ${reason}`) }
const vadd = (a: V, b: V): V => a.map((x, i) => add(x, b[i])) as V
const vsub = (a: V, b: V): V => a.map((x, i) => sub(x, b[i])) as V
const zero = (): V => [scalar(0), scalar(0), scalar(0)]
const delta = (a: number, b: number): I => a === b ? scalar(0) : sub(scalar(a), scalar(b))
const dot = (a: V, b: V): I => a.reduce((sum, x, i) => add(sum, mul(x, b[i])), scalar(0))

function budget(...n: bigint[]) {
  if (n.some(x => (x < 0n ? -x : x).toString(2).length > maxExactBits)) fail('exact-arithmetic-budget')
}
function compare(a: Fraction, b: Fraction) {
  const x = a.numerator * b.denominator, y = b.numerator * a.denominator
  budget(x, y); return x < y ? -1 : x > y ? 1 : 0
}
function fractionInterval(n: bigint, d: bigint): I {
  if (d <= 0n || n < 0n || n > d) fail('invalid-restriction-ratio')
  if (n === 0n) return scalar(0)
  if (n === d) return scalar(1)
  const units = n << 1074n; budget(units, d)
  const shift = Math.max(0, (units / d).toString(2).length - 53), divisor = d << BigInt(shift)
  budget(divisor)
  const low = units / divisor, high = low + (units % divisor === 0n ? 0n : 1n), scale = 2 ** (shift - 1074)
  const out: I = [Number(low) * scale, Number(high) * scale]
  if (!out.every(Number.isFinite) || out[0] < 0 || out[1] > 1 || out[0] > out[1]) fail('unrepresentable-restriction-ratio')
  return out
}
function encoded(f: Fraction) {
  let a = f.numerator, b = f.denominator
  while (b !== 0n) [a, b] = [b, a % b]
  return { numerator: (f.numerator / a).toString(), denominator: (f.denominator / a).toString() }
}
function blend(a: V, b: V, r: Blend): V {
  if (r.alpha[1] === 0) return a
  if (r.beta[1] === 0) return b
  return vadd(times(a, r.beta), times(b, r.alpha))
}
function restrict(controls: V[], left: Blend, right: Blend): V[] {
  const degree = controls.length - 1
  return Array.from({ length: degree + 1 }, (_, i) => {
    let work = controls
    for (let j = 0; j < degree; j++) {
      const r = j < degree - i ? left : right
      work = work.slice(0, -1).map((p, k) => blend(p, work[k + 1], r))
    }
    return work[0]
  })
}
function splitV(controls: V[]) {
  const half = { alpha: scalar(.5), beta: scalar(.5) }
  return [restrict(controls, { alpha: scalar(0), beta: scalar(1) }, half),
    restrict(controls, half, { alpha: scalar(1), beta: scalar(0) })] as const
}
function splitI(controls: I[]) {
  return splitV(controls.map(x => [x, scalar(0), scalar(0)] as V)).map(part => part.map(v => v[0]))
}
function binomial(n: number, k: number) {
  let answer = 1
  for (let i = 1; i <= k; i++) answer = answer * (n - i + 1) / i
  return answer
}
function product<A, B, C>(a: A[], b: B[], initial: () => C,
  term: (a: A, b: B, weight: I) => C, sum: (a: C, b: C) => C): C[] {
  const p = a.length - 1, q = b.length - 1, out = Array.from({ length: p + q + 1 }, initial)
  for (let i = 0; i <= p; i++) for (let j = 0; j <= q; j++) {
    const n = binomial(p, i) * binomial(q, j), d = binomial(p + q, i + j)
    const w = n === d ? scalar(1) : divide(scalar(n), scalar(d))
    out[i + j] = sum(out[i + j], term(a[i], b[j], w))
  }
  return out
}
const crossField = (a: V[], b: V[]) => product(a, b, zero, (x, y, w) => times(cross(x, y), w), vadd)
const dotField = (a: V[], b: V[]) => product(a, b, () => scalar(0), (x, y, w) => mul(dot(x, y), w), add)
const mulField = (a: I[], b: I[]) => product(a, b, () => scalar(0), (x, y, w) => mul(mul(x, y), w), add)
const minI = (c: I[]) => Math.min(...c.map(x => x[0]))
const maxI = (c: I[]) => Math.max(...c.map(x => x[1]))
const maxNorm = (c: V[]) => Math.max(...c.map(l1))
const minNorm = (c: V[]) => Math.max(0, ...[0, 1, 2].map(axis =>
  Math.max(Math.min(...c.map(p => p[axis][0])), -Math.max(...c.map(p => p[axis][1])))))

function prepare(boundary: ExperimentalCandidateJointBoundary, positionOrigin: Point) {
  if (!boundary || (boundary.edge !== 'V0' && boundary.edge !== 'V1')) fail('invalid-natural-edge')
  const { net, edge } = boundary; validateExperimentalPeriodicSurfaceU(net)
  if (net.du !== 3 || (net.dv !== 1 && net.dv !== 5) || net.mu[0] !== 3 ||
      net.rational.some(Boolean) || net.weights.some(w => w !== 1)) fail('polynomial-cubic-U-linear-or-quintic-V-required')
  const first = binary64Units(net.ku[0]), knots = net.ku.map(k => binary64Units(k) - first), period = knots.at(-1)!
  const normalized = knots.map(numerator => ({ numerator, denominator: period }))
  const periodInterval = delta(net.ku.at(-1)!, net.ku[0]), vSpan = edge === 'V0' ? 0 : net.kv.length - 2
  const vWidth = delta(net.kv[vSpan + 1], net.kv[vSpan]), cache = new Map<number, Fields>()
  return { boundary, periodInterval, normalized, fields(span: number, domain: readonly [Fraction, Fraction]): Fields {
    if (compare(domain[0], normalized[span]) < 0 || compare(domain[1], normalized[span + 1]) > 0) fail('cell-outside-native-span')
    let native = cache.get(span)
    if (!native) {
      const extracted = (net.dv === 5 ? extractExperimentalPeriodicQuinticBernsteinCell : extractExperimentalPeriodicLinearVBernsteinCell)(net, net, span, vSpan)
      const patch = extracted.original, translation = extracted.origin.map((x, axis) => delta(x, positionOrigin[axis])) as V
      const stride = net.dv + 1, j = edge === 'V0' ? 0 : net.dv, adjacent = edge === 'V0' ? 1 : net.dv - 1
      const uFactor = divide(mul(scalar(3), periodInterval), delta(net.ku[span + 1], net.ku[span]))
      const vFactor = divide(scalar(net.dv), vWidth)
      native = { position: Array.from({ length: 4 }, (_, i) => vadd(patch.controls[i * stride + j], translation)),
        tangent: Array.from({ length: 3 }, (_, i) => times(vsub(patch.controls[(i + 1) * stride + j], patch.controls[i * stride + j]), uFactor)),
        inward: Array.from({ length: 4 }, (_, i) => times(vsub(patch.controls[i * stride + adjacent], patch.controls[i * stride + j]), vFactor)) }
      cache.set(span, native)
    }
    const at = (f: Fraction): Blend => {
      const n = f.numerator * period - knots[span] * f.denominator, d = (knots[span + 1] - knots[span]) * f.denominator
      budget(n, d); return { alpha: fractionInterval(n, d), beta: fractionInterval(d - n, d) }
    }
    const left = at(domain[0]), right = at(domain[1])
    return { position: restrict(native.position, left, right), tangent: restrict(native.tangent, left, right), inward: restrict(native.inward, left, right) }
  } }
}

function chordFields(a: V[], b: V[], chord: number) {
  const c2 = mul(scalar(chord), scalar(chord)), sine2 = mul(c2, sub(scalar(1), divide(c2, scalar(4))))
  const crossed = crossField(a, b), crossSquared = dotField(crossed, crossed)
  const normProduct = mulField(dotField(a, a), dotField(b, b))
  const margin = normProduct.map((x, i) => sub(mul(sine2, x), crossSquared[i]))
  return { dot: dotField(a, b), margin, crossSquared, normProduct }
}
type Proof = { vectors: Record<'dp' | 'ta' | 'tb' | 'na' | 'nb' | 'nr', V[]>; scalars: Record<string, I[]> }
function proof(a: Fields, b: Fields, criteria: ExperimentalCandidateJointCriteria): Proof {
  const r = b.inward.map(v => times(v, scalar(-1)))
  const na = crossField(a.tangent, a.inward), nb = crossField(b.tangent, r), nr = crossField(a.tangent, r)
  const tangent = chordFields(a.tangent, b.tangent, criteria.maximumTangentChord)
  const normal = chordFields(na, nb, criteria.maximumNormalChord)
  const lambdaNumerator = dotField(na, nr), lambdaDenominator = dotField(nr, nr)
  return { vectors: { dp: a.position.map((p, i) => vsub(p, b.position[i])), ta: a.tangent, tb: b.tangent, na, nb, nr }, scalars: {
    tangentDot: tangent.dot, tangentMargin: tangent.margin, tangentCrossSquared: tangent.crossSquared, tangentNormProduct: tangent.normProduct,
    normalDot: normal.dot, normalMargin: normal.margin, normalCrossSquared: normal.crossSquared, normalNormProduct: normal.normProduct,
    lambdaNumerator, lambdaDenominator, normalResidualNumerator: dotField(a.inward, nb),
    lambdaMargin: lambdaNumerator.map((x, i) => sub(x, mul(scalar(criteria.minimumPositiveScale), lambdaDenominator[i]))),
  } }
}
function splitProof(p: Proof) {
  const v = Object.fromEntries(Object.entries(p.vectors).map(([key, value]) => [key, splitV(value)])) as Record<keyof Proof['vectors'], readonly [V[], V[]]>
  const s = Object.fromEntries(Object.entries(p.scalars).map(([key, value]) => [key, splitI(value)])) as Record<string, I[][]>
  return [0, 1].map(side => ({ vectors: Object.fromEntries(Object.entries(v).map(([key, value]) => [key, value[side]])),
    scalars: Object.fromEntries(Object.entries(s).map(([key, value]) => [key, value[side]])) })) as Proof[]
}
function inspect(p: Proof, periods: readonly [I, I], c: ExperimentalCandidateJointCriteria) {
  const { dp, ta, tb, na, nb, nr } = p.vectors, s = p.scalars
  const tangentLower = [minNorm(ta), minNorm(tb)], tangentUpper = [maxNorm(ta), maxNorm(tb)]
  const normalLower = [minNorm(na), minNorm(nb), minNorm(nr)]
  const nativeTangentLower = tangentLower.map((x, i) => Math.max(0, divide(scalar(x), periods[i])[0]))
  const transverseLower = normalLower.map((x, i) => tangentUpper[i === 1 ? 1 : 0] > 0
    ? Math.max(0, divide(scalar(x), scalar(tangentUpper[i === 1 ? 1 : 0]))[0]) : 0)
  const normalRegular = Math.min(...normalLower) > 0, tangentRegular = Math.min(...tangentLower) > 0
  const accepted: Record<Metric, boolean> = {
    position: maxNorm(dp) <= c.maximumPositionGapMm,
    nativeTangentNorm: Math.min(...nativeTangentLower) >= c.minimumNativeTangentNorm,
    transverseNorm: tangentRegular && Math.min(...transverseLower) >= c.minimumTransverseNorm,
    tangentOrientation: tangentRegular && minI(s.tangentDot) > 0,
    tangentChord: tangentRegular && minI(s.tangentDot) > 0 && minI(s.tangentMargin) >= 0,
    normalOrientation: normalRegular && minI(s.normalDot) > 0,
    normalChord: normalRegular && minI(s.normalDot) > 0 && minI(s.normalMargin) >= 0,
    positiveScale: minNorm(nr) > 0 && minI(s.lambdaMargin) >= 0,
  }
  const normalResidualUpper = normalLower[1] > 0 ? divide(scalar(Math.max(...s.normalResidualNumerator.map(x => Math.max(Math.abs(x[0]), Math.abs(x[1]))))), scalar(normalLower[1]))[1] : null
  return { accepted, maximumPositionGapUpper: maxNorm(dp), normalResidualUpper, nativeTangentLower, transverseLower, normalLower,
    tangentDotLower: minI(s.tangentDot), normalDotLower: minI(s.normalDot),
    tangentChordMarginLower: minI(s.tangentMargin), normalChordMarginLower: minI(s.normalMargin),
    lambdaMarginLower: minI(s.lambdaMargin), lambdaLower: minI(s.lambdaNumerator) >= 0 && maxI(s.lambdaDenominator) > 0
      ? divide(scalar(minI(s.lambdaNumerator)), scalar(maxI(s.lambdaDenominator)))[0] : null }
}

type Witness = { metric: Metric; endpoint: 0 | 1; reason: string; enclosure: I }
function witnesses(p: Proof, criteria: ExperimentalCandidateJointCriteria): Witness[] {
  const out: Witness[] = []
  for (const endpoint of [0, 1] as const) {
    const at = (name: string) => endpoint === 0 ? p.scalars[name][0] : p.scalars[name].at(-1)!
    const position = endpoint === 0 ? p.vectors.dp[0] : p.vectors.dp.at(-1)!
    const squaredPosition = dot(position, position), positionBudgetSquared = mul(scalar(criteria.maximumPositionGapMm), scalar(criteria.maximumPositionGapMm))
    if (squaredPosition[0] > positionBudgetSquared[1]) out.push({ metric: 'position', endpoint, reason: 'position-gap-exceeds-budget', enclosure: squaredPosition })
    const pointNorm = (name: keyof Proof['vectors']) => minNorm([endpoint === 0 ? p.vectors[name][0] : p.vectors[name].at(-1)!])
    for (const [metric, field, reason, regular] of [
      ['tangentOrientation', 'tangentDot', 'negative-oriented-tangent-dot', pointNorm('ta') > 0 && pointNorm('tb') > 0],
      ['normalOrientation', 'normalDot', 'negative-oriented-normal-dot', pointNorm('na') > 0 && pointNorm('nb') > 0],
      ['tangentChord', 'tangentDot', 'unit-tangent-chord-exceeds-budget-by-negative-dot', pointNorm('ta') > 0 && pointNorm('tb') > 0],
      ['normalChord', 'normalDot', 'unit-normal-chord-exceeds-budget-by-negative-dot', pointNorm('na') > 0 && pointNorm('nb') > 0],
      ['tangentChord', 'tangentMargin', 'unit-tangent-chord-exceeds-budget', pointNorm('ta') > 0 && pointNorm('tb') > 0 && at('tangentDot')[0] > 0],
      ['normalChord', 'normalMargin', 'unit-normal-chord-exceeds-budget', pointNorm('na') > 0 && pointNorm('nb') > 0 && at('normalDot')[0] > 0],
      ['positiveScale', 'lambdaMargin', 'positive-scale-below-floor', pointNorm('nr') > 0],
    ] as const) if (regular && at(field)[1] < 0) out.push({ metric, endpoint, reason, enclosure: at(field) })
  }
  return out
}

/**
 * Continuous natural-boundary differential qualification for a supplied
 * candidate and its fixed support. Position controls use one shared origin.
 * Each original U domain maps affinely, increasingly to s in[0,1]. T=L*Su;
 * M is lateral inward and R is MINUS support inward, in native V units.
 * Normal comparisons use T_lateral x M and T_support x R. Native face and
 * wire orientations are not inferred from these parameter maps.
 *
 * Derive on each native cell before exact-rational restriction. All products
 * retain Bernstein correlation. For positive dot and c<1, unit chord<=c is
 * equivalent to |A x B|² <= c²(1-c²/4)|A|²|B|². This form avoids loss of a
 * tiny tangent budget by subtracting c² from2 and does not relax the chord.
 * Lambda=(Tl x M).(Tl x R)/|Tl x R|² is checked as a polynomial inequality.
 * Every criterion has its own continuous coverage and violating witnesses.
 * A norm lower bound is deliberately conservative; unresolved is not FAIL.
 * No global support regularity, native CAD or Tube claim is made.
 */
export function boundExperimentalCandidateJointDifferential(lateral: ExperimentalCandidateJointBoundary,
  support: ExperimentalCandidateJointBoundary, criteria: ExperimentalCandidateJointCriteria) {
  if (!criteria || !Number.isFinite(criteria.maximumPositionGapMm) || criteria.maximumPositionGapMm <= 0 || ![criteria.maximumTangentChord, criteria.maximumNormalChord].every(x => Number.isFinite(x) && x > 0 && x < 1) ||
      ![criteria.minimumNativeTangentNorm, criteria.minimumTransverseNorm, criteria.minimumPositiveScale].every(x => Number.isFinite(x) && x > 0) ||
      criteria.minimumPositiveScale > 1) fail('invalid-criteria')
  const { maxCells = 4096, maxDepth = 12, maxLeaves = 65536 } = criteria
  if (!Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > 4096 || !Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 12 ||
      !Number.isSafeInteger(maxLeaves) || maxLeaves < maxCells || maxLeaves > 131072) fail('invalid-subdivision-budget')
  const positionOrigin = lateral?.net?.poles?.[0]
  if (!positionOrigin || positionOrigin.length !== 3 || !positionOrigin.every(Number.isFinite)) fail('invalid-position-origin')
  const a = prepare(lateral, positionOrigin), b = prepare(support, positionOrigin), periods = [a.periodInterval, b.periodInterval] as const
  const merged = [...a.normalized, ...b.normalized].sort(compare), partition = merged.filter((x, i) => i === 0 || compare(x, merged[i - 1]) !== 0)
  const checkedCells = partition.length - 1
  if (checkedCells > maxCells) fail('common-partition-budget')
  type LocatedWitness = Witness & { cell: number; localDomain: readonly [number, number] }
  const evidence = Object.fromEntries(metrics.map(key => [key, { certifiedLeaves: 0, unresolvedLeaves: 0, witnesses: [] as LocatedWitness[] }])) as
    Record<Metric, { certifiedLeaves: number; unresolvedLeaves: number; witnesses: LocatedWitness[] }>
  let ia = 0, ib = 0, checkedLeaves = 0, subdivisions = 0, maximumPositionGapUpper = 0, maximumContinuousNormalResidualUpperMmPerV = 0
  let minimumNativeTangentNormLower = Infinity, minimumTransverseNormLower = Infinity, minimumNormalNormLower = Infinity
  let minimumNormalDotLower = Infinity, minimumTangentDotLower = Infinity, minimumLambdaLower = Infinity
  const problemCells: { cell: number; localDomain: readonly [number, number]; unresolved: Metric[] }[] = []
  for (let cell = 0; cell < checkedCells; cell++) {
    const domain = [partition[cell], partition[cell + 1]] as const
    while (ia + 1 < a.normalized.length - 1 && compare(a.normalized[ia + 1], domain[0]) <= 0) ia++
    while (ib + 1 < b.normalized.length - 1 && compare(b.normalized[ib + 1], domain[0]) <= 0) ib++
    const pending = [{ p: proof(a.fields(ia, domain), b.fields(ib, domain), criteria), depth: 0, local: [0, 1] as readonly [number, number] }]
    while (pending.length) {
      const current = pending.pop()!, bounds = inspect(current.p, periods, criteria), found = witnesses(current.p, criteria)
      for (const w of found) if (evidence[w.metric].witnesses.length < 8)
        evidence[w.metric].witnesses.push({ ...w, cell, localDomain: current.local })
      const unresolved = metrics.filter(key => !bounds.accepted[key] && evidence[key].witnesses.length === 0)
      if (unresolved.length && current.depth < maxDepth && checkedLeaves + pending.length + checkedCells - cell + 1 < maxLeaves) {
        const children = splitProof(current.p), middle = (current.local[0] + current.local[1]) / 2
        pending.push({ p: children[1], depth: current.depth + 1, local: [middle, current.local[1]] },
          { p: children[0], depth: current.depth + 1, local: [current.local[0], middle] }); subdivisions++; continue
      }
      checkedLeaves++
      for (const key of metrics) {
        if (bounds.accepted[key]) evidence[key].certifiedLeaves++
        else evidence[key].unresolvedLeaves++
      }
      if (unresolved.length && problemCells.length < 8) problemCells.push({ cell, localDomain: current.local, unresolved })
      maximumPositionGapUpper = Math.max(maximumPositionGapUpper, bounds.maximumPositionGapUpper)
      maximumContinuousNormalResidualUpperMmPerV = Math.max(maximumContinuousNormalResidualUpperMmPerV, bounds.normalResidualUpper ?? Infinity)
      minimumNativeTangentNormLower = Math.min(minimumNativeTangentNormLower, ...bounds.nativeTangentLower)
      minimumTransverseNormLower = Math.min(minimumTransverseNormLower, ...bounds.transverseLower)
      minimumNormalNormLower = Math.min(minimumNormalNormLower, ...bounds.normalLower)
      minimumTangentDotLower = Math.min(minimumTangentDotLower, bounds.tangentDotLower)
      minimumNormalDotLower = Math.min(minimumNormalDotLower, bounds.normalDotLower)
      minimumLambdaLower = Math.min(minimumLambdaLower, bounds.lambdaLower ?? -Infinity)
    }
  }
  const criterionResults = Object.fromEntries(metrics.map(key => [key, { ...evidence[key],
    classification: evidence[key].witnesses.length ? 'outside-declared-criterion' as const :
      evidence[key].unresolvedLeaves ? 'inconclusive' as const : 'within-declared-criterion' as const }]))
  const hasWitness = metrics.some(key => evidence[key].witnesses.length), unresolved = metrics.some(key => evidence[key].unresolvedLeaves)
  return { status: 'candidate-joint-continuous-coefficient-analysis' as const,
    classification: hasWitness ? 'outside-declared-joint-criteria' as const : unresolved ? 'inconclusive' as const : 'within-declared-joint-criteria' as const,
    criterionResults, criteria: { ...criteria, maxCells, maxDepth, maxLeaves }, checkedCells, checkedLeaves, subdivisions, problemCells,
    normalizedPartition: partition.map(encoded), maximumPositionGapUpper,
    maximumContinuousNormalResidualUpperMmPerV: Number.isFinite(maximumContinuousNormalResidualUpperMmPerV) ? maximumContinuousNormalResidualUpperMmPerV : null,
    normalResidualIsAcceptanceGate: false as const, minimumNativeTangentNormLower, minimumTransverseNormLower,
    minimumNormalNormLower, minimumTangentDotLower, minimumNormalDotLower,
    minimumLambdaLower: Number.isFinite(minimumLambdaLower) ? minimumLambdaLower : null,
    lateral: { edge: lateral.edge, uDomain: [lateral.net.ku[0], lateral.net.ku.at(-1)!], inwardSign: lateral.edge === 'V0' ? 1 : -1 },
    support: { edge: support.edge, uDomain: [support.net.ku[0], support.net.ku.at(-1)!], referenceSign: support.edge === 'V0' ? -1 : 1 },
    correspondence: 'positive-affine-original-U-to-common-normalized-s' as const,
    seamEndpointContract: 'separate-one-sided-0-plus-and-1-minus' as const,
    scope: 'continuous-natural-boundary-differential-coefficient-model' as const,
    positionWithinDeclaredBudget: criterionResults.position.classification === 'within-declared-criterion', exactG1Certified: false as const,
    globalSupportRegularityCertified: false as const, nativeCadCertified: false as const, tubeAccepted: false as const }
}

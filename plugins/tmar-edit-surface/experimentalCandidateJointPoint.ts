// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import type { ExperimentalCandidateJointBoundary } from './experimentalCandidateJointDifferential'
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { add, cross, divide, mul, scalar, sub, times, type I, type V } from './tangencyCoefficientIntervals'

export interface ExperimentalCandidateExactParameter { numerator: string; denominator: string }
export interface ExperimentalCandidateSavedWitness {
  cell: number
  localDomain: readonly [number, number]
  endpoint: 0 | 1
}
export interface ExperimentalCandidateNativeJointParameter {
  lateralU: number
  supportU: number
  /** At a knot, preserve the requested polynomial piece. U0/left is refused: use Uend/left. */
  lateralSide?: 'left' | 'right'
  supportSide?: 'left' | 'right'
}
export interface ExperimentalCandidateJointPointOptions {
  maxCells?: number
  maxPointEvaluations?: number
  targetInward?: readonly Point[]
}

type Fraction = { numerator: bigint; denominator: bigint }
type Blend = { alpha: I; beta: I; inverseNativeWidth: I; j: number }
const maxExactBits = 8192
const maxSqrtBracketSteps = 8
const binaryScale = 1n << 1074n
const fail = (reason: string): never => { throw Error(`Candidate joint point refused: ${reason}`) }
const vadd = (a: V, b: V): V => a.map((x, i) => add(x, b[i])) as V
export const subtractExperimentalCandidatePointVectors = (a: V, b: V): V => a.map((x, i) => sub(x, b[i])) as V
const vzero = (): V => [scalar(0), scalar(0), scalar(0)]
const delta = (a: number, b: number): I => a === b ? scalar(0) : sub(scalar(a), scalar(b))
const dot = (a: V, b: V): I => a.reduce((sum, x, i) => add(sum, mul(x, b[i])), scalar(0))
const abs = (a: I): I => [a[0] > 0 ? a[0] : a[1] < 0 ? -a[1] : 0, Math.max(Math.abs(a[0]), Math.abs(a[1]))]

function budget(...values: bigint[]) {
  if (values.some(x => (x < 0n ? -x : x).toString(2).length > maxExactBits)) fail('exact-arithmetic-budget')
}
function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (denominator <= 0n) fail('nonpositive-exact-denominator')
  budget(numerator, denominator)
  let a = numerator < 0n ? -numerator : numerator, b = denominator
  while (b !== 0n) [a, b] = [b, a % b]
  return { numerator: numerator / a, denominator: denominator / a }
}
function compare(a: Fraction, b: Fraction) {
  const x = a.numerator * b.denominator, y = b.numerator * a.denominator
  budget(x, y); return x < y ? -1 : x > y ? 1 : 0
}
const encode = (f: Fraction): ExperimentalCandidateExactParameter => ({ numerator: f.numerator.toString(), denominator: f.denominator.toString() })
function ratio(numerator: bigint, denominator: bigint): I {
  if (denominator <= 0n) fail('nonpositive-ratio-denominator')
  if (numerator < 0n) { const a = ratio(-numerator, denominator); return [-a[1], -a[0]] }
  if (numerator === 0n) return scalar(0)
  const units = numerator << 1074n; budget(units, denominator)
  const shift = Math.max(0, (units / denominator).toString(2).length - 53), divisor = denominator << BigInt(shift)
  budget(divisor)
  const lo = units / divisor, hi = lo + (units % divisor === 0n ? 0n : 1n), scale = 2 ** (shift - 1074)
  const out: I = [Number(lo) * scale, Number(hi) * scale]
  if (!out.every(Number.isFinite) || out[0] > out[1]) fail('unrepresentable-exact-ratio')
  return out
}
function blend(a: V, b: V, r: Pick<Blend, 'alpha' | 'beta'>): V {
  if (r.alpha[1] === 0) return a
  if (r.beta[1] === 0) return b
  return vadd(times(a, r.beta), times(b, r.alpha))
}
function validPoints(values: readonly Point[], count: number) {
  if (!Array.isArray(values) || values.length !== count) return false
  for (let i = 0; i < count; i++) if (!Object.hasOwn(values, i) || !Array.isArray(values[i]) || values[i].length !== 3 ||
      ![0, 1, 2].every(j => Object.hasOwn(values[i], j) && Number.isFinite(values[i][j]))) return false
  return true
}

// Math.sqrt is only a starting guess. Exact binary64 integer comparisons
// establish the final bracket, so correctness does not depend on its rounding.
const sqrtBits = new BigUint64Array(1), sqrtNumber = new Float64Array(sqrtBits.buffer)
function adjacentPositive(x: number, upward: boolean) {
  if (x === 0) return upward ? Number.MIN_VALUE : 0
  sqrtNumber[0] = x; sqrtBits[0] += upward ? 1n : -1n
  if (!Number.isFinite(sqrtNumber[0])) fail('sqrt-bracket-overflow')
  return sqrtNumber[0]
}
function sqrtBracket(x: number): I {
  if (!(x >= 0) || !Number.isFinite(x)) fail('invalid-squared-norm')
  if (x === 0) return scalar(0)
  const target = binary64Units(x) << 1074n; budget(target)
  const squared = (y: number) => { const u = binary64Units(y), s = u * u; budget(s); return s }
  let lower = Math.sqrt(x)
  for (let step = 0; step < maxSqrtBracketSteps; step++) {
    const sq = squared(lower)
    if (sq === target) return scalar(lower)
    if (sq > target) { lower = adjacentPositive(lower, false); continue }
    const upper = adjacentPositive(lower, true)
    if (squared(upper) >= target) return [lower, upper]
    lower = upper
  }
  return fail('sqrt-bracket-step-budget')
}
export function normExperimentalCandidatePointVector(v: V): I {
  let squaredNorm: I = scalar(0)
  for (const coordinate of v) {
    if (!Array.isArray(coordinate) || coordinate.length !== 2 || !coordinate.every(Number.isFinite) || coordinate[0] > coordinate[1]) fail('invalid-vector-interval')
    const a = abs(coordinate), lower = mul(scalar(a[0]), scalar(a[0]))[0], upper = mul(scalar(a[1]), scalar(a[1]))[1]
    squaredNorm = add(squaredNorm, [Math.max(0, lower), upper])
  }
  return [sqrtBracket(Math.max(0, squaredNorm[0]))[0], sqrtBracket(Math.max(0, squaredNorm[1]))[1]]
}

export interface ExperimentalCandidateJointPointFrame { T: V; supportT: V; M: V; R: V }
function residuals(frame: ExperimentalCandidateJointPointFrame) {
  const { T, supportT, M, R } = frame, referenceNormal = cross(T, R), supportNormal = cross(supportT, R)
  const referenceNormalNorm = normExperimentalCandidatePointVector(referenceNormal), supportNormalNorm = normExperimentalCandidatePointVector(supportNormal)
  const signedResidual = (n: V, norm: I): I | null => norm[0] > 0 ? divide(dot(M, n), norm) : null
  const referenceSignedNormalResidualMmPerV = signedResidual(referenceNormal, referenceNormalNorm)
  const supportSignedNormalResidualMmPerV = signedResidual(supportNormal, supportNormalNorm)
  const referenceAbsoluteNormalResidualMmPerV = referenceSignedNormalResidualMmPerV && abs(referenceSignedNormalResidualMmPerV)
  const supportAbsoluteNormalResidualMmPerV = supportSignedNormalResidualMmPerV && abs(supportSignedNormalResidualMmPerV)
  const historicalMaximumAbsoluteNormalResidualMmPerV: I | null = referenceAbsoluteNormalResidualMmPerV && supportAbsoluteNormalResidualMmPerV
    ? [Math.max(referenceAbsoluteNormalResidualMmPerV[0], supportAbsoluteNormalResidualMmPerV[0]),
      Math.max(referenceAbsoluteNormalResidualMmPerV[1], supportAbsoluteNormalResidualMmPerV[1])] : null
  return { referenceNormal, supportNormal, referenceNormalNorm, supportNormalNorm,
    referenceSignedNormalResidualMmPerV, supportSignedNormalResidualMmPerV,
    referenceAbsoluteNormalResidualMmPerV, supportAbsoluteNormalResidualMmPerV, historicalMaximumAbsoluteNormalResidualMmPerV }
}
/** Both historical residual bases are retained, in native-V derivative units. */
export function measureExperimentalCandidateJointPoint(frame: ExperimentalCandidateJointPointFrame, maximumNormalChord = 1e-4) {
  if (!Number.isFinite(maximumNormalChord) || maximumNormalChord <= 0 || maximumNormalChord >= 1) fail('invalid-normal-chord-budget')
  const measured = residuals(frame), normal = cross(frame.T, frame.M), normalNorm = normExperimentalCandidatePointVector(normal)
  const { supportNormal, supportNormalNorm } = measured
  const normalDot = dot(normal, supportNormal), regular = normalNorm[0] > 0 && supportNormalNorm[0] > 0
  let normalChord: I | null = null
  if (regular) {
    const a = normal.map(x => divide(x, normalNorm)) as V, b = supportNormal.map(x => divide(x, supportNormalNorm)) as V
    const enclosed = normExperimentalCandidatePointVector(subtractExperimentalCandidatePointVectors(a, b))
    normalChord = [Math.max(0, Math.min(2, enclosed[0])), Math.min(2, enclosed[1])]
  }
  return { ...measured, normal, normalNorm, normalDot,
    normalChord, maximumNormalChord,
    normalChordClassification: normalChord && normalChord[0] > maximumNormalChord ? 'outside-declared-criterion' as const :
      normalChord && normalDot[0] > 0 && normalChord[1] <= maximumNormalChord ? 'within-declared-criterion' as const : 'inconclusive' as const,
    normalOrientationClassification: regular && normalDot[0] > 0 ? 'positive' as const : regular && normalDot[1] < 0 ? 'negative' as const : 'inconclusive' as const,
    residualReferenceConvention: 'M-dot-unit(T-lateral-cross-R)' as const,
    residualSupportConvention: 'M-dot-unit(T-support-cross-R)' as const,
    residualIsContinuousAcceptanceGate: false as const, nativeCadCertified: false as const, tubeAccepted: false as const }
}

function prepare(boundary: ExperimentalCandidateJointBoundary, targetInward?: readonly Point[]) {
  if (!boundary || (boundary.edge !== 'V0' && boundary.edge !== 'V1')) fail('invalid-natural-edge')
  const { net, edge } = boundary; validateExperimentalPeriodicSurfaceU(net)
  if (net.du !== 3 || (net.dv !== 1 && net.dv !== 5) || net.mu[0] !== 3 || net.rational.some(Boolean) || net.weights.some(w => w !== 1))
    fail('polynomial-cubic-U-linear-or-quintic-V-required')
  if (targetInward !== undefined && !validPoints(targetInward, net.nu)) fail('dense-finite-target-inward-coefficients-required')
  const first = binary64Units(net.ku[0]), knots = net.ku.map(k => binary64Units(k) - first), period = knots.at(-1)!
  const normalized = knots.map(n => fraction(n, period)), periodInterval = ratio(period, binaryScale)
  const flat = knots.slice(0, -1).flatMap((k, i) => Array<bigint>(net.mu[i]).fill(k)), count = flat.length
  const wrap = (i: number) => ((i % count) + count) % count
  const extended = (i: number) => flat[wrap(i)] + BigInt(Math.floor(i / count)) * period
  const row = edge === 'V0' ? 0 : net.nv - 1, adjacent = edge === 'V0' ? 1 : net.nv - 2
  const vSpan = edge === 'V0' ? 0 : net.kv.length - 2
  const width = binary64Units(net.kv[vSpan + 1]) - binary64Units(net.kv[vSpan]), vFactor = ratio(BigInt(net.dv) * binaryScale, width)
  const stored = Array.from({ length: net.nu }, (_, u) => times(net.poles[u * net.nv + adjacent].map((x, k) => delta(x, net.poles[u * net.nv + row][k])) as V, vFactor))
  const target = targetInward?.map(p => p.map(scalar) as V)
  const targetDifference = target?.map((p, i) => subtractExperimentalCandidatePointVectors(p, stored[i]))
  const spanAt = (s: Fraction, side: 'left' | 'right') => {
    for (let span = 0; span < normalized.length - 1; span++) {
      const lo = compare(s, normalized[span]), hi = compare(s, normalized[span + 1])
      if (side === 'left' ? lo > 0 && hi <= 0 : lo >= 0 && hi < 0) return span
    }
    return fail('native-parameter-or-requested-side-outside-domain')
  }
  const axis = (span: number, s: Fraction) => {
    if (span < 0 || span >= knots.length - 1 || compare(s, normalized[span]) < 0 || compare(s, normalized[span + 1]) > 0) fail('point-outside-selected-span')
    const end = net.mu.slice(0, span + 1).reduce((sum, m) => sum + m, 0) - 1
    const indices = Array.from({ length: 4 }, (_, i) => wrap(end - net.du + 1 + i)), steps: Blend[][] = []
    for (let order = 1; order <= net.du; order++) {
      const stage: Blend[] = []
      for (let j = net.du; j >= order; j--) {
        const lo = extended(end - net.du + j), hi = extended(end - net.du + j + net.du - order + 1)
        const n = s.numerator * period - lo * s.denominator, d = (hi - lo) * s.denominator
        budget(n, d)
        if (d <= 0n || n < 0n || n > d) fail('point-blend-outside-unit-interval')
        stage.push({ j, alpha: ratio(n, d), beta: ratio(d - n, d), inverseNativeWidth: ratio(binaryScale, hi - lo) })
      }
      steps.push(stage)
    }
    return { indices, steps }
  }
  return { net, edge, normalized, periodInterval, spanAt,
    nativeParameter(u: number, side?: 'left' | 'right') {
      if (!Number.isFinite(u) || (side !== undefined && side !== 'left' && side !== 'right')) fail('invalid-native-parameter')
      const s = fraction(binary64Units(u) - first, period), resolvedSide = side ?? (compare(s, normalized.at(-1)!) === 0 ? 'left' : 'right')
      return { s, span: spanAt(s, resolvedSide), side: resolvedSide, nativeU: u }
    },
    at(span: number, s: Fraction) {
      const a = axis(span, s), origin = net.poles[a.indices[0] * net.nv + row]
      const value = a.indices.map(i => net.poles[i * net.nv + row].map((x, k) => delta(x, origin[k])) as V)
      const derivative = a.indices.map(vzero)
      for (const stage of a.steps) for (const r of stage) {
        const change = times(subtractExperimentalCandidatePointVectors(value[r.j], value[r.j - 1]), r.inverseNativeWidth)
        derivative[r.j] = vadd(blend(derivative[r.j - 1], derivative[r.j], r), change)
        value[r.j] = blend(value[r.j - 1], value[r.j], r)
      }
      const field = (coefficients: readonly V[]) => {
        const work = a.indices.map(i => coefficients[i])
        for (const stage of a.steps) for (const r of stage) work[r.j] = blend(work[r.j - 1], work[r.j], r)
        return work.at(-1)!
      }
      return { nativeSu: derivative.at(-1)!, T: times(derivative.at(-1)!, periodInterval), M: field(stored),
        targetInward: target ? field(target) : null, targetMinusStoredInward: targetDifference ? field(targetDifference) : null,
        normalizedParameter: encode(s), nativeParameter: ratio(first * s.denominator + s.numerator * period, s.denominator * binaryScale),
        uSpan: span, uDomain: [net.ku[0], net.ku.at(-1)!] as const, edge,
        inwardSign: edge === 'V0' ? 1 : -1,
        seamSide: compare(s, normalized[0]) === 0 ? '0-plus' as const : compare(s, normalized.at(-1)!) === 0 ? '1-minus' as const : 'interior' as const }
    } }
}

/**
 * New point-only contract. It never calls the saved continuous qualifier,
 * chooses samples, fits targets, or constructs a candidate. Native input
 * parameters are their supplied binary64 values; no rounded mapping is
 * substituted. Saved witnesses instead retain the original exact affine
 * normalized partition and the polynomial side belonging to their cell.
 */
export function createExperimentalCandidateJointPointEvaluator(lateral: ExperimentalCandidateJointBoundary,
  support: ExperimentalCandidateJointBoundary, options: ExperimentalCandidateJointPointOptions = {}) {
  const { maxCells = 4096, maxPointEvaluations = 8192, targetInward } = options
  if (!Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > 4096 || !Number.isSafeInteger(maxPointEvaluations) || maxPointEvaluations < 1 || maxPointEvaluations > 16384)
    fail('invalid-point-budget')
  const a = prepare(lateral, targetInward), b = prepare(support)
  const merged = [...a.normalized, ...b.normalized].sort(compare), partition = merged.filter((s, i) => i === 0 || compare(s, merged[i - 1]) !== 0)
  if (partition.length - 1 > maxCells) fail('common-partition-budget')
  let pointEvaluations = 0
  const evaluate = (sa: Fraction, sb: Fraction, ia: number, ib: number) => {
    if (++pointEvaluations > maxPointEvaluations) fail('point-evaluation-budget')
    const left = a.at(ia, sa), right = b.at(ib, sb), frame = { T: left.T, supportT: right.T, M: left.M, R: times(right.M, scalar(-1)) }
    const measuredResiduals = residuals(frame)
    return { lateral: left, support: right, ...frame,
      lateralTangent: frame.T, supportTangent: frame.supportT, lateralInward: frame.M, supportReference: frame.R,
      projectedNormalResidualAbs: measuredResiduals.referenceAbsoluteNormalResidualMmPerV,
      supportNormalResidualAbs: measuredResiduals.supportAbsoluteNormalResidualMmPerV,
      projectedNormalResidualSigned: measuredResiduals.referenceSignedNormalResidualMmPerV,
      supportNormalResidualSigned: measuredResiduals.supportSignedNormalResidualMmPerV,
      maximumNormalResidualAbs: measuredResiduals.historicalMaximumAbsoluteNormalResidualMmPerV,
      tangentConvention: 'T-equals-positive-native-period-times-Su' as const,
      referenceConvention: 'R-equals-minus-support-inward-in-native-V-units' as const,
      evidenceScope: 'supplied-point-coefficient-model-only' as const, nativeCadCertified: false as const, tubeAccepted: false as const }
  }
  const resolveWitness = (w: ExperimentalCandidateSavedWitness) => {
    if (!w || !Number.isSafeInteger(w.cell) || w.cell < 0 || w.cell >= partition.length - 1 ||
        (w.endpoint !== 0 && w.endpoint !== 1) || !Array.isArray(w.localDomain) || w.localDomain.length !== 2 ||
        !w.localDomain.every(Number.isFinite) || !(0 <= w.localDomain[0] && w.localDomain[0] < w.localDomain[1] && w.localDomain[1] <= 1)) fail('invalid-saved-witness-address')
    const width = w.localDomain[1] - w.localDomain[0]
    if (!Array.from({ length: 13 }, (_, depth) => 2 ** depth).some(scale => width * scale === 1 && Number.isInteger(w.localDomain[0] * scale)))
      fail('saved-witness-not-in-depth-12-dyadic-tree')
    const lo = partition[w.cell], hi = partition[w.cell + 1], t = fraction(binary64Units(w.localDomain[w.endpoint]), binaryScale)
    const numerator = lo.numerator * hi.denominator * (t.denominator - t.numerator) + hi.numerator * lo.denominator * t.numerator
    const s = fraction(numerator, lo.denominator * hi.denominator * t.denominator)
    const ia = a.spanAt(lo, 'right'), ib = b.spanAt(lo, 'right')
    return { s, ia, ib, normalizedParameter: encode(s), commonCell: w.cell,
      key: `${s.numerator}/${s.denominator}:${ia}:${ib}` }
  }
  return { budgets: { maxCells, maxPointEvaluations, maxExactBits, maxSqrtBracketSteps, maxWitnessDepth: 12, subdivisions: 0 },
    normalizedPartition: partition.map(encode),
    resolveWitness(w: ExperimentalCandidateSavedWitness) { const r = resolveWitness(w); return { key: r.key, normalizedParameter: r.normalizedParameter, commonCell: r.commonCell, lateralUSpan: r.ia, supportUSpan: r.ib } },
    evaluateWitness(w: ExperimentalCandidateSavedWitness) {
      const r = resolveWitness(w)
      return { ...evaluate(r.s, r.s, r.ia, r.ib), key: r.key, commonCell: r.commonCell,
        correspondence: 'exact-positive-affine-original-U-to-common-normalized-s' as const }
    },
    evaluateNative(p: ExperimentalCandidateNativeJointParameter) {
      const sa = a.nativeParameter(p.lateralU, p.lateralSide), sb = b.nativeParameter(p.supportU, p.supportSide)
      return { ...evaluate(sa.s, sb.s, sa.span, sb.span), nativeInput: { lateralU: p.lateralU, supportU: p.supportU,
        lateralSide: sa.side, supportSide: sb.side }, correspondence: 'explicit-supplied-binary64-native-parameters' as const }
    },
    getPointEvaluationCount: () => pointEvaluations }
}

export function evaluateExperimentalCandidateNativeJointPoint(lateral: ExperimentalCandidateJointBoundary,
  support: ExperimentalCandidateJointBoundary, point: ExperimentalCandidateNativeJointParameter) {
  return createExperimentalCandidateJointPointEvaluator(lateral, support, { maxPointEvaluations: 1 }).evaluateNative(point)
}

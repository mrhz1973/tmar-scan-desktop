// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'

export interface ExperimentalExactTangentBoundary { net: Net; edge: 'V0' | 'V1' }
export interface ExperimentalExactTangentCriteria {
  maximumTangentChord: number
  /** Report this guard in original/native U units, independently of the chord. */
  minimumNativeTangentNorm: number
  /** Omit to cover the complete exact union of normalized U knot partitions. */
  selectedCells?: readonly number[]
  maxCells?: number
  maxDepth?: number
  maxLeaves?: number
  maxExactBits?: number
  maxOperations?: number
}
type Q = { n: bigint; d: bigint }
type V = [Q, Q, Q]
type QRecord = { numerator: string; denominator: string }
type Enclosure = { lower: number; upper: number | null }
const zero: Q = { n: 0n, d: 1n }, one: Q = { n: 1n, d: 1n }
const quantum = 1n << 1074n, quantumSquared = 1n << 2148n
const maximumFiniteWord = 0x7fefffffffffffffn
const absolute = (n: bigint) => n < 0n ? -n : n
const record = (q: Q): QRecord => ({ numerator: String(q.n), denominator: String(q.d) })
function fail(reason: string): never { throw Error(`exact-joint-tangent: ${reason}`) }
function gcd(a: bigint, b: bigint): bigint {
  a = absolute(a); b = absolute(b)
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}
function arithmetic(maxExactBits: number, maxOperations: number) {
  let operations = 0, maximumObservedBits = 0
  function budget(...values: bigint[]) {
    for (const value of values) {
      const bits = absolute(value).toString(2).length
      maximumObservedBits = Math.max(maximumObservedBits, bits)
      if (bits > maxExactBits) fail('exact-bit-budget')
    }
  }
  function tick() { if (++operations > maxOperations) fail('exact-operation-budget') }
  function q(n: bigint, d = 1n): Q {
    tick(); budget(n, d)
    if (d === 0n) fail('zero-exact-denominator')
    if (d < 0n) { n = -n; d = -d }
    if (n === 0n) return zero
    const common = gcd(n, d)
    return { n: n / common, d: d / common }
  }
  function add(a: Q, b: Q): Q {
    const common = gcd(a.d, b.d), ad = a.d / common, bd = b.d / common
    return q(a.n * bd + b.n * ad, ad * b.d)
  }
  const negate = (a: Q): Q => ({ n: -a.n, d: a.d })
  const sub = (a: Q, b: Q) => add(a, negate(b))
  function mul(a: Q, b: Q): Q {
    const g = gcd(a.n, b.d), h = gcd(b.n, a.d)
    return q((a.n / g) * (b.n / h), (a.d / h) * (b.d / g))
  }
  function divide(a: Q, b: Q): Q {
    if (b.n === 0n) fail('zero-exact-divisor')
    return mul(a, { n: b.d, d: b.n })
  }
  function compare(a: Q, b: Q): number {
    tick()
    const left = a.n * b.d, right = b.n * a.d
    budget(left, right)
    return left < right ? -1 : left > right ? 1 : 0
  }
  const minimum = (values: Q[]) => values.reduce((a, b) => compare(a, b) <= 0 ? a : b)
  const maximum = (values: Q[]) => values.reduce((a, b) => compare(a, b) >= 0 ? a : b)
  const fromNumber = (value: number) => {
    if (!Number.isFinite(value)) fail('nonfinite-binary64-input')
    return q(binary64Units(value), quantum)
  }
  /** Outward rounding by exact comparison with adjacent binary64 values. */
  function enclosePositive(value: Q, squareRoot = false): Enclosure {
    if (value.n < 0n) fail('negative-positive-enclosure-input')
    if (value.n === 0n) return { lower: 0, upper: 0 }
    const bits = new DataView(new ArrayBuffer(8))
    const floatAt = (word: bigint) => { bits.setBigUint64(0, word); return bits.getFloat64(0) }
    const right = value.n * (squareRoot ? quantumSquared : quantum)
    budget(right)
    const compareWord = (word: bigint) => {
      tick()
      const units = binary64Units(floatAt(word)), left = (squareRoot ? units * units : units) * value.d
      budget(left)
      return left < right ? -1 : left > right ? 1 : 0
    }
    const last = compareWord(maximumFiniteWord)
    if (last < 0) return { lower: Number.MAX_VALUE, upper: null }
    if (last === 0) return { lower: Number.MAX_VALUE, upper: Number.MAX_VALUE }
    let lower = 0n, upper = maximumFiniteWord
    while (upper - lower > 1n) {
      const middle = (upper + lower) >> 1n, sign = compareWord(middle)
      if (sign === 0) return { lower: floatAt(middle), upper: floatAt(middle) }
      if (sign < 0) lower = middle
      else upper = middle
    }
    return { lower: floatAt(lower), upper: floatAt(upper) }
  }
  return { q, add, sub, mul, divide, compare, minimum, maximum, fromNumber, enclosePositive,
    stats: () => ({ operations, maximumObservedBits }) }
}
type Arithmetic = ReturnType<typeof arithmetic>
function vectors(a: Arithmetic) {
  const add = (left: V, right: V): V => left.map((x, i) => a.add(x, right[i])) as V
  const sub = (left: V, right: V): V => left.map((x, i) => a.sub(x, right[i])) as V
  const scale = (v: V, q: Q): V => v.map(x => a.mul(x, q)) as V
  const dot = (left: V, right: V) => left.reduce((sum, x, i) => a.add(sum, a.mul(x, right[i])), zero)
  const cross = (left: V, right: V): V => [
    a.sub(a.mul(left[1], right[2]), a.mul(left[2], right[1])),
    a.sub(a.mul(left[2], right[0]), a.mul(left[0], right[2])),
    a.sub(a.mul(left[0], right[1]), a.mul(left[1], right[0])),
  ]
  const blend = (left: V, right: V, ratio: Q): V => {
    if (ratio.n === 0n) return left
    if (ratio.n === ratio.d) return right
    return add(scale(left, a.sub(one, ratio)), scale(right, ratio))
  }
  function restrict(controls: V[], left: Q, right: Q): V[] {
    const degree = controls.length - 1
    return Array.from({ length: degree + 1 }, (_, i) => {
      let work = controls
      for (let j = 0; j < degree; j++) {
        const ratio = j < degree - i ? left : right
        work = work.slice(0, -1).map((p, k) => blend(p, work[k + 1], ratio))
      }
      return work[0]
    })
  }
  return { add, sub, scale, dot, cross, blend, restrict }
}
function binomial(n: number, k: number): bigint {
  let out = 1n
  for (let i = 1; i <= k; i++) out = out * BigInt(n - i + 1) / BigInt(i)
  return out
}
function fields(a: Arithmetic, v: ReturnType<typeof vectors>) {
  function product<A, B, C>(left: A[], right: B[], empty: () => C,
    term: (x: A, y: B, weight: Q) => C, sum: (x: C, y: C) => C): C[] {
    const p = left.length - 1, q = right.length - 1, out = Array.from({ length: p + q + 1 }, empty)
    for (let i = 0; i <= p; i++) for (let j = 0; j <= q; j++) {
      const weight = a.q(binomial(p, i) * binomial(q, j), binomial(p + q, i + j))
      out[i + j] = sum(out[i + j], term(left[i], right[j], weight))
    }
    return out
  }
  const dot = (left: V[], right: V[]) => product(left, right, () => zero, (x, y, w) => a.mul(v.dot(x, y), w), a.add)
  const cross = (left: V[], right: V[]) => product(left, right, (): V => [zero, zero, zero], (x, y, w) => v.scale(v.cross(x, y), w), v.add)
  const mul = (left: Q[], right: Q[]) => product(left, right, () => zero, (x, y, w) => a.mul(a.mul(x, y), w), a.add)
  const half = a.q(1n, 2n)
  const split = (controls: Q[]) => [v.restrict(controls.map(x => [x, zero, zero] as V), zero, half).map(p => p[0]),
    v.restrict(controls.map(x => [x, zero, zero] as V), half, one).map(p => p[0])]
  return { dot, cross, mul, split }
}

/** Exact native cubic boundary extraction; the clamped V endpoint is one stored pole row. */
function prepare(boundary: ExperimentalExactTangentBoundary, a: Arithmetic, v: ReturnType<typeof vectors>) {
  if (!boundary || (boundary.edge !== 'V0' && boundary.edge !== 'V1')) fail('natural-v-edge-required')
  const { net, edge } = boundary
  validateExperimentalPeriodicSurfaceU(net)
  if (net.du !== 3 || (net.dv !== 1 && net.dv !== 5) || net.mu[0] !== 3 ||
      net.rational.some(Boolean) || net.weights.some(w => w !== 1)) fail('polynomial-cubic-u-linear-or-quintic-v-required')
  const knotUnits = net.ku.map(binary64Units), periodUnits = knotUnits.at(-1)! - knotUnits[0]
  const period = a.q(periodUnits, quantum), normalized = knotUnits.map(k => a.q(k - knotUnits[0], periodUnits))
  const flat = knotUnits.flatMap((k, i) => i === knotUnits.length - 1 ? [] : Array<bigint>(net.mu[i]).fill(k))
  const row = edge === 'V0' ? 0 : net.nv - 1, count = flat.length
  const wrap = (i: number) => ((i % count) + count) % count
  const extendedKnot = (i: number) => flat[wrap(i)] + periodUnits * BigInt(Math.floor(i / count))
  const cached = new Map<number, V[]>()
  function nativeTangents(span: number): V[] {
    const old = cached.get(span)
    if (old) return old
    const end = net.mu.slice(0, span + 1).reduce((sum, m) => sum + m, 0) - 1, start = end - (net.mu[0] - 1)
    const work: V[][] = Array.from({ length: 4 }, (_, i) => [net.poles[wrap(start + i) * net.nv + row].map(a.fromNumber) as V])
    for (let order = 1; order <= 3; order++) for (let j = 3; j >= order; j--) {
      const lo = end - 3 + j, hi = lo + 3 - order + 1
      const width = extendedKnot(hi) - extendedKnot(lo)
      if (width <= 0n) fail('nonpositive-native-deboor-span')
      const left = a.q(knotUnits[span] - extendedKnot(lo), width), right = a.q(knotUnits[span + 1] - extendedKnot(lo), width)
      if (left.n < 0n || left.n > left.d || right.n < 0n || right.n > right.d) fail('native-blend-outside-unit-interval')
      const x = work[j - 1], y = work[j], degree = x.length
      work[j] = Array.from({ length: degree + 1 }, (_, i) => {
        if (i === 0) return v.blend(x[0], y[0], left)
        if (i === degree) return v.blend(x[i - 1], y[i - 1], right)
        return v.add(v.scale(v.blend(x[i], y[i], left), a.q(BigInt(degree - i), BigInt(degree))),
          v.scale(v.blend(x[i - 1], y[i - 1], right), a.q(BigInt(i), BigInt(degree))))
      })
    }
    const factor = a.q(3n * periodUnits, knotUnits[span + 1] - knotUnits[span])
    const tangent = work[3].slice(0, -1).map((p, i) => v.scale(v.sub(work[3][i + 1], p), factor))
    cached.set(span, tangent)
    return tangent
  }
  return { normalized, period, periodSquared: a.mul(period, period),
    fields(span: number, domain: readonly [Q, Q]) {
      if (a.compare(domain[0], normalized[span]) < 0 || a.compare(domain[1], normalized[span + 1]) > 0)
        fail('common-cell-outside-native-span')
      const width = a.sub(normalized[span + 1], normalized[span])
      const at = (s: Q) => a.divide(a.sub(s, normalized[span]), width)
      return v.restrict(nativeTangents(span), at(domain[0]), at(domain[1]))
    } }
}

type Proof = { dot: Q[]; margin: Q[]; squaredA: Q[]; squaredB: Q[]; crossSquared: Q[] }
type Witness = { cell: number; localDomain: readonly [number, number]; endpoint: 0 | 1;
  reason: 'nonpositive-dot-with-nonzero-tangents' | 'negative-exact-chord-margin';
  exactDot: QRecord; exactChordMargin: QRecord; exactSquaredNorms: readonly [QRecord, QRecord] }

/**
 * A NEW targeted certificate for the oriented unit-tangent chord only.
 * No old joint runner, position/normal check, solve or kernel is called.
 * All input binary64 values denote exact rationals. Cubic natural-boundary
 * positions are extracted exactly, differentiated BEFORE restriction, and
 * then restricted to the exact common normalized-s knot partition. Each
 * original U domain maps increasingly to s in [0,1], T=(Umax-Umin)*Su.
 *
 * For c in (0,1) and A.B>0, the desired chord <= c is equivalent to
 * c²(1-c²/4)|A|²|B|² - |A x B|² >= 0. Exact Bernstein coefficients and
 * exact dyadic subdivision establish this inequality continuously. Dot>0
 * is a separate necessary orientation/nonzero prerequisite. Native Su
 * norm floors are reported separately using the ORIGINAL U periods; they
 * are never replaced with normalized tangent norms and are not substituted
 * for the chord inequality. Negative polynomial control coefficients alone
 * are inconclusive; only an exact endpoint violation produces a witness.
 *
 * Default coverage is the entire single tangent criterion because a capped
 * legacy diagnostic cannot identify every previously unresolved leaf.
 * Passing selected cells cannot establish unselected cells or other gates.
 * Each polynomial closure retains its own one-sided endpoint derivative,
 * including s=0+ and s=1-. No seam-derivative equality is inferred.
 */
export function certifyExperimentalJointTangentExact(lateral: ExperimentalExactTangentBoundary,
  support: ExperimentalExactTangentBoundary, criteria: ExperimentalExactTangentCriteria) {
  if (!criteria || !Number.isFinite(criteria.maximumTangentChord) || criteria.maximumTangentChord <= 0 || criteria.maximumTangentChord >= 1 ||
      !Number.isFinite(criteria.minimumNativeTangentNorm) || criteria.minimumNativeTangentNorm <= 0) fail('invalid-criteria')
  const { maxCells = 4096, maxDepth = 8, maxLeaves = 65536, maxExactBits = 16384, maxOperations = 2000000 } = criteria
  if (!Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > 4096 ||
      !Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 12 ||
      !Number.isSafeInteger(maxLeaves) || maxLeaves < 1 || maxLeaves > 131072 ||
      !Number.isSafeInteger(maxExactBits) || maxExactBits < 4096 || maxExactBits > 65536 ||
      !Number.isSafeInteger(maxOperations) || maxOperations < 1 || maxOperations > 10000000) fail('invalid-proof-budget')
  const a = arithmetic(maxExactBits, maxOperations), v = vectors(a), f = fields(a, v)
  const left = prepare(lateral, a, v), right = prepare(support, a, v)
  const merged = [...left.normalized, ...right.normalized].sort(a.compare)
  const partition = merged.filter((value, i) => i === 0 || a.compare(value, merged[i - 1]) !== 0), totalCells = partition.length - 1
  if (totalCells > maxCells) fail('common-partition-budget')
  const selected = criteria.selectedCells === undefined ? Array.from({ length: totalCells }, (_, i) => i) : [...criteria.selectedCells]
  if (!selected.length || selected.some((cell, i) => !Object.hasOwn(selected, i) || !Number.isSafeInteger(cell) || cell < 0 || cell >= totalCells) ||
      new Set(selected).size !== selected.length || selected.length > maxLeaves) fail('invalid-selected-cells-or-leaf-budget')
  selected.sort((x, y) => x - y)
  const chord = a.fromNumber(criteria.maximumTangentChord), c2 = a.mul(chord, chord)
  const sine2 = a.mul(c2, a.sub(one, a.divide(c2, a.q(4n))))
  const floor = a.fromNumber(criteria.minimumNativeTangentNorm), floor2 = a.mul(floor, floor)
  const nativeThresholds = [a.mul(floor2, left.periodSquared), a.mul(floor2, right.periodSquared)] as const
  const periodsSquared = [left.periodSquared, right.periodSquared] as const
  function proof(ta: V[], tb: V[]): Proof {
    const crossed = f.cross(ta, tb), crossSquared = f.dot(crossed, crossed)
    const squaredA = f.dot(ta, ta), squaredB = f.dot(tb, tb), normProduct = f.mul(squaredA, squaredB)
    return { dot: f.dot(ta, tb), margin: normProduct.map((x, i) => a.sub(a.mul(sine2, x), crossSquared[i])), squaredA, squaredB, crossSquared }
  }
  function split(p: Proof): Proof[] {
    const entries = Object.entries(p).map(([key, values]) => [key, f.split(values as Q[])] as const)
    return [0, 1].map(side => Object.fromEntries(entries.map(([key, values]) => [key, values[side]])) as Proof)
  }
  const counts = { certifiedLeaves: 0, unresolvedLeaves: 0, orientationEstablishedLeaves: 0, nativeFloorEstablishedLeaves: [0, 0],
    checkedLeaves: 0, subdivisions: 0, depthLimitedLeaves: 0, leafBudgetLimitedLeaves: 0 }
  let ia = 0, ib = 0, minimumDot: Q | undefined, minimumMargin: Q | undefined
  const minimumNativeSquared: (Q | undefined)[] = [undefined, undefined]
  let maximumSquaredChordUpper: Q | undefined, chordUpperUnavailable = false
  const witnesses: Witness[] = []
  const cells: { cell: number; lateralSpan: number; supportSpan: number; certifiedLeaves: number; unresolvedLeaves: number;
    orientationEstablishedLeaves: number; nativeFloorEstablishedLeaves: number[];
    minimumExactDotCoefficient: QRecord; minimumExactChordMarginCoefficient: QRecord }[] = []
  for (const [selectionIndex, cell] of selected.entries()) {
    const domain = [partition[cell], partition[cell + 1]] as const
    while (ia + 1 < left.normalized.length - 1 && a.compare(left.normalized[ia + 1], domain[0]) <= 0) ia++
    while (ib + 1 < right.normalized.length - 1 && a.compare(right.normalized[ib + 1], domain[0]) <= 0) ib++
    const pending = [{ p: proof(left.fields(ia, domain), right.fields(ib, domain)), depth: 0, local: [0, 1] as readonly [number, number] }]
    const tally = { certifiedLeaves: 0, unresolvedLeaves: 0, orientationEstablishedLeaves: 0, nativeFloorEstablishedLeaves: [0, 0] }
    let cellMinimumDot: Q | undefined, cellMinimumMargin: Q | undefined, cellHasWitness = false
    while (pending.length) {
      const current = pending.pop()!, p = current.p, lowDot = a.minimum(p.dot), lowMargin = a.minimum(p.margin)
      const accepted = lowDot.n > 0n && lowMargin.n >= 0n
      for (const endpoint of [0, 1] as const) {
        const at = (controls: Q[]) => endpoint === 0 ? controls[0] : controls.at(-1)!
        const exactDot = at(p.dot), exactMargin = at(p.margin), norms = [at(p.squaredA), at(p.squaredB)] as const
        const reason = norms.every(q => q.n > 0n) && exactDot.n <= 0n ? 'nonpositive-dot-with-nonzero-tangents' as const :
          exactDot.n > 0n && exactMargin.n < 0n ? 'negative-exact-chord-margin' as const : undefined
        if (reason) {
          cellHasWitness = true
          if (witnesses.length < 8) witnesses.push({ cell, localDomain: current.local, endpoint, reason,
            exactDot: record(exactDot), exactChordMargin: record(exactMargin), exactSquaredNorms: [record(norms[0]), record(norms[1])] })
        }
      }
      const room = counts.checkedLeaves + pending.length + selected.length - selectionIndex + 1 <= maxLeaves
      if (!accepted && !cellHasWitness && current.depth < maxDepth && room) {
        const children = split(p), middle = (current.local[0] + current.local[1]) / 2
        pending.push({ p: children[1], depth: current.depth + 1, local: [middle, current.local[1]] },
          { p: children[0], depth: current.depth + 1, local: [current.local[0], middle] })
        counts.subdivisions++; continue
      }
      counts.checkedLeaves++
      if (accepted) { counts.certifiedLeaves++; tally.certifiedLeaves++ }
      else {
        counts.unresolvedLeaves++; tally.unresolvedLeaves++
        if (!cellHasWitness && current.depth === maxDepth) counts.depthLimitedLeaves++
        else if (!cellHasWitness && !room) counts.leafBudgetLimitedLeaves++
      }
      if (lowDot.n > 0n) {
        counts.orientationEstablishedLeaves++; tally.orientationEstablishedLeaves++
        const crossUpper = a.maximum(p.crossSquared)
        if (crossUpper.n < 0n) fail('negative-squared-cross-upper')
        // For positive dot, chord <= tan(theta) = |A x B|/(A.B).
        const squaredUpper = a.divide(crossUpper, a.mul(lowDot, lowDot))
        maximumSquaredChordUpper = maximumSquaredChordUpper === undefined ? squaredUpper : a.maximum([maximumSquaredChordUpper, squaredUpper])
      } else chordUpperUnavailable = true
      for (const [side, field] of [p.squaredA, p.squaredB].entries()) {
        const low = a.minimum(field)
        if (a.compare(low, nativeThresholds[side]) >= 0) {
          counts.nativeFloorEstablishedLeaves[side]++; tally.nativeFloorEstablishedLeaves[side]++
        }
        const nativeSquared = a.divide(low.n < 0n ? zero : low, periodsSquared[side])
        minimumNativeSquared[side] = minimumNativeSquared[side] === undefined ? nativeSquared : a.minimum([minimumNativeSquared[side]!, nativeSquared])
      }
      cellMinimumDot = cellMinimumDot === undefined ? lowDot : a.minimum([cellMinimumDot, lowDot])
      cellMinimumMargin = cellMinimumMargin === undefined ? lowMargin : a.minimum([cellMinimumMargin, lowMargin])
      minimumDot = minimumDot === undefined ? lowDot : a.minimum([minimumDot, lowDot])
      minimumMargin = minimumMargin === undefined ? lowMargin : a.minimum([minimumMargin, lowMargin])
    }
    if (cellMinimumDot === undefined || cellMinimumMargin === undefined) fail('empty-selected-cell')
    cells.push({ cell, lateralSpan: ia, supportSpan: ib, ...tally,
      minimumExactDotCoefficient: record(cellMinimumDot), minimumExactChordMarginCoefficient: record(cellMinimumMargin) })
  }
  if (minimumDot === undefined || minimumMargin === undefined || minimumNativeSquared.some(x => x === undefined)) fail('empty-target-coverage')
  const classification = witnesses.length ? 'outside-declared-tangent-chord' as const :
    counts.unresolvedLeaves ? 'inconclusive' as const : 'within-declared-tangent-chord' as const
  const tanAngleEnclosure = chordUpperUnavailable || maximumSquaredChordUpper === undefined ? null : a.enclosePositive(maximumSquaredChordUpper, true)
  const nativeNormLower = minimumNativeSquared.map(value => a.enclosePositive(value!, true).lower)
  return { status: 'exact-periodic-boundary-tangent-chord-analysis' as const, classification,
    maximumTangentChord: criteria.maximumTangentChord, minimumNativeTangentNorm: criteria.minimumNativeTangentNorm,
    maximumTangentChordExact: record(chord), minimumNativeTangentNormExact: record(floor), exactSineSquaredThreshold: record(sine2),
    totalCommonCells: totalCells, selectedCells: selected, checkedCells: cells.length, coverageComplete: selected.length === totalCells,
    selectionCoverage: criteria.selectedCells === undefined ? 'entire-targeted-criterion-partition' as const : 'explicit-selected-parent-cells' as const,
    ...counts, cells, witnesses, witnessRecordsAreNotDistinctPointCount: true as const,
    orientationPrerequisiteEstablished: counts.orientationEstablishedLeaves === counts.checkedLeaves,
    nativeFloorPrerequisiteEstablished: counts.nativeFloorEstablishedLeaves.map(count => count === counts.checkedLeaves),
    minimumNativeTangentNormLower: nativeNormLower,
    minimumExactNativeSquaredTangentNormLower: minimumNativeSquared.map(value => record(value!)),
    minimumExactDotCoefficient: record(minimumDot), minimumExactChordMarginCoefficient: record(minimumMargin),
    maximumTanAngleUpper: tanAngleEnclosure?.upper ?? null,
    maximumTangentChordUpper: classification === 'within-declared-tangent-chord'
      ? Math.min(criteria.maximumTangentChord, tanAngleEnclosure?.upper ?? criteria.maximumTangentChord) : tanAngleEnclosure?.upper ?? null,
    normalizedPartition: partition.map(record),
    lateral: { edge: lateral.edge, uDomain: [lateral.net.ku[0], lateral.net.ku.at(-1)!], exactPeriod: record(left.period) },
    support: { edge: support.edge, uDomain: [support.net.ku[0], support.net.ku.at(-1)!], exactPeriod: record(right.period) },
    budgets: { maxCells, maxDepth, maxLeaves, maxExactBits, maxOperations }, exactArithmetic: a.stats(),
    tangentUnits: 'coordinate-units-per-normalized-s' as const, nativeFloorUnits: 'coordinate-units-per-native-U' as const,
    correspondence: 'positive-affine-original-U-to-common-normalized-s' as const,
    seamEndpointContract: 'separate-one-sided-0-plus-and-1-minus' as const,
    boundMethod: 'exact-rational-bernstein-positive-dot-and-squared-cross-chord-margin' as const,
    scope: 'targeted-oriented-unit-tangent-chord-on-natural-boundary-coefficient-model' as const,
    nativeFloorIsChordAcceptanceThreshold: false as const, previousReceiptAmended: false as const,
    otherJointCriteriaRequalified: false as const, nativeCadCertified: false as const, tubeAccepted: false as const }
}

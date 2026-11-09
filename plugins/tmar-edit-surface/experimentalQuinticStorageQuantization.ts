// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import type { ExperimentalDerivativeCoefficientCapRequest } from './experimentalDerivativeCoefficientCap'
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'

export interface ExperimentalQuinticStorageQuantizationRequest extends Pick<ExperimentalDerivativeCoefficientCapRequest,
  'original' | 'edge' | 'baseInward' | 'targetInward' | 'maximumChange'> {
  savedCandidate: Net
  /** Only this zero-based U coefficient is evaluated. */
  uIndex: number
  /** Exact L1 residual limit, in coordinate units per native V unit. */
  derivativeTolerance: number
  /** Exact L1 change limit, in coordinate units per native V unit squared. */
  secondDerivativeTolerance: number
  lockIndices?: readonly number[]
  search: {
    /** 0..4 adjacent binary64 steps per axis, toward the original first pole. */
    maxFirstStepsPerAxis: number
    /** 0..1 adjacent binary64 steps in either direction from the SAVED second pole. */
    maxSecondStepsPerAxis: number
    /** 1..4096 pair evaluations, including the saved B,C pair. */
    maxTrials: number
  }
}

type Fraction = { numerator: bigint; denominator: bigint }
type VectorFraction = { numerators: bigint[]; denominator: bigint }
type SquaredCheck = { within: boolean; limit: number; squared: Fraction; margin: Fraction }
type LinearCheck = { within: boolean; limit: number; value: Fraction; margin: Fraction }
type Checks = { target: SquaredCheck; stored: SquaredCheck; d1: LinearCheck; d2: LinearCheck; within: boolean }
type Outcome = 'local-storage-proposal' | 'stored-local-criteria-already-satisfied' | 'no-local-storage-proposal'
type Reason = 'local-criteria-satisfied' | 'fixed-target-outside-cap' | 'trial-budget-exhausted' | 'finite-neighborhood-exhausted'
const Q = 1n << 1074n, Q2 = Q * Q, maximumFiniteWord = 0x7fefffffffffffffn
const view = new DataView(new ArrayBuffer(8))
const abs = (x: bigint) => x < 0n ? -x : x
const sign = (x: bigint) => x < 0n ? 'negative' as const : x > 0n ? 'positive' as const : 'zero' as const
const copyPoint = (p: Point): Point => [p[0], p[1], p[2]]
const pointEqual = (a: Point, b: Point) => a.every((x, axis) => Object.is(x, b[axis]))
const finitePoint = (p: Point) => Array.isArray(p) && p.length === 3 &&
  [0, 1, 2].every(axis => Object.hasOwn(p, axis) && Number.isFinite(p[axis]))
const units = (p: Point) => p.map(binary64Units)
function fail(reason: string): never { throw Error(`quintic-storage-quantization: ${reason}`) }

function fractionRecord({ numerator, denominator }: Fraction) {
  if (denominator <= 0n) fail('positive-exact-denominator-required')
  if (numerator === 0n) return { numerator: '0', denominator: '1' }
  let a = abs(numerator), b = denominator
  while (b !== 0n) [a, b] = [b, a % b]
  return { numerator: String(numerator / a), denominator: String(denominator / a) }
}

function floatAt(word: bigint) { view.setBigUint64(0, word); return view.getFloat64(0) }
function wordAt(value: number) { view.setFloat64(0, value); return view.getBigUint64(0) }

/** Same exact ordered-binary64 enclosure construction as the acquired cap helper. */
function enclose({ numerator, denominator }: Fraction, root = false): { lower: number; upper: number | null } {
  if (numerator < 0n || denominator <= 0n) fail('invalid-nonnegative-fraction')
  if (numerator === 0n) return { lower: 0, upper: 0 }
  const right = numerator * (root ? Q2 : Q)
  const compare = (word: bigint) => {
    const u = binary64Units(floatAt(word)), left = (root ? u * u : u) * denominator
    return left < right ? -1 : left > right ? 1 : 0
  }
  const atMax = compare(maximumFiniteWord)
  if (atMax < 0) return { lower: Number.MAX_VALUE, upper: null }
  if (atMax === 0) return { lower: Number.MAX_VALUE, upper: Number.MAX_VALUE }
  let lo = 0n, hi = maximumFiniteWord
  while (hi - lo > 1n) {
    const mid = (lo + hi) >> 1n, c = compare(mid)
    if (c === 0) return { lower: floatAt(mid), upper: floatAt(mid) }
    if (c < 0) lo = mid
    else hi = mid
  }
  return { lower: floatAt(lo), upper: floatAt(hi) }
}

function adjacent(value: number, direction: -1 | 1): number | null {
  if (value === 0) return direction * Number.MIN_VALUE
  const word = wordAt(value) + ((value > 0) === (direction > 0) ? 1n : -1n)
  const next = floatAt(word)
  return Number.isFinite(next) ? next : null
}

function squaredCheck(vector: VectorFraction, limit: number): SquaredCheck {
  const squared = { numerator: vector.numerators.reduce((s, x) => s + x * x, 0n),
    denominator: vector.denominator * vector.denominator }
  const cap = binary64Units(limit)
  const margin = { numerator: cap * cap * squared.denominator - squared.numerator * Q2,
    denominator: Q2 * squared.denominator }
  return { within: margin.numerator >= 0n, limit, squared, margin }
}

function linearCheck(vector: VectorFraction, limit: number): LinearCheck {
  const value = { numerator: vector.numerators.reduce((s, x) => s + abs(x), 0n), denominator: vector.denominator }
  const margin = { numerator: binary64Units(limit) * value.denominator - value.numerator * Q,
    denominator: Q * value.denominator }
  return { within: margin.numerator >= 0n, limit, value, margin }
}

function describeSquared(check: SquaredCheck) {
  return { status: check.within ? 'within-coefficient-cap' as const : 'coefficient-cap-exceeded' as const,
    norm: 'Euclidean' as const, limit: check.limit, exactSquaredNorm: fractionRecord(check.squared),
    normInterval: enclose(check.squared, true), exactSquaredMarginToCap: fractionRecord(check.margin),
    squaredMarginSign: sign(check.margin.numerator) }
}

function describeLinear(check: LinearCheck) {
  return { status: check.within ? 'within-residual-bound' as const : 'residual-bound-exceeded' as const,
    norm: 'L1' as const, limit: check.limit, exactL1Norm: fractionRecord(check.value),
    normInterval: enclose(check.value), exactMarginToTolerance: fractionRecord(check.margin),
    marginSign: sign(check.margin.numerator) }
}

function describeChecks(checks: Checks) {
  return { localCriteriaSatisfied: checks.within, targetChange: describeSquared(checks.target),
    storedChange: describeSquared(checks.stored), targetFidelityD1: describeLinear(checks.d1),
    sourceChangeD2: describeLinear(checks.d2) }
}

/**
 * Diagnose one saved quintic endpoint coefficient and propose only an unapplied
 * B,C patch. No input is mutated, no Net or candidate artifact is returned, and
 * neither the acquired full cap nor the old solve/preparation is rerun.
 *
 * The exact cap algebra and binary64Units are shared with the acquired cap
 * contract. Only the selected U index is checked here; the caller must bind its
 * own hashes and prove identity before reusing the other coefficients' evidence.
 *
 * A is fixed. With exact native inward widths h1,h2:
 *   D1 = 5(B-A)/h1
 *   Delta D2 = 20 [h1 Delta C - (h1+h2) Delta B] / (h1^2 h2).
 * D1 fidelity and D2 change use separate exact L1 checks, consistent with the
 * preparation's conservative L1 residual limits. No tolerance is added to cap.
 *
 * B visits finite adjacent floats toward its source; C visits saved +/- adjacent
 * floats, ordered toward C0+(1+h2/h1)Delta B. The exact ideal only orders the
 * search: it never authorizes a long jump. Search exhaustion is not a proof that
 * no solution exists. A found local patch does not repair or certify normalChord
 * at joints74/75, seams, surface displacement, native CAD or the whole Tube.
 */
export function proposeExperimentalQuinticStorageQuantization(request: ExperimentalQuinticStorageQuantizationRequest) {
  const { original, savedCandidate, edge, uIndex, baseInward, targetInward, maximumChange,
    derivativeTolerance, secondDerivativeTolerance, search, lockIndices = [] } = request
  validateExperimentalPeriodicSurfaceU(original)
  validateExperimentalPeriodicSurfaceU(savedCandidate)
  if (edge !== 'V0' && edge !== 'V1') fail('natural-v-edge-required')
  if (original.dv !== 5 || savedCandidate.dv !== 5 || original.rational.some(Boolean) || savedCandidate.rational.some(Boolean) ||
      original.weights.some(w => w !== 1) || savedCandidate.weights.some(w => w !== 1)) fail('unit-polynomial-quintic-required')
  if (original.nu !== savedCandidate.nu || original.nv !== savedCandidate.nv || original.du !== savedCandidate.du ||
      (['ku', 'kv', 'mu', 'mv'] as const).some(key => original[key].length !== savedCandidate[key].length ||
        !original[key].every((x, i) => Object.is(x, savedCandidate[key][i])))) fail('same-basis-required')
  if (!Number.isInteger(uIndex) || uIndex < 0 || uIndex >= original.nu) fail('valid-local-u-index-required')
  for (const values of [baseInward, targetInward]) if (!Array.isArray(values) || values.length !== original.nu ||
      !Object.hasOwn(values, uIndex) || !finitePoint(values[uIndex])) fail('finite-local-bundle-coefficients-required')
  if (![maximumChange, derivativeTolerance, secondDerivativeTolerance].every(x => Number.isFinite(x) && x >= 0))
    fail('finite-nonnegative-limits-required')
  if (!search || !Number.isInteger(search.maxFirstStepsPerAxis) || search.maxFirstStepsPerAxis < 0 || search.maxFirstStepsPerAxis > 4 ||
      !Number.isInteger(search.maxSecondStepsPerAxis) || search.maxSecondStepsPerAxis < 0 || search.maxSecondStepsPerAxis > 1 ||
      !Number.isInteger(search.maxTrials) || search.maxTrials < 1 || search.maxTrials > 4096) fail('bounded-search-budget-required')
  if (!Array.isArray(lockIndices) || Array.from(lockIndices).some(i => !Number.isInteger(i) || i < 0 || i >= original.poles.length))
    fail('valid-lock-indices-required')

  const direction = edge === 'V0' ? 1 : -1, boundaryRow = edge === 'V0' ? 0 : original.nv - 1
  const boundary = uIndex * original.nv + boundaryRow, first = boundary + direction, second = first + direction
  const a = original.poles[boundary], b0 = original.poles[first], c0 = original.poles[second]
  const savedB = savedCandidate.poles[first], savedC = savedCandidate.poles[second]
  if (!pointEqual(a, savedCandidate.poles[boundary])) fail('selected-boundary-must-stay-bitwise-fixed')
  // h2 reaches expanded knot7 from the border; it is not the next distinct span's width.
  const expandedV = original.kv.flatMap((value, i) => Array<number>(original.mv[i]).fill(value))
  const knot = (i: number) => binary64Units(edge === 'V0' ? expandedV[i] : expandedV[expandedV.length - 1 - i])
  const h1 = BigInt(direction) * (knot(6) - knot(0)), h2 = BigInt(direction) * (knot(7) - knot(0))
  if (h1 <= 0n || h2 < h1) fail('positive-native-endpoint-widths-required')
  const au = units(a), b0u = units(b0), c0u = units(c0), target = units(targetInward[uIndex]), base = units(baseInward[uIndex])
  const targetCheck = squaredCheck({ numerators: target.map((x, axis) => x - base[axis]), denominator: Q }, maximumChange)
  const evaluate = (b: Point, c: Point): Checks => {
    const bu = units(b), cu = units(c), db = bu.map((x, axis) => x - b0u[axis]), dc = cu.map((x, axis) => x - c0u[axis])
    const stored = squaredCheck({ numerators: db.map(x => 5n * x), denominator: h1 }, maximumChange)
    const d1 = linearCheck({ numerators: bu.map((x, axis) => 5n * (x - au[axis]) * Q - target[axis] * h1), denominator: h1 * Q },
      derivativeTolerance)
    const d2 = linearCheck({ numerators: dc.map((x, axis) => 20n * Q * (h1 * x - (h1 + h2) * db[axis])), denominator: h1 * h1 * h2 },
      secondDerivativeTolerance)
    return { target: targetCheck, stored, d1, d2, within: targetCheck.within && stored.within && d1.within && d2.within }
  }

  const counts = { evaluatedPairs: 0, firstVectorsVisited: 0, rejectedTargetCap: 0, rejectedStoredCap: 0,
    rejectedD1Fidelity: 0, rejectedD2Change: 0, secondNeighborhoodsPrunedByFirstCriteria: 0 }
  const register = (checks: Checks) => {
    counts.evaluatedPairs++
    if (!checks.target.within) counts.rejectedTargetCap++
    if (!checks.stored.within) counts.rejectedStoredCap++
    if (!checks.d1.within) counts.rejectedD1Fidelity++
    if (!checks.d2.within) counts.rejectedD2Change++
  }
  const before = evaluate(savedB, savedC)
  register(before)
  let last = before
  const finish = (status: Outcome, reason: Reason, found?: { b: Point; c: Point; checks: Checks; firstSteps: number[] }) => {
    const patch: { index: number; row: 'first' | 'second'; before: Point; after: Point }[] = []
    if (found) for (const [index, row, from, to] of [[first, 'first', savedB, found.b], [second, 'second', savedC, found.c]] as const) {
      if (!pointEqual(from, to)) patch.push({ index, row, before: copyPoint(from), after: copyPoint(to) })
    }
    return { status, reason, evidenceScope: 'single-u-quintic-saved-pole-quantization-diagnostic' as const,
      edge, uIndex, indices: { boundary, first, second }, fixedBoundary: copyPoint(a),
      nativeWidthsExact: { h1: fractionRecord({ numerator: h1, denominator: Q }), h2: fractionRecord({ numerator: h2, denominator: Q }) },
      units: { capAndD1: 'coordinate-units-per-native-V', D2: 'coordinate-units-per-native-V-squared' }, capRoundingSlack: 0,
      before: describeChecks(before), lastEvaluated: describeChecks(last),
      proposal: found ? { first: copyPoint(found.b), second: copyPoint(found.c), patch,
        firstUlpStepsTowardSource: [...found.firstSteps], evidence: describeChecks(found.checks) } : null,
      search: { ...search, counts: { ...counts }, order: 'B-total-steps-then-lexicographic;C-saved-then-neighbors-toward-exact-D2-ideal' as const,
        declaredNeighborhoodExhausted: reason === 'finite-neighborhood-exhausted',
        budgetExhausted: reason === 'trial-budget-exhausted', searchExhaustionDoesNotProveImpossibility: true as const },
      candidateMaterialized: false as const, inputsMutated: false as const, globalCoefficientCapCertified: false as const,
      fullRequalificationRequired: true as const, joint74And75NormalChordCertified: false as const,
      nativeGateSatisfied: false as const, nativeCadCertified: false as const, tubeAccepted: false as const }
  }
  if (before.within) return finish('stored-local-criteria-already-satisfied', 'local-criteria-satisfied')
  if (!targetCheck.within) return finish('no-local-storage-proposal', 'fixed-target-outside-cap')

  const locks = new Set(lockIndices)
  const firstAxes = savedB.map((start, axis) => {
    const options = [start]
    if (locks.has(first)) return options
    for (let step = 0; step < search.maxFirstStepsPerAxis; step++) {
      const current = options.at(-1)!
      if (current === b0[axis]) break
      const next = adjacent(current, current < b0[axis] ? 1 : -1)
      if (next === null) break
      options.push(next)
    }
    return options
  })
  const firstChoices: { b: Point; steps: number[]; cost: number }[] = []
  for (let x = 0; x < firstAxes[0].length; x++) for (let y = 0; y < firstAxes[1].length; y++) for (let z = 0; z < firstAxes[2].length; z++)
    firstChoices.push({ b: [firstAxes[0][x], firstAxes[1][y], firstAxes[2][z]], steps: [x, y, z], cost: x + y + z })
  firstChoices.sort((a, b) => a.cost - b.cost || a.steps[0] - b.steps[0] || a.steps[1] - b.steps[1] || a.steps[2] - b.steps[2])
  for (const choice of firstChoices) {
    counts.firstVectorsVisited++
    let checks: Checks
    if (choice.cost === 0) checks = before
    else {
      if (counts.evaluatedPairs >= search.maxTrials) return finish('no-local-storage-proposal', 'trial-budget-exhausted')
      checks = evaluate(choice.b, savedC); register(checks); last = checks
    }
    if (checks.within) return finish('local-storage-proposal', 'local-criteria-satisfied', { ...choice, c: savedC, checks, firstSteps: choice.steps })
    if (!checks.stored.within || !checks.d1.within) {
      // C cannot change D1 or its change cap; skipping its neighborhood is exact.
      counts.secondNeighborhoodsPrunedByFirstCriteria++
      continue
    }
    const bu = units(choice.b)
    const secondAxes = savedC.map((start, axis) => {
      const options = [start]
      if (locks.has(second) || search.maxSecondStepsPerAxis === 0) return options
      // Exact ideal in binary64 units: C0 + (h1+h2)/h1 * (B-B0).
      const offset = c0u[axis] * h1 + (h1 + h2) * (bu[axis] - b0u[axis]) - binary64Units(start) * h1
      const toward: -1 | 1 = offset < 0n ? -1 : 1
      for (const direction of [toward, -toward] as const) {
        const next = adjacent(start, direction as -1 | 1)
        if (next !== null && !options.some(x => x === next)) options.push(next)
      }
      return options
    })
    for (const x of secondAxes[0]) for (const y of secondAxes[1]) for (const z of secondAxes[2]) {
      const c: Point = [x, y, z]
      if (pointEqual(c, savedC)) continue
      if (counts.evaluatedPairs >= search.maxTrials) return finish('no-local-storage-proposal', 'trial-budget-exhausted')
      checks = evaluate(choice.b, c); register(checks); last = checks
      if (checks.within) return finish('local-storage-proposal', 'local-criteria-satisfied', { ...choice, c, checks, firstSteps: choice.steps })
    }
  }
  return finish('no-local-storage-proposal', 'finite-neighborhood-exhausted')
}

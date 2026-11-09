// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { binary64Units } from './experimentalPeriodicSeamDerivativeGap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'

type Edge = 'V0' | 'V1'
type Fraction = { numerator: bigint; denominator: bigint }
type FractionRecord = { numerator: string; denominator: string }
type Enclosure = { lower: number; upper: number | null }

export interface ExperimentalDerivativeCoefficientCapRequest {
  original: Net
  candidate: Net
  edge: Edge
  /** The original bundle's binary64 derivative coefficients, before its target changes. */
  baseInward: readonly Point[]
  /** The supplied binary64 target coefficients; not recomputed from candidate poles. */
  targetInward: readonly Point[]
  /** Euclidean coefficient-change cap in coordinate units per native V unit. */
  maximumChange: number
}

const quantumDenominator = 1n << 1074n
const squaredQuantumDenominator = 1n << 2148n
const maximumFiniteWord = 0x7fefffffffffffffn
const buffer = new DataView(new ArrayBuffer(8))
const abs = (n: bigint) => n < 0n ? -n : n
function fail(reason: string): never { throw Error(`derivative-coefficient-cap: ${reason}`) }

function dense<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): boolean {
  if (!Array.isArray(values)) return false
  for (let i = 0; i < values.length; i++) if (!Object.hasOwn(values, i) || !predicate(values[i], i)) return false
  return true
}

function fractionRecord({ numerator, denominator }: Fraction): FractionRecord {
  if (denominator <= 0n) fail('nonpositive-exact-denominator')
  if (numerator === 0n) return { numerator: '0', denominator: '1' }
  let a = abs(numerator), b = denominator
  while (b !== 0n) [a, b] = [b, a % b]
  return { numerator: String(numerator / a), denominator: String(denominator / a) }
}

function floatAt(word: bigint): number {
  buffer.setBigUint64(0, word)
  return buffer.getFloat64(0)
}

/**
 * Outward enclosure by exact comparisons against ordered positive binary64
 * values. No rounded quotient, square root or epsilon decides the result.
 * `root=true` encloses the square root of a nonnegative exact fraction.
 * An upper null means the exact result exceeds the largest finite binary64.
 */
function enclosePositive({ numerator, denominator }: Fraction, root = false): Enclosure {
  if (numerator < 0n || denominator <= 0n) fail('invalid-positive-exact-fraction')
  if (numerator === 0n) return { lower: 0, upper: 0 }
  const right = numerator * (root ? squaredQuantumDenominator : quantumDenominator)
  const compare = (word: bigint) => {
    const units = binary64Units(floatAt(word))
    const left = (root ? units * units : units) * denominator
    return left < right ? -1 : left > right ? 1 : 0
  }
  const maxComparison = compare(maximumFiniteWord)
  if (maxComparison < 0) return { lower: Number.MAX_VALUE, upper: null }
  if (maxComparison === 0) return { lower: Number.MAX_VALUE, upper: Number.MAX_VALUE }
  let lower = 0n, upper = maximumFiniteWord
  while (upper - lower > 1n) {
    const middle = (lower + upper) >> 1n, comparison = compare(middle)
    if (comparison === 0) return { lower: floatAt(middle), upper: floatAt(middle) }
    if (comparison < 0) lower = middle
    else upper = middle
  }
  return { lower: floatAt(lower), upper: floatAt(upper) }
}

function vectorSquared(vector: readonly bigint[]): bigint {
  return vector.reduce((sum, coordinate) => sum + coordinate * coordinate, 0n)
}

function certifyNumerators(numerators: readonly bigint[], denominator: bigint, capUnits: bigint) {
  const capSquaredNumerator = capUnits * capUnits
  let maximumIndex = 0
  const violatingUIndices: number[] = []
  for (const [u, numerator] of numerators.entries()) {
    if (numerator > numerators[maximumIndex]) maximumIndex = u
    if (numerator * squaredQuantumDenominator > capSquaredNumerator * denominator) violatingUIndices.push(u)
  }
  const maximum = { numerator: numerators[maximumIndex], denominator }
  const margin = { numerator: capSquaredNumerator * denominator - maximum.numerator * squaredQuantumDenominator,
    denominator: squaredQuantumDenominator * denominator }
  const marginSign = margin.numerator < 0n ? 'negative' as const : margin.numerator > 0n ? 'positive' as const : 'zero' as const
  return {
    status: violatingUIndices.length === 0 ? 'within-coefficient-cap' as const : 'coefficient-cap-exceeded' as const,
    checkedUCoefficients: numerators.length,
    withinCapCount: numerators.length - violatingUIndices.length,
    exceedingCapCount: violatingUIndices.length,
    violatingUIndices,
    maximum: {
      uIndex: maximumIndex,
      exactSquaredNorm: fractionRecord(maximum),
      squaredNormInterval: enclosePositive(maximum),
      normInterval: enclosePositive(maximum, true),
      exactSquaredMarginToCap: fractionRecord(margin),
      squaredMarginSign: marginSign,
    },
  }
}

/**
 * Independently certify both the original target-array change and the
 * actual stored inward-derivative coefficient change, in the original V
 * parameter. Same polynomial U/V bases and unit weights are mandatory.
 *
 * Stored D1 is p/h*(P_first-P_boundary). Differences are formed in exact
 * binary64 integer units BEFORE division by the exact knot-span h. This
 * retains subtraction cancellation and storage rounding. The squared norm
 * is compared to cap² exactly; equality passes and any positive excess
 * fails, even if rounded Math.hypot or a small D1 residual hides it.
 *
 * The third certificate distinguishes supplied targets relative to exact
 * source D1 from targets relative to the rounded bundle base. It is an
 * explicitly additional diagnostic, not a hidden change to the two main
 * cap criteria. D1/D2 residuals, pole movement, surface displacement, G1,
 * native reconstruction and whole-Tube acceptance remain separate.
 */
export function certifyExperimentalDerivativeCoefficientCap(request: ExperimentalDerivativeCoefficientCapRequest) {
  const { original, candidate, edge, baseInward, targetInward, maximumChange } = request
  if (edge !== 'V0' && edge !== 'V1') fail('natural-v-edge-required')
  if (!Number.isFinite(maximumChange) || maximumChange < 0) fail('finite-nonnegative-cap-required')
  validateExperimentalPeriodicSurfaceU(original)
  validateExperimentalPeriodicSurfaceU(candidate)
  if (original.rational.some(Boolean) || candidate.rational.some(Boolean) ||
      original.weights.some(w => w !== 1) || candidate.weights.some(w => w !== 1)) fail('unit-polynomial-weights-required')
  if (original.nu !== candidate.nu || original.nv !== candidate.nv || original.du !== candidate.du || original.dv !== candidate.dv ||
      (['ku', 'kv', 'mu', 'mv'] as const).some(key => original[key].length !== candidate[key].length ||
        !original[key].every((x, i) => Object.is(x, candidate[key][i])))) fail('same-basis-required')
  const validVectors = (values: readonly Point[]) => Array.isArray(values) && values.length === original.nu &&
    dense(values, p => Array.isArray(p) && p.length === 3 && dense(p, Number.isFinite))
  if (!validVectors(baseInward) || !validVectors(targetInward)) fail('dense-finite-inward-coefficients-required')

  const direction = edge === 'V0' ? 1 : -1, row = edge === 'V0' ? 0 : original.nv - 1
  const knots = original.kv, degree = BigInt(original.dv)
  const widthUnits = edge === 'V0' ? binary64Units(knots[1]) - binary64Units(knots[0]) :
    binary64Units(knots.at(-1)!) - binary64Units(knots.at(-2)!)
  if (widthUnits <= 0n) fail('positive-native-v-span-required')
  const capUnits = binary64Units(maximumChange)
  const targetNumerators: bigint[] = [], storedNumerators: bigint[] = [], exactSourceTargetNumerators: bigint[] = []
  for (let u = 0; u < original.nu; u++) {
    const boundary = u * original.nv + row, first = boundary + direction
    const sourceDifferences = [0, 1, 2].map(axis => binary64Units(original.poles[first][axis]) - binary64Units(original.poles[boundary][axis]))
    const storedDifferences = [0, 1, 2].map(axis => binary64Units(candidate.poles[first][axis]) - binary64Units(candidate.poles[boundary][axis]))
    targetNumerators.push(vectorSquared([0, 1, 2].map(axis => binary64Units(targetInward[u][axis]) - binary64Units(baseInward[u][axis]))))
    storedNumerators.push(vectorSquared(storedDifferences.map((value, axis) => degree * (value - sourceDifferences[axis]))))
    exactSourceTargetNumerators.push(vectorSquared([0, 1, 2].map(axis => binary64Units(targetInward[u][axis]) * widthUnits -
      degree * sourceDifferences[axis] * quantumDenominator)))
  }
  const targetChange = certifyNumerators(targetNumerators, squaredQuantumDenominator, capUnits)
  const storedChange = certifyNumerators(storedNumerators, widthUnits * widthUnits, capUnits)
  const targetFromExactSourceChange = certifyNumerators(exactSourceTargetNumerators,
    squaredQuantumDenominator * widthUnits * widthUnits, capUnits)
  return {
    status: targetChange.status === 'within-coefficient-cap' && storedChange.status === 'within-coefficient-cap'
      ? 'within-coefficient-cap' as const : 'coefficient-cap-exceeded' as const,
    evidenceScope: 'exact-binary64-input-polynomial-inward-derivative-coefficient-change' as const,
    parameterUnits: 'coordinate-units-per-native-V-unit' as const,
    maximumChange, edge, degreeV: original.dv,
    nativeFirstSpanWidthExact: fractionRecord({ numerator: widthUnits, denominator: quantumDenominator }),
    targetChange, storedChange, targetFromExactSourceChange,
    targetFromExactSourceIsAdditionalDiagnostic: true as const,
    nativeCadCertified: false as const, tubeAccepted: false as const,
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
import { add, cross, divide, l1, mul, scalar, sub, times, vector, type I, type V } from './tangencyCoefficientIntervals'

interface Field<T> {
  degreeU: number
  degreeV: number
  /** U-major order, with V contiguous. */
  controls: readonly T[]
}

export type ExperimentalBernsteinSurfacePatch = Field<V>

const fail = (reason: string): never => { throw new Error(`Prova normale Bernstein rifiutata: ${reason}`) }

function validate(patch: ExperimentalBernsteinSurfacePatch) {
  if (!patch || !Number.isInteger(patch.degreeU) || patch.degreeU < 1 || patch.degreeU > 3 ||
      !Number.isInteger(patch.degreeV) || patch.degreeV < 1 || patch.degreeV > 3 ||
      !Array.isArray(patch.controls) || patch.controls.length !== (patch.degreeU + 1) * (patch.degreeV + 1))
    fail('gradi o dimensioni della patch non validi')
  for (const point of patch.controls) {
    if (!Array.isArray(point) || point.length !== 3) fail('controllo vettoriale non valido')
    for (const interval of point) {
      if (!Array.isArray(interval) || interval.length !== 2 || !Number.isFinite(interval[0]) ||
          !Number.isFinite(interval[1]) || interval[0] > interval[1])
        fail('intervallo di controllo non valido')
    }
  }
}

function derivative(patch: ExperimentalBernsteinSurfacePatch, axis: 'U' | 'V'): Field<V> {
  const degreeU = patch.degreeU - (axis === 'U' ? 1 : 0)
  const degreeV = patch.degreeV - (axis === 'V' ? 1 : 0)
  const factor = scalar(axis === 'U' ? patch.degreeU : patch.degreeV)
  const step = axis === 'U' ? patch.degreeV + 1 : 1
  const controls: V[] = []
  for (let u = 0; u <= degreeU; u++) for (let v = 0; v <= degreeV; v++) {
    const index = u * (patch.degreeV + 1) + v
    const a = patch.controls[index], b = patch.controls[index + step]
    controls.push(a.map((interval, coord) => mul(factor, sub(b[coord], interval))) as V)
  }
  return { degreeU, degreeV, controls }
}

function binomial(n: number, k: number) {
  let value = 1
  for (let i = 1; i <= k; i++) value = value * (n - i + 1) / i
  return value
}

function productWeights(a: number, b: number): I[][] {
  return Array.from({ length: a + 1 }, (_, i) => Array.from({ length: b + 1 }, (_, j) => {
    const numerator = binomial(a, i) * binomial(b, j), denominator = binomial(a + b, i + j)
    return numerator === denominator ? scalar(1) : divide(scalar(numerator), scalar(denominator))
  }))
}

function product<A, B, C>(a: Field<A>, b: Field<B>, zero: C,
  term: (a: A, b: B, weight: I) => C, sum: (a: C, b: C) => C): Field<C> {
  const degreeU = a.degreeU + b.degreeU, degreeV = a.degreeV + b.degreeV
  const uWeights = productWeights(a.degreeU, b.degreeU), vWeights = productWeights(a.degreeV, b.degreeV)
  const controls = Array<C>((degreeU + 1) * (degreeV + 1)).fill(zero)
  for (let u = 0; u <= a.degreeU; u++) for (let v = 0; v <= a.degreeV; v++) {
    const coefficient = a.controls[u * (a.degreeV + 1) + v]
    for (let i = 0; i <= b.degreeU; i++) for (let j = 0; j <= b.degreeV; j++) {
      const index = (u + i) * (degreeV + 1) + v + j
      const weight = mul(uWeights[u][i], vWeights[v][j])
      controls[index] = sum(controls[index], term(coefficient, b.controls[i * (b.degreeV + 1) + j], weight))
    }
  }
  return { degreeU, degreeV, controls }
}

function normal(patch: ExperimentalBernsteinSurfacePatch): Field<V> {
  return product(derivative(patch, 'U'), derivative(patch, 'V'), vector([0, 0, 0]),
    (a, b, weight) => times(cross(a, b), weight),
    (a, b) => a.map((interval, axis) => add(interval, b[axis])) as V)
}

function dotField(a: Field<V>, b: Field<V>): Field<I> {
  return product(a, b, scalar(0), (x, y, weight) => {
    const dot = x.reduce((sum, interval, axis) => add(sum, mul(interval, y[axis])), scalar(0))
    return mul(weight, dot)
  }, add)
}

const average = (a: I, b: I) => add(mul(scalar(0.5), a), mul(scalar(0.5), b))

function split(field: Field<I>, axis: 'U' | 'V') {
  const degree = axis === 'U' ? field.degreeU : field.degreeV
  const lineCount = (axis === 'U' ? field.degreeV : field.degreeU) + 1
  const index = (line: number, step: number) => axis === 'U'
    ? step * (field.degreeV + 1) + line : line * (field.degreeV + 1) + step
  const lower = Array<I>(field.controls.length), upper = Array<I>(field.controls.length)
  for (let line = 0; line < lineCount; line++) {
    const work = Array.from({ length: degree + 1 }, (_, j) => field.controls[index(line, j)])
    lower[index(line, 0)] = work[0]
    upper[index(line, degree)] = work[degree]
    for (let level = 1; level <= degree; level++) {
      for (let j = 0; j <= degree - level; j++) work[j] = average(work[j], work[j + 1])
      lower[index(line, level)] = work[0]
      upper[index(line, degree - level)] = work[degree - level]
    }
  }
  return [{ ...field, controls: lower }, { ...field, controls: upper }] as const
}

function splitAxis(field: Field<I>, depth: number): 'U' | 'V' {
  // A heuristic only. All proof decisions use intervals on the full cells.
  const center = ([lo, hi]: I) => lo / 2 + hi / 2
  const width = field.degreeV + 1
  let alongU = 0, alongV = 0
  for (let u = 0; u <= field.degreeU; u++) for (let v = 0; v <= field.degreeV; v++) {
    const i = u * width + v, value = center(field.controls[i])
    if (u < field.degreeU) alongU = Math.max(alongU, Math.abs(value - center(field.controls[i + width])))
    if (v < field.degreeV) alongV = Math.max(alongV, Math.abs(value - center(field.controls[i + 1])))
  }
  return alongU === alongV ? (depth % 2 === 0 ? 'U' : 'V') : alongU > alongV ? 'U' : 'V'
}

interface Cell {
  field: Field<I>
  u: readonly [number, number]
  v: readonly [number, number]
  depth: number
}

/**
 * Check two Bernstein surface patches on the same normalized parameter
 * square and in the same coordinate frame. Their axes already express the
 * intended correspondence and orientation. Intervals enclose their real
 * coefficients, and degrees may differ up to cubic in each axis.
 *
 * A positive bound on the normal dot product proves relative orientation
 * and excludes degenerate normals everywhere on the square. A nonpositive
 * witness proves only the stated dot inequality at that parameter. Budget
 * exhaustion is inconclusive. The routine does not extract patches from
 * splines or check periodic joins, OCCT evaluation, injectivity or solids.
 */
export function boundExperimentalBernsteinPatchNormals(candidate: ExperimentalBernsteinSurfacePatch,
  reference: ExperimentalBernsteinSurfacePatch, maxDepth = 12) {
  validate(candidate)
  validate(reference)
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 16) fail('profondità di suddivisione non valida')
  const a = normal(candidate), b = normal(reference)
  const pending: Cell[] = [{ field: dotField(a, b), u: [0, 1], v: [0, 1], depth: 0 }]
  const evidenceScope = 'bernstein-patch-coefficient-model' as const
  const maxCells = 4096
  let checkedCells = 0, unresolved = false, minNormalDot = Infinity
  while (checkedCells < pending.length) {
    const { field, u, v, depth } = pending[checkedCells++]
    const lower = Math.min(...field.controls.map(interval => interval[0]))
    if (lower > 0) {
      minNormalDot = Math.min(minNormalDot, lower)
      continue
    }
    for (const i of [0, 1] as const) for (const j of [0, 1] as const) {
      const index = i * field.degreeU * (field.degreeV + 1) + j * field.degreeV
      const upper = field.controls[index][1]
      if (upper <= 0) return { status: 'nonpositive-witness' as const, parameter: [u[i], v[j]] as const,
        normalDotUpperBound: upper, checkedCells, evidenceScope }
    }
    if (depth === maxDepth || pending.length + 2 > maxCells) {
      unresolved = true
      continue
    }
    const axis = splitAxis(field, depth)
    const [first, last] = axis === 'U' ? u : v
    const middle = (first + last) / 2
    const [left, right] = split(field, axis)
    const next = depth + 1
    if (axis === 'U') pending.push({ field: left, u: [first, middle], v, depth: next },
      { field: right, u: [middle, last], v, depth: next })
    else pending.push({ field: left, u, v: [first, middle], depth: next },
      { field: right, u, v: [middle, last], depth: next })
  }
  if (unresolved) return { status: 'inconclusive' as const, checkedCells, evidenceScope }
  const maxCandidateNormal = Math.max(...a.controls.map(l1)), maxReferenceNormal = Math.max(...b.controls.map(l1))
  const minCandidateNormalNorm = divide(scalar(minNormalDot), scalar(maxReferenceNormal))[0]
  const minReferenceNormalNorm = divide(scalar(minNormalDot), scalar(maxCandidateNormal))[0]
  if (!(minCandidateNormalNorm > 0 && minReferenceNormalNorm > 0))
    return { status: 'inconclusive' as const, checkedCells, evidenceScope }
  return { status: 'certified-positive' as const, minNormalDot, checkedCells, evidenceScope,
    minCandidateNormalNorm, minReferenceNormalNorm }
}

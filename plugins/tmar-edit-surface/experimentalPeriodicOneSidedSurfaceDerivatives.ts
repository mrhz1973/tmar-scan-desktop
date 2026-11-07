// SPDX-License-Identifier: AGPL-3.0-only
import { calcBasisFunctions, findSpan } from 'three/examples/jsm/curves/NURBSUtils.js'
import type { Net, Point } from './brep'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'

type Side = 'left' | 'right'
type Sides = { u?: Side; v?: Side }
type Basis = { indices: readonly number[]; values: number[] }
const fail = (reason: string): never => { throw new Error(`Derivate unilaterali rifiutate: ${reason}`) }

function prepareAxis(degree: number, knots: readonly number[], multiplicities: readonly number[], periodic: boolean) {
  const distinct = [...knots]
  const first = distinct[0], last = distinct.at(-1)!, period = last - first
  const expanded: number[] = [], ends: number[] = []
  for (const [i, knot] of distinct.entries()) {
    if (periodic && i === distinct.length - 1) break
    expanded.push(...Array<number>(multiplicities[i]).fill(knot))
    if (i < distinct.length - 1) ends.push(expanded.length - 1)
  }
  const count = periodic ? expanded.length : expanded.length - degree - 1
  const index = (i: number) => periodic ? ((i % count) + count) % count : i
  const width = (lo: number, hi: number) => {
    const a = expanded[index(lo)], b = expanded[index(hi)]
    return !periodic || Math.floor(lo / count) === Math.floor(hi / count) ? b - a : (last - a) + (b - first)
  }
  const spans = ends.map((end, span) => {
    const local = Array.from({ length: 2 * degree + 1 }, (_, j) => {
      const i = end + j - degree
      return (i < end ? -width(i, end) : width(end, i)) / period
    })
    for (let j = 1; j < local.length; j++) {
      const i = end + j - degree
      if (!Number.isFinite(local[j - 1]) || !Number.isFinite(local[j]) ||
          (width(i - 1, i) > 0 && !(local[j - 1] < local[j]))) fail('intervallo locale non rappresentabile')
    }
    if (!Number.isFinite(1 / local[degree + 1])) fail('reciproco della campata non rappresentabile')
    const indices = Array.from({ length: degree + 1 }, (_, j) => index(end - ends[0] + j))
    return { local, indices, derivativeIndices: indices.slice(0, -1), left: distinct[span], right: distinct[span + 1] }
  })

  const factors = Array.from({ length: periodic ? count : count - 1 }, (_, i) => {
    const hi = i + (periodic ? multiplicities[0] : degree + 1)
    const gap = width(hi - degree, hi)
    const factor = degree / gap
    if (!(gap > 0) || !Number.isFinite(gap) || !Number.isFinite(factor)) fail('scala della derivata non rappresentabile')
    return factor
  })
  const creases = Array.from(multiplicities, m => m === degree)

  return { factors, evaluate(parameter: number, side: Side | undefined) {
    const axis = periodic ? 'U' : 'V'
    if (!Number.isFinite(parameter) || parameter < first || parameter > last) fail(`parametro fuori intervallo ${axis}`)
    if (side !== undefined && side !== 'left' && side !== 'right') fail(`lato ${axis} non valido`)
    let span = findSpan(0, parameter, distinct)
    const atFirst = parameter === first, atLast = parameter === last
    const knot = atLast ? distinct.length - 1 : parameter === distinct[span] ? span : -1
    if (knot < 0 && side !== undefined) fail(`lato ${axis} specificato fuori da un nodo`)
    if (knot >= 0 && creases[knot] && side === undefined) fail(`lato ${axis} richiesto al nodo C0`)
    if (atFirst || atLast) {
      if (periodic) {
        span = side === 'left' ? spans.length - 1 : 0
        parameter = side === 'left' ? last : first
      } else if ((atFirst && side === 'left') || (atLast && side === 'right')) {
        fail('lato V esterno al dominio')
      }
    } else if (knot >= 0 && side === 'left') {
      span--
    }

    const { local, indices, derivativeIndices, left, right } = spans[span]
    const t = parameter === left ? 0 : parameter === right ? local[degree + 1] : (parameter - left) / period
    if (parameter > left && parameter < right && !(t > 0 && t < local[degree + 1]))
      fail(`parametro locale ${axis} non rappresentabile`)
    // Lowering the degree drops the first and last expanded knots. The
    // recurrence around this explicitly selected span still reads the same
    // interior knot offsets, so both basis evaluations can use this window.
    const values = calcBasisFunctions(degree, t, degree, local)
    const derivativeValues = calcBasisFunctions(degree, t, degree - 1, local)
    if ([...values, ...derivativeValues].some(value => !Number.isFinite(value) || value < 0))
      fail(`base ${axis} non rappresentabile`)
    return { basis: { indices, values }, derivative: { indices: derivativeIndices, values: derivativeValues } }
  } }
}

function difference(a: Point, b: Point, factor: number): Point {
  const result = a.map((x, axis) => factor * (x - b[axis])) as Point
  if (!result.every(Number.isFinite)) fail('coefficiente della derivata non finito')
  return result
}

function combine(u: Basis, v: Basis, poles: readonly Point[], stride: number): Point {
  const result: Point = [0, 0, 0]
  for (const [i, uIndex] of u.indices.entries()) for (const [j, vIndex] of v.indices.entries()) {
    const weight = u.values[i] * v.values[j], pole = poles[uIndex * stride + vIndex]
    for (let axis = 0; axis < 3; axis++) result[axis] += weight * pole[axis]
  }
  if (!result.every(Number.isFinite)) fail('derivata valutata non finita')
  return result
}

/**
 * Evaluate the derivatives of a unit-weight periodic-U, clamped-V model
 * within an explicitly chosen cell at C0 knots. A side is required for each
 * C0 axis at the queried point, including both names of the U seam. At C1
 * knots the default is the right span, except for the final V endpoint.
 * A supplied side is valid only at a knot and inside the natural V domain.
 * Derivatives always use increasing parameters. The unnormalized normal
 * is parametric and may be zero. Evaluation is floating-point and local.
 */
export function prepareExperimentalPeriodicOneSidedSurfaceDerivatives(net: Net) {
  validateExperimentalPeriodicSurfaceU(net)
  const { du, dv, nu, nv, ku, mu, kv, mv, poles, weights } = net
  if (weights.some(weight => weight !== 1)) fail('richiesti pesi unitari')
  const axisU = prepareAxis(du, ku, mu, true), axisV = prepareAxis(dv, kv, mv, false)
  const dU = poles.map((pole, i) => {
    const u = Math.floor(i / nv), v = i % nv
    return difference(poles[((u + 1) % nu) * nv + v], pole, axisU.factors[u])
  })
  const dV = Array.from({ length: nu * (nv - 1) }, (_, i) => {
    const u = Math.floor(i / (nv - 1)), v = i % (nv - 1), index = u * nv + v
    return difference(poles[index + 1], poles[index], axisV.factors[v])
  })
  return { evaluate(u: number, v: number, sides: Sides = {}) {
    if (!sides || typeof sides !== 'object') fail('lati non validi')
    const a = axisU.evaluate(u, sides.u), b = axisV.evaluate(v, sides.v)
    const duValue = combine(a.derivative, b.basis, dU, nv), dvValue = combine(a.basis, b.derivative, dV, nv - 1)
    const normal: Point = [
      duValue[1] * dvValue[2] - duValue[2] * dvValue[1],
      duValue[2] * dvValue[0] - duValue[0] * dvValue[2],
      duValue[0] * dvValue[1] - duValue[1] * dvValue[0],
    ]
    if (!normal.every(Number.isFinite)) fail('normale valutata non finita')
    return { du: duValue, dv: dvValue, normal }
  } }
}

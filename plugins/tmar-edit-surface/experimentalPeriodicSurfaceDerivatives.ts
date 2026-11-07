// SPDX-License-Identifier: AGPL-3.0-only
import { calcBasisFunctions, findSpan } from 'three/examples/jsm/curves/NURBSUtils.js'
import type { Net, Point } from './brep'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'

type ActiveBasis = { indices: number[]; values: number[] }
const fail = (reason: string): never => { throw new Error(`Derivate periodiche rifiutate: ${reason}`) }
const expand = (knots: readonly number[], multiplicities: readonly number[]) =>
  knots.flatMap((knot, i) => Array<number>(multiplicities[i]).fill(knot))

function combine(u: ActiveBasis, v: ActiveBasis, poles: readonly Point[], stride: number): Point {
  const result: Point = [0, 0, 0]
  for (const [i, indexU] of u.indices.entries()) for (const [j, indexV] of v.indices.entries()) {
    const weight = u.values[i] * v.values[j], pole = poles[indexU * stride + indexV]
    for (let axis = 0; axis < 3; axis++) result[axis] += weight * pole[axis]
  }
  if (!result.every(Number.isFinite)) fail('derivata valutata non finita')
  return result
}

function difference(a: Point, b: Point, factor: number): Point {
  const result = a.map((x, axis) => factor * (x - b[axis])) as Point
  if (!result.every(Number.isFinite)) fail('coefficiente della derivata non finito')
  return result
}

function derivativeFactor(degree: number, width: number) {
  const factor = degree / width
  if (!(width > 0) || !Number.isFinite(width) || !Number.isFinite(factor)) fail('scala della derivata non rappresentabile')
  return factor
}

function clampedBasis(degree: number, knots: number[], parameter: number): ActiveBasis {
  const span = findSpan(degree, parameter, knots)
  const values = calcBasisFunctions(span, parameter, degree, knots)
  if (values.some(value => !Number.isFinite(value) || value < 0)) fail('base V non rappresentabile')
  return { indices: values.map((_, i) => span - degree + i), values }
}

/**
 * Evaluate ∂U, ∂V and ∂U × ∂V of a unit-weight periodic-U, clamped-V
 * coefficient model. The U endpoints denote the same seam. V endpoints
 * use the derivative from the natural domain, in increasing V direction.
 * The model must be C1 across internal knots and the U seam. One-sided
 * derivatives at creases are outside scope. The normal is parametric,
 * unnormalized and may be zero. No topology orientation or numerical error
 * bound is established by this floating-point evaluation.
 */
export function prepareExperimentalPeriodicSurfaceDerivatives(net: Net) {
  validateExperimentalPeriodicSurfaceU(net)
  const { du, dv, nu, nv, ku, mu, kv, mv, poles, weights } = net
  if (weights.some(weight => weight !== 1)) fail('richiesti pesi unitari')
  if (du < 2 || mu.some(m => m >= du) || mv.slice(1, -1).some(m => m >= dv))
    fail('la base deve essere C1 ai nodi interni e alla cucitura U')

  const uBasis = prepareExperimentalPeriodicUBasis(du, ku, mu)
  const duBasis = prepareExperimentalPeriodicUBasis(du - 1, ku, mu)
  const flatU = expand(ku.slice(0, -1), mu)
  const wrap = (i: number) => ((i % nu) + nu) % nu
  const uFactors = flatU.map((_, i) => {
    // The left end of the first span is flatU[mu[0]-1]. Translate
    // the full derivative denominator T[i+du+1] - T[i+1] to this indexing.
    const hi = i + mu[0], lo = hi - du
    const a = flatU[wrap(lo)], b = flatU[wrap(hi)]
    const width = Math.floor(lo / nu) === Math.floor(hi / nu) ? b - a :
      (ku.at(-1)! - a) + (b - ku[0])
    return derivativeFactor(du, width)
  })
  const dU = poles.map((pole, index) => {
    const u = Math.floor(index / nv), v = index % nv
    return difference(poles[wrap(u + 1) * nv + v], pole, uFactors[u])
  })

  const flatV = expand(kv, mv), vDistinct = [...kv]
  const firstV = kv[0], lastV = kv.at(-1)!, widthV = lastV - firstV
  const normalizedV = kv.map(knot => (knot - firstV) / widthV)
  for (let i = 1; i < normalizedV.length; i++) {
    const width = normalizedV[i] - normalizedV[i - 1]
    if (!(width > 0) || !Number.isFinite(1 / width)) fail('intervallo V non rappresentabile')
  }
  const vKnots = expand(normalizedV, mv), dvKnots = vKnots.slice(1, -1)
  const vFactors = Array.from({ length: nv - 1 }, (_, i) => derivativeFactor(dv, flatV[i + dv + 1] - flatV[i + 1]))
  const dV = Array.from({ length: nu * (nv - 1) }, (_, index) => {
    const u = Math.floor(index / (nv - 1)), v = index % (nv - 1), offset = u * nv + v
    return difference(poles[offset + 1], poles[offset], vFactors[v])
  })

  return { evaluate(u: number, v: number) {
    if (!Number.isFinite(v) || v < firstV || v > lastV) fail('parametro fuori intervallo V')
    const span = findSpan(0, v, vDistinct), parameter = (v - firstV) / widthV
    if (v > vDistinct[span] && v < vDistinct[span + 1] &&
        !(parameter > normalizedV[span] && parameter < normalizedV[span + 1]))
      fail('parametro locale V non rappresentabile')
    const du = combine(duBasis.evaluate(u), clampedBasis(dv, vKnots, parameter), dU, nv)
    const dvValue = combine(uBasis.evaluate(u), clampedBasis(dv - 1, dvKnots, parameter), dV, nv - 1)
    const normal: Point = [
      du[1] * dvValue[2] - du[2] * dvValue[1],
      du[2] * dvValue[0] - du[0] * dvValue[2],
      du[0] * dvValue[1] - du[1] * dvValue[0],
    ]
    if (!normal.every(Number.isFinite)) fail('normale valutata non finita')
    return { du, dv: dvValue, normal }
  } }
}

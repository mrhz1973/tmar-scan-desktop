// SPDX-License-Identifier: AGPL-3.0-only
import type { NurbsCurveData, OcctKernel, ShapeHandle } from 'occt-wasm'

interface PeriodicCurveWitness {
  degree: number
  knots: number[]
  multiplicities: number[]
  sameRefinedCoefficients: boolean
  /** Measured on the refined nets. OCCT's floating-point error is unbounded here. */
  maxRefinedPoleDistance: number
}

const fail = (reason: string): never => { throw new Error(`Curva periodica sperimentale rifiutata: ${reason}`) }

const equal = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

export function readFullPeriod(kernel: OcctKernel, edge: ShapeHandle): NurbsCurveData {
  if (kernel.curveType(edge) !== 'bspline') fail('edge senza curva B-spline')
  const data = kernel.getNurbsCurveData(edge)
  const { degree, knots, multiplicities, poles, weights } = data
  const poleCount = poles.length / 3
  if (!data.periodic || !Number.isInteger(degree) || degree < 1 || degree > 25 ||
      knots.length < 2 || knots.length > 256 || multiplicities.length !== knots.length ||
      knots.some((k, i) => !Number.isFinite(k) || (i > 0 && k <= knots[i - 1])) ||
      multiplicities.some(m => !Number.isInteger(m) || m < 1 || m > degree) ||
      multiplicities[0] !== multiplicities.at(-1) ||
      poleCount < 2 || multiplicities.slice(0, -1).reduce((sum, m) => sum + m, 0) !== poleCount ||
      poles.some(p => !Number.isFinite(p)) ||
      (data.rational ? weights.length !== poleCount : weights.length !== 0) ||
      weights.some(w => !Number.isFinite(w) || w <= 0))
    fail('base periodica o coefficienti non validi')
  const { first, last } = kernel.curveParameters(edge)
  if (first !== knots[0] || last !== knots.at(-1) || !Number.isFinite(last - first))
    fail('il bordo deve coprire un periodo intero con la stessa origine della curva')
  return data
}

/**
 * Refines two full-period curves to the same periodic basis using OCCT's
 * IncreaseDegree and InsertKnot on copies (occt-wasm 5.7.1 facade).
 * The correspondence is t -> t on
 * the original interval. The kernel rebuilds edges from their support, so
 * trimmed edges are rejected before the first transformation.
 *
 * For equal positive weights (or two polynomial curves), the common basis
 * gives a partition of unity. In exact arithmetic, the maximum corresponding
 * pole distance bounds pointwise distance everywhere on the refined curves.
 * Equality of the resulting floating-point coefficients is evidence for the
 * refined nets only. This helper does not certify equality of the inputs or
 * qualify topology, pcurves or trimming.
 */
export function comparePeriodicCurves(
  kernel: OcctKernel, edgeA: ShapeHandle, edgeB: ShapeHandle,
): PeriodicCurveWitness {
  const a = readFullPeriod(kernel, edgeA), b = readFullPeriod(kernel, edgeB)
  if (a.knots[0] !== b.knots[0] || a.knots.at(-1) !== b.knots.at(-1))
    fail('origine o intervallo parametrico diverso')
  if (kernel.shapeOrientation(edgeA) !== kernel.shapeOrientation(edgeB))
    fail('orientamento dei bordi diverso')

  const degree = Math.max(a.degree, b.degree)
  const target = new Map<number, number>()
  for (const data of [a, b]) for (const [i, knot] of data.knots.entries()) {
    const elevated = data.multiplicities[i] + degree - data.degree
    target.set(knot, Math.max(target.get(knot) ?? 0, elevated))
  }
  const knots = [...target.keys()].sort((x, y) => x - y)
  if (knots.length > 256) fail('base comune troppo grande')
  const multiplicities = knots.map(knot => target.get(knot)!)

  function refine(edge: ShapeHandle, data: NurbsCurveData): NurbsCurveData {
    let current = edge
    try {
      if (data.degree < degree) current = kernel.curveDegreeElevate(edge, degree - data.degree)
      const original = new Map(data.knots.map((knot, i) =>
        [knot, data.multiplicities[i] + degree - data.degree]))
      // The last knot is the other endpoint of the periodic seam. Inserting
      // at the first knot changes the multiplicity at both endpoints.
      for (const [i, knot] of knots.slice(0, -1).entries()) {
        const add = multiplicities[i] - (original.get(knot) ?? 0)
        if (add === 0) continue
        const next = kernel.curveKnotInsert(current, knot, add)
        const previous = current
        current = next
        if (previous !== edge) kernel.release(previous)
      }
      const refined = current === edge ? data : readFullPeriod(kernel, current)
      // OCCT uses a knot-coincidence tolerance. Require the actual knots and
      // multiplicities to match the requested basis exactly after refinement.
      if (refined.degree !== degree || !equal(refined.knots, knots) ||
          !equal(refined.multiplicities, multiplicities))
        fail('il kernel non ha prodotto la base comune richiesta')
      return refined
    } finally {
      if (current !== edge) kernel.release(current)
    }
  }

  const left = refine(edgeA, a), right = refine(edgeB, b)
  if (left.rational !== right.rational || !equal(left.weights, right.weights))
    fail('pesi della base comune diversi')

  let maxRefinedPoleDistance = 0
  for (let i = 0; i < left.poles.length; i += 3) {
    maxRefinedPoleDistance = Math.max(maxRefinedPoleDistance, Math.hypot(
      left.poles[i] - right.poles[i],
      left.poles[i + 1] - right.poles[i + 1],
      left.poles[i + 2] - right.poles[i + 2],
    ))
  }
  if (!Number.isFinite(maxRefinedPoleDistance)) fail('distanza tra poli fuori intervallo')
  return {
    degree, knots, multiplicities,
    sameRefinedCoefficients: equal(left.poles, right.poles),
    maxRefinedPoleDistance,
  }
}

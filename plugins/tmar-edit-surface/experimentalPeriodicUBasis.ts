// SPDX-License-Identifier: AGPL-3.0-only
import { calcBasisFunctions, findSpan } from 'three/examples/jsm/curves/NURBSUtils.js'

const fail = (reason: string): never => { throw new Error(`Valutazione periodica U rifiutata: ${reason}`) }

/**
 * Evaluate the active polynomial basis functions in OCCT periodic pole order.
 * The final endpoint denotes the first endpoint. This is a floating-point
 * evaluator for proposals and diagnostics, with no certified error bound.
 */
export function prepareExperimentalPeriodicUBasis(
  degree: number, knots: readonly number[], multiplicities: readonly number[],
) {
  if (!Number.isInteger(degree) || degree < 1 || degree > 25 ||
      knots.length < 2 || knots.length > 256 || knots.length !== multiplicities.length ||
      multiplicities[0] !== multiplicities.at(-1)) fail('grado o base non validi')

  const flat: number[] = []
  const spanEnds: number[] = []
  for (const [i, knot] of knots.entries()) {
    const multiplicity = multiplicities[i]
    if (!Number.isFinite(knot) || (i > 0 && !(knots[i - 1] < knot)) ||
        !Number.isInteger(multiplicity) || multiplicity < 1 || multiplicity > degree)
      fail('nodi o molteplicità non validi')
    if (i === knots.length - 1) break
    flat.push(...Array<number>(multiplicity).fill(knot))
    spanEnds.push(flat.length - 1)
  }

  const first = flat[0], last = knots.at(-1)!, period = last - first
  const poleCount = flat.length
  if (poleCount <= degree || poleCount > 500 || !Number.isFinite(period)) fail('poli o periodo non validi')
  const wrap = (i: number) => ((i % poleCount) + poleCount) % poleCount
  const spans = spanEnds.map((end, span) => {
    const left = flat[end]
    const local = Array.from({ length: 2 * degree + 1 }, (_, j) => {
      const index = end + j - degree
      const knot = flat[wrap(index)]
      // Local differences preserve small spans near large origins. Avoid
      // shifting a knot beyond the representable interval at the seam.
      const offset = index < 0 ? -((last - knot) + (left - first)) :
        index >= poleCount ? (last - left) + (knot - first) : knot - left
      return offset / period
    })
    for (let j = 1; j < local.length; j++) {
      const index = end + j - degree
      const repeated = index % poleCount !== 0 && flat[wrap(index - 1)] === flat[wrap(index)]
      if (!Number.isFinite(local[j - 1]) || !Number.isFinite(local[j]) ||
          (!repeated && !(local[j - 1] < local[j]))) fail('intervallo locale non rappresentabile')
    }
    // Three forms N / denominator before multiplying by the partial span
    // widths. Every denominator contains this span, even at its endpoints.
    if (!Number.isFinite(1 / local[degree + 1])) fail('reciproco dello span non rappresentabile')
    // The first nonempty span starts with pole zero. Each later span starts
    // that many multiplicities further along the cyclic coefficient sequence.
    const start = end - spanEnds[0]
    const indices = Array.from({ length: degree + 1 }, (_, j) => wrap(start + j))
    return { local, indices, left, right: knots[span + 1] }
  })
  const distinct = [...knots]

  return { poleCount, evaluate(parameter: number) {
    if (!Number.isFinite(parameter) || parameter < first || parameter > last) fail('parametro fuori periodo')
    const u = parameter === last ? first : parameter
    const { local, indices, left, right } = spans[findSpan(0, u, distinct)]
    const t = (u - left) / period
    if (u > left && u < right && !(t > 0 && t < local[degree + 1]))
      fail('parametro locale non rappresentabile')
    const values = calcBasisFunctions(degree, t, degree, local)
    if (values.some(value => !Number.isFinite(value) || value < 0)) fail('funzioni di base non finite o negative')
    return { indices: [...indices], values }
  } }
}

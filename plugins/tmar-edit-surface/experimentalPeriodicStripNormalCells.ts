// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { prepareExperimentalPeriodicSurfaceDerivatives } from './experimentalPeriodicSurfaceDerivatives'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { add, cross, difference, divide, dot, l1, scalar, sub, times, vector } from './tangencyCoefficientIntervals'

const fail = (reason: string): never => { throw new Error(`Regolarità periodica per celle rifiutata: ${reason}`) }
const expand = (knots: readonly number[], mult: readonly number[]) =>
  knots.flatMap((knot, i) => Array<number>(mult[i]).fill(knot))

function spanStarts(multiplicities: readonly number[]): number[] {
  let start = 0
  return multiplicities.slice(0, -1).map((multiplicity, i) => {
    if (i > 0) start += multiplicity
    return start
  })
}

function checkDirection(direction: readonly number[]): Point {
  if (!Array.isArray(direction) || direction.length !== 3 || !Array.from(direction).every(Number.isFinite))
    fail('vettore test non valido')
  if (direction.every(x => x === 0)) fail('vettore test nullo')
  return [direction[0], direction[1], direction[2]]
}

function normalizedDirection(normal: Point): Point {
  const direction = checkDirection(normal)
  const scale = Math.max(...direction.map(Math.abs))
  return direction.map(x => x / scale) as Point
}

const midpoint = (first: number, last: number) => first + (last - first) / 2

/**
 * Sufficient continuous test for a unit-weight periodic-U, clamped-V C1
 * coefficient model. Each closed knot cell has a fixed direction, supplied
 * in U-major, V-minor order or selected from a rescaled numerical center
 * normal. The positive lower bound
 * on every active derivative-pair projection proves non-degeneracy and that
 * the parametric normal lies in the chosen open hemisphere on that cell.
 * Continuity extends the open-cell hull bounds to its boundary, including
 * the U seam. The numerical center normal only selects a direction.
 *
 * The Cartesian product of the derivative hulls discards correlation and
 * can decline regular, consistently oriented surfaces. The test does not
 * compare the normal with another surface. Even a shared hemisphere allows
 * a negative dot product between two normals. Global injectivity, topology
 * orientation, trims and kernel evaluation require separate checks. Work is
 * limited to 250,000 derivative pairs on the original knot cells.
 */
export function boundExperimentalPeriodicStripNormalCells(net: Net, cellDirections?: readonly (readonly [number, number, number])[]) {
  validateExperimentalPeriodicSurfaceU(net)
  const { nu, nv, du, dv, ku, kv, mu, mv, poles, weights } = net
  if (weights.some(weight => weight !== 1)) fail('richiesti pesi unitari')
  if (du < 2 || mu.some(m => m >= du) || mv.slice(1, -1).some(m => m >= dv))
    fail('richiesta continuità C1 ai nodi interni e alla cucitura U')

  const checkedUSpans = ku.length - 1, checkedVSpans = kv.length - 1
  const checkedCells = checkedUSpans * checkedVSpans
  const checkedDerivativePairs = checkedCells * du * (dv + 1) * (du + 1) * dv
  if (checkedDerivativePairs > 250_000) fail('limite di coppie derivate superato')
  if (cellDirections !== undefined && (!Array.isArray(cellDirections) || cellDirections.length !== checkedCells))
    fail('numero di vettori test diverso dal numero di celle')
  const directions = cellDirections === undefined ? undefined : Array.from(cellDirections, checkDirection)
  const numeric = directions === undefined ? prepareExperimentalPeriodicSurfaceDerivatives(net) : undefined

  const flatU = expand(ku.slice(0, -1), mu), flatV = expand(kv, mv)
  const firstU = scalar(ku[0]), lastU = scalar(ku.at(-1)!)
  const wrap = (i: number) => ((i % nu) + nu) % nu
  const factorsU = flatU.map((_, i) => {
    // First span ends its left knot at expanded index mu[0]-1. The
    // derivative denominator is T[i+du+1]-T[i+1] in full indexing.
    const hi = i + mu[0], lo = hi - du
    const a = scalar(flatU[wrap(lo)]), b = scalar(flatU[wrap(hi)])
    const width = Math.floor(lo / nu) === Math.floor(hi / nu) ? sub(b, a) : add(sub(lastU, a), sub(b, firstU))
    return divide(scalar(du), width)
  })
  const factorsV = Array.from({ length: nv - 1 }, (_, i) =>
    divide(scalar(dv), sub(scalar(flatV[i + dv + 1]), scalar(flatV[i + 1]))))
  const derivativeU = poles.map((pole, i) => {
    const u = Math.floor(i / nv), v = i % nv
    return times(difference(poles[wrap(u + 1) * nv + v], pole), factorsU[u])
  })
  const derivativeV = Array.from({ length: nu * (nv - 1) }, (_, i) => {
    const u = Math.floor(i / (nv - 1)), v = i % (nv - 1), index = u * nv + v
    return times(difference(poles[index + 1], poles[index]), factorsV[v])
  })

  let minNormalNorm = Infinity, minWitnessProjection = Infinity
  const witnesses: Point[] = []
  const startsV = spanStarts(mv)
  for (const [uSpan, startU] of spanStarts(mu).entries()) for (const [vSpan, startV] of startsV.entries()) {
    const uIndices = Array.from({ length: du + 1 }, (_, i) => wrap(startU + i))
    const vIndices = Array.from({ length: dv + 1 }, (_, i) => startV + i)
    const uHull = uIndices.slice(0, -1).flatMap(u => vIndices.map(v => derivativeU[u * nv + v]))
    const vHull = uIndices.flatMap(u => vIndices.slice(0, -1).map(v => derivativeV[u * (nv - 1) + v]))
    const witness = directions?.[witnesses.length] ?? normalizedDirection(numeric!.evaluate(
      midpoint(ku[uSpan], ku[uSpan + 1]), midpoint(kv[vSpan], kv[vSpan + 1]),
    ).normal)
    witnesses.push(witness)

    // Cross products of the two evaluated derivatives are convex
    // combinations of all pairwise coefficient cross products.
    let projection = Infinity
    for (const u of uHull) for (const v of vHull) {
      const lower = dot(cross(u, v), witness)[0]
      if (!(lower > 0)) fail(`proiezione normale non comprovabilmente positiva nella cella U${uSpan} V${vSpan}`)
      projection = Math.min(projection, lower)
    }
    const normal = divide(scalar(projection), scalar(l1(vector(witness))))[0]
    if (!(normal > 0)) fail(`limite della normale non rappresentabile nella cella U${uSpan} V${vSpan}`)
    minWitnessProjection = Math.min(minWitnessProjection, projection)
    minNormalNorm = Math.min(minNormalNorm, normal)
  }
  return { checkedUSpans, checkedVSpans, checkedCells, checkedDerivativePairs, witnesses, minWitnessProjection,
    minNormalNorm, evidenceScope: 'unit-weight-periodic-cell-normal-coefficient-model' as const }
}

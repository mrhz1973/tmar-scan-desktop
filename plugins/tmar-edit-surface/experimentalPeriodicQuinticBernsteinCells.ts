// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { add, divide, scalar, sub, times, type I, type V } from './tangencyCoefficientIntervals'

const fail = (reason: string): never => { throw new Error(`Estrazione Bernstein periodica rifiutata: ${reason}`) }
const equal = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, i) => value === b[i])
const delta = (a: number, b: number): I => a === b ? scalar(0) : sub(scalar(a), scalar(b))
const addVectors = (a: V, b: V): V => a.map((x, axis) => add(x, b[axis])) as V

interface Blend {
  alpha: I
  beta: I
}

function localAxis(degree: number, knots: number[], multiplicities: number[], span: number, periodic: boolean) {
  const flat = knots.flatMap((knot, i) =>
    periodic && i === knots.length - 1 ? [] : Array<number>(multiplicities[i]).fill(knot))
  const end = multiplicities.slice(0, span + 1).reduce((sum, m) => sum + m, 0) - 1
  const count = flat.length
  const wrap = (i: number) => ((i % count) + count) % count
  const gap = (lo: number, hi: number): I => {
    if (lo > hi) fail('ordinamento locale dei nodi non valido')
    if (!periodic) return delta(flat[hi], flat[lo])
    const a = flat[wrap(lo)], b = flat[wrap(hi)]
    const cycles = Math.floor(hi / count) - Math.floor(lo / count)
    if (cycles === 0) return delta(b, a)
    if (cycles !== 1) fail('estensione locale oltre un periodo')
    // The difference crosses the seam. Both positive pieces use stored
    // knots, avoiding a rounded or overflowing translated knot.
    return add(delta(knots.at(-1)!, a), delta(b, knots[0]))
  }
  const steps = Array.from({ length: degree }, (_, step) => {
    const order = step + 1
    return Array.from({ length: degree - step }, (_, offset) => {
      const j = degree - offset, lo = end - degree + j, hi = lo + degree - order + 1
      const width = gap(lo, hi)
      const blendAt = (knot: number): Blend => {
        const left = gap(lo, knot), right = gap(knot, hi)
        if (left[1] === 0) return { alpha: scalar(0), beta: scalar(1) }
        if (right[1] === 0) return { alpha: scalar(1), beta: scalar(0) }
        return { alpha: divide(left, width), beta: divide(right, width) }
      }
      return { j, left: blendAt(end), right: blendAt(end + 1) }
    })
  })
  const start = end - (periodic ? multiplicities[0] - 1 : degree)
  const indices = Array.from({ length: degree + 1 }, (_, i) => periodic ? wrap(start + i) : start + i)
  return { indices, steps }
}

function affineBlend(a: V, b: V, { alpha, beta }: Blend): V {
  if (alpha[1] === 0) return a
  if (beta[1] === 0) return b
  return addVectors(times(a, beta), times(b, alpha))
}

function restrictAxis(points: V[], axis: ReturnType<typeof localAxis>): V[] {
  const work = points.map(point => [point])
  for (const step of axis.steps) for (const { j, left, right } of step) {
    const a = work[j - 1], b = work[j], degree = a.length
    // Multiplying a degree-(r-1) Bernstein field by an affine blend uses
    // the two endpoint blend values, with factors (r-i)/r and i/r.
    work[j] = Array.from({ length: degree + 1 }, (_, i) => {
      if (i === 0) return affineBlend(a[0], b[0], left)
      if (i === degree) return affineBlend(a[i - 1], b[i - 1], right)
      return addVectors(times(affineBlend(a[i], b[i], left), divide(scalar(degree - i), scalar(degree))),
        times(affineBlend(a[i - 1], b[i - 1], right), divide(scalar(i), scalar(degree))))
    })
  }
  return work.at(-1)!
}

function validateCommonBasis(original: Net, candidate: Net) {
  validateExperimentalPeriodicSurfaceU(original)
  validateExperimentalPeriodicSurfaceU(candidate)
  const { du, dv, nu, nv, ku, kv, mu, mv } = original
  if (du > 3 || dv !== 5 || mu[0] !== du ||
      original.weights.some(weight => weight !== 1) || candidate.weights.some(weight => weight !== 1))
    fail('richiesti pesi unitari, V quintica e cucitura U satura con grado fino a tre')
  if (du !== candidate.du || dv !== candidate.dv || nu !== candidate.nu || nv !== candidate.nv ||
      !equal(ku, candidate.ku) || !equal(kv, candidate.kv) || !equal(mu, candidate.mu) || !equal(mv, candidate.mv))
    fail('basi U/V sorgente e candidato diverse')
}

/** Restrict the stored pole differences directly, without subtracting two restricted position fields. */
export function extractExperimentalPeriodicQuinticVDifferenceColumns(original: Net, candidate: Net, vSpan: number) {
  validateCommonBasis(original, candidate)
  const { nu, nv, dv, kv, mv } = original
  if (!Number.isInteger(vSpan) || vSpan < 0 || vSpan >= kv.length - 1) fail('indice della campata V fuori dal dominio')
  const axis = localAxis(dv, kv, mv, vSpan, false)
  return Array.from({ length: nu }, (_, i) => {
    const differences = axis.indices.map(j => {
      const index = i * nv + j
      return candidate.poles[index].map((value, k) => delta(value, original.poles[index][k])) as V
    })
    return differences.every(point => point.every(([lo, hi]) => lo === 0 && hi === 0)) ? differences : restrictAxis(differences, axis)
  })
}

/**
 * Extract a pair of Bernstein patches on one common native knot cell.
 * Both models use the same basis, unit weights, a saturated periodic U
 * seam, U degree at most three and clamped V degree five. The returned
 * controls are U-major with V contiguous, relative to a common origin,
 * and use the affine [0,1] coordinates within the specified cell.
 * Derivatives of the returned patches use those normalized coordinates.
 *
 * Each patch describes the closure of its own polynomial piece. The two
 * seam cells keep their own one-sided derivatives. This extraction gives
 * coefficient enclosures and leaves regularity, cross-cell derivative
 * agreement and CAD evaluation to separate checks.
 */
export function extractExperimentalPeriodicQuinticBernsteinCell(
  original: Net, candidate: Net, uSpan: number, vSpan: number,
) {
  validateCommonBasis(original, candidate)
  const { du, dv, nv, ku, kv, mu, mv } = original
  if (!Number.isInteger(uSpan) || uSpan < 0 || uSpan >= ku.length - 1 ||
      !Number.isInteger(vSpan) || vSpan < 0 || vSpan >= kv.length - 1)
    fail('indice della cella fuori dal dominio')

  const u = localAxis(du, ku, mu, uSpan, true), v = localAxis(dv, kv, mv, vSpan, false)
  const origin: Point = [...original.poles[u.indices[0] * nv + v.indices[0]]]
  const extract = (net: Net) => {
    const columns = v.indices.map(j => restrictAxis(u.indices.map(i => {
      const pole = net.poles[i * nv + j]
      return pole.map((value, axis) => delta(value, origin[axis])) as V
    }), u))
    const controls = Array.from({ length: du + 1 }, (_, i) => restrictAxis(columns.map(column => column[i]), v)).flat()
    return { degreeU: du, degreeV: dv, controls }
  }
  return { uSpan, vSpan, uDomain: [ku[uSpan], ku[uSpan + 1]] as const, vDomain: [kv[vSpan], kv[vSpan + 1]] as const,
    origin, original: extract(original), candidate: extract(candidate),
    evidenceScope: 'periodic-quintic-bernstein-cell-coefficient-model' as const }
}
